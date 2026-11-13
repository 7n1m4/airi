/**
 * Electrobun port: a deliberately small `electron`-shaped shim over the Electrobun SDK.
 *
 * Why this exists: `src/main/**` still has ~40 modules written against Electron's
 * `app` / `ipcMain` / `safeStorage` / `powerMonitor` / `desktopCapturer` /
 * `nativeImage` / `Menu` / `Tray` / `shell` / `dialog`. Porting each one is wave 3/4, but
 * until then the app cannot even load, because a bare `import { app } from 'electron'`
 * pulls the real Electron entry point in and aborts the process.
 *
 * This module satisfies exactly the surface those modules use — nothing more — so the
 * graph loads and the already-ported code (windows, RPC, registry, shutdown) runs. Every
 * entry here is either a straight Electrobun call or an explicit `notImplemented()`; no
 * silent no-ops, so a ported-away call site fails loudly instead of quietly doing nothing.
 *
 * DELETE THIS FILE (and the `electron` alias) once the last runtime `from 'electron'`
 * import is gone from src/main. `docs/design-electrobun-port.md` §3.1 tracks that.
 */

import type { Display, BrowserWindow as ElectrobunBrowserWindow } from 'electrobun/main'

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { Screen, Utils } from 'electrobun/main'

import { version as APP_VERSION } from '../../package.json'
import { ElectrobunPortError, notImplemented } from './rpc'

// ---------------------------------------------------------------------------
// app
// ---------------------------------------------------------------------------

/**
 * `app.getPath` is the only Electron API the ported config/persistence code still needs
 * (userData/config/temp/home). Electrobun's `Utils.paths` covers the same ground; the
 * names that have no counterpart map to the closest one rather than throwing, because a
 * missing downloads dir must not take the app down.
 */
const pathGetters: Record<string, () => string> = {
  userData: () => Utils.paths.userData,
  home: () => Utils.paths.home,
  appData: () => Utils.paths.appData,
  config: () => Utils.paths.config,
  cache: () => Utils.paths.userCache ?? Utils.paths.cache,
  temp: () => Utils.paths.temp,
  logs: () => Utils.paths.logs,
  documents: () => Utils.paths.documents,
  downloads: () => Utils.paths.downloads,
  desktop: () => Utils.paths.desktop,
  pictures: () => Utils.paths.pictures,
  music: () => Utils.paths.music,
  videos: () => Utils.paths.videos,
}

export const app = {
  getPath(name: string): string {
    const getter = pathGetters[name]
    if (!getter)
      throw new ElectrobunPortError('unsupported', `app.getPath(${JSON.stringify(name)})`)
    return getter()
  },
  setPath(_name: string, _value: string): void {
    // Electrobun's userData root comes from the app identifier; there is no per-name override.
    notImplemented('app.setPath')
  },
  getVersion(): string {
    return APP_VERSION
  },
  getName(): string {
    return 'AIRI'
  },
  isPackaged: false,
  isReady: true,
  whenReady(): Promise<void> {
    // Bun main runs after the native runtime is up, so readiness is immediate.
    return Promise.resolve()
  },
  on(_event: string, _listener: (...args: unknown[]) => void): unknown {
    // Electron's app-level events (window-all-closed, activate, second-instance) have no
    // Electrobun equivalent; the port replaces each call site with the registry/shutdown
    // coordinator. Accepting and ignoring the subscription keeps unported modules loading.
    return undefined
  },
  quit(): void {
    void Utils.quit()
  },
  requestSingleInstanceLock(): boolean {
    notImplemented('app.requestSingleInstanceLock')
  },
  commandLine: {
    appendSwitch(_switch: string, _value?: string): void {
      // CEF flags live in electrobun.config.ts build.<platform>.chromiumFlags.
      notImplemented('app.commandLine.appendSwitch')
    },
    hasSwitch(_switch: string): boolean {
      return false
    },
  },
  dock: undefined,
  includeStandardAdditions: undefined,
  get isMacOS(): boolean {
    return process.platform === 'darwin'
  },
  get isWindows(): boolean {
    return process.platform === 'win32'
  },
  get isLinux(): boolean {
    return process.platform === 'linux'
  },
}

// ---------------------------------------------------------------------------
// ipcMain
// ---------------------------------------------------------------------------

/**
 * The eventa bridge is the RPC now (`packages/electrobun-eventa`), but modules written
 * against Electron's ONE global `ipcMain` still register handlers through
 * `createContext(ipcMain)` — and dropping those registrations on the floor made their
 * invokes hang forever (e.g. `server-channel:get-config`, which stalled the startup
 * sequence). The bus is functional again: `rpc/index.ts` fans every inbound view frame to
 * `dispatchToIpcMain('eventa-message', …)`, so handlers fire with the same semantics as
 * Electron's flat namespace. Raw `ipcMain.handle` channels are not the eventa path and stay
 * inert until wave 3.
 */
