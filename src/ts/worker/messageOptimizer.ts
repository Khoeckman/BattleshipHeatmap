// ---------------------------------------------------------------------------
// 2D <-> flat conversion
// (bridge only - if your generator can emit a flat Uint8Array directly, skip this)
// ---------------------------------------------------------------------------

export function flatten2D(grid: number[][], rows: number, cols: number): Uint8Array {
  const flat = new Uint8Array(rows * cols)
  let idx = 0
  for (let y = 0; y < rows; y++) {
    const row = grid[y]
    for (let x = 0; x < cols; x++) {
      flat[idx++] = row[x]
    }
  }
  return flat
}

export function unflatten2D(flat: Uint8Array, rows: number, cols: number): number[][] {
  const grid: number[][] = new Array(rows)
  let idx = 0
  for (let y = 0; y < rows; y++) {
    const row = new Array(cols)
    for (let x = 0; x < cols; x++) {
      row[x] = flat[idx++]
    }
    grid[y] = row
  }
  return grid
}

// ---------------------------------------------------------------------------
// Binary (0/1) packing - 1 bit / cell, 8 cells / byte
// ---------------------------------------------------------------------------

export function packBinary(flat: Uint8Array): Uint8Array {
  const length = flat.length
  const out = new Uint8Array((length + 7) >> 3)
  const limit = length - 7
  let i = 0

  for (; i < limit; i += 8) {
    out[i >> 3] =
      (flat[i] & 1) |
      ((flat[i + 1] & 1) << 1) |
      ((flat[i + 2] & 1) << 2) |
      ((flat[i + 3] & 1) << 3) |
      ((flat[i + 4] & 1) << 4) |
      ((flat[i + 5] & 1) << 5) |
      ((flat[i + 6] & 1) << 6) |
      ((flat[i + 7] & 1) << 7)
  }

  if (i < length) {
    let byte = 0
    for (let j = i; j < length; j++) {
      byte |= (flat[j] & 1) << (j - i)
    }
    out[i >> 3] = byte
  }

  return out
}

export function unpackBinary(packed: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length)
  const fullBytes = length >> 3
  let i = 0

  for (let b = 0; b < fullBytes; b++, i += 8) {
    const byte = packed[b]
    out[i] = byte & 1
    out[i + 1] = (byte >> 1) & 1
    out[i + 2] = (byte >> 2) & 1
    out[i + 3] = (byte >> 3) & 1
    out[i + 4] = (byte >> 4) & 1
    out[i + 5] = (byte >> 5) & 1
    out[i + 6] = (byte >> 6) & 1
    out[i + 7] = (byte >> 7) & 1
  }

  const rem = length & 7
  if (rem) {
    const byte = packed[fullBytes]
    for (let k = 0; k < rem; k++) {
      out[i + k] = (byte >> k) & 1
    }
  }

  return out
}

// ---------------------------------------------------------------------------
// Multi-symbol packing (e.g. [0, 1, 2, 4]) - generic over alphabet size,
// but always rounds up to a byte-aligned width (1, 2, 4, or 8 bits/symbol)
// so no pack/unpack step ever crosses a byte boundary.
// ---------------------------------------------------------------------------

export type SymbolBits = 1 | 2 | 4 | 8

export function bitsForAlphabet(numSymbols: number): SymbolBits {
  if (numSymbols <= 2) return 1
  if (numSymbols <= 4) return 2
  if (numSymbols <= 16) return 4
  return 8
}

export interface SymbolCodec {
  readonly bits: SymbolBits
  pack(flat: Uint8Array): Uint8Array
  unpack(packed: Uint8Array, length: number): Uint8Array
}

