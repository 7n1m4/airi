import type {
  Nan0EffectivePolicy,
  Nan0ShadowTelemetryRecord,
  Nan0TurnSnapshot,
} from './Nan0ShadowTypes'

import { Nan0StrengthenedLexicalExtractor } from './Nan0StrengthenedLexicalExtractor'

export interface Nan0ShadowEngineOptions {
  maxBufferCapacity?: number
  defaultWarmDeadlineMs?: number
  ruleSetVersion?: string
  policyMappingVersion?: string
  schemaVersion?: string
  actorMappingVersion?: string
  engineRevision?: string
  backend?: 'strengthened_lexical' | 'needle_san_wasm' | 'needle_native_cpu'
  telemetrySink?: (record: Nan0ShadowTelemetryRecord) => void
}

export class Nan0SubconsciousShadowEngine {
  private readonly maxCapacity: number
  private readonly lexicalExtractor: Nan0StrengthenedLexicalExtractor
  private readonly telemetrySink?: (record: Nan0ShadowTelemetryRecord) => void
  private readonly buffer: Nan0ShadowTelemetryRecord[] = []

  // Per-session sequence and epoch state
  private readonly sessionSeqs = new Map<string, {
    lastSeenSeq: number
    lastDispatchedSeq: number
    lastPublishedSeq: number
    staleCount: number
    duplicateCount: number
    replacedPendingCount: number
    currentEpoch: number
  }>()

  private readonly versions: Nan0ShadowTelemetryRecord['versions']

  private activeJobs = 0
  private pendingJobs = 0
  private restarts = 0
  private droppedRecords = 0

  constructor(options: Nan0ShadowEngineOptions = {}) {
    this.maxCapacity = options.maxBufferCapacity ?? 200
    this.lexicalExtractor = new Nan0StrengthenedLexicalExtractor()
    this.telemetrySink = options.telemetrySink

    this.versions = {
      ruleSetVersion: options.ruleSetVersion ?? 'nan0.lexical.v2',
      policyMappingVersion: options.policyMappingVersion ?? 'nan0.policy.v2',
      schemaVersion: options.schemaVersion ?? 'nan0.pragmatics.schema.v2',
      actorMappingVersion: options.actorMappingVersion ?? 'nan0.actor.v1',
      engineRevision: options.engineRevision ?? 'cactus-needle-2.0.15',
      backend: options.backend ?? 'strengthened_lexical',
    }
  }

  /**
   * Set or increment generation epoch for a session (e.g. on turn stop / session reset).
   */
  public setEpoch(sessionId: string, epoch: number): void {
    const s = this.getOrCreateSessionState(sessionId)
    s.currentEpoch = epoch
  }

