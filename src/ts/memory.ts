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
 * Both counts live in one word so every change can be a single {@link Atomics.compareExchange}
 */
const WORKER_COUNT_MASK = 0x0000ffff
const MAIN_COUNT_MASK = 0xffff0000
const MAIN_COUNT_UNIT = 0x00010000

/**
 * A main-worker lock for coordinating access to a `SharedArrayBuffer`.
 *
 * Compatibility matrix:
 * ```
 *           main    worker
 * main       ✓        ✗
 * worker     ✗        ✓
 * ```
 *
 * **Main mode:**
 * multiple call sites on main can lock it concurrently.
 *
 * **Worker mode:**
 * multiple workers can lock it concurrently.
 *
 * **Switch to main mode:**
 * if at least one call site of main is waiting to acquire the lock, no worker can acquire it anymore.
 * Once all workers have chosen to release it, main can claim it.
 * Waiting is done by calling `Atomics.waitSync` and awaiting the promise, this keeps the event loop operational.
 * The last worker releasing the lock calls `Atomics.notify`, resolving the promises on main.
 *
 * **Switch to worker mode:**
 * the worker waits to acquire the lock until all call sites of main have released it.
 * Waiting is done by calling `Atomics.wait` which makes the worker sleep.
 * The last call site on main releasing the lock calls `Atomics.notify`, waking up the waiting workers.
 *
 * `Atomics.waitAsync` requires a runtime not older than 2021:
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics/waitAsync#browser_compatibility
 *
 * @example
 * ```ts
 * // main thread
 * await lock.lockMain()
 * try {
 *   // Do main thread stuff...
 * } finally {
 *   lock.lockMain()
 * }
 *
 * // worker thread
 * lock.lockWorker()
 * try {
 *   // Do worker thread stuff...
 * } finally {
 *   lock.lockWorker()
 * }
 * ```
 *
 * @see {@link https://blogtitle.github.io/using-javascript-sharedarraybuffers-and-atomics/}
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics/waitAsync}
 */
export class MainWorkerLock {
  private sab: SharedArrayBuffer
  private state: Int32Array<SharedArrayBuffer>

  static connect(lock: MainWorkerLock) {
    return new MainWorkerLock(lock.sab)
  }

  constructor(sab?: SharedArrayBuffer) {
    this.sab = sab || new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
    this.state = new Int32Array(this.sab)
  }

  /**
   * Acquires a worker slot. Returns immediately if no main call site
   * currently holds or is waiting for the lock; sleeps using `Atomics.wait`
   * if any main call site is active or pending, and retries when woken.
   */
  lockWorker() {
    while (true) {
      const current = Atomics.load(this.state, 0)

      if (current & MAIN_COUNT_MASK) {
        Atomics.wait(this.state, 0, current)
        continue
      }

      const next = current + 1
      if (Atomics.compareExchange(this.state, 0, current, next) === current) return
    }
  }

  /**
   * Releases a worker slot acquired with {@link lockWorker}. If this brings
   * the reader count to zero, it will wake all waiting main call sites.
   *
   * @throws {Error} If called while no worker is holding the lock.
   */
  unlockWorker() {
    while (true) {
      const current = Atomics.load(this.state, 0)
      const readers = current & WORKER_COUNT_MASK

      if (!readers) {
        throw new Error('unlockWorker may not be called on a lock with zero worker holders')
      }

      const next = current - 1
      if (Atomics.compareExchange(this.state, 0, current, next) === current) {
        if (!(next & WORKER_COUNT_MASK) && next & MAIN_COUNT_MASK) Atomics.notify(this.state, 0)
        return
      }
    }
  }

  /**
   * Acquires a main slot. Switches the lock to main mode immediately, meaning
   * no new workers can acquire the lock until every main call site unlocks.
   * It then waits using `Atomics.waitAsync` until every worker has released
   * and acquires the lock itself.
   *
   * @returns A promise that resolves once this call site holds the lock.
   */
  async lockMain() {
    while (true) {
      const current = Atomics.load(this.state, 0)
      const next = current + MAIN_COUNT_UNIT
      if (Atomics.compareExchange(this.state, 0, current, next) === current) break
    }

    while (true) {
      const current = Atomics.load(this.state, 0)
      if (!(current & WORKER_COUNT_MASK)) return

      const { async, value } = Atomics.waitAsync(this.state, 0, current)
      if (async) await value
    }
  }

  /**
   * Releases a main slot acquired with {@link lockMain}. If this brings
   * the main count to zero, wakes any workers blocked in {@link lockWorker}.
   *
   * @throws {Error} If called while no main call site is holding the lock.
   */
  unlockMain() {
    while (true) {
      const current = Atomics.load(this.state, 0)
      const mainCallSites = current & MAIN_COUNT_MASK

      if (!mainCallSites) {
        throw new Error('unlockMain may not be called on a lock with zero main holders')
      }

      const next = current - MAIN_COUNT_UNIT
      if (Atomics.compareExchange(this.state, 0, current, next) === current) {
        if (!(next & MAIN_COUNT_MASK)) Atomics.notify(this.state, 0)
        return
      }
    }
  }
}
