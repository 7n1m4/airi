/**
 * Hybrid Searcher for LoCoMo conv-47.
 * Implements Reciprocal Rank Fusion (RRF) combining BGE vector search and BM25 lexical search,
 * mirroring packages/stage-ui/src/libs/search/hybrid-scorer.ts.
 */

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length || !a.length)
    return 0
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  if (!magA || !magB)
    return 0
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

export class HybridSearcher {
  constructor(index, embeddings = {}) {
    this.index = index
    this.embeddings = embeddings
  }

  setEmbeddings(embeddings) {
    this.embeddings = embeddings
  }

  /**
   * Performs hybrid search combining BM25 and Vector embeddings with RRF.
   */
  searchHybrid(query, limit = 15, queryVector = null, options = {}) {
    const {
      weightVector = 0.68,
      weightKeyword = 0.32,
      rrfK = 60,
    } = options

    // 1. BM25 Candidates
    const bm25Candidates = this.index.searchBM25(query, Math.max(limit * 3, 30))

    // 2. Vector Candidates
    let vectorCandidates = []
    if (queryVector && Object.keys(this.embeddings).length > 0) {
      const scoredDocs = []
      for (const [id, emb] of Object.entries(this.embeddings)) {
        const doc = this.index.documents.get(id)
        if (!doc)
          continue
        const sim = cosineSimilarity(queryVector, emb)
        if (sim > 0.35) {
          scoredDocs.push({
            id,
            score: sim,
            doc,
          })
        }
      }
      scoredDocs.sort((a, b) => b.score - a.score)
      vectorCandidates = scoredDocs.slice(0, Math.max(limit * 3, 30))
    }

    // 3. Reciprocal Rank Fusion (RRF)
    const candidateMap = new Map()
    const scaleFactor = rrfK + 1

    // Process BM25 ranks
    bm25Candidates.forEach((cand, idx) => {
      const rank = idx + 1
      const rrfKeywordScore = scaleFactor / (rrfK + rank)
      candidateMap.set(cand.id, {
        id: cand.id,
        refDiaId: cand.refDiaId,
        kind: cand.kind,
        speaker: cand.speaker,
        text: cand.text,
        rawText: cand.rawText,
        session: cand.session,
        timestamp: cand.timestamp,
        bm25Score: cand.normalizedScore,
        vectorScore: 0,
        rrfKeywordScore,
        rrfVectorScore: 0,
        fusedScore: 0,
      })
    })

    // Process Vector ranks
    vectorCandidates.forEach((cand, idx) => {
      const rank = idx + 1
      const rrfVectorScore = scaleFactor / (rrfK + rank)
      let entry = candidateMap.get(cand.id)
      if (!entry) {
        entry = {
          id: cand.id,
          refDiaId: cand.doc.refDiaId,
          kind: cand.doc.kind,
          speaker: cand.doc.speaker,
          text: cand.doc.text,
          rawText: cand.doc.rawText,
          session: cand.doc.session,
          timestamp: cand.doc.timestamp,
          bm25Score: 0,
          vectorScore: cand.score,
          rrfKeywordScore: 0,
          rrfVectorScore,
          fusedScore: 0,
        }
        candidateMap.set(cand.id, entry)
      }
      else {
        entry.vectorScore = cand.score
        entry.rrfVectorScore = rrfVectorScore
      }
    })

    // Calculate final fused score
    const fusedList = [...candidateMap.values()].map((entry) => {
      const fusedScore = (weightVector * entry.rrfVectorScore) + (weightKeyword * entry.rrfKeywordScore)
      return {
        ...entry,
        fusedScore,
      }
    })

    fusedList.sort((a, b) => b.fusedScore - a.fusedScore)

    return fusedList.slice(0, limit)
  }
}
