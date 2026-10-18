import type { LayeredSearchResult } from './layered-memory'
import type { TriageDecision } from './query-analyzer'

import { describe, expect, it, vi } from 'vitest'

import { formatEvidenceContextBlock, layeredMemory } from './layered-memory'
import { decomposeQuery } from './query-analyzer'

vi.mock('../workers/search', () => ({
  searchWorker: {
    init: vi.fn(async () => ({ stale: false })),
    persist: vi.fn(async () => ({ ok: true })),
    search: vi.fn(async () => ({
      documents: [{ id: 'd1', content: 'doc', kind: 'raw', timestamp: '2026-10-18T00:00:00.000Z', source: 's' }],
      vectorHits: [{ id: 'd1', score: 0.5 }],
      keywordHits: [{ id: 'd1', score: 0.5 }],
      queryVector: [0.1],
    })),
    index: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  },
}))

vi.mock('../../utils/memory-sentinel', () => ({
  shouldDegradeBackgroundWork: vi.fn(() => false),
}))

vi.mock('./query-analyzer', () => ({
  analyzeQuery: vi.fn(() => ({ expandedQuery: 'q', temporalHooks: [], extractedKeywords: ['hello'] })),
  decomposeQuery: vi.fn(() => ['q']),
  heuristicTriage: vi.fn(() => ({ choice: 'c0', category: 0, confidence: 0.5 })),
}))

vi.mock('./hybrid-scorer', () => ({
  defaultScorerConfig: { weightVector: 0.5, weightKeyword: 0.5, temporalWeight: 0.1 },
  scoreHybridResults: vi.fn(() => [{ id: 'd1', content: 'doc', kind: 'raw', score: 0.5, triage: null }]),
}))

function res(overrides: Partial<LayeredSearchResult>): LayeredSearchResult {
  return {
    id: '1',
    content: 'hello',
    kind: 'raw',
    score: 0.5,
    ...overrides,
  } as LayeredSearchResult
}

describe('formatEvidenceContextBlock', () => {
  it('returns empty string when no eligible results', () => {
    expect(formatEvidenceContextBlock([])).toBe('')
    expect(formatEvidenceContextBlock([res({ score: 0.1 })])).toBe('')
  })

  it('formats eligible results with defaults', () => {
    const out = formatEvidenceContextBlock([
      res({ timestamp: '2026-10-18T00:00:00.000Z' }),
    ])
    expect(out).toContain('[Retrieved Memory Context]')
    expect(out).toContain('[RAW]')
    expect(out).toContain('hello')
  })

  it('includes score when requested', () => {
    const out = formatEvidenceContextBlock([res({})], { includeScore: true })
    expect(out).toContain('score: 0.50')
  })

  it('respects minScore', () => {
    const out = formatEvidenceContextBlock([res({ score: 0.9 })], { minScore: 0.95 })
    expect(out).toBe('')
  })
})

describe('layeredMemory', () => {
  it('init sets lastIndexState', async () => {
    const state = await layeredMemory.init()
    expect(state).toBeDefined()
    expect(layeredMemory.lastIndexState).toBe(state)
  })

  it('persist runs', async () => {
    await layeredMemory.persist()
    expect(true).toBe(true)
  })

  it('indexDocuments and removeDocument run', async () => {
    await layeredMemory.indexDocuments([{ id: 'd1' }])
    await layeredMemory.removeDocument('d1')
    expect(true).toBe(true)
  })

  it('search baseline returns array', async () => {
    const out = await layeredMemory.search('hello')
    expect(Array.isArray(out)).toBe(true)
  })

  it('search with triage option', async () => {
    const triage: TriageDecision = { choice: 'c1_multihop', category: 1, confidence: 0.9 } as TriageDecision
    const out = await layeredMemory.search('hello', 5, 'c1', { triage })
    expect(Array.isArray(out)).toBe(true)
  })

  it('search multi subqueries', async () => {
    vi.mocked(decomposeQuery).mockReturnValue(['q1', 'q2'])
    const out = await layeredMemory.search('hello')
    expect(Array.isArray(out)).toBe(true)
    vi.mocked(decomposeQuery).mockReturnValue(['q'])
  })

  it('search with ledger', async () => {
    const ledger = {
      entities: new Map(),
      byAlias: new Map(),
      claims: new Map(),
      bySubjectPredicate: new Map(),
      byObjectPredicate: new Map(),
      queryClaims: () => [],
    } as unknown as Parameters<typeof layeredMemory.search>[3] extends { ledger?: infer L } ? L : never
    const out = await layeredMemory.search('hello', 10, undefined, { ledger })
    expect(Array.isArray(out)).toBe(true)
  })

  it('search with systemOneStore', async () => {
    const store = {
      configured: true,
      runTriage: vi.fn(async () => ({ choice: 'c0', category: 0 })),
      runRerank: vi.fn(async () => ({ rankedCandidates: [{ id: 'd1', finalScore: 0.9 }] })),
    }
    const out = await layeredMemory.search('hello', 10, undefined, { systemOneStore: store as unknown as NonNullable<Parameters<typeof layeredMemory.search>[3]>['systemOneStore'] })
    expect(Array.isArray(out)).toBe(true)
  })
})
