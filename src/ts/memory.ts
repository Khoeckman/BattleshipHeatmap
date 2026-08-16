import { CACHE_LINE_SIZE } from './constants'

/**
 * Rounds a byte size up to the nearest cache-line boundary.
 *
 * @param elements - The number of elements in the array.
 * @param arrayConstructor - The typed array constructor to determine the size of each element.
 * @returns The minimum cache-line-aligned size that can contain the requested bytes.
 */
export const alignToCacheLine = (elements: number, arrayConstructor?: { readonly BYTES_PER_ELEMENT: number }) =>
  Math.ceil(elements / CACHE_LINE_SIZE) * CACHE_LINE_SIZE * (arrayConstructor?.BYTES_PER_ELEMENT || 1)

/**
 * Packed 32-bit lock state, stored in `state[0]`.
 *
 * Both counts live in one word so every transition is a single
 * {@link Atomics.compareExchange} — writers and readers can never observe
 * (or produce) a state where the two counts disagree with reality.
 */
const READER_COUNT_MASK = 0x00ffffff
const WRITER_COUNT_MASK = 0xff000000
const WRITER_COUNT_UNIT = 0x01000000 // one writer

/**
 * A group-mutual-exclusion lock for coordinating "main" (writer) and
 * "worker" (reader) access to a `SharedArrayBuffer`.
 *
 * Compatibility matrix:
 * ```
 *          write   read
 * write      ✓      ✗
 * read       ✗      ✓
 * ```
 * Same-mode holders never block each other; the two modes always do.
 * Concretely:
 * - Any number of main-side call sites can hold the lock via
 *   {@link lockExclusive} at once. There is no "sole owner" invariant —
 *   if your protected work isn't safe to interleave with itself, that
 *   safety has to come from the caller, not this lock.
 * - Any number of workers can hold {@link lockShared} at once.
 * - Once at least one writer has called {@link lockExclusive}, no new
 *   reader can start, even if that writer is still draining existing
 *   readers (write-preferring, to avoid writer starvation).
 * - A reader that already holds the lock is never preempted; it keeps it
 *   until it calls {@link unlockShared}.
 * - As soon as the reader count hits zero while a writer is
 *   waiting, that writer (and any other writer waiting alongside it)
 *   proceeds immediately.
 *
 * ### Threading model
 * `Atomics.wait` cannot be called on a JS engine's main/UI thread — it
 * throws. This lock assumes **main runs on such a thread**, so
 * {@link lockExclusive} is async, built on `Atomics.waitAsync`. Workers
 * are assumed to run on threads where blocking is fine (Web Workers,
 * `worker_threads`), so {@link lockShared} and {@link unlockShared} are
 * synchronous. `unlockExclusive` never needs to wait, so it stays sync too.
 *
 * `Atomics.waitAsync` needs a reasonably modern runtime (Node 16+,
 * Chromium 87+, Firefox 96+, Safari 16.4+) and `"lib": ["es2021"]` or
 * later in `tsconfig.json`.
 *
 * ### Usage
 * ```ts
 * // main thread — any number of call sites can do this concurrently
 * await lock.lockExclusive()
 * try {
 *   // ...write work, safe to interleave with other write work...
 * } finally {
 *   lock.unlockExclusive()
 * }
 * ```
 * ```ts
 * // worker thread
 * lock.lockShared()
 * try {
 *   // ...read work...
 * } finally {
 *   lock.unlockShared()
 * }
 * ```
 *
 * @see {@link https://blogtitle.github.io/using-javascript-sharedarraybuffers-and-atomics/}
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics/waitAsync}
 */
export class SharedExclusiveLock {
  private sab: SharedArrayBuffer
  private state: Int32Array<SharedArrayBuffer>

  static connect(lock: SharedExclusiveLock) {
    return new SharedExclusiveLock(lock.sab)
  }

  constructor(sab?: SharedArrayBuffer) {
    this.sab = sab || new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
    this.state = new Int32Array(this.sab)
  }

  /**
   * Acquires a reader slot. Returns immediately if no writer currently
   * holds or is waiting for the lock; blocks (via `Atomics.wait`) while
   * any writer is active or pending, and retries once woken.
   */
  lockShared() {
    while (true) {
      const current = Atomics.load(this.state, 0)

      if (current & WRITER_COUNT_MASK) {
        Atomics.wait(this.state, 0, current)
        continue
      }

      const next = current + 1
      if (Atomics.compareExchange(this.state, 0, current, next) === current) return
    }
  }

  /**
   * Releases a reader slot acquired with {@link lockShared}. If this
   * brings the reader count to zero and a writer is waiting, wakes it.
   *
   * @throws {Error} If called while no reader currently holds the lock.
   */
  unlockShared() {
    while (true) {
      const current = Atomics.load(this.state, 0)
      const readers = current & READER_COUNT_MASK

      if (readers === 0) {
        throw new Error('SharedExclusiveLock is in inconsistent state: unlockShared on lock with zero shared holders')
      }

      const next = current - 1
      if (Atomics.compareExchange(this.state, 0, current, next) === current) {
        if (!(next & READER_COUNT_MASK) && next & WRITER_COUNT_MASK) Atomics.notify(this.state, 0)
        return
      }
    }
  }

  /**
   * Acquires a writer slot. Announces intent immediately — no new reader
   * can start from this point until every current writer unlocks — then
   * asynchronously waits for any currently-held reader slots to drain to
   * zero before resolving. Joins freely alongside any other writers
   * already holding or waiting for the lock.
   *
   * @returns A promise that resolves once this call holds the write lock.
   */
  async lockExclusive() {
    while (true) {
      const current = Atomics.load(this.state, 0)
      const next = current + WRITER_COUNT_UNIT
      if (Atomics.compareExchange(this.state, 0, current, next) === current) break
    }

    while (true) {
      const current = Atomics.load(this.state, 0)
      if (!(current & READER_COUNT_MASK)) return

      const { async, value } = Atomics.waitAsync(this.state, 0, current)
      if (async) await value
    }
  }

  /**
   * Releases a writer slot acquired with {@link lockExclusive}. If this
   * brings the writer count to zero, wakes any readers blocked in
   * {@link lockShared}.
   *
   * @throws {Error} If called while no writer currently holds the lock.
   */
  unlockExclusive() {
    while (true) {
      const current = Atomics.load(this.state, 0)
      const writers = (current & WRITER_COUNT_MASK) >>> Math.log2(WRITER_COUNT_UNIT)

      if (writers === 0) {
        throw new Error(
          'SharedExclusiveLock is in inconsistent state: unlockExclusive on lock with zero exclusive holders'
        )
      }

      const next = current - WRITER_COUNT_UNIT
      if (Atomics.compareExchange(this.state, 0, current, next) === current) {
        if (!(next & WRITER_COUNT_MASK)) Atomics.notify(this.state, 0)
        return
      }
    }
  }
}
