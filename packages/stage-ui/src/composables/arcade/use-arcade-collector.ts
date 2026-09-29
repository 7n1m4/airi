import type { CalibrationTelemetryTrace, ScreenMotionArchitecture } from '../../types/arcade'

import { onUnmounted, ref } from 'vue'

export function useArcadeCollector() {
  const isRecording = ref(false)
  const elapsedMs = ref(0)
  const framesCaptured = ref(0)
  const keyEvents = ref<Array<{ key: string, timestamp: number, type: 'down' | 'up' }>>([])
  const motionEntropy = ref(0)
  const identifiedArchitecture = ref<ScreenMotionArchitecture>('fixed_single_screen')
  const detectedAnchorBox = ref<{ minX: number, minY: number, maxX: number, maxY: number } | null>(null)

  let samplingTimer: ReturnType<typeof setInterval> | null = null
  let startTime = 0
  let previousFrameData: Uint8ClampedArray | null = null
  let diffCountSum = 0
  let totalComparisons = 0

  // Downscaled canvas for ultra-fast 10Hz pixel diffing
  const diffWidth = 160
  const diffHeight = 100
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
      const currentData = imgData.data

      framesCaptured.value++

      if (previousFrameData) {
        let changedPixels = 0
        let minX = diffWidth
        let minY = diffHeight
        let maxX = 0
        let maxY = 0

        const totalPixels = diffWidth * diffHeight
        for (let i = 0; i < currentData.length; i += 4) {
          const dr = Math.abs(currentData[i] - previousFrameData[i])
          const dg = Math.abs(currentData[i + 1] - previousFrameData[i + 1])
          const db = Math.abs(currentData[i + 2] - previousFrameData[i + 2])

          // Threshold for noticeable visual difference
          if (dr + dg + db > 40) {
            changedPixels++
            const pixelIndex = i / 4
            const x = pixelIndex % diffWidth
            const y = Math.floor(pixelIndex / diffWidth)
            if (x < minX)
              minX = x
            if (y < minY)
              minY = y
            if (x > maxX)
              maxX = x
            if (y > maxY)
              maxY = y
          }
        }

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
      }

      previousFrameData = new Uint8ClampedArray(currentData)
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
    diffCountSum = 0
    totalComparisons = 0
    motionEntropy.value = 0
    previousFrameData = null
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
    start,
    stop,
  }
}
