import type { ContextMessage } from '../../../types/chat'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'
import { unref } from 'vue'

import { useBackgroundStore } from '../../background'
import { useAiriCardStore } from '../../modules/airi-card'

const SCENES_CONTEXT_ID = 'system:scenes'

/**
 * Creates a context message containing the current background/scene information.
 * This allows the LLM to be aware of its visual environment.
 */
export function createScenesContext(): ContextMessage | null {
  const backgroundStore = useBackgroundStore()
  const airiCardStore = useAiriCardStore()

  const card = unref(airiCardStore.activeCard) as any
  const activeBackgroundId = card?.extensions?.airi?.modules?.activeBackgroundId
  const background = activeBackgroundId ? backgroundStore.entries.get(activeBackgroundId) : null

  // NOTICE: Scoping the visible scenes available to only items intended as environmental backgrounds.
  // We exclude 'selfie' and other image types to prevent roleplay confusion.
  const isValidScene = background && ['builtin', 'scene', 'journal'].includes(background.type)

  if (!background || !isValidScene) {
    return null
  }

  let sceneInfo = background.title
  if (background.prompt) {
    // For generated backgrounds, the prompt often contains more descriptive detail
    sceneInfo += ` (Vibe: ${background.prompt})`
  }

  return {
    id: nanoid(),
    contextId: SCENES_CONTEXT_ID,
    source: 'scenes',
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text: `Current Scene: ${sceneInfo}`,
    createdAt: Date.now(),
  }
}
