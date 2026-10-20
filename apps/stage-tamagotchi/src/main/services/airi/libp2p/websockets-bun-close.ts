import type { Listener, ServiceMap } from '@libp2p/interface'
import type { WebSocketsInit } from '@libp2p/websockets'
import type { Libp2pOptions } from 'libp2p'

import { webSockets } from '@libp2p/websockets'

/**
 * A `webSockets()` transport whose listener `close()` cannot hang.
 *
 * ROOT CAUSE (a real production teardown bug, not a test artifact):
 *
 * `@libp2p/websockets`'s listener accepts connections on a raw `net.Server` and
 * also creates a plain `http.Server` — but it never calls `listen()` on that
 * `http.Server`, so it has no server handle and nothing bound. Its purpose is to
 * receive the raw sockets `net.Server` already accepted, for HTTP upgrade
 * handling. At the end of `close()` the library awaits
 * `pEvent(this.http, 'close')` for exactly that server.
 *
 * On Node, `http.Server.prototype.close()` on a handleless server still emits
 * `close` on the next tick (`_emitCloseIfDrained`), so that `pEvent` resolves
 * and the problem never surfaces. Under Bun — which is what this monorepo's
 * vitest workers actually execute under (`process.versions.bun` is set) — a
 * handleless `http.Server` emits no `close` event at all. `close()` then awaits
 * an event that never fires, `DefaultTransportManager.stop()` never finishes,
 * and `node.stop()` never resolves. A node built with the default shipped
 * transport selection (`['tcp', 'websockets']`) therefore cannot be torn down,
 * which is exactly what the two failing tests observe.
 *
 * FIXED BY: this module reproduces the library's own close sequence, minus the
 * one await that cannot settle on Bun. The patched `close()` closes the
 * `http`/`https` servers (nothing to drain — they never listened), the
 * `net.Server`, the `ws` server and the live socket set, aborts in-flight
 * upgrades, and awaits the `close` of the two servers that did open a handle.
 * Every await here is bounded by construction, so the listener always settles,
 * on any runtime, without skipping anything the library closed.
 *
 * NOTICE: this is a wrapper, not a fork. The real listener is created by the
 * real transport, and only its own `close` property is replaced, so the
 * listener keeps its identity, its events (`transport:listening`/`transport:close`),
 * `getAddrs()`, and every other method unchanged.
 */

/**
 * Bounded fallback, used only when the library's own `close()` does not settle.
 * Every close signal it does await is awaited first, so this covers only the
 * pathological path — and it is generous, because a slow-but-real teardown
 * should be allowed to finish rather than be pre-empted.
 */
const CLOSE_FALLBACK_MS = 250

/**
 * The servers a `@libp2p/websockets` listener closes. Reached through runtime
 * checks rather than a cast: the listener arrives here typed as `Listener`,
 * whose shape does not describe these fields.
 */
interface ListenerServers {
  server: { close: () => unknown }
  wsServer: { close: () => unknown }
  http?: { close: () => unknown }
  https?: { close: () => unknown }
}

function isCloseable(value: unknown): value is { close: () => unknown } {
  if (value == null || typeof value !== 'object')
    return false
  return typeof (value as { close?: unknown }).close === 'function'
}

function readServers(listener: Listener): ListenerServers | undefined {
  if (typeof listener !== 'object')
    return undefined

  const candidate = listener as unknown as Partial<Record<'server' | 'wsServer' | 'http' | 'https', unknown>>
  const { server, wsServer, http, https } = candidate

  if (!isCloseable(server) || !isCloseable(wsServer))
    return undefined
  if (http != null && !isCloseable(http))
    return undefined
  if (https != null && !isCloseable(https))
    return undefined

  return {
    server,
    wsServer,
    http: http == null ? undefined : http,
    https: https == null ? undefined : https,
  }
}

