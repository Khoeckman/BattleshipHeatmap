import BattleshipGrid, { type Boat } from './grid'

export type GenerationJobData = {
  id: number
  rows: number
  cols: number
  boatLengths: number[]
  boatsSunken: Boat[]
  allowTouching: boolean
  grid: number[][]
  heatmapBuffer: SharedArrayBuffer
  sharedBuffer: SharedArrayBuffer
}

// Shared data indices
const JOB_ID = 0
const ATTEMPTS = 1
const SUCCESS = 2
const LOCK = 3
const WRITERS = 4

export default class BattleshipHeatmap extends BattleshipGrid {
  /** Information about the current generation job to keep workers from reading too new data or writing outdated results. */
  public jobData: GenerationJobData | null = null

  /**
   * Represents the heatmap grid
   *
   * The value in each cell represents the total number of times a boat crossed
   * through that cell inside of a randomly found valid configuration.
   */
  #heatmapLive: Uint32Array<SharedArrayBuffer>
  #heatmap: number[][] = []

  /**
   * Shared data between the main thread and the workers
   *
   * 0 Job ID - If this ID does not match the ID of the worker (anymore) it means it should stop generating and close.
   * 1 Attempts - The number of attempts to generate a valid configuration.
   * 2 Accumulated - The number of valid configurations accumulated to produce the heatmap.
   * 3 Lock - Whether the workers are allowed to start writing to the SABs
   * 4 Writing - The amount of workers that are actively writing their results to the SABs
   */
  #sharedLive = new Int32Array(new SharedArrayBuffer(5 * Int32Array.BYTES_PER_ELEMENT))
  #shared: number[] = []

  #generating = false
  public generationSeconds: number
  public generationTimeoutId: number = -1
  public generationStartTs: number = 0

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

    this.#heatmapLive = new Uint32Array(
      new SharedArrayBuffer(this.rows * this.cols * Uint32Array.BYTES_PER_ELEMENT)
    )
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

    if (value) {
      this.#generating = true
      this.generationStartTs = performance.now()
      this.resetHeatmap()

      this.jobData = {
        id: Atomics.add(this.#sharedLive, JOB_ID, 1) + 1,
        rows: this.rows,
        cols: this.cols,
        boatLengths: this.boatLengths,
        boatsSunken: this.boatsSunken,
        allowTouching: this.allowTouching,
        grid: this.grid,
        heatmapBuffer: this.#heatmapLive.buffer,
        sharedBuffer: this.#sharedLive.buffer,
      }

      // Keep generating until timeout fires
      this.generationTimeoutId = setTimeout(() => {
        this.generating = false
        this.#onFinishGenerating()
      }, this.generationSeconds * 1000)

      for (let t = 0; t < navigator.hardwareConcurrency; t++) this.#startWorker()

      this.#onStartGenerating()
    } else {
      this.#generating = false
      clearTimeout(this.generationTimeoutId)
      this.#onStopGenerating()
    }
  }

  get attempts() {
    return this.#shared[ATTEMPTS]
  }

  set attempts(value) {
    Atomics.store(this.#sharedLive, ATTEMPTS, value)
    this.#shared[ATTEMPTS] = value
  }

  get success() {
    return this.#shared[SUCCESS]
  }

  set success(value) {
    Atomics.store(this.#sharedLive, SUCCESS, value)
    this.#shared[SUCCESS] = value
  }

  async snapshot() {
    Atomics.store(this.#sharedLive, LOCK, 1)

    do {
      await scheduler.yield()
    } while (this.#sharedLive[WRITERS])

    this.#shared[ATTEMPTS] = this.#sharedLive[ATTEMPTS]
    this.#shared[SUCCESS] = this.#sharedLive[SUCCESS]

    this.#heatmap = Array(this.rows)
      .fill(0)
      .map((_, row) =>
        Array(this.cols)
          .fill(0)
          .map((_, col) => this.#heatmapLive[row * this.cols + col])
      )

    Atomics.store(this.#sharedLive, LOCK, 0)
    Atomics.notify(this.#sharedLive, LOCK)
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

    this.#heatmapLive = new Uint32Array(
      new SharedArrayBuffer(this.rows * this.cols * Uint32Array.BYTES_PER_ELEMENT)
    )
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

  #startWorker(): void {
    const worker = new Worker(new URL('../worker/generateConfig.ts', import.meta.url), {
      type: 'module',
    })
    worker.postMessage({ ...this.jobData })
  }
}
