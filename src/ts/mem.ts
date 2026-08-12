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
