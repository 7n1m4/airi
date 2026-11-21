/**
 * Electrobun port: the shared seam between `createViewWindow` and the service layer.
 *
 * The window managers in `windows/**` and the services in `services/**` were written against
 * Electron's `BrowserWindow` / `webContents` and `createContext(ipcMain)`. This module keeps
 * those call sites unchanged by handing them a small Electron-shaped facade over the real
 * Electrobun `BrowserWindow` + its `BrowserView`, and an eventa context bound to that view
 * (`rpc.contextFor`). No service signature changes and no renderer changes are needed.
 *
 * The facade deliberately implements only the members the service layer actually reads;
 * anything with no Electrobun counterpart (mouse-through toggle, vibrancy, window button
 * visibility, DevTools panel) is an explicit no-op documented at the call site.
 */

import type { BrowserView, BrowserWindow, Rectangle } from 'electrobun/main'
import type { BrowserWindow as ElectronBrowserWindow } from 'electron'

import type { I18n } from '../../libs/i18n'
import type { AnyEventaContext, RpcBootstrap } from '../../rpc'
import type { ServerChannel } from '../../services/airi/channel-server'

import { EventEmitter } from 'node:events'

import { Screen } from 'electrobun/main'

import { openDebugger } from '../../app/debugger'
import { isDestroyed } from '../registry'
import { createViewWindow, requireRpcBootstrap } from './create-window'
import { resolveViewUrl } from './view'
import { setupBaseWindowElectronInvokes } from './window'

/** The native events Electrobun actually forwards through `BrowserWindow.on(name, …)`. */
const NATIVE_WINDOW_EVENTS = ['close', 'show', 'hide', 'minimize', 'restore', 'focus', 'blur', 'move', 'resize'] as const

/** The eventa frame a raw `webContents.send('eventa-message', frame)` carries. */
interface RawEventaFrame {
  id: string
  type: string
  payload?: unknown
}

/**
 * Electron-`WebContents`-shaped facade over one view.
 *
 * `id` is the `BrowserView.id`, which is also the sender id the RPC bridge stamps on inbound
 * frames — the `options.raw.ipcMainEvent.sender.id` guards in the service layer therefore
 * match the view that made the invoke.
 */
class PortedWebContents {
  readonly id: number
  private readonly emitter = new EventEmitter()
  private currentUrl = ''

  constructor(
    private readonly win: BrowserWindow,
    private readonly view: BrowserView,
    private readonly rpc: RpcBootstrap,
  ) {
    this.id = view.id
  }

  isDestroyed(): boolean {
    return isDestroyed(this.win)
  }

  isCrashed(): boolean {
    // CEF renderer crashes surface as a `close` in Electrobun; no separate crashed state.
    return false
  }

  getURL(): string {
    return this.currentUrl
  }

  setURL(url: string): void {
    this.currentUrl = url
  }

  get devToolsWebContents(): undefined {
    return undefined
  }

  isDevToolsOpened(): boolean {
    return false
  }

  openDevTools(): void {
    // Electrobun has no per-view DevTools panel. `APP_REMOTE_DEBUG=1` already opens the CDP
    // inspector from the main bootstrap (see app/debugger.ts); reuse that here.
    openDebugger()
  }

  closeDevTools(): void {}

  inspectElement(): void {}

  /** The eventa adapter's outbound channel; other channels have no raw IPC transport. */
  send(channel: string, ...args: unknown[]): void {
    if (channel !== 'eventa-message')
      return
    const frame = args[0] as RawEventaFrame | undefined
    if (!frame || typeof frame !== 'object')
      return
    // Electron's adapter sends `{ id, type: <contract tag>, payload: <event with .body> }`.
    // Unwrap `.body` so the Electrobun bridge can rebuild the same eventa envelope.
    const tag = frame.type ?? frame.id
    const body = (frame.payload as { body?: unknown } | undefined)?.body
    this.rpc.sendTo(this.view, { id: tag }, body)
  }

  on(event: string, listener: (...args: unknown[]) => void): this {
    this.emitter.on(event, listener)
    return this
  }

  once(event: string, listener: (...args: unknown[]) => void): this {
    this.emitter.once(event, listener)
    return this
  }

  removeListener(event: string, listener: (...args: unknown[]) => void): this {
    this.emitter.removeListener(event, listener)
    return this
  }

  removeAllListeners(event?: string): this {
    this.emitter.removeAllListeners(event)
    return this
  }