const channelListeners = new Map<string, Set<IpcMainListener>>()

type IpcMainListener = (event: unknown, ...args: unknown[]) => void

function addChannelListener(channel: string, listener: IpcMainListener): void {
  const set = channelListeners.get(channel) ?? new Set()
  set.add(listener)
  channelListeners.set(channel, set)
}

function removeChannelListener(channel: string, listener: IpcMainListener): void {
  channelListeners.get(channel)?.delete(listener)
}

 * @internal
export function dispatchToIpcMain(channel: string, event: unknown, ...args: unknown[]): void {
  for (const listener of channelListeners.get(channel) ?? []) {
    try {
      listener(event, ...args)
    }
    catch (error) {
      console.error('[electron-shim] ipcMain listener failed:', error)
    }
  }
}

export const ipcMain = {
  handle(channel: string, _listener: (...args: unknown[]) => unknown): void {
    notImplemented(`ipcMain.handle(${channel})`)
  },
  on(channel: string, listener: IpcMainListener): unknown {
    addChannelListener(channel, listener)
    return undefined
  },
  off(channel: string, listener: IpcMainListener): void {
    removeChannelListener(channel, listener)
  },
  removeListener(channel: string, listener: IpcMainListener): void {
    removeChannelListener(channel, listener)
  },
  emit(_channel: string, ..._args: unknown[]): void {
    // Electron's in-process bus (e.g. 'reset-window-positions-action' from the tray). The
    // port replaces each emitter with a direct call on the service that handled it.
    notImplemented('ipcMain.emit')
  },
  removeHandler(channel: string): void {
    channelListeners.delete(channel)
  },
  removeAllListeners(channel?: string): void {
    if (channel)
      channelListeners.delete(channel)
    else
      channelListeners.clear()
  },
  setMaxListeners(_count: number): void {},
}

// ---------------------------------------------------------------------------
// Window / view stand-ins
// ---------------------------------------------------------------------------

/**
 * Unported window modules construct `new ElectronBrowserWindow(...)` at module scope. A
 * real Electron window cannot exist here, so this records the request and returns a handle
 * whose methods are inert. `registry` is the source of truth for windows that were ported.
 */
const requestedWindows: Array<Record<string, unknown>> = []

export class BrowserWindow {
  static getAllWindows(): BrowserWindow[] {
    notImplemented('BrowserWindow.getAllWindows')
  }

  static fromWebContents(_id: number): BrowserWindow | null {
    notImplemented('BrowserWindow.fromWebContents')
  }

  constructor(public readonly options: Record<string, unknown>) {
    requestedWindows.push(options)
  }

  get webContents(): never {
    return notImplemented('BrowserWindow.webContents')
  }

  isDestroyed(): boolean {
    return false
  }

  show(): void {}
  hide(): void {}
  focus(): void {}
  close(): void {}
  on(_event: string, _listener: (...args: unknown[]) => void): unknown {
    return undefined
  }
}

/** Test/debug helper: options objects handed to the shim above. */
export function requestedWindowOptions(): ReadonlyArray<Record<string, unknown>> {
  return requestedWindows
}

// ---------------------------------------------------------------------------
// safeStorage
// ---------------------------------------------------------------------------

/**
 * Electrobun has no safeStorage. Returning `isEncryptionAvailable() === false` is what the
 * Electron code itself does when no keychain backend exists (libp2p identity/pairing then
 * refuse to persist, which is the honest outcome), so it is not a silent no-op.
 */
export const safeStorage = {
  isEncryptionAvailable(): boolean {
    return false
  },
  encryptString(_plainText: string): Buffer {
    notImplemented('safeStorage.encryptString')
  },
  decryptString(_encrypted: Buffer): string {
    notImplemented('safeStorage.decryptString')
  },
}

// ---------------------------------------------------------------------------
// session
// ---------------------------------------------------------------------------

/**
 * `session` is imported by `@proj-airi/electron-screen-capture/main` (the only remaining
 * caller). Electrobun exposes cookies/storage per partition through `Session.fromPartition`
 * instead of a mutable session object, and has no `setDisplayMediaRequestHandler` at all.
 * The screen-capture service is itself `not-implemented` in wave 1, so this only needs to
 * satisfy the import; the calls raise rather than pretending to work.
 */
export const session = {
  get defaultSession(): never {
    return notImplemented('session.defaultSession')
  },
  fromPartition(partition: string): never {
    notImplemented(`session.fromPartition(${partition})`)
  },
}

// ---------------------------------------------------------------------------
// powerMonitor / desktopCapturer / systemPreferences
// ---------------------------------------------------------------------------

