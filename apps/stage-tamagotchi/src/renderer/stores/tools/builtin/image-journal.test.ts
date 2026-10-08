import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  executeImageJournalAction,
  imageJournalParams,
} from './image-journal'

const mockGenerateHeadless = vi.fn()
const mockAddWidget = vi.fn()
const mockAddBackground = vi.fn().mockResolvedValue('bg-test-123')
const mockSetActiveBackground = vi.fn()

vi.mock('../../../../shared/eventa', () => ({
  artistryGenerateHeadless: 'artistry:generate:headless',
  widgetsAdd: 'widgets:add',
}))

vi.mock('@moeru/eventa', () => ({
  defineInvoke: (_ctx: any, event: string) => {
    if (event === 'artistry:generate:headless')
      return (...args: any[]) => mockGenerateHeadless(...args)
    if (event === 'widgets:add')
      return (...args: any[]) => mockAddWidget(...args)
    return vi.fn()
  },
}))

const mockGetSessionMessages = vi.fn().mockReturnValue([])

vi.mock('@proj-airi/stage-ui/stores', () => ({
  resolveArtistryConfigFromStore: vi.fn().mockReturnValue({
    provider: 'pollinations',
    model: '',
    promptPrefix: '',
  }),
  stageArtistryIntrusion: vi.fn(),
  useAiriCardStore: () => ({
    activeCard: {
      extensions: {
        airi: {
          artistry: {
            provider: 'pollinations',
            model: '',
            spawnMode: 'inline',
          },
        },
      },
    },
    activeCardId: 'card-test-1',
    cards: new Map(),
    updateCard: vi.fn(),
  }),
  useArtistryStore: () => ({
    activeProvider: 'pollinations',
    configured: true,
  }),
  useBackgroundStore: () => ({
    entries: new Map([
      ['bg-1', { id: 'bg-1', title: 'Sunset at Beach', type: 'journal', characterId: 'card-test-1' }],
    ]),
    addBackground: mockAddBackground,
    setActiveBackground: mockSetActiveBackground,
  }),
  useChatSessionStore: () => ({
    activeSessionId: 'session-test-1',
    getSessionMessages: mockGetSessionMessages,
  }),
}))

describe('image_journal tool parameter normalization and execution', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mockGetSessionMessages.mockReturnValue([])
    mockGenerateHeadless.mockResolvedValue({
      base64: 'fake-base64-data',
    })
    globalThis.fetch = vi.fn().mockResolvedValue({
      blob: () => Promise.resolve(new Blob(['fake-image'], { type: 'image/png' })),
    }) as any
  })

  describe('schema validation', () => {
    it('parses valid create params', () => {
      const parsed = imageJournalParams.safeParse({ action: 'create', prompt: 'a cute anime girl' })
      expect(parsed.success).toBe(true)
    })

    it('allows aliases in schema', () => {
      const parsed = imageJournalParams.safeParse({
        action: 'create',
        description: 'a sunset over the city',
        title: 'City Sunset',
      })
      expect(parsed.success).toBe(true)
    })
  })

  describe('executeImageJournalAction parameter aliasing and recovery', () => {
    it('defaults action to create when action is omitted but prompt is provided', async () => {
      const result = await executeImageJournalAction({
        prompt: 'a cyberpunk skyline',
      })

      expect(mockGenerateHeadless).toHaveBeenCalledWith(expect.objectContaining({
        prompt: 'a cyberpunk skyline',
      }))
      expect(result).toContain('"prompt":"a cyberpunk skyline"')
    })

    it('recovers prompt from description alias', async () => {
      await executeImageJournalAction({
        action: 'create',
        description: 'a fluffy white cat',
      })

      expect(mockGenerateHeadless).toHaveBeenCalledWith(expect.objectContaining({
        prompt: 'a fluffy white cat',
      }))
    })

    it('recovers prompt from query alias when creating', async () => {
      await executeImageJournalAction({
        action: 'create',
        query: 'an autumn park in rain',
      })

      expect(mockGenerateHeadless).toHaveBeenCalledWith(expect.objectContaining({
        prompt: 'an autumn park in rain',
      }))
    })

    it('recovers prompt from text or content alias', async () => {
      await executeImageJournalAction({
        action: 'create',
        text: 'a futuristic robot barista',
      })

      expect(mockGenerateHeadless).toHaveBeenCalledWith(expect.objectContaining({
        prompt: 'a futuristic robot barista',
      }))
    })

    it('falls back to the last user message if prompt is omitted on create', async () => {
      mockGetSessionMessages.mockReturnValue([
        { role: 'user', content: 'draw me a cozy fireplace with snow outside' },
        { role: 'assistant', content: 'Sure, I will draw that!' },
      ])

      const result = await executeImageJournalAction({
        action: 'create',
      })

      expect(mockGenerateHeadless).toHaveBeenCalledWith(expect.objectContaining({
        prompt: 'draw me a cozy fireplace with snow outside',
      }))
      expect(result).toContain('draw me a cozy fireplace with snow outside')
    })

    it('throws descriptive error if prompt is missing and no user message fallback exists', async () => {
      mockGetSessionMessages.mockReturnValue([])

      const result = await executeImageJournalAction({
        action: 'create',
      })

      expect(result).toContain('Error: prompt is required for image_journal.create')
    })

    it('handles apply action with search query or prompt alias', async () => {
      const result = await executeImageJournalAction({
        action: 'apply',
        query: 'Sunset',
      })

      expect(result).toContain('Background set to "Sunset at Beach"')
      expect(mockSetActiveBackground).toHaveBeenCalledWith('bg-1')
    })
  })
})
