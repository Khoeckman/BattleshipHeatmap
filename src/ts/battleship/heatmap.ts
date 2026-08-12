import { JOB_ID, ATTEMPTS, SUCCESSES } from '../constants'
import { alignToCacheLine } from '../mem'
import BattleshipGrid, { type Boat } from './grid'

export type SharedData = {
  threadIndex: number
  mainDataBuffer: SharedArrayBuffer
  workerDataBuffer: SharedArrayBuffer
  heatmapBuffer: SharedArrayBuffer
  workerDataSegmentSize: number
  heatmapSegmentSize: number
}

export type JobData = {
  id: number
  rows: number
  cols: number
  boatLengths: number[]
  boatsSunken: Boat[]
  allowTouching: boolean
  grid: number[][]
}

export default class BattleshipHeatmap extends BattleshipGrid {
  #threads = Math.max(1, navigator.hardwareConcurrency)
  #workers: Worker[] = Array(this.#threads)

  /**
   * Shared data from the workers to the main thread.
   *
   * 0 Job ID - If this ID does not match the ID of the worker (anymore) it means it should stop generating and close.
   * 1 Lock - Whether the workers are allowed to start writing to the SABs
   * 2 Writing - The amount of workers that are actively writing their results to the SABs
   */
  #mainDataLive = new Int32Array(this.sab(3, Int32Array))

  /**
   * Shared data from the workers to the main thread.
   *
   * 0 Attempts - The number of attempts to generate a valid configuration.
   * 1 Successes - The number of valid configurations accumulated to produce the heatmap.
   */
  #workerDataLive = new Int32Array(this.sab(2, Int32Array))
  #workerDataSegmentSize = alignToCacheLine(2)
  #workerData: number[] = []

  /**
   * Represents the heatmap grid for each worker.
   *
   * The value in each cell represents the total number of times a boat crossed
   * through that cell inside of a valid configuration.
   */
  #heatmapLive: Uint32Array<SharedArrayBuffer>
  #heatmapSegmentSize: number
  #heatmap: number[][] = []

  #generating = false
  public generationSeconds: number
  public generationTimeoutId: number = -1
  public generationStartTs: number = 0

  /** Information about the current generation job to keep workers from reading too new data or writing outdated results. */
  public jobData: JobData | null = null

  #onStartGenerating: () => void
  #onStopGenerating: () => void
  #onFinishGenerating: () => void

  constructor(
    grid: BattleshipGrid,
    generationSeconds: number,
    onStartGenerating: () => void,
    onStopGenerating: () => void,
    onFinishGenerating: () => void
  ) {
    if (!(grid instanceof BattleshipGrid)) {
      throw new TypeError('grid must be an instance of BattleshipGrid')
    }
    super(grid.rows, grid.cols, grid.boatLengths, grid.allowTouching, grid.grid)
    this.onChange = () => (this.generating = false)

    this.#heatmapLive = new Uint32Array(this.sab(this.rows * this.cols, Uint32Array))
    this.#heatmapSegmentSize = alignToCacheLine(this.rows * this.cols)

    if (!Number.isFinite(generationSeconds)) {
      throw new TypeError('generationSeconds must be a finite number')
    }
    this.generationSeconds = generationSeconds

    if (typeof onStartGenerating !== 'function') {
      throw new TypeError('onStartCalculating must be a function')
    }
    this.#onStartGenerating = onStartGenerating

    if (typeof onStopGenerating !== 'function') {
      throw new TypeError('onStopCalculating must be a function')
    }
    this.#onStopGenerating = onStopGenerating

    if (typeof onFinishGenerating !== 'function') {
      throw new TypeError('onStopCalculating must be a function')
    }
    this.#onFinishGenerating = onFinishGenerating

    this.snapshot()
  }

  get generating() {
    return this.#generating
  }

