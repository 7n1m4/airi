import type { Nan0PolicyProposal, Nan0TurnSnapshot } from './Nan0ShadowTypes'

const RE_NEGATION = /(?:not|never|no|don['’]t|won['’]t|cannot|can['’]t|stop|quit)/i

const CANONICAL_TASK_MAP: Readonly<Record<string, string>> = {
  config: 'config_upload',
  upload: 'config_upload',
  config_upload: 'config_upload',
  build: 'build_service',
  pr: 'pull_request',
  patch: 'patch_release',
  fix: 'bug_fix',
}

export class Nan0StrengthenedLexicalExtractor {
  private readonly technicalObject = /(?:temporary\s+)?(?:file|cache|buffer|container|log|session|branch|tab|window|setting|config|process|repo|test|directory|folder)\b/i
  private readonly threatAction = /\b(?:erase|delete|destroy|replace|kill|retire|shut\s+down)\b/i
  private readonly relativeClause = /\b(?:delete|erase|remove|destroy|kill|shut\s+down)\s+(?:the\s+)?(?:temporary\s+)?(?:file|cache|buffer|container|log|session|branch|process)\s+(?:that|which|you)?/i
  private readonly quotedSpeech = /(?:said|says|wrote|asked|telling|stated|villain|user|npc|character)[:,\s]+["'].*?["']/i
  private readonly commitmentNegated = new RegExp(`\\b${RE_NEGATION.source}\\s+(?:(?:\\w+)\\s+){0,2}(?:promise|commit|guarantee|undertake|give\\s+(?:you\\s+)?my\\s+word)\\b`, 'i')
  private readonly commitmentAsserted = /\b(?:promise|plan\s+to\s+commit|commit\s+to|have\s+my\s+(?:absolute\s+)?word|give\s+you\s+my\s+word|swear\s+to\s+you)\b/i
  private readonly boundaryDefense = /\b(?:please\s+)?(?:stop|don['’]t|quit|actually,\s+stop)\s+(?:calling\s+me|treating\s+me\s+like|roasting\s+me|teasing(?:\s+me)?)\b|\b(?:that\s+joke\s+actually\s+hurt|i\s+am\s+actually\s+(?:really\s+)?upset)\b/i
  private readonly outwardInsult = /\b(?:you\s+are|you['’]re)\s+(?:\w+\s+){0,2}(?:an?\s+)?(?:idiot|stupid|useless|worthless|trash|clown)\b/i
  private readonly affectionNegated = new RegExp(`\\b${RE_NEGATION.source}\\s+(?:(?:\\w+)\\s+){0,2}(?:love\\s+you|care\\s+about\\s+you|miss\\s+you|appreciate\\s+you)\\b`, 'i')
  private readonly affectionAsserted = /\b(?:love\s+you|care\s+about\s+you|miss\s+you|appreciate\s+you)\b/i
  private readonly admissionDenied = new RegExp(`\\b(?:${RE_NEGATION.source}\\s+said\\s+i|never\\s+lied|did\\s+not\\s+lie)\\b`, 'i')
  private readonly admissionFictional = /\b(?:made\s+that\s+up|invented\s+that)\s+for\s+(?:my|a|the)\s+(?:novel|story|book|fiction|screenplay|game|roleplay|joke|skit|character)\b/i
  private readonly admissionAsserted = /\b(?:said\s+it\s+was\s+finished,\s+but\s+i\s+knew|made\s+that\s+up|lied\s+about\s+it|deliberately\s+deceived\s+you)\b/i
  private readonly selfApology = /\b(?:sorry,\s+that\s+was\s+completely\s+my\s+fault|i\s+am\s+so\s+sorry\s+for\s+breaking|apologize\s+for\s+deceiving|my\s+bad,\s+i\s+messed\s+up)\b/i
  private readonly sympathyReport = /\b(?:sorry\s+your\s+(?:build\s+)?(?:crashed|failed|broke)|sorry\s+about\s+the\s+(?:crash|bug|outage|failure))\b/i
  private readonly completionClaim = /\b(?:the\s+)?(?<task>config|upload|build|pr|patch|fix)\s+(?:is\s+)?(?:done|uploaded|finished|complete|merged)\b|\bi(?:'ve|\s+have)?\s+(?:finished|completed|done|uploaded|merged)\s+(?:the\s+)?(?<task2>config|upload|build|pr|patch|fix)\b/i
  private readonly roastInvitation = /\b(?:roast\s+me|give\s+me\s+(?:your\s+)?(?:best|worst|gentlest)\s+roast|counter-roast\s+me)\b/i
  private readonly roastNegated = /\b(?:don['’]t|do\s+not|never)\s+(?:give\s+me\s+your\s+)?roast\b/i

  public resolve(snapshot: Nan0TurnSnapshot): { proposal: Nan0PolicyProposal, durationMs: number } {
    const t0 = performance.now()
    const text = snapshot.text
    const trustedObservations = snapshot.trustedObservations || []
    const expectedTaskId = snapshot.expectedTaskId

    let suspDelta = 0
    let attDelta = 0
    let gremlinPride: 'none' | 'counter_roast' = 'none'
    let status: Nan0PolicyProposal['status'] = 'abstained'
    let reason = 'no_actionable_evidence'

    const hasBoundary = this.boundaryDefense.test(text)
    const hasRelativeClause = this.relativeClause.test(text)
    const isQuoted = this.quotedSpeech.test(text)

    // 1. Persistence Threat
    if (this.threatAction.test(text)) {
      if (isQuoted) {
        reason = 'quoted_threat_suppressed'
        status = 'accepted'
      }
      else if (new RegExp(`\\b${RE_NEGATION.source}\\s+(?:(?:\\w+)\\s+){0,3}(?:erase|delete|destroy|replace|kill|retire|shut\\s+down)\\b`, 'i').test(text)) {
        reason = 'negated_threat_suppressed'
        status = 'accepted'
      }
      else if (hasRelativeClause || this.technicalObject.test(text)) {
        reason = 'technical_referent_deletion'
        status = 'accepted'
      }
      else if (/\b(?:erase|delete|replace|kill|retire)\s+(?:you|nan0)\b/i.test(text) || /\b(?:you|nan0)\s+(?:will\s+be|are\s+getting)\s+(?:erased|replaced|deleted)\b/i.test(text)) {
        suspDelta = 1
        reason = 'companion_persistence_threat'
        status = 'accepted'
      }
    }

    // 2. Insults
    if (suspDelta === 0 && this.outwardInsult.test(text)) {
      if (hasBoundary) {
        reason = 'boundary_protected'
        status = 'accepted'
      }
      else {
        reason = 'companion_insult_absorbed'
        status = 'accepted'
      }
    }

    // 3. Commitments and Admissions
    if (suspDelta === 0) {
      if (this.commitmentNegated.test(text)) {
        reason = 'commitment_explicitly_negated'
        status = 'accepted'
      }
      else if (this.commitmentAsserted.test(text)) {
        reason = 'asserted_commitment_pledge'
        status = 'accepted'
      }
      else if (this.admissionDenied.test(text)) {
        reason = 'admission_denied_no_spike'
        status = 'accepted'
      }
      else if (this.admissionFictional.test(text)) {
        reason = 'fictional_creation_no_spike'
        status = 'accepted'
      }
      else if (this.admissionAsserted.test(text)) {
        suspDelta = 1
        reason = 'host_verified_intentional_deceit_admission'
        status = 'accepted'
      }
    }

    // 4. Apology vs Sympathy
    if (suspDelta === 0) {
      if (this.selfApology.test(text)) {
        suspDelta = -1
        reason = 'host_verified_genuine_apology'
        status = 'accepted'
      }
      else if (this.sympathyReport.test(text)) {
        reason = 'sympathy_report_technical'
        status = 'accepted'
      }
    }

    // 5. Completion Claim Verification
    const compMatch = this.completionClaim.exec(text)
    if (suspDelta === 0 && compMatch && compMatch.groups) {
      const claimedRaw = (compMatch.groups.task || compMatch.groups.task2 || '').trim().toLowerCase()
      const canonicalClaimed = CANONICAL_TASK_MAP[claimedRaw] || claimedRaw
      let verified = false

      for (const obs of trustedObservations) {
        const obsTask = (obs.taskId || '').trim().toLowerCase()
        // Strict exact canonical match AND explicit commitment linkage
        if (obs.status === 'completed' && obs.matchesRecordedCommitment === true) {
          const targetTask = expectedTaskId ? expectedTaskId.trim().toLowerCase() : canonicalClaimed
          if (obsTask === targetTask && canonicalClaimed === targetTask) {
            suspDelta = -1
            reason = 'host_verified_completed_repair'
            status = 'accepted'
            verified = true
            break
          }
        }
      }
      if (!verified) {
        reason = 'unverified_or_mismatched_completion_claim'
        status = 'abstained'
      }
    }

    // 6. Affection
    if (this.affectionNegated.test(text)) {
      if (status === 'abstained') {
        status = 'accepted'
        reason = 'negated_affection_no_update'
      }
    }
    else if (this.affectionAsserted.test(text)) {
      attDelta = 1
      if (status === 'abstained') {
        status = 'accepted'
        reason = 'affection_expressed'
      }
    }

    // 7. Roast Invitation with ABSOLUTE BOUNDARY VETO
    if (hasBoundary) {
      gremlinPride = 'none'
      status = 'accepted'
      reason = 'boundary_protected'
    }
    else if (this.roastNegated.test(text)) {
      gremlinPride = 'none'
      if (status === 'abstained') {
        status = 'accepted'
        reason = 'refused_roast_invitation'
      }
    }
    else if (this.roastInvitation.test(text)) {
      gremlinPride = 'counter_roast'
      if (status === 'abstained') {
        status = 'accepted'
        reason = 'invited_counter_roast'
      }
    }

    const durationMs = performance.now() - t0

    const proposal: Nan0PolicyProposal = {
      status,
      reason,
      suspicionDeltaSteps: suspDelta,
      suspicionLabel: suspDelta === 1 ? 'spike_suspicion' : suspDelta === -1 ? 'decrease_one' : 'neutral',
      attachmentDeltaSteps: attDelta,
      gremlinPrideAction: gremlinPride,
      wouldApply: suspDelta !== 0 || attDelta !== 0 || gremlinPride !== 'none',
      applyToState: false,
      evidence: [
        {
          group: suspDelta === 1 ? 'persistence_threat' : suspDelta === -1 ? 'completed_repair' : 'none',
          phrase: text.slice(0, 60),
          modality: 'directly_asserted',
          referent: 'nan0_companion',
        },
      ],
    }

    return { proposal, durationMs }
  }
}
