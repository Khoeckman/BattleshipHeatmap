import BattleshipGrid, { type Boat } from './grid'

export type GenerationJobData = {
  rows: number
  cols: number
  boatLengths: number[]
  boatsSunken: Boat[]
  allowTouching: boolean
  grid: number[][]
}

type GenerationJobResultData = Boat[] | false

export default class BattleshipHeatmap extends BattleshipGrid {
  /** The number of attempts to generate a valid configuration */
  public attempts = 0

  /** The number of valid configurations accumulated to produce the heatmap */
  public accumulated = 0

  /** Information about the current generation job to keep workers from reading too new data or writing outdated results. */
  public jobData: GenerationJobData | null = null

  /**
   * Represents the heatmap grid
   *
   * The value in each cell represents the total number of times a boat crossed
   * through that cell inside of a randomly found valid configuration.
   */
  public heatmap: number[][] = []

  #generating = true
  public generationSeconds: number
  public generationTimeoutId: number = -1
  public generationStartTs: number = 0

  #onStartGenerating: () => void
  #onStopGenerating: () => void

  constructor(
    grid: BattleshipGrid,
    generationSeconds: number,
    onStartGenerating: () => void,
    onStopGenerating: () => void
  ) {
    if (!(grid instanceof BattleshipGrid)) {
      throw new TypeError('grid must be an instance of BattleshipGrid')
    }
    super(grid.rows, grid.cols, grid.boatLengths, grid.allowTouching, grid.grid)
    this.onChange = () => (this.generating = false)

    this.heatmap = Array(this.rows)
      .fill(0)
      .map(() => Array(this.cols).fill(0))

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
  }

  get generating() {
    return this.#generating
  }

  set generating(value: boolean) {
    this.#generating = value

    if (value) {
      this.#onStartGenerating()
    } else {
      clearTimeout(this.generationTimeoutId)
      this.#onStopGenerating()
    }
  }

  getHeat(row: number, col: number): number {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) {
      throw new RangeError('cell coordinates out of bounds')
    }
    return this.heatmap[row][col] / Math.max(1, this.accumulated) // Normalize
  }

  getHeatRange(): { min: number; max: number } {
    let min = Infinity
    let max = -Infinity

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        // SUNK || HIT
        if (this.grid[row][col] & 3) continue

        const heat = this.heatmap[row][col]
        if (heat < min) min = heat
        if (heat > max) max = heat
      }
    }

    // Normalize
    min /= Math.max(1, this.accumulated)
    max /= Math.max(1, this.accumulated)

    return { min, max }
  }

  getHotspots(minHotspotHeat: number): { row: number; col: number }[] {
    const hotspots: { row: number; col: number }[] = []

    if (!minHotspotHeat) return hotspots

    // Denormalize the comparator instead of normalizing each candidate
    minHotspotHeat *= Math.max(1, this.accumulated)

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        // SUNK || HIT
        if (this.grid[row][col] & 3) continue

        if (this.heatmap[row][col] >= minHotspotHeat) hotspots.push({ row, col })
      }
    }
    return hotspots
  }

  resize(rows: number, cols: number): void {
    super.resize(rows, cols)

    this.heatmap = Array(rows)
      .fill(0)
      .map(() => Array(cols).fill(0))

    this.attempts = 0
    this.accumulated = 0
    this.jobData = null
  }

  reset(): void {
    super.reset()
    this.resetHeatmap()
  }

  resetHeatmap(): void {
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        this.heatmap[row][col] = 0
      }
    }
    this.attempts = 0
    this.accumulated = 0
    this.jobData = null
  }

  /**
   * Add the values of two heatmaps of the same size together.
   *
   * @param other The other heatmap to accumulate onto the current
   */
  accumulateHeatmap(other: number[][]): void {
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        this.heatmap[row][col] += other[row][col]
      }
    }
    this.accumulated++
  }

  accumulateBoats(boats: Boat[]): void {
    for (const boat of boats) {
      BattleshipGrid.forEachBoatSegment(boat, (row, col) => {
        this.heatmap[row][col]++
      })
    }
    this.accumulated++
  }

  /**
   * Calculate a heatmap by accumulating many random valid configurations.
   */
  startGenerating(onGeneratingComplete?: () => void): void {
    if (this.#generating) return

    this.generating = true
    this.generationStartTs = performance.now()
    this.resetHeatmap()

    this.jobData = {
      rows: this.rows,
      cols: this.cols,
      boatLengths: this.boatLengths,
      boatsSunken: this.boatsSunken,
      allowTouching: this.allowTouching,
      grid: this.grid,
    }

    // Keep generating until timeout fires
    this.generationTimeoutId = setTimeout(() => {
      this.generating = false
      onGeneratingComplete?.()
    }, this.generationSeconds * 1000)

    for (let t = 0; t < navigator.hardwareConcurrency; t++) this.#startWorker()
  }

  async #startWorker(): Promise<void> {
    const worker = new Worker(new URL('../worker/generateConfig.ts', import.meta.url), {
      type: 'module',
    })
    const jobData = this.jobData

    worker.onmessage = (e: MessageEvent<GenerationJobResultData>) => {
      const isRelevantJob = this.jobData && this.jobData === jobData

      if (isRelevantJob) {
        if (e.data) this.accumulateBoats(e.data)
        this.attempts++
      }

      if (!this.#generating || !isRelevantJob) worker.terminate()
    }

    worker.postMessage({ ...jobData })
  }
}