  /** Used by the registry/stop-loop hooks; native teardown emits `close`, never `closed`. */
  emitClosed(): void {
    this.emitter.emit('destroyed')
    this.emitter.emit('render-process-gone')
  }
}

/**
 * Electron-`BrowserWindow`-shaped facade over a real Electrobun window.
 *
 * Cast to `BrowserWindow` at the boundary; only the members used by `services/**`,
 * `windows/shared/window.ts` and the tray are implemented.
 */
export class PortedBrowserWindow {
  readonly webContents: PortedWebContents
  /** Electron's `BrowserWindow` has an `options` field; the shim's facade type expects it. */
  readonly options: Record<string, unknown> = {}
  private readonly emitter = new EventEmitter()
  private readyToShowEmitted = false

  constructor(
    readonly native: BrowserWindow,
    view: BrowserView,
    rpc: RpcBootstrap,
  ) {
    this.webContents = new PortedWebContents(native, view, rpc)
    for (const event of NATIVE_WINDOW_EVENTS) {
      native.on(event, (payload: unknown) => {
        this.emitter.emit(event, payload)
        // Electron's `closed` fires after `close`; the renderer-loop helpers listen on both.
        if (event === 'close') {
          this.emitter.emit('closed', payload)
          this.webContents.emitClosed()
        }
      })
    }
  }

  /** As an Electron `BrowserWindow` for the still-typed service layer. */
  asElectronWindow(): ElectronBrowserWindow {
    return this as unknown as ElectronBrowserWindow
  }

  get id(): number {
    return this.native.id
  }

  isDestroyed(): boolean {
    return isDestroyed(this.native)
  }

  isVisible(): boolean {
    return !this.isDestroyed() && this.native.isVisible()
  }

  isMinimized(): boolean {
    return !this.isDestroyed() && this.native.isMinimized()
  }

  /** Electrobun exposes no per-window focus query; visibility is the closest available signal. */
  isFocused(): boolean {
    return this.isVisible()
  }

  show(): void {
    if (this.isDestroyed())
      return
    this.native.show()
    if (!this.readyToShowEmitted) {
      this.readyToShowEmitted = true
      this.emitter.emit('ready-to-show')
    }
  }

  showInactive(): void {
    if (this.isDestroyed())
      return
    this.native.showInactive()
    if (!this.readyToShowEmitted) {
      this.readyToShowEmitted = true
      this.emitter.emit('ready-to-show')
    }
  }

  hide(): void {
    if (!this.isDestroyed())
      this.native.hide()
  }

  focus(): void {
    if (!this.isDestroyed())
      this.native.activate()
  }

  activate(): void {
    this.focus()
  }

  restore(): void {
    if (!this.isDestroyed())
      this.native.unminimize()
  }

  minimize(): void {
    if (!this.isDestroyed())
      this.native.minimize()
  }

  close(): void {
    if (!this.isDestroyed())
      this.native.close()
  }

  destroy(): void {
    this.close()
  }

  setTitle(title: string): void {
    if (!this.isDestroyed())
      this.native.setTitle(title)
  }

  getBounds(): Rectangle {
    return this.native.getFrame()
  }

  getFrame(): Rectangle {
    return this.native.getFrame()
  }

  setBounds(bounds: Rectangle): void {
    if (!this.isDestroyed())
      this.native.setFrame(Math.round(bounds.x), Math.round(bounds.y), Math.round(bounds.width), Math.round(bounds.height))
  }

  setFrame(bounds: Rectangle): void {
    this.setBounds(bounds)
  }

  setSize(width: number, height: number): void {
    if (!this.isDestroyed())
      this.native.setSize(Math.round(width), Math.round(height))
  }

  center(): void {
    if (this.isDestroyed())
      return
    const area = Screen.getPrimaryDisplay().workArea
    const { width, height } = this.native.getFrame()
    this.native.setPosition(
      Math.round(area.x + (area.width - width) / 2),
      Math.round(area.y + (area.height - height) / 2),
    )
  }

  setAlwaysOnTop(flag: boolean, _level?: string, _relativeLevel?: number): void {
    if (!this.isDestroyed())
      this.native.setAlwaysOnTop(flag)
  }

  setVisibleOnAllWorkspaces(visible: boolean): void {
    if (!this.isDestroyed())
      this.native.setVisibleOnAllWorkspaces(visible)
  }

  loadURL(url: string): void {
    this.webContents.setURL(url)
    this.native.webview.loadURL(url)
  }

