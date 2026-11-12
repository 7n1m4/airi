/**
 * Eventa on the Electrobun main (Bun) side.
 *
 * Drop-in for `@moeru/eventa/adapters/electron/main`: same `createContext(...) →
 * { context, dispose }` shape, same `ctx.emit(tag, payload)` /
 * `defineInvokeHandler(ctx, tag, fn)` / `ctx.on(tag, fn)` semantics, same
 * `invokeHandlers` map, and the same `{ raw }` second argument.
 *
 * One intentional difference: `raw` is `{ viewId }` (the sender's
 * `BrowserView.id`) instead of `{ ipcMainEvent, event }`, because an Electrobun
 * RPC packet carries no sender identity — compare `raw.viewId` where the
 * Electron code compares `raw.ipcMainEvent.sender.id`.
 *
 * Wiring: `view.rpc` is the instance handed to `new BrowserView({ rpc })`, which
 * installs the transport, so it is live. A view can only expose request handlers
 * (through `defineRPC`) while main may send messages, hence the asymmetry:
 * main→view frames leave as `eventa:emit` messages (`rpc.send`), and view→main
 * frames arrive as `eventa:emit` requests, whose method is registered once at
 * `defineRPC` time — see the `extraRequestHandlers` note below. The inbound entry
 * point is {@link ElectrobunMainAdapter.receive}.
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

/** Stands in for Electron's `BrowserWindow`. */
export interface ElectrobunMainView {
  /** `BrowserView.id`; used for `raw.viewId` and the `onlySameWindow` filter. */
  id: number
  /** The RPC instance handed to `new BrowserView({ rpc })`. */
  rpc: ElectrobunRpcPort
}

export interface ElectrobunMainCreateContextOptions {
  onlySameWindow?: boolean
}

export type ElectrobunMainEventaContext = ElectrobunEventaContext

export interface ElectrobunMainAdapter {
  context: ElectrobunEventaContext
  /** Fold a frame received from the view into the eventa context. */
  receive: (frame: unknown) => void
  dispose: (reason?: unknown) => void
}

/**
 * Bind an eventa context to one view.
 *
 * `receive` is what the view's inbound frames go through, wired at `defineRPC`
 * time because that is the only place a view can register a request handler:
 *
 * ```ts
 * // extraRequestHandlers is real but absent from the public ElectrobunRPCConfig
 * // type; it is merged into the request handler in defineElectrobunRPC
 * // (.hutch/devkit/api/shared/rpc.ts).
 * let bridge: ElectrobunMainAdapter
 * const rpc = BrowserView.defineRPC<Schema>({
 *   handlers: { requests: {}, messages: {} },
 *   extraRequestHandlers: { 'eventa:emit': (frame: unknown) => bridge.receive(frame) },
 * })
 * const view = new BrowserView({ rpc, ... })
 * const adapter = createContext({ id: view.id, rpc: view.rpc! })
 * bridge = adapter
 * ```
 */
export function createContext(
  view: ElectrobunMainView,
  options: ElectrobunMainCreateContextOptions = {},
): ElectrobunMainAdapter {
  return createEventaAdapter({
    send: frame => view.rpc.send(EVENTA_EMIT, frame),
    ownViewId: view.id,
    onlySameWindow: options.onlySameWindow,
    side: 'main',
  })
}
