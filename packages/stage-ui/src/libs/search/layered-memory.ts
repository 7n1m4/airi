import type { HybridSearchResult, MemoryLayer, SearchDocumentMeta } from './hybrid-scorer'

import indexedDbDriver from 'unstorage/drivers/indexedb'
import memoryDriver from 'unstorage/drivers/memory'

import { createStorage } from 'unstorage'

import { searchWorker } from '../workers/search'
import {
  defaultScorerConfig,

  scoreHybridResults,

} from './hybrid-scorer'
import { analyzeQuery } from './query-analyzer'

const indexStorage = createStorage({
  driver: typeof indexedDB !== 'undefined' ? indexedDbDriver({ base: 'airi-search-index' }) : memoryDriver(),
})

export interface LayeredSearchResult extends HybridSearchResult {}

export interface LayeredSearchOptions {
  previousTurn?: string
  anaphoraEnabled?: boolean
  temporalBoost?: boolean
}

let isPersisting = false
let isIndexing = false

const KIND_MAP: Record<string, MemoryLayer> = {
  user_turn: 'raw',
  assistant_turn: 'raw',
  memory_block: 'stmm',
  journal_entry: 'ltmm',
  echo_chip: 'stmm',
  lifetime_entry: 'ltmm',
}

function resolveMemoryLayer(kind: string): MemoryLayer {
  if (kind in KIND_MAP)
    return KIND_MAP[kind]

  if (kind.endsWith('_turn'))
    return 'raw'
  if (kind.endsWith('_block'))
    return 'stmm'
  if (kind.endsWith('_entry'))
    return 'ltmm'

  return 'raw'
}

export const layeredMemory = {
  async init() {
    const snapshot = await indexStorage.getItem('snapshot')
    await searchWorker.init(snapshot)
  },

  async persist() {
    if (isPersisting)
      return
    isPersisting = true
    try {
      const snapshot = await searchWorker.persist()
      await indexStorage.setItem('snapshot', snapshot)
    }
    finally {
      isPersisting = false
    }
  },

  async search(
    query: string,
    limit = 10,
    characterId?: string,
    options?: LayeredSearchOptions,
  ): Promise<LayeredSearchResult[]> {
    const analysis = analyzeQuery(query, {
      previousTurn: options?.previousTurn,
      anaphoraEnabled: options?.anaphoraEnabled ?? true,
    })

    const rawResults = await searchWorker.search(
      analysis.expandedQuery,
      limit,
      characterId,
      analysis.temporalHooks,
    )
    const documents = rawResults.documents.map((document: SearchDocumentMeta & { kind: string }) => ({
      ...document,
      kind: resolveMemoryLayer(document.kind),
    }))

    return scoreHybridResults(
      query,
      documents,
      rawResults.vectorHits,
      rawResults.keywordHits,
      defaultScorerConfig,
      analysis.temporalHooks,
    ).slice(0, limit)
  },

  async indexDocuments(documents: any[]) {
    if (isIndexing)
      return
    isIndexing = true
    try {
      await searchWorker.index(documents)
      await this.persist()
    }
    finally {
      isIndexing = false
    }
  },

  async removeDocument(id: string) {
    await searchWorker.remove(id)
    await this.persist()
  },
}

/**
 * Formats retrieved memory search results into a clean markdown evidence block suitable for LLM context injection.
 */
export function formatEvidenceContextBlock(
  results: LayeredSearchResult[],
  options?: {
    minScore?: number
    includeScore?: boolean
    maxTokens?: number
  },
): string {
  const minScore = options?.minScore ?? 0.35
  const eligible = results.filter(r => r.score >= minScore)

  if (!eligible.length)
    return ''

  const lines = eligible.map((r, i) => {
    const kindTag = r.kind.toUpperCase()
    const dateStr = r.timestamp ? ` [${new Date(r.timestamp).toISOString().split('T')[0]}]` : ''
    const scoreStr = options?.includeScore ? ` (score: ${r.score.toFixed(2)})` : ''
    return `${i + 1}. [${kindTag}]${dateStr}${scoreStr}: ${r.content}`
  })

  return `[Retrieved Memory Context]\n${lines.join('\n')}`
}
