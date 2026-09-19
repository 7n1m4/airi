import { createTestingPinia } from '@pinia/testing'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useChatOrchestratorStore } from '../chat'
import { useLLM } from '../llm'
import { resetIntrusionStaging, stageArtistryIntrusion, stageJournalIntrusion } from './intrusion-staging'
import { useChatSessionStore } from './session-store'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

const activeCardRef = ref<any>({
  id: 'card-airi',
  name: 'Airi',
  systemPrompt: 'You are Airi, a cheerful companion with strict persona rules.',
  extensions: {
    airi: {
      groundingEnabled: false,
      groundingMemoryEnabled: false,
      groundingTopicsEnabled: false,
      groundingDirectorScratchpadEnabled: false,
      salienceGateEnabled: false,
      recentTopics: [] as Array<{ topic: string, weight: number }>,
      textJournal: {
        injectJournalContext: false,
        journalIntrusionPrompt: 'Reflect on: {journalEntryText}',
      },
      artistry: {
        injectArtistryContext: false,
        artistryIntrusionPrompt: 'Art generated: {imagePrompt}',
      },
      modules: {
        activeBackgroundId: null as string | null,
      },
    },
  },
})

vi.mock('../modules/airi-card', () => {
  const updateCard = vi.fn()
  return {
    buildSystemPrompt: (card: any) => card?.systemPrompt || '',
    useAiriCardStore: () => ({
      get activeCard() {
        return activeCardRef.value
      },
      activeCardId: ref('card-airi'),
      systemPrompt: ref(''),
      isModelSyncPrevented: false,
      getCard: vi.fn(() => activeCardRef.value),
      updateCard,
    }),
  }
})

vi.mock('../providers', () => ({
  useProvidersStore: () => ({
    getProviderInstance: vi.fn(async () => ({})),
    getProviderConfig: vi.fn(() => ({})),
    getModelsForProvider: vi.fn(() => [{ id: 'test-model', capabilities: [] }]),
  }),
}))

vi.mock('../modules/consciousness', () => ({
  useConsciousnessStore: () => ({
    activeProvider: ref('test-provider'),
    activeModel: ref('test-model'),
  }),
}))

vi.mock('../modules/vision', () => ({
  useVisionStore: () => ({
    activeProvider: 'vision-provider',
    activeModel: 'vision-model',
    strategy: 'forward',
    promptShimDirect: '',
    promptShimForward: 'Describe this image.',
  }),
}))

vi.mock('../modules/proactivity', () => ({
  useProactivityStore: () => ({
    sensorPayload: 'Sensors: CPU 20%, Time 14:00',
    updateSensors: vi.fn(async () => {}),
  }),
}))

const mockBackgroundStore = {
  entries: new Map<string, any>(),
  currentBackground: ref(null),
  initializeStore: vi.fn(),
}

vi.mock('../background', () => ({
  useBackgroundStore: () => mockBackgroundStore,
}))

vi.mock('../memory-text-journal', () => ({
  useTextJournalStore: () => ({
    searchEntries: vi.fn(async () => [
      { kind: 'journal', title: 'Summer Trip', content: 'Went to the beach.' },
    ]),
  }),
}))

vi.mock('../../database/repos/director-notes.repo', () => ({
  directorNotesRepo: {
    getNotes: vi.fn(async () => [
      { createdAt: 1000, scratchpad: 'Holding a red mug in the cafe.' },
    ]),
  },
}))

vi.mock('./salience', () => ({
  useChatSalienceStore: () => ({
    probeTurn: vi.fn(async () => ({
      hot: true,
      lateLayerDeltas: [0.12, 0.34, 0.56],
      lateLayerMean: 0.34,
      controlMean: 0.1,
    })),
  }),
}))

const mockLive2dStore = {
  activeExpressions: null as Record<string, number> | null,
}

const mockVrmStore = {
  activeExpressions: null as Record<string, number> | null,
}

const mockStickersStore = {
  currentLibrary: [] as Array<{ label: string }>,
}

vi.mock('@proj-airi/stage-ui-live2d', () => ({
  useLive2d: () => mockLive2dStore,
}))

