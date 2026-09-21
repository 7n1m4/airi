/**
 * Precomputes and caches BGE embeddings for all windowed documents in conv-47.
 * Uses doc.text (which includes the conversational turn-1 window) with Xenova/bge-small-en-v1.5.
 */

import fs from 'node:fs'
import path from 'node:path'

import { fileURLToPath } from 'node:url'

import { pipeline } from '@huggingface/transformers'

import { LocomoMemoryIndex } from './locomo-index.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '../../..')

const DATASET_PATH = path.join(ROOT, 'reports/memory-lab/datasets/locomo-conv47.json')
const DOC_CACHE_PATH = path.join(ROOT, 'reports/memory-lab/datasets/locomo-conv47-embeddings-windowed.json')

console.log('Loading conv-47 dataset with conversational window indexing...')
const convData = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf-8'))
const index = new LocomoMemoryIndex()
index.loadConversation(convData)

console.log(`Total documents to embed: ${index.documents.size}`)

console.log('Loading Xenova/bge-small-en-v1.5...')
const t0 = performance.now()
const extractor = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5')
console.log(`Loaded in ${((performance.now() - t0) / 1000).toFixed(2)}s.`)

console.log('Generating windowed document embeddings...')
const docEmbeddings = {}
const embedT0 = performance.now()
let count = 0
const docEntries = [...index.documents.entries()]

for (const [id, doc] of docEntries) {
  // Use doc.text (contains turn-1 window) rather than isolated doc.rawText
  const textToEmbed = doc.text || doc.rawText
  const out = await extractor(textToEmbed, { pooling: 'mean', normalize: true })
  docEmbeddings[id] = Array.from(out.data)
  count++
  if (count % 100 === 0 || count === docEntries.length) {
    const elapsed = ((performance.now() - embedT0) / 1000).toFixed(1)
    console.log(`  [${count}/${docEntries.length}] embedded (${elapsed}s)`)
  }
}

fs.writeFileSync(DOC_CACHE_PATH, JSON.stringify(docEmbeddings))
const totalElapsed = ((performance.now() - embedT0) / 1000).toFixed(2)
console.log(`Successfully cached ${Object.keys(docEmbeddings).length} windowed document embeddings in ${totalElapsed}s to: ${DOC_CACHE_PATH}`)
