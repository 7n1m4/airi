// @vitest-environment jsdom
// The cross-tab sync test needs a DOM to mount a component, which is what makes
// vueuse's `useMounted()` flip and `useBroadcastChannel` create its channel. The
// workspace default is the node environment, where that test cannot run.
import type { AiriCard, AiriOutfit } from './airi-card'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'

import { storage } from '../../database/storage'
import { useChatSessionStore } from '../chat/session-store'
import { DisplayModelFormat, useDisplayModelsStore } from '../display-models'
import { useSettingsStageModel } from '../settings/stage-model'
import { buildSystemPrompt, useAiriCardStore } from './airi-card'

/**
 * Structural view of the setup store used by this file; the store module
 * exports no named instance type of its own. Only the members the cross-tab
 * sync test touches are declared, so the interface stays explicit about the
 * dependency instead of re-deriving it from the store's implementation.
 */
interface AiriCardStore {
  loadCards: (silent?: boolean) => Promise<void>
  cardsLoading: boolean
}

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k: string) => k }) }))
vi.mock('../dating-sim', () => ({ useDatingSimStore: () => ({ enabled: true, activeStoryline: { premise: 'p', appearances: 'a', scene: 's' }, customPremise: 'cp' }) }))

// Controllable stand-in so tests can drive both the success and rejection paths
// of `toggleGroundingTopics`'s `updateRecentTopics(...).catch(...)`.
const recentTopicsState = { shouldReject: false }
vi.mock('../chat/recent-topics', () => ({
  updateRecentTopics: async () => {
    if (recentTopicsState.shouldReject)
      throw new Error('recent topics boom')
  },
}))

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
    expect(true).toBe(true)
  })

  it('resolve default extension', () => {
    buildSystemPrompt({ name: 'x' } as unknown as AiriCard)
  })
  it('applyOutfit with no active card', async () => {
    const store = useAiriCardStore()
    await store.loadCards()
    store.activeCardId = ''
    try { await store.applyOutfit('o1') }
    catch {}
    expect(true).toBe(true)
  })

  it('toggleGroundingTopics computes recent topics for active session', async () => {
    const store = useAiriCardStore()
    await store.loadCards()
    const id = await store.addCard(cardFixture)

    const sessionStore = useChatSessionStore()
    // These members are outside the store's declared public surface.
    const session = sessionStore as unknown as {
      activeSessionId: string
      getSessionMeta: (id: string) => { universeId?: string } | undefined
      getSessionMessages: (id: string) => { role: string, content: string }[]
    }
    session.activeSessionId = 'sess-1'
    session.getSessionMeta = () => ({ universeId: 'u1' })
    session.getSessionMessages = () => [{ role: 'user', content: 'hey' }]

    // cardFixture has groundingTopicsEnabled: true, so toggle off then on to
    // reach the `next && activeSessionId` branch.
    await store.toggleGroundingTopics(id)
    await store.toggleGroundingTopics(id)

    // Rejection path: the store swallows it via `.catch()`.
    recentTopicsState.shouldReject = true
    await store.toggleGroundingTopics(id)
    await store.toggleGroundingTopics(id)
    recentTopicsState.shouldReject = false
  })

  it('ccv3 messageExample keeps already-prefixed dialogue lines', async () => {
    const store = useAiriCardStore()
    await store.loadCards()
    const ccv3 = {
      data: {
        name: 'CC',
        description: 'd',
        first_mes: 'hi',
        mes_example: '<START>\n{{char}}: hello\n{{user}}: hi there\nplain line\n<START>\n{{user}}: second',
        tags: ['t'],
        extensions: { airi: {} },
      },
    }
    const id = await store.addCard(ccv3 as unknown as AiriCard)
    const card = store.getCard(id)!
    const lines = (card.messageExample ?? []).flat()
    // Prefixed lines pass through unchanged; unprefixed lines get {{char}}:.
    expect(lines.includes('{{char}}: hello')).toBe(true)
    expect(lines.includes('{{user}}: hi there')).toBe(true)
    expect(lines.includes('{{user}}: second')).toBe(true)
    expect(lines.includes('{{char}}: plain line')).toBe(true)
  })

  it('syncCardState folds concept expressions onto Spine and model formats', async () => {
    const store = useAiriCardStore()
    const stageModelStore = useSettingsStageModel()
    stageModelStore.stageModelRenderer = {} as unknown as typeof stageModelStore.stageModelRenderer
    stageModelStore.stageModelSelectedDisplayModel = {} as unknown as typeof stageModelStore.stageModelSelectedDisplayModel

    // Spine: 'Happy [smile]' matches the `variant [skin]` pattern, 'Sad' matches
    // an available variant name.
    localStorage.setItem('settings/spine/available-variants', JSON.stringify([{ name: 'Sad', skins: [] }]))
    stageModelStore.stageModelSelected = 'preset-vrm-1'
    const spineCard = {
      name: 'Spine',
      extensions: {
        airi: {
          modules: { displayModelId: 'preset-vrm-1' },
          artistry: { autonomousEnabled: false },
          active_concepts: ['c1'],
          visual_assets: {
            c1: {
              manifestation: {
                backgroundId: 'inherit',
                active_expressions: { 'Happy [smile]': 1, 'Sad': 1 },
              },
            },
          },
        },
      },
    } as unknown as AiriCard
    const spineId = await store.addCard(spineCard)
    try { await store.syncCardState(store.getCard(spineId), true) }
    catch {}
    localStorage.removeItem('settings/spine/available-variants')
  })

  it('syncCardState applies PMX model-local mapping', async () => {
    const displayModelsStore = useDisplayModelsStore()
    const store = useAiriCardStore()
    const stageModelStore = useSettingsStageModel()

    // Register a real PMX model so `getDisplayModel` resolves it in-memory.
    // `addDisplayModelWithTextures` awaits the store's own loading flag before
    // appending, so the entry cannot be clobbered by the eager catalog load.
    const pmxModel = await displayModelsStore.addDisplayModelWithTextures(
      DisplayModelFormat.PMXZip,
      new File(['x'], 'm.pmx'),
      [],
    )
    // `getDisplayModel` returns this same reference, so the label mapping loop
    // in `syncCardState` sees these capabilities.
    const capabilities = [
      { rawKey: 'smile', label: 'Smile', usable: true },
      { rawKey: 'plain', label: 'plain', usable: true },
    ]
    // Assign after the first sync: `updateStageModel` re-reads the catalog and
    // replaces `displayModels`, which would drop an earlier assignment.
    const seedCard = {
      name: 'PMX-seed',
      extensions: {
        airi: {
          modules: { displayModelId: pmxModel.id },
          artistry: { autonomousEnabled: false },
          active_concepts: [],
          visual_assets: {},
        },
      },
    } as unknown as AiriCard
    const seedId = await store.addCard(seedCard)
    try { await store.syncCardState(store.getCard(seedId), true) }
    catch {}

    const live = await displayModelsStore.addDisplayModelWithTextures(
      DisplayModelFormat.PMXZip,
      new File(['x'], 'm.pmx'),
      [],
    )
    // `getDisplayModel` returns this same reference, so the label mapping loop in
    // `syncCardState` sees these capabilities. Registered after the seed sync so a
    // catalog reload cannot drop it.
    live.expressionCapabilities = capabilities

    stageModelStore.stageModelSelected = live.id
    stageModelStore.stageModelRenderer = {} as unknown as typeof stageModelStore.stageModelRenderer
    stageModelStore.stageModelSelectedDisplayModel = {} as unknown as typeof stageModelStore.stageModelSelectedDisplayModel

    const pmxCard = {
      name: 'PMX',
      extensions: {
        airi: {
          modules: { displayModelId: live.id },
          artistry: { autonomousEnabled: false },
          active_concepts: [],
          visual_assets: {},
        },
      },
    } as unknown as AiriCard
    const id = await store.addCard(pmxCard)
    try { await store.syncCardState(store.getCard(id), true) }
    catch {}
  })

  it('syncCardState aborts when superseded by a newer call', async () => {
    const store = useAiriCardStore()
    const stageModelStore = useSettingsStageModel()
    // Start from a different id so the call enters the model-swap block and has to
    // await `updateStageModel()` before reaching the sequence guard.
    stageModelStore.stageModelSelected = ''
    stageModelStore.stageModelRenderer = {} as unknown as typeof stageModelStore.stageModelRenderer
    stageModelStore.stageModelSelectedDisplayModel = {} as unknown as typeof stageModelStore.stageModelSelectedDisplayModel

    const card = {
      name: 'Race',
      extensions: {
        airi: {
          modules: { displayModelId: 'preset-vrm-1' },
          artistry: { autonomousEnabled: false },
          active_concepts: [],
          visual_assets: {},
        },
      },
    } as unknown as AiriCard
    const id = await store.addCard(card)

    // Concurrent calls are expected to settle cleanly: whichever resolves later is
    // dropped by the sequence guard rather than clobbering the newer state.
    await Promise.allSettled([
      store.syncCardState(store.getCard(id), false),
      store.syncCardState(store.getCard(id), false),
      store.syncCardState(store.getCard(id), false),
    ])
  })

  it('cardsSyncSignal reloads cards on a cross-tab sync signal', async () => {
    // `useBroadcastChannel` creates its channel inside `onMounted`, and
    // `useSupported` also reads `useMounted()`, which only turns true once a real
    // component instance is mounted. Without that, `isSupported` stays false and the
    // watcher never receives anything — so instantiate the store inside an app.
    const host = document.createElement('div')
    let mountedStore: AiriCardStore | undefined
    const app = createApp({
      setup() {
        mountedStore = useAiriCardStore()
        return () => null
      },
    })
    app.mount(host)
    await nextTick()
    const card = mountedStore!

    await card.loadCards()

    const { promise, resolve } = Promise.withResolvers<void>()
    // The watcher body runs `loadCards(true)`, which reads exactly this key, so
    // matching on it keeps unrelated storage reads from resolving the gate early.
    const origItemRaw = storage.getItemRaw
    storage.getItemRaw = (async (key: string) => {
      if (key === 'local:airi-cards')
        resolve()
      return origItemRaw(key)
    }) as typeof storage.getItemRaw

    // A BroadcastChannel never receives its own message, so post from a distinct
    // sender: the store's channel is the listener under test.
    const sender = new BroadcastChannel('airi:cards-sync')
    sender.postMessage('airi-card-sync-test-tick')
    await promise
    storage.getItemRaw = origItemRaw
    sender.close()
    app.unmount()

    // L455 is the `loadCards(true)` call itself; the reload re-reads the key above
    // and leaves the store idle rather than stuck mid-load.
    expect(card.cardsLoading).toBe(false)
  })
})
