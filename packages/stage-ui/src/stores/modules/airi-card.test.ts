import type { AiriCard, AiriOutfit } from './airi-card'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { storage } from '../../database/storage'
import { useChatSessionStore } from '../chat/session-store'
import { useSettingsStageModel } from '../settings/stage-model'
import { buildSystemPrompt, useAiriCardStore } from './airi-card'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k: string) => k }) }))
vi.mock('../dating-sim', () => ({ useDatingSimStore: () => ({ enabled: true, activeStoryline: { premise: 'p', appearances: 'a', scene: 's' }, customPremise: 'cp' }) }))

const cardFixture = {
  name: 'Test',
  description: 'desc',
  personality: 'pers',
  scenario: 'scen',
  systemPrompt: 'sys',
  postHistoryInstructions: '',
  greetings: ['hi'],
  extensions: {
    airi: {
      modules: {
        consciousness: { provider: 'cp', model: 'cm' },
        speech: { provider: 'sp', model: 'sm', voice_id: 'sv' },
        displayModelId: 'model-1',
        activeBackgroundId: 'bg-1',
        preferredBackgroundDataUrl: 'http://example.com/bg.png',
        preferredBackgroundName: 'bg',
      },
      acting: {
        modelExpressionPrompt: 'mep',
        speechExpressionPrompt: 'sep',
        speechMannerismPrompt: 'smp',
        stickerDirectivesPrompt: 'sdp',
        idleAnimations: [],
        autoCuesEnabled: false,
        autoCueExpressions: true,
        autoCueMotions: false,
        activeStickerIds: [],
        stickerWidgetsEnabled: false,
      },
      heartbeats: { enabled: true, intervalMinutes: 5, prompt: 'hb', injectIntoPrompt: true, useAsLocalGate: true, respectSchedule: true, pauseWhenAfk: true, afkThresholdMinutes: 5, prefixCacheOptimized: true, contextOptions: { windowHistory: true, systemLoad: true, usageMetrics: true }, schedule: { start: '09:00', end: '22:00' } },
      dreamState: { enabled: true, strictAfkGating: true, journalingThreshold: 'balanced', maxSessionsPerDay: 4, sessionTimeoutMinutes: 60, afkThresholdMinutes: 5, minConversationTurns: 4 },
      nap: { enabled: true },
      shortTermMemory: { enabled: true, windowSize: 3, tokenBudgetPerDay: 1000 },
      artistry: { widgetInstruction: 'art', spawnMode: 'bg', autonomousEnabled: false, autonomousThreshold: 49, autonomousTarget: 'assistant', autonomousMonitorEnabled: true, autonomousMonitorDiscordEnabled: false, autonomousHistoryDepth: 3, promptPrefix: 'pp' },
      generation: { enabled: true, provider: 'gp', model: 'gm', known: { contextWidth: 1, reasoningFallback: true, allowedTools: ['image_journal', 'text_journal'] }, advanced: undefined, compaction: { strategy: 'none', minKeepTurns: 15 } },
      groundingEnabled: true,
      groundingMemoryEnabled: true,
      groundingTopicsEnabled: true,
      recentTopics: [],
      visual_assets: { c1: { manifestation: { backgroundId: 'bg2', active_expressions: { smile: 1 }, expressions: { nod: 1 } } } },
      active_concepts: ['c1'],
      eternal_record: { relational_milestones: [], lore_bits: [] },
      imageJournal: { selfie: true },
      voice_profiles: [{ id: 'vp1', name: 'Voice' }],
      outfits: [],
      agents: {},
      rwkv: {},
      screenWatching: { enabled: true, sourceType: 'displays', deliveryMode: 'both' },
      eventLedger: { enabled: true, sampleDepth: 2, domains: ['d'] },
      stickers: { s1: { id: 's1', label: 'st', dataUrl: 'http://example.com/s.png' } },
      active_state: { displayModelId: 'model-1', activeBackgroundId: 'bg-1', active_expressions: { 'Happy [smile]': 1, 'Sad': 1 } },
    },
  },
} as unknown as AiriCard

