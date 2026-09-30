import type {
  CalibrationTelemetryTrace,
  DemonstrationFrameDiff,
  ScreenMotionArchitecture,
} from '../../types/arcade'

import { onUnmounted, ref } from 'vue'

export function useArcadeCollector() {
  const isRecording = ref(false)
  const elapsedMs = ref(0)
  const framesCaptured = ref(0)
  const keyEvents = ref<Array<{ key: string, timestamp: number, type: 'down' | 'up' }>>([])
  const motionEntropy = ref(0)
  const identifiedArchitecture = ref<ScreenMotionArchitecture>('fixed_single_screen')
  const detectedAnchorBox = ref<{ minX: number, minY: number, maxX: number, maxY: number } | null>(null)
  const recordedFrames = ref<DemonstrationFrameDiff[]>([])

  let samplingTimer: ReturnType<typeof setInterval> | null = null
  let startTime = 0
  let previousGrid: string[] | null = null
  let pendingIntervalKeys: string[] = []
  let diffCountSum = 0
  let totalComparisons = 0

  // 80x40 canonical downsampling grid matching game_frames.json
  const diffWidth = 80
  const diffHeight = 40
  let offscreenCanvas: HTMLCanvasElement | null = null
  let offscreenCtx: CanvasRenderingContext2D | null = null

  function getOffscreenContext(): CanvasRenderingContext2D | null {
    if (typeof document === 'undefined')
      return null
    if (!offscreenCanvas) {
      offscreenCanvas = document.createElement('canvas')
      offscreenCanvas.width = diffWidth
      offscreenCanvas.height = diffHeight
      offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true })
    }
    return offscreenCtx
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (!isRecording.value)
      return
    keyEvents.value.push({
      key: e.key,
      timestamp: Date.now() - startTime,
      type: 'down',
    })
    if (!pendingIntervalKeys.includes(e.key)) {
      pendingIntervalKeys.push(e.key)
    }
  }

  function handleKeyUp(e: KeyboardEvent) {
    if (!isRecording.value)
      return
    keyEvents.value.push({
      key: e.key,
      timestamp: Date.now() - startTime,
      type: 'up',
    })
  }

  function sampleFrame(canvas: HTMLCanvasElement) {
    const ctx = getOffscreenContext()
    if (!ctx)
      return

    try {
      ctx.drawImage(canvas, 0, 0, diffWidth, diffHeight)
      const imgData = ctx.getImageData(0, 0, diffWidth, diffHeight)
      const data = imgData.data

      framesCaptured.value++

      // Convert 80x40 pixels into binary bitstrings
      const currentGrid: string[] = []
      for (let r = 0; r < diffHeight; r++) {
        let rowStr = ''
        for (let c = 0; c < diffWidth; c++) {
          const idx = (r * diffWidth + c) * 4
          const lum = data[idx] + data[idx + 1] + data[idx + 2]
          rowStr += lum > 40 ? '1' : '0'
        }
        currentGrid.push(rowStr)
      }

      const intervalKeys = [...pendingIntervalKeys]
      pendingIntervalKeys = []

      // Initial baseline frame
      if (previousGrid === null) {
        recordedFrames.value.push({
          t: elapsedMs.value,
          keys: intervalKeys,
          fullGrid: currentGrid,
        })
        previousGrid = currentGrid
        return
      }

      // Compute sparse diffs
      const added: Array<[number, number]> = []
      const removed: Array<[number, number]> = []
      let minX = diffWidth
      let minY = diffHeight
      let maxX = 0
      let maxY = 0

      for (let r = 0; r < diffHeight; r++) {
        const prevRow = previousGrid[r]
        const currRow = currentGrid[r]
        if (prevRow === currRow)
          continue

        for (let c = 0; c < diffWidth; c++) {
          const prevBit = prevRow[c]
          const currBit = currRow[c]
          if (prevBit === '0' && currBit === '1') {
            added.push([c, r])
            if (c < minX)
              minX = c
            if (r < minY)
              minY = r
            if (c > maxX)
              maxX = c
            if (r > maxY)
              maxY = r
          }
          else if (prevBit === '1' && currBit === '0') {
            removed.push([c, r])
            if (c < minX)
              minX = c
            if (r < minY)
              minY = r
            if (c > maxX)
              maxX = c
            if (r > maxY)
              maxY = r
          }
        }
      }

      const changedPixels = added.length + removed.length
      const totalPixels = diffWidth * diffHeight
      const deltaRatio = changedPixels / totalPixels
      diffCountSum += deltaRatio
      totalComparisons++
      motionEntropy.value = Math.round((diffCountSum / totalComparisons) * 100) / 100

      if (changedPixels > 0 && maxX >= minX && maxY >= minY) {
        detectedAnchorBox.value = {
          minX: Math.round((minX / diffWidth) * 1000),
          minY: Math.round((minY / diffHeight) * 1000),
          maxX: Math.round((maxX / diffWidth) * 1000),
          maxY: Math.round((maxY / diffHeight) * 1000),
        }
      }

      // Record sparse diff frame if changes or keys occurred
      if (added.length > 0 || removed.length > 0 || intervalKeys.length > 0) {
        recordedFrames.value.push({
          t: elapsedMs.value,
          keys: intervalKeys,
          added: added.length > 0 ? added : undefined,
          removed: removed.length > 0 ? removed : undefined,
        })
      }

      previousGrid = currentGrid
    }
    catch {
      // Canvas may be tainted or cross-origin
    }
  }

  function start(getCanvas: () => HTMLCanvasElement | null, durationMs = 15000, onComplete?: (trace: CalibrationTelemetryTrace) => void) {
    if (isRecording.value)
      return

    isRecording.value = true
    elapsedMs.value = 0
    framesCaptured.value = 0
    keyEvents.value = []
    recordedFrames.value = []
    pendingIntervalKeys = []
    diffCountSum = 0
    totalComparisons = 0
    motionEntropy.value = 0
    previousGrid = null
    detectedAnchorBox.value = null
    startTime = Date.now()

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handleKeyDown, { passive: true })
      window.addEventListener('keyup', handleKeyUp, { passive: true })
    }

    const interval = 100 // 10 Hz sampling
    samplingTimer = setInterval(() => {
      elapsedMs.value = Date.now() - startTime
      const canvas = getCanvas()
      if (canvas) {
        sampleFrame(canvas)
      }

      if (elapsedMs.value >= durationMs) {
        const trace = stop()
        onComplete?.(trace)
      }
    }, interval)
  }

  function stop(): CalibrationTelemetryTrace {
    if (!isRecording.value) {
      return {
        timestamp: Date.now(),
        durationMs: elapsedMs.value,
        framesCaptured: framesCaptured.value,
        keyEvents: keyEvents.value,
        motionEntropy: motionEntropy.value,
        identifiedArchitecture: identifiedArchitecture.value,
        resolution: { cols: diffWidth, rows: diffHeight },
        frames: recordedFrames.value,
      }
    }

    if (samplingTimer) {
      clearInterval(samplingTimer)
      samplingTimer = null
    }

    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }

    isRecording.value = false

    // Classify architecture based on observed entropy
    if (motionEntropy.value < 0.15) {
      identifiedArchitecture.value = 'fixed_single_screen'
    }
    else if (motionEntropy.value < 0.35) {
      identifiedArchitecture.value = 'flip_screen_rooms'
    }
    else if (motionEntropy.value < 0.60) {
      identifiedArchitecture.value = 'smooth_scrolling_camera'
    }
    else {
      identifiedArchitecture.value = 'first_person_or_3d'
    }

    return {
      timestamp: Date.now(),
      durationMs: elapsedMs.value,
      framesCaptured: framesCaptured.value,
      keyEvents: [...keyEvents.value],
      motionEntropy: motionEntropy.value,
      identifiedArchitecture: identifiedArchitecture.value,
      resolution: { cols: diffWidth, rows: diffHeight },
      frames: [...recordedFrames.value],
    }
  }

  onUnmounted(() => {
    if (isRecording.value) {
      stop()
    }
  })

  return {
    isRecording,
    elapsedMs,
    framesCaptured,
    keyEvents,
    motionEntropy,
    identifiedArchitecture,
    detectedAnchorBox,
    recordedFrames,
    start,
    stop,
  }
}
