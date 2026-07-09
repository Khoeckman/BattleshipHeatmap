import { settingsStore } from './settingsStore'
import BattleshipGrid from './battleship/grid'
import BattleshipHeatmap from './battleship/heatmap'
import BattleshipIO from './battleship/io'

const gridEl = document.getElementById('grid')!
const fleetEl = document.getElementById('fleet')!

// Settings form
const settingsForm = document.getElementById('settings') as HTMLFormElement

const rowsInput = document.getElementById('rows') as HTMLInputElement
const colsInput = document.getElementById('cols') as HTMLInputElement
const boatsInput = document.getElementById('boats') as HTMLInputElement
const allowTouchingCheckbox = document.getElementById('allowTouching') as HTMLInputElement
const generationSecondsInput = document.getElementById('generationSeconds') as HTMLInputElement

const clearButton = document.getElementById('clear') as HTMLButtonElement

// Input buttons
const inputButtons = [...(document.getElementById('input') as HTMLInputElement).children]

// Generation info
const generationInfo = document.getElementById('generation')!
const threadsData = generationInfo.querySelector('dl dd:nth-of-type(1)')!
const timeData = generationInfo.querySelector('dl dd:nth-of-type(2)')!
const configsData = generationInfo.querySelector('dl dd:nth-of-type(3)')!

// Load store into fields
rowsInput.valueAsNumber = settingsStore.value.rows
colsInput.valueAsNumber = settingsStore.value.cols
boatsInput.value = settingsStore.value.boats.join(',')
allowTouchingCheckbox.checked = settingsStore.value.allowTouching
generationSecondsInput.valueAsNumber = settingsStore.value.generationSeconds

threadsData.textContent = String(navigator.hardwareConcurrency)

// Setup data structure
const io = new BattleshipIO(settingsStore, gridEl, fleetEl)

// Settings form
rowsInput.addEventListener('change', handleDimension)
colsInput.addEventListener('change', handleDimension)

function handleDimension(this: HTMLInputElement) {
  const dimension = +this.value || 10
  if (this.id === 'rows') io.resizeGrid(dimension, io.heatmap.cols)
  else if (this.id === 'cols') io.resizeGrid(io.heatmap.rows, dimension)
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
  io.heatmap.allowTouching = this.checked
  io.settingsStore.set('allowTouching', io.heatmap.allowTouching)
})

generationSecondsInput.addEventListener('change', function () {
  if (isNaN(this.valueAsNumber) || this.valueAsNumber <= 0) {
    window.alert('Generation time must be a positive number')
    this.valueAsNumber = io.heatmap.generationSeconds
  }
  io.heatmap.generationSeconds = this.valueAsNumber
  io.settingsStore.set('generationSeconds', io.heatmap.generationSeconds)
})

settingsForm.addEventListener('submit', (e) => {
  e.preventDefault()

  threadsData.textContent = String(navigator.hardwareConcurrency)
  io.heatmap.startCalculating()

  requestAnimationFrame(() => io.renderHeatmap())
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
