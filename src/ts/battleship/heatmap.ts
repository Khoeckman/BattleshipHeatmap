import BattleshipGrid from './grid'

export default class BattleshipHeatmap extends BattleshipGrid {
  public static readonly EMPTY = 0
  public static readonly SUNK = 1
  public static readonly HIT = 2
  public static readonly MISS = 3

  /** The number of valid configurations used to accumulate the heatmap */
  public accumulated: number = 0

  /**
   * Represents the heatmap grid
   *
   * The value in each cell represents the total number of times a boat crossed
   * through that cell inside of a randomly found valid configuration.
   */
  public heatmap: number[][] = []

  public generating = false
  public generationSeconds: number
  public generationTimeoutId: number = -1
  public generationStartTs: number = 0

  constructor(grid: BattleshipGrid, generationSeconds: number) {
    if (!(grid instanceof BattleshipGrid)) {
      throw new TypeError('grid must be an instance of BattleshipGrid')
    }
    super(grid.rows, grid.cols, grid.boats, grid.allowTouching, grid.grid)

    this.heatmap = Array(this.rows)
      .fill(0)
      .map(() => Array(this.cols).fill(0))

    this.generationSeconds = generationSeconds
  }

  /**
   * Get the heat value for a specific cell in the heatmap.
   *
   * @param row The row index of the cell.
   * @param cell The column index of the cell.
   * @returns The heat value for the specified cell.
   */
  getHeat(row: number, cell: number): number {
    if (row < 0 || row >= this.rows || cell < 0 || cell >= this.cols) {
      throw new RangeError('cell coordinates out of bounds')
    }
    return this.heatmap[row][cell] / Math.max(1, this.accumulated) // Normalize
  }

  resetHeatmap(): void {
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        this.heatmap[row][col] = 0
      }
    }
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
  startCalculating(): void {
    if (this.generating) return

    this.generating = true
    this.generationStartTs = performance.now()
    this.resetHeatmap()

    // Keep generating until timeout fires
    this.generationTimeoutId = setTimeout(() => {
      this.generating = false
    }, this.generationSeconds * 1000)

    for (let thread = 0; thread < navigator.hardwareConcurrency; thread++) this.#thread()
  }

  stopCalculating(): void {
    this.generating = false
    clearTimeout(this.generationTimeoutId)
  }

  async #thread(): Promise<void> {
    const worker = new Worker(new URL('../worker/generateConfig.ts', import.meta.url), { type: 'module' })

    worker.addEventListener('message', (e: MessageEvent<number[][]>) => {
      if (!this.generating) {
        worker.terminate()
        return
      }
      this.accumulateHeatmap(e.data)
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
  }
}
