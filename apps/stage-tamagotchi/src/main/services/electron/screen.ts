import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { Display } from 'electrobun/main'
import type { BrowserWindow, Point } from 'electron'

import { defineInvokeHandler } from '@moeru/eventa'
import { cursorScreenPoint, startLoopGetCursorScreenPoint } from '@proj-airi/electron-eventa'
import { createRendererLoop } from '@proj-airi/electron-vueuse/main'
import { Screen } from 'electrobun/main'

import { electron } from '../../../shared/eventa'
import { onAppBeforeQuit, onAppWindowAllClosed } from '../../libs/bootkit/lifecycle'

/**
 * Electrobun's `Screen` covers displays and the cursor point but has no
 * `getDisplayMatching` and no DIP↔screen conversions (design doc §1.2). Derive the
 * missing helpers from `getAllDisplays` instead of importing Electron's `screen`:
 * an identity conversion is the honest fallback here, not a silent no-op — callers
 * already treat these coordinates as logical points.
 */
const screen = {
  getAllDisplays: () => Screen.getAllDisplays(),
  getPrimaryDisplay: () => Screen.getPrimaryDisplay(),
  getCursorScreenPoint: () => Screen.getCursorScreenPoint(),
  getDisplayMatching(rect: { x: number, y: number, width: number, height: number }): Display {
    const centerX = rect.x + rect.width / 2
    const centerY = rect.y + rect.height / 2
    const displays = Screen.getAllDisplays()
    const hit = displays.find(d =>
      centerX >= d.bounds.x
      && centerX < d.bounds.x + d.bounds.width
      && centerY >= d.bounds.y
      && centerY < d.bounds.y + d.bounds.height)
    return hit ?? Screen.getPrimaryDisplay()
  },
  dipToScreenPoint(point: { x: number, y: number }) {
    return point
  },
  dipToScreenRect(_window: unknown, rect: { x: number, y: number, width: number, height: number }) {
    return rect
  },
  screenToDipPoint(point: { x: number, y: number }) {
    return point
  },
  screenToDipRect(_window: unknown, rect: { x: number, y: number, width: number, height: number }) {
    return rect
  },
}

export function createScreenService(params: { context: ReturnType<typeof createContext>['context'], window: BrowserWindow }) {
  // The last position that the renderer received. The renderer keeps it, so a cursor that did not move needs no
  // message. Each message costs the renderer an IPC dispatch on its main thread, where the Stage renders.
  let sent: Point | undefined
  const { start, stop } = createRendererLoop({
    window: params.window,
    run: () => {
      const dipPos = screen.getCursorScreenPoint()
      if (sent?.x === dipPos.x && sent?.y === dipPos.y)
        return
      sent = dipPos
      params.context.emit(cursorScreenPoint, dipPos)
    },
  })

  onAppWindowAllClosed(() => stop())
  onAppBeforeQuit(() => stop())
  const cleanup = () => stop()
  params.window.on('close', cleanup)
  params.window.on('closed', cleanup)

  // A reloaded renderer starts the loop again with no position, so the next tick sends the position even if it did not change.
  defineInvokeHandler(params.context, startLoopGetCursorScreenPoint, () => {
    sent = undefined
    start()
  })

  // NOTICE: the eventa contract still types Electron's richer `Display`. Electrobun's
  // display has a different shape, so the boundary cast is explicit rather than a
  // pretend conversion. Renderer consumers already use only bounds/scaleFactor.
  defineInvokeHandler(params.context, electron.screen.getAllDisplays, () => screen.getAllDisplays() as never)
  defineInvokeHandler(params.context, electron.screen.getPrimaryDisplay, () => screen.getPrimaryDisplay() as never)
  defineInvokeHandler(params.context, electron.screen.dipToScreenPoint, point => point ? screen.dipToScreenPoint(point) : screen.getCursorScreenPoint())
  defineInvokeHandler(params.context, electron.screen.dipToScreenRect, (rect) => {
    if (params.window.isDestroyed())
      return { x: 0, y: 0, width: 0, height: 0 }
    return rect ? screen.dipToScreenRect(params.window, rect) : params.window.getBounds()
  })
  defineInvokeHandler(params.context, electron.screen.screenToDipPoint, point => point ? screen.screenToDipPoint(point) : screen.getCursorScreenPoint())
  defineInvokeHandler(params.context, electron.screen.screenToDipRect, (rect) => {
    if (params.window.isDestroyed())
      return { x: 0, y: 0, width: 0, height: 0 }
    return rect ? screen.screenToDipRect(params.window, rect) : params.window.getBounds()
  })
  defineInvokeHandler(params.context, electron.screen.getCursorScreenPoint, () => screen.getCursorScreenPoint())

  return cleanup
}
