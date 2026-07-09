import BattleshipGrid from './battleship/grid'
import BattleshipHeatmap from './battleship/heatmap'
import BattleshipIO from './battleship/io'

const grid = new BattleshipGrid(10, 10, [5, 4, 3, 3, 2], false)
const heatmap = new BattleshipHeatmap(grid, 10)
heatmap.setCell(5, 4, BattleshipHeatmap.SUNK)
heatmap.setCell(5, 5, BattleshipHeatmap.HIT)
heatmap.setCell(5, 6, BattleshipHeatmap.MISS)

const container = document.getElementById('grid')!
const io = new BattleshipIO(container, heatmap)

const settingsForm = document.getElementById('settings')!

const rowsInput = document.getElementById('rows')!
const colsInput = document.getElementById('cols')!
const boatsInput = document.getElementById('boats')!
const allowTouchingCheckbox = document.getElementById('allowTouching')!
const generationSecondsInput = document.getElementById('generationSeconds')!

const clearButton = document.getElementById('clear')!

rowsInput.addEventListener('change', handleDimension)
colsInput.addEventListener('change', handleDimension)

function handleDimension(this: HTMLInputElement) {
  const dimension = +this.value || 10
  if (this.id === 'rows') io.resizeGrid(dimension, io.heatmap.cols)
  else if (this.id === 'cols') io.resizeGrid(io.heatmap.rows, dimension)
}

boatsInput.addEventListener('change', function (this: HTMLInputElement) {
  try {
    io.heatmap.boats = this.value.split(',').map(Number)
  } catch (err) {
    window.alert(err instanceof Error ? err.message : err)
  }
})

allowTouchingCheckbox.addEventListener('change', function (this: HTMLInputElement) {
  io.heatmap.allowTouching = this.checked
})

generationSecondsInput.addEventListener('change', function (this: HTMLInputElement) {
  io.heatmap.generationSeconds = +this.value || 10
})

settingsForm.addEventListener('submit', (e) => {
  e.preventDefault()
  io.heatmap.calculateHeatmap()
})

clearButton.addEventListener('click', () => {
  io.clearGrid()
})