export function createSymbolCodec(alphabet: readonly number[]): SymbolCodec {
  const bits = bitsForAlphabet(alphabet.length)
  const maxValue = alphabet.reduce((m, v) => (v > m ? v : m), 0)
  const encode = new Uint8Array(maxValue + 1)
  for (let c = 0; c < alphabet.length; c++) encode[alphabet[c]] = c
  const decode = Uint8Array.from(alphabet)
  const mask = (1 << bits) - 1

  function pack(flat: Uint8Array): Uint8Array {
    const length = flat.length

    if (bits === 8) {
      const out = new Uint8Array(length)
      for (let i = 0; i < length; i++) out[i] = encode[flat[i]]
      return out
    }

    const perByte = 8 / bits
    const out = new Uint8Array(Math.ceil(length / perByte))
    let i = 0

    if (bits === 1) {
      const limit = length - 7
      for (; i < limit; i += 8) {
        out[i >> 3] =
          encode[flat[i]] |
          (encode[flat[i + 1]] << 1) |
          (encode[flat[i + 2]] << 2) |
          (encode[flat[i + 3]] << 3) |
          (encode[flat[i + 4]] << 4) |
          (encode[flat[i + 5]] << 5) |
          (encode[flat[i + 6]] << 6) |
          (encode[flat[i + 7]] << 7)
      }
    } else if (bits === 2) {
      const limit = length - 3
      for (; i < limit; i += 4) {
        out[i >> 2] =
          encode[flat[i]] |
          (encode[flat[i + 1]] << 2) |
          (encode[flat[i + 2]] << 4) |
          (encode[flat[i + 3]] << 6)
      }
    } else {
      // bits === 4
      const limit = length - 1
      for (; i < limit; i += 2) {
        out[i >> 1] = encode[flat[i]] | (encode[flat[i + 1]] << 4)
      }
    }

    if (i < length) {
      let byte = 0
      for (let j = i, shift = 0; j < length; j++, shift += bits) {
        byte |= encode[flat[j]] << shift
      }
      out[out.length - 1] = byte
    }

    return out
  }

  function unpack(packed: Uint8Array, length: number): Uint8Array {
    const out = new Uint8Array(length)

    if (bits === 8) {
      for (let i = 0; i < length; i++) out[i] = decode[packed[i]]
      return out
    }

    const perByte = 8 / bits
    const fullBytes = Math.floor(length / perByte)
    let i = 0

    if (bits === 1) {
      for (let b = 0; b < fullBytes; b++, i += 8) {
        const byte = packed[b]
        out[i] = decode[byte & 1]
        out[i + 1] = decode[(byte >> 1) & 1]
        out[i + 2] = decode[(byte >> 2) & 1]
        out[i + 3] = decode[(byte >> 3) & 1]
        out[i + 4] = decode[(byte >> 4) & 1]
        out[i + 5] = decode[(byte >> 5) & 1]
        out[i + 6] = decode[(byte >> 6) & 1]
        out[i + 7] = decode[(byte >> 7) & 1]
      }
    } else if (bits === 2) {
      for (let b = 0; b < fullBytes; b++, i += 4) {
        const byte = packed[b]
        out[i] = decode[byte & 3]
        out[i + 1] = decode[(byte >> 2) & 3]
        out[i + 2] = decode[(byte >> 4) & 3]
        out[i + 3] = decode[(byte >> 6) & 3]
      }
    } else {
      // bits === 4
      for (let b = 0; b < fullBytes; b++, i += 2) {
        const byte = packed[b]
        out[i] = decode[byte & 0xf]
        out[i + 1] = decode[(byte >> 4) & 0xf]
      }
    }

    const rem = length - i
    if (rem) {
      const byte = packed[fullBytes]
      for (let k = 0; k < rem; k++) {
        out[i + k] = decode[(byte >> (k * bits)) & mask]
      }
    }

    return out
  }

  return { bits, pack, unpack }
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------
//
// Binary heatmap (e.g. probability grid thresholded to hit/no-hit):
//
//   const flat = flatten2D(heatmap, rows, cols)   // or generate flat directly
//   const packed = packBinary(flat)
//   worker.postMessage({ packed, rows, cols }, [packed.buffer])   // zero-copy transfer
//
//   // other side:
//   const flatBack = unpackBinary(packed, rows * cols)
//   const grid = unflatten2D(flatBack, rows, cols)
//
// Multi-symbol board state (0 = empty, 1 = miss, 2 = hit, 4 = sunk):
//
//   const boardCodec = createSymbolCodec([0, 1, 2, 4])   // build once, reuse
//
//   const flat = flatten2D(board, rows, cols)
//   const packed = boardCodec.pack(flat)
//   worker.postMessage({ packed, rows, cols }, [packed.buffer])
//
//   // other side:
//   const flatBack = boardCodec.unpack(packed, rows * cols)
//   const grid = unflatten2D(flatBack, rows, cols)