  getURL(): string {
    return this.webContents.getURL()
  }

  // NOTICE: Electrobun has creation-time `passthrough` only; there is no runtime toggle and
  // no `{ forward }` mouse-move forwarding. Caption still relies on its creation-time value.
  setIgnoreMouseEvents(): void {}

  // Creation-time `styleMask` covers these in `createViewWindow`; no runtime setter exists.
  setResizable(): void {}
  setFullScreenable(): void {}
  setMovable(): void {}
  setWindowButtonVisibility(): void {}
  setVibrancy(): void {}
  setBackgroundMaterial(): void {}

  on(event: string, listener: (...args: unknown[]) => void): this {
    this.emitter.on(event, listener)
    return this
  }

  once(event: string, listener: (...args: unknown[]) => void): this {
    this.emitter.once(event, listener)
    return this
  }

  removeListener(event: string, listener: (...args: unknown[]) => void): this {
    this.emitter.removeListener(event, listener)
    return this
  }

  off(event: string, listener: (...args: unknown[]) => void): this {
    return this.removeListener(event, listener)
  }

  removeAllListeners(event?: string): this {
    this.emitter.removeAllListeners(event)
    return this
  }
}

// NOTICE: the old Electron shim carried a `setPortedWindowFactory` registration here so
// `BrowserWindow.getAllWindows()` returned facades. That global is gone: the registry is the
// single source of truth for live windows, and `createViewWindow` below still wraps each native
// window in `PortedBrowserWindow` for the per-window service handlers. The libp2p/agentic push
// paths now emit through the main event bus instead of enumerating Electron windows.

export interface CreatePortedWindowOptions {
  tag: string
  title: string
  width: number
  height: number
  x?: number
  y?: number
  /** MPA entry; `index.html` for routed pages, `beat-sync.html` for the dedicated entry. */
  html?: string
  /** Hash route inside the index entry, e.g. `/settings`. */
  route?: string
  transparent?: boolean
  passthrough?: boolean
  alwaysOnTop?: boolean
  hidden?: boolean
  activate?: boolean
}

export interface PortedWindow {
  /** Native Electrobun window — pass to `registry.get(tag)`. */
  native: BrowserWindow
  /** The RPC-bearing view. */
  view: BrowserView
  /** Eventa context bound to this view (with Electron `raw` compatibility). */
  context: AnyEventaContext
  /** Electron-shaped facade for the service layer. */
  facade: PortedBrowserWindow
  /** The same facade, typed as Electron `BrowserWindow`. */
  window: ElectronBrowserWindow
  loadRoute: (route: string) => Promise<void>
  close: () => void
  isDestroyed: () => boolean
}

/**
 * Create a real Electrobun window, bind its eventa context and (optionally) register the base
 * window services before any renderer frame arrives. This is the single replacement for the
 * old `new BrowserWindow(...)` + `createContext(ipcMain, win)` pair.
 */
export async function createPortedWindow(options: CreatePortedWindowOptions & {
  setupBase?: { i18n: I18n, serverChannel: ServerChannel }
}): Promise<PortedWindow> {
  const rpc = requireRpcBootstrap()
  const native = await createViewWindow({
    tag: options.tag,
    title: options.title,
    html: options.html ?? 'index.html',
    frame: {
      x: options.x,
      y: options.y,
      width: options.width,
      height: options.height,
    },
    transparent: options.transparent ?? false,
    passthrough: options.passthrough ?? false,
    hidden: options.hidden ?? true,
    activate: options.activate ?? false,
    alwaysOnTop: options.alwaysOnTop,
  })
  const view = native.webview
  const context = await rpc.contextFor(view)
  const facade = new PortedBrowserWindow(native, view, rpc)

  if (options.setupBase) {
    await setupBaseWindowElectronInvokes({
      context,
      window: facade.asElectronWindow(),
      i18n: options.setupBase.i18n,
      serverChannel: options.setupBase.serverChannel,
    })
  }

  const loadRoute = async (route: string) => {
    const base = await resolveViewUrl(options.html ?? 'index.html')
    const url = new URL(base)
    url.hash = route.startsWith('/') ? route : `/${route}`
    facade.loadURL(url.toString())
  }

  if (options.route)
    await loadRoute(options.route)

  return {
    native,
    view,
    context,
    facade,
    window: facade.asElectronWindow(),
    loadRoute,
    close: () => facade.close(),
    isDestroyed: () => facade.isDestroyed(),
  }
}
