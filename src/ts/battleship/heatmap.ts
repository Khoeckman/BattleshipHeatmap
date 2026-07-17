import BattleshipGrid from './grid'

export default class BattleshipHeatmap extends BattleshipGrid {
  #threads = 0

  /** The number of attempts to generate a valid configuration */
  public attempts = 0

  /** The number of valid configurations used to accumulate the heatmap */
  public accumulated = 0

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

  public onStartCalculating: () => void
  public onStopCalculating: () => void

  constructor(
    grid: BattleshipGrid,
    generationSeconds: number,
    onStartCalculating: () => void,
    onStopCalculating: () => void
  ) {
    if (!(grid instanceof BattleshipGrid)) {
      throw new TypeError('grid must be an instance of BattleshipGrid')
    }
    super(grid.rows, grid.cols, grid.boats, grid.allowTouching, grid.grid)

    this.heatmap = Array(this.rows)
      .fill(0)
      .map(() => Array(this.cols).fill(0))

    if (!Number.isFinite(generationSeconds)) {
      throw new TypeError('generationSeconds must be a finite number')
    }
    this.generationSeconds = generationSeconds

    if (typeof onStartCalculating !== 'function') {
      throw new TypeError('onStartCalculating must be a function')
    }
    this.onStartCalculating = onStartCalculating

    if (typeof onStopCalculating !== 'function') {
      throw new TypeError('onStopCalculating must be a function')
    }
    this.onStopCalculating = onStopCalculating
  }

  get generating(): boolean {
    return this.#generating
  }

  set generating(value: boolean) {
    this.#generating = value
    if (value) {
      this.onStartCalculating()
      return
    }
    clearTimeout(this.generationTimeoutId)
    this.onStopCalculating()
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
        const value = this.grid[row][col]
        if (value === BattleshipHeatmap.SUNK || value === BattleshipHeatmap.HIT) continue

        const heat = this.heatmap[row][col]
        if (heat < min) min = heat
        else if (heat > max) max = heat
      }
    }

    // This is more efficient than changing the if-else to an if-if
    if (min < Infinity && max === -Infinity) max = min

    // Normalize
    min = min / Math.max(1, this.accumulated)
    max = max / Math.max(1, this.accumulated)

    return { min, max }
  }

  getHotspots(minHotspotHeat: number): { row: number; col: number }[] {
    const hotspots: { row: number; col: number }[] = []

    if (!minHotspotHeat) return hotspots

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const value = this.grid[row][col]
        if (value === BattleshipHeatmap.SUNK || value === BattleshipHeatmap.HIT) continue

        const heat = this.heatmap[row][col] / Math.max(1, this.accumulated)
        if (heat >= minHotspotHeat) hotspots.push({ row, col })
      }
    }
    return hotspots
  }

  resize(rows: number, cols: number): void {
    super.resize(rows, cols)

    this.heatmap = Array(rows)
      .fill(0)
      .map(() => Array(cols).fill(0))
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

  /**
   * Calculate a heatmap by accumulating many random valid configurations.
   */
  startGenerating(onCalculatingTimeout?: () => void): void {
    if (this.#generating) return

    this.generating = true
    this.generationStartTs = performance.now()
    this.resetHeatmap()

    // Keep generating until timeout fires
    this.generationTimeoutId = setTimeout(() => {
      this.generating = false
      onCalculatingTimeout?.()
    }, this.generationSeconds * 1000)

    for (; this.#threads < navigator.hardwareConcurrency; this.#threads++) this.#thread()
  }

  async #thread(): Promise<void> {
    const worker = new Worker(new URL('../worker/generateConfig.ts', import.meta.url), {
      type: 'module',
    })

    worker.addEventListener('message', (e: MessageEvent<number[][] | false>) => {
      if (e.data) this.accumulateHeatmap(e.data)

      if (!this.#generating) {
        worker.terminate()
        this.#threads--
        return
      }
      this.#generateConfig(worker)
    })
    this.#generateConfig(worker)
  }

  #generateConfig(worker: Worker): void {
    worker.postMessage({
      rows: this.rows,
      cols: this.cols,
      boats: this.boats,
      allowTouching: this.allowTouching,
      grid: this.grid,
    })
    this.attempts++
  }
}