vi.mock('@proj-airi/stage-ui-three', () => ({
  useModelStore: () => mockVrmStore,
}))

vi.mock('../stickers', () => ({
  useStickersStore: () => mockStickersStore,
}))

function extractUserText(content: any): string {
  if (typeof content === 'string')
    return content
  if (Array.isArray(content)) {
    const textPart = content.find((p: any) => p.type === 'text')
    return textPart?.text || ''
  }
  return ''
}

describe('chat prompt hierarchy and message ordering invariants', () => {
  let pinia: ReturnType<typeof createTestingPinia>

  beforeEach(() => {
    pinia = createTestingPinia({ createSpy: vi.fn, stubActions: false })
    setActivePinia(pinia)
    resetIntrusionStaging()

    mockLive2dStore.activeExpressions = null
    mockVrmStore.activeExpressions = null
    mockStickersStore.currentLibrary = []
    mockBackgroundStore.entries.clear()

    activeCardRef.value = {
      id: 'card-airi',
      name: 'Airi',
      systemPrompt: 'You are Airi, a cheerful companion with strict persona rules.',
      extensions: {
        airi: {
          groundingEnabled: false,
          groundingMemoryEnabled: false,
          groundingTopicsEnabled: false,
          groundingDirectorScratchpadEnabled: false,
          salienceGateEnabled: false,
          recentTopics: [],
          textJournal: {
            injectJournalContext: false,
            journalIntrusionPrompt: 'Reflect on: {journalEntryText}',
          },
          artistry: {
            injectArtistryContext: false,
            artistryIntrusionPrompt: 'Art generated: {imagePrompt}',
          },
          modules: {
            activeBackgroundId: null,
          },
        },
      },
    }
  })

  describe('suite A: session state permutations', () => {
    it('a1: cold start / completely empty session guarantees persona is at messages[0]', async () => {
      const chatStore = useChatOrchestratorStore(pinia)
      const chatSession = useChatSessionStore(pinia)
      const llmStore = useLLM(pinia)

      const sessionId = 'session-cold-start'
      chatSession.activeSessionId = sessionId
      // Initialize with completely empty messages
      chatSession.setSessionMessages(sessionId, [])

      let capturedMessages: any[] = []
      llmStore.stream = vi.fn(async (_model, _provider, msgs, options) => {
        capturedMessages = structuredClone(msgs)
        await options.onStreamEvent({
          type: 'text-delta',
          text: 'Hello from cold start!',
        })
      })

      await chatStore.ingest('Hello for the first time', { triggerOnly: false }, sessionId)

      // Invariant 1: messages[0] MUST be role: system with character persona
      expect(capturedMessages.length).toBeGreaterThanOrEqual(2)
      expect(capturedMessages[0].role).toBe('system')
      expect(capturedMessages[0].content).toBe('You are Airi, a cheerful companion with strict persona rules.')

      // Invariant 2: messages[1] is the context block (contains datetime)
      expect(capturedMessages[1].role).toBe('system')
      expect(capturedMessages[1].content).toContain('Module datetime:')

      // Invariant 3: User message is not at index 0 and retains its original role and content
      const userMsg = capturedMessages.find(m => m.role === 'user')
      expect(userMsg).toBeDefined()
      expect(extractUserText(userMsg?.content)).toContain('Hello for the first time')
      expect(capturedMessages.indexOf(userMsg)).toBeGreaterThan(1)
    })

    it('a2: legacy/imported session lacking system message has persona restored at messages[0]', async () => {
      const chatStore = useChatOrchestratorStore(pinia)
      const chatSession = useChatSessionStore(pinia)
      const llmStore = useLLM(pinia)

      const sessionId = 'session-imported-no-system'
      chatSession.activeSessionId = sessionId

      // Simulate a legacy imported chat with only user and assistant turns (no leading system message)
      chatSession.setSessionMessages(sessionId, [
        { id: 'm1', role: 'user', content: 'What is your name?' },
        { id: 'm2', role: 'assistant', content: 'I am Airi!' },
      ] as any[])

      let capturedMessages: any[] = []
      llmStore.stream = vi.fn(async (_model, _provider, msgs, options) => {
        capturedMessages = structuredClone(msgs)
        await options.onStreamEvent({
          type: 'text-delta',
          text: 'Nice to talk again!',
        })
      })

      await chatStore.ingest('Tell me more about yourself', { triggerOnly: false }, sessionId)

      // Invariant: messages[0] is guaranteed to be persona system message
      expect(capturedMessages[0].role).toBe('system')
      expect(capturedMessages[0].content).toBe('You are Airi, a cheerful companion with strict persona rules.')

      // Prior history must be preserved in order
      const m1Idx = capturedMessages.findIndex(m => m.role === 'user' && extractUserText(m.content).includes('What is your name?'))
      const m2Idx = capturedMessages.findIndex(m => m.role === 'assistant' && extractUserText(m.content).includes('I am Airi!'))
      const currentTurnIdx = capturedMessages.findIndex(m => m.role === 'user' && extractUserText(m.content).includes('Tell me more about yourself'))

      expect(m1Idx).toBeGreaterThan(0)
      expect(m2Idx).toBeGreaterThan(m1Idx)
      expect(currentTurnIdx).toBeGreaterThan(m2Idx)
    })

    it('a3: card persona mid-session mutation updates messages[0] without duplicating or corrupting history', async () => {
      const chatStore = useChatOrchestratorStore(pinia)
      const chatSession = useChatSessionStore(pinia)
      const llmStore = useLLM(pinia)

      const sessionId = 'session-mid-turn-persona-change'
      chatSession.activeSessionId = sessionId
      chatSession.setSessionMessages(sessionId, [])

      let turn1Messages: any[] = []
      llmStore.stream = vi.fn(async (_model, _provider, msgs, options) => {
        turn1Messages = structuredClone(msgs)
        await options.onStreamEvent({
          type: 'text-delta',
          text: 'First response from Airi.',
        })
      })

      await chatStore.ingest('First turn', { triggerOnly: false }, sessionId)
      expect(turn1Messages[0].content).toBe('You are Airi, a cheerful companion with strict persona rules.')

      // Mutate active card persona mid-session
      activeCardRef.value.systemPrompt = 'You are DaSilva, an expert AI engineer.'

      let turn2Messages: any[] = []
      llmStore.stream = vi.fn(async (_model, _provider, msgs, options) => {
        turn2Messages = structuredClone(msgs)
        await options.onStreamEvent({
          type: 'text-delta',
          text: 'Second response from DaSilva.',
        })
      })

      await chatStore.ingest('Second turn', { triggerOnly: false }, sessionId)

      // Invariant: messages[0] is updated to the new persona
      expect(turn2Messages[0].role).toBe('system')
      expect(turn2Messages[0].content).toBe('You are DaSilva, an expert AI engineer.')

      // Ensure no duplicate persona blocks exist
      const personaBlocks = turn2Messages.filter(
        (m: any) => m.role === 'system'
          && !m.content.startsWith('These are the contextual information retrieved')
          && !m.content.startsWith('[ENVIRONMENTAL AWARENESS]')
          && !m.content.includes('[CONTEXT_AWARENESS]'),
      )
      expect(personaBlocks.length).toBe(1)
    })
  })

  describe('suite B: multi-hop tool execution invariance', () => {
    it('b1: maintains identical persona system message at messages[0] across all tool hops', async () => {
      const chatStore = useChatOrchestratorStore(pinia)
      const chatSession = useChatSessionStore(pinia)
      const llmStore = useLLM(pinia)

      const sessionId = 'session-multihop-invariance'
      chatSession.activeSessionId = sessionId
      chatSession.setSessionMessages(sessionId, [])

      const dummyTool = {
        type: 'function' as const,
        function: {
          name: 'get_weather',
          description: 'Get current weather',
          parameters: { type: 'object', properties: {} },
        },
        execute: async () => 'Sunny and 22C',
      }

      let hopCount = 0
      const capturedHops: any[][] = []

      llmStore.stream = vi.fn(async (_model, _provider, msgs, options) => {
        hopCount++
        capturedHops.push(msgs.map((m: any) => ({ ...m })))

        if (hopCount === 1) {
          // Hop 1: Emit bridged tool call
          await options.onStreamEvent({
            type: 'text-delta',
            text: '[call_tool:get_weather, location: "boston"]',
          })
        }
        else {
          // Hop 2: Final response
          await options.onStreamEvent({
            type: 'text-delta',
            text: 'The weather is sunny and 22C!',
          })
        }
      })

      await chatStore.ingest('How is the weather?', { triggerOnly: false, tools: [dummyTool] }, sessionId)

      expect(hopCount).toBe(2)

      // Invariant: Both hops must have the exact same persona at messages[0]
      expect(capturedHops[0][0].role).toBe('system')
      expect(capturedHops[0][0].content).toBe('You are Airi, a cheerful companion with strict persona rules.')

      expect(capturedHops[1][0].role).toBe('system')
      expect(capturedHops[1][0].content).toBe('You are Airi, a cheerful companion with strict persona rules.')

      // Hop 2 must include tool call and tool result
      const toolMsg = capturedHops[1].find(m => m.role === 'tool')
      expect(toolMsg).toBeDefined()
      expect(toolMsg.content).toContain('Sunny and 22C')
    })
  })

  describe('suite C: full stack stress test (The Grand Symphony)', () => {
    it('c1: preserves exact deterministic sequence with all 12 subsystems active concurrently', async () => {
      const chatStore = useChatOrchestratorStore(pinia)
      const chatSession = useChatSessionStore(pinia)
      const llmStore = useLLM(pinia)

      const sessionId = 'session-grand-symphony'
      chatSession.activeSessionId = sessionId
      chatSession.setSessionMessages(sessionId, [])

      // 1. Enable Grounding systems on card
      activeCardRef.value.extensions.airi.groundingEnabled = true
      activeCardRef.value.extensions.airi.groundingMemoryEnabled = true
      activeCardRef.value.extensions.airi.groundingTopicsEnabled = true
      activeCardRef.value.extensions.airi.groundingDirectorScratchpadEnabled = true
      activeCardRef.value.extensions.airi.salienceGateEnabled = true
      activeCardRef.value.extensions.airi.recentTopics = [
        { topic: 'Quantum Neural Interfaces', weight: 0.98 },
      ]

      // 2. Expressions
      mockLive2dStore.activeExpressions = { blush: 0.9 }

      // 3. Scene background
      activeCardRef.value.extensions.airi.modules.activeBackgroundId = 'bg-cafe'
      mockBackgroundStore.entries.set('bg-cafe', {
        id: 'bg-cafe',
        type: 'scene',
        title: 'Cyber Cafe',
        prompt: 'Neon lights and rain',
      })

      // 4. Stickers
      mockStickersStore.currentLibrary = [{ label: 'sparkle' }, { label: 'heart' }]

      // 5. Staged Dream state
      activeCardRef.value.extensions.airi.dreamState = {
        injectDreamContext: true,
        dreamIntrusionPrompt: 'Dream: {insertEchoChips}',
        pendingDreamChips: ['floating islands', 'starlit sea'],
        pendingDreamTimestamp: Date.now() - 30000,
      }

      // 6. Staged Text Journal intrusion
      activeCardRef.value.extensions.airi.textJournal = {
        injectJournalContext: true,
        journalIntrusionPrompt: 'Journal reaction: {journalEntryText}',
      }
      stageJournalIntrusion({
        entryText: 'Had tea while coding new prompt tests.',
        timestamp: Date.now() - 60000,
      })

      // 7. Staged Artistry intrusion
      activeCardRef.value.extensions.airi.artistry = {
        injectArtistryContext: true,
        artistryIntrusionPrompt: 'Art reaction: {imagePrompt}',
      }
      stageArtistryIntrusion({
        prompt: 'Futuristic floating city in sunset',
        timestamp: Date.now() - 10000,
      })

      // 8. STMM & Lifetime Memory mocks
      chatSession.buildShortTermMemoryContext = vi.fn(() => '[DAILY MEMORY CONTINUITY]\nCompleted core architectural refactor today.')
      chatSession.buildLifetimeMemoryContext = vi.fn(() => '[LIFETIME RECORD]\nLikes tea, cyberpunk themes, and clean code.')

      // 9. VLM forward inference mock
      llmStore.generate = vi.fn(async () => ({
        text: 'A vivid digital illustration of an android resting.',
        usage: {},
      } as any))

      let capturedMessages: any[] = []
      llmStore.stream = vi.fn(async (_model, _provider, msgs, options) => {
        capturedMessages = structuredClone(msgs)
        await options.onStreamEvent({
          type: 'text-delta',
          text: 'Symphony response completed!',
        })
      })

      await chatStore.ingest('Look at my android illustration', {
        triggerOnly: false,
        attachments: [{ type: 'image', mimeType: 'image/png', data: 'android-art-b64' }],
      }, sessionId)

      // Invariant 1: messages[0] is STRICTLY the character persona system prompt
      expect(capturedMessages[0].role).toBe('system')
      expect(capturedMessages[0].content).toBe('You are Airi, a cheerful companion with strict persona rules.')

      // Invariant 2: messages[1] is the Module Context block containing datetime, expressions, scene, and stickers
      expect(capturedMessages[1].role).toBe('system')
      expect(capturedMessages[1].content).toContain('These are the contextual information retrieved or on-demand updated from other modules:')
      expect(capturedMessages[1].content).toContain('Module datetime:')
      expect(capturedMessages[1].content).toContain('Module expressions:')
      expect(capturedMessages[1].content).toContain('blush')
      expect(capturedMessages[1].content).toContain('Module scenes:')
      expect(capturedMessages[1].content).toContain('Cyber Cafe')
      expect(capturedMessages[1].content).toContain('Module stickers:')
      expect(capturedMessages[1].content).toContain('sparkle, heart')

      // Invariant 3: Introspection blocks (Dream, Journal, Artistry)
      expect(capturedMessages[1].content).toContain('[INSPECTIVE DREAM STATE]')
      expect(capturedMessages[1].content).toContain('floating islands')
      expect(capturedMessages[1].content).toContain('[INSPECTIVE JOURNAL REFLECTION]')
      expect(capturedMessages[1].content).toContain('Had tea while coding new prompt tests.')
      expect(capturedMessages[1].content).toContain('[INSPECTIVE ARTWORK AWARENESS]')
      expect(capturedMessages[1].content).toContain('Futuristic floating city in sunset')

      // Invariant 4: Grounding blocks deterministic order (0 < 1 < 1.5 < 1.6 < 2 < 3 < 4 < 5)
      const idxVlm = capturedMessages.findIndex((m: any) => m.content?.includes('[IMAGE ANALYSIS]'))
      const idxEnv = capturedMessages.findIndex((m: any, i: number) => i > idxVlm && m.content?.includes('[ENVIRONMENTAL AWARENESS]'))
      const idxStmm = capturedMessages.findIndex((m: any) => m.content?.includes('[DAILY MEMORY CONTINUITY]'))
      const idxLtmm = capturedMessages.findIndex((m: any) => m.content?.includes('[LIFETIME RECORD]'))
      const idxRag = capturedMessages.findIndex((m: any) => m.content?.includes('[GROUNDED LONG-TERM MEMORIES]'))
      const idxTopics = capturedMessages.findIndex((m: any) => m.content?.includes('[RECENT TOPICS]'))
      const idxScratch = capturedMessages.findIndex((m: any) => m.content?.includes('[VISUAL STATE BOARD]'))
      const idxSalience = capturedMessages.findIndex((m: any) => m.content?.includes('[SALIENCE TELEMETRY]'))

      expect(idxVlm).toBeGreaterThan(-1)
      expect(idxEnv).toBeGreaterThan(idxVlm)
      expect(idxStmm).toBeGreaterThan(idxEnv)
      expect(idxLtmm).toBeGreaterThan(idxStmm)
      expect(idxRag).toBeGreaterThan(idxLtmm)
      expect(idxTopics).toBeGreaterThan(idxRag)
      expect(idxScratch).toBeGreaterThan(idxTopics)
      expect(idxSalience).toBeGreaterThan(idxScratch)

      // Invariant 5: User message is placed after all grounding and contains original prompt
      const userMsg = capturedMessages[capturedMessages.length - 1]
      expect(userMsg.role).toBe('user')
      expect(extractUserText(userMsg.content)).toContain('Look at my android illustration')
    })
  })
})
