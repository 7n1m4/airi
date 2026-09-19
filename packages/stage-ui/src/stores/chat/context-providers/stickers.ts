import type { ContextMessage } from '../../../types/chat'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'

import { useStickersStore } from '../../stickers'

/**
 * Creates context about the available stickers that the assistant can use.
 */
export function createStickersContext(): ContextMessage | null {
  const stickersStore = useStickersStore()
  const availableStickers = stickersStore.currentLibrary.map((s: any) => s.label).join(', ')

  if (!availableStickers) {
    return null
  }

  return {
    id: nanoid(),
    contextId: 'stickers',
    source: 'stickers',
    text: `CRITICAL: You have access to a "Kawaii Sticker System". You can ONLY spawn stickers with the following labels: ${availableStickers}. Do not attempt to use any other labels as they do not exist in your library. Use the spawn_sticker tool with exactly one of these labels.`,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    createdAt: Date.now(),
  }
}
