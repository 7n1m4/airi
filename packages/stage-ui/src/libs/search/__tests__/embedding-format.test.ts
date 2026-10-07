import { describe, expect, it } from 'vitest'

import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL_ID,
  formatDocumentForEmbedding,
  formatQueryForEmbedding,
  isSnapshotCompatible,
  l2Normalize,
  sanitizeEmbeddingTitle,
  SEARCH_INDEX_SCHEMA_VERSION,
  TASK_PREFIX_VERSION,
} from '../embedding-format'

describe('embedding-format', () => {
  it('formats queries with the asymmetric task prefix', () => {
    expect(formatQueryForEmbedding('what did we eat in Paris?'))
      .toBe('task: search result | query: what did we eat in Paris?')
  })

  it('formats documents with real titles, never none', () => {
    expect(formatDocumentForEmbedding('ltmm_entry', 'Summer Trip', 'Went to the beach.'))
      .toBe('title: Summer Trip | text: Went to the beach.')
  })

  it('falls back through synthetic title chain instead of none', () => {
    expect(formatDocumentForEmbedding('stmm_block', '', 'Weekly recap content here.'))
      .toBe('title: Weekly recap content here. | text: Weekly recap content here.')
    expect(formatDocumentForEmbedding('raw_turn', undefined, ''))
      .toBe('title: untitled | text: ')
  })

  it('sanitizes titles: collapses pipes/newlines, caps length', () => {
    expect(sanitizeEmbeddingTitle('a|b\nc\td')).toBe('a b c d')
    expect(sanitizeEmbeddingTitle(`x`.repeat(200)).length).toBeLessThanOrEqual(120)
    expect(sanitizeEmbeddingTitle(undefined)).toBe('')
  })

  it('l2Normalize restores unit length after MRL truncation', () => {
    const truncated = [3, 4, 0, 0]
    const normalized = l2Normalize(truncated)
    expect(Math.hypot(...normalized)).toBeCloseTo(1, 10)
    expect(normalized[0]).toBeCloseTo(0.6, 10)
    expect(normalized[1]).toBeCloseTo(0.8, 10)
  })

  it('l2Normalize never divides by zero', () => {
    expect(l2Normalize([0, 0, 0])).toEqual([0, 0, 0])
    expect(l2Normalize([])).toEqual([])
  })

  it('rejects legacy and headerless snapshots', () => {
    expect(isSnapshotCompatible(undefined)).toBe(false)
    expect(isSnapshotCompatible(null)).toBe(false)
    expect(isSnapshotCompatible({ documents: [] })).toBe(false)
    expect(isSnapshotCompatible({
      embeddingModel: 'Xenova/bge-small-en-v1.5',
      embeddingDim: 384,
      schemaVersion: 1,
      taskPrefixVersion: 0,
    })).toBe(false)
    expect(isSnapshotCompatible({
      embeddingModel: EMBEDDING_MODEL_ID,
      embeddingDim: EMBEDDING_DIM,
      schemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
      taskPrefixVersion: TASK_PREFIX_VERSION - 1,
    })).toBe(false)
  })

  it('accepts current-header snapshots', () => {
    expect(isSnapshotCompatible({
      schemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
      embeddingModel: EMBEDDING_MODEL_ID,
      embeddingDim: EMBEDDING_DIM,
      dtype: 'q4',
      taskPrefixVersion: TASK_PREFIX_VERSION,
      indexedAt: Date.now(),
    })).toBe(true)
  })
})
