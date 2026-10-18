import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildSynthesisPayload,
  compileCardBundle,
  createFallbackProposal,
  deterministicActorKey,
  useCardSynthesis,
} from './use-card-synthesis'

const llmMock = { generate: vi.fn() }
const providersMock = { getProviderInstance: vi.fn() }

vi.mock('../stores/llm', () => ({
  useLLM: () => llmMock,
}))

vi.mock('../stores/providers', () => ({
  useProvidersStore: () => providersMock,
}))

describe('deterministicActorKey', () => {
  it('slugs name', () => {
    expect(deterministicActorKey('John Doe')).toBe('actor_john_doe')
  })
  it('falls back to companion for empty slug', () => {
    expect(deterministicActorKey('!!!')).toBe('actor_companion')
  })
  it('collapses underscores', () => {
    expect(deterministicActorKey('a--b')).toBe('actor_a_b')
  })
})

describe('buildSynthesisPayload', () => {
  it('builds payload with defaults', () => {
    const cast = [{ name: 'Alice', tags: ['x', 'y'], actingCapabilities: { format: 'f' } }]
    const story = { trope: 'coding' }
    const out = buildSynthesisPayload(cast, story, { provider: 'p', model: 'm' })
    expect(out.cast[0].series).toBe('Original')
    expect(out.cast[0].tags).toBe('x, y')
    expect(out.storySettings.setting).toBe('coding')
    expect(out.deterministicActorKeys.Alice).toBe('actor_alice')
    expect(out.activeLLM.provider).toBe('p')
  })
  it('handles string tags and no llm', () => {
    const cast = [{ name: 'Bob', tags: 't', actingCapabilities: null }]
    const story = { setting: 's', userNickname: 'U', userDescription: 'd', loreRules: 'l', guidance: 'g' }
    const out = buildSynthesisPayload(cast, story)
    expect(out.cast[0].tags).toBe('t')
    expect(out.cast[0].actingCapabilities).toBeNull()
    expect(out.storySettings.setting).toBe('s')
    expect(out.storySettings.loreRules).toBe('l')
    expect(out.activeLLM.provider).toBe('None configured')
    expect(out.activeLLM.model).toBe('None configured')
  })
  it('trigger default', () => {
    const cast = [{ name: 'My Char' }]
    const out = buildSynthesisPayload(cast, { })
    expect(out.cast[0].trigger).toBe('my_char')
  })
  it('loreRules fallback to guidance', () => {
    const out = buildSynthesisPayload([], { guidance: 'g' })
    expect(out.storySettings.loreRules).toBe('g')
    expect(out.storySettings.setting).toBe('A cozy companion lounge')
  })
})

const baseCast = [{ name: 'Alice', tags: ['a'], avatarUrl: 'u' }]
const baseStory = { userNickname: 'Master', trope: 'coding' }

describe('createFallbackProposal', () => {
  const tropes = ['coding', 'study', 'pomodoro', 'pet', 'tamagotchi', 'night', 'owl', 'gremlin', 'assistant', 'gaming', 'wellness', 'other']
  for (const t of tropes) {
    it(`trope ${t}`, () => {
      const p = createFallbackProposal([{ name: 'Bob' }], { trope: t }, 2)
      expect(p.id).toBe('2')
      expect(p.actors).toBeTruthy()
    })
  }
  it('proposalIndex modulo', () => {
    const p = createFallbackProposal([{ name: 'Bob' }], { trope: 'coding' }, 4)
    expect(p.name).toBeTruthy()
  })
  it('empty cast', () => {
    const p = createFallbackProposal([], {}, 1)
    expect(p.id).toBe('1')
  })
})

