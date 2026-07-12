import { settingsStore } from './settingsStore'
import BattleshipIO from './battleship/io'

const gridEl = document.getElementById('grid')!
const fleetEl = document.getElementById('fleet')!

// Settings form
const settingsForm = document.getElementById('settings') as HTMLFormElement

const rowsInput = document.getElementById('rows') as HTMLInputElement & { id: 'rows' }
const colsInput = document.getElementById('cols') as HTMLInputElement & { id: 'cols' }
const boatsInput = document.getElementById('boats') as HTMLInputElement
const allowTouchingCheckbox = document.getElementById('allowTouching') as HTMLInputElement
const generationSecondsInput = document.getElementById('generationSeconds') as HTMLInputElement

const clearButton = document.getElementById('clear') as HTMLButtonElement

// Input buttons
const inputButtons = [...(document.getElementById('input') as HTMLInputElement).children]

// Generation info
const generationInfo = document.getElementById('generation') as HTMLElement
const threadsData = generationInfo.querySelector('dl div:nth-child(1) dd') as HTMLElement
const timeData = generationInfo.querySelector('dl div:nth-child(2) dd') as HTMLElement
const attemptsData = generationInfo.querySelector('dl div:nth-child(3) dd') as HTMLElement
const configsData = generationInfo.querySelector('dl div:nth-child(4) dd') as HTMLElement
const dataEls = { threadsData, timeData, attemptsData, configsData }

// Load store into fields
rowsInput.valueAsNumber = settingsStore.value.rows
colsInput.valueAsNumber = settingsStore.value.cols
boatsInput.value = settingsStore.value.boats.join(',')
allowTouchingCheckbox.checked = settingsStore.value.allowTouching
generationSecondsInput.valueAsNumber = settingsStore.value.generationSeconds

// Setup data structure
let io: BattleshipIO

try {
  io = new BattleshipIO(settingsStore, gridEl, fleetEl, dataEls)
} catch (err) {
  window.alert(err instanceof Error ? err.message : err)
  settingsStore.reset()
  io = new BattleshipIO(settingsStore, gridEl, fleetEl, dataEls)
}

// Settings form
rowsInput.addEventListener('change', handleDimension)
colsInput.addEventListener('change', handleDimension)

function handleDimension(this: HTMLInputElement & { id: 'rows' | 'cols' }) {
  try {
    const dimension = this.valueAsNumber
    if (this.id === 'rows') io.resizeGrid(dimension, io.heatmap.cols)
    else io.resizeGrid(io.heatmap.rows, dimension)
  } catch (err) {
    window.alert(err instanceof Error ? err.message : err)
    this.valueAsNumber = io.heatmap[this.id]
  }
}
handleDimension.call(rowsInput)
handleDimension.call(colsInput)

boatsInput.addEventListener('change', parseBoatLengths)

function parseBoatLengths(this: HTMLInputElement) {
  try {
    if (!this.value) io.heatmap.boats = []
    else io.heatmap.boats = this.value.split(',').map((length) => parseInt(length))

    io.settingsStore.set('boats', io.heatmap.boats)
    io.renderFleet()
  } catch (err) {
    window.alert(err instanceof Error ? err.message : err)
    this.value = io.heatmap.boats.join(',')
  }
}
parseBoatLengths.call(boatsInput)

allowTouchingCheckbox.addEventListener('change', function () {
  io.setAllowTouching(this.checked)
})

generationSecondsInput.addEventListener('change', function () {
  if (isNaN(this.valueAsNumber)) {
    window.alert('Generation time must be a positive number')
    this.valueAsNumber = io.heatmap.generationSeconds
  }
  this.valueAsNumber = Math.max(+this.min, this.valueAsNumber)
  io.heatmap.generationSeconds = this.valueAsNumber
  io.settingsStore.set('generationSeconds', io.heatmap.generationSeconds)
})

settingsForm.addEventListener('submit', (e) => {
  e.preventDefault()

  io.heatmap.generating = false
  io.heatmap.startCalculating(() => io.renderHeatmap())
  io.renderGrid()

  requestAnimationFrame(() => {
    io.scheduleRenderHeatmap()
    io.renderGenerationInfo()
  })
})

clearButton.addEventListener('click', () => {
  io.clearGrid()
})

// Input buttons
inputButtons.forEach((button, value: number) => {
  button.addEventListener('click', () => {
    io.setCursorCell(value)
  })
})
