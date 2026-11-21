import type { EventContext, InvokeEventa } from '@moeru/eventa'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { ref } from 'vue'

/**
 * Any eventa context that can back an invoke. The Electron adapter's context
 * and the Electrobun view adapter's context are structurally different only
 * in their `raw` emit option; both satisfy `defineInvoke`, so call sites keep
 * their public signatures when the runtime switches to Electrobun.
 */
type EventaContext = EventContext<any, any>
type IpcRendererLike = Parameters<typeof createContext>[0]

let sharedContext: EventaContext | undefined
let contextProvider: (() => EventaContext | undefined) | undefined

/**
 * Install the runtime's eventa context provider.
 *
 * The Electrobun renderer entry calls this with the shared context from
 * `@proj-airi/electrobun-eventa/view`, so every composable in this package (and
 * every `useElectronEventaInvoke` call site) rides the Electrobun RPC instead
 * of the Electron `window.electron` shim. Passing `undefined` restores the
 * Electron-adapter path for web / Electron builds.
 */
export function setElectronEventaContextProvider(provider: (() => EventaContext | undefined) | undefined): void {
  contextProvider = provider
  sharedContext = undefined
}

function resolveIpcRenderer(ipcRenderer?: IpcRendererLike): IpcRendererLike | undefined {
  if (ipcRenderer) {
    return ipcRenderer
  }

  return (globalThis as { window?: { electron?: { ipcRenderer?: IpcRendererLike } } }).window?.electron?.ipcRenderer
}

export function getElectronEventaContext(ipcRenderer?: IpcRendererLike): EventaContext | undefined {
  // An explicit ipcRenderer means "use the Electron adapter with this transport".
  // Otherwise the installed provider wins, so the Electrobun view context is
  // reused rather than creating a second adapter over the shim.
  if (!ipcRenderer) {
    const provided = contextProvider?.()
    if (provided) {
      return provided
    }
  }

  const resolved = resolveIpcRenderer(ipcRenderer)
  if (!resolved) {
    return undefined
  }

  sharedContext ??= createContext(resolved).context
  return sharedContext
}

export function useElectronEventaContext(ipcRenderer?: IpcRendererLike) {
  return ref(getElectronEventaContext(ipcRenderer))
}

export function useElectronEventaInvoke<Res, Req = undefined, ResErr = Error, ReqErr = Error>(invoke: InvokeEventa<Res, Req, ResErr, ReqErr>, context?: EventaContext) {
  const ctx = context ?? getElectronEventaContext()

  if (!ctx) {
    return (async () => {
      console.warn('Electron IPC is not available in this environment. This invoke will do nothing.')
      throw new Error('Electron IPC not available')
    }) as any
  }

  return defineInvoke(ctx, invoke)
}

export function resetElectronEventaContextForTesting() {
  sharedContext = undefined
  contextProvider = undefined
}
