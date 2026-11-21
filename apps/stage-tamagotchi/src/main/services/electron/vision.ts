import type { ScreenCaptureOptions } from '@proj-anima/stage-shared'

import process from 'node:process'

import { defineInvokeHandler } from '@moeru/eventa'
import { visionCaptureScreen, visionCheckPermission, visionGetPrimaryDisplaySize, visionRequestPermission } from '@proj-anima/stage-shared'
import { Screen } from 'electrobun/main'

import { notImplemented } from '../../rpc'

/**
 * Resolve the capture resolution from Electrobun's primary display.
 *
 * NOTICE: the legacy hardcoded 1280x720 base shrank full-desktop glyphs to
 * ~3-5px on Retina displays, which destroyed tesseract OCR accuracy in the
 * Attention Ecology Guard. The default is the source's original resolution;
 * downscaling is explicitly opt-in and relative to the primary display's
 * native size. Electrobun's `Display` carries `bounds` rather than Electron's
 * `size`, so physical pixels are derived from the logical bounds × scaleFactor.
 */
function resolveCaptureSize(options?: ScreenCaptureOptions): { width: number, height: number } {
  const MAX_CAPTURE_WIDTH = 1920
  const MAX_CAPTURE_HEIGHT = 1080

  if (!options?.native && options?.width && options?.height) {
    const scale = Math.min(1, MAX_CAPTURE_WIDTH / options.width, MAX_CAPTURE_HEIGHT / options.height)
    return {
      width: Math.max(1, Math.round(options.width * scale)),
      height: Math.max(1, Math.round(options.height * scale)),
    }
  }

  const display = Screen.getPrimaryDisplay()
  const scaleFactor = display.scaleFactor || 1
  let physicalWidth = Math.round(display.bounds.width * scaleFactor)
  let physicalHeight = Math.round(display.bounds.height * scaleFactor)

  if (!options?.native) {
    const percent = options?.downscalePercent
    if (percent != null && percent > 0 && percent < 100) {
      physicalWidth = Math.round(physicalWidth * percent / 100)
      physicalHeight = Math.round(physicalHeight * percent / 100)
    }
  }

  const scale = Math.min(1, MAX_CAPTURE_WIDTH / physicalWidth, MAX_CAPTURE_HEIGHT / physicalHeight)
  return {
    width: Math.max(1, Math.round(physicalWidth * scale)),
    height: Math.max(1, Math.round(physicalHeight * scale)),
  }
}

/**
 * Screen capture service over Eventa/IPC.
 *
 * Electrobun can capture a desktop rectangle (`Screen.captureRegion`) but has no
 * `desktopCapturer.getSources` — no per-window source list, thumbnails, or
 * display-media request handler (design doc §1.2). The capture invoke therefore
 * raises a port error instead of fabricating a source list; the renderer's
 * canvas-based capture path remains available.
 */
export function createVisionService(params: { context: any }) {
  defineInvokeHandler(params.context, visionCheckPermission, async () => {
    if (process.platform !== 'darwin')
      return 'granted'
    notImplemented('systemPreferences.getMediaAccessStatus(screen)')
  })

  defineInvokeHandler(params.context, visionRequestPermission, async () => {
    if (process.platform !== 'darwin')
      return
    notImplemented('systemPreferences.askForMediaAccess(screen)')
  })

  defineInvokeHandler(params.context, visionGetPrimaryDisplaySize, async () => {
    const display = Screen.getPrimaryDisplay()
    return {
      width: display.bounds.width,
      height: display.bounds.height,
      scaleFactor: display.scaleFactor,
    }
  })

  defineInvokeHandler(params.context, visionCaptureScreen, async (options) => {
    // Keep the resolution calculation live so an unsupported request still
    // reports the geometry it would have captured before failing loudly.
    const size = resolveCaptureSize(options)
    console.warn(`[Vision Service] Screen capture unavailable under Electrobun (requested ${size.width}x${size.height}).`)
    notImplemented('desktopCapturer.getSources')
  })
}
