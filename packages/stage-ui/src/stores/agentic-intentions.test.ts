import type { AgenticIntention, IntentionRankingPolicy } from '@proj-airi/stage-shared/agentic'

import { describe, expect, it } from 'vitest'

import { AUTONOMOUS_RANKING_POLICY, rankIntentions, scoreIntention, topScore } from './agentic-intentions'

const NOW = 1_700_000_000_000
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function intention(overrides: Partial<AgenticIntention> = {}): AgenticIntention {
  return {
    id: 'test',
    kind: 'continuity-thread',
    pillar: 'text-journal',
    title: 'Test',
    body: 'Test body',
    memoryCreatedAt: NOW,
    ...overrides,
  }
}

describe('autonomous intention ranking', () => {
  describe('pillar provenance', () => {
    it('ranks a lifetime archive above an event-log entry for identical recency', () => {
      const ranked = rankIntentions([
        intention({ id: 'event', pillar: 'event-log' }),
        intention({ id: 'lifetime', pillar: 'lifetime' }),
      ], AUTONOMOUS_RANKING_POLICY, NOW)

      // Provenance is the only differing term here, so the order it induces is
      // exactly the weight order.
      expect(ranked[0].intention.id).toBe('lifetime')
      expect(ranked[1].intention.id).toBe('event')
    })

    it('keeps provenance inside the documented 0.10–0.45 band', () => {
      const weights = AUTONOMOUS_RANKING_POLICY.pillarWeights
      expect(Math.min(...Object.values(weights))).toBeGreaterThanOrEqual(0.1)
      expect(Math.max(...Object.values(weights))).toBeLessThanOrEqual(0.45)
    })
  })

  describe('recency decay', () => {
    it('gives full weight to a memory created inside the recent window', () => {
      const score = scoreIntention(intention({ memoryCreatedAt: NOW - HOUR }), AUTONOMOUS_RANKING_POLICY, NOW)
      expect(score.recencyPoints).toBeCloseTo(AUTONOMOUS_RANKING_POLICY.recency.points, 6)
    })

    it('halves the recency weight one half-life past the full-weight window', () => {
      const policy: IntentionRankingPolicy = {
        ...AUTONOMOUS_RANKING_POLICY,
        recency: { fullWeightWithinHours: 0, points: 0.25, halfLifeHours: 24 },
      }

      const atHalfLife = scoreIntention(intention({ memoryCreatedAt: NOW - DAY }), policy, NOW)
      const atTwoHalfLives = scoreIntention(intention({ memoryCreatedAt: NOW - 2 * DAY }), policy, NOW)

      expect(atHalfLife.recencyPoints).toBeCloseTo(0.125, 4)
      expect(atTwoHalfLives.recencyPoints).toBeCloseTo(0.0625, 4)
    })

    it('defers the decay until the full-weight window has passed', () => {
      const policy: IntentionRankingPolicy = {
        ...AUTONOMOUS_RANKING_POLICY,
        recency: { fullWeightWithinHours: 24, points: 0.25, halfLifeHours: 24 },
      }

      // Inside the window the weight is flat, so a memory from 20 hours ago
      // still counts as a live thread.
      const insideWindow = scoreIntention(intention({ memoryCreatedAt: NOW - 20 * HOUR }), policy, NOW)
      expect(insideWindow.recencyPoints).toBeCloseTo(0.25, 6)
    })

    it('does not let a missing timestamp score negative or undefined', () => {
      const score = scoreIntention(intention({ memoryCreatedAt: undefined }), AUTONOMOUS_RANKING_POLICY, NOW)
      expect(score.recencyPoints).toBe(0)
      expect(Number.isFinite(score.total)).toBe(true)
    })

    it('clamps a clock-skewed future timestamp to now rather than going negative', () => {
      const score = scoreIntention(intention({ memoryCreatedAt: NOW + 5 * DAY }), AUTONOMOUS_RANKING_POLICY, NOW)
      expect(score.recencyPoints).toBeCloseTo(AUTONOMOUS_RANKING_POLICY.recency.points, 6)
    })

    it('returns zero for a negative memory timestamp', () => {
      const score = scoreIntention(intention({ memoryCreatedAt: -1 }), AUTONOMOUS_RANKING_POLICY, NOW)
      expect(score.recencyPoints).toBe(0)
    })

    it('treats a non-finite memory timestamp as missing', () => {
      const score = scoreIntention(intention({ memoryCreatedAt: Number.NaN }), AUTONOMOUS_RANKING_POLICY, NOW)
      expect(score.recencyPoints).toBe(0)
    })
  })

  describe('deadline pressure', () => {
    it('gives full weight to a deadline due inside the window', () => {
      const score = scoreIntention(intention({ deadlineAt: NOW + HOUR }), AUTONOMOUS_RANKING_POLICY, NOW)
      expect(score.deadlinePoints).toBeCloseTo(AUTONOMOUS_RANKING_POLICY.deadline.points, 6)
    })

    it('keeps full weight for an overdue deadline', () => {
      const overdue = scoreIntention(intention({ deadlineAt: NOW - 3 * DAY }), AUTONOMOUS_RANKING_POLICY, NOW)
      expect(overdue.deadlinePoints).toBeCloseTo(AUTONOMOUS_RANKING_POLICY.deadline.points, 6)
    })

    it('decays to zero beyond the remembered window', () => {
      const far = scoreIntention(intention({ deadlineAt: NOW + 30 * DAY }), AUTONOMOUS_RANKING_POLICY, NOW)
      expect(far.deadlinePoints).toBe(0)
    })

    it('lets a deadline outrank pillar provenance, so a stated commitment wins', () => {
      const ranked = rankIntentions([
        intention({ id: 'archive', pillar: 'lifetime' }),
        intention({ id: 'deadline', pillar: 'event-log', deadlineAt: NOW + HOUR }),
      ], AUTONOMOUS_RANKING_POLICY, NOW)

      expect(ranked[0].intention.id).toBe('deadline')
    })

    it('linearly decays a deadline between the within-window and the remembered window', () => {
      const mid = scoreIntention(intention({ deadlineAt: NOW + 3 * DAY }), AUTONOMOUS_RANKING_POLICY, NOW)
      expect(mid.deadlinePoints).toBeGreaterThan(0)
      expect(mid.deadlinePoints).toBeLessThan(AUTONOMOUS_RANKING_POLICY.deadline.points)
    })

    it('returns zero for a non-positive deadline', () => {
      const zero = scoreIntention(intention({ deadlineAt: 0 }), AUTONOMOUS_RANKING_POLICY, NOW)
      const neg = scoreIntention(intention({ deadlineAt: -5 }), AUTONOMOUS_RANKING_POLICY, NOW)
      expect(zero.deadlinePoints).toBe(0)
      expect(neg.deadlinePoints).toBe(0)
    })
  })

  describe('relationship intensity', () => {
    it('only scores affect-carrying kinds', () => {
      const grievance = scoreIntention(intention({ kind: 'relationship-grievance', intensity: 1 }), AUTONOMOUS_RANKING_POLICY, NOW)
      const thread = scoreIntention(intention({ kind: 'continuity-thread', intensity: 1 }), AUTONOMOUS_RANKING_POLICY, NOW)

      expect(grievance.intensityPoints).toBeCloseTo(AUTONOMOUS_RANKING_POLICY.intensity, 6)
      expect(thread.intensityPoints).toBe(0)
    })

    it('clamps out-of-range intensity instead of escaping the 0..1 scale', () => {
      const hot = scoreIntention(intention({ kind: 'relationship-anchor', intensity: 42 }), AUTONOMOUS_RANKING_POLICY, NOW)
      const cold = scoreIntention(intention({ kind: 'relationship-anchor', intensity: -7 }), AUTONOMOUS_RANKING_POLICY, NOW)

      expect(hot.intensityPoints).toBeCloseTo(AUTONOMOUS_RANKING_POLICY.intensity, 6)
      expect(cold.intensityPoints).toBe(0)
    })

    it('defaults a missing intensity to neutral rather than to zero', () => {
      const neutral = scoreIntention(intention({ kind: 'relationship-anchor' }), AUTONOMOUS_RANKING_POLICY, NOW)
      expect(neutral.intensityPoints).toBeCloseTo(AUTONOMOUS_RANKING_POLICY.intensity * 0.5, 6)
    })

    it('bounds intensity below deadline weight so warmth never beats a commitment', () => {
      const anchor = scoreIntention(intention({ kind: 'relationship-anchor', intensity: 1 }), AUTONOMOUS_RANKING_POLICY, NOW)
      const deadline = scoreIntention(intention({ deadlineAt: NOW + HOUR }), AUTONOMOUS_RANKING_POLICY, NOW)

      expect(anchor.intensityPoints).toBeLessThan(deadline.deadlinePoints)
    })

    it('yields zero intensity when the policy intensity is non-finite', () => {
      const policy: IntentionRankingPolicy = { ...AUTONOMOUS_RANKING_POLICY, intensity: Number.NaN }
      const score = scoreIntention(intention({ kind: 'relationship-anchor', intensity: 0.5 }), policy, NOW)
      expect(score.intensityPoints).toBe(0)
    })
  })

    it('defaults a missing intensity to neutral rather than to zero', () => {
      const neutral = scoreIntention(intention({ kind: 'relationship-anchor' }), AUTONOMOUS_RANKING_POLICY, NOW)
      expect(neutral.intensityPoints).toBeCloseTo(AUTONOMOUS_RANKING_POLICY.intensity * 0.5, 6)
    })

    it('bounds intensity below deadline weight so warmth never beats a commitment', () => {
      const anchor = scoreIntention(intention({ kind: 'relationship-anchor', intensity: 1 }), AUTONOMOUS_RANKING_POLICY, NOW)
      const deadline = scoreIntention(intention({ deadlineAt: NOW + HOUR }), AUTONOMOUS_RANKING_POLICY, NOW)

      expect(anchor.intensityPoints).toBeLessThan(deadline.deadlinePoints)
    })
  })

  describe('diversity multiplier', () => {
    it('keeps the best representative of a kind at full score', () => {
      const ranked = rankIntentions([
        intention({ id: 'chip-a', pillar: 'echo-chips', kind: 'relationship-anchor', intensity: 1 }),
        intention({ id: 'chip-b', pillar: 'echo-chips', kind: 'relationship-anchor', intensity: 1 }),
      ], AUTONOMOUS_RANKING_POLICY, NOW)

      expect(ranked[0].score.diversityMultiplier).toBe(1)
      expect(ranked[1].score.diversityMultiplier).toBeCloseTo(0.5, 6)
    })

    it('halves again for each further duplicate', () => {
      const ranked = rankIntentions([
        intention({ id: 'a', pillar: 'echo-chips', kind: 'relationship-anchor' }),
        intention({ id: 'b', pillar: 'echo-chips', kind: 'relationship-anchor' }),
        intention({ id: 'c', pillar: 'echo-chips', kind: 'relationship-anchor' }),
      ], AUTONOMOUS_RANKING_POLICY, NOW)

      expect(ranked[0].score.diversityMultiplier).toBe(1)
      expect(ranked[1].score.diversityMultiplier).toBeCloseTo(0.5, 6)
      expect(ranked[2].score.diversityMultiplier).toBeCloseTo(0.25, 6)
    })

    it('does not penalise a different kind', () => {
      const ranked = rankIntentions([
        intention({ id: 'anchor', pillar: 'echo-chips', kind: 'relationship-anchor' }),
        intention({ id: 'deadline', pillar: 'event-log', kind: 'goal-deadline', deadlineAt: NOW + HOUR }),
      ], AUTONOMOUS_RANKING_POLICY, NOW)

      for (const entry of ranked)
        expect(entry.score.diversityMultiplier).toBe(1)
    })
  })

  describe('determinism', () => {
    it('breaks ties by newest memory', () => {
      const ranked = rankIntentions([
        intention({ id: 'older', memoryCreatedAt: NOW - 10 * DAY }),
        intention({ id: 'newer', memoryCreatedAt: NOW - 1 * DAY }),
      ], AUTONOMOUS_RANKING_POLICY, NOW)

      expect(ranked[0].intention.id).toBe('newer')
    })

    it('breaks remaining ties by id so repeated runs agree', () => {
      const first = rankIntentions([
        intention({ id: 'b', memoryCreatedAt: NOW }),
        intention({ id: 'a', memoryCreatedAt: NOW }),
      ], AUTONOMOUS_RANKING_POLICY, NOW)
      const second = rankIntentions([
        intention({ id: 'b', memoryCreatedAt: NOW }),
        intention({ id: 'a', memoryCreatedAt: NOW }),
      ], AUTONOMOUS_RANKING_POLICY, NOW)

      expect(first.map(entry => entry.intention.id)).toEqual(['a', 'b'])
      expect(second.map(entry => entry.intention.id)).toEqual(['a', 'b'])
    })

    it('returns an empty list for an empty pool', () => {
      expect(rankIntentions([], AUTONOMOUS_RANKING_POLICY, NOW)).toEqual([])
      expect(topScore([])).toBe(0)
    })
  })

  describe('score bounds', () => {
    it('never exceeds 1.0 for a maximally-weighted intention', () => {
      const max = scoreIntention(intention({
        pillar: 'lifetime',
        kind: 'relationship-anchor',
        intensity: 1,
        memoryCreatedAt: NOW,
        deadlineAt: NOW + HOUR,
      }), AUTONOMOUS_RANKING_POLICY, NOW)

      expect(max.total).toBeLessThanOrEqual(1)
      expect(max.total).toBeGreaterThan(0.9)
    })

    it('stays non-negative for a maximally-aged, deadline-free intention', () => {
      const ancient = scoreIntention(intention({ memoryCreatedAt: 0 }), AUTONOMOUS_RANKING_POLICY, NOW)
      expect(ancient.total).toBeGreaterThanOrEqual(0)
    })
  })
})
