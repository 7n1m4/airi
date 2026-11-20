/**
 * Type surface for the Hutch-projected Electrobun 2.x SDK.
 *
 * The devkit (` .hutch/devkit/api/sdks/main/index.ts`) is generated Bun source: it
 * imports `bun:ffi`, probes native libraries at module load and has `noImplicitAny`
 * violations in its FFI glue. Feeding that source to the app's strict tsconfig pulls
 * ~65 errors from generated code the app does not own. These declarations describe
 * the SDK symbols `src/main/**` actually consumes, so `skipLibCheck` can keep the
 * generated implementation out of the program without weakening app type safety.
 *
 * Regenerate/adjust from `.hutch/devkit/api/sdks/main/**` when the SDK version changes.
 */

export interface Rectangle {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface Display {
  id: number | string
  bounds: Rectangle
  workArea: Rectangle
  size: { width: number, height: number }
  scaleFactor: number
  isPrimary: boolean
}

export interface WindowOptionsType<T = unknown> {
  title: string
  frame?: Partial<Rectangle>
  url?: string | null
  html?: string | null
  preload?: string | null
  viewsRoot?: string | null
  allowedProtocols?: { views?: boolean, appData?: boolean }
  renderer?: 'native' | 'cef'
  rpc?: T
  styleMask?: Record<string, unknown>
  titleBarStyle?: 'hidden' | 'hiddenInset' | 'default'
  transparent?: boolean
  passthrough?: boolean
  spellCheck?: boolean
  hidden?: boolean
  activate?: boolean
  navigationRules?: string | null
  sandbox?: boolean
}

export interface BrowserViewOptions<T = unknown> {
  url?: string | null
  html?: string | null
  preload?: string | null
  viewsRoot?: string | null
  frame?: Partial<Rectangle>
  renderer?: 'native' | 'cef'
  partition?: string | null
  rpc?: T
  windowId?: number
  autoResize?: boolean
  navigationRules?: string | null
  sandbox?: boolean
}

export type BrowserViewCreatedHandler = (view: BrowserView) => void

export interface WindowGeometryEvent {
  x: number
  y: number
  width: number
  height: number
}

export interface ElectrobunWindowEvent<T = unknown> {
  type: string
  data: T
}

export interface RpcPort {
  send(message: unknown): Promise<void>
  registerHandler(handler: (message: unknown) => void): void
}

export class BrowserView<T = unknown> {
  id: number
  windowId: number
  hostWebviewId?: number
  frame: Rectangle
  url: string | null
  rpc?: T
  isRemoved: boolean

  constructor(options?: Partial<BrowserViewOptions<T>>)

  static defineRPC<S>(options: Record<string, unknown>): RpcPort
  loadURL(url: string): void
  loadHTML(html: string): void
  executeJavascript(js: string): void
  on(name: string, handler: (event: unknown) => void): void
  remove(): void
}

export class BrowserWindow<T = unknown> {
  id: number
  webviewId: number
  readonly webview: BrowserView<T>
  title: string
  state: 'creating' | 'created'
  hidden: boolean

  constructor(options?: Partial<WindowOptionsType<T>>)

  static getById(id: number): BrowserWindow | undefined
  static getAllWindows(): BrowserWindow[]
  static fromWebContents(id: number): BrowserWindow | null

  on(name: string, handler: (event: unknown) => void): void
  show(): void
  showInactive(): void
  hide(): void
  close(): void
  focus(): void
  activate(): void
  setFrame(x: number, y: number, width: number, height: number): void
  getFrame(): Rectangle
  setPosition(x: number, y: number): void
  getPosition(): Point
  setSize(width: number, height: number): void
  setAlwaysOnTop(alwaysOnTop: boolean): void
  setMovable(movable: boolean): void
  setResizable(resizable: boolean): void
}

export const Screen: {
  getAllDisplays(): Display[]
  getPrimaryDisplay(): Display
  getCursorScreenPoint(): Point
  getDisplayMatching(rect: Rectangle): Display
  getDisplayNearestPoint(point: Point): Display
}

export const Utils: {
  paths: {
    readonly home: string
    readonly appData: string
    readonly config: string
    readonly cache: string
    readonly temp: string
    readonly logs: string
    readonly documents: string
    readonly downloads: string
    readonly desktop: string
    readonly pictures: string
    readonly music: string
    readonly videos: string
    readonly userData: string
    readonly userCache: string
    readonly userLogs: string
  }
  openExternal(url: string): boolean
  openPath(path: string): boolean
  setDockIconVisible(visible: boolean): void
  showNotification(options: { title: string, body?: string, subtitle?: string, silent?: boolean }): void
  showMessageBox(options?: { type?: 'info' | 'warning' | 'error' | 'question', title?: string, message?: string, detail?: string, buttons?: string[] }): Promise<{ response: number }>
  quit(code?: number): boolean
}

export const BuildConfig: {
  get(): Promise<{ channel: string, [key: string]: unknown }>
  getSync(): { channel: string, [key: string]: unknown }
}

declare const Electrobun: {
  events: {
    on(name: string, handler: (...args: unknown[]) => void): void
  }
}

export default Electrobun

/** Structural shape accepted by `electrobun.config.ts` (`satisfies ElectrobunConfig`). */
export interface ElectrobunConfig {
  app?: { name?: string, identifier?: string, version?: string }
  build?: {
    mainProcess?: string
    bun?: Record<string, unknown>
    copy?: Record<string, string>
    watch?: string[]
    watchIgnore?: string[]
    [platform: string]: unknown
  }
  runtime?: Record<string, unknown>
}
