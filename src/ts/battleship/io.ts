import HyperStorage from 'hyperstorage-js'

import BattleshipGrid, { type BoatsTooManyError } from './grid'
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
  hotspots: { row: number; col: number }[]
}

export default class BattleshipIO {
  private static CLUE_CLASSNAME: { [key: number]: string } = {
    0: 'empty',
    1: 'sunk',
    2: 'hit',
    4: 'miss',
  }

  private static CLUE_SYMBOL: { [key: number]: string } = {
    0: '~',
    1: 'S',
    2: 'H',
    4: '~',
  }

  private static BOAT_NAME: { [key: number]: string } = {
    2: 'Destroyer',
    3: 'Cruiser',
    4: 'Battleship',
    5: 'Carrier',
  }

  public boatsSunkenError: BoatsTooManyError | null = null

  public settingsStore: HyperStorage<Settings>
  public generateButton: HTMLButtonElement
  public gridEl: HTMLElement
  public fleetEl: HTMLElement
  public dataEls: DataElements
  public heatmap: BattleshipHeatmap

  public cursor = { row: 0, col: 0 }

  #frameHandle = -1
  #lastFrameTs = 0
  #frameController: AbortController = new AbortController()

  constructor(
    settingsStore: HyperStorage<Settings>,
    generateButton: HTMLButtonElement,
    gridEl: HTMLElement,
    fleetEl: HTMLElement,
    dataEls: DataElements
  ) {
    if (!(settingsStore instanceof HyperStorage)) {
      throw new TypeError('settingsStore must be an instance of HyperStorage')
    }
    this.settingsStore = settingsStore

    if (!(generateButton instanceof HTMLButtonElement)) {
      throw new TypeError('generateButton must be an instance of HTMLButtonElement')
    }
    this.generateButton = generateButton

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

    const onStartGenerating = () => this.updateGenerateButton()
    const onStopGenerating = () => {
      this.updateGenerateButton()
      cancelAnimationFrame(this.#frameHandle)
    }
    const onFinishGenerating = () => this.renderHeatmap()

    this.heatmap = new BattleshipHeatmap(
      grid,
      settings.generationSeconds,
      onStartGenerating,
      onStopGenerating,
      onFinishGenerating
    )

    this.#handleClick.bind(this)
    this.#handleKeyDown.bind(this)

    gridEl.addEventListener('click', this.#handleClick.bind(this))
    window.addEventListener('keydown', this.#handleKeyDown.bind(this))

    this.renderGrid()
  }

  renderFleet(): void {
    this.fleetEl.innerHTML = ''

    for (let boatLength of this.heatmap.boatLengths) {
      const boatEl = document.createElement('li')

      if (boatLength >= 2 && boatLength <= 5)
        boatEl.title = BattleshipIO.BOAT_NAME[boatLength] || 'Boat'

      for (let segment = 0; segment < boatLength; segment++) {
        const segmentEl = document.createElement('div')
        boatEl.appendChild(segmentEl)
      }
      this.fleetEl.appendChild(boatEl)
    }
    this.updateFleetSunken()
  }

  updateFleetSunken(): void {
    if (!this.fleetEl.children.length) return

    this.boatsSunkenError = this.heatmap.updateBoatsSunken() || null
    const boatsSunkenSizes = this.heatmap.boatsSunken.map((b) => b.length)

    const fleet = [...this.fleetEl.children] as HTMLElement[]

    for (let i = 0; i < this.heatmap.boatLengths.length; i++) {
      const boatLength = this.heatmap.boatLengths[i]
      const boatEl = fleet[i]

      if (!boatsSunkenSizes.includes(boatLength)) {
        boatEl.removeAttribute('class')
        continue
      }
      boatEl.classList.value = 'sunk'

      if (boatLength >= 2 && boatLength <= 5)
        boatEl.title = BattleshipIO.BOAT_NAME[boatLength] || 'Boat'

      boatsSunkenSizes.splice(
        boatsSunkenSizes.findIndex((b) => b === boatLength),
        1
      )
    }
  }

  updateGenerateButton(): void {
    if (!this.generateButton.lastChild) return

    if (this.heatmap.generating) {
      this.generateButton.lastChild.textContent = 'Stop'
      this.generateButton.className = 'stop'
      return
    }
    this.generateButton.lastChild.textContent = 'Generate Heatmap'
    this.generateButton.className = 'start'
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
        const cellValue = BattleshipIO.CLUE_CLASSNAME[this.heatmap.getCell(row, col)]

        cellEl.textContent = BattleshipIO.CLUE_SYMBOL[this.heatmap.getCell(row, col)]
        cellEl.classList.add('cell', cellValue)
        cellEl.dataset.row = String(row)
        cellEl.dataset.col = String(col)

        rowEl.appendChild(cellEl)
      }
      this.gridEl.appendChild(rowEl)
    }

    // Should be rerendered because this function destroyed the cell with the cursor class
    this.renderCursor()
  }

  private heat: HeatCache = { els: [], state: [], hotspots: [] }

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
    this.heat.hotspots = []
  }

