import { describe, expect, it } from 'vitest'

import { analyzeQuery, expandCasualQuery, extractTemporalHooks, resolveTurnAnaphora } from './query-analyzer'

describe('query-analyzer', () => {
  describe('extractTemporalHooks', () => {
    it('extracts ISO dates correctly', () => {
      const hooks = extractTemporalHooks('What did we discuss on 2026-09-15?')
      expect(hooks.length).toBe(1)
      expect(hooks[0].year).toBe(2026)
      expect(hooks[0].monthIndex).toBe(8) // September is 8 (0-indexed)
      expect(hooks[0].day).toBe(15)
      expect(hooks[0].isoDateHint).toBe('2026-09-15')
    })

    it('extracts natural language month, day, and year', () => {
      const hooks = extractTemporalHooks('Where did we go on September 15, 2026 for dinner?')
      expect(hooks.length).toBe(1)
      expect(hooks[0].month).toBe('september')
      expect(hooks[0].day).toBe(15)
      expect(hooks[0].year).toBe(2026)
      expect(hooks[0].isoDateHint).toBe('2026-09-15')
    })

    it('extracts day-first format with ordinal', () => {
      const hooks = extractTemporalHooks('Was our flight on 27th March, 2022 or later?')
      expect(hooks.length).toBe(1)
      expect(hooks[0].month).toBe('march')
      expect(hooks[0].day).toBe(27)
      expect(hooks[0].year).toBe(2022)
    })

    it('extracts month and year without day', () => {
      const hooks = extractTemporalHooks('Events that took place in April 2022')
      expect(hooks.length).toBe(1)
      expect(hooks[0].month).toBe('april')
      expect(hooks[0].year).toBe(2022)
      expect(hooks[0].day).toBeUndefined()
    })

    it('extracts relative temporal keywords', () => {
      const hooks = extractTemporalHooks('What did you eat yesterday?')
      expect(hooks.length).toBe(1)
      expect(hooks[0].text.toLowerCase()).toBe('yesterday')
      expect(hooks[0].isRelative).toBe(true)
    })

    it('returns empty array when no temporal references exist', () => {
      const hooks = extractTemporalHooks('What is your favorite color?')
      expect(hooks).toEqual([])
    })
  })

  describe('resolveTurnAnaphora', () => {
    it('binds pronoun "that" to content words in previous turn', () => {
      const prevTurn = 'I spent all afternoon setting up the acoustic guitar audio interface.'
      const query = 'Do you remember when I bought that?'

      const res = resolveTurnAnaphora(query, prevTurn)
      expect(res.anaphoraResolved).toBe(true)
      expect(res.pronounsDetected).toContain('that')
      expect(res.expandedQuery).toContain('acoustic')
      expect(res.expandedQuery).toContain('guitar')
    })

    it('ignores query without pronouns', () => {
      const prevTurn = 'Richard went to the store to buy apples.'
      const query = 'Where is the supermarket?'

      const res = resolveTurnAnaphora(query, prevTurn)
      expect(res.anaphoraResolved).toBe(false)
      expect(res.expandedQuery).toBe(query)
    })

    it('handles missing previous turn gracefully', () => {
      const query = 'How do I fix that?'
      const res = resolveTurnAnaphora(query, undefined)
      expect(res.anaphoraResolved).toBe(false)
      expect(res.expandedQuery).toBe(query)
    })
  })

  describe('expandCasualQuery', () => {
    it('expands known conversational synonyms without overriding query', () => {
      const query = 'Tell me about the trip to canada'
      const expanded = expandCasualQuery(query)
      expect(expanded).toContain('trip to canada')
      expect(expanded).toContain('Toronto')
      expect(expanded).toContain('flight')
    })
  })

  describe('analyzeQuery (unified)', () => {
    it('integrates anaphora, temporal detection, and keywords', () => {
      const prevTurn = 'I really enjoyed that concert last week.'
      const currentQuery = 'Who went with us to that on 2026-09-15?'

      const result = analyzeQuery(currentQuery, { previousTurn: prevTurn })
      expect(result.anaphoraResolved).toBe(true)
      expect(result.hasTemporalIntent).toBe(true)
      expect(result.temporalHooks.length).toBe(1)
      expect(result.temporalHooks[0].isoDateHint).toBe('2026-09-15')
      expect(result.expandedQuery).toContain('concert')
    })
  })
})
