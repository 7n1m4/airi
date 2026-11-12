import type { AutoUpdaterState } from '../../../shared/eventa'

import { ElectrobunPortError } from '../../rpc'

export interface AppUpdaterLike {
  on: (event: string, listener: (...args: any[]) => void) => any
  checkForUpdates: () => Promise<any>
  downloadUpdate: () => Promise<any>
  quitAndInstall: () => Promise<void>
}

// NOTICE: this part of code is copied from https://www.electron.build/auto-update
// Or https://github.com/electron-userland/electron-builder/blob/b866e99ccd3ea9f85bc1e840f0f6a6a162fca388/pages/auto-update.md?plain=1#L57-L66
export function fromImported(): AppUpdaterLike {
  // TODO(port): `electron-updater` + `~build/git` are Electron-only; Electrobun ships `Updater`
  // (`release.baseUrl` + `artifacts/*-update.json`) and the commit date comes from build
  // metadata — see docs/design-electrobun-port.md §3.1 (wave 4).
  throw new ElectrobunPortError('not-implemented', 'services:auto-updater')
}

export interface AutoUpdater {
  state: AutoUpdaterState
  checkForUpdates: () => Promise<void>
  downloadUpdate: () => Promise<void>
  quitAndInstall: () => void
  subscribe: (callback: (state: AutoUpdaterState) => void) => () => void
}

/**
 * Wave 4: Electrobun's `Updater` (`release.baseUrl` + `artifacts/*-update.json`) replaces
 * `electron-updater`, and the commit date comes from the build metadata instead of `~build/git`.
 * Until then every call rejects with the port error so the gap is enumerable at runtime.
 */
export function setupAutoUpdater(): AutoUpdater {
  const state: AutoUpdaterState = { status: 'idle' }
  const reject = () => {
    throw new ElectrobunPortError('not-implemented', 'services:auto-updater')
  }

  return {
    state,
    checkForUpdates: async () => reject(),
    downloadUpdate: async () => reject(),
    quitAndInstall: () => reject(),
    subscribe: (callback) => {
      try {
        callback(state)
      }
      catch {}
      return () => {}
    },
  }
}

export function createAutoUpdaterService(_params: { context: unknown, window: unknown, service: AutoUpdater }): void {
  throw new ElectrobunPortError('not-implemented', 'services:auto-updater')
}
