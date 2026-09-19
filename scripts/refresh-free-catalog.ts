#!/usr/bin/env node

/**
 * Refresh Free AI Catalog Baseline
 *
 * Fetches the latest signed monthly catalog snapshot from FreeLLMAPI
 * (https://api.freellmapi.co/v1/latest), validates its structure and models,
 * compares it against the local baseline, updates
 * `packages/stage-ui/src/assets/free-ai-catalog-baseline.json`, and reports diffs.
 *
 * Usage:
 *   pnpm dlx tsx scripts/refresh-free-catalog.ts
 */

import fs from 'node:fs'
import path from 'node:path'

import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const CATALOG_FILE = path.resolve(REPO_ROOT, 'packages/stage-ui/src/assets/free-ai-catalog-baseline.json')
const REMOTE_FEED_URL = 'https://api.freellmapi.co/v1/latest'

interface CatalogPayload {
  version: string
  generatedAt: string
  tier: string
  counts?: Record<string, number>
  platforms?: Array<{ id: string, name: string }>
  models: Array<{
    platform: string
    modelId: string
    displayName: string
    intelligenceRank?: number
    speedRank?: number
    sizeLabel?: string
    contextWindow?: number
    [key: string]: any
  }>
  quirks?: any[]
  embeddings?: any[]
  transcriptionModels?: any[]
  videoModels?: any[]
  [key: string]: any
}

async function main() {
  console.log(`🌐 Fetching latest Free AI Catalog snapshot from ${REMOTE_FEED_URL}...`)

  const response = await fetch(REMOTE_FEED_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 AIRI-Catalog-Sync/1.0',
      'Accept': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch catalog from ${REMOTE_FEED_URL}: HTTP ${response.status} ${response.statusText}`)
  }

  const newCatalog = await response.json() as CatalogPayload

  // Schema validation
  if (!newCatalog.version || typeof newCatalog.version !== 'string') {
    throw new Error('Invalid catalog format: missing "version" string property.')
  }
  if (!Array.isArray(newCatalog.models) || newCatalog.models.length === 0) {
    throw new Error('Invalid catalog format: "models" must be a non-empty array.')
  }

  // Load existing catalog if present
  let oldCatalog: CatalogPayload | null = null
  if (fs.existsSync(CATALOG_FILE)) {
    try {
      oldCatalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'))
    }
    catch (err) {
      console.warn('⚠️ Could not parse existing baseline catalog, will overwrite.')
    }
  }

  console.log('\n📊 Catalog Comparison:')
  console.log(`   Old Version: ${oldCatalog?.version || 'none'}`)
  console.log(`   New Version: ${newCatalog.version} (Generated: ${newCatalog.generatedAt || 'unknown'})`)
  console.log(`   Chat/Vision Models: ${oldCatalog?.models?.length ?? 0} -> ${newCatalog.models.length}`)
  console.log(`   Transcription (STT): ${oldCatalog?.transcriptionModels?.length ?? 0} -> ${newCatalog.transcriptionModels?.length ?? 0}`)
  console.log(`   Embeddings: ${oldCatalog?.embeddings?.length ?? 0} -> ${newCatalog.embeddings?.length ?? 0}`)
  console.log(`   Quirks/Advisories: ${oldCatalog?.quirks?.length ?? 0} -> ${newCatalog.quirks?.length ?? 0}`)

  // Identify new models
  if (oldCatalog?.models) {
    const oldModelSet = new Set(oldCatalog.models.map(m => `${m.platform}:${m.modelId}`))
    const addedModels = newCatalog.models.filter(m => !oldModelSet.has(`${m.platform}:${m.modelId}`))
    if (addedModels.length > 0) {
      console.log(`\n✨ Found ${addedModels.length} newly cataloged models:`)
      for (const m of addedModels.slice(0, 10)) {
        console.log(`   + [${m.platform}] ${m.displayName} (${m.modelId})`)
      }
      if (addedModels.length > 10) {
        console.log(`   ... and ${addedModels.length - 10} more`)
      }
    }
  }

  // Write updated catalog to disk
  fs.mkdirSync(path.dirname(CATALOG_FILE), { recursive: true })
  fs.writeFileSync(CATALOG_FILE, `${JSON.stringify(newCatalog, null, 2)}\n`, 'utf8')

  console.log(`\n✅ Successfully updated ${CATALOG_FILE}`)
}

main().catch((err) => {
  console.error('❌ Error refreshing free catalog:', err)
  process.exit(1)
})
