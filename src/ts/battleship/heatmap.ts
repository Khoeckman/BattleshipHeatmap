import BattleshipGrid, { type Boat } from './grid'

export type GenerationJobData = {
  rows: number
  cols: number
  boatLengths: number[]
  boatsSunken: Boat[]
  allowTouching: boolean
  grid: number[][]
  heatmapBuffer: SharedArrayBuffer
  countersBuffer: SharedArrayBuffer
}

// type GenerationJobResultData = Boat[] | false

export default class BattleshipHeatmap extends BattleshipGrid {
  /** Information about the current generation job to keep workers from reading too new data or writing outdated results. */
  public jobData: GenerationJobData | null = null

  /**
   * Represents the heatmap grid
   *
   * The value in each cell represents the total number of times a boat crossed
   * through that cell inside of a randomly found valid configuration.
   */
  #heatmap: Uint32Array<SharedArrayBuffer>

  /**
   * Counter 0 - Attempts - The number of attempts to generate a valid configuration.
   * Counter 1 - Accumulated - The number of valid configurations accumulated to produce the heatmap.
   */
  #counters: Uint32Array<SharedArrayBuffer> = new Uint32Array(new SharedArrayBuffer(2 * 4))

  /**
   * Store references to all active workers so they can be terminated from the main-thread.
   */
  #workers: Worker[] = []

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

    this.#heatmap = new Uint32Array(new SharedArrayBuffer(this.rows * this.cols * 4)) // 4 bytes per cell

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
  }

  get generating() {
    return this.#generating
  }

  set generating(value: boolean) {
    if (this.#generating === value) return

    this.#stopWorkers()

    if (value) {
      this.#generating = true
      this.generationStartTs = performance.now()
      this.resetHeatmap()

      this.jobData = {
        rows: this.rows,
        cols: this.cols,
        boatLengths: this.boatLengths,
        boatsSunken: this.boatsSunken,
        allowTouching: this.allowTouching,
        grid: this.grid,
        heatmapBuffer: this.#heatmap.buffer,
        countersBuffer: this.#counters.buffer,
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
    return this.#counters[0]
  }

  set attempts(value) {
    this.#counters[0] = value
  }

  get success() {
    return this.#counters[1]
  }

  set success(value) {
    this.#counters[1] = value
  }

  index(row: number, col: number): number {
    return row * this.cols + col
  }

  getHeat(row: number, col: number): number {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) {
      throw new RangeError('cell coordinates out of bounds')
    }
    return this.#heatmap[this.index(row, col)] / Math.max(1, this.success) // Normalize
  }

  getHeatRange(): { min: number; max: number } {
    let min = Infinity
    let max = -Infinity

    let i = 0

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++, i++) {
        // SUNK || HIT
        if (this.grid[row][col] & 3) continue

        const heat = this.#heatmap[i]
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

    let i = 0

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++, i++) {
        // SUNK || HIT
        if (this.grid[row][col] & 3) continue

        if (this.#heatmap[i] >= minHotspotHeat) hotspots.push({ row, col })
      }
    }
    return hotspots
  }

  resize(rows: number, cols: number): void {
    super.resize(rows, cols)

    this.#heatmap = new Uint32Array(new SharedArrayBuffer(this.rows * this.cols * 4)) // 4 bytes per cell
    this.attempts = 0
    this.success = 0
    this.jobData = null
  }

  reset(): void {
    super.reset()
    this.resetHeatmap()
  }

  resetHeatmap(): void {
    for (let i = 0; i < this.#heatmap.length; i++) {
      this.#heatmap[i] = 0
    }
    this.attempts = 0
    this.success = 0
    this.jobData = null
  }

  #startWorker(): void {
    const worker = new Worker(new URL('../worker/generateConfig.ts', import.meta.url), {
      type: 'module',
    })
    this.#workers.push(worker)
    worker.postMessage({ ...this.jobData })
  }

  #stopWorkers(): void {
    for (const worker of this.#workers) worker.terminate()
    this.#workers = []
  }
}
