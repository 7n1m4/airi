/**
 * Provider Probe: Queries /models across all configured providers.
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

async function probe() {
  const credsPath = path.resolve(process.cwd(), 'credentials.json')
  const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'))

  console.info('=== Probing Provider Endpoints for Available Models ===\n')

  for (const [key, p] of Object.entries<any>(creds)) {
    console.info(`\n------------------------------------------------------`)
    console.info(`[${key}] ${p.name} (${p.baseUrl})`)
    console.info(`------------------------------------------------------`)

    const url = `${p.baseUrl.replace(/\/+$/, '')}/models`
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${p.apiKey}`,
        },
      })
      if (!res.ok) {
        console.info(`  ✗ HTTP ${res.status}: ${res.statusText}`)
        continue
      }
      const data = await res.json()
      const models = data.data || data.models || data
      if (Array.isArray(models)) {
        console.info(`  ✓ Found ${models.length} models. Sample:`)
        const sample = models.slice(0, 8).map((m: any) => m.id || m.name || m)
        console.info(`    ${sample.join(', ')}`)
      }
      else {
        console.info(`  ✓ Response object:`, Object.keys(data))
      }
    }
    catch (err: any) {
      console.info(`  ✗ Error probing: ${err.message}`)
    }
  }
}

probe().catch(console.error)
