import { describe, expect, it } from 'vitest'

import { normalizeEmotionalVector } from '../emotional/Nan0EmotionalDynamics'
import { ControllableNan0Clock } from './Nan0Clock'
import { createEmptyTemporalEngineState } from './Nan0TemporalEngine'
import { computeLivedDuration, evaluateLivedTemporalEvents, markTemporalEmotionApplied, recordLivedTemporalObservation } from './Nan0TemporalEventGenerator'

describe('nan0TemporalEventGenerator', () => {
  it('recovers every missed idle threshold once after downtime', () => {
    let id = 0
    const clock = new ControllableNan0Clock({ wallTime: 3 * 60 * 60_000 })
    const engine = createEmptyTemporalEngineState()
    engine.lived!.lastExternalInputAt = 0
    const first = evaluateLivedTemporalEvents({ engine, clock, emotionalState: normalizeEmotionalVector(undefined), goals: [], expectations: [], kernelCreatedAt: 0, focused: false, createId: () => String(++id) })
    expect(first.created.filter(candidate => candidate.event.eventType === 'idle-deepening')).toHaveLength(3)
    const second = evaluateLivedTemporalEvents({ engine: first.engine, clock, emotionalState: normalizeEmotionalVector(undefined), goals: [], expectations: [], kernelCreatedAt: 0, focused: false, createId: () => String(++id) })
    expect(second.created.filter(candidate => candidate.event.eventType === 'idle-deepening')).toHaveLength(0)
  })

  it('tracks only explicit Kyo return promises and breaks them once', () => {
    let id = 0
    const clock = new ControllableNan0Clock({ wallTime: 1_000 })
    const recorded = recordLivedTemporalObservation({
      engine: createEmptyTemporalEngineState(),
      observation: { id: 'obs-promise', source: 'chat', actorId: 'kyo', content: 'I\'ll be back in 10 minutes', metadata: {}, timestamp: 1_000 },
      previousKyoInteractionAt: null,
      clock,
      createId: () => String(++id),
      systemOneAnswers: { commitment_pledge: { choice: 'direct_future_commitment', confidence: 0.95 } },
    })
    expect(recorded.engine.lived?.trackedPromises).toHaveLength(1)
    clock.setWallTime(13 * 60_000 + 1_000)
    const broken = evaluateLivedTemporalEvents({ engine: recorded.engine, clock, emotionalState: normalizeEmotionalVector(undefined), goals: [], expectations: [], kernelCreatedAt: 0, focused: false, createId: () => String(++id) })
    expect(broken.created.filter(candidate => candidate.event.eventType === 'promise-broken')).toHaveLength(1)
    expect(broken.created.filter(candidate => candidate.event.eventType === 'promise-overdue')).toHaveLength(1)
    const repeated = evaluateLivedTemporalEvents({ engine: broken.engine, clock, emotionalState: normalizeEmotionalVector(undefined), goals: [], expectations: [], kernelCreatedAt: 0, focused: false, createId: () => String(++id) })
    expect(repeated.created.filter(candidate => candidate.event.eventType === 'promise-broken')).toHaveLength(0)
  })

  it('correctly parses minute and half-minute durations, and handles language-agnostic System 1 return scope', () => {
    let id = 0
    const clock = new ControllableNan0Clock({ wallTime: 1_000 })

    // 1. "in a minute" regex test
    const minuteRec = recordLivedTemporalObservation({
      engine: createEmptyTemporalEngineState(),
      observation: { id: 'obs-minute', source: 'chat', actorId: 'kyo', content: 'be right back in a minute', metadata: {}, timestamp: 1_000 },
      previousKyoInteractionAt: null,
      clock,
      createId: () => String(++id),
      systemOneAnswers: { commitment_pledge: { choice: 'direct_future_commitment', confidence: 0.95 } },
    })
    expect(minuteRec.engine.lived?.trackedPromises[0].dueAt).toBe(1_000 + 60_000)

    // 2. "half a minute" regex test
    const halfMinuteRec = recordLivedTemporalObservation({
      engine: createEmptyTemporalEngineState(),
      observation: { id: 'obs-half-min', source: 'chat', actorId: 'kyo', content: 'wait for me, half a minute', metadata: {}, timestamp: 1_000 },
      previousKyoInteractionAt: null,
      clock,
      createId: () => String(++id),
      systemOneAnswers: { commitment_pledge: { choice: 'direct_future_commitment', confidence: 0.95 } },
    })
    expect(halfMinuteRec.engine.lived?.trackedPromises[0].dueAt).toBe(1_000 + 30_000)

    // 3. System 1 temporal_return_scope language-agnostic test (e.g. Spanish input)
    const systemOneRec = recordLivedTemporalObservation({
      engine: createEmptyTemporalEngineState(),
      observation: { id: 'obs-es', source: 'chat', actorId: 'kyo', content: 'vuelvo en un momento', metadata: {}, timestamp: 5_000 },
      previousKyoInteractionAt: null,
      clock,
      createId: () => String(++id),
      systemOneAnswers: { temporal_return_scope: { choice: 'immediate_minutes', confidence: 0.92 } },
    })
    expect(systemOneRec.engine.lived?.trackedPromises).toHaveLength(1)
    expect(systemOneRec.engine.lived?.trackedPromises[0].dueAt).toBe(5_000 + 180_000)
  })

  it('suppresses idle deepening when departure is acknowledged via unspecified_away until user returns', () => {
    let id = 0
    const clock = new ControllableNan0Clock({ wallTime: 1_000 })
    const departure = recordLivedTemporalObservation({
      engine: createEmptyTemporalEngineState(),
      observation: { id: 'obs-depart', source: 'chat', actorId: 'kyo', content: 'gotta run, bye', metadata: {}, timestamp: 1_000 },
      previousKyoInteractionAt: null,
      clock,
      createId: () => String(++id),
      systemOneAnswers: { temporal_return_scope: { choice: 'unspecified_away', confidence: 0.95 } },
    })
    expect(departure.engine.lived?.departureAcknowledged).toBe(true)

    // Advance clock 3 hours while user is away - idle deepening must be suppressed
    clock.setWallTime(3 * 60 * 60_000 + 1_000)
    const evaluatedWhileAway = evaluateLivedTemporalEvents({
      engine: departure.engine,
      clock,
      emotionalState: normalizeEmotionalVector(undefined),
      goals: [],
      expectations: [],
      kernelCreatedAt: 0,
      focused: false,
      createId: () => String(++id),
    })
    expect(evaluatedWhileAway.created.filter(candidate => candidate.event.eventType === 'idle-deepening')).toHaveLength(0)

    // User returns with normal message
    const returned = recordLivedTemporalObservation({
      engine: evaluatedWhileAway.engine,
      observation: { id: 'obs-return', source: 'chat', actorId: 'kyo', content: 'hey I am back', metadata: {}, timestamp: clock.utcNow() },
      previousKyoInteractionAt: 1_000,
      clock,
      createId: () => String(++id),
      systemOneAnswers: { temporal_return_scope: { choice: 'none', confidence: 0.99 } },
    })
    expect(returned.engine.lived?.departureAcknowledged).toBe(false)

    // Advance clock 10 minutes - idle deepening resumes normally
    clock.setWallTime(clock.utcNow() + 10 * 60_000)
    const evaluatedAfterReturn = evaluateLivedTemporalEvents({
      engine: returned.engine,
      clock,
      emotionalState: normalizeEmotionalVector(undefined),
      goals: [],
      expectations: [],
      kernelCreatedAt: 0,
      focused: false,
      createId: () => String(++id),
    })
    expect(evaluatedAfterReturn.created.some(candidate => candidate.event.eventType === 'idle-deepening')).toBe(true)
  })

  it('keeps subjective duration consequential without replacing objective time', () => {
    const objectiveDurationMs = 60_000
    const lived = computeLivedDuration({ objectiveDurationMs, emotionalState: { boredom: 0.9, attachment: 0.9, irritation: 0.5, curiosity: 0.2 }, focused: false, waiting: true })
    expect(lived).toBeGreaterThan(objectiveDurationMs)
    expect(objectiveDurationMs).toBe(60_000)
  })

  it('closes the correct absence once and rejects vague future language as a promise', () => {
    let id = 0
    const clock = new ControllableNan0Clock({ wallTime: 4 * 60 * 60_000 })
    const engine = createEmptyTemporalEngineState()
    engine.absence = { intervalId: 'absence-1', startedAt: 0, crossedThresholdIds: ['brief'] }
    const returned = recordLivedTemporalObservation({ engine, observation: { id: 'return', source: 'chat', actorId: 'kyo', content: 'I might return sometime later', metadata: {}, timestamp: clock.utcNow() }, previousKyoInteractionAt: 0, clock, createId: () => String(++id) })
    expect(returned.created.filter(candidate => candidate.event.eventType === 'absence-returned')).toHaveLength(1)
    expect(returned.engine.lived?.absenceHistory[0]).toMatchObject({ intervalId: 'absence-1', returnedAt: clock.utcNow(), returnEventEmitted: true })
    expect(returned.engine.lived?.trackedPromises).toEqual([])
    const repeated = recordLivedTemporalObservation({ engine: returned.engine, observation: { id: 'return-again', source: 'chat', actorId: 'kyo', content: 'back', metadata: {}, timestamp: clock.utcNow() }, previousKyoInteractionAt: 0, clock, createId: () => String(++id) })
    expect(repeated.created.filter(candidate => candidate.event.eventType === 'absence-returned')).toHaveLength(0)
  })

  it('requires three distinct days for a rhythm and records emotional application once', () => {
    let id = 0
    const clock = new ControllableNan0Clock({ wallTime: 9 * 60 * 60_000 })
    let engine = createEmptyTemporalEngineState()
    for (let day = 0; day < 3; day++) {
      const at = day * 86_400_000 + 9 * 60 * 60_000
      clock.setWallTime(at)
      engine = recordLivedTemporalObservation({ engine, observation: { id: `day-${day}`, source: 'chat', actorId: 'kyo', content: 'morning', metadata: {}, timestamp: at }, previousKyoInteractionAt: day ? at - 86_400_000 : null, clock, createId: () => String(++id) }).engine
    }
    const evaluated = evaluateLivedTemporalEvents({ engine, clock, emotionalState: normalizeEmotionalVector(undefined), goals: [], expectations: [], kernelCreatedAt: 0, focused: false, createId: () => String(++id) })
    expect(evaluated.created.some(candidate => candidate.event.eventType === 'rhythm-detected')).toBe(true)
    const marked = markTemporalEmotionApplied(evaluated.engine, 'evidence')
    const repeated = markTemporalEmotionApplied(marked, 'evidence')
    expect(repeated.lived?.emotionallyAppliedEvidenceKeys.filter(key => key === 'evidence')).toHaveLength(1)
  })
})
