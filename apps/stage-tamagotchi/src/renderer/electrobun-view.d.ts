/**
 * Electrobun port: minimal ambient surface for `electrobun/view` on the web program.
 *
 * Why this exists: the real `electrobun/view` devkit lives under `apps/stage-tamagotchi/.hutch/`,
 * which the web tsconfig cannot see (its baseUrl is `./src/renderer`). `tsconfig.node.json` maps
 * `electrobun/view` to the devkit for the main program; this shim mirrors the small surface the
 * renderer actually consumes — `Electroview.defineRPC` / `new Electroview` — without `any`.
 *
 * Keep in sync with `.hutch/devkit/api/browser/index.ts`; delete once the devkit is reachable
 * from the web program directly.
 */

declare module 'electrobun/view' {
  /** The RPC instance the view drives: a request/response pair plus a message listener. */
  interface ElectrobunViewRpc {
    request: (method: string, params?: unknown) => Promise<unknown>
    send: (message: string, payload?: unknown) => void
    addMessageListener: (message: string, listener: (payload: unknown) => void) => void
    removeMessageListener: (message: string, listener: (payload: unknown) => void) => void
  }

  /** One side of the schema: the request/response and message surface it carries. */
  interface ElectrobunRpcCapability {
    requests: Record<string, { params: unknown, response: unknown }>
    messages: Record<string, { payload: unknown }>
  }

  /** Combined schema: both sides of the view <-> Bun boundary. */
  interface ElectrobunRpcSchema {
    bun: ElectrobunRpcCapability
    webview: ElectrobunRpcCapability
  }

  /** Config for `Electroview.defineRPC`: handlers for the methods this side answers. */
  interface ElectrobunRpcConfig {
    handlers: {
      requests: Record<string, () => void>
      messages: Record<string, () => void>
    }
  }

  /** The view-side RPC class; the constructor wires a transport onto the rpc instance. */
  class Electroview {
    constructor(config: { rpc: ElectrobunViewRpc })
    static defineRPC<Schema extends ElectrobunRpcSchema>(config: ElectrobunRpcConfig): ElectrobunViewRpc
  }
}
