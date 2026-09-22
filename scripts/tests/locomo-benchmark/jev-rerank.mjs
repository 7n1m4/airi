/**
 * TypeSafe Jev Batched Candidate Reranker for LoCoMo candidates.
 * Scores up to 10 candidates concurrently in a SINGLE forward pass via TypeSafe Jev System-1.
 */

export const JEV_RERANK_CRITERIA = [
  'Completely irrelevant or off-topic mention.',
  'Topical mention of entities, but does not provide the answer.',
  'Useful background context or partial evidence.',
  'Directly provides the answer or key evidence needed.',
]

/**
 * Batched candidate reranking using TypeSafe Jev System-1 API.
 * Evaluates all candidate turns against the question in one single HTTP request.
 *
 * @param {import('./jev-client.mjs').TypeSafeJevClient} jev
 * @param {string} question
 * @param {Array<{ id: string, text: string, rawText?: string, score?: number, refDiaId?: string }>} candidates
 * @param {number} [maxCandidates=10]
 * @returns {Promise<Array<{ id: string, text: string, rawText?: string, originalScore: number, jevScore: number, finalScore: number, refDiaId?: string }>>}
 */
export async function jevRerankCandidates(jev, question, candidates, maxCandidates = 10) {
  const pool = candidates.slice(0, maxCandidates)
  if (pool.length === 0)
    return []

  // Build batched questions map for Jev
  const questions = {}
  for (let idx = 0; idx < pool.length; idx++) {
    const cand = pool[idx]
    // Context-preserving snippet: prioritize contextual text (containing turn - 1 window)
    const textToUse = (cand.text || cand.windowText || cand.rawText || '').replace(/\r/g, '').trim()
    let snippet = textToUse
    if (snippet.length > 380) {
      // If truncated, guarantee target turn (last turn) is preserved
      const lines = snippet.split('\n')
      if (lines.length > 1) {
        const lastLine = lines[lines.length - 1]
        const remainingBudget = Math.max(80, 380 - lastLine.length - 15)
        const priorLines = lines.slice(0, -1).join(' ').slice(-remainingBudget)
        snippet = `...${priorLines}\n${lastLine}`
      }
      else {
        snippet = snippet.slice(0, 380)
      }
    }
    snippet = snippet.replace(/\s+/g, ' ').trim()
    questions[`cand_${idx}`] = {
      type: 'score',
      instructions: `Candidate Fact: "${snippet}"\nEvaluate how directly and accurately this candidate provides the key answer or essential evidence for the question.`,
      criteria: JEV_RERANK_CRITERIA,
    }
  }

  let answers = {}
  try {
    const response = await jev.systemOne(`Question to answer: ${question}`, questions)
    answers = response.answers || {}
  }
  catch (err) {
    console.warn(`[JevRerank] Batched rerank failed (${err.message}), falling back to original scores`)
  }

  const reranked = pool.map((cand, idx) => {
    const ans = answers[`cand_${idx}`] || {}
    const rawScore = typeof ans.score === 'number' ? ans.score : 1.0 // 0..3 scale
    const normJevScore = Math.max(0, Math.min(1, rawScore / 3.0)) // normalize to 0..1
    const originalScore = cand.fusedScore ?? cand.score ?? 0.5
    const finalScore = (normJevScore * 0.7) + (originalScore * 0.3)

    return {
      ...cand,
      originalScore,
      jevScore: rawScore,
      finalScore,
    }
  })

  // Sort descending by fused score
  reranked.sort((a, b) => b.finalScore - a.finalScore)

  return reranked
}
