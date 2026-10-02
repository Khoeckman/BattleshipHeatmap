export type Boat = { length: number; row: number; col: number; vertical: boolean }
export type PlaceableBoat = Boat & { readonly __placeableBoat: unique symbol }
export type BoatsTooManyError = { boat: Boat; total: number; sunken: number }

export default class BattleshipGrid {
  public static readonly EMPTY = 0
  public static readonly MISS = 1
  public static readonly HIT = 2
  public static readonly SUNK = 4
  public static readonly SUNK_TOP = 8
  public static readonly SUNK_LEFT = 16
  public static readonly SUNK_BOTTOM = 32
  public static readonly SUNK_RIGHT = 64

  public static readonly MAX_ROWS = 26
  public static readonly MAX_COLS = 26
  public static readonly MAX_LENGTH = Math.max(this.MAX_ROWS, this.MAX_COLS)

  // Binairy flag filters
  public static readonly anySunkFilter = ~BattleshipGrid.SUNK + 1 // SUNK || SUNK_*
  public static readonly hitOrSunkFilter = BattleshipGrid.HIT | BattleshipGrid.anySunkFilter
  public static readonly missOrSunkFilter = BattleshipGrid.MISS | BattleshipGrid.anySunkFilter

  #rows = 0
  #cols = 0
  #boatLengths: number[] = []

  /**
   * Array of information about the boats that are sunken
   * based on adjacent cells with value SUNK
   */
  #boatsSunken: Boat[] = []

  #allowTouching = false

  /**
   * Represents the game grid
   *
   * Each cell in the grid can have the following values:
   * 0 = empty (no info)
   * 1 = sunk (sunken ship)
   * 2 = hit (un sunk ship)
   * 4 = miss (water)
   */
  #grid: number[][] = []

  #onChange: (() => void) | null = null

  constructor(rows: number, cols: number, boatLengths: number[], allowTouching: boolean, grid: number[][] = []) {
    this.rows = rows
    this.cols = cols
    this.boatLengths = boatLengths
    this.allowTouching = allowTouching

    if (grid.length) {
      this.grid = grid
    } else {
      this.grid = Array(this.rows)
        .fill(0)
        .map(() => Array(this.cols).fill(0))
    }
  }

  get rows() {
    return this.#rows
  }

  private set rows(value: number) {
    if (!(value >= 1 && value <= BattleshipGrid.MAX_ROWS)) {
      throw new RangeError('grid dimensions must be between 1 and ' + BattleshipGrid.MAX_ROWS)
    }
    this.#rows = value
  }

  get cols() {
    return this.#cols
  }

  private set cols(value: number) {
    if (!(value >= 1 && value <= BattleshipGrid.MAX_COLS)) {
      throw new RangeError('grid dimensions must be between 1 and ' + BattleshipGrid.MAX_COLS)
    }
    this.#cols = value
  }

  get boatLengths() {
    return this.#boatLengths
  }

  set boatLengths(value: number[]) {
    if (!Array.isArray(value) || !value.every((length) => length > 0 && length <= BattleshipGrid.MAX_LENGTH)) {
      throw new RangeError('boatLengths must be an array of numbers between 1 and ' + BattleshipGrid.MAX_LENGTH)
    }
    if (!value.length) {
      throw new RangeError('boatLengths must contain at least one boat')
    }
    this.#boatLengths = [...value].sort((a, b) => b - a)
    this.#onChange?.()
  }

  get boatsSunken() {
    return this.#boatsSunken
  }

  get allowTouching() {
    return this.#allowTouching
  }

  set allowTouching(value) {
    this.#allowTouching = !!value
    this.#onChange?.()
  }

  get grid() {
    return this.#grid
  }

  set grid(value: number[][]) {
    if (
      !Array.isArray(value) ||
      !value.every((row) => row.every((cell) => Math.log2(cell) === Math.floor(Math.log2(cell))))
    ) {
      throw new TypeError('grid must be a two-dimensional array where each value must be a power of 2')
    }
    if (value.length !== this.#rows || !value.every((row) => row.length === this.#cols)) {
      throw new RangeError('grid dimensions must match rows and cols')
    }
    this.#grid = value
    this.updateBoatsSunken()
    this.#onChange?.()
  }

