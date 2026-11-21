import { electron } from '@proj-anima/electron-eventa'
import { useAsyncState, useIntervalFn } from '@vueuse/core'

import { useElectronEventaInvoke } from './use-electron-eventa-context'

export function useElectronAllDisplays() {
  const getAllDisplays = useElectronEventaInvoke(electron.screen.getAllDisplays)
  const { state: allDisplays, execute } = useAsyncState(() => getAllDisplays(), [])

  useIntervalFn(() => {
    void execute()
  }, 5000)

  return allDisplays
}
