import { useLocalStorageManualReset } from '@proj-anima/stage-shared/composables'
import { defineStore } from 'pinia'

export const useSettingsSpine = defineStore('settings-spine', () => {
  const spineDefaultMixDuration = useLocalStorageManualReset<number>('settings/spine/default-mix', 0.2)
  const spineIdleAnimationEnabled = useLocalStorageManualReset<boolean>('settings/spine/idle-enabled', true)
  const spineMaxFps = useLocalStorageManualReset<number>('settings/spine/max-fps', 0)
  const spineRenderScale = useLocalStorageManualReset<number>('settings/spine/render-scale', 1)

  function resetState() {
    spineDefaultMixDuration.reset()
    spineIdleAnimationEnabled.reset()
    spineMaxFps.reset()
    spineRenderScale.reset()
  }

  return {
    spineDefaultMixDuration,
    spineIdleAnimationEnabled,
    spineMaxFps,
    spineRenderScale,

    resetState,
  }
})
