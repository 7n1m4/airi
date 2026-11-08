/** Audit record of one incremental merge pass. Newest entries are kept; the chain is capped. */
export interface LifetimeUpdateRecord {
  day: string
  changed: boolean
  updatedAt: number
  notes?: string[]
}

export interface LifetimeMemoryArtifact {
  id: string
  characterId: string
  universeId?: string
  version: number
  /** The foundation: summarized chunks used for synthesis */
  chunkSummaries: any[]
  /** Structured archive object before markdown render */
  baseArchive?: Record<string, any>
  /** The "heavy" summarized base (~7k tokens) */
  baseContent: string
  /** Structured distill pass 1 pack before final render */
  distillPass1Pack?: Record<string, any>
  /** The compressed, distilled relational essence (~1k tokens) */
  distilledContent: string
  /** Structured final distilled pack (source of incremental merges). Missing on artifacts produced before incremental maintenance. */
  finalPack?: Record<string, any>
  sourceManifest: {
    rawTurnCount: number
    stmmBlockCount: number
    ltmmEntryCount: number
  }
  createdAt: number
  updatedAt: number
  metadata: {
    model: string
    totalElapsedMs: number
    chunkCount: number
    targetTokens?: number
    /** The day watermark captured when chunkSummaries were originally built. */
    initialConsumedDay?: string
    /** Incremental watermark: the last completed local day key (YYYY-MM-DD) fully consumed into this artifact. */
    lastConsumedDay?: string
    lastUpdateType?: 'init' | 'incremental' | 'reprovision'
    /** Number of changed=true incremental merges since the last full synthesis/rebase. */
    mergesSinceRebase?: number
    /** Capped audit chain of incremental merge passes, newest last */
    updateHistory?: LifetimeUpdateRecord[]
  }
}
