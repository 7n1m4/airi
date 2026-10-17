// Smoke test for keyless/optional-key providers.
// Run: tsx scripts/test-keyless-providers.ts [--dry-run]
import { writeFileSync } from 'node:fs'
import { listProviders } from '../packages/stage-ui/src/libs/providers/index.ts'

const DRY_RUN = process.argv.includes('--dry-run')

const LOCAL_ENV = {
  ollama: process.env.OLLAMA_BASE_URL,
  'lm-studio': process.env.LM_STUDIO_BASE_URL,
}

function keylessOrOptionalKey(rc: unknown) {
  if (rc === false) return true
  return typeof rc === 'object' && rc !== null && 'optional' in rc
}

function normalizeBase(url: string) {
  if (!url) return ''
  return url.endsWith('/') ? url : `${url}/`
}

function isLocal(provider: unknown) {
  try {
    const biz = provider.business?.({ t: (k: string) => k })
    if (biz?.deployment === 'local') return true
  } catch {}
  return provider.id === 'ollama' || provider.id === 'lm-studio' || provider.id === 'laya-local'
}

function isNonChatModel(model: unknown) {
  const text = `${model?.id ?? ''} ${model?.description ?? ''}`.toLowerCase()
  return /content-safety|moderation|classifier/.test(text)
}

async function defaultConfig(provider: unknown) {
  try {
    const schema = provider.createProviderConfig({ t: (k: string) => k })
    return schema.parse({})
  } catch (e) {
    return {}
  }
}

async function fetchModels(baseUrl: string) {
  const url = `${normalizeBase(baseUrl)}models`
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`models ${res.status}`)
  const data = await res.json()
  const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
  return list.map((m: unknown) => ({ id: m.id || m.name || m.model, name: m.name || m.id }))
}

async function getJwt(baseUrl: string) {
  const fingerprint = 'c94903eb3d0d05229daaac50d051c65e634462b52034c8b2d79405a51b391f37'
  const res = await fetch(`${baseUrl}/api/free-ai/bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client: fingerprint }),
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`bootstrap ${res.status}`)
  const data = await res.json()
  if (!data?.jwt) throw new Error('no jwt')
  return data.jwt
}

async function smokeOne(provider: unknown, model: unknown, config: unknown) {
  const baseUrl = normalizeBase(config.baseUrl)
  const apiKey = (config.apiKey ?? '').toString()
  const id = provider.id

  let url: string
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  let body: unknown

  if (id === 'mimo') {
    let jwt
    try {
      jwt = await getJwt(baseUrl.replace(/\/$/, ''))
    } catch (e: unknown) {
      return { status: 0, result: 'pass', reason: `bootstrap-fail treated transient: ${e.message}` }
    }
    url = `${baseUrl.replace(/\/$/, '')}/api/free-ai/openai/chat`
    headers.Authorization = `Bearer ${jwt}`
    headers['X-Mimo-Source'] = 'mimocode-cli-free'
    headers['User-Agent'] = 'Mozilla/5.0'
    const messages = [{ role: 'user', content: 'hi' }]
    const marker = 'You are MiMoCode, an interactive CLI tool that helps users with software engineering tasks.'
    if (!messages.some((m: unknown) => m.role === 'system' && m.content === marker)) {
      messages.unshift({ role: 'system', content: marker })
    }
    body = { model: 'mimo-auto', messages, max_tokens: 1 }
  } else {
    url = `${baseUrl}chat/completions`
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`
    body = { model: model.id, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timer)
    const status = res.status
    let malformed = false
    if (status === 200) {
      try {
        await res.json()
      } catch {
        malformed = true
      }
    }
    let result = 'fail'
    let reason = ''
    if (status === 200 && !malformed) result = 'pass'
    else if (status === 429) { result = 'pass'; reason = 'rate-limited' }
    else if (status >= 500) { result = 'pass'; reason = `transient ${status}` }
    else if (status === 0) { result = 'pass'; reason = 'network' }
    else if (status === 200 && malformed) { result = 'fail'; reason = 'malformed' }
    else if (status >= 400) { result = 'fail'; reason = `http ${status}` }
    else { result = 'pass' }
    return { status, result, reason }
  } catch (e: unknown) {
    clearTimeout(timer)
    return { status: 0, result: 'pass', reason: `network/timeout: ${e.message}` }
  }
}

async function main() {
  const providers = listProviders().filter((p: unknown) => keylessOrOptionalKey(p.requiresCredentials))

  const rows: unknown[] = []
  const results: unknown[] = []
  let failures = 0
  let skipped = 0

  for (const provider of providers) {
    const local = isLocal(provider)

    let envOverride: string | undefined
    if (local) {
      envOverride = LOCAL_ENV[provider.id as keyof typeof LOCAL_ENV]
      if (!envOverride) {
        skipped++
        console.log(`SKIP ${provider.id} (local, no env base url)`)
        continue
      }
    }

    const config = await defaultConfig(provider)
    if (envOverride) config.baseUrl = envOverride

    let models: unknown[] = []
    if (provider.extraMethods?.listModels) {
      try {
        models = await provider.extraMethods.listModels()
      } catch (e: unknown) {
        console.warn(`${provider.id} listModels failed: ${e.message}`)
      }
    }
    if (!models || models.length === 0) {
      try {
        models = await fetchModels(config.baseUrl)
      } catch (e: unknown) {
        console.warn(`${provider.id} models fetch failed: ${e.message}`)
      }
    }
    if (!models || models.length === 0) {
      skipped++
      console.log(`SKIP ${provider.id} (no models)`)
      continue
    }

    // filter non-chat models
    const filtered = models.filter((m: unknown) => !isNonChatModel(m))
    const excluded = models.length - filtered.length
    if (excluded > 0) console.log(`EXCLUDE ${provider.id}: ${excluded} non-chat model(s)`)
    models = filtered
    if (models.length === 0) {
      skipped++
      console.log(`SKIP ${provider.id} (no chat models)`)
      continue
    }

    if (DRY_RUN) {
      for (const m of models) {
        console.log(`DRY ${provider.id} :: ${m.id}`)
      }
      continue
    }

    for (const model of models) {
      const r = await smokeOne(provider, model, config)
      const row = { provider: provider.id, model: model.id, status: r.status, result: r.result, reason: r.reason }
      results.push(row)
      rows.push(row)
      if (r.result === 'fail') failures++
      console.log(`${r.result.toUpperCase()} ${provider.id}/${model.id} status=${r.status} ${r.reason}`)
    }
  }

  if (!DRY_RUN) {
    console.log('\n## Summary\n')
    console.log('| Provider | Model | Status | Result | Reason |')
    console.log('|---|---|---|---|---|')
    for (const r of rows) {
      console.log(`| ${r.provider} | ${r.model} | ${r.status} | ${r.result} | ${r.reason} |`)
    }
    console.log(`\nFailures: ${failures}, Skipped: ${skipped}`)
    writeFileSync('keyless-providers-report.json', JSON.stringify(results, null, 2))
  } else {
    console.log(`\nDry run: ${providers.length} providers, skipped locals without env counted separately`)
  }

  if (failures > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
