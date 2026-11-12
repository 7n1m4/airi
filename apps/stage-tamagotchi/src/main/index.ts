/**
 * AIRI Desktop — Electrobun (Bun) main process.
 *
 * Branch-based port of the Electron bootstrap. The ordered sequence that used to live in
 * `app.whenReady().then(...)` is now top-level `await`, because Bun runs the main module
 * immediately. Everything Electron-only is either replaced by an Electrobun/Node call or
 * turned into a `// TODO(port): …` line pointing at docs/design-electrobun-port.md §3.
 *
 * The `injeca.provide(...)` inventory is kept verbatim: the DI graph is the list of what
 * still has to be ported, and every not-yet-ported service/window throws
 * `ElectrobunPortError('not-implemented', '<name>')` from its build callback so the gap is
 * enumerable at runtime instead of silently missing.
 */

import type { FileLoggerHandle } from './app/file-logger'
import type { AnyEventaContext } from './rpc'

import path, { dirname } from 'node:path'
import process, { env, stderr, stdout } from 'node:process'

import { Buffer } from 'node:buffer'
import { fileURLToPath } from 'node:url'

import messages from '@proj-airi/i18n-bundle'
import Electrobun, { BuildConfig, Screen, Utils } from 'electrobun/main'

import { Format, LogLevel, setGlobalFormat, setGlobalHookPostLog, setGlobalLogLevel, useLogg } from '@guiiai/logg'
import { defineInvokeHandler } from '@moeru/eventa'
import { DEFAULT_CORS_BYPASS_URLS } from '@proj-airi/stage-shared'
import { createLoggLogger, injeca, lifecycle } from 'injeca'
import { isLinux } from 'std-env'

import {
  electronApplySizePreset,
  electronCaptionSetFollowStagePosition,
  electronCaptionSetFollowStageVisibility,
  electronCaptionSyncDocking,
  electronCaptionToggleVisibility,
  electronEnsureBeatSync,
  electronGetCaptionWindowState,
  electronGetChatWindowState,
  electronGetCorsBypassUrls,
  electronGetMonitorCount,
  electronGetStageDisabled,
  electronOpenChat,
  electronResetWindowPositions,
  electronSetCorsBypassUrls,
  electronSetIgnoreMouseEvents,
  electronShowToast,
  electronShowToastEvent,
  electronSplashDismiss,
  electronSplashGetSnapshot,
  electronSplashReportMilestone,
  electronSplashStateChanged,
  electronStageEnsure,
  electronStageRelease,
  electronStageSetAlwaysOnTop,
  electronStageToggleVisibility,
} from '../shared/eventa'
import { openDebugger, setupDebugger } from './app/debugger'
import { setupFileLogger } from './app/file-logger'
import { ensureLevelDBIntegrityOrHalt } from './app/leveldb-guard'
import { ensureLegacyUserDataMigrated } from './app/migration'
import { onBeforeQuit, runShutdown } from './app/shutdown'
import { claimSingleInstance, resolveUserDataPath } from './app/single-instance'
import { createGlobalAppConfig } from './configs/global'
import { emitAppReady } from './libs/bootkit/lifecycle'
import { setElectronMainDirname } from './libs/electrobun/location'
import { flushAllConfigs } from './libs/electron/persistence'
import { createI18n } from './libs/i18n'
import { createRpcBootstrap, ElectrobunPortError, notImplemented } from './rpc'
import { createAcpAgentsService, setupAcpAgentsManager } from './services/airi/acp-agents'
import { createAgenticService, setupAgenticService } from './services/airi/agentic'
import { createServerChannelService, setupServerChannel } from './services/airi/channel-server'
import { setupDiscordService } from './services/airi/discord'
import { createI18nService } from './services/airi/i18n'
import { createLibp2pService, setupLibp2pService } from './services/airi/libp2p'
import { createMcpServersService, setupMcpStdioManager } from './services/airi/mcp-servers'
import { setupPluginHost } from './services/airi/plugins'
import { createMicToggleService } from './services/airi/shortcuts/mic-toggle'
import { setupAutoUpdater } from './services/electron/auto-updater'
import { createVisionService } from './services/electron/vision'
import { createSensorsService } from './services/sensors'
import { cleanupMicToggleShortcut } from './services/shortcuts/mic-toggle'
import { setupTray } from './tray'
import { setupAboutWindowReusable } from './windows/about'
import { setupBeatSync } from './windows/beat-sync'
import { setupCaptionWindowManager } from './windows/caption'
import { setupChatWindowReusableFunc } from './windows/chat'
import { setupCustomizerWindowManager } from './windows/customizer'
import { setupDevtoolsWindow } from './windows/devtools'
import { setupMainWindow } from './windows/main'
import { setupNoticeWindowManager } from './windows/notice'
import { setupOnboardingWindowManager } from './windows/onboarding'
import { get, isDestroyed as registryIsDestroyed } from './windows/registry'
import { setupSettingsWindowReusableFunc } from './windows/settings'
import { setRpcBootstrap } from './windows/shared/create-window'
import { ensureWindowInVisibleBounds } from './windows/shared/display'
import { setupSplashWindowManager } from './windows/splash'
import { getStageVisibleState, isStageDisabledByFlag, setStageVisibleState, setupActorStageWindowManager } from './windows/stage'
import { setupWidgetsWindowManager } from './windows/widgets'

