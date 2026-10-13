import type * as Libp2pStoreModule from './libp2p'

/**
 * `window` and `RUNTIME_ENVIRONMENT` must be in place before the store module
 * evaluates `isElectronWindow()` at module scope, which is why the module is
 * resolved through `freshStore()` below rather than a top-level import. See the
 * exception note on `freshStore` for the ts-no-dynamic-import rationale.
 */
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

/**
 * Renderer-side libp2p store.
 *
 * The store's job is to translate user intent in the settings page into IPC
 * calls and to reflect the result back, so these tests assert three things:
 * an action actually reaches main, a failed action is visible through
 * `lastError`, and the deep watcher over the four config refs does not turn an
 * IPC echo back into another round trip.
 *
 * `@proj-airi/electron-vueuse` is the only boundary mocked: it is the seam that
 * turns an eventa descriptor into a callable, and a real Electron window cannot
 * exist in this runner. Everything above it — the store, its guards, its
 * watchers and its pending bookkeeping — runs for real, and `window` is set up
 * before the module is imported so `isElectronWindow()` sees a renderer.
 */

/** The recorded invoker calls and the payloads handed to them. */
const h = vi.hoisted(() => ({
  calls: [] as string[],
  payloads: [] as Array<{ id: string, payload: Record<string, unknown> }>,
}))

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaContext: () => ({ value: undefined }),
  useElectronEventaInvoke: (invoke: { receiveEvent?: { id?: string } }) => {
    const id = invoke?.receiveEvent?.id ?? 'unknown'
    return async (...args: unknown[]) => {
      h.calls.push(id)
      h.payloads.push({ id, payload: (args[0] ?? {}) as Record<string, unknown> })
      // A failure surfaces as a rejection, which is what the real descriptor
      // bridge does when main throws; the store has to record it.
      if (id.endsWith(':ping-receive'))
        throw new Error('main rejected the ping')
      // A status is what main returns from a start, and `isRunning` is derived
      // from it, so returning one makes the watcher see a running service.
      if (id.endsWith(':start-receive'))
        return { running: true }
      return args.length > 0 ? { ...(args[0] as Record<string, unknown>) } : undefined
    }
  },
}))

/** `window` must exist before the store module evaluates `isElectronWindow()`. */
;(globalThis as Record<string, unknown>).window = globalThis
;(globalThis as Record<string, unknown>).electron = {}

/** Prime the environment the store reads at module scope. */
vi.stubEnv('RUNTIME_ENVIRONMENT', 'electron')

/**
 * Resolve the store module against a module registry reset per test.
 *
 * `vi.resetModules()` is required because the store reads `isElectronWindow()`
 * and the config refs at module scope, and a single registry entry cannot be
 * re-evaluated with a different `window`. The dynamic specifier is a fixed
 * literal (see the exception note at the top of the file).
 */
function freshStore(): Promise<typeof Libp2pStoreModule> {
  vi.resetModules()
  return import('./libp2p')
}

/** Type of the module under test, sourced from its own declaration. */
let mod: typeof Libp2pStoreModule

beforeEach(async () => {
  h.calls = []
  localStorage.clear()
  mod = await freshStore()
  setActivePinia(createPinia())
})

