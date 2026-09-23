import type { SearchCandidate, SearchDocumentMeta } from '../hybrid-scorer'

import { describe, expect, it, vi } from 'vitest'

import { EntityLedger } from '../entity-ledger'
import {
  defaultScorerConfig,
  detectQueryProfile,
  scoreHybridResults,
} from '../hybrid-scorer'
import { layeredMemory } from '../layered-memory'

vi.mock('../../workers/search', () => ({
  searchWorker: {
    init: vi.fn(async () => {}),
    search: vi.fn(async () => ({
      documents: [
        {
          id: 'doc-paris',
          content: 'We had a lovely walk near the Eiffel Tower in Paris on 2024-05-10.',
          kind: 'journal_entry',
          timestamp: '2024-05-10T12:00:00.000Z',
          source: 'user',
        },
      ],
      vectorHits: [{ id: 'doc-paris', score: 0.88 }],
      keywordHits: [{ id: 'doc-paris', score: 0.92 }],
    })),
    index: vi.fn(async () => 1),
    persist: vi.fn(async () => ({})),
    remove: vi.fn(async () => {}),
  },
}))

describe('semantic Search & Memory Refinements', () => {
  describe('query Profile Detection', () => {
    it('detects quote queries', () => {
      expect(detectQueryProfile('what did they say about "hello"?')).toBe('quote')
      expect(detectQueryProfile('verbatim transcript of yesterday')).toBe('quote')
      expect(detectQueryProfile('exact quote: I love coffee')).toBe('quote')
    })

    it('detects question queries', () => {
      expect(detectQueryProfile('who is the actor?')).toBe('question')
      expect(detectQueryProfile('how to run a test')).toBe('question')
      expect(detectQueryProfile('where did we go yesterday?')).toBe('question')
    })

    it('detects longform queries', () => {
      expect(
        detectQueryProfile(
          'this is a very long query that has more than fourteen words to trigger the longform profile detection logic',
        ),
      ).toBe('longform')
    })

    it('detects default queries', () => {
      expect(detectQueryProfile('simple search')).toBe('default')
    })
  })

  describe('rRF & MMR Scoring', () => {
    const mockDocs: SearchDocumentMeta[] = [
      {
        id: 'doc1',
        content: 'I love drinking green tea in the morning.',
        kind: 'raw',
        timestamp: new Date().toISOString(),
        source: 'user',
        embedding: [0.1, 0.2, 0.3],
      },
      {
        id: 'doc2',
        content: 'Green tea is full of healthy antioxidants.',
        kind: 'stmm',
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        source: 'assistant',
        embedding: [0.1, 0.2, 0.31], // very similar to doc1
      },
      {
        id: 'doc3',
        content: 'Antigravity is a powerful AI coding assistant.',
        kind: 'ltmm',
        timestamp: new Date(Date.now() - 7200000).toISOString(),
        source: 'system',
        embedding: [0.9, 0.8, 0.7],
      },
    ]

    const vectorCandidates: SearchCandidate[] = [
      { id: 'doc1', score: 0.85 },
      { id: 'doc2', score: 0.84 },
      { id: 'doc3', score: 0.40 },
    ]

    const keywordCandidates: SearchCandidate[] = [
      { id: 'doc2', score: 1.0 },
      { id: 'doc1', score: 0.5 },
    ]

    it('applies reciprocal rank fusion (RRF) and ranks doc2 first due to higher keyword rank', () => {
      const results = scoreHybridResults(
        'green tea',
        mockDocs,
        vectorCandidates,
        keywordCandidates,
        {
          ...defaultScorerConfig,
          mmrLambda: 1.0, // disable MMR to verify pure RRF first
        },
      )

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe('doc2')
      expect(results[1].id).toBe('doc1')
    })

    it('diversifies results using MMR', () => {
      const results = scoreHybridResults(
        'green tea AI',
        mockDocs,
        vectorCandidates,
        keywordCandidates,
        {
          ...defaultScorerConfig,
          mmrLambda: 0.2, // Strong diversity penalty
        },
      )

      const ids = results.map(r => r.id)
      expect(ids.indexOf('doc2')).toBe(0) // Highest initial relevance is chosen first
      expect(ids.indexOf('doc3')).toBeLessThan(ids.indexOf('doc1')) // doc3 is selected before the duplicate doc1
    })

    it('boosts documents matching extracted temporal hooks even if older', () => {
      const pastDoc: SearchDocumentMeta = {
        id: 'past1',
        content: 'Trip to Tokyo on 2024-04-15 was unforgettable.',
        kind: 'ltmm',
        timestamp: '2024-04-15T10:00:00.000Z',
        source: 'user',
        embedding: [0.5, 0.5, 0.5],
      }
      const recentDoc: SearchDocumentMeta = {
        id: 'recent1',
        content: 'Went to the park today and had tea.',
        kind: 'raw',
        timestamp: new Date().toISOString(),
        source: 'user',
        embedding: [0.5, 0.5, 0.5],
      }

      const docs = [pastDoc, recentDoc]
      const vCandidates = [
        { id: 'recent1', score: 0.7 },
        { id: 'past1', score: 0.65 },
      ]
      const kCandidates = [
        { id: 'recent1', score: 0.6 },
        { id: 'past1', score: 0.6 },
      ]

      // Without temporal hook, recentDoc wins due to recency decay
      const normalResults = scoreHybridResults('tokyo trip', docs, vCandidates, kCandidates)
      expect(normalResults[0].id).toBe('recent1')

      // With temporal hook matching 2024-04-15, pastDoc receives dateMatchBoost and wins
      const temporalResults = scoreHybridResults(
        'tokyo trip 2024-04-15',
        docs,
        vCandidates,
        kCandidates,
        defaultScorerConfig,
        [{ text: '2024-04-15', isoDateHint: '2024-04-15', year: 2024, monthIndex: 3, day: 15 }],
      )

      expect(temporalResults[0].id).toBe('past1')
      expect(temporalResults[0].dateMatchBoost).toBeGreaterThan(0)
    })
  })

  describe('layeredMemory.search with DualSearcherPass3 & Knowledge Graph', () => {
    it('executes baseline search with heuristic triage and in-memory entity graph traversal', async () => {
      const ledger = new EntityLedger()
      ledger.getOrCreateEntity('Paris', 'place')
      ledger.addClaim({
        subject: 'Paris',
        predicate: 'has attraction',
        object: 'Eiffel Tower',
        evidence: ['Visited Eiffel Tower in Paris.'],
        dateInfo: { formatted_label: 'May 10, 2024', iso_date: '2024-05-10' },
      })

      const results = await layeredMemory.search('Tell me about Paris trip', 5, 'card-1', {
        ledger,
      })

      expect(layeredMemory.lastSearchMode).toBe('baseline')
      expect(layeredMemory.lastTriage).toBeDefined()
      expect(layeredMemory.lastTriage?.category).toBe(4) // C4 literal default

      // Should contain Knowledge Graph hit as top priority
      const kgClaim = results.find(r => r.isKgClaim)
      expect(kgClaim).toBeDefined()
      expect(kgClaim?.subject).toBe('Paris')
      expect(kgClaim?.predicate).toBe('has attraction')
      expect(kgClaim?.object).toBe('Eiffel Tower')

      // Should also contain worker hybrid hit
      const workerDoc = results.find(r => r.id === 'doc-paris')
      expect(workerDoc).toBeDefined()
    })

    it('engages Pass 11 System 1 triage and cross-encoder reranker when systemOneStore is configured', async () => {
      const ledger = new EntityLedger()
      ledger.getOrCreateEntity('Alice', 'person')
      ledger.addClaim({
        subject: 'Alice',
        predicate: 'works at',
        object: 'Cyberdyne',
        evidence: ['Alice joined Cyberdyne.'],
      })

      const mockSystemOneStore = {
        configured: true,
        runTriage: vi.fn(async () => ({
          category: 1,
          choice: 'c1_multihop',
          confidence: 0.95,
          probabilities: { c1_multihop: 0.95 },
          temporalSubtype: 'none',
          searchScope: 'multi_session',
          method: 'system1_zero_shot',
          latencyMs: 42,
        })),
        runRerank: vi.fn(async (q: string, pool: any[]) => ({
          rankedCandidates: pool.map((c, idx) => ({
            id: c.id,
            finalScore: idx === 0 ? 0.99 : 0.80,
            normJevScore: 1.0,
          })),
          latencyMs: 55,
        })),
      }

      const results = await layeredMemory.search('Alice connections across all sessions', 5, 'card-1', {
        ledger,
        systemOneStore: mockSystemOneStore,
      })

      expect(mockSystemOneStore.runTriage).toHaveBeenCalled()
      expect(mockSystemOneStore.runRerank).toHaveBeenCalled()
      expect(layeredMemory.lastSearchMode).toBe('pass11')
      expect(layeredMemory.lastTriage?.choice).toBe('c1_multihop')
      expect(results.length).toBeGreaterThan(0)
    })
  })
})