describe('compileCardBundle', () => {
  it('compiles full bundle', () => {
    const proposal = createFallbackProposal(baseCast, baseStory, 1)
    const bundle = compileCardBundle({
      proposal,
      cast: baseCast,
      userName: 'U',
      vesselDisplayModelId: 'model',
      boundVoice: { provider: 'p', model: 'm', voice_id: 'v', pitch: 1, rate: 1 },
      artistry: { provider: 'ap' },
      actingPrompts: { modelExpressionPrompt: 'me', speechExpressionPrompt: 'se', speechMannerismPrompt: 'sm' },
      idleAnimations: ['a'],
      customAvatarUrl: 'avatar',
    })
    expect(bundle.spec).toBe('chara_card_v3')
    expect(bundle.data.name).toBeTruthy()
    expect(bundle.data.extensions.airi.modules.displayModelId).toBe('model')
    expect(bundle.data.extensions.airi.modules.speech).toBeTruthy()
  })
  it('minimal', () => {
    const proposal = createFallbackProposal([{ name: 'Companion' }], {}, 1)
    const bundle = compileCardBundle({ proposal, cast: [] })
    expect(bundle.data.avatar).toBeUndefined()
    expect(bundle.data.extensions.airi.modules.speech).toBeNull()
  })
  it('single actor and no places', () => {
    const proposal = createFallbackProposal([{ name: 'Solo' }], {}, 1)
    proposal.places = {}
    const bundle = compileCardBundle({ proposal, cast: [{ name: 'Solo' }] })
    expect(bundle.data.system_prompt).toContain('Solo')
  })
  it('two actors example branch', () => {
    const proposal = createFallbackProposal([{ name: 'Solo' }], {}, 1)
    const k2 = 'actor_partner'
    proposal.actors[k2] = { ...proposal.actors[Object.keys(proposal.actors)[0]], personality_prompt: 'p' }
    const bundle = compileCardBundle({ proposal, cast: [{ name: 'Solo' }] })
    expect(bundle.data.system_prompt).toContain(k2)
  })
  it('tags array on firstChar', () => {
    const proposal = createFallbackProposal([{ name: 'T', tags: ['x'] }], {}, 1)
    const bundle = compileCardBundle({ proposal, cast: [{ name: 'T', tags: ['x'] }] })
    expect(bundle.data.tags).toContain('x')
  })
})

describe('useCardSynthesis', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('no provider returns fallbacks', async () => {
    const { synthesizeProposal } = useCardSynthesis()
    const res = await synthesizeProposal({ cast: baseCast, storySettings: baseStory })
    expect(res.length).toBe(3)
  })

  it('provider instance missing throws -> fallbacks', async () => {
    providersMock.getProviderInstance.mockResolvedValue(null)
    const { synthesizeProposal } = useCardSynthesis()
    const res = await synthesizeProposal({ cast: baseCast, storySettings: baseStory, activeProviderName: 'p', activeModel: 'm' })
    expect(res.length).toBe(3)
  })

  it('lLM returns array', async () => {
    providersMock.getProviderInstance.mockResolvedValue({})
    llmMock.generate.mockResolvedValue({ text: JSON.stringify([{ name: 'P1', scenario: 's', first_mes: 'hi', places: {}, actors: {} }]) })
    const { synthesizeProposal } = useCardSynthesis()
    const res = await synthesizeProposal({ cast: baseCast, storySettings: baseStory, activeProviderName: 'p', activeModel: 'm', guidance: 'g' })
    expect(res.length).toBe(1)
    expect(res[0].id).toBe('1')
  })

  it('lLM returns single object', async () => {
    providersMock.getProviderInstance.mockResolvedValue({})
    llmMock.generate.mockResolvedValue({ text: JSON.stringify({ name: 'P1' }) })
    const { synthesizeProposal } = useCardSynthesis()
    const res = await synthesizeProposal({ cast: baseCast, storySettings: baseStory, activeProviderName: 'p', activeModel: 'm' })
    expect(res.length).toBe(3)
  })

  it('lLM throws -> fallbacks', async () => {
    providersMock.getProviderInstance.mockResolvedValue({})
    llmMock.generate.mockRejectedValue(new Error('boom'))
    const { synthesizeProposal } = useCardSynthesis()
    const res = await synthesizeProposal({ cast: baseCast, storySettings: baseStory, activeProviderName: 'p', activeModel: 'm' })
    expect(res.length).toBe(3)
  })

  it('lLM returns empty array -> fallbacks', async () => {
    providersMock.getProviderInstance.mockResolvedValue({})
    llmMock.generate.mockResolvedValue({ text: '[]' })
    const { synthesizeProposal } = useCardSynthesis()
    const res = await synthesizeProposal({ cast: baseCast, storySettings: baseStory, activeProviderName: 'p', activeModel: 'm' })
    expect(res.length).toBe(3)
  })

  it('lLM returns invalid json -> fallbacks', async () => {
    providersMock.getProviderInstance.mockResolvedValue({})
    llmMock.generate.mockResolvedValue({ text: 'not json' })
    const { synthesizeProposal } = useCardSynthesis()
    const res = await synthesizeProposal({ cast: baseCast, storySettings: baseStory, activeProviderName: 'p', activeModel: 'm' })
    expect(res.length).toBe(3)
  })

  it('lLM returns markdown fenced', async () => {
    providersMock.getProviderInstance.mockResolvedValue({})
    llmMock.generate.mockResolvedValue({ text: '```json\n[{"name":"P"}]\n```' })
    const { synthesizeProposal } = useCardSynthesis()
    const res = await synthesizeProposal({ cast: baseCast, storySettings: baseStory, activeProviderName: 'p', activeModel: 'm' })
    expect(res.length).toBe(1)
  })
})
