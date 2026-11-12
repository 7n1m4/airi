/**
 * Electrobun port: the renderer-side `window.electron` bridge.
 *
 * Why this exists: the renderer was written for Electron's preload bridge and imports no
 * Electrobun type. 77 files across `apps/stage-tamagotchi/src/renderer`, `packages/stage-ui`
 * and `packages/stage-pages` reach the main process through
 * `window.electron.ipcRenderer`, and `packages/electron-vueuse`'s
 * `resolveIpcRenderer()` returns `undefined` when it is absent — which turns every
 * `useElectronEventaInvoke` into `throw new Error('Electron IPC not available')`.
 *
 * Rather than rewrite 77 call sites, this installs an `ipcRenderer`-shaped object. Eventa's
 * renderer adapter (`@moeru/eventa/adapters/electron/renderer`) is then pointed at it by
 * `@proj-airi/electrobun-eventa`, so what crosses the boundary is the same
 * `{ id, type, payload }` envelope Electron carried — only the transport changed.
 *
 * What the Electron adapter actually needs from `ipcRenderer` is small: `send(channel,
 * envelope)` for outbound traffic, and `on(channel, listener)` / `removeListener(...)` for
 * inbound. `invoke` is *not* part of that contract — eventa mints its own invoke ids and
 * models request/response as two tagged events over `send`/`on`, which is why the Electron
 * adapter never touches `ipcRenderer.invoke` either. Implementing one here would duplicate
 * that mechanism and diverge from it, so the bridge does not.
 *
 * DELETE THIS FILE (and its imports in main.ts / splash.main.ts) once every renderer call
 * site uses `Electroview.defineRPC` / `@proj-airi/electrobun-eventa` directly.
 * `docs/design-electrobun-port.md` §3.2.1 tracks that.
 */

import type { ElectrobunViewRpc } from '@proj-airi/electrobun-eventa/view'

import { EVENTA_EMIT } from '@proj-airi/electrobun-eventa/view'

/** The channel eventa's renderer adapter subscribes to for inbound traffic. */
const EVENTA_MESSAGE_CHANNEL = 'eventa-message'

/** What `@moeru/eventa/adapters/electron/renderer` requires of an ipcRenderer. */
interface IpcRendererLike {
  send: (channel: string, ...args: unknown[]) => void
  on: (channel: string, listener: (...args: unknown[]) => void) => () => void
  removeListener: (channel: string, listener: (...args: unknown[]) => void) => void
}

declare global {
  interface Window {
    electron?: { ipcRenderer?: IpcRendererLike }
    platform?: string
    __electrobunWebviewId?: number
    /**
     * Eventa invoke for the two call sites that used raw `ipcRenderer.invoke` and so sit
     * outside the eventa context the Vue components share (`main.ts`'s sticker helpers).
     * Installed by `installElectrobunRendererBridge`; `defineInvoke` cannot be used there
     * because those helpers are reachable before the app context exists.
     */
    __airiInvoke: (channel: string, payload?: unknown) => Promise<unknown>
  }
}

let installed = false

/**
 * Install `window.electron` / `window.platform` for the current view.
 *
 * Must run before any module reads `window.electron` — i.e. at the top of each renderer
 * entry point, ahead of the `App` import. Idempotent so both entries can call it.
 *
 * `rpc` is the `Electroview` instance for this view: `rpc.request(EVENTA_EMIT, frame)` sends
 * to Bun, and `rpc.addMessageListener(EVENTA_EMIT, fn)` receives from it. Both are what
 * `packages/electrobun-eventa` drives; this file only supplies the `ipcRenderer` shape the
 * Electron adapters expect on top.
 */
export function installElectrobunRendererBridge(rpc: ElectrobunViewRpc): void {
  if (installed)
    return
  installed = true
  /** channel → listeners, mirroring the EventEmitter semantics the adapter expects. */
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()

  const add = (channel: string, listener: (...args: unknown[]) => void) => {
    const set = listeners.get(channel) ?? new Set()
    set.add(listener)
    listeners.set(channel, set)
    return () => {
      set.delete(listener)
    }
  }

  // Inbound: Bun pushes one `eventa:emit` message per eventa, carrying the same
  // `{ id, type, payload }` envelope Electron delivered on `eventa-message`. Fan it to
  // whoever subscribed to that channel.
  rpc.addMessageListener(EVENTA_EMIT, (frame: unknown) => {
    for (const listener of listeners.get(EVENTA_MESSAGE_CHANNEL) ?? [])
      listener({}, frame)
  })

  const ipcRenderer: IpcRendererLike = {
    send: (channel, ...args) => {
      if (channel !== EVENTA_MESSAGE_CHANNEL)
        return
      // Outbound: eventa's renderer adapter built the envelope and handed it here.
      const envelope = args[0]
      if (envelope && typeof envelope === 'object' && 'payload' in envelope)
        void rpc.request(EVENTA_EMIT, envelope)
    },
    on: (channel, listener) => add(channel, listener),
    removeListener: (channel, listener) => {
      listeners.get(channel)?.delete(listener)
    },
  }

  // `getPlatform()` in renderer/utils/electron.ts reads this; desktop code branches on
  // 'darwin' | 'win32' | 'linux', so it must be a Node-style name.
  window.platform = process.platform

  // The two pre-app call sites (`main.ts` sticker helpers) need a real invoke. Eventa's
  // `defineInvoke` models request/response as two correlated events over one context, so
  // this is that pattern with the correlation id minted here.
  window.__airiInvoke = async (channel, payload) => {
    const invokeId = Math.random().toString(36).slice(2, 10)
    const replyTag = `${channel}:reply:${invokeId}`
    const errorTag = `${channel}:error:${invokeId}`

    const { promise, resolve, reject } = Promise.withResolvers<unknown>()
    const removeReply = add(replyTag, (_event, frame) => {
      removeError()
      resolve(frame)
    })
    const removeError = add(errorTag, (_event, frame) => {
      removeReply()
      reject(frame instanceof Error ? frame : new Error(String(frame)))
    })

    await rpc.request(channel, { invokeId, replyEvent: replyTag, errorEvent: errorTag, content: payload })
    return promise
  }
}

export type { IpcRendererLike }
