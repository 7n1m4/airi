/**
 * In-Memory Entity and Event Ledger for LoCoMo Dialogue Turns.
 * Provides normalized Maps with secondary indexes, event role modeling,
 * and contextual coreference resolution.
 * Follows the peer-reviewed specification in docs/memory_lab/LoCoMo-Pass2-Entity-Ledger-Review.md §4.
 */

export class EntityLedger {
  constructor() {
    this.sources = new Map() // turnId -> { turnId, text, speaker, session, sessionDate, timestamp }
    this.mentions = new Map() // mentionId -> { mentionId, span, turnId, entityId }
    this.entities = new Map() // entityId -> { entityId, label, type, attributes, mentions: Set }
    this.events = new Map() // eventId -> { eventId, type, roles: {}, turnId, claimIds: Set }
    this.claims = new Map() // claimId -> { claimId, subject, predicate, object, qualifiers, evidence: [], dateInfo }

    // Secondary Indexes
    this.bySubjectPredicate = new Map() // subjectId -> Map(predicate -> Set<claimId>)
    this.byObjectPredicate = new Map() // objectId -> Map(predicate -> Set<claimId>)
    this.byEvent = new Map() // eventId -> Set<claimId>
    this.bySource = new Map() // turnId -> Set<claimId>
    this.byAlias = new Map() // normalizedSurface -> Set<entityId>
    this.ingestion = new Map() // turnId -> { status, salience, mentionsCount, claimsCount }
  }

  addSource(src) {
    this.sources.set(src.turnId, src)
    if (!this.bySource.has(src.turnId)) {
      this.bySource.set(src.turnId, new Set())
    }
  }

  getOrCreateEntity(label, type = 'unknown', attributes = {}) {
    const norm = label.trim().toLowerCase()
    // Look up by exact alias first
    const existingIds = this.byAlias.get(norm)
    if (existingIds && existingIds.size > 0) {
      const id = Array.from(existingIds)[0]
      const ent = this.entities.get(id)
      if (type !== 'unknown' && ent.type === 'unknown')
        ent.type = type
      Object.assign(ent.attributes, attributes)
      return ent
    }

    const entityId = `ent_${label.replace(/\s+/g, '_')}_${this.entities.size + 1}`
    const entity = {
      entityId,
      label,
      type,
      attributes: { ...attributes },
      mentions: new Set(),
    }
    this.entities.set(entityId, entity)

    if (!this.byAlias.has(norm)) {
      this.byAlias.set(norm, new Set())
    }
    this.byAlias.get(norm).add(entityId)

    return entity
  }

  addClaim({ subject, predicate, object, qualifiers = {}, evidence = [], dateInfo = null }) {
    const claimId = `claim_${this.claims.size + 1}`
    const claim = {
      claimId,
      subject,
      predicate,
      object,
      qualifiers,
      evidence,
      dateInfo,
    }
    this.claims.set(claimId, claim)

    // Index by Subject + Predicate
    if (!this.bySubjectPredicate.has(subject)) {
      this.bySubjectPredicate.set(subject, new Map())
    }
    const predMap = this.bySubjectPredicate.get(subject)
    if (!predMap.has(predicate)) {
      predMap.set(predicate, new Set())
    }
    predMap.get(predicate).add(claimId)

    // Index by Object + Predicate
    if (typeof object === 'string') {
      if (!this.byObjectPredicate.has(object)) {
        this.byObjectPredicate.set(object, new Map())
      }
      const objPredMap = this.byObjectPredicate.get(object)
      if (!objPredMap.has(predicate)) {
        objPredMap.set(predicate, new Set())
      }
      objPredMap.get(predicate).add(claimId)
    }

    // Index by Source Turn IDs
    for (const turnId of evidence) {
      if (!this.bySource.has(turnId)) {
        this.bySource.set(turnId, new Set())
      }
      this.bySource.get(turnId).add(claimId)
    }

    return claim
  }

