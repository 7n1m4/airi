import { useLocalStorageManualReset } from '@proj-anima/stage-shared/composables'
import { defineStore } from 'pinia'

export const useSettingsMmd = defineStore('settings-mmd', () => {
  const mmdIdleAnimationEnabled = useLocalStorageManualReset<boolean>('settings/mmd/idle-enabled', true)
  const mmdRenderScale = useLocalStorageManualReset<number>('settings/mmd/render-scale', 1)

  function resetState() {
    mmdIdleAnimationEnabled.reset()
    mmdRenderScale.reset()
  }

  return {
    mmdIdleAnimationEnabled,
    mmdRenderScale,

    resetState,
  }
})
