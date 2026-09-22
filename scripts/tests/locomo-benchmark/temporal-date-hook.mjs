/**
 * Temporal Date-Range Hook for LoCoMo conv-47.
 * Inspired by Anima's date-range supplement architecture.
 *
 * Automatically detects explicit calendar dates or month-year expressions in queries
 * (e.g. "April 2022", "27 March, 2022", "May 8, 2022") and injects turns from the matching
 * session(s) directly into the candidate retrieval pool.
 */

const DATE_PATTERN = /\b(?:(\d{1,2})\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+(\d{1,2}))?,?\s*(\d{4})?\b/gi

/**
 * Extracts date components from question string.
 *
 * @param {string} question
 * @returns {Array<{ text: string, day?: string, month: string, year?: string }>}
 */
export function extractQuestionDates(question) {
  if (!question || typeof question !== 'string')
    return []

  const matches = [...question.matchAll(DATE_PATTERN)]
  return matches
    .filter(m => m[2] && (m[1] || m[3] || m[4]))
    .map(m => ({
      text: m[0].trim(),
      day: m[1] || m[3] || undefined,
      month: m[2],
      year: m[4] || undefined,
    }))
}

/**
 * Finds sessions in the memory documents matching detected date components.
 *
 * @param {string} question
 * @param {Map<string, object>|Array<object>} documents
 * @returns {Array<{ sessionKey: string, timestamp: string, matchType: 'exact_day'|'month_year' }>}
 */
export function detectTemporalDateSessions(question, documents) {
  const dates = extractQuestionDates(question)
  if (dates.length === 0)
    return []

  const docs = documents instanceof Map ? Array.from(documents.values()) : documents
  const sessionDates = new Map() // sessionKey -> timestamp

  for (const doc of docs) {
    if (doc.session && doc.timestamp && !sessionDates.has(doc.session)) {
      sessionDates.set(doc.session, doc.timestamp)
    }
  }

  const matched = []
  for (const [sessionKey, timestamp] of sessionDates.entries()) {
    const tsLower = timestamp.toLowerCase()
    for (const d of dates) {
      const monthLower = d.month.toLowerCase()
      const yearStr = d.year || ''

      if (d.day) {
        // Exact day match (e.g. "27 March" or "March 27")
        const dayNum = Number.parseInt(d.day, 10)
        const dayRegex = new RegExp(`\\b${dayNum}(?:st|nd|rd|th)?\\s+${monthLower}|\\b${monthLower}\\s+${dayNum}\\b`, 'i')
        if (dayRegex.test(tsLower) && (!yearStr || tsLower.includes(yearStr))) {
          matched.push({ sessionKey, timestamp, matchType: 'exact_day' })
          break
        }
      }
      else if (tsLower.includes(monthLower) && (!yearStr || tsLower.includes(yearStr))) {
        // Month + Year match (e.g. "April 2022")
        matched.push({ sessionKey, timestamp, matchType: 'month_year' })
        break
      }
    }
  }

  return matched
}

/**
 * Injects raw dialogue turns from date-matched sessions into candidate pool.
 *
 * @param {string} question
 * @param {Map<string, object>} documents
 * @param {Array<object>} candidates
 * @param {number} [maxInject=3]
 * @returns {Array<object>}
 */
export function injectTemporalDateCandidates(question, documents, candidates, maxInject = 3) {
  const matchedSessions = detectTemporalDateSessions(question, documents)
  if (matchedSessions.length === 0)
    return candidates

  const qTokens = question.toLowerCase().split(/\W+/).filter(t => t.length > 2)
  const existingIds = new Set(candidates.map(c => c.refDiaId || c.id))
  const injectedTurns = []

  for (const { sessionKey } of matchedSessions) {
    const rawTurns = Array.from(documents.values()).filter(d =>
      d.kind === 'raw' && d.session === sessionKey && !existingIds.has(d.id),
    )

    // Score turns within this session by question keyword overlap
    const scored = rawTurns.map((turn) => {
      const textLower = (turn.text || turn.rawText || '').toLowerCase()
      let kwScore = 0
      for (const qt of qTokens) {
        if (textLower.includes(qt))
          kwScore += 1
      }
      const normScore = Math.min(1.0, kwScore * 0.25)
      return { turn, score: normScore }
    }).sort((a, b) => b.score - a.score)

    for (const item of scored.slice(0, 2)) {
      if (item.score > 0) {
        injectedTurns.push({
          ...item.turn,
          injectedViaDateHook: true,
          score: item.score,
          fusedScore: item.score,
        })
      }
    }
  }

  if (injectedTurns.length === 0)
    return candidates

  // Append high-scoring date-hook candidates so they supplement rather than displace hybrid hits
  return [...candidates, ...injectedTurns.slice(0, maxInject)]
}
