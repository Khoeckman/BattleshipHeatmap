import HyperStorage from 'hyperstorage-js'

export interface Settings {
  rows: number
  cols: number
  boats: number[]
  allowTouching: boolean
  generationSeconds: number
  usedThreads: number
  grid: number[][]
}

const threads = navigator.hardwareConcurrency

const generationSeconds = Math.round(Math.pow(64 / threads, 0.85) * 2) / 2
const usedThreads = threads >= 8 ? threads - 1 : threads

export const settingsStore = new HyperStorage<Settings>('battleship', {
  rows: 10,
  cols: 10,
  boats: [5, 4, 3, 3, 2],
  allowTouching: false,
  generationSeconds,
  usedThreads,
  grid: [],
})