// ============================================================================
// Types describing the surfaces whose managers are registered but not yet ported
// ============================================================================

/** The slice of the caption manager the Control Strip invokes reach. */
interface CaptionLike {
  toggleVisibility: (enabled?: boolean) => Promise<void> | void
  triggerMove: (dock: string | undefined) => Promise<void> | void
  setFollowStagePosition: (follow: boolean) => Promise<void> | void
  setFollowStageVisibility: (follow: boolean) => Promise<void> | void
  getIsFollowingStageVisibility: () => boolean
}

interface ChatLike {
  openChat: (enabled?: boolean) => Promise<void> | void
}

/**
 * Inert stand-in for a window/service whose module is not ported yet (wave 3/4).
 *
 * Why a Proxy and not a plain object: each unported surface exposes a different method
 * set, and the DI graph only needs the handle to exist. A Proxy that raises on a real
 * property read gives an accurate error at the exact call site (`windows:chat.openChat`)
 * without maintaining a hand-written stub per module.
 *
 * `then` must be exempt: injeca stores each built instance and later `await`s it, and a
 * `then` that raises turns a not-yet-ported window into a DI start failure, which is
 * exactly what this helper exists to avoid. Symbol reads (e.g. `Symbol.toStringTag` from
 * a logger or an inspect call) are exempt for the same reason — only a named method read
 * is a real call site.
 */
function notPortedWindow<T extends object>(target: string): T {
  return new Proxy({} as T, {
    get(_receiver, property) {
      if (typeof property === 'symbol' || property === 'then')
        return undefined
      notImplemented(target)
    },
  })
}

/**
 * Run a not-yet-ported service setup without letting it abort the DI graph.
 *
 * `injeca.invoke` rejects the whole invoke on the first throw, so a wave-4 stub raising
 * `ElectrobunPortError` would prevent the app from starting at all. Each gap is logged with
 * its target name and swallowed, which keeps the remaining services running and the gap
 * enumerable in the log.
 */
async function setupOptionalService(target: string, setup: () => unknown | Promise<unknown>): Promise<void> {
  try {
    await setup()
  }
  catch (error) {
    console.warn(`[Main] Optional service not started (${target}):`, error instanceof Error ? error.message : error)
  }
}

// ============================================================================
// Stream guards (plain Node, ported verbatim)
// ============================================================================

function installStreamErrorGuards() {
  const guard = (error: NodeJS.ErrnoException) => {
    // Ignore broken pipe style errors from detached/closed console streams.
    if (error?.code === 'EPIPE' || error?.code === 'ERR_STREAM_DESTROYED')
      return

    // NOTICE: Attaching an 'error' listener marks the error as handled.
    // Re-throw unexpected stream errors so they still surface during development and crash reporting.
    throw error
  }

  stdout?.on('error', guard)
  stderr?.on('error', guard)
}

installStreamErrorGuards()

setElectronMainDirname(dirname(fileURLToPath(import.meta.url)))
setGlobalFormat(Format.Pretty)
setGlobalLogLevel(LogLevel.Log)
setupDebugger()

const log = useLogg('main').useGlobalConfig()
// NOTICE: Quit-time teardown must reach the sensors service even when the DI callback that
// creates it never runs (a failed `injeca.start()` or an earlier throw), so the promise is
// hoisted here; `stop` is the subset `before-quit` needs.
let pendingSensorsService: Promise<Pick<Awaited<ReturnType<typeof createSensorsService>>, 'stop'>> | undefined

