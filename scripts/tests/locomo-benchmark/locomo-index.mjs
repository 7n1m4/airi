/**
 * In-memory BM25 + Layered Index for LoCoMo conv-47.
 * Implements AIRI's 3-tier layered memory (raw turns, stmm observations, ltmm summaries/events).
 */

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'shall',
  'can',
  'need',
  'must',
  'i',
  'me',
  'my',
  'we',
  'our',
  'you',
  'your',
  'he',
  'she',
  'it',
  'they',
  'them',
  'his',
  'her',
  'its',
  'their',
  'this',
  'that',
  'these',
  'those',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'from',
  'as',
  'into',
  'about',
  'between',
  'through',
  'after',
  'before',
  'and',
  'or',
  'but',
  'not',
  'no',
  'nor',
  'so',
  'if',
  'then',
  'user',
])

export function tokenize(input) {
  if (typeof input !== 'string')
    return []
  const normalized = input.toLowerCase()
  const regex = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF66-\uFF9F\uAC00-\uD7AF]|[a-z0-9]+/gi
  const matches = normalized.match(regex) || []
  return matches
    .map(t => t.trim())
    .filter(t => t.length > 0 && !STOPWORDS.has(t))
}

export class LocomoMemoryIndex {
  constructor() {
    this.documents = new Map() // id -> doc
    this.documentFrequency = new Map() // term -> df
    this.averageDocumentLength = 0
  }

  /**
   * Load conv-47 into the index across all 3 layers (raw, stmm, ltmm).
   */
  loadConversation(convData) {
    this.documents.clear()
    this.documentFrequency.clear()

    let totalLength = 0
    const conversation = convData.conversation || {}
    const observations = convData.observation || {}
    const sessionSummaries = convData.session_summary || {}
    const eventSummaries = convData.event_summary || {}

    // 1. Layer: RAW (Dialogue turns)
    for (const [key, val] of Object.entries(conversation)) {
      if (key.startsWith('session_') && !key.endsWith('_date_time') && Array.isArray(val)) {
        const dateTimeKey = `${key}_date_time`
        const timestamp = conversation[dateTimeKey] || ''

        for (const turn of val) {
          const id = turn.dia_id
          const text = `${turn.speaker}: ${turn.text}`
          const tokens = tokenize(text)
          const freqs = {}
          for (const t of tokens) {
            freqs[t] = (freqs[t] || 0) + 1
          }

          const doc = {
            id,
            speaker: turn.speaker,
            rawText: turn.text,
            text,
            kind: 'raw',
            session: key,
            timestamp,
            tokens,
            tokenFreqs: freqs,
          }

          this.documents.set(id, doc)
          totalLength += tokens.length

          const uniqueTerms = new Set(tokens)
          for (const term of uniqueTerms) {
            this.documentFrequency.set(term, (this.documentFrequency.get(term) || 0) + 1)
          }
        }
      }
    }

    // 2. Layer: STMM (Atomic observations)
    for (const [key, val] of Object.entries(observations)) {
      const sessionNum = key.replace('session_', '').replace('_observation', '')
      const dateTimeKey = `session_${sessionNum}_date_time`
      const timestamp = conversation[dateTimeKey] || ''

      if (val && typeof val === 'object') {
        for (const [speaker, obsList] of Object.entries(val)) {
          if (Array.isArray(obsList)) {
            obsList.forEach((obsItem, idx) => {
              const obsText = Array.isArray(obsItem) ? obsItem[0] : (typeof obsItem === 'string' ? obsItem : '')
              const refDiaId = Array.isArray(obsItem) ? obsItem[1] : ''
              const docId = `obs_${key}_${speaker}_${idx}`

              const tokens = tokenize(obsText)
              const freqs = {}
              for (const t of tokens) {
                freqs[t] = (freqs[t] || 0) + 1
              }

              const doc = {
                id: docId,
                refDiaId,
                speaker,
                rawText: obsText,
                text: `${speaker}: ${obsText}`,
                kind: 'stmm',
                session: `session_${sessionNum}`,
                timestamp,
                tokens,
                tokenFreqs: freqs,
              }

              this.documents.set(docId, doc)
              totalLength += tokens.length

              const uniqueTerms = new Set(tokens)
              for (const term of uniqueTerms) {
                this.documentFrequency.set(term, (this.documentFrequency.get(term) || 0) + 1)
              }
            })
          }
        }
      }
    }

    // 3. Layer: LTMM (Session summaries)
    for (const [key, summaryText] of Object.entries(sessionSummaries)) {
      if (typeof summaryText === 'string') {
        const docId = `sum_${key}`
        const sessionNum = key.replace('session_', '').replace('_summary', '')
        const dateTimeKey = `session_${sessionNum}_date_time`
        const timestamp = conversation[dateTimeKey] || ''

        const tokens = tokenize(summaryText)
        const freqs = {}
        for (const t of tokens) {
          freqs[t] = (freqs[t] || 0) + 1
        }

        const doc = {
          id: docId,
          speaker: 'Summary',
          rawText: summaryText,
          text: `Session ${sessionNum} Summary: ${summaryText}`,
          kind: 'ltmm',
          session: `session_${sessionNum}`,
          timestamp,
          tokens,
          tokenFreqs: freqs,
        }

        this.documents.set(docId, doc)
        totalLength += tokens.length

        const uniqueTerms = new Set(tokens)
        for (const term of uniqueTerms) {
          this.documentFrequency.set(term, (this.documentFrequency.get(term) || 0) + 1)
        }
      }
    }

    this.averageDocumentLength = this.documents.size > 0 ? totalLength / this.documents.size : 0
  }

