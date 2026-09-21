/**
 * BGE Cosine Adjacency Episode Clustering.
 *
 * Partitions sequential dialogue turns within a session into cohesive topical episodes
 * using vector cosine similarity between adjacent turn embeddings.
 * Runs purely in-memory in V8 with 0 ms network or local model overhead.
 */

/**
 * Computes cosine similarity between two float vectors.
 *
 * @param {number[]} vecA
 * @param {number[]} vecB
 * @returns {number}
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length)
    return 0

  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i]
    magA += vecA[i] * vecA[i]
    magB += vecB[i] * vecB[i]
  }

  if (magA <= 0 || magB <= 0)
    return 0
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

/**
 * Clusters consecutive raw dialogue turns within a session into topical episodes
 * using cosine similarity of adjacent BGE embeddings.
 *
 * @param {Array<object>} turns - Chronologically sorted raw dialogue turn documents
 * @param {Record<string, number[]>} embeddings - Precomputed BGE embeddings map (turn.id -> vector)
 * @param {number} [threshold=0.55] - Cosine similarity cutoff for episode boundary
 * @returns {Array<{ episodeId: string, turns: Array<object>, startId: string, endId: string, text: string }>}
 */
export function clusterSessionTurns(turns, embeddings, threshold = 0.55) {
  if (!Array.isArray(turns) || turns.length === 0)
    return []

  if (turns.length === 1) {
    return [{
      episodeId: `${turns[0].session || 's'}_ep_0`,
      turns: [turns[0]],
      startId: turns[0].id,
      endId: turns[0].id,
      text: `${turns[0].speaker}: ${turns[0].rawText || turns[0].text}`,
    }]
  }

  const episodes = []
  let currentGroup = [turns[0]]

  for (let i = 0; i < turns.length - 1; i++) {
    const tCurrent = turns[i]
    const tNext = turns[i + 1]

    const embA = embeddings?.[tCurrent.id]
    const embB = embeddings?.[tNext.id]
    const sim = cosineSimilarity(embA, embB)

    // When similarity drops below threshold, a topical episode transition occurs
    if (sim < threshold) {
      episodes.push(currentGroup)
      currentGroup = [tNext]
    }
    else {
      currentGroup.push(tNext)
    }
  }

  if (currentGroup.length > 0) {
    episodes.push(currentGroup)
  }

  return episodes.map((group, idx) => ({
    episodeId: `${group[0].session || 's'}_ep_${idx}`,
    turns: group,
    startId: group[0].id,
    endId: group[group.length - 1].id,
    text: group.map(t => `${t.speaker}: ${t.rawText || t.text}`).join('\n'),
  }))
}