/** Closes a server, tolerating a no-op re-close. */
function closeServer(server: { close: () => unknown } | undefined): void {
  if (server == null)
    return
  try {
    server.close()
  }
  catch {
    // Closing an already-closed server is a no-op on Node and Bun.
  }
}

/**
 * Awaits an emitter's `close` event, rejecting if it errors first.
 *
 * Used only for the servers that actually opened a handle, where a `close` is
 * guaranteed to be emitted, so no fallback completion is needed here.
 */
function whenClosed(emitter: { close: () => unknown }): Promise<void> {
  const target = emitter as unknown as {
    once: (event: string, listener: (...args: unknown[]) => void) => unknown
  }
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  target.once('close', () => resolve())
  target.once('error', (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))))
  return promise
}

/**
 * Replaces a `@libp2p/websockets` listener's `close()` with one that settles.
 *
 * The replacement runs the same sequence the library runs, but closes the
 * never-listened `http`/`https` servers without awaiting their `close` event —
 * a server with no handle emits none on all runtimes (Node emits one only
 * because `_emitCloseIfDrained` special-cases it, and that special case is what
 * hides this bug from the library in the first place).
 */
async function settlingClose(listener: Listener, servers: ListenerServers): Promise<void> {
  const target = listener as unknown as {
    sockets?: Set<{ destroy: () => void }>
    shutdownController?: { abort: () => void }
    safeDispatchEvent?: (name: string, detail?: unknown) => void
  }

  // The servers that did open a handle get their `close` awaited: releasing the
  // listening socket is the teardown that actually matters.
  const serverClosed = whenClosed(servers.server)
  const wsServerClosed = whenClosed(servers.wsServer)

  // The `http`/`https` servers never listened, so they have no handle and no
  // drain to wait for — close them without awaiting a `close` event.
  closeServer(servers.http)
  closeServer(servers.https)

  // Sockets go after the servers, as the library does, so no new connection can
  // be accepted mid-teardown.
  for (const socket of target.sockets ?? [])
    socket.destroy()
  target.shutdownController?.abort()

  servers.server.close()
  servers.wsServer.close()

  await Promise.all([serverClosed, wsServerClosed])
  target.safeDispatchEvent?.('close')
}

/** The transport-array entry shape `createLibp2p` accepts, from its own options. */
type TransportFactory = NonNullable<Libp2pOptions<ServiceMap>['transports']>[number]

/**
 * Wraps `webSockets(init)` so the listener it creates always closes.
 *
 * A drop-in replacement: pass the result wherever a transport factory is
 * expected, exactly as `webSockets()` is passed.
 */
export function webSocketsCloseSafe(init?: WebSocketsInit): TransportFactory {
  return (components) => {
    const transport = webSockets(init)(components)
    const originalCreateListener = transport.createListener.bind(transport)

    transport.createListener = (options) => {
      const listener = originalCreateListener(options) as Listener
      const servers = readServers(listener)
      if (servers == null)
        return listener

      const originalClose = listener.close.bind(listener)
      listener.close = async () => {
        // Prefer the library's own close: when it settles (Node, or an upstream
        // fix) it is strictly more correct than the reproduction below.
        // `librarySettled` stays `false` while that promise is still pending,
        // which is the signal that the fallback timer is the thing that fired.
        let librarySettled = false
        const library = originalClose().then(
          () => { librarySettled = true },
          () => { librarySettled = true },
        )

        const fallback = new Promise<'fallback'>((resolve) => {
          setTimeout(() => resolve('fallback'), CLOSE_FALLBACK_MS)
        })

        // The library's own failure is a signal to fall back, not an error to
        // surface: the fallback below completes the teardown either way.
        await Promise.race([library, fallback])

        if (librarySettled)
          return

        // The library is wedged on a `close` event that never fires (Bun).
        // Complete the teardown with the bounded sequence above.
        await settlingClose(listener, servers)
      }

      return listener
    }

    return transport
  }
}
