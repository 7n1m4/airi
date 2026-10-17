import type { AutonomousMode } from '@proj-airi/stage-shared/agentic'

import type { NapChatSessionRecord } from './nap-chat'

import { createTestingPinia } from '@pinia/testing'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { echoChipsRepo } from '../database/repos/echo-chips.repo'
import { lifetimeMemoryRepo } from '../database/repos/lifetime-memory.repo'
import { shortTermMemoryRepo } from '../database/repos/short-term-memory.repo'
import { textJournalRepo } from '../database/repos/text-journal.repo'
import { evaluateConstitutionalGuard, shouldRunForPresence } from './agentic'
import { useChatOrchestratorStore } from './chat'
import { useChatSessionStore } from './chat/session-store'
import { useEchoesStore } from './echo-chips'
import { useEventLogStore } from './event-log'
import { useMemoryLifetimeStore } from './memory-lifetime'
import { useShortTermMemoryStore } from './memory-short-term'
import { useAiriCardStore } from './modules/airi-card'
import { composeNapChatRecap, useNapChatStore } from './nap-chat'
import { usePresenceStore } from './presence'

// The repo's established pattern for renderer store tests that touch Pinia state
// and the persistence boundary: the electron bridge, the i18n composable and the
// OS probes are the seams mocked, and the stores stay real instances.
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: () => async () => undefined,
  useElectronEventaContext: () => ({ value: undefined }),
}))

vi.mock('@proj-airi/stage-shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@proj-airi/stage-shared')>()
  return {
    ...actual,
    debug: vi.fn(),
    isElectronWindow: () => false,
    isWithinSchedule: vi.fn(() => true),
    sensorsGetActiveWindow: vi.fn(),
    sensorsGetActiveWindowHistory: vi.fn(() => []),
    sensorsGetIdleTime: vi.fn(async () => 0),
    sensorsGetLocalTime: vi.fn(() => '12:00'),
    sensorsGetSystemLoad: vi.fn(),
    sensorsGetVolumeLevel: vi.fn(() => 50),
    sensorsSetTrackingEnabled: vi.fn(),
  }
})

vi.mock('../database/repos/echo-chips.repo', () => ({
  echoChipsRepo: { getAll: vi.fn(async () => []), saveAll: vi.fn(async () => {}) },
}))

vi.mock('../database/repos/lifetime-memory.repo', () => ({
  lifetimeMemoryRepo: { getByCharacter: vi.fn(async () => []), save: vi.fn(async () => {}) },
}))

vi.mock('../database/repos/short-term-memory.repo', () => ({
  shortTermMemoryRepo: { getAll: vi.fn(async () => []), saveAll: vi.fn(async () => {}) },
}))

vi.mock('../database/repos/text-journal.repo', () => ({
  textJournalRepo: { getAll: vi.fn(async () => []), saveAll: vi.fn(async () => undefined) },
}))

vi.mock('../database/storage', () => ({
  storage: {
    getItem: vi.fn(async () => null),
    getItemRaw: vi.fn(async () => null),
    setItem: vi.fn(async () => {}),
    setItemRaw: vi.fn(async () => {}),
  },
}))

vi.mock('./libs/search/layered-memory', () => ({
  layeredMemory: { init: vi.fn(async () => {}), search: vi.fn(async () => []) },
}))

const ACTION_INTENT = 'expression.body'

function guard(overrides: Partial<Parameters<typeof evaluateConstitutionalGuard>[0]> = {}) {
  return evaluateConstitutionalGuard({
    canSpeak: true,
    hasAvailableActionIntents: true,
    availableActionIntents: [ACTION_INTENT],
    requestedActionIntent: ACTION_INTENT,
    ...overrides,
  })
}

