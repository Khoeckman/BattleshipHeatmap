import BattleshipGrid from './grid'
import BattleshipHeatmap from './heatmap'

export default class BattleshipIO {
  private static CLUE_TEXT: { [key: number]: string } = {
    0: 'empty',
    1: 'sunk',
    2: 'hit',
    3: 'miss',
  }

  private static CLUE_SYMBOL: { [key: number]: string } = {
    0: '',
    1: 'S',
    2: 'H',
    3: '~',
  }

  public container: Element
  public heatmap: BattleshipHeatmap
  public cursor = { row: 0, col: 0 }

  constructor(container: HTMLElement, heatmap: BattleshipHeatmap) {
    if (!(container instanceof HTMLElement)) {
      throw new TypeError('container must be an instance of HTMLElement')
    }
    this.container = container

    if (!(heatmap instanceof BattleshipHeatmap)) {
      throw new TypeError('heatmap must be an instance of BattleshipHeatmap')
    }
    this.heatmap = heatmap

    this.#handleClick.bind(this)
    this.#handleKeyDown.bind(this)

    container.addEventListener('click', this.#handleClick.bind(this))
    window.addEventListener('keydown', this.#handleKeyDown.bind(this))

    this.renderGrid()
  }

  renderGrid(): void {
    this.container.innerHTML = ''

    for (let row = 0; row < this.heatmap.rows; row++) {
      const rowEl = document.createElement('div')
      rowEl.classList.add('row')

      for (let col = 0; col < this.heatmap.cols; col++) {
        const cellEl = document.createElement('div')
        const cellValue = BattleshipIO.CLUE_TEXT[this.heatmap.getCell(row, col)]

        cellEl.textContent = BattleshipIO.CLUE_SYMBOL[this.heatmap.getCell(row, col)]
        cellEl.classList.add('cell', cellValue)
        cellEl.dataset.row = String(row)
        cellEl.dataset.col = String(col)

        rowEl.appendChild(cellEl)
      }
      this.container.appendChild(rowEl)
    }

    // Should be rerendered because this function destroyed the cell with the 'cursor' class
    this.renderCursor()
  }

  renderCursor(): void {
    const rows = [...this.container.children]

    rows.forEach((rowEl) => {
      const cells = [...rowEl.children]

      cells.forEach((cell) => {
        cell.classList.remove('cursor')
      })
    })

    this.cursor.row = Math.max(0, Math.min(this.cursor.row, this.heatmap.rows - 1))
    this.cursor.col = Math.max(0, Math.min(this.cursor.col, this.heatmap.cols - 1))

    const cursorEl = this.container.querySelector(
      `.cell[data-row="${this.cursor.row}"][data-col="${this.cursor.col}"]`
    )!
    // Should error if null as it should never happen
    cursorEl.classList.add('cursor')
  }

  setCursor(row: number, col: number): void {
    if (row < 0 || row >= this.heatmap.rows || col < 0 || col >= this.heatmap.cols) return

    this.cursor.row = row
    this.cursor.col = col
    this.renderCursor()
  }

  moveCursor(dRow: number, dCol: number): void {
    this.setCursor(this.cursor.row + dRow, this.cursor.col + dCol)
  }

  resizeGrid(rows: number, cols: number): void {
    this.heatmap.resize(rows, cols)
    this.renderGrid()
  }

  clearGrid(): void {
    const { rows, cols, boats, allowTouching, generationSeconds } = this.heatmap
    this.heatmap = new BattleshipHeatmap(new BattleshipGrid(rows, cols, boats, allowTouching), generationSeconds)
    this.renderGrid()
  }

  #handleClick(e: PointerEvent): void {
    const target = e.target as HTMLElement

    // Event delegation
    if (!target.classList.contains('cell') || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()

    this.setCursor(+target.dataset.row!, +target.dataset.col!)
  }

  #handleKeyDown(e: KeyboardEvent): void {
    if (document.activeElement !== document.body) return

    let preventDefault = true
    const { row, col } = this.cursor

    switch (e.key) {
      case 'ArrowUp':
        this.moveCursor(-1, 0)
        break

      case 'ArrowRight':
        this.moveCursor(0, 1)
        break

      case 'ArrowLeft':
        this.moveCursor(0, -1)
        break

      case 'ArrowDown':
        this.moveCursor(1, 0)
        break

      case 'x':
      case 'Backspace':
        this.heatmap.setCell(row, col, BattleshipHeatmap.EMPTY)
        this.renderGrid()
        break
      case 's':
        this.heatmap.setCell(row, col, BattleshipHeatmap.SUNK)
        // Extra: automatically mark all adjacent HIT's as SUNK using a recursive io function
        this.renderGrid()
        break
      case 'h':
        this.heatmap.setCell(row, col, BattleshipHeatmap.HIT)
        this.renderGrid()
        break
      case 'm':
      case 'w':
        this.heatmap.setCell(row, col, BattleshipHeatmap.MISS)
        this.renderGrid()
        break
      default:
        preventDefault = false
    }

    if (preventDefault) e.preventDefault()
  }
}
