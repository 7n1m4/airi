/**
 * Eventa on the Electrobun view (CEF renderer) side.
 *
 * Drop-in for `@moeru/eventa/adapters/electron/renderer`: same `createContext(rpc,
 * options?) → { context, dispose }` shape, same emit/on/defineInvokeHandler
 * semantics, same `invokeHandlers` map, and the same `{ raw }` second argument.
 *
 * One intentional difference: `raw` is `{ viewId }` — this view's own
 * `window.__electrobunWebviewId` — instead of `{ ipcRendererEvent, event }`.
 *
 * The view's RPC instance is the one from
 * `Electroview.defineRPC<Schema>({ handlers })`, i.e. `new Electroview({ rpc }).rpc`.
 * Outbound frames are `eventa:emit` requests (main declares that method), and
 * inbound frames arrive as the `eventa:emit` message; the instance's message
 * listener is installed here and restored on `dispose()`.
 */

import type { ElectrobunEventaContext, ElectrobunRpcPort } from './shared'

import { createEventaAdapter, EVENTA_EMIT } from './shared'

export type {
  ElectrobunEventaEmitOptions,
  ElectrobunEventaFrame,
  ElectrobunEventaInbound,
  ElectrobunEventaPayload,
  ElectrobunEventaRaw,
} from './contract'
export { errorEvent, EVENTA_EMIT } from './contract'

export interface ElectrobunViewCreateContextOptions {
  onlySameWindow?: boolean
}

export type ElectrobunViewEventaContext = ElectrobunEventaContext

export type ElectrobunViewRpc = ElectrobunRpcPort

/**
 * This view's webview id, as CEF injects it into the renderer global.
 *
 * Electron's renderer learns its sender from the IPC event; Electrobun hands the
 * id to the page instead, so it is read once here.
 */
function ownViewId(): number | undefined {
  return (globalThis as { window?: { __electrobunWebviewId?: number } }).window?.__electrobunWebviewId
}

export function createContext(
  rpc: ElectrobunViewRpc,
  options: ElectrobunViewCreateContextOptions = {},
): { context: ElectrobunEventaContext, dispose: (reason?: unknown) => void } {
  const adapter = createEventaAdapter({
    send: (frame) => {
      void rpc.request(EVENTA_EMIT, frame)
    },
    ownViewId: ownViewId(),
    onlySameWindow: options.onlySameWindow,
    side: 'view',
  })

  const onMessage = (payload: unknown) => adapter.receive(payload)
  rpc.addMessageListener(EVENTA_EMIT, onMessage)

  return {
    context: adapter.context,
    dispose: (reason?: unknown) => {
      rpc.removeMessageListener(EVENTA_EMIT, onMessage)
      adapter.dispose(reason)
    },
  }
}
