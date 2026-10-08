---
name: airi-ipc-eventa
description: >-
  Define/debug typed Electron main/renderer IPC and RPC: @moeru/eventa contracts, defineInvokeEventa, defineStreamInvokeHandler, streaming RPC, channel piping, renderer calls, main handlers. Window-to-window BroadcastChannel relays use airi-broadcast-channels.
---

# AIRI IPC & Eventa Protocol

This skill defines typed IPC/RPC and streaming communication boundaries across AIRI using `@moeru/eventa`. It covers contract definitions in `shared/eventa.ts`, unary/streaming RPC implementations across Electron's Main and Renderer processes, multi-hop channel routing, and transport adapters.

---

## 1. Key Code Paths

- **Shared Contracts:** `apps/stage-tamagotchi/src/shared/eventa.ts` (the canonical registry for all Electron IPC events and RPC invoke contracts).
- **Main Process Adapters & Contexts:** `packages/electron-eventa/src/`, `apps/stage-tamagotchi/src/main/services/electron/` (e.g. `window.ts`, `screen.ts`, `powerMonitor.ts`).
- **Main Process Domain Handlers:** `apps/stage-tamagotchi/src/main/windows/**/rpc/index.electron.ts`.
- **Renderer Invocations:** Composable and component calls in `apps/stage-tamagotchi/src/renderer/` (invoking typed RPC or listening to broadcast events).
- **Multi-Window Relays:** High-frequency, window-to-window communication uses `BroadcastChannel` (see `airi-broadcast-channels`).

---

## 2. Core RPC & Event Patterns

### 2.1 Unary RPC (Request-Response)
All typed contracts are defined in `apps/stage-tamagotchi/src/shared/eventa.ts`.

> **Contract Rule**: `defineInvokeEventa<ResponseType, RequestType>(channelName)` — **Response type is ALWAYS first, Request/Payload type second**.

```ts
import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

// Unary RPC contract:
export const electronShowToast = defineInvokeEventa<
  void,
  { message: string, duration?: number }
>('eventa:invoke:electron:show-toast')

// Broadcast event contract (fire-and-forget):
export const electronToastBroadcast = defineEventa<
  { message: string }
>('eventa:event:electron:toast-broadcast')
```

### 2.2 Main Process Handler Registration
In the main process, register handlers against a scoped `EventaContext`:

```ts
import type { EventaContext } from '@moeru/eventa'
import type { BrowserWindow } from 'electron'

import { defineInvokeHandler } from '@moeru/eventa'

import { electronShowToast } from '../../../shared/eventa'

export function registerToastService(context: EventaContext, window: BrowserWindow) {
  defineInvokeHandler(context, electronShowToast, async (payload, options) => {
    // 1. Validate sender window identity when action is window-scoped
    if (window.isDestroyed() || window.webContents.id !== options?.raw?.ipcMainEvent?.sender?.id)
      return

    // 2. Execute logic
    console.log(`[ToastService] Toast: ${payload.message}`)
  })
}
```

### 2.3 Streaming RPC (Server-to-Client Streaming)
When main or background workers stream chunks, progress, or multi-part payloads to a renderer:

```ts
import { defineInvokeEventa, defineStreamInvokeHandler, toStreamHandler } from '@moeru/eventa'

// Contract:
export const syncJobProgress = defineInvokeEventa<
  { type: 'progress' | 'result', value: number },
  { jobId: string }
>('eventa:invoke:sync-job')

// Handler (Generator Style with yield):
defineStreamInvokeHandler(context, syncJobProgress, async function* ({ jobId }, options) {
  const signal = options?.abortController?.signal

  for (let i = 1; i <= 5; i++) {
    if (signal?.aborted)
      return
    yield { type: 'progress' as const, value: i * 20 }
    await new Promise(r => setTimeout(r, 100))
  }
  yield { type: 'result' as const, value: 100 }
})
```

### 2.4 Consuming Streams in the Renderer
Consume streaming RPCs cleanly as async iterables:

```ts
import { defineStreamInvoke } from '@moeru/eventa'

import { syncJobProgress } from '../../../shared/eventa'

const invokeSyncJob = defineStreamInvoke(rendererContext, syncJobProgress)

for await (const update of invokeSyncJob({ jobId: 'model-import' })) {
  if (update.type === 'progress') {
    progressBar.value = update.value
  }
}
```

### 2.5 Cancellation & AbortSignals
Cancellation propagates across intermediate adapters and contexts:

```ts
// Renderer (Client) Cancellation:
const controller = new AbortController()
const promise = invokeTask({ id: 'task-1' }, { signal: controller.signal })
controller.abort('User cancelled')

// Main Handler Abort Awareness:
defineInvokeHandler(context, taskEvent, async ({ id }, options) => {
  const signal = options?.abortController?.signal
  if (signal?.aborted)
    return { status: 'cancelled' }

  signal?.addEventListener('abort', () => {
    // Perform urgent resource teardown / kill child process
  }, { once: true })
})
```

---

## 3. Transport Adapter Matrix

Each transport wraps a native platform boundary into a typed Eventa context:

| Boundary | Import Path | Transport Object |
| :--- | :--- | :--- |
| **Electron Main** | `@moeru/eventa/adapters/electron/main` | `ipcMain`, `webContents` |
| **Electron Renderer** | `@moeru/eventa/adapters/electron/renderer` | `ipcRenderer` |
| **Web Worker** | `@moeru/eventa/adapters/webworkers` | `Worker` / `self` |
| **Worker Threads** | `@moeru/eventa/adapters/worker-threads` | Node.js `Worker` / `parentPort` |
| **WebSocket** | `@moeru/eventa/adapters/websocket/native` | `WebSocket` |
| **BroadcastChannel** | `@moeru/eventa/adapters/broadcast-channel` | `BroadcastChannel` |

- **Cross-Window Boundary Rule**: For Electron main-to-renderer communication, initialize contexts via the Electron adapters. For lightweight window-to-window synchronization that bypasses the Electron main thread, use native `BroadcastChannel` or `@moeru/eventa/adapters/broadcast-channel` (see `airi-broadcast-channels`).

---

## 4. Known Pitfalls & Failure Modes

1. **Proxy Serialization Failure**: Eventa uses structured cloning over Electron IPC. Passing Vue reactive proxies, functions, `Symbol`s, circular graphs, or class instances with non-serializable methods will throw cloning errors. Always sanitize payloads with `toRaw()` or extract plain objects before invoking.
2. **Reverse Generic Parameters**: Writing `defineInvokeEventa<Req, Res>` instead of `<Res, Req>` is a frequent bug. The response type **always** comes first.
3. **Destroyed Window Exceptions**: Main-process handlers that interact with a renderer's `BrowserWindow` must check `!window.isDestroyed()` before calling `webContents.send()` or querying bounds.
4. **Cross-Window IPC Leakage**: In Electron multi-window setups (Actor Stage vs Control Strip), shared `ipcMain` listeners can process invocations from unintended windows. Always verify `window.webContents.id === options?.raw?.ipcMainEvent?.sender?.id` or configure window-scoped eventa contexts (`onlySameWindow: true`).

---

## 5. Verification Workflows

- Run `pnpm -F @proj-airi/stage-tamagotchi typecheck` whenever modifying `shared/eventa.ts` or main/renderer handlers.
- Test multi-window IPC in dev (`pnpm dev`) to ensure payloads serialize cleanly across processes.
