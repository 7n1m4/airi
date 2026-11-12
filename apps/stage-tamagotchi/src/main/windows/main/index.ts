import type { BrowserView, Rectangle } from 'electrobun/main'
import type { InferOutput } from 'valibot'

import type { globalAppConfigSchema } from '../../configs/global'
import type { Config } from '../../libs/electron/persistence'
import type { I18n } from '../../libs/i18n'
import type { AcpAgentsManager } from '../../services/airi/acp-agents'
import type { ServerChannel } from '../../services/airi/channel-server'
import type { McpStdioManager } from '../../services/airi/mcp-servers'
import type { AutoUpdater } from '../../services/electron/auto-updater'
import type { ChatWindowManager } from '../chat'
import type { NoticeWindowManager } from '../notice'
import type { OnboardingWindowManager } from '../onboarding'
import type { SettingsWindowManager } from '../settings'
import type { WidgetsWindowManager } from '../widgets'

import { Screen } from 'electrobun/main'
import { debounce, throttle } from 'es-toolkit'

import { isDestroyed } from '../registry'
import { createViewWindow, setWindowFrame } from '../shared/create-window'
import { ensureWindowInVisibleBounds } from '../shared/display'
// TODO(port): the Control Strip RPC surface — `./rpc/index.electron.ts` still imports `electron`.
// import { setupMainWindowElectronInvokes } from './rpc/index.electron'

/** Electrobun has no `getDisplayMatching`; pick the display with the most bounds overlap. */
function displayForBounds(bounds: Rectangle) {
  try {
    const displays = Screen.getAllDisplays()
    let best = displays[0]
    let bestOverlap = 0
    for (const display of displays) {
      const db = display.bounds
      const overlapX = Math.max(0, Math.min(bounds.x + bounds.width, db.x + db.width) - Math.max(bounds.x, db.x))
      const overlapY = Math.max(0, Math.min(bounds.y + bounds.height, db.y + db.height) - Math.max(bounds.y, db.y))
      const overlap = overlapX * overlapY
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        best = display
      }
    }
    return best ?? Screen.getPrimaryDisplay()
  }
  catch (err) {
    console.warn('[MainWindow] Failed to resolve the display for bounds:', err)
    return null
  }
}