// TODO(port): the Chromium switch block (`SharedArrayBuffer`, `Vulkan`, `enable-unsafe-webgpu`,
// Dawn `vulkan_enable_f16_on_nvidia`, Ozone platform, `force-high-performance-gpu`) becomes
// `build.{linux,mac,win}.chromiumFlags` in electrobun.config.ts — see docs/design-electrobun-port.md §3.1
if (isLinux && env.AIRI_FORCE_HIGH_PERFORMANCE_GPU === '1')
  console.info('[AIRI] High-performance GPU overrides requested via AIRI_FORCE_HIGH_PERFORMANCE_GPU=1 (chromiumFlags pending)')

// ============================================================================
// User data, migration, LevelDB pre-flight
// ============================================================================

// NOTICE: Electron allowed `app.setPath('userData', …)`; Electrobun exposes `Utils.paths.userData`
// only, so the AIRI/APP overrides are resolved here and every consumer reads the resolved value.
const userDataPath = resolveUserDataPath()
const effectiveUserDataPath = ensureLegacyUserDataMigrated(userDataPath)
if (effectiveUserDataPath && effectiveUserDataPath !== userDataPath)
  console.warn(`[Main] Using migrated user data directory: ${effectiveUserDataPath}`)

// Pre-flight check: intercept LevelDB corruption before Chromium can delete user data
ensureLevelDBIntegrityOrHalt(userDataPath)

// TODO(port): app.dock?.setIcon(icon) — Electrobun exposes no dock icon setter.
// TODO(port): electronApp.setAppUserModelId('ai.moeru.airi.dasilva333') — the Windows taskbar
// identity comes from the packaged appId in electrobun.config.ts.

// NOTICE: Renderer-supplied paths reach the filesystem through this helper.
// `path.resolve` discards the root when a segment is absolute, so a leading `/`
// in `relPath` would otherwise escape any containment check.
function resolveInside(root: string, ...segments: string[]): string | null {
  if (segments.some(segment => path.isAbsolute(segment) || segment === '..'))
    return null
  const resolved = path.resolve(root, ...segments)
  return resolved === root || resolved.startsWith(root + path.sep) ? resolved : null
}

// NOTICE: Open the session log file at module scope: the DI `invoke` callback only runs after
// the graph builds, so anything the logger misses before then (including a failed boot) is lost.
const fileLogger: FileLoggerHandle = await setupFileLogger()
if (fileLogger.logFilePath) {
  // NOTICE: `formattedOutput` carries ANSI colours under Format.Pretty; JSON keeps the file plain.
  setGlobalHookPostLog(log => void fileLogger.appendLog(JSON.stringify(log)))
}

// ============================================================================
// Single instance
// ============================================================================

// TODO(port): the Electron build relied on `app.requestSingleInstanceLock()`; this is the
// lockfile equivalent (see app/single-instance.ts).
const singleInstance = claimSingleInstance(userDataPath, 'main')
if (!singleInstance.primary) {
  console.info('[@proj-airi/stage-tamagotchi] Another instance owns the profile; exiting.')
  process.exit(0)
}

// TODO(port): initScreenCaptureForMain() — @proj-airi/electron-screen-capture is Electron-only
// (desktopCapturer); the Electrobun equivalent is Screen.captureRegion (wave 4).
// TODO(port): BrowserWindow.prototype method guards + `isDestroyed` wrappers — the registry's
// WeakSet replaces them (see windows/registry.ts).
// TODO(port): `session.defaultSession.webRequest` CORS bypass and the `will-download`
// interception — see docs/design-electrobun-port.md §3.1.

// NOTICE: splash dismissal lives at module scope so the invoke handler and the 30s backstop
// share one value even when the DI callback never runs.
let splashDismissed = false

