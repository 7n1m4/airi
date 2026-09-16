#!/usr/bin/env node

/**
 * Sync Free AI Platforms Registry
 *
 * Extracts and synthesizes authoritative platform endpoints, portal links,
 * and capability flags directly from upstream FreeLLMAPI source files:
 *  - server/src/providers/index.ts (and individual provider classes)
 *  - client/src/components/keys/shared.tsx (PLATFORMS catalog)
 *
 * Runs via mock harness in Node/tsx without running external servers.
 *
 * Usage:
 *   tsx scripts/sync-free-ai-platforms.ts
 *   tsx scripts/sync-free-ai-platforms.ts --source ../freellmapi
 */

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const OUTPUT_FILE = path.resolve(REPO_ROOT, 'packages/stage-ui/src/assets/free-ai-platforms.json')

const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/tashfeenahmed/freellmapi/main'

export interface FreeAIPlatformMeta {
  id: string
  name: string
  baseUrl: string
  signupUrl: string
  keyless?: boolean
  validateUrl?: string | null
  extraHeaders?: Record<string, string> | null
  timeoutMs?: number | null
  note?: string | null
}

// Fallback registry for dedicated subclasses if network is unavailable or offline
const DEDICATED_SUBPROVIDERS: Record<string, Partial<FreeAIPlatformMeta>> = {
  google: { name: 'Google AI Studio', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  cohere: { name: 'Cohere', baseUrl: 'https://api.cohere.ai/compatibility/v1' },
  cloudflare: { name: 'Cloudflare Workers AI', baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1' },
  aihorde: { name: 'AI Horde', baseUrl: 'https://aihorde.net/api/v2', keyless: true },
  modelscope: { name: 'ModelScope', baseUrl: 'https://api-inference.modelscope.cn/v1' },
  pollinations: { name: 'Pollinations', baseUrl: 'https://gen.pollinations.ai/v1' },
  zhipu: { name: 'Z.ai (Zhipu)', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  sail: { name: 'Sail Research', baseUrl: 'https://api.sailresearch.com/v1' },
  electronhub: { name: 'ElectronHub', baseUrl: 'https://api.electronhub.ai/v1', validateUrl: 'https://api.electronhub.ai/v1/user/me' },
  experiential: { name: 'Experiential Labs', baseUrl: 'https://api.experientiallabs.ai/v1' },
  router9: { name: 'Router9', baseUrl: 'https://api.router9.com/v1' },
  septor: { name: 'Septor Labs', baseUrl: 'https://api.septorlabs.com/v1' },
  clod: { name: 'CLōD', baseUrl: 'https://api.clod.io/v1' },
  speechify: { name: 'Speechify', baseUrl: 'https://api.speechify.ai/v1' },
  blaze: { name: 'BlazeAPI', baseUrl: 'https://api.blazeapi.org/paid/v1', validateUrl: 'https://api.blazeapi.org/paid/v1/usage' },
  lucidity: { name: 'Lucidity Composite', baseUrl: 'https://composite.lucidity.sh/v1' },
  airforce: { name: 'Api.Airforce', baseUrl: 'https://api.airforce/v1' },
  dreamprompting: { name: 'DreamPrompting', baseUrl: 'https://dreamprompting.com/api/v1' },
  waterfall: { name: 'Waterfall', baseUrl: 'https://api.getwaterfall.org/v1' },
  logfare: { name: 'Logfare', baseUrl: 'https://logfare.ai/v1' },
}

async function fetchOrReadFile(relPath: string, localSourceDir?: string): Promise<string> {
  if (localSourceDir) {
    const full = path.resolve(localSourceDir, relPath)
    if (fs.existsSync(full)) {
      return fs.readFileSync(full, 'utf8')
    }
  }

  const url = `${GITHUB_RAW_BASE}/${relPath}`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 AIRI-Sync/1.0' } })
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`)
  }
  return await res.text()
}

/**
 * Execute server/src/providers/index.ts in a mock harness
 */
function extractProvidersFromIndex(indexTsContent: string): Map<string, any> {
  const extracted = new Map<string, any>()

  class MockOpenAICompatProvider {
    constructor(opts: any) {
      if (opts?.platform) {
        extracted.set(opts.platform, { ...opts })
      }
    }
  }

  class MockSubProvider {
    constructor(platform: string, defaultMeta: Partial<FreeAIPlatformMeta>, opts: any = {}) {
      extracted.set(platform, {
        platform,
        name: defaultMeta.name || platform,
        baseUrl: defaultMeta.baseUrl || `https://api.${platform}.ai/v1`,
        validateUrl: defaultMeta.validateUrl || null,
        keyless: defaultMeta.keyless || false,
        ...opts,
      })
    }
  }

  // Pre-seed dedicated subproviders
  for (const [slug, meta] of Object.entries(DEDICATED_SUBPROVIDERS)) {
    extracted.set(slug, {
      platform: slug,
      name: meta.name || slug,
      baseUrl: meta.baseUrl || `https://api.${slug}.ai/v1`,
      validateUrl: meta.validateUrl || null,
      keyless: meta.keyless || false,
    })
  }

  // Transpile index.ts TypeScript to CommonJS
  const js = ts.transpileModule(indexTsContent, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText

  const exportsObj: Record<string, any> = {}
  const sandbox = {
    exports: exportsObj,
    module: { exports: exportsObj },
    require: (mod: string) => {
      if (mod.includes('openai-compat')) {
        return { OpenAICompatProvider: MockOpenAICompatProvider }
      }
      // Extract module slug without path or extension (e.g. './electronhub.js' -> 'electronhub')
      const slug = mod.replace(/^\.\//, '').replace(/\.js$/, '').toLowerCase()
      const meta = DEDICATED_SUBPROVIDERS[slug] || {}
      const MockClass = class {
        constructor(opts: any) {
          return new MockSubProvider(slug, meta, opts)
        }
      }
      return new Proxy({}, {
        get: (_target, _prop) => MockClass,
      })
    },
  }

  const context = vm.createContext(sandbox)
  vm.runInContext(js, context)

  return extracted
}

/**
 * Execute client/src/components/keys/shared.tsx in a mock harness
 */
function extractPlatformsFromShared(sharedTsxContent: string): Array<{ value: string, label: string, url: string, keyless?: boolean }> {
  const js = ts.transpileModule(sharedTsxContent, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText

  const exportsObj: Record<string, any> = {}
  const sandbox = {
    exports: exportsObj,
    module: { exports: exportsObj },
    require: () => ({
      useI18n: () => ({ t: (s: string) => s }),
      ExternalLink: () => null,
    }),
  }

  const context = vm.createContext(sandbox)
  vm.runInContext(js, context)

  return exportsObj.PLATFORMS || []
}

async function main() {
  const args = process.argv.slice(2)
  let localSourceDir: string | undefined
  const srcIndex = args.indexOf('--source')
  if (srcIndex !== -1 && args[srcIndex + 1]) {
    localSourceDir = path.resolve(args[srcIndex + 1])
    console.log(`📂 Using local FreeLLMAPI source directory: ${localSourceDir}`)
  }
  else {
    console.log(`🌐 Fetching latest FreeLLMAPI source from GitHub (${GITHUB_RAW_BASE})...`)
  }

  console.log('⏳ Reading server/src/providers/index.ts...')
  const indexContent = await fetchOrReadFile('server/src/providers/index.ts', localSourceDir)

  console.log('⏳ Reading client/src/components/keys/shared.tsx...')
  const sharedContent = await fetchOrReadFile('client/src/components/keys/shared.tsx', localSourceDir)

  console.log('⚙️  Mounting mock execution harness for provider registrations...')
  const providersMap = extractProvidersFromIndex(indexContent)
  console.log(`   Found ${providersMap.size} provider configurations in server registry.`)

  console.log('⚙️  Mounting mock execution harness for client PLATFORMS table...')
  const platformsList = extractPlatformsFromShared(sharedContent)
  console.log(`   Found ${platformsList.length} platform definitions in client shared UI catalog.`)

  console.log('🧩 Merging and synthesizing platform metadata...')
  const result: Record<string, FreeAIPlatformMeta> = {}

  // Merge client platforms first
  for (const item of platformsList) {
    const slug = item.value
    if (slug === 'custom' || slug === 'sambanova')
      continue // Skip custom and retired

    const providerConfig = providersMap.get(slug) || {}

    // Extract clean name and optional note from label
    let cleanName = item.label
    let note: string | null = null
    const parenIndex = cleanName.indexOf('(')
    if (parenIndex !== -1) {
      note = cleanName.slice(parenIndex + 1).replace(/\)$/, '').trim()
      cleanName = cleanName.slice(0, parenIndex).trim()
    }

    const baseUrl = providerConfig.baseUrl || `https://api.${slug}.ai/v1`

    result[slug] = {
      id: slug,
      name: providerConfig.name || cleanName,
      baseUrl,
      signupUrl: item.url,
      keyless: !!(item.keyless || providerConfig.keyless),
      validateUrl: providerConfig.validateUrl || null,
      extraHeaders: providerConfig.extraHeaders || null,
      timeoutMs: providerConfig.timeoutMs || null,
      note: note || null,
    }
  }

  // Check if any server providers were missing in client PLATFORMS
  for (const [slug, providerConfig] of providersMap.entries()) {
    if (slug === 'custom' || result[slug])
      continue

    result[slug] = {
      id: slug,
      name: providerConfig.name || slug.charAt(0).toUpperCase() + slug.slice(1),
      baseUrl: providerConfig.baseUrl || `https://api.${slug}.ai/v1`,
      signupUrl: `https://${slug}.ai`,
      keyless: !!providerConfig.keyless,
      validateUrl: providerConfig.validateUrl || null,
      extraHeaders: providerConfig.extraHeaders || null,
      timeoutMs: providerConfig.timeoutMs || null,
      note: null,
    }
  }

  // Sort keys alphabetically for stable git diffs
  const sortedKeys = Object.keys(result).sort()
  const sortedResult: Record<string, FreeAIPlatformMeta> = {}
  for (const k of sortedKeys) {
    sortedResult[k] = result[k]
  }

  // Ensure output directory exists
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true })
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(sortedResult, null, 2)}\n`, 'utf8')

  console.log(`\n✅ Successfully generated ${OUTPUT_FILE}`)
  console.log(`📊 Total platforms cataloged: ${sortedKeys.length}`)
  console.log(`🔑 Keyless platforms: ${sortedKeys.filter(k => sortedResult[k].keyless).join(', ')}`)
  console.log(`🚀 Ready for import in stage-ui free-ai-catalog store.`)
}

main().catch((err) => {
  console.error('❌ Error executing sync-free-ai-platforms:', err)
  process.exit(1)
})
