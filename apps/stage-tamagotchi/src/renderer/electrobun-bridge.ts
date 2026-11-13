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
 * The bridge object is typed as `@electron-toolkit/preload`'s full `IpcRenderer` so that
 * `createContext(ipcRenderer)` in main.ts and splash.main.ts typechecks without a cast. The
 * five members beyond `send`/`on`/`once`/`removeAllListeners`/`removeListener` are documented
 * no-ops: this RPC transport has no raw-invoke channel to carry them, and eventa's own ids
 * mean nothing ever calls them.
 *
 * Nothing imports this except `install-bridge.ts`, which is what actually calls it.
 *
 * DELETE THIS FILE (and its imports in main.ts / splash.main.ts) once every renderer call
 * site uses `Electroview.defineRPC` / `@proj-airi/electrobun-eventa` directly.
 * `docs/design-electrobun-port.md` §3.2.1 tracks that.
 */

import type { IpcRenderer, IpcRendererListener } from '@electron-toolkit/preload'
import type { ElectrobunEventaFrame, ElectrobunViewRpc } from '@proj-airi/electrobun-eventa/view'

import { EVENTA_EMIT } from '@proj-airi/electrobun-eventa/view'

/** The channel eventa's renderer adapter subscribes to for inbound traffic. */
const EVENTA_MESSAGE_CHANNEL = 'eventa-message'

/**
 * Stand-in for the Electron event argument the adapter reads before the frame; an Electrobun
 * RPC packet carries no event, so the first listener argument is always this stand-in.
 */
const EMPTY_IPC_EVENT = { sender: null, senderId: 0, frameId: 0, processId: 0 } as unknown as Parameters<IpcRendererListener>[0]

declare global {
  interface Window {
    // `stage-shared`'s `electron-renderer.d.ts` declares `electron` non-optional, so this only
    // narrows it — never widens, or the two declarations stop being compatible.
    electron?: { ipcRenderer: IpcRenderer }
    /** Same origin as above: `stage-shared/window.ts` declares `platform` as `NodeJS.Platform`. */
    platform: string
    /** Injected by the Electrobun webview runtime; the web program sees no devkit global. */
    __electrobunPlatform?: 'linux' | 'macos' | 'windows'
    __electrobunWebviewId?: number
  }
}

let installed = false

/**
 * Install `window.electron` / `window.platform` for the current view.
 *
 * Must run before any module reads `window.electron` — i.e. at the top of each renderer
 * entry point, ahead of the `App` import. Idempotent so both entries can call it.
 *
 * `rpc` is what the bridge drives: `rpc.request(EVENTA_EMIT, frame)` sends to Bun, and
 * `rpc.addMessageListener(EVENTA_EMIT, fn)` receives from it. Both come from
 * `Electroview.defineRPC` — without the transport `Electroview.init()` installs, `request`/`send`
 * throw, which is why `install-bridge.ts` constructs the view before calling this.
 */
export function installElectrobunRendererBridge(rpc: ElectrobunViewRpc): void {
  if (installed)
    return
  installed = true
  /** channel → listeners, mirroring the EventEmitter semantics the adapter expects. */
  const listeners = new Map<string, Set<IpcRendererListener>>()

  const add = (channel: string, listener: IpcRendererListener) => {
    const set = listeners.get(channel) ?? new Set()
    set.add(listener)
    listeners.set(channel, set)
    return () => {
      set.delete(listener)
    }
  }

  // Inbound: Bun pushes one `eventa:emit` message per eventa, carrying the same
  // `{ id, type, payload }` envelope Electron delivered on `eventa-message`. Fan it to
  // whoever subscribed to that channel. `@moeru/eventa`'s adapter reads the listener as
  // `(ipcRendererEvent, event)`, so the first argument stays a stand-in for the Electron event.
  rpc.addMessageListener(EVENTA_EMIT, (frame: unknown) => {
    for (const listener of listeners.get(EVENTA_MESSAGE_CHANNEL) ?? [])
      listener(EMPTY_IPC_EVENT, frame)
  })

  const once = (channel: string, listener: IpcRendererListener) => {
    const unsubscribe = add(channel, (event, ...args) => {
      unsubscribe()
      listener(event, ...args)
    })
    return unsubscribe
  }

  const removeAllListeners = (channel: string) => {
    listeners.delete(channel)
  }

  const bridge: IpcRenderer = {
    send: (channel, ...args) => {
      if (channel !== EVENTA_MESSAGE_CHANNEL)
        return
      // Outbound: eventa's renderer adapter built the envelope and handed it here.
      const envelope: unknown = args[0]
      if (!envelope || typeof envelope !== 'object')
        return
      const { payload } = envelope as Partial<ElectrobunEventaFrame>
      if (!payload || typeof payload !== 'object')
        return
      // An RPC packet carries no sender, so the webview id rides in the payload — without it
      // `deliverInbound` in src/main/rpc/index.ts parks the frame under viewId -1 forever.
      void rpc.request(EVENTA_EMIT, { ...envelope, payload: { ...payload, from: window.__electrobunWebviewId } })
    },
    on: (channel, listener) => add(channel, listener),
    once,
    removeAllListeners,
    removeListener: (channel, listener) => {
      listeners.get(channel)?.delete(listener)
      return bridge
    },
    // eventa models request/response over `send`/`on` with its own invoke ids, so nothing ever
    // calls these five — the RPC transport has no raw-invoke channel to carry them either.
    invoke: async () => undefined,
    postMessage: () => undefined,
    sendSync: () => undefined,
    sendTo: () => undefined,
    sendToHost: () => undefined,
  }

  // `getPlatform()` in renderer/utils/electron.ts reads this, and desktop code branches on
  // Node-style names ('darwin' | 'win32' | 'linux'); the webview global only offers the friendly
  // spelling, so it is translated here.
  const platform = window.__electrobunPlatform
  window.platform = platform === 'macos' ? 'darwin' : platform === 'windows' ? 'win32' : 'linux'

  window.electron = { ...window.electron, ipcRenderer: bridge }
}