  set generating(value: boolean) {
    if (this.#generating === value) return
    if (value) this.#startGenerating()
    else this.#stopGenerating()
  }

  get attempts() {
    return this.#workerData[ATTEMPTS]
  }

  set attempts(value) {
    Atomics.store(this.#workerDataLive, +ATTEMPTS, value)
    this.#workerData[ATTEMPTS] = value
  }

  get success() {
    return this.#workerData[SUCCESSES]
  }

  set success(value) {
    Atomics.store(this.#workerDataLive, +SUCCESSES, value)
    this.#workerData[SUCCESSES] = value
  }

  /**
   * Creates a SharedArrayBuffer that is aligned to the CPU's cache line size to prevent false sharing.
   *
   * @param elements - The number of elements in the array.
   * @param arrayBufferView - The typed array constructor to determine the size of each element.
   * @returns A SharedArrayBuffer that is aligned to the CPU's cache line size.
   */
  sab(
    elements: number,
    arrayConstructor: { readonly BYTES_PER_ELEMENT: number }
  ): SharedArrayBuffer {
    return new SharedArrayBuffer(alignToCacheLine(elements, arrayConstructor) * this.#threads)
  }

  async snapshot() {
    // Atomics.store(this.#sharedLive, LOCK, 1)

    // do {
    // await scheduler.yield()
    // } while (this.#sharedLive[WRITERS])

    const workerCount = this.#workers.length

    // Accumulators
    this.#workerData[ATTEMPTS] = 0
    this.#workerData[SUCCESSES] = 0

    for (let workerIdx = 0; workerIdx < workerCount; workerIdx++) {
      const workerDataOffset = this.#workerDataSegmentSize * workerIdx

      this.#workerData[ATTEMPTS] += this.#workerDataLive[workerDataOffset + ATTEMPTS]
      this.#workerData[SUCCESSES] += this.#workerDataLive[workerDataOffset + SUCCESSES]
    }

    this.#heatmap = Array(this.rows)
      .fill(0)
      .map((_, row) =>
        Array(this.cols)
          .fill(0)
          .map((_, col) => this.#heatmapLive[row * this.cols + col])
      )

    // Atomics.store(this.#sharedLive, LOCK, 0)
    // Atomics.notify(this.#sharedLive, LOCK)
  }

  getHeat(row: number, col: number): number {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) {
      throw new RangeError('cell coordinates out of bounds')
    }
    return this.#heatmap[row][col] / Math.max(1, this.success) // Normalize
  }

  getHeatRange(): { min: number; max: number } {
    let min = Infinity
    let max = -Infinity

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        // SUNK || HIT
        if (this.grid[row][col] & 3) continue

        const heat = this.#heatmap[row][col]
        if (heat < min) min = heat
        if (heat > max) max = heat
      }
    }

    // Normalize
    min /= Math.max(1, this.success)
    max /= Math.max(1, this.success)

    return { min, max }
  }

  getHotspots(minHotspotHeat: number): { row: number; col: number }[] {
    const hotspots: { row: number; col: number }[] = []

    if (!minHotspotHeat) return hotspots

    // Denormalize the comparator instead of normalizing each candidate
    minHotspotHeat *= Math.max(1, this.success)

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        // SUNK || HIT
        if (this.grid[row][col] & 3) continue

        if (this.#heatmap[row][col] >= minHotspotHeat) hotspots.push({ row, col })
      }
    }
    return hotspots
  }

  resize(rows: number, cols: number): void {
    super.resize(rows, cols)

    this.#heatmapLive = new Uint32Array(this.sab(this.rows * this.cols, Uint32Array))
    this.#heatmapSegmentSize = alignToCacheLine(this.rows * this.cols)

    this.attempts = 0
    this.success = 0
    this.jobData = null
  }

  reset(): void {
    super.reset()
    this.resetHeatmap()
  }

  resetHeatmap(): void {
    for (let i = 0; i < this.#heatmapLive.length; i++) {
      this.#heatmapLive[i] = 0
    }
    this.attempts = 0
    this.success = 0
    this.jobData = null
  }

  #createWorker(workerIndex: number): Worker {
    if (this.#workers[workerIndex]) return this.#workers[workerIndex]

    const scriptURL = new URL('../worker/generateConfig.ts', import.meta.url)
    const worker = new Worker(scriptURL, { type: 'module' })
    const sharedData: SharedData = {
      threadIndex: workerIndex,
      mainDataBuffer: this.#mainDataLive.buffer,
      workerDataBuffer: this.#workerDataLive.buffer,
      heatmapBuffer: this.#heatmapLive.buffer,
      workerDataSegmentSize: this.#workerDataSegmentSize,
      heatmapSegmentSize: this.#heatmapSegmentSize,
    }
    worker.postMessage(sharedData)

    this.#workers.push(worker)
    return worker
  }

  #startGenerating() {
    this.#generating = true
    this.generationStartTs = performance.now()
    this.resetHeatmap()

    this.jobData = {
      id: Atomics.load(this.#mainDataLive, +JOB_ID),
      rows: this.rows,
      cols: this.cols,
      boatLengths: this.boatLengths,
      boatsSunken: this.boatsSunken,
      allowTouching: this.allowTouching,
      grid: this.grid,
    }

    for (let workerIndex = 0; workerIndex < this.#threads; workerIndex++)
      this.#createWorker(workerIndex).postMessage({ ...this.jobData })

    // Keep generating until timeout expires
    this.generationTimeoutId = setTimeout(() => {
      this.generating = false
      this.#onFinishGenerating()
    }, this.generationSeconds * 1000)

    this.#onStartGenerating()
  }

  #stopGenerating() {
    this.#generating = false

    this.jobData = null

    // Stop workers
    Atomics.add(this.#mainDataLive, +JOB_ID, 1)

    clearTimeout(this.generationTimeoutId)

    this.#onStopGenerating()
  }
}
