import BattleshipGrid from './grid'
import awaitWorker from '../worker/awaitWorker'

export default class BattleshipHeatmap extends BattleshipGrid {
  public static readonly EMPTY = 0
  public static readonly SUNK = 1
  public static readonly HIT = 2
  public static readonly MISS = 3

  /** The number of valid configurations used to accumulate the heatmap */
  private validConfigs: number = 0

  /**
   * Represents the heatmap grid
   *
   * The value in each cell represents the total number of times a boat crossed
   * through that cell inside of a randomly found valid configuration.
   */
  private heatmap: number[][] = []

  public generating = false
  public generationSeconds: number
  public generationTimeoutId: number | null = null

  constructor(grid: BattleshipGrid, generationSeconds: number) {
    if (!(grid instanceof BattleshipGrid)) {
      throw new TypeError('grid must be an instance of BattleshipGrid')
    }
    super(grid.rows, grid.cols, grid.boats, grid.allowTouching)

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
    return this.heatmap[row][cell] / Math.max(1, this.validConfigs) // Normalize by the number of valid configurations
  }

  /**
   * Add the values of two heatmaps of the same size together.
   *
   * @param other The other heatmap to accumulate onto the current
   */
  accumulateHeatmap(other: BattleshipHeatmap): void {
    if (this.rows !== other.rows || this.cols !== other.cols) {
      throw new Error('heatmaps must have the same dimensions to accumulate')
    }

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        this.heatmap[row][col] += other.heatmap[row][col]
      }
    }
  }

  /**
   * Calculate a heatmap by accumulating many random valid configurations.
   */
  async calculateHeatmap(): Promise<void> {
    this.generating = true

    // Keep generating until timeout fires
    this.generationTimeoutId = setTimeout(() => {
      this.generating = false
    }, this.generationSeconds * 1000)

    for (let thread = 0; thread < navigator.hardwareConcurrency; thread++) this.#thread()
  }

  async #thread(): Promise<void> {
    while (this.generating) await this.#generateConfig()
  }

  /**
   * Generate a random valid configuration of boats on the grid.
   *
   * @returns A BattleshipHeatmap representing a valid configuration of boats on
   *          the grid, or false the generated configuration is invalid.
   */
  async #generateConfig(): Promise<void> {
    const heatmap = new BattleshipHeatmap(this, this.generationSeconds)

    const worker = new Worker(new URL('../worker/generateConfig.ts', import.meta.url), { type: 'module' })
    worker.postMessage(heatmap)

    const config = await awaitWorker<number[][] | false>(worker)
    if (!config) return

    heatmap.heatmap = config
    this.accumulateHeatmap(heatmap)
  }
}