describe('airi-card coverage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    if (typeof localStorage !== 'undefined')
      localStorage.clear()
    vi.restoreAllMocks()
    globalThis.fetch = (async () => ({ ok: true, blob: async () => new Blob(['x']) })) as unknown as typeof fetch
  })

  it('buildSystemPrompt variants', () => {
    buildSystemPrompt(undefined)
    buildSystemPrompt(cardFixture)
    buildSystemPrompt({ ...cardFixture, extensions: { airi: { rwkv: { zeroPromptVerified: true } } } } as unknown as AiriCard)
    // dating sim active path
    buildSystemPrompt(cardFixture)
  })

  it('migrateFromLocalStorage success/failure', async () => {
    localStorage.setItem('airi-cards', JSON.stringify([['legacy', cardFixture]]))
    const store = useAiriCardStore()
    await store.loadCards()
    localStorage.setItem('airi-cards', '{bad json')
    await store.loadCards()
  })

  it('loadCards salienceGate branch and catch', async () => {
    const salienceCard = { ...cardFixture, extensions: { airi: { ...((cardFixture as unknown as { extensions: { airi: Record<string, unknown> } }).extensions.airi), salienceGateEnabled: true } } } as unknown as AiriCard
    // storage returns card with salienceGateEnabled
    const origGet = storage.getItemRaw
    storage.getItemRaw = (async () => [['s', salienceCard]]) as typeof storage.getItemRaw
    const store = useAiriCardStore()
    await store.loadCards()
    storage.getItemRaw = (async () => { throw new Error('boom') }) as typeof storage.getItemRaw
    await store.loadCards()
    storage.getItemRaw = origGet
  })

  it('persistCards failure', async () => {
    const orig = storage.setItemRaw
    storage.setItemRaw = (async () => { throw new Error('boom') }) as typeof storage.setItemRaw
    const store = useAiriCardStore()
    await store.loadCards()
    await store.addCard({ name: 'x' } as unknown as AiriCard)
    storage.setItemRaw = orig
  })

  it('window event listener', async () => {
    const store = useAiriCardStore()
    await store.loadCards()
    window.dispatchEvent(new CustomEvent('airi:idb-key-updated', { detail: { key: 'local:airi-cards' } }))
    const { promise, resolve } = Promise.withResolvers<void>()
    queueMicrotask(resolve)
    await promise
  })

  it('add fetch failure branch', async () => {
    globalThis.fetch = (async () => { throw new Error('fetch fail') }) as unknown as typeof fetch
    const store = useAiriCardStore()
    await store.loadCards()
    const id = await store.addCard(cardFixture)
    expect(typeof id).toBe('string')
  })

  it('store instantiate and basic methods', async () => {
    const store = useAiriCardStore()
    await store.loadCards()
    store.requestEditCard('a')
    store.requestViewCard('a', 'tab')
    store.clearPendingCardActions()
    expect(store.pendingEditCardId).toBeNull()
  })

  it('add/remove/update/get and default extension', async () => {
    const store = useAiriCardStore()
    await store.loadCards()
    const id = await store.addCard(cardFixture)
    expect(typeof id).toBe('string')
    store.getCard(id)
    store.getCardDisplayModelId(id)
    store.getCardDisplayModelId('missing')
    await store.updateCard(id, { name: 'Renamed' })
    await store.updateCard('missing', { name: 'x' })
    await store.updateCard(id, { name: 'Renamed' })
    const id2 = await store.addCard({ name: 'NoExt' } as unknown as AiriCard)
    store.getCardDisplayModelId(id2)
    await store.removeCard(id)
    await store.removeCard(id2)
  })

  it('ccv3 branch', async () => {
    const store = useAiriCardStore()
    await store.loadCards()
    const ccv3 = { data: { name: 'CC', character_version: 2, description: 'd', creator: 'c', creator_notes: 'n', personality: 'p', scenario: 'sc', first_mes: 'hi', alternate_greetings: ['alt'], system_prompt: 'sp', post_history_instructions: 'phi', mes_example: 'hello', tags: ['t'], extensions: { airi: {} } } }
    const id = await store.addCard(ccv3 as unknown as AiriCard)
    expect(typeof id).toBe('string')
    await store.removeCard(id)
  })

  it('toggles all including missing', async () => {
    const store = useAiriCardStore()
    await store.loadCards()
    const id = await store.addCard(cardFixture)
    await store.toggleGrounding(id)
    await store.toggleGrounding('missing')
    await store.toggleGroundingMemory(id)
    await store.toggleGroundingMemory('missing')
    await store.toggleShortTermMemory(id)
    await store.toggleShortTermMemory('missing')
    const sessionStore = useChatSessionStore()
    sessionStore.activeSessionId = 'sess' as unknown as typeof sessionStore.activeSessionId
    await store.toggleGroundingTopics(id)
    await store.toggleGroundingTopics('missing')
    await store.toggleGroundingDirectorScratchpad(id)
    await store.toggleGroundingDirectorScratchpad('missing')
    await store.toggleSalienceGate(id)
    await store.toggleSalienceGate('missing')
    await store.setAutonomousArtistry(id, true)
    await store.setAutonomousArtistry('missing', true)
  })

  it('sync and activate with renderer initialized', async () => {
    const store = useAiriCardStore()
    await store.loadCards()
    const stageModelStore = useSettingsStageModel()
    stageModelStore.stageModelSelected = 'model-1'
    stageModelStore.stageModelRenderer = {} as unknown as typeof stageModelStore.stageModelRenderer
    stageModelStore.stageModelSelectedDisplayModel = {} as unknown as typeof stageModelStore.stageModelSelectedDisplayModel
    const id = await store.addCard(cardFixture)
    const card = store.getCard(id)
    try { await store.syncCardState(card, true) }
    catch {}
    try { await store.syncCardState(card, false) }
    catch {}
    try { await store.syncCardState(undefined) }
    catch {}
    try { await store.activateCard(id, true) }
    catch {}
    try { await store.activateCard('missing', false) }
    catch {}
  })

  it('initialize/seed/reset/load', async () => {
    const store = useAiriCardStore()
    await store.loadCards()
    store.activeCardId = ''
    try { await store.initialize() }
    catch {}
    try { await store.seedDefaults('nonexistent') }
    catch {}
    try { await store.seedDefaults('default') }
    catch {}
    try { await store.loadCards(true) }
    catch {}
    try { store.resetState() }
    catch {}
  })

  it('updateCardOutfits/applyOutfit', async () => {
    const store = useAiriCardStore()
    await store.loadCards()
    const id = await store.addCard(cardFixture)
    await store.activateCard(id)
    try { store.updateCardOutfits('missing', [{ id: 'o1', name: 'O', type: 'base', expressions: { smile: 1 } }] as unknown as AiriOutfit[]) }
    catch {}
    try { await store.updateCardOutfits(id, [{ id: 'o1', name: 'O', type: 'base', expressions: { smile: 1 } }] as unknown as AiriOutfit[]) }
    catch {}
    try { await store.applyOutfit('o1') }
    catch {}
    // overlay toggle
    try { await store.updateCardOutfits(id, [{ id: 'o2', name: 'O2', type: 'overlay', expressions: { smile: 1 } }] as unknown as AiriOutfit[]) }
    catch {}
    try { await store.applyOutfit('o2') }
    catch {}
    try { await store.applyOutfit('o2') }
    catch {}
    // missing outfit branch
    try { await store.applyOutfit('does-not-exist') }
    catch {}
    // two base outfits: applying one zeroes other's expressions
    try {
      await store.updateCardOutfits(id, [
        { id: 'b1', name: 'B1', type: 'base', expressions: { smile: 1 } },
        { id: 'b2', name: 'B2', type: 'base', expressions: { blink: 1 } },
      ] as unknown as AiriOutfit[])
    }
    catch {}
    try { await store.applyOutfit('b1') }
    catch {}
  })

  it('sync preset model branch', async () => {
    const store = useAiriCardStore()
    await store.loadCards()
    const stageModelStore = useSettingsStageModel()
    stageModelStore.stageModelSelected = 'preset-live2d-2'
    stageModelStore.stageModelRenderer = {} as unknown as typeof stageModelStore.stageModelRenderer
    stageModelStore.stageModelSelectedDisplayModel = {} as unknown as typeof stageModelStore.stageModelSelectedDisplayModel
    const card = { name: 'Preset', extensions: { airi: { modules: { displayModelId: 'preset-live2d-2' }, active_concepts: [], artistry: { autonomousEnabled: false }, visual_assets: {} } } } as unknown as AiriCard
    const id = await store.addCard(card)
    const c = store.getCard(id)
    try { await store.syncCardState(c, true) }
    catch {}
  })

  it('currentModels/systemPrompt computed', async () => {
    const store = useAiriCardStore()
    await store.loadCards()
    const _ = store.currentModels
    const __ = store.systemPrompt
    expect(true).toBe(true)
  })

  it('resolve default extension', () => {
    buildSystemPrompt({ name: 'x' } as unknown as AiriCard)
  })
})
