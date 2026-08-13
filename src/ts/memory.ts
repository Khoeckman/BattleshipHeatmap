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
 * Bit layout of the single `Int32` backing this lock's state:
 *
 * ```
 * bit 31         bit 30          bits 0-29
 * MAIN_ACTIVE    MAIN_WAITING    worker count (0 to 2^30 - 1)
 * ```
 */
const MAIN_ACTIVE = 0x80000000

/** @see {@link MAIN_ACTIVE} for the full bit layout. */
const MAIN_WAITING = 0x40000000

/** @see {@link MAIN_ACTIVE} for the full bit layout. */
const COUNT_MASK = 0x3fffffff

/**
 * A lock held either exclusively by `main`, or concurrently by any number
 * of `worker`s — never both at once.
 *
 * ### Guarantees
 * - Calling {@link lockExclusive} immediately prevents any *new* worker
 *   from acquiring the lock via {@link lockShared}.
 * - A worker that already holds the lock is never preempted: it keeps the
 *   lock until it calls {@link unlockShared}, even while main is waiting.
 * - No worker can acquire the lock while main holds it, or is requesting it.
 * - Once the worker count drains to zero, main is woken and takes the lock
 *   immediately.
 *
 * ### Threading model
 * `main` is assumed to run somewhere `Atomics.wait` is disallowed (the DOM
 * main thread), so {@link lockExclusive} and {@link unlockExclusive} are
 * async, built on `Atomics.waitAsync`. `worker`s are assumed to run
 * somewhere blocking is acceptable, so {@link lockShared} and
 * {@link unlockShared} are synchronous.
 *
 * This class supports exactly one main-side caller at a time.
 * {@link lockExclusive} is not reentrant and does not queue concurrent
 * requests from multiple main-side callers.
 *
 * ### Requirements
 * - A `SharedArrayBuffer`-capable environment. In browsers this means the
 *   page must be cross-origin isolated (served with `Cross-Origin-Opener-Policy:
 *   same-origin` and `Cross-Origin-Embedder-Policy: require-corp`).
 * - `Atomics.waitAsync` support: Node.js 16+, Chromium 87+, Firefox 96+,
 *   Safari 16.4+. In TypeScript, `"lib"` must include `"es2021"` or later.
 *
 * ### Usage
 * @example
 * ```typescript
 * // main.ts
 * const lock = new SharedExclusiveLock()
 * worker.postMessage(lock)
 *
 * await lock.lockExclusive()
 * try {
 *   // exclusive section: no worker holds the lock here
 * } finally {
 *   lock.unlockExclusive()
 * }
 * ```
 *
 * @example
 * ```typescript
 * // worker.ts
 * self.onmessage = (e: MessageEvent<SharedExclusiveLock>) => {
 *   const lock = SharedExclusiveLock.connect(e.data)
 *
 *   lock.lockShared()
 *   try {
 *     // shared section: main does not hold the lock here
 *   } finally {
 *     lock.unlockShared()
 *   }
 * }
 * ```
 *
 * @see {@link https://blogtitle.github.io/using-javascript-sharedarraybuffers-and-atomics/}
 */
export class SharedExclusiveLock {
  private sab: SharedArrayBuffer
  private state: Int32Array<SharedArrayBuffer>

  /**
   * Rehydrates a `SharedExclusiveLock` received from another thread.
   *
   * Passing an instance through `postMessage` structurally clones it,
   * which drops its prototype and methods but keeps its `sab` field intact
   * (`SharedArrayBuffer` is itself directly cloneable). Call `connect` on
   * the receiving side to get back a fully working instance, backed by the
   * same underlying memory and therefore the same lock state.
   *
   * @param lock - The (method-less) object received via `postMessage`.
   * @returns A new `SharedExclusiveLock` sharing `lock`'s underlying buffer.
   */
  static connect(lock: SharedExclusiveLock) {
    return new SharedExclusiveLock(lock.sab)
  }

  /**
   * @param sab - An existing backing buffer, typically the `.sab` of a
   * `SharedExclusiveLock` received from another thread (see
   * {@link connect}). Omit to allocate a fresh, unlocked lock.
   */
  constructor(sab?: SharedArrayBuffer) {
    this.sab = sab || new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
    this.state = new Int32Array(this.sab)
  }

