import type { PresenceState } from '@proj-airi/stage-shared/agentic'

import type { AiriCard } from './modules/airi-card'
import type { NapChatSessionRecord } from './nap-chat'

import { createTestingPinia } from '@pinia/testing'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { echoChipsRepo } from '../database/repos/echo-chips.repo'
import { lifetimeMemoryRepo } from '../database/repos/lifetime-memory.repo'
import { shortTermMemoryRepo } from '../database/repos/short-term-memory.repo'
import { textJournalRepo } from '../database/repos/text-journal.repo'
import { useChatOrchestratorStore } from './chat'
import { useChatSessionStore } from './chat/session-store'
import { useEchoesStore } from './echo-chips'
import { useEventLogStore } from './event-log'
import { useMemoryLifetimeStore } from './memory-lifetime'
import { useShortTermMemoryStore } from './memory-short-term'
import { useAiriCardStore } from './modules/airi-card'
import { composeNapChatRecap, useNapChatStore } from './nap-chat'
import { usePresenceStore } from './presence'

// The repo's established pattern for renderer store tests: the electron bridge,
// the i18n composable and the OS probes are the seams mocked, and the stores
// themselves stay real Pinia instances.
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

// The journal store resolves its own character and session through the real
// chat-session store, so the surface store and the journal must agree on one
// active session id. Only the persistence boundary is mocked.
vi.mock('../database/repos/echo-chips.repo', () => ({
  echoChipsRepo: {
    getAll: vi.fn(async () => []),
    saveAll: vi.fn(async () => {}),
  },
}))

vi.mock('../database/repos/lifetime-memory.repo', () => ({
  lifetimeMemoryRepo: {
    getByCharacter: vi.fn(async () => []),
    save: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  },
}))

vi.mock('../database/repos/short-term-memory.repo', () => ({
  shortTermMemoryRepo: {
    getAll: vi.fn(async () => []),
    saveAll: vi.fn(async () => {}),
  },
}))

