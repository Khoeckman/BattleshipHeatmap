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

// Set default values for any missing settings
if (!settingsStore.value.rows) settingsStore.value.rows = 10
if (!settingsStore.value.cols) settingsStore.value.cols = 10
if (!settingsStore.value.boats) settingsStore.value.boats = [5, 4, 3, 3, 2]
if (!settingsStore.value.allowTouching) settingsStore.value.allowTouching = false
if (!settingsStore.value.generationSeconds) settingsStore.value.generationSeconds = generationSeconds
if (!settingsStore.value.usedThreads) settingsStore.value.usedThreads = usedThreads
if (!settingsStore.value.grid) settingsStore.value.grid = []
