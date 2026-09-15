/**
 * Live health probe for the Official Model Context Protocol Registry.
 *
 * Validates endpoint availability, latency, response schema, and detects
 * HTTP deprecation/sunset headers to prevent silent upstream catalog failures.
 *
 * Usage:
 *   pnpm run test:mcp-registry
 *   tsx scripts/tests/test-mcp-registry-health.ts
 */

const REGISTRY_BASE_URL = 'https://registry.modelcontextprotocol.io/v0.1/servers'

async function probeMcpRegistry() {
  console.log(`🔌 [MCP Registry Probe] Probing ${REGISTRY_BASE_URL}...`)

  // Step 1: Lightweight HEAD request for endpoint liveness & deprecation headers
  const headStart = performance.now()
  let headRes: Response
  try {
    headRes = await fetch(REGISTRY_BASE_URL, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'AIRI-Health-Probe/1.0',
      },
    })
  }
  catch (error) {
    console.error('❌ [MCP Registry Probe] Network connection failed:', error)
    process.exit(1)
  }

  const headLatency = Math.round(performance.now() - headStart)

  if (!headRes.ok) {
    console.error(`❌ [MCP Registry Probe] HEAD request returned HTTP ${headRes.status} (${headRes.statusText})`)
    process.exit(1)
  }

  const sunsetHeader = headRes.headers.get('sunset')
  const deprecationHeader = headRes.headers.get('deprecation')

  if (sunsetHeader || deprecationHeader) {
    console.warn(`⚠️ [MCP Registry Probe] Deprecation warning detected! Sunset: ${sunsetHeader || 'N/A'}, Deprecation: ${deprecationHeader || 'N/A'}`)
  }

  console.log(`  ✓ HEAD liveness check passed in ${headLatency}ms (HTTP ${headRes.status})`)

  // Step 2: Sample GET request verifying latest version filter and schema
  const getUrl = new URL(REGISTRY_BASE_URL)
  getUrl.searchParams.set('version', 'latest')
  getUrl.searchParams.set('limit', '1')

  const getStart = performance.now()
  let getRes: Response
  try {
    getRes = await fetch(getUrl.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'AIRI-Health-Probe/1.0',
      },
    })
  }
  catch (error) {
    console.error('❌ [MCP Registry Probe] GET request failed:', error)
    process.exit(1)
  }

  const getLatency = Math.round(performance.now() - getStart)

  if (!getRes.ok) {
    console.error(`❌ [MCP Registry Probe] GET request returned HTTP ${getRes.status} (${getRes.statusText})`)
    process.exit(1)
  }

  const data = await getRes.json()

  if (!data || !Array.isArray(data.servers)) {
    console.error('❌ [MCP Registry Probe] Unexpected JSON schema: missing `servers` array', data)
    process.exit(1)
  }

  if (data.servers.length === 0) {
    console.warn('⚠️ [MCP Registry Probe] Registry returned 0 servers.')
  }
  else {
    const sample = data.servers[0]?.server || data.servers[0]
    console.log(`  ✓ GET payload check passed in ${getLatency}ms. Sample server: "${sample?.name || 'unknown'}" (${sample?.title || 'no title'})`)
  }

  console.log(`✅ [MCP Registry Probe] Official MCP Registry is healthy (Total RTT: ${headLatency + getLatency}ms)`)
}

probeMcpRegistry().catch((err) => {
  console.error('❌ [MCP Registry Probe] Fatal error:', err)
  process.exit(1)
})