async function boot() {
  injeca.setLogger(createLoggLogger(useLogg('injeca').useGlobalConfig()))

  const appConfig = injeca.provide('configs:app', () => createGlobalAppConfig())
  const hostApp = injeca.provide('host:electrobun:app', () => Electrobun)
  const autoUpdater = injeca.provide('services:auto-updater', () => setupAutoUpdater())

  const i18n = injeca.provide('libs:i18n', {
    dependsOn: { appConfig },
    build: ({ dependsOn }) => {
      const language = dependsOn.appConfig.get()?.language ?? 'en'
      return createI18n({ messages, locale: language })
    },
  })

  const serverChannel = injeca.provide('modules:channel-server', {
    dependsOn: { app: hostApp, lifecycle },
    build: async ({ dependsOn }) => setupServerChannel(dependsOn),
  })

  const mcpStdioManager = injeca.provide('modules:mcp-stdio-manager', {
    build: async () => setupMcpStdioManager(),
  })
  const acpAgentsManager = injeca.provide('modules:acp-agents-manager', {
    build: async () => setupAcpAgentsManager(),
  })

  const libp2p = injeca.provide('modules:libp2p', {
    dependsOn: { lifecycle },
    build: async ({ dependsOn }) => setupLibp2pService(dependsOn),
  })

  const agenticOs = injeca.provide('modules:agentic-os', {
    dependsOn: { lifecycle },
    build: async ({ dependsOn }) => setupAgenticService(dependsOn),
  })

  const pluginHost = injeca.provide('modules:plugin-host', {
    dependsOn: { serverChannel },
    build: () => setupPluginHost(),
  })

  // NOTICE: wave 3 — every window below keeps its registration so the DI graph stays the
  // inventory. Each resolves to an inert `NotPortedWindow` rather than throwing: a throwing
  // `build` aborts the whole DI graph, so the app would never reach the splash and the
  // remaining surface could not be enumerated at runtime. Every method on the handle raises
  // `ElectrobunPortError`, so a caller reaching for an unported window fails loudly at the
  // call site instead of silently doing nothing.
  const beatSync = injeca.provide('windows:beat-sync', () => notPortedWindow('windows:beat-sync'))
  const devtoolsMarkdownStressWindow = injeca.provide('windows:devtools:markdown-stress', () => notPortedWindow('windows:devtools:markdown-stress'))

  const widgetsManager = injeca.provide('windows:widgets', {
    dependsOn: { serverChannel, i18n },
    build: () => notPortedWindow('windows:widgets'),
  })

  const onboardingWindowManager = injeca.provide('windows:onboarding', {
    dependsOn: { serverChannel, i18n, widgetsManager },
    build: () => notPortedWindow('windows:onboarding'),
  })
  const noticeWindow = injeca.provide('windows:notice', {
    dependsOn: { i18n, serverChannel },
    build: () => notPortedWindow('windows:notice'),
  })

  const aboutWindow = injeca.provide('windows:about', {
    dependsOn: { autoUpdater, i18n, serverChannel },
    build: () => notPortedWindow('windows:about'),
  })

  const settingsWindow = injeca.provide('windows:settings', {
    dependsOn: { widgetsManager, beatSync, autoUpdater, devtoolsMarkdownStressWindow, serverChannel, mcpStdioManager, acpAgentsManager, i18n },
    build: () => notPortedWindow('windows:settings'),
  })

  const chatWindow = injeca.provide('windows:chat', {
    dependsOn: { widgetsManager, serverChannel, mcpStdioManager, acpAgentsManager, i18n, appConfig, settingsWindow },
    build: () => notPortedWindow('windows:chat'),
  })

  // NOTICE: The stage manager is cheap to construct (no BrowserWindow yet).
  // The window itself is created lazily via `electronStageEnsure` once the
  // Control Strip resolves the active card's `displayModelId` (Main has no
  // IndexedDB access). Text-only companions never allocate it.
  const stageWindow = injeca.provide('windows:stage', {
    dependsOn: { appConfig, serverChannel, i18n },
    build: () => notPortedWindow('windows:stage'),
  })

  // NOTICE: the RPC bootstrap must exist before any window is created — `createViewWindow`
  // reads it from the shared slot, and the splash is the first view.
  const rpc = await createRpcBootstrap({
    dismissSplash: () => splashWindowManager.destroy(),
  })
  setRpcBootstrap(rpc)

  // NOTICE: the splash is created immediately so the OS paints the frameless card before the
  // heavy DI graph resolves.
  const splashWindowManager = await setupSplashWindowManager()
  const splashWindow = injeca.provide('windows:splash', () => splashWindowManager)

  const mainWindow = injeca.provide('windows:main', {
    dependsOn: { settingsWindow, stageWindow, chatWindow, widgetsManager, noticeWindow, beatSync, autoUpdater, serverChannel, mcpStdioManager, acpAgentsManager, i18n, onboardingWindowManager, appConfig },
    // NOTICE: Initial show is deferred until `electronSplashDismiss` fires.
    build: async ({ dependsOn }) => setupMainWindow({ ...dependsOn, deferInitialShow: true }),
  })

  const captionWindow = injeca.provide('windows:caption', {
    dependsOn: { mainWindow, stageWindow, serverChannel, i18n, appConfig },
    build: () => notPortedWindow('windows:caption'),
  })

  const customizerWindow = injeca.provide('windows:customizer', {
    dependsOn: { mainWindow, serverChannel, i18n },
    build: () => notPortedWindow('windows:customizer'),
  })

  const tray = injeca.provide('app:tray', {
    dependsOn: { mainWindow, settingsWindow, onboardingWindow: onboardingWindowManager, captionWindow, widgetsWindow: widgetsManager, serverChannel, beatSyncBgWindow: beatSync, aboutWindow, i18n, appConfig, chatWindow, stageWindow, customizerWindow },
    build: () => notPortedWindow('app:tray'),
  })

  // NOTICE: the module-scope splash relay state lives here so the handler and the backstop
  // below see one value even if the DI callback never reaches this point.
  const STARTUP_MILESTONE_IDS = ['core-services', 'sync-engine', 'character-card', 'stage-actor'] as const
  const startupMilestones = new Map<string, { id: string, status: string, error?: string }>(
    STARTUP_MILESTONE_IDS.map(id => [id, { id, status: 'queued' }]),
  )
  let lastSnapshot: unknown

  const buildStartupSnapshot = () => {
    const resources = STARTUP_MILESTONE_IDS.map(id => ({ ...startupMilestones.get(id)! }))
    const finished = resources.filter(r => r.status === 'ready' || r.status === 'skipped').length
    return {
      resources,
      progress: Math.round((finished / resources.length) * 100),
      ready: resources.length > 0 && resources.every(r => r.status === 'ready' || r.status === 'skipped'),
      failed: resources.find(r => r.status === 'failed'),
    }
  }

  const emitStartupSnapshot = () => {
    lastSnapshot = buildStartupSnapshot()
    rpc.broadcast(electronSplashStateChanged, lastSnapshot)
  }

  injeca.invoke({
    dependsOn: { mainWindow, tray, serverChannel, pluginHost, mcpStdioManager, acpAgentsManager, onboardingWindow: onboardingWindowManager, appConfig, i18n, captionWindow, stageWindow, splashWindow, chatWindow, customizerWindow, beatSync, libp2p, agenticOs },
    callback: async (deps) => {
      // NOTICE: `setupMainWindow` registers the Control Strip in the window registry; the DI
      // dependency is the `BrowserView` it returns, so read the view back out of the registry.
      const mainWindowView = get('main')?.webview
      if (!mainWindowView)
        throw new ElectrobunPortError('unsupported', 'Control Strip view was not created')
      const context: AnyEventaContext = await rpc.contextFor(mainWindowView)

      // NOTICE: `stage:capture-window` ghosts the stage window (show inactive → hide) purely to
      // produce a screenshot. Those synthetic show/hide events must not be treated as user-driven
      // visibility changes, so listeners check this flag and skip caption-follow handling during capture.
      const isCapturingStage = false
      // NOTICE: The renderer always pushes its persisted `settings/caption-open` state once on boot
      // (immediate watcher in `pages/index.vue`). We gate caption auto-restores/follows on this so a
      // transient stage show or main-window restore can't flash the caption before the renderer's
      // authoritative state has arrived (mirrors the stage default-visible boot pattern).
      let captionOpenFromRenderer: boolean | undefined

      // Single owner of the stage→caption follow rule (the renderer no longer mirrors these).
      const syncCaptionToStage = (stageVisible: boolean, opts?: { captureInFlight?: boolean }) => {
        const caption = deps.captionWindow as CaptionLike | undefined
        if (!caption || typeof caption.getIsFollowingStageVisibility !== 'function')
          return
        if (!caption.getIsFollowingStageVisibility() || opts?.captureInFlight)
          return
        // Hide always applies. Show is deferred until the renderer pushes `caption-open`
        // so a boot-time transient can't flash the caption against the persisted preference.
        if (!stageVisible)
          void caption.toggleVisibility(false)
        else if (captionOpenFromRenderer !== undefined)
          void caption.toggleVisibility(captionOpenFromRenderer)
      }

      createServerChannelService({ serverChannel: deps.serverChannel })
      createMcpServersService({ context, manager: deps.mcpStdioManager })
      createAcpAgentsService({ context, manager: deps.acpAgentsManager })
      await createI18nService({ context, window: mainWindowView as never, i18n: deps.i18n })
      // NOTICE: wave 4 surfaces raise ElectrobunPortError from their setup (globalShortcut,
      // desktopCapturer, powerMonitor, Opus). Best-effort, so a missing feature cannot abort
      // `injeca.invoke` and take the whole app down with it.
      await setupOptionalService('services:mic-toggle', () => createMicToggleService({ context, window: mainWindowView as never }))
      await setupOptionalService('services:vision', async () => createVisionService({ context }))
      await createLibp2pService({ context })
      await createAgenticService({ context })
      await setupOptionalService('services:sensors', async () => {
        pendingSensorsService = createSensorsService({ context })
      })
      await setupOptionalService('services:discord', () => setupDiscordService())

      defineInvokeHandler(context, electronSplashGetSnapshot, async () => lastSnapshot ?? buildStartupSnapshot())

      defineInvokeHandler(context, electronSplashReportMilestone, async (payload) => {
        if (!payload || !STARTUP_MILESTONE_IDS.includes(payload.id as typeof STARTUP_MILESTONE_IDS[number]))
          return
        startupMilestones.set(payload.id, { id: payload.id, status: payload.status, error: payload.error })
        emitStartupSnapshot()
      })

      defineInvokeHandler(context, electronSplashDismiss, async () => {
        if (splashDismissed)
          return
        splashDismissed = true
        await rpc.startup.dismiss()
        if (!registryIsDestroyed(mainWindowView as never))
          get('main')?.show()
        if (getStageVisibleState())
          get('stage')?.show()
        restoreCaption()
      })

      const defaultBypassUrls = DEFAULT_CORS_BYPASS_URLS
      const coalesceCorsBypassUrls = (userUrls?: string[]): string[] => {
        const list = Array.isArray(userUrls) ? [...userUrls] : []
        for (const url of defaultBypassUrls) {
          if (!list.includes(url))
            list.push(url)
        }
        return list
      }

      // Auto-update config if new defaults were merged in
      const currentConfig = deps.appConfig.get()
      if (currentConfig) {
        deps.appConfig.update({
          ...currentConfig,
          corsBypassUrls: coalesceCorsBypassUrls(currentConfig.corsBypassUrls),
        })
      }

      defineInvokeHandler(context, electronGetCorsBypassUrls, async () => {
        return coalesceCorsBypassUrls(deps.appConfig.get()?.corsBypassUrls)
      })

      defineInvokeHandler(context, electronSetCorsBypassUrls, async (urls) => {
        const coalesced = coalesceCorsBypassUrls(urls)
        const cfg = deps.appConfig.get()
        if (cfg) {
          deps.appConfig.update({
            ...cfg,
            corsBypassUrls: coalesced,
          })
        }
        // TODO(port): registerCorsBypass() — session.webRequest has no Electrobun equivalent.
      })

      defineInvokeHandler(context, electronCaptionToggleVisibility, async (enabled?: boolean) => {
        console.info('[@proj-airi/stage-tamagotchi] [Main] Caption visibility toggle triggered via Control Island. enabled:', enabled)
        if (enabled !== undefined)
          captionOpenFromRenderer = enabled
        await (deps.captionWindow as CaptionLike).toggleVisibility(enabled)
      })

      defineInvokeHandler(context, electronGetChatWindowState, async () => {
        const isOpen = Boolean(get('chat')?.isVisible())
        console.info('[@proj-airi/stage-tamagotchi] [Main] Retrieved chat window state:', isOpen)
        return isOpen
      })

      defineInvokeHandler(context, electronGetCaptionWindowState, async () => {
        const winEnabled = deps.appConfig.get()?.windows?.find(w => w.tag === 'caption')?.enabled
        const winVisible = Boolean(get('caption')?.isVisible())
        return Boolean(winEnabled || winVisible)
      })

      defineInvokeHandler(context, electronEnsureBeatSync, async () => {
        notImplemented('windows:beat-sync')
      })

      defineInvokeHandler(context, electronCaptionSyncDocking, async (dock) => {
        console.info('[@proj-airi/stage-tamagotchi] [Main] Caption docking sync triggered via Control Island:', dock)
        const appConfig = deps.appConfig.get()
        if (appConfig) {
          const windows = appConfig.windows ?? []
          const index = windows.findIndex(w => w.tag === 'caption')
          if (index !== -1)
            windows[index] = { ...windows[index], dock }
          else
            windows.push({ tag: 'caption', enabled: Boolean(get('caption')?.isVisible()), dock })
          deps.appConfig.update({ ...appConfig, windows })
        }
        await (deps.captionWindow as CaptionLike).triggerMove(dock)
      })

      defineInvokeHandler(context, electronCaptionSetFollowStagePosition, async (shouldFollow) => {
        await (deps.captionWindow as CaptionLike).setFollowStagePosition(shouldFollow)
      })

      defineInvokeHandler(context, electronCaptionSetFollowStageVisibility, async (shouldFollow) => {
        await (deps.captionWindow as CaptionLike).setFollowStageVisibility(shouldFollow)
      })

      defineInvokeHandler(context, electronSetIgnoreMouseEvents, async (ignore) => {
        // TODO(port): Electron's `setIgnoreMouseEvents(bool, { forward })` — Electrobun has
        // creation-time `passthrough` only; the toggle must go through webviewSetPassthrough.
        void ignore
      })

      defineInvokeHandler(context, electronStageToggleVisibility, async (enabled: boolean) => {
        console.info('[@proj-airi/stage-tamagotchi] [Main] Actor Stage visibility changed:', enabled)
        setStageVisibleState(enabled)
        if (enabled)
          get('stage')?.show()
        else
          get('stage')?.hide()
        // NOTICE: Main process is the single owner of the stage→caption follow. The renderer
        // only sets `captionOpen` for bookkeeping; it does not separately toggle the caption.
        syncCaptionToStage(enabled, { captureInFlight: isCapturingStage })
      })

      defineInvokeHandler(context, electronOpenChat, async (enabled?: boolean) => {
        await (deps.chatWindow as ChatLike).openChat(enabled)
      })

      defineInvokeHandler(context, electronStageSetAlwaysOnTop, async (flag) => {
        get('stage')?.setAlwaysOnTop(flag)
      })

      defineInvokeHandler(context, electronGetStageDisabled, async () => isStageDisabledByFlag())

      defineInvokeHandler(context, electronStageEnsure, async () => {
        // TODO(port): stage window creation (wave 3) — the manager is registered but its build
        // throws, so the Control Strip's first ensure rejects until then.
        const window = get('stage')
        // Late ensures (card switches after the splash is gone) show immediately,
        // but only when the user intends the stage visible. Blindly showing here
        // re-surfaces a hidden stage on every Control Strip reload (the stray
        // `show` event then flips persisted `stageEnabled` false→true).
        if (window && splashDismissed && getStageVisibleState() && !registryIsDestroyed(window))
          window.show()
        return { created: Boolean(window) }
      })

      defineInvokeHandler(context, electronStageRelease, async () => {
        // Full release: hide freezes the loops, close frees the Chromium
        // renderer + GPU contexts (~200MB+) for text-only companions.
        get('stage')?.hide()
        get('stage')?.close()
      })

      defineInvokeHandler(context, electronShowToast, async (payload) => {
        if (!payload)
          return
        const target = get('chat') ?? get('stage') ?? get('main')
        if (target && !registryIsDestroyed(target))
          rpc.broadcast(electronShowToastEvent, payload)
      })

      defineInvokeHandler(context, electronGetMonitorCount, async () => {
        return Screen.getAllDisplays().length
      })

      // TODO(port): `show-os-notification` — Electrobun's Utils.showNotification carries
      // title/body/silent directly (no `Notification.isSupported()` gate).
      // TODO(port): electronApplySizePreset, electronResetWindowPositions and the raw
      // `ipcMain.handle` channels (backup bundle, BYOS-FS, renderer logger, stage capture) —
      // each needs the per-view RPC surface (wave 3/4); their Electron-only parts
      // (screen.getAllDisplays, webContents.send, capturePage) have no Electrobun counterpart yet.

      const restoreCaption = () => {
        const caption = deps.captionWindow as CaptionLike | undefined
        if (!caption)
          return
        // Restore to the renderer-authoritative state (exactly one push arrives at boot), else the
        // persisted `windows[].enabled` entry. Explicit true/false only — never blind-toggle.
        const wasEnabled = captionOpenFromRenderer
          ?? deps.appConfig.get()?.windows?.find(w => w.tag === 'caption')?.enabled
        const isNowVisible = Boolean(get('caption')?.isVisible())
        if (wasEnabled && !isNowVisible)
          void caption.toggleVisibility(true)
        else if (!wasEnabled && isNowVisible)
          void caption.toggleVisibility(false)
      }

      // NOTICE: Caption restore is deferred until splash dismissal so the caption cannot pop in
      // before the coordinated reveal.
      setTimeout(() => {
        if (splashDismissed)
          return
        console.warn('[@proj-airi/stage-tamagotchi] [Main] Splash did not dismiss in time, forcing coordinated reveal.')
        splashDismissed = true
        if (!registryIsDestroyed(mainWindowView as never))
          mainWindowView && get('main')?.show()
        if (getStageVisibleState())
          get('stage')?.show()
        restoreCaption()
        splashWindowManager.destroy()
      }, 30000)

      // NOTICE: Quit-time teardown of DI-built services is owned by the module-scope
      // `before-quit` coordinator below, so it also runs when this callback never executes.
      void resolveInside
      void Buffer
      void electronApplySizePreset
      void electronResetWindowPositions
      void ensureWindowInVisibleBounds
      void setupActorStageWindowManager
      void setupAboutWindowReusable
      void setupBeatSync
      void setupCaptionWindowManager
      void setupChatWindowReusableFunc
      void setupCustomizerWindowManager
      void setupDevtoolsWindow
      void setupNoticeWindowManager
      void setupOnboardingWindowManager
      void setupSettingsWindowReusableFunc
      void setupTray
      void setupWidgetsWindowManager
    },
  })

  injeca.start().catch((err) => {
    console.error('[Main] DI start failed, services are not running:', err)
  })

  emitAppReady()
  openDebugger()

  // TODO(port): app.on('browser-window-created') — Electron mirrors renderer console output
  // into the session log; Electrobun exposes no per-webview console hook yet.
}

