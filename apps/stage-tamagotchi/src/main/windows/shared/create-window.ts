import type { RpcBootstrap } from '../../rpc'

import { BrowserWindow } from 'electrobun/main'

import { get, register } from '../registry'
import { resolveViewUrl } from './view'

/**
 * One RPC bootstrap per process: every view gets its own `defineRPC` instance, but they all
 * share the broadcast set, the milestone relay and the eventa-context cache.
 */
let bootstrap: RpcBootstrap | undefined

export function setRpcBootstrap(next: RpcBootstrap): void {
  bootstrap = next
}

export function requireRpcBootstrap(): RpcBootstrap {
  if (!bootstrap)
    throw new Error('[View] RPC bootstrap is not initialised; call setRpcBootstrap() during boot')
  return bootstrap
}

export interface CreateViewWindowOptions {
  tag: string
  title: string
  /** MPA entry name inside the `main` view, e.g. `index.html` or `splash.html`. */
  html: string
  frame: { x?: number, y?: number, width: number, height: number }
  transparent?: boolean
  passthrough?: boolean
  hidden?: boolean
  activate?: boolean
  alwaysOnTop?: boolean
}

/**
 * The single place a view becomes a window.
 *
 * Electron split `show: false` + `ready-to-show` + `show()`; Electrobun hands the URL to the
 * constructor and uses `hidden` to keep the native window off-screen until `show()` /
 * `showInactive()`. The window creates its own webview, so `win.webview` is the RPC-bearing
 * view object main talks to.
 */
export async function createViewWindow(options: CreateViewWindowOptions): Promise<BrowserWindow> {
  const rpc = requireRpcBootstrap().createViewRpc()
  const win = new BrowserWindow({
    title: options.title,
    url: await resolveViewUrl(options.html),
    renderer: 'cef',
    rpc,
    transparent: options.transparent ?? true,
    titleBarStyle: 'hidden',
    passthrough: options.passthrough ?? false,
    frame: options.frame,
    hidden: options.hidden ?? true,
    activate: options.activate ?? false,
  })

  register(win, options.tag)

  if (options.alwaysOnTop)
    win.setAlwaysOnTop(true)

  // The window owns the webview, so the RPC handle is attached here and read back through
  // `win.webview` by anything that needs to emit to the view.
  requireRpcBootstrap().attach(win.webview)
  return win
}

/** The window registered under `tag`; `undefined` once it has been closed. */
export function viewWindow(tag: string): BrowserWindow | undefined {
  return get(tag)
}

/**
 * Electrobun names the bounds pair `setFrame`/`getFrame`.
 *
 * Three-plus call sites in the Control Strip bounds path, so the rename stays in one place.
 */
export function setWindowFrame(win: BrowserWindow, bounds: { x: number, y: number, width: number, height: number }): void {
  win.setFrame(bounds.x, bounds.y, bounds.width, bounds.height)
}
