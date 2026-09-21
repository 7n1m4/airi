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
}

/**
 * Classifies question intent via TypeSafe Jev.
 * @param {import('./jev-client.mjs').TypeSafeJevClient} jev
 * @param {string} question
 * @returns {Promise<{ category: number, choice: string, confidence: number, probabilities: object }>}
 */
export async function jevZeroShotTriage(jev, question) {
  try {
    const res = await jev.systemOne(`Query to classify: ${question}`, JEV_TRIAGE_SCHEMA)
    const ans = res.answers?.category || {}
    const choice = ans.choice || 'c4_literal'
    const confidence = ans.confidence ?? 0.5
    const probabilities = ans.probabilities || {}

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
      method: 'typesafe_jev_system1',
    }
  }
  catch (err) {
    console.warn(`[JevTriage] Classification error (${err.message}), falling back to regex`)
    // Heuristic fallback
    if (/\b(when|what time|what date|how long|which (year|month|day))\b/i.test(question)) {
      return { category: 2, choice: 'c2_temporal', confidence: 0.7, method: 'regex_fallback' }
    }
    if (/\b(how many|list of|all the|names of)\b/i.test(question)) {
      return { category: 1, choice: 'c1_multihop', confidence: 0.7, method: 'regex_fallback' }
    }
    return { category: 4, choice: 'c4_literal', confidence: 0.5, method: 'regex_fallback' }
  }
}