  /**
   * Worker side (sync)
   *
   * These methods block synchronously via `Atomics.wait` and must only be
   * called from a thread where blocking is acceptable — never from the
   * main/UI thread.
   */

  /**
   * Acquires the lock for this worker, blocking until it is available.
   *
   * Returns immediately if the lock is unheld or already held by one or
   * more other workers, and main is neither holding it nor requesting it.
   * Otherwise blocks until main releases or withdraws its request.
   *
   * Increments the worker count on success. Pair every call with a
   * matching {@link unlockShared} call, ideally in a `try`/`finally`.
   */
  lockShared() {
    while (true) {
      const current = Atomics.load(this.state, 0)

      if (current & (MAIN_ACTIVE | MAIN_WAITING)) {
        Atomics.wait(this.state, 0, current)
        continue
      }

      const next = current + 1
      if (Atomics.compareExchange(this.state, 0, current, next) === current) return
    }
  }

  /**
   * Releases this worker's hold on the lock.
   *
   * If this call brings the worker count to zero while main is waiting in
   * {@link lockExclusive}, wakes main so it can proceed.
   *
   * @throws {Error} If called while no worker currently holds the lock
   * (unbalanced {@link lockShared}/{@link unlockShared} calls).
   */
  unlockShared() {
    while (true) {
      const current = Atomics.load(this.state, 0)
      const count = current & COUNT_MASK

      if (!count) {
        throw new Error('SharedExclusiveLock is in inconsistent state: unlockShared on lock with zero shared holders')
      }

      const next = current - 1
      if (Atomics.compareExchange(this.state, 0, current, next) === current) {
        if (!(next & COUNT_MASK) && next & MAIN_WAITING) Atomics.notify(this.state, 0)
        return
      }
    }
  }

  /**
   * Main side (async)
   *
   * `Atomics.wait` is not valid on the main/UI thread, so these methods
   * use `Atomics.waitAsync` instead and return promises.
   */

  /**
   * Acquires the lock exclusively for main.
   *
   * Immediately marks the lock as requested — from this point on, no
   * worker can newly acquire it via {@link lockShared}. Workers already
   * holding the lock are unaffected and keep it until they call
   * {@link unlockShared}. Once the worker count drains to zero, this
   * resolves with the lock held.
   *
   * @returns A promise that resolves once main holds the lock.
   * @throws {Error} If called while main already holds, or is already
   * requesting, the lock. Only one exclusive request is supported at a
   * time; this method is not reentrant.
   */
  async lockExclusive() {
    while (true) {
      const current = Atomics.load(this.state, 0)

      if (current & (MAIN_ACTIVE | MAIN_WAITING)) {
        throw new Error('SharedExclusiveLock is in inconsistent state: lockExclusive on excluded lock')
      }

      const next = current | MAIN_WAITING
      if (Atomics.compareExchange(this.state, 0, current, next) === current) break
    }

    while (true) {
      const current = Atomics.load(this.state, 0)

      if (!(current & COUNT_MASK)) {
        const next = (current & ~MAIN_WAITING) | MAIN_ACTIVE
        if (Atomics.compareExchange(this.state, 0, current, next) === current) return
        continue
      }

      const { async, value } = Atomics.waitAsync(this.state, 0, current)
      if (async) await value
    }
  }

  /**
   * Releases main's exclusive hold on the lock and wakes every worker
   * currently blocked in {@link lockShared}.
   *
   * @throws {Error} If called while main does not hold the lock.
   */
  unlockExclusive() {
    while (true) {
      const current = Atomics.load(this.state, 0)

      if (!(current & MAIN_ACTIVE)) {
        throw new Error('SharedExclusiveLock is in inconsistent state: unlockExclusive on non-excluded lock')
      }

      const next = current & ~MAIN_ACTIVE
      if (Atomics.compareExchange(this.state, 0, current, next) === current) {
        Atomics.notify(this.state, 0)
        return
      }
    }
  }
}
