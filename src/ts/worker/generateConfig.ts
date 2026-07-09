// import BattleshipGrid from '../battleship/grid'
// import BattleshipHeatmap from '../battleship/heatmap'

self.onmessage = function (e) {
  const { rows, cols, boats, allowTouching } = e.data as {
    rows: number
    cols: number
    boats: number[]
    allowTouching: boolean
  }

  // const heatmap = new BattleshipHeatmap(new BattleshipGrid(rows, cols, boats, allowTouching), 10)

  const heatmap = Array(rows)
    .fill(0)
    .map(() => Array(cols).fill(0))

  self.postMessage(heatmap)
}
