export default class BattleshipGrid {
  #rows = 0
  #cols = 0
  #boats: number[] = []
  #allowTouching = false

  /**
   * Represents the game grid
   *
   * Each cell in the grid can have the following values:
   * 0 = empty (no info)
   * 1 = sunk (sunken ship)
   * 2 = hit (un sunk ship)
   * 3 = miss (water)
   */
  public grid: number[][] = []

  constructor(rows: number, cols: number, boatLengths: number[], allowTouching: boolean) {
    this.rows = rows
    this.cols = cols
    this.boats = boatLengths
    this.allowTouching = allowTouching

    this.grid = Array(this.rows)
      .fill(0)
      .map(() => Array(this.cols).fill(0))
  }

  get rows(): number {
    return this.#rows
  }

  set rows(value: number) {
    if (value < 1 || value > 26) {
      throw new RangeError('grid dimensions must be between 1 and 26')
    }
    this.#rows = value
  }

  get cols(): number {
    return this.#cols
  }

  set cols(value: number) {
    if (value < 1 || value > 26) {
      throw new RangeError('grid dimensions must be between 1 and 26')
    }
    this.#cols = value
  }

  get boats(): number[] {
    return this.#boats
  }

  set boats(value: number[]) {
    if (!Array.isArray(value) || !value.every((length) => length > 0 && length <= 26)) {
      throw new RangeError('boatLengths must be an array of numbers between 1 and 26')
    }
    if (!value.length) {
      throw new RangeError('boatLengths must contain at least one boat')
    }
    this.#boats = [...value].sort((a, b) => b - a)
  }

  get allowTouching(): boolean {
    return this.#allowTouching
  }

  set allowTouching(value: boolean) {
    this.#allowTouching = !!value
  }

  getCell(row: number, col: number): number {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) {
      throw new RangeError('cell coordinates out of bounds')
    }
    return this.grid[row][col]
  }

  setCell(row: number, col: number, value: number): void {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) {
      throw new RangeError('cell coordinates out of bounds')
    }
    this.grid[row][col] = value
  }

  resize(rows: number, cols: number): void {
    const newGrid = Array(rows)
      .fill(0)
      .map(() => Array(cols).fill(0))

    // Copy old grid onto new grid
    for (let row in this.grid) {
      if (+row >= rows) break

      for (let col in this.grid[row]) {
        if (+col >= cols) break
        newGrid[row][col] = this.grid[row][col]
      }
    }

    this.rows = rows
    this.cols = cols
    this.grid = newGrid
  }
}
