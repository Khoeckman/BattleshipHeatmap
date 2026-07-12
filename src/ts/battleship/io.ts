import HyperStorage from 'hyperstorage-js'

import BattleshipGrid from './grid'
import BattleshipHeatmap from './heatmap'
import type { Settings } from '../settingsStore'

export type DataElements = {
  threadsData: HTMLElement
  timeData: HTMLElement
  attemptsData: HTMLElement
  configsData: HTMLElement
}

type HeatCache = {
  els: HTMLElement[][]
  state: string[][]
}

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

  private static BOAT_NAME: { [key: number]: string } = {
    2: 'Destroyer',
    3: 'Cruiser',
    4: 'Battleship',
    5: 'Carrier',
  }

  public settingsStore: HyperStorage<Settings>
  public gridEl: HTMLElement
  public fleetEl: HTMLElement
  public dataEls: DataElements
  public heatmap: BattleshipHeatmap

  public cursor = { row: 0, col: 0 }

  #lastFrameTs = 0
  #renderHeatmapController: AbortController = new AbortController()

  constructor(
    settingsStore: HyperStorage<Settings>,
    gridEl: HTMLElement,
    fleetEl: HTMLElement,
    dataEls: DataElements
  ) {
    if (!(settingsStore instanceof HyperStorage)) {
      throw new TypeError('settingsStore must be an instance of HyperStorage')
    }
    this.settingsStore = settingsStore

    if (!(gridEl instanceof HTMLElement)) {
      throw new TypeError('gridEl must be an instance of HTMLElement')
    }
    this.gridEl = gridEl

    if (!(fleetEl instanceof HTMLElement)) {
      throw new TypeError('fleetEl must be an instance of HTMLElement')
    }
    this.fleetEl = fleetEl

    this.dataEls = dataEls
    this.dataEls.threadsData.textContent = String(navigator.hardwareConcurrency)

    // Load settings into data structure
    const settings = this.settingsStore.value
    const grid = new BattleshipGrid(
      settings.rows,
      settings.cols,
      settings.boats,
      settings.allowTouching,
      settings.grid
    )
    const onStartCalculating = () => this.updateGenerateButton()
    const onStopCalculating = () => this.updateGenerateButton()
    this.heatmap = new BattleshipHeatmap(
      grid,
      settings.generationSeconds,
      onStartCalculating,
      onStopCalculating
    )

    this.#handleClick.bind(this)
    this.#handleKeyDown.bind(this)

    gridEl.addEventListener('click', this.#handleClick.bind(this))
    window.addEventListener('keydown', this.#handleKeyDown.bind(this))

    this.renderGrid()
  }

  renderFleet(): void {
    this.fleetEl.innerHTML = ''

    for (let boat of this.heatmap.boats) {
      const boatEl = document.createElement('li')
      if (boat >= 2 && boat <= 5) boatEl.title = BattleshipIO.BOAT_NAME[boat]

      for (let segment = 0; segment < boat; segment++) {
        const segmentEl = document.createElement('div')
        boatEl.appendChild(segmentEl)
      }
      this.fleetEl.appendChild(boatEl)
    }

    this.updateFleetSunken()
  }

  updateFleetSunken(): void {
    if (!this.fleetEl.children.length) return

    const fleet = [...this.fleetEl.children]

    for (let i = 0; i < this.heatmap.boats.length; i++) {
      const boat = this.heatmap.boats[i]
      const boatEl = fleet[i]

      boatEl.className = 'sunk'
    }
  }

  renderGrid(): void {
    this.#invalidateHeatCache()
    this.updateFleetSunken()

    this.gridEl.innerHTML = ''

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
      this.gridEl.appendChild(rowEl)
    }

    // Should be rerendered because this function destroyed the cell with the 'cursor' class
    this.renderCursor()
  }

  private heat: HeatCache = { els: [], state: [], hottestPos: { row: NaN, col: NaN } }

  #getHeatCache(): HeatCache {
    if (!this.heat.els.length) {
      const rows = [...this.gridEl.children] as HTMLElement[]
      this.heat.els = rows.map((rowEl) => [...rowEl.children] as HTMLElement[])
      this.heat.state = this.heat.els.map((row) => row.map(() => ''))
    }
    return this.heat
  }

  #invalidateHeatCache(): void {
    this.heat.els = []
    this.heat.state = []
    this.heat.hottestPos = { row: NaN, col: NaN }
  }

  renderHeatmap(force = false): void {
    if (!force && !this.heatmap.generating) return

    const { els: heatEls, state: heatState } = this.#getHeatCache()
    let { min: minHeat, max: maxHeat } = this.heatmap.getHeatRange()
    minHeat *= 0.9
    maxHeat *= 1.1

    const { row: hottestRow, col: hottestCol } = this.heatmap.getHottestPos()

    for (let row = 0; row < heatEls.length; row++) {
      const rowEls = heatEls[row]
      const rowHeatState = heatState[row]

      for (let col = 0; col < rowEls.length; col++) {
        if (this.heatmap.getCell(row, col) !== 0) continue

        const heat = this.heatmap.getHeat(row, col)
        const heatString = (heat * 100).toFixed(1)

        // Cache heat values and skip if the value remained the same
        const isSameHottestPos =
          hottestRow === this.heat.hottestPos.row && hottestCol === this.heat.hottestPos.col

        if (rowHeatState[col] === heatString && isSameHottestPos) continue
        rowHeatState[col] = heatString

        const cellEl = rowEls[col]
        const isCursor = row === this.cursor.row && col === this.cursor.col

        if (!heat) {
          cellEl.className = isCursor ? 'cell cursor' : 'cell'
          continue
        }
        cellEl.textContent = heatString
        cellEl.className = isCursor ? 'cell chance cursor' : 'cell chance'

        // Mark hottest cell
        if (row === hottestRow && col === hottestCol) {
          cellEl.classList.add('hottest')
          cellEl.title = 'Best shot'
        } else {
          cellEl.removeAttribute('title')
        }

        const normalizedHeat = maxHeat === minHeat ? heat : (heat - minHeat) / (maxHeat - minHeat)
        cellEl.style.setProperty('--lightness', String(50 + (1 - Math.sqrt(normalizedHeat)) * 50))
      }
    }
  }

  scheduleRenderHeatmap(): void {
    this.renderGenerationInfo()

    if (!this.heatmap.generating) return

    requestAnimationFrame(() => {
      this.scheduleRenderHeatmap()
    })

    const now = performance.now()
    const cells = this.heatmap.rows * this.heatmap.cols
    const frameGapMs = Math.min(250, cells / 2.5)

    if (this.heatmap.generating && now - this.#lastFrameTs < frameGapMs) return

    this.#lastFrameTs = now

    this.#renderHeatmapController.abort()
    this.#renderHeatmapController = new AbortController()

    scheduler
      .postTask(() => this.renderHeatmap(), {
        priority: 'user-visible',
        signal: this.#renderHeatmapController.signal,
      })
      .catch((err) => {
        if (err.name !== 'AbortError') throw err
      })
  }

  renderGenerationInfo(): void {
    const generationMs = performance.now() - this.heatmap.generationStartTs

    this.dataEls.timeData.innerText = (generationMs / 1000).toFixed(1) + 's'

    this.dataEls.attemptsData.innerText = Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumSignificantDigits: 3,
      maximumFractionDigits: 2,
    }).format(this.heatmap.attempts)

    this.dataEls.configsData.innerText = Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumSignificantDigits: 3,
      maximumFractionDigits: 2,
    }).format(this.heatmap.accumulated)
  }

  renderCursor(): void {
    this.cursor.row = Math.max(0, Math.min(this.cursor.row, this.heatmap.rows - 1))
    this.cursor.col = Math.max(0, Math.min(this.cursor.col, this.heatmap.cols - 1))

    const rows = [...this.gridEl.children]

    rows.forEach((rowEl, row) => {
      const cells = [...rowEl.children]

      cells.forEach((cellEl, col) => {
        if (this.cursor.row === row && this.cursor.col === col) {
          cellEl.classList.add('cursor')
        } else {
          cellEl.classList.remove('cursor')
        }
      })
    })
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

  setCursorCell(value: number): void {
    if (!(value >= 0 && value < 4)) {
      throw new RangeError('value must be between 0 and 3')
    }

    const { row, col } = this.cursor

    if (this.heatmap.getCell(row, col) === value) return

    this.heatmap.generating = false
    this.heatmap.setCell(row, col, value)
    this.settingsStore.set('grid', this.heatmap.grid)
    this.renderGrid()
  }

  resizeGrid(rows: number, cols: number): void {
    this.heatmap.generating = false
    this.heatmap.resize(rows, cols)

    this.settingsStore.set('rows', rows)
    this.settingsStore.set('cols', cols)
    this.settingsStore.set('grid', this.heatmap.grid)
    this.renderGrid()
  }

  clearGrid(): void {
    this.heatmap.generating = false
    this.heatmap.reset()

    this.settingsStore.set('grid', this.heatmap.grid)
    this.renderGrid()
  }

  setAllowTouching(allowTouching: boolean): void {
    this.heatmap.generating = false
    this.heatmap.allowTouching = allowTouching
    this.settingsStore.set('allowTouching', this.heatmap.allowTouching)
  }

  startGenerating(): void {
    this.heatmap.startGenerating(() => this.renderHeatmap(true))
    this.renderGrid()

    requestAnimationFrame(() => this.scheduleRenderHeatmap())
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
    if (
      document.activeElement instanceof HTMLElement &&
      (document.activeElement.matches('input, textarea, select') ||
        document.activeElement.isContentEditable)
    )
      return

    let preventDefault = true

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
        this.setCursorCell(BattleshipHeatmap.EMPTY)
        break
      case 's':
        this.setCursorCell(BattleshipHeatmap.SUNK)
        // TODO: Extra: automatically mark all adjacent HIT's as SUNK using a recursive io function
        break
      case 'h':
        this.setCursorCell(BattleshipHeatmap.HIT)
        break
      case 'm':
      case 'w':
        this.setCursorCell(BattleshipHeatmap.MISS)
        break
      case 'g':
        this.startGenerating()
        break
      default:
        preventDefault = false
    }

    if (preventDefault) e.preventDefault()
  }
}