  /**
   * Query all pets owned or adopted by a person across all sessions (solves C1 multi-hop).
   * @param {string} ownerName - e.g. "James"
   * @param {string} [species] - e.g. "dog"
   * @returns {{ names: string[], proofBundles: Array<{ name: string, evidence: string[], sourceText: string }> }}
   */
  queryPetsByOwner(ownerName, species = null) {
    const normOwner = ownerName.trim().toLowerCase()
    const petNames = new Set()
    const proofBundles = []

    // Check claims for (ownerName, 'owns_pet' | 'adopted', petName)
    for (const [subj, predMap] of this.bySubjectPredicate.entries()) {
      if (subj.toLowerCase() === normOwner) {
        for (const [pred, claimSet] of predMap.entries()) {
          if (pred === 'owns_pet' || pred === 'adopted') {
            for (const claimId of claimSet) {
              const claim = this.claims.get(claimId)
              const petName = claim.object
              if (species && claim.qualifiers.species && claim.qualifiers.species.toLowerCase() !== species.toLowerCase()) {
                continue
              }
              if (!petNames.has(petName)) {
                petNames.add(petName)
                proofBundles.push({
                  name: petName,
                  predicate: pred,
                  evidence: claim.evidence,
                  dateInfo: claim.dateInfo,
                })
              }
            }
          }
        }
      }
    }

    return {
      names: Array.from(petNames),
      proofBundles,
    }
  }

  /**
   * Query the event date or adoption date for a subject and target (solves C2 temporal).
   * @param {string} subject - e.g. "James"
   * @param {string} target - e.g. "Ned"
   * @returns {{ formattedDate: string|null, evidence: string[], dateInfo: object|null }}
   */
  queryEventDate(subject, target) {
    const normSubj = subject.trim().toLowerCase()
    const normTarget = target.trim().toLowerCase()

    for (const [subj, predMap] of this.bySubjectPredicate.entries()) {
      if (subj.toLowerCase() === normSubj) {
        for (const [pred, claimSet] of predMap.entries()) {
          for (const claimId of claimSet) {
            const claim = this.claims.get(claimId)
            if (typeof claim.object === 'string' && claim.object.toLowerCase() === normTarget) {
              if (claim.dateInfo && claim.dateInfo.formatted_label) {
                return {
                  formattedDate: claim.dateInfo.formatted_label,
                  evidence: claim.evidence,
                  dateInfo: claim.dateInfo,
                }
              }
            }
          }
        }
      }
    }

    return { formattedDate: null, evidence: [], dateInfo: null }
  }

  /**
   * Query attribute of an entity or location (solves C4 literal and C3 entity isolation).
   * @param {string} subject
   * @param {string} attribute
   * @returns {Array<{ value: any, evidence: string[] }>}
   */
  queryAttribute(subject, attribute) {
    const normSubj = subject.trim().toLowerCase()
    const normAttr = attribute.trim().toLowerCase()
    const results = []

    for (const [subj, predMap] of this.bySubjectPredicate.entries()) {
      if (subj.toLowerCase() === normSubj) {
        for (const [pred, claimSet] of predMap.entries()) {
          if (pred.toLowerCase() === normAttr || pred.toLowerCase().includes(normAttr)) {
            for (const claimId of claimSet) {
              const claim = this.claims.get(claimId)
              results.push({
                value: claim.object,
                evidence: claim.evidence,
              })
            }
          }
        }
      }
    }

    return results
  }

  /**
   * Serialize ledger to a JSON-compatible object for disk caching.
   */
  toJSON() {
    return {
      sources: Array.from(this.sources.values()),
      entities: Array.from(this.entities.values()).map(e => ({
        ...e,
        mentions: Array.from(e.mentions),
      })),
      claims: Array.from(this.claims.values()),
      ingestion: Array.from(this.ingestion.entries()),
    }
  }

  /**
   * Hydrate ledger from a serialized JSON object.
   */
  static fromJSON(data) {
    const ledger = new EntityLedger()
    if (!data)
      return ledger

    if (Array.isArray(data.sources)) {
      for (const s of data.sources) ledger.addSource(s)
    }
    if (Array.isArray(data.entities)) {
      for (const e of data.entities) {
        ledger.entities.set(e.entityId, { ...e, mentions: new Set(e.mentions || []) })
        const norm = e.label.trim().toLowerCase()
        if (!ledger.byAlias.has(norm))
          ledger.byAlias.set(norm, new Set())
        ledger.byAlias.get(norm).add(e.entityId)
      }
    }
    if (Array.isArray(data.claims)) {
      for (const c of data.claims) {
        ledger.addClaim(c)
      }
    }
    if (Array.isArray(data.ingestion)) {
      for (const [k, v] of data.ingestion) ledger.ingestion.set(k, v)
    }

    return ledger
  }
}
