import { onMounted, onUnmounted, ref } from 'vue'

export function useCanvas2048(options?: {
  onGameOver?: () => void
  onGameWon?: () => void
  onScoreUpdate?: (score: number, bestScore: number) => void
}) {
  const canvasRef = ref<HTMLCanvasElement | null>(null)
  const isCanvasFocused = ref(false)
  const score = ref(0)
  const bestScore = ref(0)
  const isGameOver = ref(false)
  const isGameWon = ref(false)
  const isPaused = ref(false)
  const isMuted = ref(false)

  // Grid: 4x4 array of numbers (0 = empty)
  let board: number[][] = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]

  let audioCtx: AudioContext | null = null

  function getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined')
      return null
    if (!audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext
      if (AudioCtxClass) {
        audioCtx = new AudioCtxClass()
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      void audioCtx.resume()
    }
    return audioCtx
  }

  function playBeep(freq = 440, durationMs = 80, type: OscillatorType = 'sine') {
    if (isMuted.value)
      return
    try {
      const ctx = getAudioContext()
      if (!ctx)
        return
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = type
      osc.frequency.setValueAtTime(freq, ctx.currentTime)
      gain.gain.setValueAtTime(0.12, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + durationMs / 1000)
    }
    catch {
      // Audio context may be restricted before user gesture
    }
  }

  const TILE_COLORS: Record<number, { bg: string, text: string }> = {
    0: { bg: '#1c1c24', text: 'transparent' },
    2: { bg: '#2b2d42', text: '#edf2f4' },
    4: { bg: '#3a3d5c', text: '#edf2f4' },
    8: { bg: '#e07a5f', text: '#ffffff' },
    16: { bg: '#d65a31', text: '#ffffff' },
    32: { bg: '#e63946', text: '#ffffff' },
    64: { bg: '#ff0054', text: '#ffffff' },
    128: { bg: '#f4a261', text: '#ffffff' },
    256: { bg: '#e76f51', text: '#ffffff' },
    512: { bg: '#9b5de5', text: '#ffffff' },
    1024: { bg: '#00bbf9', text: '#ffffff' },
    2048: { bg: '#00f5d4', text: '#111111' },
  }

  function spawnRandomTile() {
    const emptyCoords: [number, number][] = []
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if (board[r][c] === 0)
          emptyCoords.push([r, c])
      }
    }
    if (emptyCoords.length === 0)
      return
    const [r, c] = emptyCoords[Math.floor(Math.random() * emptyCoords.length)]
    board[r][c] = Math.random() < 0.9 ? 2 : 4
  }

  function initGame() {
    board = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]
    score.value = 0
    isGameOver.value = false
    isGameWon.value = false
    isPaused.value = false
    spawnRandomTile()
    spawnRandomTile()
    drawBoard()
  }

  function drawBoard() {
    if (!canvasRef.value)
      return
    const ctx = canvasRef.value.getContext('2d')
    if (!ctx)
      return

    const w = canvasRef.value.width
    const h = canvasRef.value.height
    const pad = 12
    const tileSize = (w - pad * 5) / 4

    // Background
    ctx.fillStyle = '#121218'
    ctx.fillRect(0, 0, w, h)

    // Border & Grid
    ctx.strokeStyle = '#282836'
    ctx.lineWidth = 2
    ctx.strokeRect(1, 1, w - 2, h - 2)

    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const val = board[r][c]
        const x = pad + c * (tileSize + pad)
        const y = pad + r * (tileSize + pad)

        const tileStyle = TILE_COLORS[val] || { bg: '#3a0ca3', text: '#ffffff' }

        // Tile background
        ctx.fillStyle = tileStyle.bg
        ctx.beginPath()
        ctx.roundRect(x, y, tileSize, tileSize, 8)
        ctx.fill()

        // Value text
        if (val > 0) {
          ctx.fillStyle = tileStyle.text
          ctx.font = `bold ${val >= 1024 ? 22 : val >= 128 ? 26 : 30}px monospace`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(val.toString(), x + tileSize / 2, y + tileSize / 2)
        }
      }
    }

    // Overlay states
    if (isGameOver.value || isGameWon.value || isPaused.value) {
      ctx.fillStyle = 'rgba(10, 10, 15, 0.82)'
      ctx.fillRect(0, 0, w, h)

      ctx.fillStyle = isGameWon.value ? '#00f5d4' : isGameOver.value ? '#ff0054' : '#edf2f4'
      ctx.font = 'bold 32px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      const title = isGameWon.value ? 'VICTORY 2048!' : isGameOver.value ? 'GAME OVER' : 'PAUSED'
      ctx.fillText(title, w / 2, h / 2 - 18)

      ctx.fillStyle = '#a0a0b0'
      ctx.font = '14px monospace'
      const subtitle = isPaused.value ? 'Press P to Resume' : 'Press R to Play Again'
      ctx.fillText(subtitle, w / 2, h / 2 + 20)
    }
  }

  function slide(row: number[]): { newRow: number[], points: number } {
    const filtered = row.filter(x => x !== 0)
    let points = 0
    const result: number[] = []

    for (let i = 0; i < filtered.length; i++) {
      if (i + 1 < filtered.length && filtered[i] === filtered[i + 1]) {
        const merged = filtered[i] * 2
        result.push(merged)
        points += merged
        if (merged === 2048 && !isGameWon.value) {
          isGameWon.value = true
          playBeep(880, 200, 'triangle')
          options?.onGameWon?.()
        }
        i++
      }
      else {
        result.push(filtered[i])
      }
    }
    while (result.length < 4) {
      result.push(0)
    }
    return { newRow: result, points }
  }

  function rotateBoardClockwise() {
    const newBoard: number[][] = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        newBoard[c][3 - r] = board[r][c]
      }
    }
    board = newBoard
  }

  function move(direction: 'left' | 'right' | 'up' | 'down'): boolean {
    if (isGameOver.value || isPaused.value)
      return false

    let rotations = 0
    if (direction === 'up')
      rotations = 3
    else if (direction === 'right')
      rotations = 2
    else if (direction === 'down')
      rotations = 1

    for (let i = 0; i < rotations; i++) {
      rotateBoardClockwise()
    }

    let moved = false
    let turnPoints = 0

    for (let r = 0; r < 4; r++) {
      const { newRow, points } = slide(board[r])
      turnPoints += points
      for (let c = 0; c < 4; c++) {
        if (board[r][c] !== newRow[c]) {
          moved = true
        }
        board[r][c] = newRow[c]
      }
    }

    for (let i = 0; i < (4 - rotations) % 4; i++) {
      rotateBoardClockwise()
    }

    if (moved) {
      score.value += turnPoints
      if (score.value > bestScore.value) {
        bestScore.value = score.value
      }
      options?.onScoreUpdate?.(score.value, bestScore.value)
      playBeep(turnPoints > 0 ? 580 : 340, turnPoints > 0 ? 100 : 50)
      spawnRandomTile()
      checkGameState()
      drawBoard()
    }

    return moved
  }

  function checkGameState() {
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if (board[r][c] === 0)
          return
        if (c + 1 < 4 && board[r][c] === board[r][c + 1])
          return
        if (r + 1 < 4 && board[r][c] === board[r + 1][c])
          return
      }
    }
    isGameOver.value = true
    playBeep(180, 400, 'sawtooth')
    options?.onGameOver?.()
  }

  function handleCanvasKeyDown(e: KeyboardEvent) {
    let handled = false
    switch (e.key) {
      case 'ArrowLeft':
      case 'a':
      case 'A':
        handled = move('left')
        break
      case 'ArrowRight':
      case 'd':
      case 'D':
        handled = move('right')
        break
      case 'ArrowUp':
      case 'w':
      case 'W':
        handled = move('up')
        break
      case 'ArrowDown':
      case 's':
      case 'S':
        handled = move('down')
        break
      case 'r':
      case 'R':
        initGame()
        handled = true
        break
      case 'p':
      case 'P':
        isPaused.value = !isPaused.value
        drawBoard()
        handled = true
        break
    }
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  function focusCanvas() {
    canvasRef.value?.focus()
    isCanvasFocused.value = true
  }

  onMounted(() => {
    initGame()
  })

  onUnmounted(() => {
    if (audioCtx) {
      void audioCtx.close()
    }
  })

  return {
    canvasRef,
    isCanvasFocused,
    score,
    bestScore,
    isGameOver,
    isGameWon,
    isPaused,
    isMuted,
    initGame,
    drawBoard,
    move,
    handleCanvasKeyDown,
    focusCanvas,
  }
}
