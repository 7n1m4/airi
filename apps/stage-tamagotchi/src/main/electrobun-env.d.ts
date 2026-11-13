/**
 * Ambient declarations for the packages the Bun main imports but which ship no types of their
 * own in this workspace.
 *
 * `electrobun` (the npm bootstrap) is a `lib/moved.cjs` re-export shim: it carries no `.d.ts`,
 * and the real API surface lives in `.hutch/devkit/api` after `hutch electrobun prepare`. Rather
 * than depend on prepare having run, the surfaces `src/main` touches are declared here; delete
 * this file once `@proj-airi/electrobun-ui`-style typings or a typed devkit is linked.
 */

declare module 'electrobun/main' {
  export interface Rectangle {
    x: number
    y: number
    width: number
    height: number
  }

  export interface Display {
    id: number
    bounds: Rectangle
    workArea: Rectangle
    scaleFactor: number
    isPrimary: boolean
  }

  /**
   * What the native window callbacks hand to a `move`/`resize` listener.
   * `.hutch/devkit/api/sdks/main/events/event.ts:1-14` — every event is an
   * `ElectrobunEvent` instance carrying its `name` and `data`; `ElectrobunEventEmitter.emitEvent`
   * emits that instance itself, so the handler receives it rather than the bare frame.
   */
  export interface ElectrobunWindowEvent<Data> {
    name: string
    data: Data
  }

  /**
   * `move`/`resize` payload: the full frame on `resize`, only the changed axes on `move`
   * (`.hutch/devkit/api/sdks/main/events/windowEvents.ts:4-11`), so each axis is optional.
   */
  export interface WindowGeometryEvent {
    id: number
    x?: number
    y?: number
    width?: number
    height?: number
  }

  export type Renderer = 'native' | 'cef'

  export interface WindowOptionsType<T = undefined> {
    title?: string
    frame?: { x?: number, y?: number, width: number, height: number }
    url?: string | null
    html?: string | null
    preload?: string | null
    viewsRoot?: string | null
    allowedProtocols?: { views?: boolean, appData?: boolean }
    renderer?: Renderer
    rpc?: T
    titleBarStyle?: 'default' | 'hidden' | 'hiddenInset'
    transparent?: boolean
    passthrough?: boolean
    hidden?: boolean
    activate?: boolean
    navigationRules?: string | null
    sandbox?: boolean
  }

  export class BrowserWindow<T = unknown> {
    constructor(options?: Partial<WindowOptionsType<T>>)
    id: number
    title: string
    frame: Rectangle
    webview: BrowserView<T>
    static getById(id: number): BrowserWindow | undefined
    setTitle(title: string): unknown
    close(): unknown
    requestClose(): unknown
    activate(): unknown
    show(): unknown
    showInactive(): unknown
    hide(): unknown
    isVisible(): boolean
    minimize(): unknown
    unminimize(): unknown
    isMinimized(): boolean
    maximize(): unknown
    unmaximize(): unknown
    isMaximized(): boolean
    setFullScreen(fullScreen: boolean): unknown
    setAlwaysOnTop(alwaysOnTop: boolean): unknown
    setVisibleOnAllWorkspaces(visible: boolean): unknown
    setPosition(x: number, y: number): unknown
    setSize(width: number, height: number): unknown
    setFrame(x: number, y: number, width: number, height: number): unknown
    getFrame(): Rectangle
    getPosition(): { x: number, y: number }
    getSize(): { width: number, height: number }
    on(name: string, handler: (event: unknown) => void): void
    /**
     * Emitted per window by the native callbacks (`proc/native.ts:2728-2747` move,
     * `:2748+` resize); the handler gets the `ElectrobunEvent` instance, not the bare payload.
     */
    on(name: 'move' | 'resize', handler: (event: ElectrobunWindowEvent<WindowGeometryEvent>) => void): void
  }

  export interface BrowserViewOptions<T = undefined> {
    url?: string | null
    html?: string | null
    preload?: string | null
    viewsRoot?: string | null
    allowedProtocols?: { views?: boolean, appData?: boolean }
    renderer?: Renderer
    partition?: string | null
    frame?: { x?: number, y?: number, width: number, height: number }
    rpc?: T
    windowId?: number
    navigationRules?: string | null
    sandbox?: boolean
    startTransparent?: boolean
    startPassthrough?: boolean
  }

  /** The wire contract `BrowserView.defineRPC` / `Electroview.defineRPC` both satisfy. */
  export interface ElectrobunRpcSchema {
    bun: { requests: Record<string, { params: unknown, response: unknown }>, messages: Record<string, unknown> }
    webview: { requests: Record<string, { params: unknown, response: unknown }>, messages: Record<string, unknown> }
  }

