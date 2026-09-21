/**
 * Laya Contextual Entity Classifier and Turn Salience Scorer.
 * Follows the peer-reviewed specification in docs/memory_lab/LoCoMo-Pass2-Entity-Ledger-Review.md §3.
 */

export const LAYA_ENTITY_TYPE_SCHEMA = {
  entity_type: {
    type: 'choice',
    instructions: 'Which coarse type best describes the referent of the target mention in this passage? Use unknown when the passage does not establish it.',
    criteria: {
      person: 'A named human being, friend, or family member (e.g. James, John).',
      animal: 'A pet, animal, or pet name (e.g. Ned, Max, Daisy, pup, dog, kitten).',
      place: 'A city, state, country, venue, or geographic location (e.g. Stamford).',
      organization: 'A shelter, rescue, club, charity, hospital, or company.',
      activity: 'A game, sport, hobby, tournament, or work project (e.g. CS:GO, Apex Legends).',
      other_or_unknown: 'An object, clothing, food, or unsupported assignment.',
    },
  },
}

export const LAYA_SALIENCE_SCHEMA = {
  salience: {
    type: 'score',
    instructions: 'Evaluate the new retrievable factual information introduced in this dialogue turn.',
    criteria: [
      'Pure acknowledgement or greeting; no new attributable information.',
      'Vague reaction, conversational filler, or repetition with no identifiable new claim.',
      'A specific attribute, preference, relation, event detail, or temporal fact.',
      'New identity/relation binding, pet adoption, naming, or major life milestone.',
    ],
  },
}

/**
 * Classify an entity mention in context using Laya.
 * @param {import('@receptron/laya').Laya} laya
 * @param {string} passage
 * @param {string} mention
 * @returns {Promise<{ type: string, confidence: number, probabilities: object }>}
 */
export async function classifyEntityInContext(laya, passage, mention) {
  const state = {
    companion: { id: 'airi', aliases: ['Airi'] },
    target_turn: {
      id: 'q0',
      role: 'user',
      text: `Passage:\n${passage}\n\nTarget mention to classify: "${mention}"`,
    },
    history: [],
    trusted_observations: [],
  }

  const res = await laya.systemOne(state, LAYA_ENTITY_TYPE_SCHEMA)
  const answers = res.answers || {}
  const ans = answers.entity_type || {}

  return {
    type: ans.choice || 'other_or_unknown',
    confidence: ans.confidence || 0.5,
    probabilities: ans.probabilities || {},
  }
}

/**
 * Score the factual salience of a dialogue turn (0..3).
 * Salience is used to prioritize processing order, NEVER as a deletion gate.
 * @param {import('@receptron/laya').Laya} laya
 * @param {string} turnText
 * @returns {Promise<{ score: number, confidence: number }>}
 */
export async function scoreTurnSalience(laya, turnText) {
  const state = {
    companion: { id: 'airi', aliases: ['Airi'] },
    target_turn: {
      id: 'q0',
      role: 'user',
      text: turnText,
    },
    history: [],
    trusted_observations: [],
  }

  const res = await laya.systemOne(state, LAYA_SALIENCE_SCHEMA)
  const answers = res.answers || {}
  const ans = answers.salience || {}

  return {
    score: typeof ans.score === 'number' ? ans.score : 1.5,
    confidence: ans.confidence || 0.5,
  }
}
