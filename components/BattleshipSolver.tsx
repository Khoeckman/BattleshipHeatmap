'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Play, Edit2, RotateCcw, Info } from 'lucide-react'

type CellState = 'X' | 'W' | 'B' | 'S'

export default function BattleshipSolver() {
  const [rows, setRows] = useState<number | ''>(10)
  const [cols, setCols] = useState<number | ''>(10)
  const [boatsInput, setBoatsInput] = useState('5,4,3,3,2')
  const [allowTouching, setAllowTouching] = useState(false)
  const [iterationsInput, setIterationsInput] = useState<number | string>(50000)
  const [grid, setGrid] = useState<CellState[][]>(() =>
    Array(10)
      .fill(0)
      .map(() => Array(10).fill('X')),
  )
  const [selectedCell, setSelectedCell] = useState({ r: 0, c: 0 })
  const [mode, setMode] = useState<'edit' | 'calculate'>('edit')
  const [probs, setProbs] = useState<number[][]>([])
  const [isCalculating, setIsCalculating] = useState(false)
  const [calcStatus, setCalcStatus] = useState({ iterations: 0, validBoards: 0, maxIterations: 50000 })
  const [loaded, setLoaded] = useState(false)

  const isCalculatingRef = useRef(false)
  const gridContainerRef = useRef<HTMLDivElement>(null)

  // Load from local storage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('battleship-solver-config')
      if (saved) {
        const config = JSON.parse(saved)
        if (config.rows !== undefined) setRows(config.rows)
        if (config.cols !== undefined) setCols(config.cols)
        if (config.boatsInput !== undefined) setBoatsInput(config.boatsInput)
        if (config.allowTouching !== undefined) setAllowTouching(config.allowTouching)
        if (config.iterationsInput !== undefined) setIterationsInput(config.iterationsInput)
        if (config.grid !== undefined) setGrid(config.grid)
      }
    } catch (e) {
      console.error('Failed to load config from local storage', e)
    }
    setLoaded(true)
  }, [])

  // Save to local storage on change
  useEffect(() => {
    if (loaded) {
      localStorage.setItem(
        'battleship-solver-config',
        JSON.stringify({
          rows,
          cols,
          boatsInput,
          allowTouching,
          iterationsInput,
          grid,
        }),
      )
    }
  }, [loaded, rows, cols, boatsInput, allowTouching, iterationsInput, grid])

  const resizeGrid = (prev: CellState[][], newRows: number, newCols: number) => {
    const newGrid: CellState[][] = []
    for (let r = 0; r < newRows; r++) {
      const row: CellState[] = []
      for (let c = 0; c < newCols; c++) {
        row.push(prev[r]?.[c] || 'X')
      }
      newGrid.push(row)
    }
    return newGrid
  }

  // Focus grid on edit mode
  useEffect(() => {
    if (mode === 'edit' && gridContainerRef.current) {
      gridContainerRef.current.focus()
    }
  }, [mode])

  // Parse Boats
  const allBoats = useMemo(() => {
    return boatsInput
      .split(',')
      .map(s => parseInt(s.trim()))
      .filter(n => !isNaN(n) && n > 0)
      .sort((a, b) => b - a)
  }, [boatsInput])

  // Detect Sunken & Compute Remaining
  const { sunkenLengths, remainingBoats, sunkenMatchedIdx } = useMemo(() => {
    if (!grid.length || !grid[0]) return { sunkenLengths: [], remainingBoats: allBoats, sunkenMatchedIdx: new Set<number>() }

    const visited = new Set<string>()
    const sunken: number[] = []
    const actualRows = grid.length
    const actualCols = grid[0].length
    for (let r = 0; r < actualRows; r++) {
      for (let c = 0; c < actualCols; c++) {
        if (grid[r][c] === 'S' && !visited.has(`${r},${c}`)) {
          let lenH = 1
          while (c + lenH < actualCols && grid[r][c + lenH] === 'S') lenH++
          let lenV = 1
          while (r + lenV < actualRows && grid[r + lenV][c] === 'S') lenV++

          if (lenH > 1) {
            for (let i = 0; i < lenH; i++) visited.add(`${r},${c + i}`)
            sunken.push(lenH)
          } else if (lenV > 1) {
            for (let i = 0; i < lenV; i++) visited.add(`${r + i},${c}`)
            sunken.push(lenV)
          } else {
            visited.add(`${r},${c}`)
            sunken.push(1)
          }
        }
      }
    }

    const remaining = [...allBoats]
    const matchedIdx = new Set<number>()
    for (const sLen of sunken) {
      const idx = allBoats.findIndex((b, i) => b === sLen && !matchedIdx.has(i))
      if (idx !== -1) {
        matchedIdx.add(idx)
        const rIdx = remaining.indexOf(sLen)
        if (rIdx !== -1) remaining.splice(rIdx, 1)
      }
    }

    return { sunkenLengths: sunken, remainingBoats: remaining, sunkenMatchedIdx: matchedIdx }
  }, [grid, allBoats])

  // Handle Keyboard Grid Navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (!grid.length || !grid[0]) return

      let { r, c } = selectedCell
      let prevent = true
      const actualRows = grid.length
      const actualCols = grid[0].length

      if (e.key === 'ArrowUp') r = Math.max(0, r - 1)
      else if (e.key === 'ArrowDown') r = Math.min(actualRows - 1, r + 1)
      else if (e.key === 'ArrowLeft') c = Math.max(0, c - 1)
      else if (e.key === 'ArrowRight') c = Math.min(actualCols - 1, c + 1)
      else if (['b', 's', 'w', 'x'].includes(e.key.toLowerCase()) || e.key === 'Backspace' || e.key === 'Delete') {
        const key = e.key === 'Backspace' || e.key === 'Delete' ? 'X' : (e.key.toUpperCase() as CellState)

        if (mode === 'calculate') {
          setIsCalculating(false)
          isCalculatingRef.current = false
          setMode('edit')
        }

        setGrid(prev => {
          const newGrid = prev.map(row => [...row])
          newGrid[r][c] = key
          return newGrid
        })
      } else {
        prevent = false
      }

      if (prevent) {
        setSelectedCell({ r, c })
        e.preventDefault()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [grid, selectedCell, mode])

  const startCalculation = () => {
    if (!grid.length || !grid[0]) return
    const actualRows = grid.length
    const actualCols = grid[0].length

    let parsedIters = typeof iterationsInput === 'string' ? parseInt(iterationsInput, 10) : iterationsInput
    if (isNaN(parsedIters)) parsedIters = 50000
    if (parsedIters < 1000) parsedIters = 1000
    if (parsedIters > 1000000) parsedIters = 1000000
    setIterationsInput(parsedIters)

    setIsCalculating(true)
    setMode('calculate')
    setCalcStatus({ iterations: 0, validBoards: 0, maxIterations: parsedIters })
    setProbs(
      Array(actualRows)
        .fill(0)
        .map(() => Array(actualCols).fill(0)),
    )
    isCalculatingRef.current = true

    const currentGrid = grid
    const sortedBoats = [...remainingBoats].sort((a, b) => b - a)
    const maxIterations = parsedIters

    let iterations = 0
    let validBoardsCount = 0
    let lastUpdateTime = performance.now()
    const heatMap = Array(actualRows)
      .fill(0)
      .map(() => Array(actualCols).fill(0))

    const runChunk = () => {
      if (!isCalculatingRef.current) return

      const start = performance.now()

      // Yield frame if executing over 50ms
      while (performance.now() - start < 50 && iterations < maxIterations) {
        iterations++

        // Temp board state for current simulation logic
        const board = Array(actualRows)
          .fill(0)
          .map(() => Array(actualCols).fill('.'))

        const dfs = (bIdx: number): boolean => {
          if (bIdx === sortedBoats.length) return true
          const len = sortedBoats[bIdx]
          const placements: { r: number; c: number; d: 'H' | 'V' }[] = []

          for (let r = 0; r < actualRows; r++) {
            for (let c = 0; c < actualCols; c++) {
              // Check Horizontal Placement
              if (c + len <= actualCols) {
                let valid = true
                for (let i = 0; i < len; i++) {
                  if (currentGrid[r][c + i] === 'W' || currentGrid[r][c + i] === 'S') {
                    valid = false
                    break
                  }
                  if (board[r][c + i] === 'SHIP') {
                    valid = false
                    break
                  }
                }
                if (valid && !allowTouching) {
                  for (let i = 0; i < len; i++) {
                    for (let dr = -1; dr <= 1; dr++) {
                      for (let dc = -1; dc <= 1; dc++) {
                        if (dr === 0 && dc === 0) continue
                        const nr = r + dr,
                          nc = c + i + dc
                        if (nr >= 0 && nr < actualRows && nc >= 0 && nc < actualCols) {
                          if (board[nr][nc] === 'SHIP' || currentGrid[nr][nc] === 'S') valid = false
                        }
                      }
                    }
                  }
                }
                if (valid) placements.push({ r, c, d: 'H' })
              }
              // Check Vertical Placement
              if (len > 1 && r + len <= actualRows) {
                let valid = true
                for (let i = 0; i < len; i++) {
                  if (currentGrid[r + i][c] === 'W' || currentGrid[r + i][c] === 'S') {
                    valid = false
                    break
                  }
                  if (board[r + i][c] === 'SHIP') {
                    valid = false
                    break
                  }
                }
                if (valid && !allowTouching) {
                  for (let i = 0; i < len; i++) {
                    for (let dr = -1; dr <= 1; dr++) {
                      for (let dc = -1; dc <= 1; dc++) {
                        if (dr === 0 && dc === 0) continue
                        const nr = r + i + dr,
                          nc = c + dc
                        if (nr >= 0 && nr < actualRows && nc >= 0 && nc < actualCols) {
                          if (board[nr][nc] === 'SHIP' || currentGrid[nr][nc] === 'S') valid = false
                        }
                      }
                    }
                  }
                }
                if (valid) placements.push({ r, c, d: 'V' })
              }
            }
          }

          if (placements.length === 0) return false

          // Shuffle placements for uniformly random DFS
          for (let i = placements.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1))
            ;[placements[i], placements[j]] = [placements[j], placements[i]]
          }

          for (const p of placements) {
            for (let i = 0; i < len; i++) {
              if (p.d === 'H') board[p.r][p.c + i] = 'SHIP'
              else board[p.r + i][p.c] = 'SHIP'
            }
            if (dfs(bIdx + 1)) return true // Successfully placed all subsequent ships
            // Backtrack
            for (let i = 0; i < len; i++) {
              if (p.d === 'H') board[p.r][p.c + i] = '.'
              else board[p.r + i][p.c] = '.'
            }
          }

          return false
        }

        // If a valid complete board was generated
        if (dfs(0)) {
          // Confirm ALL 'B' initial clues are indeed covered by ships
          let coversAllB = true
          for (let r = 0; r < actualRows; r++) {
            for (let c = 0; c < actualCols; c++) {
              if (currentGrid[r][c] === 'B' && board[r][c] !== 'SHIP') {
                coversAllB = false
                break
              }
            }
          }

          if (coversAllB) {
            validBoardsCount++
            for (let r = 0; r < actualRows; r++) {
              for (let c = 0; c < actualCols; c++) {
                if (board[r][c] === 'SHIP') heatMap[r][c]++
              }
            }
          }
        }
      }

      setCalcStatus({ iterations, validBoards: validBoardsCount, maxIterations })

      if (validBoardsCount > 0 && performance.now() - lastUpdateTime >= 200) {
        const newProbs = heatMap.map(r => r.map(v => v / validBoardsCount))
        setProbs(newProbs)
        lastUpdateTime = performance.now()
      }

      if (iterations < maxIterations) {
        scheduler.postTask(runChunk, { priority: 'user-visible' })
      } else {
        setIsCalculating(false)
        isCalculatingRef.current = false
        if (validBoardsCount > 0) {
          const finalProbs = heatMap.map(r => r.map(v => v / validBoardsCount))
          setProbs(finalProbs)
        }
      }
    }

    scheduler.postTask(runChunk, { priority: 'user-visible' })
  }

  const handleEdit = () => {
    isCalculatingRef.current = false
    setIsCalculating(false)
    setMode('edit')
  }

  const clearGrid = () => {
    const r = typeof rows === 'number' ? rows : 10
    const c = typeof cols === 'number' ? cols : 10
    setGrid(
      Array(r)
        .fill(0)
        .map(() => Array(c).fill('X')),
    )
    setProbs(
      Array(r)
        .fill(0)
        .map(() => Array(c).fill(0)),
    )
    setMode('edit')
    const maxIters = typeof iterationsInput === 'number' ? iterationsInput : 50000
    setCalcStatus({ iterations: 0, validBoards: 0, maxIterations: maxIters })
  }

  const maxProb = probs.length
    ? Math.max(
        0,
        ...probs.map((row, r) =>
          Math.max(0, ...row.map((p, c) => (grid[r]?.[c] === 'B' || grid[r]?.[c] === 'S' || grid[r]?.[c] === 'W' ? -1 : p))),
        ),
      )
    : 0
  const minSize = Math.max(1, allBoats.length > 0 ? Math.max(...allBoats) : 1)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Battleship Solver</h1>
        <p className="text-gray-500 mt-1">Configure your board, enter clues, and calculate where to shoot next.</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-6">
        <h2 className="text-lg font-semibold text-gray-800">Board Configuration</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">Rows</label>
            <input
              type="number"
              min={minSize}
              max={20}
              value={rows === '' ? '' : rows}
              disabled={mode === 'calculate'}
              onChange={e => {
                if (e.target.value === '') {
                  setRows('')
                } else {
                  const val = Math.max(minSize, Math.min(20, parseInt(e.target.value) || minSize))
                  setRows(val)
                  setGrid(prev => resizeGrid(prev, val, typeof cols === 'number' ? cols : 10))
                }
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-50 disabled:bg-gray-50 disabled:cursor-not-allowed"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">Columns</label>
            <input
              type="number"
              min={minSize}
              max={20}
              value={cols === '' ? '' : cols}
              disabled={mode === 'calculate'}
              onChange={e => {
                if (e.target.value === '') {
                  setCols('')
                } else {
                  const val = Math.max(minSize, Math.min(20, parseInt(e.target.value) || minSize))
                  setCols(val)
                  setGrid(prev => resizeGrid(prev, typeof rows === 'number' ? rows : 10, val))
                }
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-50 disabled:bg-gray-50 disabled:cursor-not-allowed"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium text-gray-700">Boats (comma-separated lengths)</label>
            <input
              type="text"
              value={boatsInput}
              disabled={mode === 'calculate'}
              onChange={e => setBoatsInput(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-50 disabled:bg-gray-50 disabled:cursor-not-allowed"
              placeholder="e.g. 5,4,3,3,2,2"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">Iterations</label>
            <input
              type="number"
              min={1000}
              max={1000000}
              value={iterationsInput}
              disabled={mode === 'calculate'}
              onChange={e => {
                setIterationsInput(e.target.value)
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-50 disabled:bg-gray-50 disabled:cursor-not-allowed"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="allowTouching"
            checked={allowTouching}
            disabled={mode === 'calculate'}
            onChange={e => setAllowTouching(e.target.checked)}
            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <label
            htmlFor="allowTouching"
            className={`text-sm text-gray-700 font-medium select-none ${mode === 'calculate' ? 'opacity-50' : ''}`}
          >
            Allow ships to touch (disable strict Battleship spacing)
          </label>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        <div className="flex-1">
          <div className="bg-blue-50 text-blue-900 px-4 py-3 border border-blue-100 rounded-xl text-sm mb-6 space-y-2">
            <p className="font-semibold flex items-center gap-2">
              <Info className="w-4 h-4" /> How to enter clues
            </p>
            <ul className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
              <li className="flex items-center gap-2">
                <kbd className="bg-white px-1.5 py-0.5 rounded border border-blue-200 shadow-sm text-xs font-mono font-bold text-gray-700">
                  B
                </kbd>{' '}
                Partial ship
              </li>
              <li className="flex items-center gap-2">
                <kbd className="bg-white px-1.5 py-0.5 rounded border border-blue-200 shadow-sm text-xs font-mono font-bold text-gray-700">
                  S
                </kbd>{' '}
                Sunken ship
              </li>
              <li className="flex items-center gap-2">
                <kbd className="bg-white px-1.5 py-0.5 rounded border border-blue-200 shadow-sm text-xs font-mono font-bold text-gray-700">
                  W
                </kbd>{' '}
                Place water
              </li>
              <li className="flex items-center gap-2">
                <kbd className="bg-white px-1.5 py-0.5 rounded border border-blue-200 shadow-sm text-xs font-mono font-bold text-gray-700">
                  X
                </kbd>{' '}
                Remove clue
              </li>
            </ul>
            <p className="text-xs opacity-80 pt-2 border-t border-blue-200 mt-2">
              Click a cell and use your arrow keys to navigate. Press the letters above to mark the grid.
            </p>
          </div>

          <div ref={gridContainerRef} className={`flex flex-col items-center focus:outline-none`}>
            {grid.map((row, r) => (
              <div key={r} className="flex">
                {row.map((cell, c) => {
                  const isSelected = selectedCell.r === r && selectedCell.c === c
                  const prob = probs[r]?.[c] || 0
                  const isMax = prob === maxProb && prob > 0 && mode === 'calculate'

                  let content: React.ReactNode = ''
                  if (mode === 'calculate' && prob > 0 && cell !== 'S' && cell !== 'B')
                    content = <span className="text-xs font-semibold">{`${(prob * 100).toFixed(0)}%`}</span>
                  else if (cell === 'B') content = <span className="text-lg font-bold">B</span>
                  else if (cell === 'S') content = <span className="text-lg font-bold">S</span>
                  else if (cell === 'W') content = <span className="text-lg font-bold">W</span>

                  const getBgColor = () => {
                    if (mode === 'calculate' && prob > 0 && cell !== 'S' && cell !== 'B') {
                      return `rgba(59, 130, 246, ${prob * 0.9})`
                    }
                    return undefined
                  }

                  return (
                    <div
                      key={c}
                      onClick={() => setSelectedCell({ r, c })}
                      className={`
                        w-10 h-10 border border-gray-300 m-[1px] flex items-center justify-center rounded-sm select-none transition-all duration-150 cursor-pointer
                        ${isSelected ? 'ring-2 ring-inset ring-blue-500 z-10' : ''}
                        ${isMax ? 'ring-2 ring-inset ring-green-500 z-10 text-green-900 shadow-lg scale-110' : ''}
                        ${cell === 'X' ? 'bg-white' : ''}
                        ${cell === 'W' ? 'bg-blue-50 text-blue-400 border-blue-200' : ''}
                        ${cell === 'B' ? 'bg-gray-500 text-white border-gray-600' : ''}
                        ${cell === 'S' ? 'bg-gray-900 text-white border-black' : ''}
                        ${mode === 'edit' ? (cell === 'X' ? 'hover:bg-gray-100' : 'hover:brightness-95') : ''}
                        ${mode === 'calculate' && prob > 0.5 && cell !== 'S' && cell !== 'B' ? 'text-white' : 'text-gray-900'}
                      `}
                      style={{ backgroundColor: getBgColor() }}
                    >
                      {content}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="w-full lg:w-80 flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            {mode === 'edit' ? (
              <button
                onClick={startCalculation}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-xl shadow-sm transition-colors"
              >
                <Play className="w-5 h-5" /> Calculate Probabilities
              </button>
            ) : (
              <button
                onClick={handleEdit}
                className="w-full flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 text-white font-semibold py-3 px-4 rounded-xl shadow-sm transition-colors"
              >
                <Edit2 className="w-5 h-5" /> Back to Edit Mode
              </button>
            )}
            <button
              onClick={clearGrid}
              disabled={isCalculating}
              className="w-full flex items-center justify-center gap-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold py-3 px-4 rounded-xl shadow-sm transition-colors disabled:opacity-50"
            >
              <RotateCcw className="w-5 h-5" /> Clear Grid
            </button>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h3 className="font-semibold text-gray-800 mb-4 text-sm uppercase tracking-wider">Target Fleet</h3>
            <div className="flex flex-col gap-3">
              {allBoats.map((len, idx) => {
                const isSunken = sunkenMatchedIdx.has(idx)
                let squares = []
                if (len === 1) {
                  squares.push(<div key={0} className="w-4 h-4 bg-gray-800 rounded-full"></div>)
                } else if (len <= 10) {
                  squares = Array(len)
                    .fill(0)
                    .map((_, i) => (
                      <div
                        key={i}
                        className={`w-4 h-4 bg-gray-800 ${i === 0 ? 'rounded-l-full' : i === len - 1 ? 'rounded-r-full' : ''}`}
                      ></div>
                    ))
                } else {
                  for (let i = 0; i < 4; i++) {
                    squares.push(<div key={i} className={`w-4 h-4 bg-gray-800 ${i === 0 ? 'rounded-l-full' : ''}`}></div>)
                  }
                  squares.push(
                    <div
                      key="ellipsis"
                      className="w-4 h-4 flex items-center justify-center text-gray-500 text-xs tracking-widest leading-none"
                    >
                      ...
                    </div>,
                  )
                  for (let i = 0; i < 4; i++) {
                    squares.push(<div key={len - 4 + i} className={`w-4 h-4 bg-gray-800 ${i === 3 ? 'rounded-r-full' : ''}`}></div>)
                  }
                }

                return (
                  <div
                    key={idx}
                    className={`flex items-center gap-1 transition-opacity duration-300 ${isSunken ? 'opacity-30' : 'opacity-100'}`}
                  >
                    <div className="flex gap-[1px]">{squares}</div>
                    <span className="text-xs font-mono font-semibold text-gray-500 ml-2">{len}</span>
                    {isSunken && <span className="text-xs text-red-600 font-semibold ml-auto uppercase tracking-wider">Sunken</span>}
                  </div>
                )
              })}
              {allBoats.length === 0 && <span className="text-sm text-gray-500 italic">No boats defined.</span>}
            </div>
          </div>

          {mode === 'calculate' && (
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h3 className="font-semibold text-gray-800 mb-3 text-sm uppercase tracking-wider">Solver Progress</h3>
              <div className="flex items-center justify-between text-xs font-mono text-gray-500 mb-2">
                <span>ITERS</span>
                <span>
                  {calcStatus.iterations} / {calcStatus.maxIterations}
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2.5 mb-4 border border-gray-200 overflow-hidden">
                <div
                  className="bg-blue-600 h-2.5 rounded-full transition-all duration-75"
                  style={{ width: `${(calcStatus.iterations / calcStatus.maxIterations) * 100}%` }}
                ></div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Valid Configurations</span>
                <span className="font-mono font-bold text-gray-900 bg-gray-100 px-2 py-0.5 rounded">{calcStatus.validBoards}</span>
              </div>
              {!isCalculating && calcStatus.validBoards === 0 && (
                <div className="mt-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">
                  No valid configurations found. Check your board setup and clues.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
