/**
 * Electrobun port of `libs/electron/location.ts`.
 *
 * Electron loaded the renderer from `file://` (packaged) or `ELECTRON_RENDERER_URL` (dev), with a
 * hash-router variant. Electrobun serves the packaged renderer through the `views://` scheme and
 * the dev renderer from the Vite server, so a URL string is all `load()` needs — the `file:`+hash
 * workaround and the `ERR_ABORTED -3` retry are gone.
 *
 * The exported names match the Electron module so the ~12 not-yet-ported window modules keep
 * importing the same identifiers.
 */

import type { BrowserView } from 'electrobun/main'

const DEV_SERVER_PORT = 5173

/** MPA entries live at the root of the `main` view (see electrobun.config.ts `build.copy`). */
export const VIEW_BASE = 'views://main'

let mainDirname = ''

/** The packaged bundle keeps `index.html` next to the Bun entrypoint; only used for logging. */
export function setElectronMainDirname(dirname: string) {
  mainDirname = dirname
}

export function getElectronMainDirname() {
  return mainDirname
}

/**
 * The URL to load for an MPA entry.
 *
 * Dev wins when the Vite server answers, so HMR works; otherwise the packaged `views://` copy.
 */
export async function viewUrl(filename = 'index.html'): Promise<string> {
  // The dev build has no `views://` asset copy, so the Vite server is the only source; probe it
  // once and fall back to the packaged path when it is not running (e.g. `hutch run start`).
  try {
    const res = await fetch(`http://localhost:${DEV_SERVER_PORT}`, { method: 'HEAD' })
    if (res.ok)
      return `http://localhost:${DEV_SERVER_PORT}/${filename}`
  }
  catch {
    console.warn(`[Location] Vite dev server not running; using ${VIEW_BASE}/${filename}`)
  }

  return `${VIEW_BASE}/${filename}`
}

/** Electron's `baseUrl()` returned `{ url }` or `{ file }`; only the URL form survives. */
export function baseUrl(_parentOfIndexHtml?: string, filename?: string): { url: string } {
  void _parentOfIndexHtml
  // The parent path was the renderer root under electron-vite; `views://main` is the equivalent.
  return { url: `${VIEW_BASE}/${filename ?? 'index.html'}` }
}

/** Resolve a view URL, then load it into the window's webview. */
export async function load(window: BrowserView | { webview: BrowserView }, url: string | { url: string }): Promise<void> {
  const target = 'webview' in window ? window.webview : window
  const resolved = typeof url === 'string' ? await viewUrl(url) : url.url
  target.loadURL(resolved)
}

/** Resolve the URL for a route inside the single-page Control Strip. */
export function withHashRoute(baseUrl: string | { url: string }, hashRoute: string): { url: string } {
  const base = typeof baseUrl === 'string' ? baseUrl : baseUrl.url
  const trimmed = base.endsWith('/') ? base.slice(0, -1) : base
  return { url: `${trimmed}/#${hashRoute.startsWith('/') ? hashRoute : `/${hashRoute}`}` }
}
