import { JOB_ID, ATTEMPTS, SUCCESSES } from '../constants'
import { SharedExclusiveLock } from '../memory'
import type { Boat, PlaceableBoat } from '../battleship/grid'
import BattleshipHeatmap, { type SharedData, type JobData } from '../battleship/heatmap'

type Grid = NonNullable<JobData['grid']>

// SharedData
let workerIndex: number
let lock: SharedExclusiveLock
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

let boatsPlaced: Boat[] = []
let boatPlaceAttempts: number

const onresult = (callback: () => void) => {
  lock.lockShared()
  try {
    if (Atomics.load(mainData, JOB_ID) !== data.id) return
    callback()
  } finally {
    lock.unlockShared()
  }
}

self.onmessage = function (e: MessageEvent<SharedData | JobData>) {
  if ('workerIndex' in e.data) {
    workerIndex = e.data.workerIndex
    lock = SharedExclusiveLock.connect(e.data.lock)
    mainData = new Uint32Array(e.data.mainDataBuffer)
    workerData = new Uint32Array(e.data.workerDataBuffer)
    heatmap = new Uint32Array(e.data.heatmapBuffer)
    workerDataSegmentSize = e.data.workerDataSegmentSize
    heatmapSegmentSize = e.data.heatmapSegmentSize
    return
  }

  data = e.data
  if (!data.grid) return

  // TODO: for performance reasons, mark all cells around boats with MISS on data.grid once before starting the loop
  // data.grid = todo(data.grid)

  workerDataOffset = workerDataSegmentSize * workerIndex
  heatmapOffset = heatmapSegmentSize * workerIndex
  boatLengths = new Uint8Array(data.boatLengths.length)
  grid = data.grid.map((row) => new Uint8Array(row.length))
  bitmap = new Uint8Array(data.rows * data.cols * Uint8Array.BYTES_PER_ELEMENT)

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
  boatsPlaced.length = 0

  // Fisher-Yates shuffle
  for (let i = boatLengths.length - 1; i > 0; i--) {
    const j = ~~(Math.random() * (i + 1))
    const temp = boatLengths[i]
    boatLengths[i] = boatLengths[j]
    boatLengths[j] = temp
  }

  let row
  let col

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

      if (canPlaceBoat(grid, bitmap, boat) && placeBoat(grid, bitmap, boat)) {
        boatPlaced = true
        boatsPlaced.push(boat)
        break
      }
    }

    if (!boatPlaced) {
      // Mission failed, we'll get 'em next time
      onresult(() => workerData[workerDataOffset + ATTEMPTS]++)
      return
    }
  }

  // Check if all hit and sunk clues have a boat placed on them
  let i = 0

  for (let row = 0; row < data.rows; row++) {
    for (let col = 0; col < data.cols; col++, i++) {
      const boatExpected = grid[row][col] & 3 // SUNK || HIT
      const isBoatSegment = bitmap[i]

      // Mission failed, we'll get 'em next time
      if (boatExpected && !isBoatSegment) {
        onresult(() => workerData[workerDataOffset + ATTEMPTS]++)
        return
      }
    }
  }

  // Successful configuration found
  onresult(() => {
    workerData[workerDataOffset + ATTEMPTS]++
    workerData[workerDataOffset + SUCCESSES]++

    // PERFORMANCE: ~10% of resources are spent here
    for (const boat of boatsPlaced) {
      forEachBoatSegment(boat, (row, col) => {
        heatmap[heatmapOffset + row * data.cols + col]++
      })
    }
  })
}

/**
 * Efficient preflight check if a boat can be validly placed
 */
function canPlaceBoat(grid: Grid, bitmap: Uint8Array, boat: Boat): boat is PlaceableBoat {
  // if (!data.allowTouching) Should fail if boat is placed next to but not on a HIT clue

  let row = boat.row
  let col = boat.col

  const dr = +boat.vertical
  const dc = +!boat.vertical

  const endRow = boat.row + dr * (boat.length - 1)
  const endCol = boat.col + dc * (boat.length - 1)

  // Out of bounds
  if (row < 0 || col < 0 || endRow > data.rows || endCol > data.cols) return false

  // Disallow placing the boat on another boat or on a MISS clue
  for (let segment = 0; segment < boat.length; segment++) {
    if (bitmap[row * data.cols + col] || grid[row][col] === BattleshipHeatmap.MISS) return false
    row += dr
    col += dc
  }
  return true
}

/**
 * Places a boat and surrounds it with water if `allowTouching` is false.
 *
 * @returns true if the boat was placed, false if it could not be placed.
 */
function placeBoat(grid: Grid, bitmap: Uint8Array, boat: PlaceableBoat): boolean {
  if (!data.allowTouching) {
    // Surround boat with water
    const endRow = boat.row + +boat.vertical * (boat.length - 1)
    const endCol = boat.col + +!boat.vertical * (boat.length - 1)

    // Check all values in a bounding box around the boat
    const minRow = Math.max(0, boat.row - 1)
    const maxRow = Math.min(data.rows - 1, endRow + 1)
    const minCol = Math.max(0, boat.col - 1)
    const maxCol = Math.min(data.cols - 1, endCol + 1)

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const isBoatSegment = boat.vertical
          ? c === boat.col && r >= boat.row && r < boat.row + boat.length
          : r === boat.row && c >= boat.col && c < boat.col + boat.length

        if (isBoatSegment) continue

        // SUNK || HIT
        if (grid[r][c] & 3) return false
        grid[r][c] = BattleshipHeatmap.MISS
      }
    }
  }

  forEachBoatSegment(boat, (row, col) => {
    bitmap[row * data.cols + col] = 1
    grid[row][col] = BattleshipHeatmap.SUNK
  })
  return true
}

// Implement locally for JIT and GC optimization reasons
let row: number
let col: number
let dr: number
let dc: number
let segment: number

function forEachBoatSegment(boat: Boat, callback: (row: number, col: number) => void): void {
  row = boat.row
  col = boat.col
  dr = +boat.vertical
  dc = +!boat.vertical

  for (segment = 0; segment < boat.length; segment++) {
    callback(row, col)
    row += dr
    col += dc
  }
}
