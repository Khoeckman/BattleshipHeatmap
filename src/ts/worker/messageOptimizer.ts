// Convert 2D arrays of ones and zeroes into a 1D array of integers

export function packOutgoing(heatmap: number[][], rows: number, cols: number): Uint8Array {
  const packed = new Uint8Array(Math.ceil((cols * rows) / 8))

  for (let y = 0; y < cols; y++) {
    for (let x = 0; x < cols; x++) {
      if (heatmap[y][x]) {
        const index = y * cols + x
        packed[index >> 3] |= 1 << (index & 7)
      }
    }
  }
  return packed
}

export function unpackIncoming(heatmap: Uint8Array, rows: number, cols: number): number[][] {
  const grid = Array(rows)
    .fill(0)
    .map(() => new Array(cols))

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const index = y * cols + x
      grid[y][x] = (heatmap[index >> 3] >> (index & 7)) & 1
    }
  }
  return grid
}
