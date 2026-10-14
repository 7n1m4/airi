import type { ChatSessionMeta, ChatSessionRecord, ChatSessionsIndex } from '../types/chat-session'
import type { AiriCard } from './modules/airi-card'

import { createTestingPinia } from '@pinia/testing'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { chatSessionsRepo } from '../database/repos/chat-sessions.repo'
import { useChatSessionStore } from './chat/session-store'
import { useEchoesStore } from './echo-chips'
import { useEventLogStore } from './event-log'
import { useLLM } from './llm'
import { useAiriCardStore } from './modules/airi-card'
import { usePresenceStore } from './presence'
import { useProactivityStore } from './proactivity'
import { useProvidersStore } from './providers'

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: () => async () => undefined,
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

vi.mock('../database/repos/chat-sessions.repo', () => ({
  chatSessionsRepo: {
    getIndex: vi.fn(() => null),
    getSession: vi.fn(async () => null),
    saveSession: vi.fn(async () => {}),
  },
}))

vi.mock('../database/repos/echo-chips.repo', () => ({
  echoChipsRepo: {
    getAll: vi.fn(async () => []),
    replaceAll: vi.fn(async () => {}),
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

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

function makeCard(dreamOverrides: Record<string, unknown>, heartbeatsOverrides: Record<string, unknown>) {
  return {
    name: 'Airi',
    version: '1.0.0',
    extensions: {
      airi: {
        heartbeats: {
          enabled: false,
          respectSchedule: false,
          pauseWhenAfk: false,
          ...heartbeatsOverrides,
        },
        dreamState: {
          enabled: true,
          minConversationTurns: 1,
          sessionTimeoutMinutes: 1,
          dailyRunDate: null,
          dailyRunCount: 0,
          maxSessionsPerDay: 100,
          strictAfkGating: true,
          ...dreamOverrides,
        },
      },
    },
  }
}

/** One user turn older than the quiet window, for the active character. */
function seedCharacterTurns() {
  const meta: ChatSessionMeta = {
    sessionId: 'session-1',
    characterId: 'airi-card-1',
    userId: 'local',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messageCount: 1,
  }
  const index: ChatSessionsIndex = {
    userId: 'local',
    characters: {
      'airi-card-1': {
        activeSessionId: 'session-1',
        sessions: { 'session-1': meta },
      },
    },
  }
  const session: ChatSessionRecord = {
    meta,
    messages: [{ role: 'user', content: 'hello', createdAt: Date.now() - 20 * 60 * 1000 } as ChatSessionRecord['messages'][number]],
  }

  vi.mocked(chatSessionsRepo.getIndex).mockResolvedValue(index)
  vi.mocked(chatSessionsRepo.getSession).mockResolvedValue(session)
}

/** Feed a fixed idle reading through a test provider into the presence store. */
function seedIdleReading(idleSeconds: number) {
  const presence = usePresenceStore()
  presence.addSignalProvider({ id: 'test', readIdleSec: () => idleSeconds })
  presence.writeIdleTimeSec(idleSeconds)
}

/**
 * Dream State's AFK gate, fed by the presence store instead of an inline
 * threshold.
 *
 * The gate is `strictAfkGating`: consolidation happens only when the user is
 * away. Consolidation itself is stubbed, so these tests observe the gate's
 * decision, not a full consolidation run.
 */
describe('dream state AFK gate (strictAfkGating) consumes the canonical presence source', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createTestingPinia({ createSpy: vi.fn, stubActions: false }))

    const airiCardStore = useAiriCardStore()
    airiCardStore.cards.set('airi-card-1', makeCard({}, {}) as unknown as AiriCard)
    airiCardStore.activeCardId = 'airi-card-1'
  })

  it('does NOT consolidate below the AFK threshold (user still present)', async () => {
    seedCharacterTurns()
    const proactivity = useProactivityStore()
    const echoes = useEchoesStore()

    // 60s idle: below the default 5-minute AFK threshold.
    seedIdleReading(60)
    const synthesize = vi.fn(async () => [])
    echoes.synthesizeForCharacter = synthesize

    await proactivity.evaluateDreamState({ force: false })

    expect(synthesize).not.toHaveBeenCalled()
  })

  it('consolidates above the AFK threshold (user is away)', async () => {
    seedCharacterTurns()
    const proactivity = useProactivityStore()
    const echoes = useEchoesStore()

    // 600s idle: above the default 5-minute AFK threshold.
    seedIdleReading(600)
    const synthesize = vi.fn(async () => [])
    echoes.synthesizeForCharacter = synthesize

    await proactivity.evaluateDreamState({ force: false })

    expect(synthesize).toHaveBeenCalledOnce()
  })

  it('honours the dreamState.afkThresholdMinutes override, not the heartbeats one', async () => {
    seedCharacterTurns()
    const proactivity = useProactivityStore()
    const airiCardStore = useAiriCardStore()
    const echoes = useEchoesStore()

    // dreamState has its OWN required afkThresholdMinutes (card.schema.ts:146),
    // distinct from heartbeats' optional one (:137). 600s = 10min idle must NOT
    // consolidate when dreamState says 15 minutes.
    airiCardStore.cards.set('airi-card-1', makeCard({ afkThresholdMinutes: 15 }, {}) as unknown as AiriCard)
    seedIdleReading(600)
    const notSynthesized = vi.fn(async () => [])
    echoes.synthesizeForCharacter = notSynthesized

    await proactivity.evaluateDreamState({ force: false })
    expect(notSynthesized).not.toHaveBeenCalled()
  })

  it('consolidates once a dreamState.afkThresholdMinutes of 15 is cleared', async () => {
    seedCharacterTurns()
    const proactivity = useProactivityStore()
    const airiCardStore = useAiriCardStore()
    const echoes = useEchoesStore()

    airiCardStore.cards.set('airi-card-1', makeCard({ afkThresholdMinutes: 15 }, {}) as unknown as AiriCard)
    // 960s = 16min idle clears a 15-minute dream threshold.
    seedIdleReading(960)
    const synthesized = vi.fn(async () => [])
    echoes.synthesizeForCharacter = synthesized

    await proactivity.evaluateDreamState({ force: false })
    expect(synthesized).toHaveBeenCalledOnce()
  })

  it('keeps the dreamState and heartbeats AFK thresholds independent', async () => {
    seedCharacterTurns()
    const proactivity = useProactivityStore()
    const airiCardStore = useAiriCardStore()
    const echoes = useEchoesStore()

    // heartbeats' very short threshold must NOT drag dream state's long one down.
    airiCardStore.cards.set('airi-card-1', makeCard({ afkThresholdMinutes: 15 }, { afkThresholdMinutes: 1 }) as unknown as AiriCard)
    seedIdleReading(600)
    const notSynthesized = vi.fn(async () => [])
    echoes.synthesizeForCharacter = notSynthesized

    await proactivity.evaluateDreamState({ force: false })
    expect(notSynthesized).not.toHaveBeenCalled()
  })

  it('heartbeats\' AFK threshold does not leak into dream state\'s own threshold', async () => {
    seedCharacterTurns()
    const proactivity = useProactivityStore()
    const airiCardStore = useAiriCardStore()
    const echoes = useEchoesStore()
    const presence = usePresenceStore()

    // heartbeats' override changes presence's DEFAULT threshold…
    airiCardStore.cards.set('airi-card-1', makeCard({ afkThresholdMinutes: 15 }, { afkThresholdMinutes: 1 }) as unknown as AiriCard)
    expect(presence.afkThresholdMinutes).toBe(1)

    // …but dream state gates on its own 15-minute field, so a 200s reading
    // does NOT consolidate even though presence's default would call the user
    // away after one minute.
    const notSynthesized = vi.fn(async () => [])
    echoes.synthesizeForCharacter = notSynthesized
    seedIdleReading(200)

    expect(presence.isUserAway()).toBe(true)

    await proactivity.evaluateDreamState({ force: false })
    expect(notSynthesized).not.toHaveBeenCalled()
  })

  it('force bypasses the AFK gate entirely', async () => {
    seedCharacterTurns()
    const proactivity = useProactivityStore()
    const echoes = useEchoesStore()

    // Active user: 0s idle — normally an absolute non-consolidation case.
    seedIdleReading(0)
    const synthesize = vi.fn(async () => [])
    echoes.synthesizeForCharacter = synthesize

    await proactivity.evaluateDreamState({ force: true })

    expect(synthesize).toHaveBeenCalledOnce()
  })

  it('does not gate at all when strictAfkGating is disabled', async () => {
    seedCharacterTurns()
    const proactivity = useProactivityStore()
    const airiCardStore = useAiriCardStore()
    const echoes = useEchoesStore()

    airiCardStore.cards.set('airi-card-1', makeCard({ strictAfkGating: false }, {}) as unknown as AiriCard)
    seedIdleReading(0)
    const synthesize = vi.fn(async () => [])
    echoes.synthesizeForCharacter = synthesize

    await proactivity.evaluateDreamState({ force: false })

    expect(synthesize).toHaveBeenCalledOnce()
  })
})

