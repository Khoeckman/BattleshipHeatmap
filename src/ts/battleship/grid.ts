type BoatsSunkenInfo = { boat: number; total: number; sunken: number }

export default class BattleshipGrid {
  public static readonly EMPTY = 0
  public static readonly SUNK = 1
  public static readonly HIT = 2
  public static readonly MISS = 3

  #rows = 0
  #cols = 0
  #boats: number[] = []

  /**
   * Array of the lengths of the boats that are sunken
   * based on adjacent cells with value SUNK
   */
  #boatsSunken: number[] = []
  #boatsSunkenValid: true | BoatsSunkenInfo = true

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
  #grid: number[][] = []

  constructor(
    rows: number,
    cols: number,
    boatLengths: number[],
    allowTouching: boolean,
    grid: number[][] = []
  ) {
    this.rows = rows
    this.cols = cols
    this.boats = boatLengths
    this.allowTouching = allowTouching

    if (grid.length) {
      this.grid = grid
      this.updateBoatsSunken()
    } else {
      this.grid = Array(this.rows)
        .fill(0)
        .map(() => Array(this.cols).fill(0))
    }
  }

  get rows(): number {
    return this.#rows
  }

  set rows(value: number) {
    if (!(value >= 1 && value <= 26)) {
      throw new RangeError('grid dimensions must be between 1 and 26')
    }
    this.#rows = value
  }

  get cols(): number {
    return this.#cols
  }

  set cols(value: number) {
    if (!(value >= 1 && value <= 26)) {
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

  get boatsSunken(): number[] {
    return this.#boatsSunken
  }

  get boatsSunkenValid(): true | BoatsSunkenInfo {
    return this.#boatsSunkenValid
  }

  get allowTouching(): boolean {
    return this.#allowTouching
  }

  set allowTouching(value: boolean) {
    this.#allowTouching = !!value
  }

  get grid(): number[][] {
    return this.#grid
  }

  set grid(value: number[][]) {
    if (
      !Array.isArray(value) ||
      !value.every((row) => row.every((cell) => cell >= 0 && cell <= 3))
    ) {
      throw new TypeError('grid must be a two-dimensional array with numbers between 0 and 3')
    }
    if (value.length !== this.rows || !value.every((row) => row.length === this.cols)) {
      throw new RangeError('grid dimensions must match rows and cols')
    }
    this.#grid = value
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
    this.rows = rows
    this.cols = cols

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
    this.grid = newGrid
  }

  reset(): void {
    for (let row in this.grid) {
      for (let col in this.grid[row]) {
        this.grid[row][col] = 0
      }
    }
  }

  findCorner(...values: number[]): { row: number; col: number } | false {
    for (let row = 0; row < this.rows - 1; row++) {
      for (let col = 0; col < this.cols - 1; col++) {
        if (
          values.includes(this.grid[row][col]) &&
          values.includes(this.grid[row + 1][col]) &&
          values.includes(this.grid[row][col + 1])
        )
          return { row, col }
      }
    }
    return false
  }

  updateBoatsSunken(): void {
    this.#boatsSunken = []

    if (this.allowTouching) {
      return // TODO: find out how to do it when allow touching is on
    } else {
      if (this.findCorner(BattleshipGrid.SUNK, BattleshipGrid.HIT)) return

      let boat = 0

      for (let row = 0; row < this.rows; row++) {
        for (let col = 0; col < this.cols; col++) {
          const value = this.grid[row][col]

          if (value === BattleshipGrid.SUNK) {
            boat++
          } else if (boat) {
            this.#boatsSunken.push(boat)
            boat = 0
          }
        }
      }

      for (let col = 0; col < this.cols; col++) {
        for (let row = 0; row < this.rows; row++) {
          const value = this.grid[row][col]

          if (value === BattleshipGrid.SUNK) {
            boat++
          } else if (boat) {
            this.#boatsSunken.push(boat)
            boat = 0
          }
        }
      }
    }

    // Update boatsSunkenValid
    this.#boatsSunkenValid = true
    const boatsSet = new Set(this.#boats)

    for (const boat of boatsSet) {
      const boatAmount = this.#boats.filter((b) => b === boat).length
      const boatSunkenAmount = this.#boatsSunken.filter((b) => b === boat).length

      if (boatSunkenAmount > boatAmount) {
        this.#boatsSunkenValid = { boat, total: boatAmount, sunken: boatSunkenAmount }
        break
      }
    }
  }
}
