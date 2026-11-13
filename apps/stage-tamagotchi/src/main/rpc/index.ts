/**
 * Electrobun port: the typed RPC surface between the Bun main process and every view.
 *
 * Electron had one flat `ipcMain` shared by every window, so `createContext(ipcMain)`
 * could be called per window and all invokes landed in one namespace. Electrobun gives
 * each view its own RPC instance (`BrowserView.defineRPC`) and no cross-view broadcast,
 * so a context is bound to one view and main fans out by itself.
 *
 * Wave 1 carries the boot shell only: splash milestones, splash dismissal and the
 * Control Strip invokes. Every other eventa invoke rejects with an explicit
 * `not-implemented` so the remaining surface is enumerable at runtime.
 */

import type { EventContext } from '@moeru/eventa'
import type { ElectrobunRpcPort } from '@proj-airi/electrobun-eventa/main'
import type { BrowserView } from 'electrobun/main'

import type { StartupMilestoneId, StartupMilestoneStatus, StartupResourceState, StartupSnapshot } from '../../shared/eventa'

// NOTICE: static import, not the runtime `import(specifier)` this used to be. A computed
// specifier is invisible to Bun's bundler, so the packaged app tried to resolve the adapter
// from the app bundle at runtime and failed — every per-view eventa context then fell back to
// the inert proxy and the first window creation aborted DI. The package now exists and
// typechecks, so it is a normal dependency.
import { createMainContext as createElectrobunMainContext } from '@proj-airi/electrobun-eventa'
import { BrowserWindow, BrowserView as ElectrobunBrowserView } from 'electrobun/main'

import { electronSplashStateChanged } from '../../shared/eventa'
import { dispatchToIpcMain } from '../electron-shim'

/** The single RPC method eventa traffic rides on. */
const EVENTA_TAG = 'eventa:emit'

/** Both sides carry only eventa traffic in wave 1; a view with its own schema extends it. */
interface AIRRPCCapability {
  requests: {
    'eventa:emit': { params: unknown, response: void }
  }
  messages: {
    'eventa:emit': { payload: unknown }
  }
}

export interface AIRRPC {
  bun: AIRRPCCapability
  webview: AIRRPCCapability
}

/** Thrown by every not-yet-ported service, window and invoke. */
export class ElectrobunPortError extends Error {
  constructor(
    readonly reason: 'not-implemented' | 'unsupported',
    readonly target: string,
  ) {
    super(`[electrobun-port] ${target}: ${reason}`)
    this.name = 'ElectrobunPortError'
  }
}

export function notImplemented(target: string): never {
  throw new ElectrobunPortError('not-implemented', target)
}

/**
 * A tag as the wire needs it.
 *
 * Structural on purpose: an `Eventa<…>` from `@moeru/eventa` is assignable to it, so callers
 * pass the shared tag objects directly.
 */
interface EventaLike {
  id: string
  /** `EventaType` is an enum, so the wire value must accept the enum member, not a bare string. */
  type?: unknown
}

/** eventa's electron envelope, as the wire carries it. */
interface EventaFrame {
  id: string
  /** Electron carries the eventa tag in the frame's top-level `type`; the view-side adapter routes on it. */
  type: string
  payload: { id: string, type: unknown, body?: unknown, from: number }
}

function frame(tag: EventaLike, body: unknown, from = -1): EventaFrame {
  return {
    id: `${tag.id}:${from}`,
    // See packages/electrobun-eventa/src/shared.ts — Electron routes inbound frames on
    // `frame.type`, not `payload.id`, so the tag rides here.
    type: tag.id,
    payload: { id: tag.id, type: tag.type ?? 'event', body, from },
  }
}

export interface StartupRelay {
  snapshot: () => StartupSnapshot
  report: (payload: { id: StartupMilestoneId, status: StartupMilestoneStatus, error?: string }) => void
  dismiss: () => Promise<void> | void
}

/** Wildcard context eventa's `defineInvokeHandler` needs; the electron adapter's richer context widens to this. */
export type AnyEventaContext = EventContext<any, any>

