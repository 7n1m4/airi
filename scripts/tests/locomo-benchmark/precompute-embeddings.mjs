/**
 * Precomputes and caches BGE embeddings for all documents and questions in conv-47.
 * Uses Xenova/bge-small-en-v1.5 to match AIRI's search.worker.ts.
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
const DOC_CACHE_PATH = path.join(ROOT, 'reports/memory-lab/datasets/locomo-conv47-embeddings.json')
const QUESTION_CACHE_PATH = path.join(ROOT, 'reports/memory-lab/datasets/locomo-conv47-question-embeddings.json')

console.log('Loading conv-47 dataset...')
const convData = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf-8'))
const index = new LocomoMemoryIndex()
index.loadConversation(convData)

const qas = convData.qa.filter(q => q.category >= 1 && q.category <= 4)

console.log(`Total documents to check/embed: ${index.documents.size}`)
console.log(`Total questions to embed: ${qas.length}`)

// Load embedder
console.log('Loading Xenova/bge-small-en-v1.5...')
const t0 = performance.now()
const extractor = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5')
console.log(`Loaded in ${((performance.now() - t0) / 1000).toFixed(2)}s.`)

// 1. Documents (if not already cached)
let docEmbeddings = {}
if (fs.existsSync(DOC_CACHE_PATH)) {
  docEmbeddings = JSON.parse(fs.readFileSync(DOC_CACHE_PATH, 'utf-8'))
  console.log(`Found ${Object.keys(docEmbeddings).length} existing document embeddings.`)
}
else {
  console.log('Generating document embeddings...')
  const embedT0 = performance.now()
  let count = 0
  const docEntries = [...index.documents.entries()]
  for (const [id, doc] of docEntries) {
    const textToEmbed = doc.rawText || doc.text
    const out = await extractor(textToEmbed, { pooling: 'mean', normalize: true })
    docEmbeddings[id] = Array.from(out.data)
    count++
    if (count % 100 === 0 || count === docEntries.length) {
      const elapsed = ((performance.now() - embedT0) / 1000).toFixed(1)
      console.log(`  [${count}/${docEntries.length}] embedded (${elapsed}s)`)
    }
  }
  fs.writeFileSync(DOC_CACHE_PATH, JSON.stringify(docEmbeddings))
  console.log(`Cached document embeddings to: ${DOC_CACHE_PATH}`)
}

// 2. Questions
console.log('Generating question embeddings...')
const qEmbeddings = {}
const qT0 = performance.now()
for (let i = 0; i < qas.length; i++) {
  const q = qas[i]
  const out = await extractor(q.question, { pooling: 'mean', normalize: true })
  qEmbeddings[q.question] = Array.from(out.data)
}
const qElapsed = ((performance.now() - qT0) / 1000).toFixed(2)
fs.writeFileSync(QUESTION_CACHE_PATH, JSON.stringify(qEmbeddings))
console.log(`Successfully cached ${Object.keys(qEmbeddings).length} question embeddings in ${qElapsed}s to: ${QUESTION_CACHE_PATH}`)
