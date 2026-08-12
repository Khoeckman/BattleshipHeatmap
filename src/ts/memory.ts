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

const LOCKED = 1
const UNLOCKED = 0

/**
 * @author Rob
 * @see {@link https://blogtitle.github.io/using-javascript-sharedarraybuffers-and-atomics/}
 */
export class Mutex {
  private sab: SharedArrayBuffer
  private mutex: Int32Array<SharedArrayBuffer>

  static connect(mutex: Mutex) {
    return new Mutex(mutex.sab)
  }

  constructor(sab?: SharedArrayBuffer) {
    this.sab = sab || new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
    this.mutex = new Int32Array(this.sab)
  }

  lock() {
    while (true) {
      if (Atomics.compareExchange(this.mutex, 0, UNLOCKED, LOCKED) === UNLOCKED) return
      Atomics.wait(this.mutex, 0, LOCKED)
    }
  }

  unlock() {
    if (Atomics.compareExchange(this.mutex, 0, LOCKED, UNLOCKED) !== LOCKED)
      throw new Error('Mutex is in inconsistent state: unlock on unlocked Mutex')

    Atomics.notify(this.mutex, 0, 1)
  }
}

/**
 * @author Rob
 * @see {@link https://blogtitle.github.io/using-javascript-sharedarraybuffers-and-atomics/}
 */
export class WaitGroup {
  private sab: SharedArrayBuffer
  private waitGroup: Int32Array<SharedArrayBuffer>

  static connect(waitGroup: WaitGroup) {
    return new WaitGroup(0, waitGroup.sab)
  }

  constructor(waitCount: number, sab?: SharedArrayBuffer) {
    this.sab = sab || new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
    this.waitGroup = new Int32Array(this.sab)
    Atomics.add(this.waitGroup, 0, waitCount)
  }

  done() {
    const waitCount = Atomics.sub(this.waitGroup, 0, 1) - 1

    if (waitCount > 0) return
    else if (!waitCount) Atomics.notify(this.waitGroup, 0)
    else throw new Error('WaitGroup is in an inconsistent state: negative count')
  }

  wait() {
    while (true) {
      const waitCount = Atomics.load(this.waitGroup, 0)
      if (!waitCount || Atomics.wait(this.waitGroup, 0, waitCount) === 'ok') return
    }
  }
}
