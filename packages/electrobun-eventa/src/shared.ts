/**
 * Eventa over Electrobun RPC — shared plumbing.
 *
 * API parity with `@moeru/eventa/adapters/electron/{main,renderer}`: both sides
 * return `{ context, dispose }` from `createContext`, and the context carries the
 * same `emit`/`on`/`once`/`off`/`signal`/`abort`/`invokeHandlers` surface, so
 * call sites port over unchanged.
 *
 * There is exactly one intentional difference. Electron hands each adapter a
 * channel both sides can subscribe to (`ipcRenderer.send` / `ipcMain.on`), and
 * the transport itself identifies the sender. Electrobun RPC has neither, so the
 * adapter is a pair of methods on the view's RPC instance — outbound frames leave
 * as `eventa:emit` requests, inbound frames arrive either as the `eventa:emit`
 * message (main→view) or as that same request (view→main) — and because an RPC
 * packet carries no sender, the sending webview id rides in the payload as
 * `payload.from`. Everything the `onlySameWindow` filter and the `{ raw }` second
 * argument need comes from that one field, and `raw` is `{ viewId }` where
 * Electron hands over `{ ipcMainEvent, event }`.
 *
 * Both directions fold into one receive path, and every frame keeps eventa's
 * electron envelope `{ id, type, payload }`, so payloads stay wire-compatible
 * with the Electron adapters.
 */

import type { Eventa, EventContext } from '@moeru/eventa'

import type {
  ElectrobunEventaEmitOptions,
  ElectrobunEventaFrame,
  ElectrobunEventaRaw,
} from './contract'

import { and, createContext, defineInboundEventa, matchBy } from '@moeru/eventa'

import { decodeErrorBody, encodeErrorBody, errorEvent, isElectrobunEventaFrame } from './contract'

export type {
  ElectrobunEventaEmitOptions,
  ElectrobunEventaFrame,
  ElectrobunEventaInbound,
  ElectrobunEventaPayload,
  ElectrobunEventaRaw,
} from './contract'
export { errorEvent, EVENTA_EMIT } from './contract'

/** A bound eventa context, as both adapter sides hand it back. */
export type ElectrobunEventaContext = EventContext<Record<string, unknown>, ElectrobunEventaEmitOptions>

/**
 * What an adapter needs from an Electrobun RPC instance.
 *
 * `createRPC()` returns exactly this surface (plus proxies), so both
 * `BrowserView.defineRPC(...)` on the Bun side and `Electroview.defineRPC(...)`
 * on the view side satisfy it.
 */
export interface ElectrobunRpcPort {
  request: (method: string, params?: unknown) => Promise<unknown>
  send: (message: string, payload?: unknown) => void
  addMessageListener: (message: string, listener: (payload: unknown) => void) => void
  removeMessageListener: (message: string, listener: (payload: unknown) => void) => void
}

/**
 * The `defineRPC` options, plus the `extraRequestHandlers` escape hatch.
 *
 * `extraRequestHandlers` is honoured by `defineElectrobunRPC`
 * (`.hutch/devkit/api/shared/rpc.ts`: it spreads them over
 * `config.handlers.requests`) but is missing from the published
 * `ElectrobunRPCConfig` type, hence the intersection.
 */
export interface ElectrobunDefineRPCOptions {
  handlers: {
    requests?: Record<string, (params: unknown) => unknown>
    messages?: Record<string, (payload: unknown) => void>
  }
  extraRequestHandlers?: Record<string, (params: unknown) => unknown>
  maxRequestTime?: number
}

/**
 * Both sides run the same state machine; only how a frame reaches the peer
 * differs, so `main.ts` and `view.ts` just supply these.
 */
export interface ElectrobunAdapterTransport {
  /** Push one frame to the peer. */
  send: (frame: ElectrobunEventaFrame) => void
  /** This side's webview id, stamped onto outbound frames. */
  ownViewId?: number
  onlySameWindow?: boolean
  /** Noun used in the `dispose()` abort reason. */
  side: string
}

export interface ElectrobunEventaAdapter {
  context: ElectrobunEventaContext
  /** Fold a frame received from the peer into the context. */
  receive: (frame: unknown) => void
  dispose: (reason?: unknown) => void
}

export function createEventaAdapter(transport: ElectrobunAdapterTransport): ElectrobunEventaAdapter {
  const { send, ownViewId, onlySameWindow = false, side } = transport

  const context = createContext<Record<string, unknown>, ElectrobunEventaEmitOptions>()
  let isReporting = false

  // Outbound: every non-inbound eventa, plus invoke traffic (which carries no
  // `_flowDirection` at all) — the same predicate the electron adapters use.
  type FlowEventa = Eventa<unknown> & { _flowDirection?: 'inbound' | 'outbound' }
  context.on(and(matchBy((e: FlowEventa) => e._flowDirection === 'outbound' || e._flowDirection === undefined), matchBy('*')), (event) => {
    const frame: ElectrobunEventaFrame = {
      id: event.id,
      // Electron's `generatePayload(event.id, …)` puts the eventa tag in the frame's top-level
      // `type` — the view-side electron adapter routes on `defineInboundEventa(frame.type)`.
      // `event.type` is always the flow kind ('event'), which would route every inbound frame
      // to listeners keyed `event` and silently drop tags.
      type: event.id,
      payload: {
        ...event,
        body: encodeErrorBody(event.body),
        ...(ownViewId === undefined ? {} : { from: ownViewId }),
      } as ElectrobunEventaFrame['payload'],
    }
    try {
      send(frame)
    }
    catch (error) {
      // Same as the electron adapters: a failed send is reported, not thrown, so
      // one dead window cannot take the emitter down. The report itself goes out
      // through `emit`, hence the `isReporting` guard: a dead transport must not
      // recurse into another report.
      if (isReporting) {
        console.error('Failed to report Electrobun eventa send failure:', error)
        return
      }
      isReporting = true
      try {
        context.emit(errorEvent, { error }, { raw: { viewId: ownViewId ?? -1 } })
      }
      finally {
        isReporting = false
      }
    }
  })

  const receive = (frame: unknown): void => {
    const raw: ElectrobunEventaRaw = { viewId: -1 }
    try {
      if (!isElectrobunEventaFrame(frame))
        throw new Error('eventa: malformed eventa:emit frame')
      const { payload } = frame
      // `frame.type` is eventa's flow kind ("event"); the contract tag is
      // `payload.id`, which is also what the outbound listener keyed on.
      const tag = payload.id ?? frame.id

      if (typeof payload.from === 'number')
        raw.viewId = payload.from
      // Electron applies `onlySameWindow` on send; a frame that carries no
      // sender id cannot be attributed, so it is dropped rather than guessed at.
      if (onlySameWindow && ownViewId !== undefined && raw.viewId !== ownViewId)
        return

      const body = decodeErrorBody(payload.body)
      // The peer tagged its own copy outbound; re-tag inbound exactly like the
      // electron adapters, so the contract id stays the one it was defined with.
      context.emit(defineInboundEventa(tag) as Eventa<unknown>, body, { raw })
    }
    catch (error) {
      console.error('Failed to parse Electrobun message:', error)
      context.emit(errorEvent, { error }, { raw })
    }
  }

  return {
    context,
    receive,
    dispose: (reason?: unknown) => {
      context.abort(reason ?? new Error(`eventa: invoke cancelled, electrobun ${side} rpc disposed`))
    },
  }
}