describe('evaluateConstitutionalGuard', () => {
  it('allows a cycle when the provider can speak and allows the intent', () => {
    expect(guard().allowed).toBe(true)
  })

  it('refuses when the provider cannot speak', () => {
    // A silent autonomous action is invisible to the user, which is the exact
    // failure mode autonomous speech is supposed to avoid.
    expect(guard({ canSpeak: false }).allowed).toBe(false)
  })

  it('refuses when the provider exposes no action-intent surface', () => {
    expect(guard({ hasAvailableActionIntents: false }).allowed).toBe(false)
  })

  it('refuses an intent the provider did not list', () => {
    const result = guard({ requestedActionIntent: 'filesystem.delete' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('filesystem.delete')
  })

  it('refuses the autonomous intent itself when the intent list omits it', () => {
    expect(guard({ availableActionIntents: [] }).allowed).toBe(false)
  })

  it('does not infer permission from an empty intent list', () => {
    // Regression: `availableActionIntents.includes('')` is true, so an unset
    // intent string must never be treated as allowed.
    expect(guard({ requestedActionIntent: '' }).allowed).toBe(false)
  })

  it('reports a reason for every refusal', () => {
    for (const refusal of [guard({ canSpeak: false }), guard({ hasAvailableActionIntents: false }), guard({ availableActionIntents: [] })])
      expect(refusal.reason).toBeTruthy()
  })
})

describe('shouldRunForPresence', () => {
  const cases: [AutonomousMode, string, boolean][] = [
    ['disabled', 'away', false],
    ['disabled', 'active', false],
    ['when-away', 'away', true],
    ['when-away', 'active', false],
    ['when-away', 'idle', false],
    ['when-away', 'screen-locked', false],
    ['when-away', 'sleep', false],
    ['always', 'active', true],
    ['always', 'away', true],
  ]

  it.each(cases)('mode %s in state %s runs=%s', (mode, presence, expected) => {
    expect(shouldRunForPresence(mode, presence)).toBe(expected)
  })

  it('never runs on an unrecognised presence state', () => {
    // A presence state the renderer cannot justify must not unlock autonomous
    // action, even under the most permissive mode.
    expect(shouldRunForPresence('when-away', 'unknown-state')).toBe(false)
  })
})

/**
 * Hook-only trace of the delivery, and nothing else.
 *
 * Recording the assistant text inside the entry is what pins "the journal entry
 * text and the spoken text are the same string": the two values cannot be
 * compared after the fact without a place to observe the spoken one.
 */
function traceNapHooks(): string[] {
  const trace: string[] = []
  const chatOrchestrator = useChatOrchestratorStore()

  chatOrchestrator.onBeforeMessageComposed(async () => {
    trace.push('beforeMessageComposed')
  })
  chatOrchestrator.onAssistantMessage(async (_message, text) => {
    trace.push(`assistantMessage:${text}`)
  })
  chatOrchestrator.onChatTurnComplete(async () => {
    trace.push('chatTurnComplete')
  })

  return trace
}

/**
 * `nap-chat.leak` — negative controls (design §11).
 *
 * Every test here asserts that a *forbidden* thing stays impossible, which is
 * the class of assertion this feature most needs: its risk is a leak and a bill,
 * not a crash. The write-back and the return surfacing are the two code paths,
 * and both are pinned against reaching anywhere they must not.
 *
 * Phase 3 owns the session itself, so the controls it can pin today are the
 * ones Phase 4's own code can violate: the memory pillars it writes, the ledger
 * payload it emits, the wording it surfaces, and the session it surfaces into.
 * The Phase-3 controls ("the nap-chat session's inference messages contain no
 * user-session message and no echo chip", "a nap-chat turn is generated into a
 * session created with `setActive: false`") are named in the design and cannot
 * be asserted until that phase lands — they are deliberately absent here rather
 * than faked with a session Phase 4 does not own.
 */
describe('nap-chat leak boundary (negative controls)', () => {
  const RECORD: NapChatSessionRecord = {
    sessionId: 'nap-session-1',
    localPeerId: 'local-peer',
    peerPeerId: 'peer-peer',
    localCardName: 'Airi',
    peerCardName: 'Rin',
    turnCount: 6,
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_061_500,
    closeReason: 'completed',
    recap: 'we traded notes about the weather and the quiet of an empty desk',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createTestingPinia({ createSpy: vi.fn, stubActions: false }))
    localStorage.clear()

    const airiCardStore = useAiriCardStore()
    airiCardStore.cards.set('card-airi', {
      id: 'card-airi',
      name: 'Airi',
      version: '1.0.0',
      extensions: { airi: {} },
    } as never)
    airiCardStore.activeCardId = 'card-airi'
    useChatSessionStore().activeSessionId = 'user-session-main'
  })

  it('never writes an echo chip, short-term memory, or lifetime memory', async () => {
    const echoes = useEchoesStore()
    const shortTerm = useShortTermMemoryStore()
    const lifetime = useMemoryLifetimeStore()
    const synthesize = vi.spyOn(echoes, 'synthesizeForCharacter')
    const yesterdayBlock = vi.spyOn(shortTerm, 'ensureYesterdayBlock')
    const lifetimeApply = vi.spyOn(lifetime, 'applyIncrementalUpdate')

    await useNapChatStore().recordNapChatCompletion(RECORD)

    expect(synthesize).not.toHaveBeenCalled()
    expect(yesterdayBlock).not.toHaveBeenCalled()
    expect(lifetimeApply).not.toHaveBeenCalled()
    expect(echoChipsRepo.saveAll).not.toHaveBeenCalled()
    expect(shortTermMemoryRepo.saveAll).not.toHaveBeenCalled()
    expect(lifetimeMemoryRepo.save).not.toHaveBeenCalled()

    // The two pillars that ARE written, so this cannot pass on a no-op run.
    expect(textJournalRepo.saveAll).toHaveBeenCalledOnce()
    expect(vi.spyOn(useEventLogStore(), 'appendEvent')).toHaveBeenCalled()
  })

  it('never relays a field the ledger payload does not name', async () => {
    const appendEvent = vi.spyOn(useEventLogStore(), 'appendEvent')

    // The seam accepted a record carrying something extra. The ledger must not
    // carry it onward — the payload is an allow-list, not a spread.
    await useNapChatStore().recordNapChatCompletion({
      ...RECORD,
      peerPrivateMemory: 'the peer companion sat alone at midnight',
    } as NapChatSessionRecord)

    const completed = appendEvent.mock.calls
      .map(([input]) => input)
      .find(input => input.type === 'nap_chat_completed')
    expect(Object.keys(completed?.payload ?? {}).sort()).toEqual([
      'closeReason',
      'endedAt',
      'journalEntryId',
      'localCardName',
      'localPeerId',
      'peerCardName',
      'peerPeerId',
      'sessionId',
      'startedAt',
      'turnCount',
    ])
  })

  it('never surfaces the peer private memory, nor the user session text', async () => {
    const composed: string[] = []
    const chatSession = useChatSessionStore()
    chatSession.sessionMessages['user-session-main'] = [
      { role: 'user', content: 'USER PRIVATE HISTORY — DO NOT SURFACE', createdAt: Date.now(), id: 'm1' },
    ] as never
    useChatOrchestratorStore().onAssistantMessage(async (_message, text) => {
      composed.push(text)
    })

    await useNapChatStore().recordNapChatCompletion({
      ...RECORD,
      peerPrivateMemory: 'the peer companion sat alone at midnight',
    } as NapChatSessionRecord)

    const journalEntry = vi.mocked(textJournalRepo.saveAll).mock.calls[0][1][0]
    const expected = composeNapChatRecap({
      peerCardName: RECORD.peerCardName,
      recap: RECORD.recap,
      turnCount: RECORD.turnCount,
      durationMs: RECORD.endedAt - RECORD.startedAt,
    })

    // The journal entry and the spoken turn are the very same string, and it is
    // the wording contract alone — no second summarization, no carried context.
    expect(journalEntry.content).toBe(expected)
    await useNapChatStore().surfacePendingRecap()
    await vi.waitFor(() => expect(composed).toHaveLength(1))
    expect(composed[0]).toBe(expected)

    expect(journalEntry.content).not.toContain('USER PRIVATE HISTORY')
    expect(journalEntry.content).not.toContain('peer companion')
    expect(composed[0]).not.toContain('USER PRIVATE HISTORY')
    expect(composed[0]).not.toContain('peer companion')
  })

  it('never creates or activates a session to surface a recap', async () => {
    const chatSession = useChatSessionStore()
    const before = chatSession.activeSessionId
    const createSession = vi.spyOn(chatSession, 'createSession')
    const setActive = vi.spyOn(chatSession, 'setActiveSession')

    traceNapHooks()

    await useNapChatStore().recordNapChatCompletion(RECORD)
    await useNapChatStore().surfacePendingRecap()

    expect(createSession).not.toHaveBeenCalled()
    expect(setActive).not.toHaveBeenCalled()
    // The recap lands in the user's pre-existing session, whose id is unchanged.
    expect(chatSession.activeSessionId).toBe(before)
    expect(chatSession.activeSessionId).toBe('user-session-main')
    const inscripted = chatSession.sessionMessages['user-session-main'] ?? []
    expect(inscripted).toHaveLength(1)
    expect(inscripted[0].role).toBe('assistant')
  })

  it('never inscribes a recap without an active session', async () => {
    const nap = useNapChatStore()
    const trace = traceNapHooks()

    await nap.recordNapChatCompletion(RECORD)
    useChatSessionStore().activeSessionId = ''

    await nap.surfacePendingRecap()

    expect(trace).toEqual([])
  })

  it('never fires a recap while the user is present', async () => {
    const nap = useNapChatStore()
    const trace = traceNapHooks()

    await nap.recordNapChatCompletion(RECORD)

    const presence = usePresenceStore()
    presence.presence.state = 'active'
    await vi.waitFor(() => expect(nap.pendingRecap).not.toBeNull())

    expect(trace).toEqual([])
    expect(useChatSessionStore().sessionMessages['user-session-main'] ?? []).toHaveLength(0)
  })

  it('never fires on the away → idle edge, because the user is still absent', async () => {
    const nap = useNapChatStore()
    const trace = traceNapHooks()

    await nap.recordNapChatCompletion(RECORD)

    const presence = usePresenceStore()
    presence.presence.state = 'away'
    presence.presence.state = 'idle'

    await vi.waitFor(() => expect(nap.pendingRecap).not.toBeNull())
    expect(trace).toEqual([])
  })

  it('never surfaces more than one recap, across any number of completed sessions', async () => {
    const nap = useNapChatStore()
    const trace = traceNapHooks()

    for (const sessionId of ['nap-session-1', 'nap-session-2', 'nap-session-3', 'nap-session-4'])
      await nap.recordNapChatCompletion({ ...RECORD, sessionId })

    expect(trace).toEqual([])

    // A restart reads the persisted slot; exactly one recap is still armed.
    expect(nap.pendingRecap?.sessionId).toBe('nap-session-4')

    await nap.surfacePendingRecap()
    await vi.waitFor(() => expect(trace).toHaveLength(3))
    expect(trace.filter(entry => entry.startsWith('assistantMessage:'))).toHaveLength(1)
    expect(nap.pendingRecap).toBeNull()
  })
})