  async renderHeatmap(): Promise<void> {
    await this.heatmap.snapshot()

    const { els: heatEls, state: heatState } = this.#getHeatCache()
    let { min: minHeat, max: maxHeat } = this.heatmap.getHeatRange()

    // Slowly rise from 98% to 100% the more successful configurations have been accumulated
    const hotspotMargin =
      0.98 + 0.02 * (1 - Math.min(1, 1 / (this.heatmap.success / 20_000)) ** 0.3)
    const hotspots = this.heatmap.getHotspots(maxHeat * hotspotMargin)

    minHeat *= 0.9
    maxHeat *= 1.1

    const checkHotspot = (
      hotspots: { row: number; col: number }[],
      row: number,
      col: number
    ): boolean => hotspots.some((hotspot) => hotspot.row === row && hotspot.col === col)

    for (let row = 0; row < heatEls.length; row++) {
      const rowEls = heatEls[row]
      const rowHeatState = heatState[row]

      for (let col = 0; col < rowEls.length; col++) {
        if (this.heatmap.getCell(row, col) !== 0) continue

        const heat = this.heatmap.getHeat(row, col)
        const heatString = (heat * 100).toFixed(1)
        const isHotspot = checkHotspot(hotspots, row, col)

        // Cache heat values and skip if the value remained the same
        if (rowHeatState[col] === heatString) {
          // If its a hotspot it must have been cached already
          if (!isHotspot || checkHotspot(this.heat.hotspots, row, col)) continue
        }

        rowHeatState[col] = heatString

        const cellEl = rowEls[col]
        const isCursor = row === this.cursor.row && col === this.cursor.col

        if (!heat) {
          cellEl.classList.value = 'cell'
          if (isCursor) cellEl.classList.add('cursor')
          continue
        }
        cellEl.textContent = heatString
        cellEl.classList.value = 'cell chance'

        if (isCursor) cellEl.classList.add('cursor')
        if (isHotspot) cellEl.classList.add('hotspot')

        const heatDiff = maxHeat - minHeat
        const normalizedHeat = !heatDiff ? 0.5 : (heat - minHeat) / (maxHeat - minHeat)
        cellEl.style.setProperty('--lightness', String(50 + (1 - Math.sqrt(normalizedHeat)) * 50))
      }

      this.renderGenerationInfo()
    }

    this.heat.hotspots = hotspots

    this.gridEl.classList.add('restart-hotspot-animation')
    // void this.gridEl.offsetWidth
    this.gridEl.classList.remove('restart-hotspot-animation')
  }

  async scheduleRenderHeatmap(): Promise<void> {
    await this.heatmap.snapshot()
    this.renderGenerationInfo()

    if (this.heatmap.generating) {
      this.#frameHandle = requestAnimationFrame(() => this.scheduleRenderHeatmap())
    }

    // Calculate if a heatmap update may be queued
    const now = performance.now()
    const minFrameTimeMs = Math.min(250, (this.heatmap.rows * this.heatmap.cols) / 2.5)

    if (this.heatmap.generating && now - this.#lastFrameTs < minFrameTimeMs) return
    this.#lastFrameTs = now

    // Cancel the pending frame as its data is outdated
    this.#frameController.abort()
    this.#frameController = new AbortController()

    scheduler
      .postTask(() => this.renderHeatmap(), {
        priority: 'user-visible',
        signal: this.#frameController.signal,
      })
      .catch((err) => {
        if (err.name !== 'AbortError') throw err
      })
  }

  renderGenerationInfo(): void {
    const generationTimeMs = performance.now() - this.heatmap.generationStartTs

    // Convert to seconds with one decimal
    this.dataEls.timeData.innerText = (generationTimeMs / 1000).toFixed(1) + 's'

    this.dataEls.attemptsData.textContent = Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumSignificantDigits: 3,
      maximumFractionDigits: 2,
    }).format(this.heatmap.attempts)
    this.dataEls.attemptsData.title = String(this.heatmap.attempts)

    this.dataEls.configsData.textContent = Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumSignificantDigits: 3,
      maximumFractionDigits: 2,
    }).format(this.heatmap.success)
    this.dataEls.configsData.title = String(this.heatmap.success)
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
    if (!(value === 0 || value === 1 || value === 2 || value === 4)) {
      throw new RangeError('value must be: 0, 1, 2 or 4')
    }

    const { row, col } = this.cursor

    if (this.heatmap.getCell(row, col) === value) return

    this.heatmap.setCell(row, col, value)
    this.settingsStore.set('grid', this.heatmap.grid)
    this.renderGrid()
  }

  resizeGrid(rows: number, cols: number): void {
    this.heatmap.resize(rows, cols)

    this.settingsStore.set('rows', rows)
    this.settingsStore.set('cols', cols)
    this.settingsStore.set('grid', this.heatmap.grid)
    this.renderGrid()
  }

  clearGrid(): void {
    this.heatmap.reset()

    this.settingsStore.set('grid', this.heatmap.grid)
    this.renderGrid()
  }

  setAllowTouching(allowTouching: boolean): void {
    this.heatmap.allowTouching = allowTouching
    this.settingsStore.set('allowTouching', this.heatmap.allowTouching)
  }

  startGenerating(): void {
    const largestDimension = Math.max(this.heatmap.rows, this.heatmap.cols)

    if (this.heatmap.boatLengths.some((boatLength) => boatLength > largestDimension)) {
      window.alert('The fleet contains a boat larger than the grid.')
      return
    }

    if (this.boatsSunkenError) {
      const { boat, total, sunken } = this.boatsSunkenError

      window.alert(
        `More boats of length ${boat.length} are marked as sunken than exist on the board.\n${sunken} sunken > ${total} on board`
      )
      return
    }

    cancelAnimationFrame(this.#frameHandle)
    this.#frameHandle = requestAnimationFrame(() => this.scheduleRenderHeatmap())

    // Run both branches of the setter
    this.heatmap.generating = false
    this.heatmap.generating = true

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
    if (
      document.activeElement instanceof HTMLElement &&
      document.activeElement.matches('input, textarea, select')
    )
      return

    if (e.ctrlKey || e.altKey || e.shiftKey) return

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
      case 'Enter':
        this.startGenerating()
        break
      default:
        preventDefault = false
    }

    if (preventDefault) e.preventDefault()
  }
}
