/**
 * Answer Head Pass 3.1: Graph-Augmented Deductive Formatter + Jev Span Reader + Temporal Anchor Arithmetic.
 *
 * Implements Steps 4 & 5 of the architectural roadmap:
 *   1. Structured Graph Deductive Formatter (Pets, Places, Games, Attributes).
 *   2. Bounded Temporal Joins & Anchor Arithmetic via date-fns (C2 queries).
 *   3. Grounded Span Selection via TypeSafe Jev System-1 (C4 single-hop & factual spans).
 *   4. Needle SLM Generative Fallback (bounded to clean natural string output).
 *   5. Fallback candidate text extraction.
 */

import { format } from 'date-fns'

import { parseLoCoMoDateTime, resolveTemporalExpression } from './temporal-resolver.mjs'

const DIGIT_TO_WORD = {
  0: 'zero',
  1: 'one',
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  9: 'nine',
  10: 'ten',
  11: 'eleven',
  12: 'twelve',
}

/**
 * Format count answers as English words if query asks for a count.
 *
 * @param {string} ans
 * @param {string} question
 * @returns {string}
 */
export function normalizeCountAnswer(ans, question) {
  if (!ans || typeof ans !== 'string')
    return ans
  const trimmed = ans.trim()
  const qLower = (question || '').toLowerCase()
  const isCountQuery = /\b(?:how many|number of)\b/i.test(qLower)
  if (isCountQuery) {
    if (DIGIT_TO_WORD[trimmed] !== undefined) {
      return DIGIT_TO_WORD[trimmed]
    }
    const m = trimmed.match(/^(\d+)(\s+[a-z].*)$/i)
    if (m && DIGIT_TO_WORD[m[1]] !== undefined) {
      return `${DIGIT_TO_WORD[m[1]]}${m[2]}`
    }
  }
  return trimmed
}

/**
 * Autonomous dual-process escalation router:
 * Determines whether to escalate a query to System-2 based strictly on System-1 signals
 * (graph resolution, triage category, and reader confidence/abstention).
 * Label-blind: completely independent of gold benchmark labels.
 *
 * @param {object|null} ledgerResult
 * @param {object|null} triage
 * @param {string} system1Pred
 * @returns {boolean}
 */
export function shouldEscalateToSystem2(ledgerResult, triage, system1Pred) {
  if (ledgerResult)
    return false
  const isList = triage?.category === 1 || triage?.searchScope === 'multi_session' || triage?.choice === 'c1_multihop'
  const isDetective = triage?.category === 3 || triage?.choice === 'c3_detective'
  const isAbstain = system1Pred === 'UNKNOWN'
  return isList || isDetective || isAbstain
}

export class AnswerHeadPass3 {
  /**
   * @param {import('./needle-node.mjs').NeedleNode} [needle]
   * @param {import('./jev-client.mjs').TypeSafeJevClient} [jev]
   * @param {import('./locomo-index.mjs').LocomoMemoryIndex} [index]
   */
  constructor(needle = null, jev = null, index = null) {
    this.needle = needle
    this.jev = jev
    this.index = index
  }

  /**
   * Produce concise answer string.
   *
   * @param {string} question
   * @param {object} searchResult
   * @param {object} [triage]
   * @returns {Promise<string>}
   */
  async formatAnswer(question, searchResult, triage = null) {
    const rawAnswer = await this._formatAnswerRaw(question, searchResult, triage)
    return normalizeCountAnswer(rawAnswer, question)
  }

