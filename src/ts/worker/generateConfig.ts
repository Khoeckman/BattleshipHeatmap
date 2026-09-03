import { JOB_ID, ATTEMPTS, SUCCESSES } from '../constants'
import { MainWorkerLock } from '../memory'
import type { Boat, PlaceableBoat } from '../battleship/grid'
import BattleshipHeatmap, { type SharedData, type JobData } from '../battleship/heatmap'

// Hyper complex idea:
// Calculate for every cell, if I shoot there, how many shots on avg I will need to uncover all boats when only shooting at the hottest spot
// Where the boats lay is decided if the chance of hitting is 100.0%
// Because, shooting at the cell with the highest probability might be less favorable for the future than a lesser immediate shot

type Grid = NonNullable<JobData['grid']>

const clue = BattleshipHeatmap

// SharedData
let workerIndex: number
let lock: MainWorkerLock
let mainData: Uint32Array
let workerData: Uint32Array
let heatmap: Uint32Array
let workerDataSegmentSize: number
let heatmapSegmentSize: number

// JobData
let data: JobData
let workerDataOffset: number
let heatmapOffset: number
let boatLengths: Uint8Array
let grid: Grid
let bitmap: Uint8Array

let boatPlaceAttempts: number

const scopedLock = (callback: () => void) => {
  lock.lockWorker()
  try {
    if (Atomics.load(mainData, JOB_ID) !== data.id) return
    callback()
  } finally {
    lock.unlockWorker()
  }
}

self.onmessage = function (e: MessageEvent<SharedData | JobData>) {
  if ('workerIndex' in e.data) {
    workerIndex = e.data.workerIndex
    lock = MainWorkerLock.connect(e.data.lock)
    mainData = new Uint32Array(e.data.mainDataBuffer)
    workerData = new Uint32Array(e.data.workerDataBuffer)
    heatmap = new Uint32Array(e.data.heatmapBuffer)
    workerDataSegmentSize = e.data.workerDataSegmentSize
    heatmapSegmentSize = e.data.heatmapSegmentSize
    return
  }

  data = e.data
  if (!data.grid) return

  // Remove sunken boats from boatLengths
  for (const boat of data.boatsSunken) {
    const sameLengthBoatIndex = data.boatLengths.findIndex((boatLength) => boatLength === boat.length)
    data.boatLengths.splice(sameLengthBoatIndex, 1)
  }

  // TODO: for performance reasons, mark all cells around boats with MISS on data.grid once before starting the loop
  // data.grid = todo(data.grid)

  // TODO: use logic to try and find guaranteed placements of boats

  workerDataOffset = workerDataSegmentSize * workerIndex
  heatmapOffset = heatmapSegmentSize * workerIndex
  boatLengths = new Uint8Array(data.boatLengths.length)
  grid = data.grid.map((row) => new Uint8Array(row.length))
  bitmap = new Uint8Array(data.rows * data.cols)

  boatPlaceAttempts = Math.sqrt(data.rows * data.cols) * 80

  // Keep generating until the main thread increases JOB_ID
  while (Atomics.load(mainData, JOB_ID) === data.id) {
    for (let y = 0; y < data.grid.length; y++) grid[y].set(data.grid[y])
    generateConfig(grid)
  }
}

