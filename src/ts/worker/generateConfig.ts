self.onmessage = function (e) {
  const { rows, cols, boats, allowTouching, grid } = e.data as {
    rows: number
    cols: number
    boats: number[]
    allowTouching: boolean
    grid: number[][]
  }

  const heatmap = Array(rows)
    .fill(0)
    .map(() => Array(cols).fill(0))

  let row
  let col
  let horizontal

  let placeHorCells
  let placeVerCells

  for (const boat of boats) {
    const r = Math.max(0, cols - boat + 1)
    const c = Math.max(0, rows - boat + 1)

    // Make it so the boat has an equal chance of being placed anywhere
    placeHorCells = rows * r
    placeVerCells = cols * c
    horizontal = !!(Math.random() < placeHorCells / (placeHorCells + placeVerCells))

    if ((horizontal && r === 0) || (!horizontal && c === 0)) {
      self.postMessage(false)
      return
    }

    // Place the boat so it won't overflow the grid
    if (horizontal) {
      row = ~~(Math.random() * rows)
      col = ~~(Math.random() * r)
    } else {
      row = ~~(Math.random() * c)
      col = ~~(Math.random() * cols)
    }

    if (!canPlaceBoat(heatmap, rows, cols, allowTouching, boat, row, col, horizontal)) break
    placeBoat(heatmap, boat, row, col, horizontal)
    break
  }
  self.postMessage(heatmap)
}

function canPlaceBoat(
  heatmap: number[][],
  rows: number,
  cols: number,
  allowTouching: boolean,
  boat: number,
  row: number,
  col: number,
  horizontal: boolean
): boolean {
  const endRow = row + +!horizontal * (boat - 1)
  const endCol = col + +horizontal * (boat - 1)

  // Out of bounds
  if (row < 0 || col < 0 || endRow > rows || endCol > cols) return false

  if (allowTouching) {
    for (let segment = 0; segment < boat; segment++) {
      if (heatmap[row][col]) return false
      row += +!horizontal
      col += +horizontal
    }
    return true
  }

  // Check a bounding box around the boat
  const minRow = Math.max(0, row - 1)
  const maxRow = Math.min(rows - 1, endRow + 1)
  const minCol = Math.max(0, col - 1)
  const maxCol = Math.min(cols - 1, endCol + 1)

  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      if (heatmap[r][c]) return false
    }
  }
  return true
}

function placeBoat(heatmap: number[][], boat: number, row: number, col: number, horizontal: boolean): void {
  for (let segment = 0; segment < boat; segment++) {
    heatmap[row][col] = 1
    row += +!horizontal
    col += +horizontal
  }
}
