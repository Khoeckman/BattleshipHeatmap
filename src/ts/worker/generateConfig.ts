import { alignToCacheLine } from '../mem'
import { type Boat, type PlaceableBoat } from '../battleship/grid'
import BattleshipGrid from '../battleship/grid'
import BattleshipHeatmap, { type SharedData, type JobData } from '../battleship/heatmap'

// SharedData
let threadIndex: number
let mainData: Int32Array
let workerData: Int32Array
let heatmap: Uint32Array

// JobData
let workerDataOffset: number
let heatmapOffset: number

let stride: number
const index = (row: number, col: number) => row * stride + col

let boatPlaceAttempts: number

self.onmessage = function (e: MessageEvent<SharedData | JobData>) {
  const data = e.data

  if ('threadIndex' in data) {
    threadIndex = data.threadIndex
    heatmap = new Uint32Array(data.heatmapBuffer)
    mainData = new Int32Array(data.mainDataBuffer)
    workerData = new Int32Array(data.workerDataBuffer)
    return
  }

  workerDataOffset = alignToCacheLine(2, Int32Array) * threadIndex
  heatmapOffset = alignToCacheLine(data.rows * data.cols, Uint32Array) * threadIndex

  stride = data.cols
  boatPlaceAttempts = Math.sqrt(data.rows * data.cols) * 80

  const gridReference = data.grid

  // Keep generating until the main thread increases the value at index __JOB_ID__ in the SAB
  while (mainData[__JOB_ID__] === data.id) {
    data.grid = structuredClone(gridReference)
    generateConfig(data)
  }
  // self.close()
}

function generateConfig(data: JobData): number[][] | void {
  const bitmap = new Uint8Array(data.rows * data.cols * Uint8Array.BYTES_PER_ELEMENT)

  const boatLengths = structuredClone(data.boatLengths)
  const boatsPlaced: Boat[] = []

  // Fisher-Yates shuffle
  for (let i = boatLengths.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[boatLengths[i], boatLengths[j]] = [boatLengths[j], boatLengths[i]]
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

      if (canPlaceBoat(data, bitmap, boat) && placeBoat(data, bitmap, boat)) {
        boatPlaced = true
        boatsPlaced.push(boat)
        break
      }
    }

    if (!boatPlaced) {
      // Mission failed, we'll get 'em next time
      if (mainData[__JOB_ID__] === data.id) Atomics.add(mainData, __ATTEMPTS__, 1)
      return
    }
  }

  // Check if all hit and sunk clues have a boat placed on them
  for (let row = 0; row < data.rows; row++) {
    for (let col = 0; col < data.cols; col++) {
      const boatExpected = data.grid[row][col] & 3 // SUNK || HIT
      const boat = bitmap[index(row, col)]

      // Mission failed, we'll get 'em next time
      if (boatExpected && !boat) {
        if (mainData[__JOB_ID__] === data.id) Atomics.add(mainData, __ATTEMPTS__, 1)
        return
      }
    }
  }

  if (mainData[__JOB_ID__] !== data.id) return

  // Successful configuration found

  // Atomics.wait(workerData, LOCK, 1)
  // Atomics.add(workerData, WRITERS, 1)

  // Atomics.add(workerData, workerDataOffset + __ATTEMPTS__, 1)
  // Atomics.add(workerData, workerDataOffset + __SUCCESSES__, 1)
  workerData[workerDataOffset + __ATTEMPTS__]++
  workerData[workerDataOffset + __SUCCESSES__]++

  for (const boat of boatsPlaced) {
    BattleshipGrid.forEachBoatSegment(boat, (row, col) => {
      // Atomics.add(heatmap, heatmapOffset + index(row, col), 1)
      heatmap[heatmapOffset + index(row, col)]++
    })
  }
  // Atomics.sub(workerData, WRITERS, 1)
}

/**
 * Efficient preflight check if a boat can be validly placed
 */
function canPlaceBoat(data: JobData, bitmap: Uint8Array, boat: Boat): boat is PlaceableBoat {
  let row = boat.row
  let col = boat.col

  const dr = +boat.vertical
  const dc = +!boat.vertical

  const endRow = boat.row + dr * (boat.length - 1)
  const endCol = boat.col + dc * (boat.length - 1)

  // Out of bounds
  if (row < 0 || col < 0 || endRow > data.rows || endCol > data.cols) return false

  // Disallow placing the boat on another boat or in water
  for (let segment = 0; segment < boat.length; segment++) {
    if (bitmap[index(row, col)] || data.grid[row][col] === BattleshipHeatmap.MISS) return false
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
function placeBoat(data: JobData, bitmap: Uint8Array, boat: PlaceableBoat): boolean {
  if (!data.allowTouching) {
    // Should fail if boat is placed next to but not on a HIT clue
    // if (true) {
    //   return false
    // }

    const segments: { row: number; col: number }[] = []

    BattleshipGrid.forEachBoatSegment(boat, (row, col) => {
      segments.push({ row, col })
    })

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

  BattleshipGrid.forEachBoatSegment(boat, (row, col) => {
    bitmap[index(row, col)] = 1
    data.grid[row][col] = BattleshipHeatmap.SUNK
  })
  return true
}
