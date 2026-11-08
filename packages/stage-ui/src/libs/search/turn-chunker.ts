/**
 * Raw-turn chunker for the search index pipeline.
 *
 * Novel-chapter turns (100k+ chars) cannot be embedded whole: a single forward
 * OOMs CPU/WASM runtimes and truncates away all but the head on every backend.
 * Turns at or under CHUNK_SIZE pass through untouched (stable id/title, so the
 * worker reuse-by-content shortcut and persisted snapshots keep working).
 * Longer turns split into overlapping windows with deterministic ids.
 *
 * Ownership: pure splitter only. Title/id policy lives with the caller
 * (`backgroundIndexAll`); embedding formatting lives in `embedding-format.ts`.
 */

export const TURN_CHUNK_SIZE = 1500
export const TURN_CHUNK_OVERLAP = 200

export interface TurnChunk {
  /** 0-based window index within the turn. */
  index: number
  /** Total windows for the turn (1 when the turn fits whole). */
  total: number
  /** Chunk text (the full turn text when total === 1). */
  text: string
}

export function chunkTurnText(
  text: string,
  chunkSize: number = TURN_CHUNK_SIZE,
  overlap: number = TURN_CHUNK_OVERLAP,
): TurnChunk[] {
  if (text.length <= chunkSize)
    return [{ index: 0, total: 1, text }]

  const step = Math.max(1, chunkSize - overlap)
  const chunks: TurnChunk[] = []
  let index = 0
  for (let start = 0; start < text.length; start += step, index++) {
    let end = Math.min(start + chunkSize, text.length)
    // Prefer a whitespace boundary so words (and BM25 tokens) stay intact.
    // Never shrink below one step of fresh content.
    if (end < text.length) {
      const probe = text.lastIndexOf(' ', end)
      if (probe > start + step)
        end = probe
    }
    chunks.push({ index, total: 0, text: text.slice(start, end).trim() })
    if (end >= text.length)
      break
  }

  // Set accurate total across all emitted chunks
  for (const c of chunks)
    c.total = chunks.length

  return chunks
}
