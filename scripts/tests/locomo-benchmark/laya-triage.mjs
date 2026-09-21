/**
 * Laya Zero-Shot Triage Classifier for LoCoMo questions.
 * Replaces heuristic regexes with a single forward-pass ONNX decision head (~140ms, $0.00).
 */

export const LOCOMO_TRIAGE_SCHEMA = {
  locomo_triage: {
    type: 'choice',
    instructions: 'Classify what depth and style of memory retrieval and reasoning this question requires.',
    criteria: {
      c4_literal: 'Direct factual question about a specific entity, attribute, or single event without temporal sequence or multi-step deduction.',
      c2_temporal: 'Requires identifying when an event occurred, timeline sequence, elapsed time, relative dates, or duration.',
      c1_multihop: 'Requires connecting two or more distinct facts, people, or events across different conversations or sessions.',
      c3_detective: 'Requires open-domain inference, inductive abstraction, categorization, or drawing an unstated conclusion.',
    },
  },
}

const CHOICE_TO_CAT_MAP = {
  c4_literal: 4,
  c2_temporal: 2,
  c1_multihop: 1,
  c3_detective: 3,
}

/**
 * Heuristic regex triage baseline (representing historical AIRI / Memory Lab routing).
 */
export function heuristicRegexTriage(question) {
  const norm = question.toLowerCase().trim()

  // Temporal cues
  if (
    /\b(when|what time|what date|how long|how many (years|months|days|weeks|hours)|which (year|month|day)|timeline|first time|last time|since|ago|duration)\b/i.test(norm)
  ) {
    return {
      category: 2,
      choice: 'c2_temporal',
      confidence: 0.8,
      method: 'regex_temporal',
    }
  }

  // Open-domain / Detective cues
  if (
    /\b(why|suspect|infer|imply|health problem|medical|attitude|impression|personality|trait|opinion|perspective|motivation|reason for)\b/i.test(norm)
  ) {
    return {
      category: 3,
      choice: 'c3_detective',
      confidence: 0.7,
      method: 'regex_detective',
    }
  }

  // Multi-hop cues
  if (
    /\b(both|and .* (also|as well)|between|connection|relationship|all the things|different (places|jobs|events))\b/i.test(norm)
  ) {
    return {
      category: 1,
      choice: 'c1_multihop',
      confidence: 0.65,
      method: 'regex_multihop',
    }
  }

  // Default: Literal Single-hop
  return {
    category: 4,
    choice: 'c4_literal',
    confidence: 0.85,
    method: 'regex_literal_default',
  }
}

/**
 * Laya zero-shot triage classifier using systemOne.
 */
export async function layaZeroShotTriage(laya, question) {
  const stateData = {
    companion: { id: 'airi', aliases: ['Airi'] },
    target_turn: { id: 'q0', role: 'user', text: question },
    history: [],
    trusted_observations: [],
  }

  const t0 = performance.now()
  const output = await laya.systemOne(stateData, LOCOMO_TRIAGE_SCHEMA)
  const latencyMs = performance.now() - t0

  const answers = output.answers || {}
  const res = answers.locomo_triage || {}
  const choice = res.choice || 'c4_literal'
  const confidence = res.confidence || 0.5
  const category = CHOICE_TO_CAT_MAP[choice] || 4

  return {
    category,
    choice,
    confidence,
    latencyMs,
    probabilities: res.probabilities || {},
    method: 'laya_system1_onnx',
  }
}