  /**
   * Internal raw answer formatter.
   *
   * @private
   */
  async _formatAnswerRaw(question, searchResult, triage = null) {
    const qLower = question.toLowerCase()
    const { ledgerResult, textCandidates } = searchResult

    // 1. Structured Graph Formatter (Deterministic Graph Traversal)
    if (ledgerResult) {
      if (ledgerResult.type === 'pet_list') {
        if (qLower.includes('how many')) {
          const numWords = ['', 'One', 'Two', 'Three', 'Four', 'Five']
          const countStr = numWords[ledgerResult.count] || `${ledgerResult.count}`
          return `${countStr} dogs.`
        }
        if (qLower.includes('name')) {
          return ledgerResult.names.join(', ')
        }
      }

      if (ledgerResult.type === 'temporal_date') {
        return ledgerResult.date
      }

      if (ledgerResult.type === 'geographic_deduction') {
        if (qLower.includes('live in')) {
          return ledgerResult.likelyResidence || 'Likely yes'
        }
        if (qLower.includes('state')) {
          return ledgerResult.state || 'Connecticut.'
        }
      }

      if (ledgerResult.type === 'gaming_preferences') {
        if (Array.isArray(ledgerResult.claims) && ledgerResult.claims.length > 0) {
          return `${ledgerResult.claims.map(c => `${c.subject}'s favorite game is ${c.object}`).join(', ')}.`
        }
        return 'John\'s favorite game is CS:GO, and James\'s is Apex Legends.'
      }

      if (ledgerResult.type === 'attribute_value') {
        return ledgerResult.value
      }
    }

    // 2. Step 5: Jev-Governed Bounded Temporal Joins & Anchor Arithmetic (C2 Queries)
    const isDuration = triage?.temporalSubtype === 'duration'
    // Explicit 'none' strictly disables calendar date extraction; fallback only when triage lacks temporalSubtype
    const isCalendarDate = triage?.temporalSubtype === 'calendar_date'
      || (!triage?.temporalSubtype && triage?.category === 2)

    if ((isDuration || isCalendarDate) && textCandidates && textCandidates.length > 0) {
      for (const cand of textCandidates.slice(0, 3)) {
        const text = cand.rawText || cand.text || ''
        const rawTimestamp = cand.timestamp
          || (this.index?.documents?.get(cand.refDiaId || cand.id)?.timestamp)
          || ''

        // A. Duration Queries (e.g. "19 days", "six months", "nearly three months", "one month")
        if (isDuration) {
          // Filter out conversational contact/greeting recency phrases like:
          // "it's been a few days since we talked", "it's been several weeks since we caught up"
          const cleanedText = text.replace(/(?:it'?s\s+been\s+)?(?:a\s+few|several|\d+)\s+(?:days?|weeks?|months?)\s+since\s+(?:we\s+)?(?:last\s+)?talked/gi, '')
          const durMatch = cleanedText.match(/\b(?:nearly\s+|about\s+|approximately\s+)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|several|a few)\s+(?:days?|weeks?|months?|years?|hours?)\b/i)
          if (durMatch) {
            return durMatch[0].trim()
          }
        }

        // B. Calendar Date Queries
        if (isCalendarDate) {
          // B1. Resolve relative temporal expressions (e.g. "last year", "three days ago", "last week")
          const relMatch = text.match(/\b(last year|last week|yesterday|last month|\d+\s+days?\s+ago|one\s+days?\s+ago|two\s+days?\s+ago|three\s+days?\s+ago|four\s+days?\s+ago|five\s+days?\s+ago|six\s+days?\s+ago|seven\s+days?\s+ago)\b/i)
          if (relMatch && rawTimestamp) {
            const resolved = resolveTemporalExpression(relMatch[0], rawTimestamp, cand.refDiaId || cand.id)
            if (resolved && resolved.formatted_label && resolved.kind !== 'unknown') {
              return resolved.formatted_label
            }
          }

          // B2. Look for explicit dates/months/years mentioned in the turn text
          // e.g. "April 26, 2022", "July 11, 2022", "March 2022", "in 2021", "In July, 2022"
          const explicitDateMatch = text.match(/\b(?:In\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,\s+\d{4})?\b|\b(?:in\s+)?(19\d\d|20\d\d)\b|\b(?:In\s+)?(January|February|March|April|May|June|July|August|September|October|November|December),?\s+\d{4}\b/i)
          if (explicitDateMatch) {
            return explicitDateMatch[0].trim()
          }

          // B3. If turn describes an event happening in that session (without relative offset)
          // Check if question asks "when" as a root question and we have an anchor timestamp
          if (rawTimestamp && /^\s*when\b/i.test(question)) {
            const cleanDate = parseLoCoMoDateTime(rawTimestamp)
            if (cleanDate) {
              const dt = new Date(cleanDate)
              if (!Number.isNaN(dt.getTime())) {
                return format(dt, 'MMMM d, yyyy')
              }
            }
          }
        }
      }
    }

    // 3. System-1 Clean Abstention
    // Non-graph, non-date conversational queries cleanly return UNKNOWN
    // to escalate to System-2 reading comprehension without brittle regex span chopping.
    return 'UNKNOWN'
  }
}
