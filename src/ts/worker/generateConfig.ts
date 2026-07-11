import BattleshipHeatmap from '../battleship/heatmap'

type Data = {
  rows: number
  cols: number
  boats: number[]
  allowTouching: boolean
  grid: number[][]
}

self.onmessage = function (e: MessageEvent<Data>) {
  const { rows, cols, boats, allowTouching, grid } = e.data

  const heatmap = Array(rows)
    .fill(0)
    .map(() => Array(cols).fill(0))

  let row
  let col

  for (const boat of boats) {
    const r = Math.max(0, cols - boat + 1)
    const c = Math.max(0, rows - boat + 1)

    // Make it so the boat has an equal chance of being placed anywhere
    const placeHorCells = rows * r
    const placeVerCells = cols * c

    let boatPlaced = false

    for (let tries = 0; tries < Math.sqrt(rows * cols) * 80; tries++) {
      const horizontal = !!(Math.random() < placeHorCells / (placeHorCells + placeVerCells))

      // Place the boat randomly ensuring it won't overflow the grid
      if (horizontal) {
        row = ~~(Math.random() * rows)
        col = ~~(Math.random() * r)
      } else {
        row = ~~(Math.random() * c)
        col = ~~(Math.random() * cols)
      }

      if (canPlaceBoat(e.data, heatmap, boat, row, col, horizontal)) {
        forEachSegment(boat, row, col, horizontal, (row, col) => (heatmap[row][col] = 1))
        boatPlaced = true
        break
      }
    }

    if (!boatPlaced) {
      self.postMessage(false)
      return
    }
  }

  // Check if all hit and sunk clues have a boat placed on them
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (
        (grid[row][col] === BattleshipHeatmap.SUNK || grid[row][col] === BattleshipHeatmap.HIT) &&
        !heatmap[row][col]
      ) {
        self.postMessage(false)
        return
      }
    }
  }

  // Successful configuration found
  self.postMessage(heatmap)
}

function canPlaceBoat(
  data: Data,
  heatmap: number[][],
  boat: number,
  row: number,
  col: number,
  horizontal: boolean
): boolean {
  const { rows, cols, allowTouching, grid } = data

  const endRow = row + +!horizontal * (boat - 1)
  const endCol = col + +horizontal * (boat - 1)

  // Out of bounds
  if (row < 0 || col < 0 || endRow > rows || endCol > cols) return false

  if (allowTouching) {
    for (let segment = 0; segment < boat; segment++) {
      if (heatmap[row][col] || grid[row][col] === BattleshipHeatmap.MISS) return false
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

  // Disallow placing the boat over a miss clue
  for (let segment = 0; segment < boat; segment++) {
    if (grid[row][col] === 3) return false
    row += +!horizontal
    col += +horizontal
  }
  return true
}

function forEachSegment(
  boat: number,
  row: number,
  col: number,
  horizontal: boolean,
  callback: (row: number, col: number) => void
): void {
  for (let segment = 0; segment < boat; segment++) {
    callback(row, col)
    row += +!horizontal
    col += +horizontal
  }
}
