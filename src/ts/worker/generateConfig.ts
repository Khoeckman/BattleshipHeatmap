import { type Boat, type PlaceableBoat } from '../battleship/grid'
import BattleshipHeatmap from '../battleship/heatmap'

type Data = {
  rows: number
  cols: number
  boatLengths: number[]
  boatsSunken: Boat[]
  allowTouching: boolean
  grid: number[][]
}

self.onmessage = function (e: MessageEvent<Data>) {
  const data = e.data

  const heatmap = Array(data.rows)
    .fill(0)
    .map(() => Array(data.cols).fill(0))

  // Place sunken boats
  for (const boat of data.boatsSunken) {
    placeBoat(data, heatmap, boat as PlaceableBoat)
  }

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
        row = ~~(Math.random() * c)
        col = ~~(Math.random() * data.cols)
      } else {
        row = ~~(Math.random() * data.rows)
        col = ~~(Math.random() * r)
      }

      const boat = { length: boatLength, row, col, vertical }

      if (canPlaceBoat(data, heatmap, boat) && placeBoat(data, heatmap, boat)) {
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
      const boatExpected = data.grid[row][col] & 3 // SUNK || HIT
      const boat = heatmap[row][col]

      if (boatExpected && !boat) {
        // Mission failed, we'll get 'em next time
        self.postMessage(false)
        return
      }
    }
  }

  // Successful configuration found
  self.postMessage(heatmap)
}

/**
 * Efficient preflight check if a boat can be validly placed
 */
function canPlaceBoat(data: Data, heatmap: number[][], boat: Boat): boat is PlaceableBoat {
  let row = boat.row
  let col = boat.col

  const endRow = boat.row + +boat.vertical * (boat.length - 1)
  const endCol = boat.col + +!boat.vertical * (boat.length - 1)

  // Out of bounds
  if (row < 0 || col < 0 || endRow > data.rows || endCol > data.cols) return false

  // Disallow placing the boat on another boat or in water
  for (let segment = 0; segment < boat.length; segment++) {
    if (heatmap[row][col] || data.grid[row][col] === BattleshipHeatmap.MISS) return false

    row += +boat.vertical
    col += +!boat.vertical
  }
  return true
}

/**
 * Places a boat and surrounds it with water if `allowTouching` is false.
 *
 * @returns true if the boat was placed, false if it could not be placed.
 */
function placeBoat(data: Data, heatmap: number[][], boat: PlaceableBoat): boolean {
  if (!data.allowTouching) {
    // Should fail if boat is placed next to but not on a HIT clue
    // if (true) {
    //   return false
    // }

    const segments: { row: number; col: number }[] = []
    forEachBoatSegment(boat, (row, col) => segments.push({ row, col }))

    const endRow = boat.row + +boat.vertical * (boat.length - 1)
    const endCol = boat.col + +!boat.vertical * (boat.length - 1)

    // Check all values in a bounding box around the boat
    const minRow = Math.max(0, boat.row - 1)
    const maxRow = Math.min(data.rows - 1, endRow + 1)
    const minCol = Math.max(0, boat.col - 1)
    const maxCol = Math.min(data.cols - 1, endCol + 1)

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const isBoatSegment = segments.some((segment) => segment.row === r && segment.col === c)
        if (isBoatSegment) continue

        // SUNK || HIT
        if (data.grid[r][c] & 3) return false
        data.grid[r][c] = BattleshipHeatmap.MISS
      }
    }
  }

  forEachBoatSegment(boat, (row, col) => {
    heatmap[row][col] = 1
    data.grid[row][col] = BattleshipHeatmap.SUNK
  })
  return true
}

/**
 * Do something for each segment of a boat.
 */
function forEachBoatSegment(boat: Boat, callback: (row: number, col: number) => void): void {
  let row = boat.row
  let col = boat.col

  for (let segment = 0; segment < boat.length; segment++) {
    callback(row, col)
    row += +boat.vertical
    col += +!boat.vertical
  }
}