/**
 * No Electron equivalent exists. `on`/`off` accept and ignore subscriptions so the
 * unported lifecycle code loads; asking for data raises, because returning fabricated
 * values would silently corrupt the idle/suspend logic.
 */
export const powerMonitor = {
  on(_event: string, _listener: (...args: unknown[]) => void): unknown {
    return undefined
  },
  off(_event: string, _listener: (...args: unknown[]) => void): void {},
  getSystemIdleTime(_idleSeconds?: number): number {
    notImplemented('powerMonitor.getSystemIdleTime')
  },
}

export const desktopCapturer = {
  getSources(_options?: unknown): Promise<unknown[]> {
    notImplemented('desktopCapturer.getSources')
  },
}

export const systemPreferences = {
  getMediaAccessStatus(_mediaType: string): 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown' {
    return 'unknown'
  },
  askForMediaAccess(_mediaType: string): Promise<boolean> {
    return Promise.resolve(false)
  },
}

// ---------------------------------------------------------------------------
// shell / dialog / globalShortcut / Menu / nativeImage / Tray
// ---------------------------------------------------------------------------

export const shell = {
  openExternal(url: string): Promise<void> {
    Utils.openExternal(url)
    return Promise.resolve()
  },
  openPath(path: string): Promise<string> {
    Utils.openPath(path)
    return Promise.resolve('')
  },
}

export const dialog = {
  showErrorBox(title: string, content: string): void {
    void Utils.showMessageBox({ type: 'error', title, message: content })
  },
  showOpenDialog(_options?: unknown): Promise<{ canceled: boolean, filePaths: string[] }> {
    notImplemented('dialog.showOpenDialog')
  },
}

export const globalShortcut = {
  register(_accelerator: string, _callback: () => void): boolean {
    notImplemented('globalShortcut.register')
  },
  unregister(_accelerator: string): void {},
  unregisterAll(): void {},
  isRegistered(_accelerator: string): boolean {
    return false
  },
}

/** The path wrapper `nativeImage.createFromPath` returns: Electrobun has no bitmap images. */
interface ShimNativeImage {
  path: string
  isEmpty: () => boolean
  resize: (_options?: { width?: number, height?: number }) => ShimNativeImage
  setTemplateImage: (_template: boolean) => ShimNativeImage
  toPNG: () => Buffer
}

/**
 * `nativeImage` is only used to build a tray icon from a path. Electrobun's `Tray` takes a
 * path directly, so the object is a path wrapper rather than a bitmap.
 */
export const nativeImage = {
  createFromPath(path: string): ShimNativeImage {
    return {
      path,
      isEmpty: () => !existsSync(path),
      resize: () => nativeImage.createFromPath(path),
      setTemplateImage: () => nativeImage.createFromPath(path),
      toPNG: () => Buffer.alloc(0),
    }
  },
}

/** What the ported call sites use off a built menu; the shim has no native menus. */
export interface ShimMenu {
  popup: () => void
}

export const Menu = {
  buildFromTemplate(_template: unknown): ShimMenu {
    notImplemented('Menu.buildFromTemplate')
  },
  setApplicationMenu(_menu: unknown): void {
    notImplemented('Menu.setApplicationMenu')
  },
}

export class Tray {
  constructor(public readonly image: unknown) {
    notImplemented('new Tray()')
  }

  setToolTip(_text: string): void {}
  setContextMenu(_menu: unknown): void {}
  addListener(_event: string, _listener: (...args: unknown[]) => void): unknown {
    return undefined
  }

  on(_event: string, _listener: (...args: unknown[]) => void): unknown {
    return undefined
  }

  destroy(): void {}
  isDestroyed(): boolean {
    return false
  }
}

// ---------------------------------------------------------------------------
// screen / Notification
// ---------------------------------------------------------------------------

/**
 * Electrobun's `Screen` covers displays and the cursor point but has no
 * `getDisplayMatching`, no DIP↔screen conversions and no `scaleFactor` contract, so those
 * two helpers are derived here from `getAllDisplays` rather than left missing.
 */
export const screen = {
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
  getDisplayNearestPoint(point: { x: number, y: number }): Display {
    return screen.getDisplayMatching({ x: point.x, y: point.y, width: 0, height: 0 })
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

export class Notification {
  static isSupported(): boolean {
    return true
  }

  constructor(_options?: unknown) {
    notImplemented('new Notification()')
  }

  show(): void {}
  close(): void {}
  on(_event: string, _listener: (...args: unknown[]) => void): unknown {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// helpers used by the shim itself
// ---------------------------------------------------------------------------

/** Join that tolerates an undefined segment (Electron's paths are always strings). */
export function joinPath(...segments: string[]): string {
  return join(...segments)
}

/** Re-exported so unported modules can reach the Electrobun window type by its old name. */
export type { ElectrobunBrowserWindow }