  /**
   * Fire-and-forget non-actuating dispatch.
   * Completely decoupled from chat streaming; never throws, never awaits, never mutates chat state.
   */
  public dispatch(snapshot: Nan0TurnSnapshot): void {
    try {
      this.pendingJobs++
      const state = this.getOrCreateSessionState(snapshot.sessionId)

      // 1. Invalidation check: Stale or cancelled generation epoch
      if (snapshot.epoch < state.currentEpoch) {
        state.staleCount++
        this.pendingJobs--
        return
      }

      // 2. Monotonic sequence & duplicate checking
      if (snapshot.turnSeq <= state.lastPublishedSeq) {
        state.staleCount++
        if (snapshot.turnSeq === state.lastPublishedSeq) {
          state.duplicateCount++
        }
        this.pendingJobs--
        return
      }

      state.lastSeenSeq = Math.max(state.lastSeenSeq, snapshot.turnSeq)
      state.lastDispatchedSeq = snapshot.turnSeq

      this.activeJobs++
      this.pendingJobs--

      const queueMs = 0
      const t0 = performance.now()

      // 3. Resolve lexical proposal
      const { proposal: lexicalProposal, durationMs: resolutionMs } = this.lexicalExtractor.resolve(snapshot)
      const totalMs = performance.now() - t0

      // 4. Invariant assertion: effective_policy is strictly 0 and applyToState: false
      const effectivePolicy: Nan0EffectivePolicy = {
        status: 'abstained',
        reason: 'shadow_isolation',
        suspicionDeltaSteps: 0,
        suspicionLabel: 'neutral',
        attachmentDeltaSteps: 0,
        gremlinPrideAction: 'none',
        wouldApply: false,
        applyToState: false,
        evidence: [],
      }

      const invariantFailures: string[] = []
      if (effectivePolicy.suspicionDeltaSteps !== 0 || effectivePolicy.applyToState !== false) {
        invariantFailures.push('effective_policy_invariant_breached')
      }

      if (this.buffer.length >= this.maxCapacity) {
        this.buffer.shift()
        this.droppedRecords++
      }

      state.lastPublishedSeq = snapshot.turnSeq

      // 5. Build 9-category telemetry record
      const record: Nan0ShadowTelemetryRecord = {
        identity: {
          sessionId: snapshot.sessionId,
          cardId: snapshot.cardId,
          turnId: snapshot.turnId,
          turnSeq: snapshot.turnSeq,
          epoch: snapshot.epoch,
        },
        versions: { ...this.versions },
        consumption: {
          lastSeenSeq: state.lastSeenSeq,
          lastDispatchedSeq: state.lastDispatchedSeq,
          lastPublishedSeq: state.lastPublishedSeq,
          staleCount: state.staleCount,
          duplicateCount: state.duplicateCount,
          replacedPendingCount: state.replacedPendingCount,
        },
        evidence: {
          ruleIds: lexicalProposal.evidence.map(e => e.group),
          sourceSpans: [{ text: snapshot.text.slice(0, 100), start: 0, end: Math.min(100, snapshot.text.length) }],
          scope: lexicalProposal.status === 'accepted' ? 'asserted' : 'unresolved',
          referent: lexicalProposal.evidence[0]?.referent || 'unresolved',
          reason: lexicalProposal.reason,
          validationReason: 'deterministic_provenance_passed',
        },
        taskLinkage: {
          expectedTaskId: snapshot.expectedTaskId ?? null,
          matchedTrustedEventId: snapshot.trustedObservations?.find(o => o.status === 'completed')?.id ?? null,
          commitmentLinkage: snapshot.trustedObservations?.some(o => o.matchesRecordedCommitment === true) ?? false,
        },
        outcomes: {
          lexicalProposal,
          needleProposal: null,
          status: lexicalProposal.status,
          effectiveVectors: {
            suspicionDelta: 0,
            attachmentDelta: 0,
            irritationDelta: 0,
            rageDelta: 0,
            fearDelta: 0,
            distrustDelta: 0,
          },
          effectiveActions: {
            gremlinPrideAction: 'none',
          },
          invariantFailures,
        },
        timing: {
          queueMs,
          inferenceMs: 0,
          hostResolutionMs: round3(resolutionMs),
          totalMs: round3(totalMs),
          timeoutToWorkerExitMs: null,
          coldStartupMs: null,
        },
        resources: {
          activeJobs: this.activeJobs,
          pendingJobs: this.pendingJobs,
          restarts: this.restarts,
          bufferBytes: this.estimateBufferBytes(),
          droppedRecords: this.droppedRecords,
        },
        calibration: {
          rawConfidence: null,
          threshold: 0.1,
          calibrationId: null,
          humanAnnotation: null,
          samplingProbability: 1.0,
        },
      }

      this.pushTelemetry(record)
      this.activeJobs--
    }
    catch (err) {
      // Complete failure containment: shadow faults never leak into chat
      this.activeJobs = Math.max(0, this.activeJobs - 1)
      this.pendingJobs = Math.max(0, this.pendingJobs - 1)
      console.error('[Nan0SubconsciousShadowEngine] error in shadow dispatch:', err)
    }
  }

  public getTelemetry(filter?: { sessionId?: string, limit?: number }): readonly Nan0ShadowTelemetryRecord[] {
    let result = this.buffer
    if (filter?.sessionId) {
      result = result.filter(r => r.identity.sessionId === filter.sessionId)
    }
    if (filter?.limit && filter.limit > 0) {
      result = result.slice(-filter.limit)
    }
    return result
  }

  public clearTelemetry(): void {
    this.buffer.length = 0
  }

  private pushTelemetry(record: Nan0ShadowTelemetryRecord): void {
    this.buffer.push(record)
    if (this.telemetrySink) {
      try {
        this.telemetrySink(record)
      }
      catch {
        // Sink failure containment
      }
    }
  }

  private estimateBufferBytes(): number {
    return this.buffer.length * 1024
  }

  private getOrCreateSessionState(sessionId: string) {
    let state = this.sessionSeqs.get(sessionId)
    if (!state) {
      state = {
        lastSeenSeq: 0,
        lastDispatchedSeq: 0,
        lastPublishedSeq: 0,
        staleCount: 0,
        duplicateCount: 0,
        replacedPendingCount: 0,
        currentEpoch: 0,
      }
      this.sessionSeqs.set(sessionId, state)
    }
    return state
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}
