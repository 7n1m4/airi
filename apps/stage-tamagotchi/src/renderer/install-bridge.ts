import { Electroview } from 'electrobun/view'

import { installElectrobunRendererBridge } from './electrobun-bridge'

// keep in sync with AIRRPC in src/main/rpc/index.ts
interface AiriRpcCapability {
  requests: {
    'eventa:emit': { params: unknown, response: void }
  }
  messages: {
    'eventa:emit': { payload: unknown }
  }
}

// keep in sync with AIRRPC in src/main/rpc/index.ts
interface AiriRpc {
  bun: AiriRpcCapability
  webview: AiriRpcCapability
}

/**
 * Self-installing entry for the `window.electron.ipcRenderer` bridge.
 *
 * A module body on purpose, imported before the app graph: ESM hoists imports above
 * statements, so an early statement inside `main.ts` would still run after `App`'s module
 * graph had already read `window.electron` (and `resolveIpcRenderer()` had already cached
 * `undefined`). Splitting it out makes installation happen as the first thing in the graph.
 *
 * `new Electroview({ rpc })` is load-bearing, not decoration: the constructor calls
 * `rpc.setTransport(this.createTransport())`. Without it the RPC has no transport and every
 * `request`/`send` throws, which is the whole failure this bridge exists to fix.
 */
/**
 * `window.__electrobun` is normally installed by Electrobun's preload script, which CEF
 * injects only when the view was created with one — this app's views pass `preload: null`,
 * so the host→view half of the RPC would land on a missing global and die silently.
 * Mirror the preload's stub here: buffer host messages until Electroview replaces the
 * handler (its `init()` drains `__electrobunPendingHostMessages`).
 */
const electrobunGlobals = window as Window & {
  __electrobun?: {
    receiveMessageFromHost: (msg: unknown) => void
    receiveInternalMessageFromHost: (msg: unknown) => void
    receiveMessageFromBun: (msg: unknown) => void
    receiveInternalMessageFromBun: (msg: unknown) => void
  }
  __electrobunPendingHostMessages?: unknown[]
}
if (!electrobunGlobals.__electrobun) {
  const buffer = (msg: unknown) => {
    ;(electrobunGlobals.__electrobunPendingHostMessages ??= []).push(msg)
  }
  electrobunGlobals.__electrobun = {
    receiveMessageFromHost: buffer,
    receiveInternalMessageFromHost: buffer,
    receiveMessageFromBun: buffer,
    receiveInternalMessageFromBun: buffer,
  }
}

const rpc = Electroview.defineRPC<AiriRpc>({
  handlers: {
    requests: {
      'eventa:emit': () => {},
    },
    messages: {
      'eventa:emit': () => {},
    },
  },
})

// eslint-disable-next-line no-new -- the instance exists only for its constructor side effects.
new Electroview({ rpc })

installElectrobunRendererBridge(rpc)