/**
 * Heartbeat AFK gate, now fed by the presence store's resolved threshold.
 *
 * `evaluateHeartbeatGating` is unchanged and pure; what changed is *where its
 * inputs come from*. The threshold presence resolves for the active card must
 * reach the gate, and the idle value must come from the same reading presence
 * derives its snapshot from.
 */
describe('heartbeat AFK gate consumes the canonical presence source', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createTestingPinia({ createSpy: vi.fn, stubActions: false }))

    const airiCardStore = useAiriCardStore()
    airiCardStore.cards.set('airi-card-1', makeCard({}, {
      enabled: true,
      respectSchedule: false,
      pauseWhenAfk: true,
      intervalMinutes: 0,
      prompt: 'Test directive',
    }) as unknown as AiriCard)
    airiCardStore.activeCardId = 'airi-card-1'

    // No configured provider: the heartbeat gets past the AFK gate and then
    // fails at provider resolution, which is the observable signal that the
    // AFK gate did not suppress it.
    vi.spyOn(useProvidersStore(), 'getProviderInstance').mockImplementation(async () => ({ provider: 'ollama' }) as never)

    useChatSessionStore().isEnsuringSession = false
  })

  it('suppresses the heartbeat while AFK, without reaching the provider', async () => {
    const proactivity = useProactivityStore()
    const presence = usePresenceStore()
    const eventLog = useEventLogStore()

    // 360s idle > the default 5-minute threshold.
    seedIdleReading(360)
    proactivity.lastHeartbeatTime = 0

    const generation = vi.fn(async () => ({ text: 'hi' }))
    vi.spyOn(useLLM(), 'generate').mockImplementation(generation as never)

    expect(presence.afk).toBe(true)

    await proactivity.evaluateHeartbeat({ force: false })

    // Stopped at the AFK gate: no failure recorded, no generation attempt.
    expect(generation).not.toHaveBeenCalled()
    expect(eventLog.appendEvent).not.toHaveBeenCalled()
  })

  it('unsuppresses the heartbeat below the AFK threshold', async () => {
    const proactivity = useProactivityStore()
    const presence = usePresenceStore()
    const eventLog = useEventLogStore()

    // 30s idle < the default 5-minute threshold.
    seedIdleReading(30)
    proactivity.lastHeartbeatTime = 0

    // Preconditions for the gate to pass: not AFK, no in-flight evaluation.
    expect(presence.afk).toBe(false)
    expect(presence.afkThresholdMinutes).toBe(5)
    expect(proactivity.idleTimeSec).toBe(30)
    expect(proactivity.lastHeartbeatTime).toBe(0)
    expect(proactivity.isHeartbeatEvaluating).toBe(false)

    await proactivity.evaluateHeartbeat({ force: false })

    // Past the AFK gate: the heartbeat reaches provider resolution. Since no
    // real provider instance exists here, it fails there — which proves the
    // AFK gate did NOT suppress it.
    expect(eventLog.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'heartbeat_failed' }),
    )
  })
})
