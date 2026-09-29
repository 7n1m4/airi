/**
 * Fetch Top 1,000 MS-DOS Games from Internet Archive (Archive.org)
 * Collection: softwarelibrary_msdos_games
 * Sorted by: downloads desc
 */

import fs from 'node:fs'
import path from 'node:path'

import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')
const OUTPUT_FILE = path.join(DATA_DIR, 'catalog-1000.json')

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

async function fetchTop1000Games() {
  console.log('Connecting to Internet Archive Advanced Search API...')
  const query = 'collection:(softwarelibrary_msdos_games) AND mediatype:(software)'
  const fields = ['identifier', 'title', 'year', 'downloads', 'description', 'genre'].join(',')

  // Archive.org allows fetching up to 1000 rows per request
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=${fields}&sort[]=downloads+desc&rows=1000&page=1&output=json`

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch from Archive.org: HTTP ${res.status}`)
  }

  const json = await res.json()
  const totalFound = json.response?.numFound || 0
  const docs = json.response?.docs || []

  console.log(`Archive.org Collection Size: ${totalFound} total items`)
  console.log(`Fetched top ${docs.length} games (sorted by downloads desc)`)

  const normalized = docs.map((doc, idx) => ({
    rank: idx + 1,
    identifier: doc.identifier,
    title: doc.title || doc.identifier,
    year: doc.year ? Number(doc.year) : undefined,
    downloads: doc.downloads || 0,
    description: doc.description || '',
  }))

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(normalized, null, 2), 'utf8')
  console.log(`Saved catalog to ${OUTPUT_FILE} (${(fs.statSync(OUTPUT_FILE).size / 1024 / 1024).toFixed(2)} MB)`)
}

fetchTop1000Games().catch((err) => {
  console.error('Error fetching catalog:', err)
  process.exit(1)
})
