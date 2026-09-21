/**
 * Zero-Shot Question Triage using TypeSafe Jev System-1 API.
 * Maps queries into categories:
 *   Category 1: Multi-Hop
 *   Category 2: Temporal
 *   Category 3: Detective / Deduction
 *   Category 4: Literal Single-Fact
 */

export const JEV_TRIAGE_SCHEMA = {
  category: {
    type: 'choice',
    instructions: 'Classify this query into the primary cognitive memory category required to answer it accurately.',
    criteria: {
      c1_multihop: 'Requires joining, listing, counting, or aggregating multiple facts across different conversations (e.g. list of pets, total games played).',
      c2_temporal: 'Asks when an event occurred, a date, duration, time elapsed, or sequence order (e.g. when did X happen, how long ago).',
      c3_detective: 'Requires deductive reasoning, unstated implication, world knowledge, or abductive inference (e.g. likely residence, profession, state of shelter).',
      c4_literal: 'Direct retrieval of a single specific named entity, statement, or fact mentioned explicitly in dialogue.',
    },
  },
  temporal_subtype: {
    type: 'choice',
    instructions: 'If this query asks about time, determine what kind of time value is requested. Otherwise select none.',
    criteria: {
      calendar_date: 'Asks when an event occurred (specific date, month, year, or session timestamp).',
      duration: 'Asks for an elapsed quantity or length of time (e.g. how many days, how long did it take, duration).',
      none: 'Does not ask for a time, date, or duration (e.g. asking what object, what instrument, what game).',
    },
  },
  search_scope: {
    type: 'choice',
    instructions: 'Determine whether answering this question requires finding a single conversation turn or aggregating across multiple distinct conversations.',
    criteria: {
      single_session: 'The target fact is described within a single conversation session.',
      multi_session: 'Requires gathering, listing, or comparing entities across multiple separate sessions (e.g. list of all games played, all countries visited, all books recommended).',
    },
  },
}

/**
 * Classifies question intent, temporal subtype, and search scope via TypeSafe Jev System-1.
 * @param {import('./jev-client.mjs').TypeSafeJevClient} jev
 * @param {string} question
 * @returns {Promise<{ category: number, choice: string, confidence: number, probabilities: object, temporalSubtype: string, searchScope: string, method: string }>}
 */
export async function jevZeroShotTriage(jev, question) {
  try {
    const res = await jev.systemOne(`Query to classify: ${question}`, JEV_TRIAGE_SCHEMA)
    const ansCat = res.answers?.category || {}
    const ansTemp = res.answers?.temporal_subtype || {}
    const ansScope = res.answers?.search_scope || {}

    const choice = ansCat.choice || 'c4_literal'
    const confidence = ansCat.confidence ?? 0.5
    const probabilities = ansCat.probabilities || {}

    const temporalSubtype = ansTemp.choice || 'none'
    const searchScope = ansScope.choice || 'single_session'

    const map = {
      c1_multihop: 1,
      c2_temporal: 2,
      c3_detective: 3,
      c4_literal: 4,
    }

    return {
      category: map[choice] || 4,
      choice,
      confidence,
      probabilities,
      temporalSubtype,
      searchScope,
      method: 'typesafe_jev_system1',
    }
  }
  catch (err) {
    console.warn(`[JevTriage] Classification error (${err.message}), falling back to regex`)
    // Heuristic fallback
    let cat = 4
    let choice = 'c4_literal'
    let tempSub = 'none'
    let scope = 'single_session'

    if (/\b(how long|how many days|how many months|how many years)\b/i.test(question)) {
      cat = 2
      choice = 'c2_temporal'
      tempSub = 'duration'
    }
    else if (/\b(when|what time|what date|which (year|month|day))\b/i.test(question)) {
      cat = 2
      choice = 'c2_temporal'
      tempSub = 'calendar_date'
    }
    else if (/\b(how many|list of|all the|names of|which countries|which games|which books)\b/i.test(question)) {
      cat = 1
      choice = 'c1_multihop'
      scope = 'multi_session'
    }

    return {
      category: cat,
      choice,
      confidence: 0.5,
      probabilities: {},
      temporalSubtype: tempSub,
      searchScope: scope,
      method: 'regex_fallback',
    }
  }
}