  export interface ElectrobunRpc<Schema extends ElectrobunRpcSchema = ElectrobunRpcSchema> {
    setTransport: (transport: unknown) => void
    setRequestHandler: (handler: ((method: string, params: unknown) => unknown) | Record<string, ((params: unknown) => unknown) | undefined>) => void
    request: ((method: string, params?: unknown) => Promise<unknown>) & Record<string, (params?: unknown) => Promise<unknown>>
    send: ((message: string, payload?: unknown) => void) & Record<string, (payload?: unknown) => void>
    addMessageListener: (message: string, listener: (payload: unknown) => void) => void
    removeMessageListener: (message: string, listener: (payload: unknown) => void) => void
  }

  export class BrowserView<T = unknown> {
    constructor(options?: Partial<BrowserViewOptions<T>>)
    id: number
    windowId: number
    rpc?: T
    static getById(id: number): BrowserView | undefined
    static getAll(): BrowserView[]
    static on(name: 'created', handler: (view: BrowserView) => void): () => void
    static defineRPC<Schema extends ElectrobunRpcSchema>(config: {
      maxRequestTime?: number
      handlers: {
        requests?: Record<string, ((params: never) => unknown) | undefined>
        messages?: Record<string, ((payload: never) => void) | undefined>
      }
    }): ElectrobunRpc<Schema>
    loadURL(url: string): void
    loadHTML(html: string): void
    openDevTools(): void
    closeDevTools(): void
    executeJavascript(js: string): void
    remove(): void
    on(name: string, handler: (event: unknown) => void): void
  }

  export interface BuildConfigType {
    mainProcess?: 'bun' | 'cottontail' | 'zig' | 'rust' | 'go' | 'odin'
    defaultRenderer: Renderer
    availableRenderers: Renderer[]
    chromiumFlags?: Record<string, string | boolean>
    channel: 'dev' | 'canary' | 'stable'
    isPackaged: boolean
    runtime?: { exitOnLastWindowClosed?: boolean, [key: string]: unknown }
  }

  export const BuildConfig: {
    get: () => Promise<BuildConfigType>
    getSync: () => BuildConfigType
  }

  export const Utils: {
    paths: {
      home: string
      appData: string
      config: string
      cache: string
      temp: string
      logs: string
      documents: string
      downloads: string
      desktop: string
      pictures: string
      music: string
      videos: string
      userData: string
      userCache: string
      userLogs: string
    }
    quit: (code?: number) => boolean
    requestQuitApproval: () => unknown
    cancelQuitApproval: (approval: unknown) => void
    quitAfterApproval: (approval: unknown, code?: number) => void
    openExternal: (url: string) => boolean
    showNotification: (options: { title: string, body?: string, subtitle?: string, silent?: boolean }) => void
    showMessageBox: (options: unknown) => Promise<unknown>
    openFileDialog: (options: unknown) => Promise<unknown>
    clipboardReadText: () => string | null
    clipboardWriteText: (text: string) => void
    /** `.hutch/devkit/api/sdks/main/core/Utils.ts:54` — opens a file or folder with its default app. */
    openPath: (path: string) => boolean
    /** `.hutch/devkit/api/sdks/main/core/Utils.ts:10` */
    moveToTrash: (path: string) => boolean
    /** `.hutch/devkit/api/sdks/main/core/Utils.ts:14` */
    showItemInFolder: (path: string) => boolean
  }

  export const Screen: {
    getPrimaryDisplay: () => Display
    getAllDisplays: () => Display[]
    getCursorScreenPoint: () => { x: number, y: number }
  }

  export const GlobalShortcut: {
    register: (accelerator: string, handler: () => void) => boolean
    unregister: (accelerator: string) => void
    unregisterAll: () => void
    isRegistered: (accelerator: string) => boolean
  }

  /** What the Bun main needs from `electrobun`'s default export: the app event bus. */
  const Electrobun: {
    events: {
      on: (name: string, handler: (event: { data: unknown, response?: unknown }) => void) => void
      off: (name: string, handler: (event: unknown) => void) => void
      emitEvent: (event: unknown) => void
    }
    app: {
      on: (name: string, handler: (payload: unknown) => void) => () => void
      quit: () => void
      isPackaged: boolean
    }
  }

  export default Electrobun
}

declare module '@proj-airi/electrobun-eventa/main' {
  import type { EventContext } from '@moeru/eventa'
  import type { ElectrobunRpcPort } from '@proj-airi/electrobun-eventa'

  export type { ElectrobunRpcPort }

  export type ElectrobunEventaContext = EventContext<Record<string, unknown>, { raw: { viewId: number } }>

  export interface ElectrobunMainView {
    id: number
    rpc: ElectrobunRpcPort
  }

  export function createMainContext(
    view: ElectrobunMainView,
    options?: { onlySameWindow?: boolean },
  ): { context: ElectrobunEventaContext, dispose: (reason?: unknown) => void }

  export const EVENTA_EMIT: 'eventa:emit'
}