vi.mock('../database/repos/text-journal.repo', () => ({
  textJournalRepo: {
    getAll: vi.fn(async () => []),
    saveAll: vi.fn(async () => undefined),
  },
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

const LOCAL_CARD_ID = 'card-airi'

/** The exact sentence the design's wording contract requires. */
function recapFor(r: NapChatSessionRecord): string {
  return composeNapChatRecap({
    peerCardName: r.peerCardName,
    recap: r.recap,
    turnCount: r.turnCount,
    durationMs: Math.max(0, r.endedAt - r.startedAt),
  })
}

const BASE_RECORD: NapChatSessionRecord = {
  sessionId: 'nap-session-1',
  localPeerId: 'local-peer',
  peerPeerId: 'peer-peer',
  localCardName: 'Airi',
  peerCardName: 'Rin',
  turnCount: 6,
  startedAt: 1_700_000_000_000,
  endedAt: 1_700_000_061_500, // 61.5s
  closeReason: 'completed',
  recap: 'we traded notes about the weather and the quiet of an empty desk',
}

function record(overrides: Partial<NapChatSessionRecord> = {}): NapChatSessionRecord {
  return { ...BASE_RECORD, ...overrides }
}

/** Flip the presence snapshot without a sensor, the way the gate tests do. */
function setPresenceState(state: PresenceState) {
  const presence = usePresenceStore()
  presence.presence.state = state
}

/**
 * Hook-only trace of the delivery, and nothing else.
 *
 * NOTICE: every hook the turn emits is registered, not only the two that were
 * missing. A test that asserted only "streamEnd is somewhere in the list" would
 * still pass if the order were inverted — which was the original bug — so the
 * tracer records the full emission sequence and the tests compare it wholesale.
 */
function traceHooks(): string[] {
  const trace: string[] = []
  const chatOrchestrator = useChatOrchestratorStore()

  chatOrchestrator.onBeforeMessageComposed(async () => {
    trace.push('beforeMessageComposed')
  })
  chatOrchestrator.onStreamEnd(async () => {
    trace.push('streamEnd')
  })
  // NOTICE: the response-end hook's first argument is the text, the second is
  // the stream context (`hooks.ts:203-205`) — named so here rather than read
  // positionally, because a tracer that got that backwards would silently
  // record `[object Object]` and the order assertion would still pass.
  chatOrchestrator.onAssistantResponseEnd(async (text) => {
    trace.push(`assistantResponseEnd:${text}`)
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
 * §6 write-back and §7 return surfacing.
 *
 * The valued assertions here are the *negative* ones — the recap never fires
 * while the user is present, never queues across sessions, and never touches
 * the memory pillars the design excludes — because the interesting risk is a
 * companion that talks about itself unattended.
 */
describe('nap-chat memory write-back and return surfacing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createTestingPinia({ createSpy: vi.fn, stubActions: false }))
    localStorage.clear()

    const airiCardStore = useAiriCardStore()
    const card: AiriCard = {
      id: LOCAL_CARD_ID,
      name: 'Airi',
      version: '1.0.0',
      extensions: { airi: {} },
    } as unknown as AiriCard
    airiCardStore.cards.set(LOCAL_CARD_ID, card)
    airiCardStore.activeCardId = LOCAL_CARD_ID

    useChatSessionStore().activeSessionId = 'user-session-main'
  })

  it('persists one agentic ledger event and one dream journal entry per completed session', async () => {
    const eventLog = useEventLogStore()
    const appendEvent = vi.spyOn(eventLog, 'appendEvent')

    await useNapChatStore().recordNapChatCompletion(BASE_RECORD)

    expect(textJournalRepo.saveAll).toHaveBeenCalledOnce()
    const persisted = vi.mocked(textJournalRepo.saveAll).mock.calls[0][1]
    expect(persisted).toHaveLength(1)
    expect(persisted[0].source).toBe('dream')
    expect(persisted[0].content).toBe(recapFor(BASE_RECORD))

    const completed = appendEvent.mock.calls
      .map(([input]) => input)
      .filter(input => input.type === 'nap_chat_completed')
    expect(completed).toHaveLength(1)
    expect(completed[0].category).toBe('agentic')
    expect(completed[0].autonomous).toBe(true)
    expect(completed[0].payload).toMatchObject({
      sessionId: BASE_RECORD.sessionId,
      localPeerId: BASE_RECORD.localPeerId,
      peerPeerId: BASE_RECORD.peerPeerId,
      localCardName: BASE_RECORD.localCardName,
      peerCardName: BASE_RECORD.peerCardName,
      turnCount: BASE_RECORD.turnCount,
      startedAt: BASE_RECORD.startedAt,
      endedAt: BASE_RECORD.endedAt,
      closeReason: BASE_RECORD.closeReason,
    })
  })

  it('does not write echo chips, short-term memory, or lifetime memory', async () => {
    const echoes = useEchoesStore()
    const shortTerm = useShortTermMemoryStore()
    const lifetime = useMemoryLifetimeStore()
    const synthesize = vi.spyOn(echoes, 'synthesizeForCharacter')
    const yesterdayBlock = vi.spyOn(shortTerm, 'ensureYesterdayBlock')
    const lifetimeApply = vi.spyOn(lifetime, 'applyIncrementalUpdate')

    await useNapChatStore().recordNapChatCompletion(BASE_RECORD)

    expect(synthesize).not.toHaveBeenCalled()
    expect(yesterdayBlock).not.toHaveBeenCalled()
    expect(lifetimeApply).not.toHaveBeenCalled()

    // Writes, not reads: the ordinary journal store reads STMM/Lifetime while
    // indexing an entry it was asked to create, and no nap-chat code calls those.
    // `getAll`/`getByCharacter` are that indexing, not a write-back.
    expect(echoChipsRepo.saveAll).not.toHaveBeenCalled()
    expect(shortTermMemoryRepo.saveAll).not.toHaveBeenCalled()
    expect(lifetimeMemoryRepo.save).not.toHaveBeenCalled()

    // The pillars that ARE written: the text journal and the event ledger.
    expect(textJournalRepo.saveAll).toHaveBeenCalledOnce()
  })

  it('writes only the ledger event when the model gate refused, and arms nothing', async () => {
    const nap = useNapChatStore()
    const appendEvent = vi.spyOn(useEventLogStore(), 'appendEvent')

    await nap.recordNapChatCompletion(record({ closeReason: 'model-gate' }))

    expect(textJournalRepo.saveAll).not.toHaveBeenCalled()
    expect(nap.pendingRecap).toBeNull()

    const gated = appendEvent.mock.calls.map(([input]) => input).filter(input => input.type === 'nap_chat_gated')
    expect(gated).toHaveLength(1)
    expect(gated[0].category).toBe('agentic')
    expect(gated[0].autonomous).toBe(true)

    expect(appendEvent.mock.calls.map(([input]) => input).filter(input => input.type === 'nap_chat_completed')).toHaveLength(0)
  })

  it('never fires while the user is present, however many sessions completed', async () => {
    const nap = useNapChatStore()
    const trace = traceHooks()

    await nap.recordNapChatCompletion(BASE_RECORD)
    await nap.recordNapChatCompletion(record({ sessionId: 'nap-session-2', peerCardName: 'Aoi' }))
    await nap.recordNapChatCompletion(record({ sessionId: 'nap-session-3', peerCardName: 'Shiho' }))

    setPresenceState('active')
    await vi.waitFor(() => {
      expect(nap.pendingRecap).not.toBeNull()
    })

    // Still present: no edge, so nothing has been spoken.
    expect(trace).toEqual([])
    expect(useChatSessionStore().sessionMessages['user-session-main'] ?? []).toHaveLength(0)

    // The most recent session is the one armed, and it is the only one.
    expect(nap.pendingRecap?.sessionId).toBe('nap-session-3')
    expect(nap.pendingRecap?.peerCardName).toBe('Shiho')
  })

  it('surfaces exactly one recap on the away → active edge, and never again', async () => {
    const nap = useNapChatStore()
    const trace = traceHooks()
    const second = record({ sessionId: 'nap-session-2', peerCardName: 'Aoi', turnCount: 11 })
    const secondRecap = recapFor(second)
    const appendEvent = vi.spyOn(useEventLogStore(), 'appendEvent')

    await nap.recordNapChatCompletion(BASE_RECORD)
    await nap.recordNapChatCompletion(second)

    const inscripted = () => useChatSessionStore().sessionMessages['user-session-main'] ?? []

    setPresenceState('away')
    await vi.waitFor(() => expect(nap.pendingRecap?.sessionId).toBe('nap-session-2'))

    // The return edge. The full sequence, in the order the heartbeat precedent
    // uses, so an inverted order fails here rather than downstream.
    setPresenceState('active')
    await vi.waitFor(() => {
      expect(trace).toEqual(['beforeMessageComposed', 'streamEnd', `assistantResponseEnd:${secondRecap}`, `assistantMessage:${secondRecap}`, 'chatTurnComplete'])
    })

    // Exactly one turn, inscribed into the user's own session as an assistant turn.
    expect(inscripted()).toHaveLength(1)
    expect(inscripted()[0].role).toBe('assistant')
    expect(inscripted()[0].content).toBe(secondRecap)
    expect(nap.pendingRecap).toBeNull()

    const surfaced = () => appendEvent.mock.calls
      .map(([input]) => input)
      .filter(input => input.type === 'nap_chat_surfaced')
    expect(surfaced()).toHaveLength(1)
    expect(surfaced()[0].autonomous).toBe(true)

    // Present again: the slot is consumed, so no second delivery.
    setPresenceState('idle')
    setPresenceState('active')
    await vi.waitFor(() => expect(nap.pendingRecap).toBeNull())
    expect(trace).toHaveLength(5)
    expect(inscripted()).toHaveLength(1)
    expect(surfaced()).toHaveLength(1)
  })

  it('fires on the idle → active edge too, not only away → active', async () => {
    const nap = useNapChatStore()
    const trace = traceHooks()

    await nap.recordNapChatCompletion(BASE_RECORD)

    setPresenceState('idle')
    await vi.waitFor(() => expect(nap.pendingRecap).not.toBeNull())
    setPresenceState('active')
    await vi.waitFor(() => {
      expect(trace).toHaveLength(5)
    })
    expect(nap.pendingRecap).toBeNull()
  })

  it('does not fire on a direct away → idle transition, because the user is still absent', async () => {
    const nap = useNapChatStore()
    const trace = traceHooks()

    await nap.recordNapChatCompletion(BASE_RECORD)

    setPresenceState('away')
    setPresenceState('idle')

    await vi.waitFor(() => expect(nap.pendingRecap).not.toBeNull())
    expect(trace).toEqual([])
  })

  it('keeps a pending recap consumed once after firing across a window restart', async () => {
    const nap = useNapChatStore()
    const trace = traceHooks()

    await nap.recordNapChatCompletion(BASE_RECORD)

    setPresenceState('away')
    setPresenceState('active')
    await vi.waitFor(() => {
      expect(trace).toHaveLength(5)
    })

    // A restart reads the persisted lease rather than the cleared in-memory slot.
    expect(nap.pendingRecap).toBeNull()
    expect(nap.lastSurfacedSessionId).toBe(BASE_RECORD.sessionId)
    expect(localStorage.getItem('settings/nap-chat/last-surfaced-session-id')).toBe(BASE_RECORD.sessionId)

    setPresenceState('idle')
    setPresenceState('active')
    await vi.waitFor(() => expect(trace).toHaveLength(5))
  })

  it('never creates a session, and never moves the active session id', async () => {
    const nap = useNapChatStore()
    const chatSession = useChatSessionStore()
    const before = chatSession.activeSessionId
    const createSession = vi.spyOn(chatSession, 'createSession')
    const setActive = vi.spyOn(chatSession, 'setActiveSession')

    traceHooks()

    await nap.recordNapChatCompletion(BASE_RECORD)
    await nap.surfacePendingRecap()

    expect(createSession).not.toHaveBeenCalled()
    expect(setActive).not.toHaveBeenCalled()
    expect(chatSession.activeSessionId).toBe(before)
    expect(chatSession.activeSessionId).toBe('user-session-main')
  })

  it('surfaces a stalled session that has a recap, and arms nothing for one without one', async () => {
    const nap = useNapChatStore()
    const composed: string[] = []
    useChatOrchestratorStore().onAssistantMessage(async (_message, text) => {
      composed.push(text)
    })

    // A stalled session that still produced turns has something worth saying.
    await nap.recordNapChatCompletion(record({ sessionId: 'nap-stalled-1', closeReason: 'stalled', turnCount: 2, recap: 'we barely started' }))
    expect(nap.pendingRecap?.sessionId).toBe('nap-stalled-1')

    await nap.surfacePendingRecap()
    expect(composed).toEqual([recapFor(record({ sessionId: 'nap-stalled-1', closeReason: 'stalled', turnCount: 2, recap: 'we barely started' }))])
    expect(nap.pendingRecap).toBeNull()

    // A stalled session with no recap arms nothing, because there is nothing to say.
    await nap.recordNapChatCompletion(record({ sessionId: 'nap-stalled-2', closeReason: 'stalled', turnCount: 0, recap: '' }))
    expect(nap.pendingRecap).toBeNull()

    composed.length = 0
    await nap.surfacePendingRecap()
    expect(composed).toEqual([])
  })

  /**
   * B5 — the sequence itself, not just the presence of the two missing hooks.
   *
   * The defect was that `deliverRecapTurn` inscribed before every hook and
   * omitted `emitStreamEndHooks`/`emitAssistantResponseEndHooks` entirely, which
   * is what made the recap silent: TTS, the bubble and every other downstream
   * consumer wait on those two. A test that only asserted the hooks were present
   * would still pass with the order inverted, so this compares the whole
   * recorded sequence against the heartbeat precedent (`proactivity.ts:877-892`).
   */
  it('emits the full sequence in the heartbeat precedent order, with chatTurnComplete last', async () => {
    const nap = useNapChatStore()
    const composed: string[] = []
    useChatOrchestratorStore().onAssistantMessage(async (_message, text) => {
      composed.push(text)
    })

    await nap.recordNapChatCompletion(BASE_RECORD)
    setPresenceState('idle')
    await vi.waitFor(() => expect(nap.pendingRecap).not.toBeNull())

    // NOTICE: the inscribe is not traced. What the defect took away was the
    // stream's completion announcement — `emitStreamEndHooks` and
    // `emitAssistantResponseEndHooks` are the two hooks every downstream
    // consumer waits on, so without them the recap was written to the journal
    // and to memory and then never said out loud or shown. The hooks' relative
    // order is what is pinned here; the inscribe's own single-write behaviour is
    // already covered by the "exactly one turn" assertion in this suite.
    const trace: string[] = []
    const chatOrchestrator = useChatOrchestratorStore()

    chatOrchestrator.onBeforeMessageComposed(async () => {
      trace.push('beforeMessageComposed')
    })
    chatOrchestrator.onStreamEnd(async () => {
      trace.push('streamEnd')
    })
    chatOrchestrator.onAssistantResponseEnd(async (text) => {
      trace.push(`assistantResponseEnd:${text}`)
    })
    chatOrchestrator.onAssistantMessage(async (_message, text) => {
      trace.push(`assistantMessage:${text}`)
    })
    chatOrchestrator.onChatTurnComplete(async () => {
      trace.push('chatTurnComplete')
    })

    setPresenceState('active')

    // The exact sequence, pinned wholesale: the two hooks that were missing come
    // *before* the inscribe, and `chatTurnComplete` is last.
    //
    // NOTICE: the inscribe is not traced. The hook *order* is what the defect
    // was about — `emitStreamEndHooks`/`emitAssistantResponseEndHooks` were
    // missing entirely, so no downstream consumer ever fired — and the hooks'
    // relative order is what this pins. The inscribe's own position is already
    // covered by the existing "exactly one turn, inscribed into the user's own
    // session" assertion in this suite, which would catch a double-write; a
    // tracer entry for it would instead be counting the session-refresh
    // emissions the later hooks make, which is noise rather than signal.
    await vi.waitFor(() => {
      expect(trace).toEqual([
        'beforeMessageComposed',
        'streamEnd',
        `assistantResponseEnd:${recapFor(BASE_RECORD)}`,
        `assistantMessage:${recapFor(BASE_RECORD)}`,
        'chatTurnComplete',
      ])
    })

    // And the recap is the one that was spoken at every hook that carries text,
    // rather than a placeholder the turn never used.
    expect(composed).toEqual([recapFor(BASE_RECORD)])
  })

  it('never inscribes without an active session', async () => {
    const nap = useNapChatStore()
    const chatSession = useChatSessionStore()
    const trace = traceHooks()

    await nap.recordNapChatCompletion(BASE_RECORD)
    chatSession.activeSessionId = ''

    await nap.surfacePendingRecap()

    expect(trace).toEqual([])
  })

  it('keeps the ledger payload to an allow-list, so nothing unlisted can be relayed', async () => {
    const appendEvent = vi.spyOn(useEventLogStore(), 'appendEvent')

    // A record carrying a field the allow-list does not name. The ledger must
    // not carry it onward, even though the seam accepted it.
    const withExtra = {
      ...BASE_RECORD,
      peerPrivateMemory: 'the peer companion sat alone at midnight',
    } as NapChatSessionRecord

    await useNapChatStore().recordNapChatCompletion(withExtra)

    const completed = appendEvent.mock.calls.map(([input]) => input).find(input => input.type === 'nap_chat_completed')
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

  it('never inscribes the user session text into the journal entry or the spoken turn', async () => {
    const composed: string[] = []
    useChatSessionStore().sessionMessages['user-session-main'] = [
      { role: 'user', content: 'USER PRIVATE HISTORY — DO NOT SURFACE', createdAt: Date.now(), id: 'm1' },
    ] as never
    useChatOrchestratorStore().onAssistantMessage(async (_message, text) => {
      composed.push(text)
    })

    await useNapChatStore().recordNapChatCompletion(BASE_RECORD)
    const journalEntry = vi.mocked(textJournalRepo.saveAll).mock.calls[0][1][0]
    expect(journalEntry.content).toBe(recapFor(BASE_RECORD))
    expect(journalEntry.content).not.toContain('USER PRIVATE HISTORY')

    await useNapChatStore().surfacePendingRecap()
    await vi.waitFor(() => expect(composed).toHaveLength(1))
    expect(composed[0]).not.toContain('USER PRIVATE HISTORY')
  })
})
