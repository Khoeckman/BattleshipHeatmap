import HyperStorage from 'hyperstorage-js'

export interface Settings {
  rows: number
  cols: number
  boats: number[]
  allowTouching: boolean
  generationSeconds: number
  grid: number[][]
}

export const settingsStore = new HyperStorage<Settings>('battleship', {
  rows: 10,
  cols: 10,
  boats: [5, 4, 3, 3, 2],
  allowTouching: false,
  generationSeconds: +(1 + 32 / navigator.hardwareConcurrency).toFixed(1),
  grid: [],
})
