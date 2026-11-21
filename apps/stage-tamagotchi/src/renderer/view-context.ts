/**
 * Renderer entry bootstrap: install the shared Electrobun view eventa context.
 *
 * A module body on purpose, imported before the app graph. ESM hoists imports above
 * statements, so installing from a statement in `main.ts` would run after `App.vue`'s
 * module graph had already resolved its module-scope contexts. Splitting it out makes
 * installation the first thing in the graph, for both HTML entries.
 *
 * This is NOT a compatibility bridge: no `window.electron` / `window.platform` is
 * installed. Every call site uses `getViewEventaContext()` / `useElectronEventaContext()`
 * instead. `new Electroview({ rpc })` is load-bearing — its constructor calls
 * `rpc.setTransport(...)`, without which every `request`/`send` throws.
 */

import { getViewEventaContext, installViewEventa } from '@proj-anima/electrobun-eventa/view'
import { setElectronEventaContextProvider } from '@proj-anima/electron-vueuse'
import { Electroview } from 'electrobun/view'

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

// Publish the one view-wide context before the app graph evaluates, so module-level call
// sites (the dating-sim store, image-journal tool, …) resolve it through either accessor.
installViewEventa(rpc)
setElectronEventaContextProvider(getViewEventaContext)
