/**
 * Laya Cross-Encoder Candidate Reranker for LoCoMo candidates.
 * Evaluates candidate facts/turns against the question using Laya's score rubric (0..3).
 */

export const LOCOMO_RERANK_SCHEMA = {
  fact_relevance: {
    type: 'score',
    instructions: 'Evaluate how directly and accurately this candidate fact or dialogue turn answers or provides essential evidence for the user question.',
    criteria: [
      'Completely irrelevant or off-topic mention.',
      'Topical mention of entities, but does not provide the answer.',
      'Useful background context or partial evidence.',
      'Directly provides the answer or key evidence needed.',
    ],
  },
}

/**
 * Evaluates candidates in sequence using Laya score rubric.
 * @param {import('@receptron/laya').Laya} laya
 * @param {string} question
 * @param {Array<{ id: string, text: string, rawText?: string, score?: number }>} candidates
 * @returns {Promise<Array<{ id: string, text: string, rawText?: string, originalScore: number, layaScore: number, finalScore: number }>>}
 */
export async function layaRerankCandidates(laya, question, candidates) {
  const reranked = []

  for (const cand of candidates) {
    const stateData = {
      companion: { id: 'airi', aliases: ['Airi'] },
      target_turn: {
        id: 'q0',
        role: 'user',
        text: `Question: ${question}\nCandidate Fact: ${cand.text}`,
      },
      history: [],
      trusted_observations: [],
    }

    const output = await laya.systemOne(stateData, LOCOMO_RERANK_SCHEMA)
    const answers = output.answers || {}
    const rel = answers.fact_relevance || {}
    const layaScore = typeof rel.score === 'number' ? rel.score : 1.0

    // Fused score: 70% Laya cross-encoder relevance + 30% initial retrieval score
    const normLayaScore = layaScore / 3.0 // 0..1
    const originalScore = cand.score ?? 0.5
    const finalScore = (normLayaScore * 0.7) + (originalScore * 0.3)

    reranked.push({
      ...cand,
      originalScore,
      layaScore,
      finalScore,
    })
  }

  // Sort descending by finalScore
  reranked.sort((a, b) => b.finalScore - a.finalScore)

  return reranked
}
