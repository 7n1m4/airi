import type { LifetimeMemoryArtifact } from '../types/lifetime-memory'
import type { AiriCard } from './modules/airi-card'

import { companionServiceGetConsent } from '@proj-airi/stage-shared'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useChatSessionStore } from './chat/session-store'
import { COMPANION_SCOPES, isNapChatEligibleModel, napTodayKey, useCompanionStore } from './companion'
import { useMemoryLifetimeStore } from './memory-lifetime'
import { useAiriCardStore } from './modules/airi-card'

/**
 * The main-side companion bridge, answered per contract.
 *
 * NOTICE: the companion store reads consent from main when it is created, so
 * this is registered rather than left to fall through — an unusable reply is
 * hardened against, but it would leave the suite exercising the refusal path
 * instead of the snapshot it means to read.
 */
const bridgeReplies = new Map<object, (payload: unknown) => unknown>()
bridgeReplies.set(companionServiceGetConsent, () => ({ granted: false, scope: 'card-only', grantedAt: undefined }))
vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: (invoke: { id: string }) => async (payload: unknown) => {
    const handler = bridgeReplies.get(invoke)
    if (handler)
      return handler(payload)
    console.warn('[CompanionStore] Ignoring unusable reply from main')
    return undefined
  },
  useElectronEventaContext: () => ({ value: undefined }),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

/**
 * Session persistence, answered in memory.
 *
 * NOTICE: the real repo opens IndexedDB, which the unit runner has no binding
 * for; the session store is real, so only its persistence edge is stubbed.
 */
vi.mock('../database/repos/chat-sessions.repo', () => ({
  chatSessionsRepo: {
    getIndex: async () => null,
    saveIndex: async () => {},
    getSession: async () => null,
    saveSession: async () => {},
    getAllSessions: async () => new Map(),
    deleteSession: async () => {},
  },
}))

const CARD_ID = 'card-airi'

describe('companion pure exports', () => {
  it('cOMPANION_SCOPES ordered narrowest first', () => {
    expect(COMPANION_SCOPES).toEqual(['card-only', 'card-and-echo-chips', 'card-and-lifetime'])
  })

  it('napTodayKey returns UTC date string', () => {
    expect(napTodayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('isNapChatEligibleModel refuses missing model', () => {
    expect(isNapChatEligibleModel({})).toEqual({ allowed: false, reason: 'model-gate: no active model' })
  })

  it('isNapChatEligibleModel allows local', () => {
    expect(isNapChatEligibleModel({ providerKey: 'p', modelId: 'm', deployment: 'local' })).toEqual({ allowed: true })
  })

  it('isNapChatEligibleModel allows free pricing', () => {
    expect(isNapChatEligibleModel({ providerKey: 'p', modelId: 'm', pricing: 'free' })).toEqual({ allowed: true })
  })

  it('isNapChatEligibleModel allows catalog hit', () => {
    expect(isNapChatEligibleModel({ providerKey: 'p', modelId: 'm', freeCatalogIds: ['p:m'] })).toEqual({ allowed: true })
    expect(isNapChatEligibleModel({ providerKey: 'p:i', modelId: 'm', freeCatalogIds: ['p:m'] })).toEqual({ allowed: true })
  })

  it('isNapChatEligibleModel refuses unknown', () => {
    const r = isNapChatEligibleModel({ providerKey: 'p', modelId: 'm' })
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('neither local nor known-free')
  })
})

/**
 * The hosted-guest snapshot's lifetime pillar under universe isolation.
 *
 * NOTICE: the charId-keyed lifetime mirror is only populated while the
 * character's *active* universe matches it, so a per-universe anchor can exist
 * while the mirror is empty. These pin that the snapshot reads the universe this
 * node is actually in — falling back to the mirror only when no session context
 * exists — because that is the difference between a hosted guest receiving the
 * distilled artifact and silently receiving none.
 */
describe('companion guest snapshot (lifetimeDDistilled)', () => {
  /** Seed one per-universe anchor, leaving the legacy mirror untouched. */
  function seedUniverseArtifact(distilled: string, universeId: string) {
    const store = useMemoryLifetimeStore()
    const artifact = {
      id: 'lt-1',
      characterId: CARD_ID,
      universeId,
      distilledContent: distilled,
      chunkSummaries: [],
      baseArchive: '',
      metadata: {},
    } as unknown as LifetimeMemoryArtifact
    // `setCachedArtifact` is store-internal, so seed the cache as a load would:
    // the per-universe anchor, and the mirror only for the universe it is
    // anchored to.
    store.artifactsByUniverse.set(`${CARD_ID}:${universeId}`, artifact)
    return artifact
  }

  /** One loaded session in a universe, active on this node. */
  async function seedSession(universeId?: string): Promise<string> {
    const sessions = useChatSessionStore()
    await sessions.initialize()
    const sessionId = await sessions.createSession(CARD_ID, { setActive: true, universeId })
    if (universeId === undefined) {
      const meta = sessions.getSessionMeta(sessionId)
      if (meta)
        delete meta.universeId
    }
    return sessionId
  }

  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    localStorage.clear()

    const cardStore = useAiriCardStore()
    const card: AiriCard = { id: CARD_ID, name: 'Airi', version: '1.0.0', extensions: { airi: {} } } as unknown as AiriCard
    cardStore.cards.set(CARD_ID, card)
    cardStore.activeCardId = CARD_ID
  })

  it('reads the anchor of the active session universe when the mirror is empty', async () => {
    seedUniverseArtifact('distilled under universe B', 'universe-b')
    await seedSession('universe-b')

    // The mirror is empty, exactly as it is whenever the character's active
    // universe is not the universe this anchor lives in.
    expect(useMemoryLifetimeStore().artifacts.get(CARD_ID)).toBeUndefined()

    expect(useCompanionStore().guestSnapshot.lifetimeDistilled).toBe('distilled under universe B')
  })

  it('does not read a universe this node is not in', async () => {
    seedUniverseArtifact('distilled under universe B', 'universe-b')
    await seedSession('universe-a')

    expect(useCompanionStore().guestSnapshot.lifetimeDistilled).toBeUndefined()
  })

  it('falls back to the mirror while no universe context is loaded', async () => {
    const artifact = seedUniverseArtifact('distilled legacy mirror', 'global')
    useMemoryLifetimeStore().artifacts.set(CARD_ID, artifact)
    await seedSession()

    const sessions = useChatSessionStore()
    expect(sessions.getSessionMeta(sessions.activeSessionId)?.universeId).toBeUndefined()
    expect(useCompanionStore().guestSnapshot.lifetimeDistilled).toBe('distilled legacy mirror')
  })
})
