import { describe, expect, it } from 'vitest'

import {
  analyzeQuery,
  decomposeQuery,
  expandCasualQuery,
  extractTemporalHooks,
  heuristicTriage,
  resolveTurnAnaphora,
} from './query-analyzer'

describe('query-analyzer (comprehensive)', () => {
  it('extractTemporalHooks handles empty and basic', () => {
    expect(extractTemporalHooks('')).toEqual([])
    expect(extractTemporalHooks('no dates here')).toEqual([])
    const hooks = extractTemporalHooks('meeting on 2024-05-10 and May 11')
    expect(Array.isArray(hooks)).toBe(true)
  })

  it('resolveTurnAnaphora empty', () => {
    expect(resolveTurnAnaphora('')).toEqual({ expandedQuery: '', anaphoraResolved: false, pronounsDetected: [] })
  })

  it('resolveTurnAnaphora with previous turn', () => {
    const r = resolveTurnAnaphora('what about it?', 'We discussed Paris yesterday')
    expect(r.expandedQuery).toBeTruthy()
    expect(Array.isArray(r.pronounsDetected)).toBe(true)
  })

  it('expandCasualQuery empty', () => {
    expect(expandCasualQuery('')).toBe('')
    expect(expandCasualQuery(null as unknown as string)).toBeNull()
  })

  it('expandCasualQuery normal', () => {
    expect(typeof expandCasualQuery('hello world')).toBe('string')
  })

  it('analyzeQuery basic', () => {
    const r = analyzeQuery('what did they say?')
    expect(r.originalQuery).toBe('what did they say?')
    expect(typeof r.cleanQuery).toBe('string')
    expect(typeof r.expandedQuery).toBe('string')
  })

  it('analyzeQuery with previousTurn', () => {
    const r = analyzeQuery('and then?', { previousTurn: 'We talked about Paris' })
    expect(r).toBeTruthy()
  })

  it('heuristicTriage basic', () => {
    const t = heuristicTriage('hello')
    expect(typeof t.category).toBe('number')
    expect(typeof t.choice).toBe('string')
    expect(typeof t.confidence).toBe('number')
  })

  it('decomposeQuery basic', () => {
    const parts = decomposeQuery('a and b')
    expect(Array.isArray(parts)).toBe(true)
  })

  it('decomposeQuery with triage', () => {
    const t = heuristicTriage('a and b or c')
    const parts = decomposeQuery('a and b or c', t)
    expect(Array.isArray(parts)).toBe(true)
  })
})
