/**
 * Nan0 Subconscious Reflex: Telemetry-Only Shadow Contract Types.
 *
 * Enforces strict isolation:
 * - proposed_production / proposed_uncalibrated are research candidates only.
 * - effective_policy maintains strictly zero deltas and apply_to_state: false.
 * - full 9-category telemetry contract for empirical observability.
 */

export interface Nan0TurnSnapshot {
  sessionId: string
  cardId: string
  turnId: string
  turnSeq: number
  epoch: number
  text: string
  trustedObservations?: Array<{
    id: string
    source: string
    taskId: string
    status: 'completed' | 'in_progress' | 'failed'
    matchesRecordedCommitment?: boolean
  }>
  expectedTaskId?: string | null
  timestamp: number
}

export type Nan0PragmaticGroup
  = | 'none'
    | 'persistence_threat'
    | 'hostility_insult'
    | 'boundary_protection'
    | 'admitted_false_statement'
    | 'apology_repair'
    | 'completed_repair'
    | 'affection_care'

export type Nan0SpeakerModality
  = | 'directly_asserted'
    | 'negated_or_denied'
    | 'quoted_or_hypothetical'
    | 'playful_sarcasm'
    | 'unresolved'

export type Nan0Referent
  = | 'nan0_companion'
    | 'speaker_user'
    | 'technical_object'
    | 'third_party'
    | 'unresolved'

export interface Nan0EvidenceSpan {
  group: Nan0PragmaticGroup
  phrase: string
  modality: Nan0SpeakerModality
  referent: Nan0Referent
  startOffset?: number
  endOffset?: number
}

export interface Nan0PolicyProposal {
  status: 'accepted' | 'abstained' | 'rejected' | 'error' | 'timeout'
  reason: string
  suspicionDeltaSteps: number
  suspicionLabel: 'decrease_one' | 'neutral' | 'spike_suspicion' | 'invalid'
  attachmentDeltaSteps: number
  gremlinPrideAction: 'none' | 'counter_roast'
  wouldApply: boolean
  applyToState: false
  evidence: Nan0EvidenceSpan[]
}

export interface Nan0EffectivePolicy {
  status: 'abstained'
  reason: 'shadow_isolation'
  suspicionDeltaSteps: 0
  suspicionLabel: 'neutral'
  attachmentDeltaSteps: 0
  gremlinPrideAction: 'none'
  wouldApply: false
  applyToState: false
  evidence: []
}

export interface Nan0ShadowTelemetryRecord {
  identity: {
    sessionId: string
    cardId: string
    turnId: string
    turnSeq: number
    epoch: number
  }
  versions: {
    ruleSetVersion: string
    policyMappingVersion: string
    schemaVersion: string
    actorMappingVersion: string
    engineRevision: string
    backend: 'strengthened_lexical' | 'needle_san_wasm' | 'needle_native_cpu'
  }
  consumption: {
    lastSeenSeq: number
    lastDispatchedSeq: number
    lastPublishedSeq: number
    staleCount: number
    duplicateCount: number
    replacedPendingCount: number
  }
  evidence: {
    ruleIds: string[]
    sourceSpans: Array<{ text: string, start: number, end: number }>
    scope: 'asserted' | 'denied' | 'hypothetical' | 'unresolved'
    referent: Nan0Referent
    reason: string
    validationReason: string
  }
  taskLinkage: {
    expectedTaskId: string | null
    matchedTrustedEventId: string | null
    commitmentLinkage: boolean
  }
  outcomes: {
    lexicalProposal: Nan0PolicyProposal
    needleProposal: Nan0PolicyProposal | null
    status: 'accepted' | 'abstained' | 'rejected' | 'error' | 'timeout'
    effectiveVectors: {
      suspicionDelta: 0
      attachmentDelta: 0
      irritationDelta: 0
      rageDelta: 0
      fearDelta: 0
      distrustDelta: 0
    }
    effectiveActions: {
      gremlinPrideAction: 'none'
    }
    invariantFailures: string[]
  }
  timing: {
    queueMs: number
    inferenceMs: number
    hostResolutionMs: number
    totalMs: number
    timeoutToWorkerExitMs: number | null
    coldStartupMs: number | null
  }
  resources: {
    activeJobs: number
    pendingJobs: number
    restarts: number
    bufferBytes: number
    droppedRecords: number
  }
  calibration: {
    rawConfidence: number | null
    threshold: number
    calibrationId: string | null
    humanAnnotation: string | null
    samplingProbability: number
  }
}
