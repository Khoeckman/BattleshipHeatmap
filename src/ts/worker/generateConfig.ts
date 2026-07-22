import { type Boat } from '../battleship/grid'
import BattleshipHeatmap from '../battleship/heatmap'

type Data = {
  rows: number
  cols: number
  boatLengths: number[]
  boatsSunken: Boat[]
  allowTouching: boolean
  grid: number[][]
}

let data: Data

self.onmessage = function (e: MessageEvent<Data>) {
  data = e.data

  const heatmap = Array(data.rows)
    .fill(0)
    .map(() => Array(data.cols).fill(0))

  // Fisher-Yates shuffle
  for (let i = data.boatLengths.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[data.boatLengths[i], data.boatLengths[j]] = [data.boatLengths[j], data.boatLengths[i]]
  }

  let row
  let col

  for (const boatLength of data.boatLengths) {
    // The highest coordinates that the lowest coordinate of the boat can be at
    const r = Math.max(0, data.cols - boatLength + 1)
    const c = Math.max(0, data.rows - boatLength + 1)

    // Place the boat with perfectly distributed chances
    const placeHorCells = data.rows * r
    const placeVerCells = data.cols * c

    let boatPlaced = false
    const tries = Math.sqrt(data.rows * data.cols) * 80

    for (let t = 0; t < tries; t++) {
      const vertical = !(Math.random() < placeHorCells / (placeHorCells + placeVerCells))

      // Place the boat randomly ensuring it won't exceed the grid limits
      if (vertical) {
        row = ~~(Math.random() * data.rows)
        col = ~~(Math.random() * r)
      } else {
        row = ~~(Math.random() * c)
        col = ~~(Math.random() * data.cols)
      }

      const boat = { length: boatLength, row, col, vertical }

      if (canPlaceBoat(heatmap, boat)) {
        forEachBoatSegment(boat, (row, col) => (heatmap[row][col] = 1))
        boatPlaced = true
        break
      }
    }

    if (!boatPlaced) {
      // Mission failed, we'll get 'em next time
      self.postMessage(false)
      return
    }
  }

  // Check if all hit and sunk clues have a boat placed on them
  for (let row = 0; row < data.rows; row++) {
    for (let col = 0; col < data.cols; col++) {
      if (
        (data.grid[row][col] === BattleshipHeatmap.SUNK ||
          data.grid[row][col] === BattleshipHeatmap.HIT) &&
        !heatmap[row][col]
      ) {
        // Mission failed, we'll get 'em next time
        self.postMessage(false)
        return
      }
    }
  }

  // Successful configuration found
  self.postMessage(heatmap)
}

function canPlaceBoat(heatmap: number[][], boat: Boat): boolean {
  const endRow = boat.row + +boat.vertical * (boat.length - 1)
  const endCol = boat.col + +!boat.vertical * (boat.length - 1)

  // Out of bounds
  if (boat.row < 0 || boat.col < 0 || endRow > data.rows || endCol > data.cols) return false

  if (data.allowTouching) {
    for (let segment = 0; segment < boat.length; segment++) {
      if (heatmap[boat.row][boat.col] || data.grid[boat.row][boat.col] === BattleshipHeatmap.MISS)
        return false

      boat.row += +boat.vertical
      boat.col += +!boat.vertical
    }
    return true
  }

  // Check a bounding box around the boat
  const minRow = Math.max(0, boat.row - 1)
  const maxRow = Math.min(data.rows - 1, endRow + 1)
  const minCol = Math.max(0, boat.col - 1)
  const maxCol = Math.min(data.cols - 1, endCol + 1)

  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      if (heatmap[r][c]) return false
    }
  }

  // Disallow placing the boat over a miss clue
  for (let segment = 0; segment < boat.length; segment++) {
    if (data.grid[boat.row][boat.col] === 3) return false
    boat.row += +boat.vertical
    boat.col += +!boat.vertical
  }
  return true
}

function forEachBoatSegment(boat: Boat, callback: (row: number, col: number) => void): void {
  for (let segment = 0; segment < boat.length; segment++) {
    callback(boat.row, boat.col)
    boat.row += +boat.vertical
    boat.col += +!boat.vertical
  }
}