  set onChange(value: (() => void) | null) {
    if (value && typeof value !== 'function') {
      throw new TypeError('onChange must be a function')
    }
    this.#onChange = value
  }

  getCell(row: number, col: number): number {
    if (row < 0 || row >= this.#rows || col < 0 || col >= this.#cols) {
      throw new RangeError('cell coordinates out of bounds')
    }
    return this.#grid[row][col]
  }

  setCell(row: number, col: number, value: number): void {
    if (row < 0 || row >= this.#rows || col < 0 || col >= this.#cols) {
      throw new RangeError('cell coordinates out of bounds')
    }
    this.#grid[row][col] = value
    this.#onChange?.()
  }

  resize(rows: number, cols: number): void {
    this.rows = rows
    this.cols = cols

    const grid = Array(rows)
      .fill(0)
      .map(() => Array(cols).fill(0))

    // Copy old grid onto new grid
    for (let row in this.grid) {
      if (+row >= rows) break

      for (let col in this.grid[row]) {
        if (+col >= cols) break
        grid[row][col] = this.grid[row][col]
      }
    }
    this.#grid = grid
    this.updateBoatsSunken()
    this.#onChange?.()
  }

  reset(): void {
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        this.#grid[row][col] = 0
      }
    }
    this.updateBoatsSunken()
    this.#onChange?.()
  }

  /**
   * Looks for a corner in the grid.
   *
   * Example of a corner made out of hits (H):
   * X H X
   * X H H
   * X X X
   *
   * @param values OR-relation between allowed values to form a corner.
   * @returns The position of the first corner made out of `values` or false if none were found.
   */
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

  // TODO: this must be converted to a util only function, Error part should be moved to io.
  // Util function should return an array of boats only

  updateBoatsSunken(): BoatsTooManyError | void {
    this.#boatsSunken = []

    const usedCells = new Set<string>()

    if (this.findCorner(BattleshipGrid.SUNK, BattleshipGrid.HIT)) return

    let row
    let col
    let boat: Boat | null = null

    // Scan horizontally
    for (row = 0; row < this.rows; row++) {
      for (col = 0; col < this.cols; col++) {
        const value = this.grid[row][col]

        const valueAbove = row === 0 ? NaN : this.grid[row - 1][col]
        const valueBelow = row === this.rows - 1 ? NaN : this.grid[row + 1][col]

        if (value === BattleshipGrid.SUNK && valueAbove !== BattleshipGrid.SUNK && valueBelow !== BattleshipGrid.SUNK) {
          if (!boat) boat = { length: 1, row, col, vertical: false }
          else boat.length++

          usedCells.add(row + ',' + col)
        } else if (boat) {
          this.boatsSunken.push(boat)
          boat = null

          usedCells.add(row + ',' + col)
        }
      }

      if (boat) {
        this.boatsSunken.push(boat)
        boat = null
        usedCells.add(row + ',' + col)
      }
    }

    // Scan vertically
    for (col = 0; col < this.cols; col++) {
      for (row = 0; row < this.rows; row++) {
        const value = this.grid[row][col]

        // Check if this cell has already been used for a boat in the other orientation
        if (usedCells.has(row + ',' + col)) continue

        if (value === BattleshipGrid.SUNK) {
          if (!boat) boat = { length: 1, row, col, vertical: true }
          else boat.length++
        } else if (boat) {
          this.boatsSunken.push(boat)
          boat = null
        }
      }

      if (boat) {
        this.boatsSunken.push(boat)
        boat = null
      }
    }

    // Update boatsSunkenValid
    const boatsSet = new Set(this.boatsSunken)

    for (const boat of boatsSet) {
      const boatsTotal = this.boatLengths.filter((length) => length === boat.length).length
      const boatsSunken = this.boatsSunken.filter((b) => b.length === boat.length).length

      if (boatsSunken > boatsTotal) return { boat, total: boatsTotal, sunken: boatsSunken }
    }
  }
}