function generateConfig(grid: Grid): void {
  bitmap.fill(0)
  boatLengths.set(data.boatLengths)

  // Fisher-Yates shuffle
  for (let i = boatLengths.length - 1; i > 0; i--) {
    const j = ~~(Math.random() * (i + 1))
    const temp = boatLengths[i]
    boatLengths[i] = boatLengths[j]
    boatLengths[j] = temp
  }

  let row
  let col

  // TODO: optimalization: start with trying to place a boat through an H only.
  // If there no space for the boat to fit, try the other boats before failing the attempt.
  // Only try each other boat once! Remove from boatLengths and move to next loop should do
  // When to stop H optimalization loop?
  /* for (const boatLength of boatLengths) {
    // loop over all H's?
    for (let row = 0; row < data.rows; row++) {
      for (let col = 0; col < data.cols; col++, i++) {}

      const boat = { length: boatLength, row, col, vertical }

      if (canPlaceBoat(grid, bitmap, boat) && placeBoat(grid, bitmap, boat)) {
        boatsPlaced.push(boat)
        break
      }
    }
  } */

  for (const boatLength of boatLengths) {
    // The highest coordinates that the lowest coordinate of the boat can be at
    const maxCol = Math.max(0, data.cols - boatLength + 1)
    const maxRow = Math.max(0, data.rows - boatLength + 1)

    // Amount of cells that the boat can be placed in horizontally vs vertically
    const placeHorCells = data.rows * maxCol
    const placeVerCells = data.cols * maxRow

    let boatPlaced = false

    // TODO: strongly reduce boatPlaceAttempts heuristic and if !boatPlaced, use 2d loop to try every position sequentially (although pick a random start point)
    // boatPlaceAttempts should also include the total amount of boat cells to determine the heuristic,
    // more boats = less chance of finding an empty spot by chance
    // first boat = 100% chance of finding an empty spot by chance on the first try
    // last boat = possibly no empty spots left due to an inefficient configuration of the other boats
    for (let attempt = 0; attempt < boatPlaceAttempts; attempt++) {
      // The chances of placing a boat horizontally vs vertically should be proportional to the amount of cells it can be placed in that direction.
      const vertical = !(Math.random() < placeHorCells / (placeHorCells + placeVerCells))

      // Place the boat randomly ensuring it won't exceed the grid limits
      if (vertical) {
        row = ~~(Math.random() * maxRow)
        col = ~~(Math.random() * data.cols)
      } else {
        row = ~~(Math.random() * data.rows)
        col = ~~(Math.random() * maxCol)
      }

      const boat = { length: boatLength, row, col, vertical }

      if (canPlaceBoat(grid, boat) && placeBoat(grid, bitmap, boat)) {
        boatPlaced = true
        break
      }
    }

    if (!boatPlaced) {
      // Mission failed, we'll get 'em next time
      scopedLock(() => workerData[workerDataOffset + ATTEMPTS]++)
      return
    }
  }

  // Check if all HIT clues have been replaced by SUNK clues
  let i = 0
  for (let r = 0; r < data.rows; r++) {
    for (let c = 0; c < data.cols; c++, i++) {
      if (grid[r][c] === clue.HIT) {
        // Mission failed, we'll get 'em next time
        scopedLock(() => workerData[workerDataOffset + ATTEMPTS]++)
        return
      }
    }
  }

  // Successful configuration found
  scopedLock(() => {
    workerData[workerDataOffset + ATTEMPTS]++
    workerData[workerDataOffset + SUCCESSES]++

    for (let i = 0; i < data.rows * data.cols; i++) {
      if (bitmap[i]) heatmap[heatmapOffset + i]++
    }
  })
}

/**
 * Efficient preflight check if a boat can be validly placed
 */
function canPlaceBoat(grid: Grid, boat: Boat): boat is PlaceableBoat {
  // if (!data.allowTouching) Should fail if boat is placed next to but not on a HIT clue

  let row = boat.row
  let col = boat.col

  const dRow = +boat.vertical
  const dCol = +!boat.vertical

  const endRow = boat.row + dRow * (boat.length - 1)
  const endCol = boat.col + dCol * (boat.length - 1)

  // Out of bounds
  if (row < 0 || col < 0 || endRow >= data.rows || endCol >= data.cols) return false

  // Disallow placing the boat on another boat or on a (SUNK || MISS) clue
  for (let segment = 0; segment < boat.length; segment++) {
    // SUNK || MISS
    if (grid[row][col] & 5) return false
    row += dRow
    col += dCol
  }
  return true
}

/**
 * Places a boat and surrounds it with water if `allowTouching` is false.
 *
 * @returns true if the boat was placed, false if it could not be placed.
 */
function placeBoat(grid: Grid, bitmap: Uint8Array, boat: PlaceableBoat): boolean {
  if (data.allowTouching) {
    forEachBoatSegment(boat, (row, col) => {
      bitmap[row * data.cols + col] = 1
      grid[row][col] = clue.SUNK
    })
    return true
  }

  // Surround boat with water
  let endRow = boat.row
  let endCol = boat.col

  if (boat.vertical) endRow += boat.length - 1
  else endCol += boat.length - 1

  // Check all values in a bounding box around the boat
  const minRow = Math.max(0, boat.row - 1)
  const maxRow = Math.min(data.rows - 1, endRow + 1)
  const minCol = Math.max(0, boat.col - 1)
  const maxCol = Math.min(data.cols - 1, endCol + 1)

  const isBoatSegment = (row: number, col: number) =>
    boat.vertical
      ? col === boat.col && row >= boat.row && row < boat.row + boat.length
      : row === boat.row && col >= boat.col && col < boat.col + boat.length

  let isAllHit = true

  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      if (isBoatSegment(r, c)) {
        if (isAllHit && grid[r][c] !== clue.HIT) isAllHit = false
      } else if (grid[r][c] & 3) {
        return false
      }
    }
  }

  // The boat should either be marked as SUNK or is too short
  if (isAllHit) return false

  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      if (isBoatSegment(r, c)) {
        bitmap[r * data.cols + c] = 1
        grid[r][c] = clue.SUNK
        continue
      }
      grid[r][c] = clue.MISS
    }
  }
  return true
}

function forEachBoatSegment(boat: Boat, callback: (row: number, col: number) => void): void {
  let row = boat.row
  let col = boat.col
  const dRow = +boat.vertical
  const dCol = +!boat.vertical

  for (let segment = 0; segment < boat.length; segment++) {
    callback(row, col)
    row += dRow
    col += dCol
  }
}
