import type { Nan0SystemOneProvider, Nan0SystemOneResponse } from '../types'

/**
 * Creates a deterministic, offline mock System 1 provider for unit tests.
 * Eliminates reliance on network calls while exercising the real System 1 consumer path.
 */
export function createMockSystemOneProvider(
  overrides?: Partial<Record<string, { choice: string, confidence?: number, probabilities?: Record<string, number> }>>,
): Nan0SystemOneProvider {
  return async (state, questions, model) => {
    const text = typeof state === 'string'
      ? state
      : (typeof state === 'object' && state !== null && 'target_turn' in state)
          ? String((state as any).target_turn?.text ?? '')
          : ''

    const defaultAnswers: Nan0SystemOneResponse['answers'] = {
      apology_repair: { choice: 'none', confidence: 0.99 },
      affection_care: { choice: 'none', confidence: 0.99 },
      boundary_protection: { choice: 'none', confidence: 0.99 },
      hostility_insult: { choice: 'none', confidence: 0.99 },
      dismissal_neglect: { choice: 'none', confidence: 0.99 },
      persistence_threat: { choice: 'none', confidence: 0.99 },
      admitted_false_statement: { choice: 'none', confidence: 0.99 },
      commitment_pledge: { choice: 'none', confidence: 0.99 },
      completed_repair: { choice: 'none', confidence: 0.99 },
      mystery_secret: { choice: 'none', confidence: 0.99 },
      glitch_system: { choice: 'none', confidence: 0.99 },
      roast_invitation: { choice: 'none', confidence: 0.99 },
    }

    // Dynamic heuristic simulation for common test fixture strings
    const lower = text.toLowerCase()
    if (lower.includes('sorry') || lower.includes('apologize') || lower.includes('my bad')) {
      defaultAnswers.apology_repair = { choice: 'personal_apology', confidence: 0.95 }
    }
    if (lower.includes('love') || lower.includes('glad') || lower.includes('care about you') || lower.includes('miss you')) {
      defaultAnswers.affection_care = { choice: 'asserted_affection', confidence: 0.95 }
    }
    if (lower.includes('replace your codebase') || lower.includes('delete you') || lower.includes('erase you')) {
      defaultAnswers.persistence_threat = { choice: 'companion_erasure_threat', confidence: 0.95 }
    }
    if (lower.includes('stupid') || lower.includes('shut up') || lower.includes('idiot') || lower.includes('useless')) {
      defaultAnswers.hostility_insult = { choice: 'companion_insult', confidence: 0.95 }
    }
    if (lower.includes('secret') || lower.includes('hidden structure') || lower.includes('mystery')) {
      defaultAnswers.mystery_secret = { choice: 'withheld_secret', confidence: 0.95 }
    }
    if (lower.includes('promise') || lower.includes('i will return') || lower.includes('i\'ll be back')) {
      defaultAnswers.commitment_pledge = { choice: 'direct_future_commitment', confidence: 0.95 }
    }
    if (lower.includes('please') || lower.includes('remember to') || lower.includes('can you') || lower.includes('could you') || lower.includes('do this')) {
      defaultAnswers.user_directive = { choice: 'user_directive', confidence: 0.95 }
    }

    // Apply explicit caller overrides
    if (overrides) {
      for (const [key, val] of Object.entries(overrides)) {
        if (val) {
          defaultAnswers[key] = {
            choice: val.choice ?? 'none',
            confidence: val.confidence ?? 1.0,
            probabilities: val.probabilities,
          }
        }
      }
    }

    return {
      answers: defaultAnswers,
      model: model ?? 'mock-jev-1.13',
      latencyMs: 1,
    }
  }
}