export interface RpcBootstrap {
  /** The instance handed to `new BrowserWindow({ rpc })`; the constructor installs the transport. */
  createViewRpc: () => ElectrobunRpcPort
  /** Bind an eventa context to a view, so `defineInvokeHandler` works per window. */
  contextFor: (view: BrowserView) => Promise<AnyEventaContext>
  /** Track a view so broadcasts and the snapshot replay reach it. */
  attach: (view: BrowserView) => void
  /** Push one eventa frame to every live view (main→view fan-out). */
  broadcast: (tag: EventaLike, body: unknown) => void
  startup: StartupRelay
  dispose: () => void
}

const STARTUP_MILESTONE_IDS: StartupMilestoneId[] = ['core-services', 'sync-engine', 'character-card', 'stage-actor']

type ContextFactory = (view: { id: number, rpc: ElectrobunRpcPort }, options?: { onlySameWindow?: boolean }) => {
  context: AnyEventaContext
  /** Fold one inbound view→main frame into the context's `on`/`invokeHandler` handlers. */
  receive: (frame: unknown) => void
  dispose: (reason?: unknown) => void
}

const contextFactory = createElectrobunMainContext as unknown as ContextFactory

/**
 * Frames arriving before `contextFor` binds a context are held here rather than dropped.
 *
 * A view's first `eventa:emit` request can land before the window manager has attached the
 * view, and the RPC handler must be registered at `defineRPC` time — so the handler needs a
 * target that exists earlier than the context. The queue is drained on bind.
 */
const pendingInbound = new Map<number, unknown[]>()

/** Live views by webview id — the global bus and response routing key off this. */
const viewsById = new Map<number, BrowserView>()

/**
 * Minimal stand-in for Electron's IpcMainEvent: `.sender.send` routes a response back to the
 * originating view over its own RPC channel, `.sender.id` carries the webview id for
 * same-window filters, `.sender.isDestroyed` reports teardown.
 */
function fakeIpcMainEvent(viewId: number) {
  return {
    sender: {
      id: viewId,
      send: (channel: string, ...args: unknown[]) => {
        if (channel !== 'eventa-message')
          return
        const frame = args[0]
        try {
          const view = viewsById.get(viewId)
          ;(view?.rpc as ElectrobunRpcPort | undefined)?.send('eventa:emit', frame)
        }
        catch {
          // View already torn down.
        }
      },
      isDestroyed: () => !viewsById.has(viewId),
    },
  }
}

/** Hand the frame to the global bus and to the bound context, or hold it until one exists. */
function deliverInbound(viewId: number, frame: unknown, adapter: { receive: (frame: unknown) => void } | undefined): void {
  // Electron parity: orphan `createContext(ipcMain)` modules (channel-server & friends) live on
  // the global bus and see every view's frame regardless of per-view bind state.
  dispatchToIpcMain('eventa-message', fakeIpcMainEvent(viewId), frame)
  if (adapter) {
    adapter.receive(frame)
    return
  }
  const queue = pendingInbound.get(viewId) ?? []
  queue.push(frame)
  pendingInbound.set(viewId, queue)
}

