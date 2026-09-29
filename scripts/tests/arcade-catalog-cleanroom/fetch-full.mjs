/**
 * Fetch Complete 8,924 MS-DOS Games Catalog from Internet Archive (Archive.org)
 * Collection: softwarelibrary_msdos_games
 * Sorted by: downloads desc
 */

import fs from 'node:fs'
import path from 'node:path'

import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')
const OUTPUT_FILE = path.join(DATA_DIR, 'catalog-full.json')

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

async function fetchFullCatalog() {
  console.log('Fetching complete MS-DOS games collection from Internet Archive...')
  const query = 'collection:(softwarelibrary_msdos_games) AND mediatype:(software)'
  const fields = ['identifier', 'title', 'year', 'downloads', 'description', 'genre'].join(',')

  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=${fields}&sort[]=downloads+desc&rows=10000&page=1&output=json`

  const t0 = performance.now()
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch from Archive.org: HTTP ${res.status}`)
  }

  const json = await res.json()
  const docs = json.response?.docs || []
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1)

  console.log(`Fetched ${docs.length} games in ${elapsed}s!`)

  const normalized = docs.map((doc, idx) => ({
    rank: idx + 1,
    identifier: doc.identifier,
    title: doc.title || doc.identifier,
    year: doc.year ? Number(doc.year) : undefined,
    downloads: doc.downloads || 0,
    description: doc.description || '',
  }))

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(normalized, null, 2), 'utf8')
  console.log(`Saved full catalog to ${OUTPUT_FILE} (${(fs.statSync(OUTPUT_FILE).size / 1024 / 1024).toFixed(2)} MB)`)
}

fetchFullCatalog().catch((err) => {
  console.error('Error fetching full catalog:', err)
  process.exit(1)
})