export async function setupMainWindow(params: {
  settingsWindow: SettingsWindowManager
  chatWindow: ChatWindowManager
  widgetsManager: WidgetsWindowManager
  noticeWindow: NoticeWindowManager
  autoUpdater: AutoUpdater
  serverChannel: ServerChannel
  mcpStdioManager: McpStdioManager
  acpAgentsManager: AcpAgentsManager
  i18n: I18n
  onboardingWindowManager: OnboardingWindowManager
  appConfig: Config<typeof globalAppConfigSchema>
  // NOTICE: When the coordinated startup splash owns the reveal sequence,
  // the initial `show()` is deferred until Main dismisses the splash after
  // all milestones report ready/skipped. Otherwise windows pop in uncoordinated.
  deferInitialShow?: boolean
}) {
  const getConfig = (): InferOutput<typeof globalAppConfigSchema> => params.appConfig.get() ?? { language: 'en', windows: [], microphoneToggleHotkey: 'Scroll' }
  const updateConfig = (newData: InferOutput<typeof globalAppConfigSchema>) => params.appConfig.update(newData)

  const mainWindowConfig = getConfig().windows?.find(w => w.title === 'AIRI' && w.tag === 'main')
  const orientation = mainWindowConfig?.orientation || 'vertical'
  let width = mainWindowConfig?.width ?? mainWindowConfig?.snapshot?.width ?? (orientation === 'vertical' ? 56.0 : 300.0)
  let height = mainWindowConfig?.height ?? mainWindowConfig?.snapshot?.height ?? (orientation === 'vertical' ? 300.0 : 56.0)
  let x = mainWindowConfig?.x ?? mainWindowConfig?.snapshot?.x
  let y = mainWindowConfig?.y ?? mainWindowConfig?.snapshot?.y
  if (x !== undefined && y !== undefined && !Number.isNaN(x) && !Number.isNaN(y)) {
    const valid = ensureWindowInVisibleBounds({
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    })
    x = valid.x
    y = valid.y
    width = valid.width
    height = valid.height
  }
  else {
    try {
      const workArea = Screen.getPrimaryDisplay().workArea
      x = workArea.x + 24
      y = workArea.y + Math.round((workArea.height - height) / 2)
    }
    catch (e) {
      console.warn('Failed to calculate default Main window position:', e)
    }
  }

  // shortcut: Electrobun's `setAlwaysOnTop(true)` has no level, so the Control Strip cannot be
  // pinned above the Stage window the way `setAlwaysOnTop(true, 'screen-saver', 2)` did.
  const window = await createViewWindow({
    tag: 'main',
    title: 'AIRI',
    html: 'index.html',
    frame: { x, y, width, height },
    transparent: true,
    passthrough: false,
    hidden: true,
    activate: false,
    alwaysOnTop: true,
  })

  // NOTICE: the registry is the identity map now that Electron's `__is_main_window` expando
  // has no equivalent (window objects are plain JS, so it would still work, but the registry
  // is what `single-instance` and the macOS activate path read).
  void mainWindowConfig

  // TODO(port): window.setMovable()/setResizable() — creation-time styleMask options.
  // TODO(port): webContents.setWindowOpenHandler() — replaced by Electrobun `navigationRules`.

  function restoreBounds() {
    const saved = getConfig().windows?.find(w => w.title === 'AIRI' && w.tag === 'main')
    const x = saved?.x ?? saved?.snapshot?.x
    const y = saved?.y ?? saved?.snapshot?.y
    const orientation = saved?.orientation || 'vertical'
    const width = saved?.width ?? (orientation === 'vertical' ? 56.0 : 300.0)
    const height = saved?.height ?? (orientation === 'vertical' ? 300.0 : 56.0)
    if (x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y))
      return
    setWindowFrame(window, ensureWindowInVisibleBounds({
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    }))
  }

  if (!params.deferInitialShow)
    window.show()

  // NOTICE: on some platforms/transparency settings the first bounds application is ignored.
  setTimeout(() => restoreBounds(), 500)

  function handleNewBounds(newBounds: Rectangle) {
    if (isDestroyed(window))
      return

    const config = getConfig()
    if (!config.windows || !Array.isArray(config.windows)) {
      config.windows = []
    }

    const existingConfigIndex = config.windows.findIndex(w => w.title === 'AIRI' && w.tag === 'main')
    const existingConfig = existingConfigIndex !== -1 ? config.windows[existingConfigIndex] : null

    if (existingConfig?.locked)
      return

    // NOTICE: the renderer's synced Control Strip state was stored on the window object by
    // the Electron RPC handler. Electrobun's BrowserView is a different object, so read the
    // expando off the view's JS handle (same object identity the RPC handler writes to).
    const expando: unknown = (window.webview as BrowserView & { __control_strip_state?: unknown }).__control_strip_state
    const state = isControlStripState(expando) ? expando : undefined
    if (!state) {
      // Skip saving bounds if the renderer hasn't synced the control strip state yet.
      // This prevents startup and shutdown bounds-changed events from overwriting
      // the correct collapsed size/orientation with default fallback values (like stripLength = 300).
      return
    }

    let savedX = newBounds.x
    let savedY = newBounds.y
    const orientation = state.orientation || existingConfig?.orientation || 'vertical'
    const stripLength = state?.stripLength || 300
    const activePopover = state?.activePopover || null
    const placement = state?.lastPlacement || 'bottom'

    const savedW = orientation === 'vertical' ? 56 : stripLength
    const savedH = orientation === 'vertical' ? stripLength : 56

    if (activePopover) {
      if (orientation === 'vertical') {
        savedX = newBounds.x + (placement === 'left' ? 268 : 0)
        savedY = newBounds.y + (newBounds.height - stripLength) / 2
      }
      else {
        savedX = newBounds.x + (newBounds.width - stripLength) / 2
        savedY = newBounds.y + (placement === 'top' ? 280 : 0)
      }
    }

    if (existingConfigIndex === -1) {
      const created = {
        title: 'AIRI',
        tag: 'main',
        x: Math.round(savedX),
        y: Math.round(savedY),
        width: Math.round(savedW),
        height: Math.round(savedH),
        orientation,
        collapsed: state.collapsed,
        backgroundColor: state.backgroundColor,
      }
      config.windows.push(created)
    }
    else {
      config.windows[existingConfigIndex] = {
        ...config.windows[existingConfigIndex],
        x: Math.round(savedX),
        y: Math.round(savedY),
        width: Math.round(savedW),
        height: Math.round(savedH),
        orientation,
        collapsed: state.collapsed,
        backgroundColor: state.backgroundColor,
      }
    }

    updateConfig(config)
  }

  const throttledHandleNewBounds = throttle(handleNewBounds, 200)
  void throttledHandleNewBounds

  const debouncedSnap = debounce(() => {
    if (isDestroyed(window))
      return

    const bounds = window.getFrame()
    const display = displayForBounds(bounds)
    if (!display)
      return

    const workArea = display.workArea
    const displayBounds = display.bounds

    const isVertical = bounds.height > bounds.width
    const isHorizontal = bounds.width > bounds.height

    const SNAP_THRESHOLD = 25
    let newX = bounds.x
    let newY = bounds.y
    let snapped = false

    const snapTargetsX = [
      workArea.x,
      workArea.x + workArea.width,
      displayBounds.x,
      displayBounds.x + displayBounds.width,
    ]
    const snapTargetsY = [
      workArea.y,
      displayBounds.y,
    ]

    if (isVertical) {
      let minDiffLeft = Infinity
      let targetLeft = bounds.x
      for (const tx of snapTargetsX) {
        const diff = Math.abs(bounds.x - tx)
        if (diff < minDiffLeft) {
          minDiffLeft = diff
          targetLeft = tx
        }
      }

      let minDiffRight = Infinity
      let targetRight = bounds.x
      for (const tx of snapTargetsX) {
        const diff = Math.abs((bounds.x + bounds.width) - tx)
        if (diff < minDiffRight) {
          minDiffRight = diff
          targetRight = tx - bounds.width
        }
      }

      if (minDiffLeft <= SNAP_THRESHOLD && minDiffLeft <= minDiffRight) {
        newX = targetLeft
        snapped = true
      }
      else if (minDiffRight <= SNAP_THRESHOLD) {
        newX = targetRight
        snapped = true
      }
    }
    else if (isHorizontal) {
      let minDiffTop = Infinity
      let targetTop = bounds.y
      for (const ty of snapTargetsY) {
        const diff = Math.abs(bounds.y - ty)
        if (diff < minDiffTop) {
          minDiffTop = diff
          targetTop = ty
        }
      }

      let minDiffBottom = Infinity
      let targetBottom = bounds.y
      const snapTargetsBottom = [
        workArea.y + workArea.height,
        displayBounds.y + displayBounds.height,
      ]
      for (const ty of snapTargetsBottom) {
        const diff = Math.abs((bounds.y + bounds.height) - ty)
        if (diff < minDiffBottom) {
          minDiffBottom = diff
          targetBottom = ty - bounds.height
        }
      }

      if (minDiffTop <= SNAP_THRESHOLD && minDiffTop <= minDiffBottom) {
        newY = targetTop
        snapped = true
      }
      else if (minDiffBottom <= SNAP_THRESHOLD) {
        newY = targetBottom
        snapped = true
      }
    }

    // Enforce work area bounds clamping to ensure window stays visible within the viewport
    if (newX < workArea.x) {
      newX = workArea.x
      snapped = true
    }
    else if (newX + bounds.width > workArea.x + workArea.width) {
      newX = workArea.x + workArea.width - bounds.width
      snapped = true
    }

    if (newY < workArea.y) {
      newY = workArea.y
      snapped = true
    }
    else if (newY + bounds.height > workArea.y + workArea.height) {
      newY = workArea.y + workArea.height - bounds.height
      snapped = true
    }

    if (snapped && (Math.round(newX) !== bounds.x || Math.round(newY) !== bounds.y)) {
      setWindowFrame(window, {
        x: Math.round(newX),
        y: Math.round(newY),
        width: bounds.width,
        height: bounds.height,
      })
    }
  }, 150)

  void debouncedSnap

  // TODO(port): window.on('resize'|'move') — Electrobun emits no per-window move/resize event,
  // so bounds persistence must hook the native layer (docs/design-electrobun-port.md §3.1).
  // TODO(port): setupMainWindowElectronInvokes — the Control Strip RPC surface lands in wave 1
  // only as far as the splash + strip handlers; the remaining invokes are ported per surface.

  return window
}

interface ControlStripState {
  orientation?: 'vertical' | 'horizontal'
  stripLength?: number
  collapsed?: boolean
  backgroundColor?: string
  activePopover?: string | null
  lastPlacement?: string
}

/** The renderer writes this expando from its RPC handler; only its shape matters here. */
function isControlStripState(value: unknown): value is ControlStripState {
  return typeof value === 'object' && value !== null
}
