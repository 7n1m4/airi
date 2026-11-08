import { createTestingPinia } from '@pinia/testing'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { getEventSourceKey } from '../../../utils/event-source'
import { createDatetimeContext } from './datetime'
import { createExpressionsContext } from './expressions'
import { createScenesContext } from './scenes'
import { createStickersContext } from './stickers'

const mockLive2dStore = {
  activeExpressions: null as Record<string, number> | null,
}

const mockVrmStore = {
  activeExpressions: null as Record<string, number> | null,
}

const mockStickersStore = {
  currentLibrary: [] as Array<{ label: string }>,
}

const mockActiveCardRef = ref<any>({
  id: 'card-airi',
  extensions: {
    airi: {
      modules: {
        activeBackgroundId: null as string | null,
      },
    },
  },
})

const mockBackgroundStore = {
  entries: new Map<string, any>(),
}

vi.mock('@proj-airi/stage-ui-live2d', () => ({
  useLive2d: () => mockLive2dStore,
}))

vi.mock('@proj-airi/stage-ui-three', () => ({
  useModelStore: () => mockVrmStore,
}))

vi.mock('../../stickers', () => ({
  useStickersStore: () => mockStickersStore,
}))

vi.mock('../../background', () => ({
  useBackgroundStore: () => mockBackgroundStore,
}))

vi.mock('../../modules/airi-card', () => ({
  useAiriCardStore: () => ({
    activeCard: mockActiveCardRef.value,
  }),
}))

describe('chat context providers contracts', () => {
  beforeEach(() => {
    const pinia = createTestingPinia({ createSpy: vi.fn, stubActions: false })
    setActivePinia(pinia)

    mockLive2dStore.activeExpressions = null
    mockVrmStore.activeExpressions = null
    mockStickersStore.currentLibrary = []
    mockActiveCardRef.value.extensions.airi.modules.activeBackgroundId = null
    mockBackgroundStore.entries.clear()
  })

  describe('createExpressionsContext', () => {
    it('returns null when there are no active expressions', () => {
      expect(createExpressionsContext()).toBeNull()
    })

    it('returns null when expressions have zero or low weights', () => {
      mockLive2dStore.activeExpressions = { smile: 0.05, blush: 0 }
      mockVrmStore.activeExpressions = { neutral: 0.1 }
      expect(createExpressionsContext()).toBeNull()
    })

    it('returns formatted context with source="expressions" when expressions are active', () => {
      mockLive2dStore.activeExpressions = { blush: 0.8 }
      mockVrmStore.activeExpressions = { glasses: 1.0 }

      const ctx = createExpressionsContext()
      expect(ctx).not.toBeNull()
      expect(ctx?.source).toBe('expressions')
      expect(ctx?.contextId).toBe('system:expressions')
      expect(ctx?.text).toContain('Active Visual Expressions/Props:')
      expect(ctx?.text).toContain('blush')
      expect(ctx?.text).toContain('glasses')
    })
  })

  describe('createStickersContext', () => {
    it('returns null when stickers library is empty', () => {
      mockStickersStore.currentLibrary = []
      expect(createStickersContext()).toBeNull()
    })

    it('returns formatted context with source="stickers" when stickers exist', () => {
      mockStickersStore.currentLibrary = [{ label: 'sparkle' }, { label: 'heart' }]
      const ctx = createStickersContext()
      expect(ctx).not.toBeNull()
      expect(ctx?.source).toBe('stickers')
      expect(ctx?.contextId).toBe('stickers')
      expect(ctx?.text).toContain('sparkle, heart')
    })
  })

  describe('createScenesContext', () => {
    it('returns null when no background is active', () => {
      expect(createScenesContext()).toBeNull()
    })

    it('returns null when background type is not a valid scene (e.g. selfie)', () => {
      mockActiveCardRef.value.extensions.airi.modules.activeBackgroundId = 'bg-selfie'
      mockBackgroundStore.entries.set('bg-selfie', {
        id: 'bg-selfie',
        type: 'selfie',
        title: 'Selfie shot',
      })
      expect(createScenesContext()).toBeNull()
    })

    it('returns formatted context with source="scenes" when valid scene background is set', () => {
      mockActiveCardRef.value.extensions.airi.modules.activeBackgroundId = 'bg-cafe'
      mockBackgroundStore.entries.set('bg-cafe', {
        id: 'bg-cafe',
        type: 'scene',
        title: 'Cyber Cafe',
        prompt: 'Neon lights and rain outside',
      })

      const ctx = createScenesContext()
      expect(ctx).not.toBeNull()
      expect(ctx?.source).toBe('scenes')
      expect(ctx?.contextId).toBe('system:scenes')
      expect(ctx?.text).toContain('Cyber Cafe')
      expect(ctx?.text).toContain('(Vibe: Neon lights and rain outside)')
    })
  })

  describe('createDatetimeContext', () => {
    it('returns context with source="datetime"', () => {
      const ctx = createDatetimeContext()
      expect(ctx.source).toBe('datetime')
      expect(ctx.contextId).toBe('system:datetime')
      expect(ctx.text).toContain('Current datetime:')
    })
  })

  describe('getEventSourceKey', () => {
    it('uses event.source when present', () => {
      expect(getEventSourceKey({ source: 'expressions' })).toBe('expressions')
    })

    it('falls back to contextId stripping system: prefix', () => {
      expect(getEventSourceKey({ contextId: 'system:expressions' })).toBe('expressions')
      expect(getEventSourceKey({ contextId: 'stickers' })).toBe('stickers')
    })

    it('prefers metadata source over event.source or contextId', () => {
      expect(getEventSourceKey({
        source: 'expressions',
        contextId: 'system:expressions',
        metadata: { source: { kind: 'plugin', plugin: { id: 'custom-plugin' }, id: 'inst-1' } },
      })).toBe('custom-plugin:inst-1')
    })

    it('falls back to default fallback "unknown" when nothing is specified', () => {
      expect(getEventSourceKey({})).toBe('unknown')
    })
  })
})
