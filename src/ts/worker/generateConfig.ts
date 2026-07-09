import type BattleshipHeatmap from '../battleship/heatmap'

self.onmessage = function (e) {
  const { heatmap } = e.data as {
    heatmap: BattleshipHeatmap
  }
  self.postMessage(heatmap)
}
