import { createTestingPinia } from '@pinia/testing'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMemoryLifetimeStore } from './memory-lifetime'

vi.mock('../database/repos/chat-sessions.repo', () => ({ chatSessionsRepo: {} }))
vi.mock('../database/repos/lifetime-memory.repo', () => ({ lifetimeMemoryRepo: {} }))
vi.mock('../database/repos/provisioning-session.repo', () => ({ provisioningSessionRepo: {} }))
vi.mock('../database/repos/short-term-memory.repo', () => ({ shortTermMemoryRepo: {} }))
vi.mock('../database/repos/text-journal.repo', () => ({ textJournalRepo: {} }))
vi.mock('./auth', () => ({ useAuthStore: () => ({}) }))
vi.mock('./llm', () => ({ useLLM: () => ({}) }))
vi.mock('./modules/airi-card', () => ({ useAiriCardStore: () => ({}) }))
vi.mock('./modules/consciousness', () => ({ useConsciousnessStore: () => ({}) }))
vi.mock('./modules/live-session', () => ({ useLiveSessionStore: () => ({}) }))
vi.mock('./providers', () => ({ useProvidersStore: () => ({}) }))
vi.mock('@vueuse/core', () => ({ useBroadcastChannel: () => ({}) }))

describe('memory-lifetime', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ createSpy: vi.fn }))
  })
  it('imports', () => {
    const store = useMemoryLifetimeStore()
    expect(store).toBeDefined()
  })
})
