import type { Tool } from '@xsai/shared-chat'

import { useStickersStore } from '@proj-anima/stage-ui/stores/stickers'

/**
 * Tools for interacting with the sticker system.
 */
export function stickersTools(): Tool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'spawn_sticker',
        description: 'Spawns a sticker on the screen to express an emotion, reaction, or decoration. Use specific sticker IDs to choose the visual.',
        parameters: {
          type: 'object',
          properties: {
            stickerId: {
              type: 'string',
              description: 'The unique ID/label of the sticker to spawn.',
            },
            x: {
              type: 'number',
              description: 'Horizontal position (0-100 as percentage of screen width). Random if omitted.',
            },
            y: {
              type: 'number',
              description: 'Vertical position (0-100 as percentage of screen height). Random if omitted.',
            },
            duration: {
              type: 'integer',
              description: 'Lifespan in seconds before the sticker fades out. Default is 60s.',
            },
          },
          required: ['stickerId'],
        },
      },
      async execute({ stickerId, x, y, duration }: any) {
        const stickersStore = useStickersStore()
        const placement = stickersStore.spawnSticker(stickerId, { x, y, duration })

        if (placement && typeof placement === 'object') {
          const expirationInfo = duration ? ` for ${duration}s` : ''
          return `Successfully spawned sticker "${stickerId}"${expirationInfo} at (${Math.round((placement as any).x)}%, ${Math.round((placement as any).y)}%).`
        }
        else if (typeof placement === 'string') {
          // Store already provides a helpful message with available labels:
          // "Sticker label '...' not found... Available labels: ..."
          return placement
        }
        else {
          const available = stickersStore.currentLibrary.map(s => s.label).join(', ')
          return `Sticker "${stickerId}" not found. Available stickers in your library: ${available || 'None (Upload some first!)'}`
        }
      },
    },
  ]
}