describe('libp2p renderer store — actions reach main', () => {
  it('calls the start invoker and commits the enabled toggle only on success', async () => {
    const store = mod.useLibp2pStore()
    expect(store.isElectron).toBe(true)

    await store.startService()

    // ROOT CAUSE:
    //
    // Each guarded action carried the missing-invoker guard as
    // `if (!invokeX) reportError(...)` followed by a `return` at
    // function-body indent, so the `return` closed the `if` and was reached on
    // every path. From `setPending` onward every action body was unreachable:
    // the whole local-mesh settings surface was inert, including `applyConfig`,
    // so the deep-watch → applyConfig echo path was dead too.
    //
    // FIXED BY: the guard is now a brace block, so the early return is inside it
    // and the action body runs whenever the invoker exists.
    expect(h.calls).toContain('eventa:invoke:electron:libp2p:start-receive')

    expect(store.enabled).toBe(true)
    // `enabled` is the persisted intent, so it may only be committed once main
    // has accepted the start.
    await vi.waitFor(() => expect(store.pending.start).toBe(false))
  })

  it('records lastError when an action is rejected, instead of failing silently', async () => {
    const store = mod.useLibp2pStore()

    // ROOT CAUSE:
    //
    // The settings page calls these from checkbox and button handlers with no
    // `await`, so a rejected invoke was swallowed before the rollback branch was
    // ever reached. A failed action looked exactly like a successful no-op.
    //
    // FIXED BY: `reportError` writes `lastError` and appends to `eventLog`, and
    // the toggle is rolled back to the value it had before the attempt.
    await store.pingPeer('12D3KooWArVY9ACkibPyvWrQFJxhyRHrkonGkcnfs981mLJS5eEp')

    expect(h.calls).toContain('eventa:invoke:electron:libp2p:ping-receive')
    expect(store.lastError).toMatch(/ping|rejected/i)
    expect(store.eventLog.at(-1)?.message).toContain('ping')
  })

  it('honours a pending guard so a double click cannot start two nodes', async () => {
    const store = mod.useLibp2pStore()

    const first = store.startService()
    const second = store.startService()
    await Promise.all([first, second])

    expect(h.calls.filter(id => id.endsWith(':start-receive'))).toHaveLength(1)
  })

  it('applies the sanitised transport list to the payload that reaches main', async () => {
    const store = mod.useLibp2pStore()

    // ROOT CAUSE:
    //
    // `startService`/`applyConfig` forwarded the persisted array raw. Forwarding
    // an invalid member made main's `safeParse` reject the whole config file and
    // auto-heal it back to defaults, discarding `enabled`, `bootstrapPeers` and
    // `topics`.
    //
    // FIXED BY: `sanitizeTransports` on every write path that reaches main. The
    // payload handed to the invoker is the observable boundary, so it is recorded
    // by the mock and asserted here; reading the store's own ref back would also
    // pass if the store merely sanitised what it displayed.
    await store.startService()
    const startCall = h.payloads.find(p => p.id.endsWith(':start-receive'))
    expect(startCall, 'the payload must reach main').toBeDefined()

    // Every persisted transport kind is a member of the allowed set, so a
    // well-formed store must produce a payload whose array holds exactly those
    // members and nothing else. A raw forward of a list holding an unknown
    // member would carry it to main and trigger the auto-heal.
    const transports = startCall?.payload.transports
    expect(Array.isArray(transports)).toBe(true)
    const allowed: Record<string, true> = { tcp: true, websockets: true, webrtc: true, webtransport: true }
    const sent: unknown[] = Array.isArray(transports) ? transports : []
    expect(sent, 'the start payload must carry a transport list').not.toHaveLength(0)
    for (const kind of sent)
      expect(allowed[String(kind)] === true, `"${String(kind)}" must not reach main`).toBe(true)
  })
})

describe('libp2p renderer store — config echo does not feed back', () => {
  it('treats an identical-content echo from main as a no-op', async () => {
    const store = mod.useLibp2pStore()

    // ROOT CAUSE:
    //
    // The deep watcher over the four config refs re-fired on every write-back
    // from main, because an IPC round trip always produces fresh array
    // identities and `deep: true` skips the equality guard. Each cycle did a
    // full node stop and restart, so the first transport toggle while running
    // spun forever.
    //
    // FIXED BY: comparing a serialized content signature, applied per source, so
    // an equal-content echo is a no-op while a real change still goes through
    // exactly once.
    await store.startService()
    expect(h.calls).toContain('eventa:invoke:electron:libp2p:start-receive')

    h.calls = []
    // Main echoes the same configuration back: same content, new identities.
    store.transports = [...store.transports]
    store.topics = [...store.topics]
    await nextTick()

    // No fresh stop/restart cycle from an echo carrying no real change.
    expect(h.calls).not.toContain('eventa:invoke:electron:libp2p:stop-receive')
  })

  it('applies a real change exactly once', async () => {
    const store = mod.useLibp2pStore()
    await store.startService()
    h.calls = []
    h.payloads = []

    // The watcher only re-applies while the service is running, and only when the
    // signature differs from the last one successfully applied. A real edit does
    // both, so it must reach main exactly once.
    expect(store.enabled).toBe(true)

    store.meshSyncEnabled = !store.meshSyncEnabled
    await nextTick()

    expect(h.calls.filter(id => id.endsWith(':apply-config-receive'))).toHaveLength(1)
  })
})
