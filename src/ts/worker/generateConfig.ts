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

  let placeRow
  let placeCol
  let placeHor

  let placeHorCells
  let placeVerCells
  let placeBothCells
  let placeTotalCells

  for (const boat of boats) {
    const r = cols - boat + 1
    const c = rows - boat + 1

    // Make it so the boat has an equal chance of being placed anywhere
    placeHorCells = rows * r
    placeVerCells = cols * c
    placeBothCells = r * c
    placeTotalCells = placeHorCells + placeVerCells - placeBothCells * 2
    placeHor = !!(~~(Math.random() * placeTotalCells) < placeHorCells - placeBothCells)

    // Place the boat so it won't overflow the grid
    if (placeHor) {
      placeRow = ~~(Math.random() * rows)
      placeCol = ~~(Math.random() * c)
    } else {
      placeRow = ~~(Math.random() * r)
      placeCol = ~~(Math.random() * cols)
    }

    // if (!canPlaceBoat(heatmap, rows, cols, allowTouching, boat, placeRow, placeCol, placeHor)) break
    placeBoat(heatmap, boat, placeRow, placeCol, placeHor)
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
  const endRow = row + +!horizontal * boat
  const endCol = col + +horizontal * boat

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
    return
    row += +!horizontal
    col += +horizontal
  }
}
