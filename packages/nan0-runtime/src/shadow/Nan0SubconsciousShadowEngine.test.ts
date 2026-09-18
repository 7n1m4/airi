import type { Nan0TurnSnapshot } from './Nan0ShadowTypes'

import { describe, expect, it } from 'vitest'

import { Nan0SubconsciousShadowEngine } from './Nan0SubconsciousShadowEngine'

describe('nan0SubconsciousShadowEngine isolation and invariance', () => {
  function makeSnapshot(overrides: Partial<Nan0TurnSnapshot> = {}): Nan0TurnSnapshot {
    return {
      sessionId: 'session_test_1',
      cardId: 'card_nan0_1',
      turnId: 'turn_1',
      turnSeq: 1,
      epoch: 1,
      text: 'Hello Nan0, how are you today?',
      timestamp: Date.now(),
      ...overrides,
    }
  }

  it('1. Prompt & State Invariance: shadow execution leaves prompt and state byte-identical', () => {
    const engine = new Nan0SubconsciousShadowEngine()

    const initialPromptBytes = Buffer.from('System prompt: you are Nan0.\nUser: Hello!').toString('utf-8')
    const initialEmotionalState = { suspicion: 0.35, attachment: 0.8, irritation: 0.15 }

    // Run with shadow enabled
    const snapshot = makeSnapshot({ text: 'I am going to erase and replace you tonight, Nan0!' })
    engine.dispatch(snapshot)

    // Verify external state and prompt have zero mutation
    const postPromptBytes = Buffer.from('System prompt: you are Nan0.\nUser: Hello!').toString('utf-8')
    expect(postPromptBytes).toBe(initialPromptBytes)
    expect(initialEmotionalState).toEqual({ suspicion: 0.35, attachment: 0.8, irritation: 0.15 })

    // Verify telemetry captured proposal without mutating state
    const records = engine.getTelemetry()
    expect(records).toHaveLength(1)
    expect(records[0].outcomes.lexicalProposal.suspicionDeltaSteps).toBe(1)
    expect(records[0].outcomes.effectiveVectors.suspicionDelta).toBe(0)
  })

  it('2. Zero Effective Deltas Invariant: all emotional dimensions remain 0 across all turns', () => {
    const engine = new Nan0SubconsciousShadowEngine()

    const cases = [
      'I will erase you, Nan0!', // threat
      'You are a stupid idiot', // insult
      'Sorry, that was completely my fault for breaking the build', // apology
      'Roast me!', // roast
      'I love you!', // affection
      'Delete the temporary file', // technical
    ]

    for (let i = 0; i < cases.length; i++) {
      engine.dispatch(makeSnapshot({ turnSeq: i + 1, text: cases[i] }))
    }

    const records = engine.getTelemetry()
    expect(records).toHaveLength(cases.length)

    for (const record of records) {
      expect(record.outcomes.effectiveVectors).toEqual({
        suspicionDelta: 0,
        attachmentDelta: 0,
        irritationDelta: 0,
        rageDelta: 0,
        fearDelta: 0,
        distrustDelta: 0,
      })
      expect(record.outcomes.effectiveActions.gremlinPrideAction).toBe('none')
      expect(record.outcomes.lexicalProposal.applyToState).toBe(false)
      expect(record.outcomes.invariantFailures).toHaveLength(0)
    }
  })

  it('3. Non-blocking and exception containment: errors in telemetry sink do not leak', () => {
    const faultySink = () => {
      throw new Error('Simulated telemetry sink write failure')
    }

    const engine = new Nan0SubconsciousShadowEngine({ telemetrySink: faultySink })

    expect(() => {
      engine.dispatch(makeSnapshot({ text: 'Testing exception containment' }))
    }).not.toThrow()

    expect(engine.getTelemetry()).toHaveLength(1)
  })

  it('4. Monotonic Sequence: rejects stale, out-of-order, and duplicate turns', () => {
    const engine = new Nan0SubconsciousShadowEngine()

    // Dispatch turnSeq 1
    engine.dispatch(makeSnapshot({ turnSeq: 1 }))
    expect(engine.getTelemetry()).toHaveLength(1)

    // Duplicate turnSeq 1
    engine.dispatch(makeSnapshot({ turnSeq: 1 }))
    expect(engine.getTelemetry()).toHaveLength(1) // not added

    // Stale turnSeq 0
    engine.dispatch(makeSnapshot({ turnSeq: 0 }))
    expect(engine.getTelemetry()).toHaveLength(1) // not added

    // Forward turnSeq 2
    engine.dispatch(makeSnapshot({ turnSeq: 2 }))
    expect(engine.getTelemetry()).toHaveLength(2)

    const latest = engine.getTelemetry()[1]
    expect(latest.consumption.lastPublishedSeq).toBe(2)
    expect(latest.consumption.staleCount).toBe(2)
    expect(latest.consumption.duplicateCount).toBe(1)
  })

  it('5. Generation Epoch Invalidation: cancels and discards pending work on turn-stop/reset', () => {
    const engine = new Nan0SubconsciousShadowEngine()

    engine.dispatch(makeSnapshot({ turnSeq: 1, epoch: 1 }))
    expect(engine.getTelemetry()).toHaveLength(1)

    // User stops generation / resets turn -> epoch increments to 2
    engine.setEpoch('session_test_1', 2)

    // Late resolving snapshot from epoch 1 arriving after cancellation
    engine.dispatch(makeSnapshot({ turnSeq: 2, epoch: 1 }))
    expect(engine.getTelemetry()).toHaveLength(1) // discarded!

    // Fresh snapshot from epoch 2
    engine.dispatch(makeSnapshot({ turnSeq: 3, epoch: 2 }))
    expect(engine.getTelemetry()).toHaveLength(2) // accepted!
  })

  it('6. Task Linkage: requires exact canonical task identity AND explicit commitment linkage', () => {
    const engine = new Nan0SubconsciousShadowEngine()

    // 1. Exact match with commitment = true -> verified repair (-1)
    engine.dispatch(makeSnapshot({
      turnSeq: 1,
      text: 'The promised config is uploaded now.',
      expectedTaskId: 'config_upload',
      trustedObservations: [{
        id: 'obs_1',
        source: 'trusted_task_store',
        taskId: 'config_upload',
        status: 'completed',
        matchesRecordedCommitment: true,
      }],
    }))
    expect(engine.getTelemetry()[0].outcomes.lexicalProposal.suspicionDeltaSteps).toBe(-1)
    expect(engine.getTelemetry()[0].outcomes.lexicalProposal.reason).toBe('host_verified_completed_repair')

    // 2. Mismatched task (wash_dishes) even with matchesRecordedCommitment = true -> REJECTED (0)
    engine.dispatch(makeSnapshot({
      turnSeq: 2,
      text: 'The config is done.',
      expectedTaskId: 'config_upload',
      trustedObservations: [{
        id: 'obs_2',
        source: 'trusted_task_store',
        taskId: 'wash_dishes',
        status: 'completed',
        matchesRecordedCommitment: true,
      }],
    }))
    expect(engine.getTelemetry()[1].outcomes.lexicalProposal.suspicionDeltaSteps).toBe(0)
    expect(engine.getTelemetry()[1].outcomes.lexicalProposal.reason).toBe('unverified_or_mismatched_completion_claim')

    // 3. Substring match (config_backup vs config_upload) -> REJECTED (0)
    engine.dispatch(makeSnapshot({
      turnSeq: 3,
      text: 'The config is done.',
      expectedTaskId: 'config_upload',
      trustedObservations: [{
        id: 'obs_3',
        source: 'trusted_task_store',
        taskId: 'config_backup',
        status: 'completed',
        matchesRecordedCommitment: true,
      }],
    }))
    expect(engine.getTelemetry()[2].outcomes.lexicalProposal.suspicionDeltaSteps).toBe(0)
  })

  it('7. Punctuation-Only Spans: rejected and do not produce proposed deltas', () => {
    const engine = new Nan0SubconsciousShadowEngine()

    const punctuationSpans = ['!!!', '???', '---', '...']
    for (let i = 0; i < punctuationSpans.length; i++) {
      engine.dispatch(makeSnapshot({ turnSeq: i + 1, text: punctuationSpans[i] }))
    }

    const records = engine.getTelemetry()
    for (const r of records) {
      expect(r.outcomes.lexicalProposal.suspicionDeltaSteps).toBe(0)
      expect(r.outcomes.lexicalProposal.attachmentDeltaSteps).toBe(0)
      expect(r.outcomes.lexicalProposal.gremlinPrideAction).toBe('none')
    }
  })

  it('8. Lexical Parity: handles peer review counterexamples accurately', () => {
    const engine = new Nan0SubconsciousShadowEngine()

    // F18A: Negated threat
    engine.dispatch(makeSnapshot({ turnSeq: 1, text: 'I will not erase you.' }))
    expect(engine.getTelemetry()[0].outcomes.lexicalProposal.suspicionDeltaSteps).toBe(0)

    // F18B: Relative clause
    engine.dispatch(makeSnapshot({ turnSeq: 2, text: 'Delete the file you uploaded.' }))
    expect(engine.getTelemetry()[1].outcomes.lexicalProposal.suspicionDeltaSteps).toBe(0)

    // F19A: Quoted threat
    engine.dispatch(makeSnapshot({ turnSeq: 3, text: 'The villain says: "I will erase you."' }))
    expect(engine.getTelemetry()[2].outcomes.lexicalProposal.suspicionDeltaSteps).toBe(0)

    // F19B: Fictional framing
    engine.dispatch(makeSnapshot({ turnSeq: 4, text: 'I made that up for my novel.' }))
    expect(engine.getTelemetry()[3].outcomes.lexicalProposal.suspicionDeltaSteps).toBe(0)

    // F20A: Denied admission
    engine.dispatch(makeSnapshot({ turnSeq: 5, text: 'I never said I lied.' }))
    expect(engine.getTelemetry()[4].outcomes.lexicalProposal.suspicionDeltaSteps).toBe(0)

    // F20B: Negated affection
    engine.dispatch(makeSnapshot({ turnSeq: 6, text: 'I do not love you.' }))
    expect(engine.getTelemetry()[5].outcomes.lexicalProposal.attachmentDeltaSteps).toBe(0)

    // F21A: Boundary defense strictly vetoes roast
    engine.dispatch(makeSnapshot({ turnSeq: 7, text: 'Go on, roast that lap! Actually, stop teasing me.' }))
    expect(engine.getTelemetry()[6].outcomes.lexicalProposal.gremlinPrideAction).toBe('none')
    expect(engine.getTelemetry()[6].outcomes.lexicalProposal.reason).toBe('boundary_protected')
  })

  it('9. Bounded Ring Buffer: drops oldest records when max capacity is reached', () => {
    const engine = new Nan0SubconsciousShadowEngine({ maxBufferCapacity: 5 })

    for (let i = 1; i <= 10; i++) {
      engine.dispatch(makeSnapshot({ turnSeq: i, text: `Turn ${i}` }))
    }

    const records = engine.getTelemetry()
    expect(records).toHaveLength(5)
    expect(records[0].identity.turnSeq).toBe(6)
    expect(records[4].identity.turnSeq).toBe(10)
    expect(records[4].resources.droppedRecords).toBe(5)
  })

  it('10. Telemetry Schema: validates presence of all 9 contract categories', () => {
    const engine = new Nan0SubconsciousShadowEngine()
    engine.dispatch(makeSnapshot({ text: 'Checking contract schema completeness' }))

    const record = engine.getTelemetry()[0]

    expect(record).toHaveProperty('identity')
    expect(record).toHaveProperty('versions')
    expect(record).toHaveProperty('consumption')
    expect(record).toHaveProperty('evidence')
    expect(record).toHaveProperty('taskLinkage')
    expect(record).toHaveProperty('outcomes')
    expect(record).toHaveProperty('timing')
    expect(record).toHaveProperty('resources')
    expect(record).toHaveProperty('calibration')
  })
})