export async function createRpcBootstrap(options: {
  dismissSplash: () => Promise<void> | void
}): Promise<RpcBootstrap> {
  const milestones = new Map<StartupMilestoneId, StartupResourceState>(
    STARTUP_MILESTONE_IDS.map(id => [id, { id, status: 'queued' as StartupMilestoneStatus }]),
  )
  const contexts = new Map<number, AnyEventaContext>()
  /** The adapter bound to each view, so inbound frames reach `receive` and `dispose` on close. */
  const adapters = new Map<number, { receive: (frame: unknown) => void, dispose: (reason?: unknown) => void }>()
  const views = new Set<BrowserView>()
  let lastSnapshot: StartupSnapshot | undefined
  let dismissed = false

  const buildStartupSnapshot = (): StartupSnapshot => {
    const resources = STARTUP_MILESTONE_IDS.map(id => ({ ...milestones.get(id)! }))
    const finished = resources.filter(r => r.status === 'ready' || r.status === 'skipped').length
    return {
      resources,
      progress: Math.round((finished / resources.length) * 100),
      ready: resources.length > 0 && resources.every(r => r.status === 'ready' || r.status === 'skipped'),
      failed: resources.find(r => r.status === 'failed'),
    }
  }

  const broadcast = (tag: EventaLike, body: unknown) => {
    for (const view of views) {
      const rpc = view.rpc as ElectrobunRpcPort | undefined
      if (!rpc)
        continue
      try {
        rpc.send(EVENTA_TAG, frame(tag, body))
      }
      catch (err) {
        console.warn(`[RPC] Failed to send ${tag.id}:`, err)
      }
    }
  }

  const startup: StartupRelay = {
    snapshot: () => lastSnapshot ?? buildStartupSnapshot(),
    report: (payload) => {
      if (!STARTUP_MILESTONE_IDS.includes(payload.id))
        return
      milestones.set(payload.id, { id: payload.id, status: payload.status, error: payload.error })
      lastSnapshot = buildStartupSnapshot()
      broadcast(electronSplashStateChanged, lastSnapshot)
    },
    dismiss: async () => {
      if (dismissed)
        return
      dismissed = true
      await options.dismissSplash()
    },
  }

  const attach = (view: BrowserView) => {
    views.add(view)
    viewsById.set(view.id, view)
    // `BrowserView.on()` carries only navigation/download events — nothing ever emits a
    // view-level `close`. The owning window's `close` is the only close signal (the devkit
    // drops a window's views in its own close handler), and `BrowserView.remove()` is silent.
    //
    // NOTICE: the subscription is never removed. `Electrobun.events` (devkit index.ts:291)
    // is a plain Node EventEmitter, so `off()` exists — but the devkit never exports the
    // emitter itself, `BrowserWindow` has no `off`/`once`, and an anonymous handler can't be
    // unsubscribed anyway. Cost is one closure per closed window, identical to
    // `windows/registry.ts:32`.
    BrowserWindow.getById(view.windowId)?.on('close', () => {
      views.delete(view)
      viewsById.delete(view.id)
      contexts.delete(view.id)
      pendingInbound.delete(view.id)
      adapters.get(view.id)?.dispose()
      adapters.delete(view.id)
    })

    // The splash renderer starts querying at t=0, before the handler exists;
    // replay the last snapshot so a late view catches up immediately.
    if (lastSnapshot) {
      const rpc = view.rpc as ElectrobunRpcPort | undefined
      try {
        rpc?.send(EVENTA_TAG, frame(electronSplashStateChanged, lastSnapshot))
      }
      catch {}
    }
  }

  return {
    attach,
    createViewRpc: () => {
      // The view's request handlers hang off this instance; the BrowserWindow
      // constructor that receives it installs the transport.
      //
      // Every eventa frame carries its sender in `payload.from` (the view adapter
      // stamps it), so no view id needs threading through here: the handler keys the
      // pending queue off the frame itself.
      const rpc = ElectrobunBrowserView.defineRPC<AIRRPC>({
        handlers: {
          requests: {
            'eventa:emit': (params: unknown) => {
              const from = (params as { payload?: { from?: number } } | null)?.payload?.from
              const viewId = typeof from === 'number' ? from : -1
              deliverInbound(viewId, params, adapters.get(viewId))
            },
          },
          messages: {
            'eventa:emit': () => {},
          },
        },
      }) as unknown as ElectrobunRpcPort

      return rpc
    },
    contextFor: async (view) => {
      const existing = contexts.get(view.id)
      if (existing)
        return existing

      const adapter = contextFactory({ id: view.id, rpc: view.rpc as ElectrobunRpcPort })
      adapters.set(view.id, adapter)
      contexts.set(view.id, adapter.context)

      // Frames that arrived before this view was bound are folded in now, in order,
      // so a view that starts emitting at t=0 is not silently missing events.
      const held = pendingInbound.get(view.id)
      if (held) {
        pendingInbound.delete(view.id)
        for (const frame of held)
          adapter.receive(frame)
      }

      return adapter.context
    },
    broadcast,
    dispose: () => {
      for (const context of contexts.values())
        context.abort(new ElectrobunPortError('unsupported', 'rpc bootstrap disposed'))
      contexts.clear()
      for (const adapter of adapters.values())
        adapter.dispose()
      adapters.clear()
      pendingInbound.clear()
      views.clear()
    },
    startup,
  }
}