  /**
   * BM25 search over documents.
   */
  searchBM25(query, limit = 20, layerFilter = null) {
    const queryTerms = tokenize(query)
    if (!queryTerms.length)
      return []

    const totalDocs = this.documents.size || 1
    const k1 = 1.5
    const b = 0.75
    const avgLen = this.averageDocumentLength || 1

    const scored = []

    for (const doc of this.documents.values()) {
      if (layerFilter && doc.kind !== layerFilter)
        continue

      const tokens = doc.tokens
      if (!tokens.length)
        continue

      const freqs = doc.tokenFreqs
      let score = 0

      for (const term of queryTerms) {
        const tf = freqs[term] || 0
        if (!tf)
          continue

        const df = this.documentFrequency.get(term) || 0
        const idf = Math.log(1 + ((totalDocs - df + 0.5) / (df + 0.5)))
        const denom = tf + (k1 * (1 - b + (b * (tokens.length / avgLen))))
        score += idf * ((tf * (k1 + 1)) / denom)
      }

      if (score > 0) {
        scored.push({
          id: doc.id,
          refDiaId: doc.refDiaId,
          kind: doc.kind,
          speaker: doc.speaker,
          rawText: doc.rawText,
          text: doc.text,
          session: doc.session,
          timestamp: doc.timestamp,
          score,
        })
      }
    }

    scored.sort((a, b) => b.score - a.score)

    if (scored.length === 0)
      return []

    const maxScore = scored[0].score || 1
    return scored.slice(0, limit).map(c => ({
      ...c,
      normalizedScore: c.score / maxScore,
    }))
  }

  /**
   * Evaluate recall on evidence turns.
   * Resolves refDiaId from STMM observations back to the underlying turn ID.
   */
  static evaluateEvidenceRecall(candidates, goldEvidence) {
    if (!goldEvidence || !goldEvidence.length)
      return { recall: 1.0, hits: 0, total: 0 }

    // Collect all candidate IDs including refDiaId if present
    const candIds = new Set()
    for (const c of candidates) {
      candIds.add(c.id)
      if (c.refDiaId)
        candIds.add(c.refDiaId)
    }

    let hits = 0
    for (const ev of goldEvidence) {
      if (candIds.has(ev))
        hits++
    }
    return {
      recall: hits / goldEvidence.length,
      hits,
      total: goldEvidence.length,
      allHit: hits === goldEvidence.length,
    }
  }
}