// ============================================================================
// Shutdown
// ============================================================================

onBeforeQuit(async () => {
  try {
    // NOTICE: We await the DI container stop sequence so every service can flush state or
    // close handles.
    await injeca.stop()
  }
  catch (err) {
    console.error('[@proj-airi/stage-tamagotchi] Error during DI shutdown:', err)
  }

  try {
    // NOTICE: Sensor polling is started at module scope by `createSensorsService`, so stop
    // it here rather than in a DI callback that may never run.
    const sensorsService = await pendingSensorsService
    // NOTICE: `undefined` means the DI callback never reached the service (nothing to stop).
    sensorsService?.stop()
  }
  catch (err) {
    console.error('[@proj-airi/stage-tamagotchi] Failed to stop sensors service:', err)
  }

  try {
    flushAllConfigs()
  }
  catch (err) {
    console.error('[@proj-airi/stage-tamagotchi] Failed to flush configs:', err)
  }

  try {
    cleanupMicToggleShortcut()
  }
  catch (err) {
    console.error('[@proj-airi/stage-tamagotchi] Failed to release global shortcuts:', err)
  }

  // NOTICE: The session log must close last, and the quit must happen even if a step above threw.
  try {
    await fileLogger.close()
  }
  catch (err) {
    console.error('[@proj-airi/stage-tamagotchi] Failed to close the session log:', err)
  }
})

// NOTICE: Electrobun's `before-quit` carries an `{ allow }` response rather than an async
// `preventDefault`, so teardown runs once (idempotently) and the originating quit proceeds.
Electrobun.events.on('before-quit', () => {
  void runShutdown()
})

// NOTICE: Handle termination signals so a terminal-launched app still tears down when the
// terminal that started it goes away.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    void runShutdown().finally(() => Utils.quit())
  })
}

// TODO(port): app.on('window-all-closed') / app.on('activate') — Electrobun exposes neither;
// `runtime.exitOnLastWindowClosed` covers the quit side, and the macOS dock-click restore is
// expressed through the window registry (see windows/registry.ts).

boot().catch((err) => {
  log.withError(err).error('Error during app initialization')
})

// NOTICE: kept referenced so the module graph keeps the build-config read (the CEF/dev
// channel decides whether the dev-server URL or `views://` is used).
void BuildConfig
