import { CACHE_LINE_SIZE } from './constants'

/**
 * Rounds a byte size up to the nearest cache-line boundary.
 *
 * @param elements - The number of elements in the array.
 * @param arrayConstructor - The typed array constructor to determine the size of each element.
 * @returns The minimum cache-line-aligned size that can contain the requested bytes.
 */
export const alignToCacheLine = (
  elements: number,
  arrayConstructor?: { readonly BYTES_PER_ELEMENT: number }
) =>
  Math.ceil(elements / CACHE_LINE_SIZE) *
  CACHE_LINE_SIZE *
  (arrayConstructor?.BYTES_PER_ELEMENT || 1)

const MAIN_ACTIVE = 0x80000000 // main holds the exclusive lock
const MAIN_WAITING = 0x40000000 // main requests the lock and disallows new workers locks
const COUNT_MASK = 0x3fffffff // low 30 bits: number of workers concurrently holding the lock

/**
 * ExclusiveSharedLock lock: either main holds the lock exclusively, or any number of
 * workers hold it concurrently.
 *
 * - when main calls {@link lockExclusive()} it immediately blocks new worker locks, then waits
 *   for currently-held worker lock count to drain to zero before taking it.
 * - a worker that already holds the lock keeps the lock until it calls {@link unlockShared()},
 *   even while main is waiting.
 * - not a single worker can acquire the lock while main holds it or is requesting it.
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

  unlockShared() {
    while (true) {
      const current = Atomics.load(this.state, 0)
      const count = current & COUNT_MASK

      if (count === 0)
        throw new Error(
          'SharedExclusiveLock is in inconsistent state: unlockShared on lock with zero shared holders'
        )

      const next = current - 1
      if (Atomics.compareExchange(this.state, 0, current, next) === current) {
        if (!(next & COUNT_MASK) && next & MAIN_WAITING) Atomics.notify(this.state, 0)
        return
      }
    }
  }

  async lockExclusive() {
    while (true) {
      const current = Atomics.load(this.state, 0)

      if (current & (MAIN_ACTIVE | MAIN_WAITING))
        throw new Error(
          'SharedExclusiveLock is in inconsistent state: lockExclusive on excluded lock'
        )

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

  unlockExclusive() {
    while (true) {
      const current = Atomics.load(this.state, 0)

      if (!(current & MAIN_ACTIVE))
        throw new Error(
          'SharedExclusiveLock is in inconsistent state: unlockExclusive on non-excluded lock'
        )

      const next = current & ~MAIN_ACTIVE
      if (Atomics.compareExchange(this.state, 0, current, next) === current) {
        Atomics.notify(this.state, 0)
        return
      }
    }
  }
}

const LOCKED = 1
const UNLOCKED = 0

/**
 * @see {@link https://blogtitle.github.io/using-javascript-sharedarraybuffers-and-atomics/}
 */
export class Mutex {
  private sab: SharedArrayBuffer
  private state: Int32Array<SharedArrayBuffer>

  static connect(mutex: Mutex) {
    return new Mutex(mutex.sab)
  }

  constructor(sab?: SharedArrayBuffer) {
    this.sab = sab || new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
    this.state = new Int32Array(this.sab)
  }

  lock() {
    while (true) {
      if (Atomics.compareExchange(this.state, 0, UNLOCKED, LOCKED) === UNLOCKED) return
      Atomics.wait(this.state, 0, LOCKED)
    }
  }

  unlock() {
    if (Atomics.compareExchange(this.state, 0, LOCKED, UNLOCKED) !== LOCKED)
      throw new Error('Mutex is in inconsistent state: unlock on unlocked Mutex')

    Atomics.notify(this.state, 0, 1)
  }
}

/**
 * @see {@link https://blogtitle.github.io/using-javascript-sharedarraybuffers-and-atomics/}
 */
export class WaitGroup {
  private sab: SharedArrayBuffer
  private state: Int32Array<SharedArrayBuffer>

  static connect(waitGroup: WaitGroup) {
    return new WaitGroup(0, waitGroup.sab)
  }

  constructor(waitCount: number, sab?: SharedArrayBuffer) {
    this.sab = sab || new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
    this.state = new Int32Array(this.sab)
    if (waitCount > 0) Atomics.add(this.state, 0, waitCount)
  }

  unlock() {
    const waitCount = Atomics.sub(this.state, 0, 1) - 1

    if (waitCount > 0) return
    else if (!waitCount) Atomics.notify(this.state, 0)
    else throw new Error('WaitGroup is in an inconsistent state: negative count')
  }

  wait() {
    while (true) {
      const waitCount = Atomics.load(this.state, 0)
      if (!waitCount || Atomics.wait(this.state, 0, waitCount) === 'ok') return
    }
  }
}
