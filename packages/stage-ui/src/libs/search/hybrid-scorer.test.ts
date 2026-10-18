import type { ScorerConfig, SearchCandidate, SearchDocumentMeta } from './hybrid-scorer'
import type { ExtractedDateHook } from './query-analyzer'

import { describe, expect, it } from 'vitest'

import { computeDateMatchBoost, defaultScorerConfig, detectQueryProfile, scoreHybridResults } from './hybrid-scorer'

function doc(overrides: Partial<SearchDocumentMeta> = {}): SearchDocumentMeta {
  return {
    id: 'd1',
    content: 'hello world',
    kind: 'raw',
    timestamp: '2026-10-18T00:00:00.000Z',
    source: 's',
    ...overrides,
  }
}

describe('hybrid-scorer', () => {
  describe('detectQueryProfile', () => {
    it('detects quote', () => {
      expect(detectQueryProfile('What did you say')).toBe('quote')
      expect(detectQueryProfile('exact quote please')).toBe('quote')
      expect(detectQueryProfile('exact phrase')).toBe('default')
      expect(detectQueryProfile('hello "world"')).toBe('quote')
      expect(detectQueryProfile('verbatim text')).toBe('quote')
      expect(detectQueryProfile('what was that')).toBe('quote')
      expect(detectQueryProfile('find exact match')).toBe('quote')
    })
    it('detects question', () => {
      expect(detectQueryProfile('who are you?')).toBe('question')
      expect(detectQueryProfile('what is x')).toBe('question')
    })
    it('who/what/when/where/why/how regex', () => {
      for (const w of ['who', 'what', 'when', 'where', 'why', 'how']) {
        expect(detectQueryProfile(`${w} something`)).toBe('question')
      }
    })
    it('detects longform', () => {
      const q = new Array(14).fill('word').join(' ')
      expect(detectQueryProfile(q)).toBe('longform')
    })
    it('default', () => {
      expect(detectQueryProfile('hi')).toBe('default')
    })
  })

  describe('computeDateMatchBoost', () => {
    it('returns 0 for no hooks/empty timestamp', () => {
      expect(computeDateMatchBoost('')).toBe(0)
      expect(computeDateMatchBoost('2026-01-01', [])).toBe(0)
      expect(computeDateMatchBoost('2026-01-01', undefined)).toBe(0)
    })
    it('iso date hint prefix', () => {
      const hooks: ExtractedDateHook[] = [{ text: '', isoDateHint: '2026-01' }]
      expect(computeDateMatchBoost('2026-01-05', hooks, 0.25)).toBe(0.25)
    })
    it('year+month+day exact', () => {
      const hooks: ExtractedDateHook[] = [{ text: '', year: 2026, monthIndex: 0, day: 5 }]
      expect(computeDateMatchBoost('2026-01-05T00:00:00Z', hooks, 0.25)).toBe(0.25)
    })
    it('year+month partial (no day match)', () => {
      const hooks: ExtractedDateHook[] = [{ text: '', year: 2026, monthIndex: 0, day: 9 }]
      expect(computeDateMatchBoost('2026-01-05T00:00:00Z', hooks, 0.25)).toBeCloseTo(0.175)
    })
    it('year+month without day hook', () => {
      const hooks: ExtractedDateHook[] = [{ text: '', year: 2026, monthIndex: 0 }]
      expect(computeDateMatchBoost('2026-01-05T00:00:00Z', hooks, 0.25)).toBeCloseTo(0.175)
    })
    it('year only', () => {
      const hooks: ExtractedDateHook[] = [{ text: '', year: 2026 }]
      expect(computeDateMatchBoost('2026-01-05T00:00:00Z', hooks, 0.25)).toBeCloseTo(0.1)
    })
    it('invalid date with text match', () => {
      const hooks: ExtractedDateHook[] = [{ text: 'foo' }]
      expect(computeDateMatchBoost('foo-bar', hooks, 0.25)).toBeCloseTo(0.15)
    })
    it('invalid date no text match returns 0', () => {
      const hooks: ExtractedDateHook[] = [{ text: 'zzz' }]
      expect(computeDateMatchBoost('foo-bar', hooks, 0.25)).toBe(0)
    })
  })

  describe('scoreHybridResults', () => {
    it('empty documents returns empty', () => {
      expect(scoreHybridResults('hi', [], [], [])).toEqual([])
    })
    it('filters out zero-signal results', () => {
      const docs = [doc({ id: 'x' })]
      const res = scoreHybridResults('hi', docs, [], [], defaultScorerConfig)
      expect(res).toEqual([])
    })
    it('basic scoring with vector+keyword', () => {
      const docs = [doc({ id: 'a' }), doc({ id: 'b', kind: 'stmm' })]
      const vec: SearchCandidate[] = [{ id: 'a', score: 0.9 }]
      const kw: SearchCandidate[] = [{ id: 'b', score: 0.8 }]
      const res = scoreHybridResults('hi', docs, vec, kw)
      expect(res.length).toBe(2)
      expect(res[0].id).toBeDefined()
    })
    it('dateMatchBoost keeps result even without signals', () => {
      const docs = [doc({ id: 'a', timestamp: '2026-01-05T00:00:00Z' })]
      const hooks: ExtractedDateHook[] = [{ text: '', isoDateHint: '2026-01' }]
      const res = scoreHybridResults('hi', docs, [], [], defaultScorerConfig, hooks)
      expect(res.length).toBe(1)
      expect(res[0].dateMatchBoost).toBeGreaterThan(0)
    })
    it('temporal hooks passed', () => {
      const docs = [doc({ id: 'a' })]
      const vec: SearchCandidate[] = [{ id: 'a', score: 0.9 }]
      const res = scoreHybridResults('hi', docs, vec, [], defaultScorerConfig, [{ text: '', year: 2026 }])
      expect(res.length).toBe(1)
    })
    it('invalid timestamp temporal score 0.75', () => {
      const docs = [doc({ id: 'a', timestamp: 'not-a-date' })]
      const vec: SearchCandidate[] = [{ id: 'a', score: 0.9 }]
      const res = scoreHybridResults('hi', docs, vec, [])
      expect(res[0].temporalScore).toBe(0.75)
    })
    it('future timestamp temporal score 1', () => {
      const future = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString()
      const docs = [doc({ id: 'a', timestamp: future })]
      const vec: SearchCandidate[] = [{ id: 'a', score: 0.9 }]
      const res = scoreHybridResults('hi', docs, vec, [])
      expect(res[0].temporalScore).toBe(1)
    })
    it('quote profile', () => {
      const docs = [doc({ id: 'a' }), doc({ id: 'b' })]
      const vec: SearchCandidate[] = [{ id: 'a', score: 0.9 }, { id: 'b', score: 0.8 }]
      const res = scoreHybridResults('what did you say', docs, vec, [])
      expect(res[0].profile).toBe('quote')
    })
    it('longform profile', () => {
      const q = new Array(14).fill('word').join(' ')
      const docs = [doc({ id: 'a' })]
      const vec: SearchCandidate[] = [{ id: 'a', score: 0.9 }]
      const res = scoreHybridResults(q, docs, vec, [])
      expect(res[0].profile).toBe('longform')
    })
    it('question profile', () => {
      const docs = [doc({ id: 'a' })]
      const vec: SearchCandidate[] = [{ id: 'a', score: 0.9 }]
      const res = scoreHybridResults('how are you', docs, vec, [])
      expect(res[0].profile).toBe('question')
    })
    it('default profile', () => {
      const docs = [doc({ id: 'a' })]
      const vec: SearchCandidate[] = [{ id: 'a', score: 0.9 }]
      const res = scoreHybridResults('hi', docs, vec, [])
      expect(res[0].profile).toBe('default')
    })
    it('noise filtering drops vector signal', () => {
      const docs = [doc({ id: 'a' })]
      const vec: SearchCandidate[] = [{ id: 'a', score: 0.4 }]
      const res = scoreHybridResults('hi', docs, vec, [])
      expect(res.length).toBe(0)
    })
    it('best >=0.7 not noise', () => {
      const docs = [doc({ id: 'a' })]
      const vec: SearchCandidate[] = [{ id: 'a', score: 0.9 }]
      const res = scoreHybridResults('hi', docs, vec, [])
      expect(res.length).toBe(1)
    })
    it('best < minVectorSimilarity => noise', () => {
      const docs = [doc({ id: 'a' })]
      const vec: SearchCandidate[] = [{ id: 'a', score: 0.2 }]
      const res = scoreHybridResults('hi', docs, vec, [])
      expect(res.length).toBe(0)
    })
    it('empty vectorScores => not noise', () => {
      const docs = [doc({ id: 'a' })]
      const kw: SearchCandidate[] = [{ id: 'a', score: 0.8 }]
      const res = scoreHybridResults('hi', docs, [], kw)
      expect(res.length).toBe(1)
    })
    it('mMR diversification with embeddings', () => {
      const docs = [
        doc({ id: 'a', embedding: [1, 0] }),
        doc({ id: 'b', embedding: [0.99, 0.01] }),
        doc({ id: 'c', embedding: [0, 1] }),
      ]
      const vec: SearchCandidate[] = [{ id: 'a', score: 0.9 }, { id: 'b', score: 0.85 }, { id: 'c', score: 0.8 }]
      const res = scoreHybridResults('hi', docs, vec, [])
      expect(res.length).toBe(3)
    })
    it('mMR with jaccard fallback', () => {
      const docs = [
        doc({ id: 'a', content: 'hello world' }),
        doc({ id: 'b', content: 'hello world' }),
      ]
      const vec: SearchCandidate[] = [{ id: 'a', score: 0.9 }, { id: 'b', score: 0.8 }]
      const res = scoreHybridResults('hi', docs, vec, [])
      expect(res.length).toBe(2)
    })
    it('sort tie-break', () => {
      const hooks: ExtractedDateHook[] = [{ text: '', isoDateHint: '2026-01' }]
      const docs2 = [
        doc({ id: 'a', kind: 'raw', timestamp: '2026-01-01T00:00:00Z' }),
        doc({ id: 'b', kind: 'raw', timestamp: '2026-01-01T00:00:00Z' }),
      ]
      const res = scoreHybridResults('hi', docs2, [], [], defaultScorerConfig, hooks)
      expect(res.length).toBe(2)
    })
    it('cosine zero mag', () => {
      const docs = [doc({ id: 'a', embedding: [0, 0] }), doc({ id: 'b', embedding: [1, 0] })]
      const vec: SearchCandidate[] = [{ id: 'a', score: 0.9 }, { id: 'b', score: 0.8 }]
      const res = scoreHybridResults('hi', docs, vec, [])
      expect(res.length).toBe(2)
    })
    it('embedding length mismatch', () => {
      const docs = [doc({ id: 'a', embedding: [1, 0, 0] }), doc({ id: 'b', embedding: [1, 0] })]
      const vec: SearchCandidate[] = [{ id: 'a', score: 0.9 }, { id: 'b', score: 0.8 }]
      const res = scoreHybridResults('hi', docs, vec, [])
      expect(res.length).toBe(2)
    })
    it('poolSize slicing 35', () => {
      const docs = Array.from({ length: 35 }, (_, i) => doc({ id: `d${i}` }))
      const vec: SearchCandidate[] = docs.map((d, i) => ({ id: d.id, score: 1 - i * 0.01 }))
      const res = scoreHybridResults('hi', docs, vec, [])
      expect(res.length).toBe(35)
    })
    it('config undefined rrfK/mmrLambda', () => {
      const cfg: ScorerConfig = { ...defaultScorerConfig, rrfK: undefined, mmrLambda: undefined }
      const docs = [doc({ id: 'a' })]
      const vec: SearchCandidate[] = [{ id: 'a', score: 0.9 }]
      const res = scoreHybridResults('hi', docs, vec, [], cfg)
      expect(res.length).toBe(1)
    })
    it('normalizeWeights total <=0', () => {
      const cfg: ScorerConfig = { ...defaultScorerConfig, weightVector: 0, weightKeyword: 0 }
      const docs = [doc({ id: 'a' })]
      const vec: SearchCandidate[] = [{ id: 'a', score: 0.9 }]
      const res = scoreHybridResults('hi', docs, vec, [], cfg)
      expect(res.length).toBe(1)
    })
    it('layerBoosts', () => {
      const docs = [doc({ id: 'a', kind: 'raw' })]
      const vec: SearchCandidate[] = [{ id: 'a', score: 0.9 }]
      const cfg: ScorerConfig = { ...defaultScorerConfig, layerBoosts: { raw: 0, stmm: 0, ltmm: 0 } }
      const res = scoreHybridResults('hi', docs, vec, [], cfg)
      expect(res[0].layerBoost).toBe(0)
    })
    it('temporalMatchBonus undefined', () => {
      const docs = [doc({ id: 'a', timestamp: '2026-01-05T00:00:00Z' })]
      const vec: SearchCandidate[] = [{ id: 'a', score: 0.9 }]
      const cfg: ScorerConfig = { ...defaultScorerConfig, temporalMatchBonus: undefined }
      const hooks: ExtractedDateHook[] = [{ text: '', isoDateHint: '2026-01' }]
      const res = scoreHybridResults('hi', docs, vec, [], cfg, hooks)
      expect(res[0].dateMatchBoost).toBe(0.25)
    })
  })
})
