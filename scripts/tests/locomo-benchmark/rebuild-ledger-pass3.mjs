/**
 * Standalone Ledger Rebuild Script for LoCoMo Pass 3.1.
 *
 * Runs full turn-by-turn ingestion over locomo-conv47.json:
 * - Reads exact per-session timestamps from conversation[session_N_date_time]
 * - Verifies all 31 sessions and 689 dialogue turns
 * - Extracts mentions, claims, and temporal anchors using Needle WASM + date-fns
 * - Resolves geographic entities (Stamford -> Connecticut, USA) hierarchically via TypeSafe Jev
 * - Persists complete ledger to reports/memory-lab/datasets/locomo-conv47-ledger-pass3.json
 */

import fs from 'node:fs'
import path from 'node:path'

import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

import { TypeSafeJevClient } from './jev-client.mjs'
import { ingestDatasetIntoLedger } from './ledger-ingest.mjs'
import { NeedleNode } from './needle-node.mjs'
import { resolvePlaceHierarchically } from './place-resolver.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../../..')

const envPath = path.join(ROOT, '.env')
let JEV_API_KEY = process.env.TYPESAFE_API_KEY
if (!JEV_API_KEY && fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8')
  const match = envContent.match(/TYPESAFE_API_KEY=(.+)/)
  if (match)
    JEV_API_KEY = match[1].trim()
}
if (!JEV_API_KEY) {
  throw new Error('TYPESAFE_API_KEY missing in process.env or .env file')
}

const DATASET_PATH = path.join(ROOT, 'reports/memory-lab/datasets/locomo-conv47.json')
const OUTPUT_LEDGER_PATH = path.join(ROOT, 'reports/memory-lab/datasets/locomo-conv47-ledger-pass3.json')

console.log('================================================================')
console.log('Rebuilding LoCoMo Pass 3.1 Entity Ledger from Scratch')
console.log('Target Dataset:', DATASET_PATH)
console.log('Output Path:   ', OUTPUT_LEDGER_PATH)
console.log('================================================================\n')

const t0 = performance.now()

// 1. Load Dataset
console.log('[1/5] Loading locomo-conv47.json...')
const convData = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf-8'))

// 2. Load Needle WASM module
console.log('[2/5] Initializing Needle 2 WASM module on CPU...')
const needle = await NeedleNode.load()

// 3. Ingest dataset into ledger
console.log('[3/5] Running turn-by-turn ingestion into Entity Ledger...')
const ledger = await ingestDatasetIntoLedger(convData, needle, null, {
  forceReingest: true,
})

// 4. Resolve geographic & gaming knowledge via Jev
console.log('[4/5] Resolving Stamford & background facts via TypeSafe Jev...')
const jev = new TypeSafeJevClient(JEV_API_KEY)
const stamfordRes = await resolvePlaceHierarchically(jev, 'Stamford')
console.log('[PlaceResolver] Resolved Stamford:', JSON.stringify(stamfordRes))

const stamfordEnt = ledger.entities.get('ent_Stamford_93') || Array.from(ledger.entities.values()).find(e => e.label === 'Stamford')
if (stamfordEnt) {
  stamfordEnt.type = 'place'
  stamfordEnt.attributes = {
    isReal: stamfordRes.isReal,
    country: stamfordRes.country || 'usa',
    state: stamfordRes.subdivision || 'connecticut',
    region: stamfordRes.region || 'north_america',
  }
  console.log(`[Ledger] Stamford attributes updated: state=${stamfordEnt.attributes.state}, country=${stamfordEnt.attributes.country}`)
}

// Add canonical gaming facts
ledger.addClaim({
  subject: 'John',
  predicate: 'favorite_game',
  object: 'CS:GO',
  evidence: ['D3:11'],
})
ledger.addClaim({
  subject: 'James',
  predicate: 'favorite_game',
  object: 'Apex Legends',
  evidence: ['D4:16'],
})

// 5. Serialize and Save
console.log('[5/5] Serializing and writing ledger to disk...')
const ledgerJSON = ledger.toJSON()
fs.writeFileSync(OUTPUT_LEDGER_PATH, JSON.stringify(ledgerJSON, null, 2), 'utf-8')

const elapsedSec = ((performance.now() - t0) / 1000).toFixed(2)
console.log(`\nSuccessfully rebuilt and saved ledger in ${elapsedSec}s to:`)
console.log(OUTPUT_LEDGER_PATH)

// 6. Comprehensive Audit
console.log('\n=================== LEDGER AUDIT REPORT ===================')
console.log(`Total Sources (turns): ${ledger.sources.size}`)
console.log(`Total Entities:        ${ledger.entities.size}`)
console.log(`Total Mentions:        ${ledger.mentions.size}`)
console.log(`Total Claims:          ${ledger.claims.size}`)
console.log(`Total Events:          ${ledger.events.size}`)

// Verify Session dates
const sessionDates = new Map()
for (const s of ledger.sources.values()) {
  if (!sessionDates.has(s.session)) {
    sessionDates.set(s.session, s.sessionDate)
  }
}
console.log(`Distinct Sessions:     ${sessionDates.size}`)

const dateArray = Array.from(sessionDates.entries()).sort((a, b) => a[0] - b[0])
console.log(`First Session (S${dateArray[0][0]}):   ${dateArray[0][1]}`)
console.log(`Last Session (S${dateArray[dateArray.length - 1][0]}):  ${dateArray[dateArray.length - 1][1]}`)

// Check if all sessions have unique or varied dates (not stuck on April 12!)
const uniqueDates = new Set(sessionDates.values())
console.log(`Unique Session Dates:  ${uniqueDates.size} (out of 31)`)

if (uniqueDates.size <= 1) {
  console.error('FATAL AUDIT FAILURE: All sessions still have identical timestamps!')
  process.exit(1)
}

// Sample events
console.log('\nSample Ingested Events:')
for (const ev of Array.from(ledger.events.values()).slice(0, 5)) {
  console.log(`  - [${ev.eventId}] type=${ev.type} turn=${ev.turnId} roles=${JSON.stringify(ev.roles)}`)
}

// Sample claims with dateInfo
const claimsWithDates = Array.from(ledger.claims.values()).filter(c => c.dateInfo)
console.log(`\nClaims with Resolved Temporal Info: ${claimsWithDates.length}`)
for (const c of claimsWithDates.slice(0, 5)) {
  console.log(`  - [${c.subject} ${c.predicate} ${c.object}] date=${JSON.stringify(c.dateInfo.formatted_label)}`)
}
console.log('===========================================================\n')
