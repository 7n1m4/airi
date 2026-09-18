import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

export const useSettingsUserProfile = defineStore('settings-user-profile', () => {
  const name = useLocalStorageManualReset<string>('settings/user-profile/name', 'Richy')
  const description = useLocalStorageManualReset<string>(
    'settings/user-profile/description',
    'A hands-on, down-to-earth creator who loves building things from scratch. Prefers honest, direct conversation and cozy downtime after a long day of work.',
  )
  const prompt = useLocalStorageManualReset<string>('settings/user-profile/prompt', '')
  const voiceProfileId = useLocalStorageManualReset<string>('settings/user-profile/voice-profile-id', '')

  function resetState() {
    name.reset()
    description.reset()
    prompt.reset()
    voiceProfileId.reset()
  }

  return {
    name,
    description,
    prompt,
    voiceProfileId,
    resetState,
  }
})
