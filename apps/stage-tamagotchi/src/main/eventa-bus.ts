/**
 * Electrobun port: the main-process event bus that replaces Electron's global `ipcMain`.
 *
 * `packages/electrobun-eventa` binds one eventa context per view (each view has its own
 * `BrowserView.defineRPC`), but a handful of main-side services are not view-bound: they
 * register their invoke handlers once and must see frames coming from *every* view.
 * `src/main/rpc/index.ts` fans each inbound frame here via {@link dispatchToBus}; the
 * Electron eventa adapter (a pure-JS transport adapter, with no `electron` runtime import)
 * subscribes through `on`/`off`, so those services keep their existing registration shape.
 *
 * This is a real in-process emitter, not a compatibility shim: no Electron module is
 * imported, and nothing here pretends a missing native capability exists. It is also the
 * single place to tear down on shutdown.
 */

type BusListener = (event: unknown, ...args: unknown[]) => void
type BusHandler = (...args: unknown[]) => unknown

const listeners = new Map<string, Set<BusListener>>()
const handlers = new Map<string, BusHandler>()

function add(channel: string, listener: BusListener): void {
  const set = listeners.get(channel) ?? new Set()
  set.add(listener)
  listeners.set(channel, set)
}

function remove(channel: string, listener: BusListener): void {
  listeners.get(channel)?.delete(listener)
}

/**
 * Fan one view's frame out to every subscriber. Called by the RPC bootstrap's inbound
 * route, so services written against the flat Electron namespace still fire.
 *
 * @internal
 */
export function dispatchToBus(channel: string, event: unknown, ...args: unknown[]): void {
  for (const listener of listeners.get(channel) ?? []) {
    try {
      listener(event, ...args)
    }
    catch (error) {
      console.error('[eventa-bus] listener failed:', error)
    }
  }
}

/** The surface `@moeru/eventa/adapters/electron/main` and the ported services consume. */
export const ipcMain = {
  on(channel: string, listener: BusListener): unknown {
    add(channel, listener)
    return undefined
  },
  off(channel: string, listener: BusListener): void {
    remove(channel, listener)
  },
  removeListener(channel: string, listener: BusListener): void {
    remove(channel, listener)
  },
  emit(channel: string, ...args: unknown[]): void {
    dispatchToBus(channel, undefined, ...args)
  },
  handle(channel: string, listener: BusHandler): void {
    handlers.set(channel, listener)
  },
  removeHandler(channel: string): void {
    handlers.delete(channel)
  },
  removeAllListeners(channel?: string): void {
    if (channel)
      listeners.delete(channel)
    else
      listeners.clear()
  },
  setMaxListeners(_count: number): void {},
}

/** Test/debug helper: the raw-invoke handlers registered through `ipcMain.handle`. */
export function registeredHandlers(): ReadonlyMap<string, BusHandler> {
  return handlers
}

/** Drop all subscriptions and handlers; called by the shutdown coordinator. */
export function disposeBus(): void {
  listeners.clear()
  handlers.clear()
}
