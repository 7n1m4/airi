#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Deterministic port-manifest generator for the native desktop app.
// Writes markdown files into docs/port-manifest/.
// Usage: node scripts/gen-manifest/gen-manifest.mjs

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..', '..')
const outDir = join(root, 'docs', 'port-manifest')

const REPO = {
  rendererPages: join(root, 'apps', 'stage-tamagotchi', 'src', 'renderer', 'pages'),
  rendererStores: join(root, 'apps', 'stage-tamagotchi', 'src', 'renderer', 'stores'),
  mainWindows: join(root, 'apps', 'stage-tamagotchi', 'src', 'main', 'windows'),
  electronMain: join(root, 'apps', 'stage-tamagotchi', 'src'),
  eventa: join(root, 'apps', 'stage-tamagotchi', 'src', 'shared', 'eventa.ts'),
  providers: join(root, 'packages', 'stage-ui', 'src', 'libs', 'providers', 'providers'),
  providerRegistry: join(root, 'packages', 'stage-ui', 'src', 'libs', 'providers', 'providers', 'registry.ts'),
  stagePagesPages: join(root, 'packages', 'stage-pages', 'src', 'pages'),
  stageUiStores: join(root, 'packages', 'stage-ui', 'src', 'stores'),
  settingsScenarios: join(root, 'packages', 'stage-ui', 'src', 'components', 'scenarios', 'settings'),
  stageUiSettingsStores: join(root, 'packages', 'stage-ui', 'src', 'stores', 'settings'),
  locales: join(root, 'packages', 'i18n', 'src', 'locales'),
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'dist', 'build', '.nuxt', '.output', '.cache', 'out'])

function walk(dir, filter = () => true) {
  if (!existsSync(dir))
    return []
  const out = []
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry))
      continue
    const path = join(dir, entry)
    let stat
    try { stat = statSync(path) }
    catch { continue }
    if (stat.isDirectory())
      out.push(...walk(path, filter))
    else if (filter(path))
      out.push(path)
  }
  return out.sort()
}

function rel(p) { return relative(root, p).replaceAll('\\', '/') }
function write(name, content) {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, name), `${content.trimEnd()}\n`)
  console.log('wrote', join(outDir, name))
}
function heading(title, body) { return `# ${title}\n\n${body}` }

// ---------- minimal YAML leaf-key counter (mapping keys only; block scalars count as one leaf) ----------
function countYamlLeaves(text) {
  const lines = text.split('\n')
  let leaves = 0
  let blockIndent = -1 // indent of the key whose block scalar we are skipping
  for (const raw of lines) {
    if (blockIndent >= 0) {
      const t = raw.replace(/\s+$/, '')
      if (t === '' || t.trim() === '')
        continue
      const indent = t.match(/^\s*/)[0].length
      if (indent > blockIndent)
        continue // inside block scalar
      blockIndent = -1
    }
    const line = raw.replace(/\s+$/, '')
    if (line.trim() === '' || /^\s*#/.test(line))
      continue
    const m = line.match(/^(\s*)([\w.-]+):\s*(.*)$/)
    if (!m)
      continue
    const indent = m[1].length
    const rest = m[3].trim()
    if (rest === '|' || rest === '>' || rest.startsWith('|') || rest.startsWith('>')) {
      leaves += 1 // block scalar = one string value
      blockIndent = indent
      continue
    }
    if (rest === '')
      continue // nested mapping/sequence
    if (/^[-[{]/.test(rest) && rest.startsWith('-'))
      continue // sequence as value: count items below
    leaves += 1
  }
  return leaves
}

// ---------- tick sidecar (regeneration must never wipe manual ticks) ----------
const TICKS_FILE = () => join(outDir, 'features.ticks.json')

// Ticks are keyed by the source file path (unique, stable), not by route.
const WAIVERS_FILE = () => join(outDir, 'features.waivers.json')

// Waivers are keyed by source file path (same keyspace as ticks). A waived row
// is rendered as waived — it stays visible but is not an actionable gap.
function loadWaivers() {
  if (!existsSync(WAIVERS_FILE()))
    return {}
  try {
    return JSON.parse(readFileSync(WAIVERS_FILE(), 'utf8'))
  }
  catch (err) {
    console.error(`failed to parse ${WAIVERS_FILE()}: ${err.message}`)
    return {}
  }
}

function loadTicks() {
  if (existsSync(TICKS_FILE())) {
    try {
      return JSON.parse(readFileSync(TICKS_FILE(), 'utf8'))
    }
    catch (err) {
      console.error(`failed to parse ${TICKS_FILE()}: ${err.message}`)
      return {}
    }
  }
  // First run after the sidecar was introduced: migrate ticks from features.md.
  const current = join(outDir, 'features.md')
  const ticks = {}
  if (existsSync(current)) {
    for (const line of readFileSync(current, 'utf8').split('\n')) {
      const m = line.match(/^- \[x\].*`([^`]+)`\s*$/)
      if (m)
        ticks[m[1]] = true
    }
  }
  writeFileSync(TICKS_FILE(), `${JSON.stringify(ticks, null, 2)}\n`)
  return ticks
}

// ---------- features.md ----------
function features() {
  const renderer = walk(REPO.rendererPages, p => /\.(vue|ts|js)$/.test(p) && !/(^|\/)_/.test(p))
  const stagePages = walk(REPO.stagePagesPages, p => /\.(vue|ts|js)$/.test(p) && !/(^|\/)_/.test(p))

  const routeOf = (p, base, prefix) => {
    let r = rel(p).replace(prefix, '').replace(/\.(vue|ts|js)$/, '')
    r = r.replace(/\/index$/, '')
    if (r === '')
      r = 'index'
    return `/${r}`
  }

  // unplugin-vue-router configuration (electron.vite.config.ts):
  //   exclude: ['**/components/**'] (all page dirs) and four stage-pages excludes.
  // Only .vue files become routes; .ts/.js under pages are components/presets/tests.
  const ROUTE_EXTENSIONS = new Set(['.vue'])
  const ROUTE_EXCLUDED = new Set([
    'packages/stage-pages/src/pages/settings/connection/index.vue',
    'packages/stage-pages/src/pages/settings/system/general.vue',
    'packages/stage-pages/src/pages/settings/modules/mcp.vue',
    'packages/stage-pages/src/pages/settings/system/connection.vue',
  ])
  const isRoute = (p) => {
    const r = rel(p)
    if (!ROUTE_EXTENSIONS.has(r.slice(r.lastIndexOf('.'))))
      return false
    if (r.includes('/components/'))
      return false
    if (ROUTE_EXCLUDED.has(r))
      return false
    if (/(^|\/)_/.test(r))
      return false
    return true
  }

  const ticks = loadTicks()
  const waivers = loadWaivers()
  const entry = (p, prefix, tag) => {
    const path = rel(p)
    const route = routeOf(p, null, prefix)
    const waived = waivers[path]
    const box = waived ? '-' : ticks[path] ? 'x' : ' '
    const suffix = waived ? ` — waived: ${waived}` : ''
    return { line: `- [${box}] \`${route}\`${tag ? ` ${tag}` : ''} — \`${path}\`${suffix}`, path, isRoute: isRoute(p), waived: !!waived }
  }

  const routeItems = []
  const otherItems = []
  for (const p of renderer) (isRoute(p) ? routeItems : otherItems).push(entry(p, 'apps/stage-tamagotchi/src/renderer/pages/', ''))
  for (const p of stagePages) (isRoute(p) ? routeItems : otherItems).push(entry(p, 'packages/stage-pages/src/pages/', '(stage-pages)'))

  const md = heading(
    'Port Manifest — Features / Renderer Pages (boot order)',
    [
      'Generated by `scripts/gen-manifest/gen-manifest.mjs`. Best-effort mechanical extraction.',
      'Tick state lives in `features.ticks.json` (sidecar); regeneration preserves ticks. Edit the sidecar, not the checkboxes.',
      '',
      'Boot order note: the desktop renderer uses `vite-plugin-vue-router` auto-routes over `apps/stage-tamagotchi/src/renderer/pages/**` and `packages/stage-pages/src/pages/**` (order follows file-path sort at build time); `/onboarding-v3` is additionally gated by the startup flow. `**/components/**` files and four stage-pages paths are excluded from routing (see `electron.vite.config.ts`); `.ts`/`.js` files never route.',
      '',
      `Renderer routes: **${renderer.filter(isRoute).length}**`,
      `stage-pages routes: **${stagePages.filter(isRoute).length}**`,
      `Non-route files (components/composables/tests/presets): **${otherItems.length}**`,
      `Total: **${routeItems.length + otherItems.length}**`,
      `Waived (stay in Electron/web): **${routeItems.concat(otherItems).filter(i => i.waived).length}**`,
      '',
      '## Routes (auto-routable pages)',
      '',
      ...routeItems.filter(i => !i.waived).map(i => i.line),
      '',
      '## Non-route files (not auto-routed)',
      '',
      ...otherItems.filter(i => !i.waived).map(i => i.line),
      '',
      '## Waived (stay in Electron/web — user decision 2026-11-11)',
      '',
      ...routeItems.concat(otherItems).filter(i => i.waived).map(i => i.line),
    ].join('\n'),
  )
  write('features.md', md)
}

// ---------- windows.md ----------
function windows() {
  const files = walk(REPO.mainWindows, p => p.endsWith('index.ts') && !p.includes('/rpc/') && !p.includes('/shared/'))
  const items = []
  for (const f of files) {
    const relPath = rel(f)
    const name = relPath.replace(/^apps\/stage-tamagotchi\/src\/main\/windows\//, '').replace(/\/index\.ts$/, '')
    const text = readFileSync(f, 'utf8')
    const m = text.match(/new\s+BrowserWindow\s*\(\s*\{([\s\S]*?)\}\s*(?:,|\))/)
    const snippet = m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 700) : null
    const detected = []
    for (const token of ['width', 'height', 'x', 'y', 'frame', 'transparent', 'alwaysOnTop', 'skipTaskbar', 'show', 'focusable', 'resizable', 'fullscreen', 'modal', 'backgroundColor', 'icon', 'title', 'webPreferences', 'hasShadow', 'roundedCorners', 'hiddenInMissionControl', 'visibleOnAllWorkspaces']) {
      if (new RegExp(`\\b${token}\\s*:`).test(text))
        detected.push(token)
    }
    const ready = /ready-to-show|whenReady/.test(text) ? 'yes' : 'no'
    items.push({ name, relPath, snippet, detected, ready })
  }
  items.sort((a, b) => a.name.localeCompare(b.name))
  const md = heading(
    'Port Manifest — Electron BrowserWindow Surfaces',
    [
      'Generated from `apps/stage-tamagotchi/src/main/windows/**/index.ts`.',
      'The 13 named surfaces map onto this inventory; RPC helper files (`*/rpc/index.electron.ts`) are grouped under each window entry.',
      '',
      `Total window definitions: **${items.length}**`,
      '',
      ...items.flatMap(it => [
        `- [ ] **${it.name}** — \`${it.relPath}\``,
        `  - detected flags: ${it.detected.length ? it.detected.join(', ') : 'none'}`,
        `  - ready-to-show handling: ${it.ready}`,
        `  - constructor: \`${(it.snippet ?? 'not found (created via shared helper)').replaceAll('`', '\'')}\``,
        '',
      ]),
    ].join('\n'),
  )
  write('windows.md', md)
}

// ---------- settings-panels.md ----------
function extractBindings(text) {
  const tokens = new Set()
  for (const m of text.matchAll(/\buse([A-Za-z0-9]+)Store\b/g)) tokens.add(`use${m[1]}Store`)
  for (const m of text.matchAll(/\bsettings\.([\w.-]+)/g)) tokens.add(`settings.${m[1]}`)
  for (const m of text.matchAll(/\bstores\/[\w./-]+/g)) tokens.add(m[0])
  return [...tokens].sort()
}

function settingsPanels() {
  const pageFiles = walk(`${REPO.rendererPages}/settings`, p => /\.(vue|ts|js)$/.test(p))
  const compFiles = walk(REPO.settingsScenarios, p => /\.(vue|ts|js|tsx)$/.test(p))
  const settingsStoreFiles = walk(REPO.stageUiSettingsStores, p => p.endsWith('.ts') && !p.endsWith('.test.ts'))
  const rendererSettingsStores = walk(REPO.rendererStores, p => /settings/.test(p) && p.endsWith('.ts') && !p.endsWith('.test.ts'))

  const block = (title, files) => {
    const rows = files.map((f) => {
      const text = readFileSync(f, 'utf8')
      const bindings = extractBindings(text)
      const bind = bindings.length ? bindings.slice(0, 12).join(', ') : '(no store bindings parsed)'
      return `- [ ] \`${rel(f)}\`\n  - bindings: ${bind}`
    })
    return [`## ${title}`, '', `Total: **${rows.length}**`, '', ...rows].join('\n')
  }

  const md = heading(
    'Port Manifest — Settings Panels / Sections',
    [
      'Generated from renderer settings pages, stage-ui settings scenario components, and settings stores.',
      '`bindings:` is a best-effort regex extraction of `use*Store` references, `settings.*` keys, and store import paths — verify against source during port.',
      '',
      block('Renderer Settings Pages (`apps/stage-tamagotchi/src/renderer/pages/settings`)', pageFiles),
      '',
      block('Stage-UI Settings Scenario Components (`packages/stage-ui/src/components/scenarios/settings`)', compFiles),
      '',
      block('Settings Stores (`packages/stage-ui/src/stores/settings`)', settingsStoreFiles),
      '',
      block('Renderer Settings Stores (`apps/stage-tamagotchi/src/renderer/stores`)', rendererSettingsStores),
    ].join('\n'),
  )
  write('settings-panels.md', md)
}

// ---------- ipc-channels.md ----------
function ipcChannels() {
  const text = readFileSync(REPO.eventa, 'utf8')
  const exported = [...text.matchAll(/export\s+const\s+(\w+)\s*=\s*define(Invoke)?Eventa/g)].map(m => m[1]).sort()
  const channels = [...text.matchAll(/'([^']+)'/g)].map(m => m[1]).filter(s => s.includes(':')).sort()
  const channelSet = new Set(channels)

  const domains = [
    ['window/settings/caption/chat/customizer/splash/onboarding/about/notice/widgets/devtools/dashboard/inlay', ['window', 'settings', 'caption', 'chat', 'customizer', 'splash', 'onboarding', 'about', 'notice', 'widget', 'devtool', 'dashboard', 'inlay', 'stage']],
    ['plugin', ['plugin']],
    ['server-channel', ['server-channel']],
    ['beat-sync', ['beat-sync', 'beatsync']],
    ['notification/notice', ['notification', 'notice']],
    ['updater', ['update', 'updater']],
    ['screen capture / display', ['screen', 'capture', 'display']],
    ['tray', ['tray']],
    ['shortcut / hotkey', ['shortcut', 'hotkey', 'keybinding']],
    ['dialog / file', ['dialog', 'file']],
    ['acp / agent', ['acp', 'agent']],
    ['sync / auth', ['sync', 'auth', 'token']],
    ['mcp', ['mcp']],
  ]
  const byDomain = new Map(domains.map(([d]) => [d, []]))
  const ungrouped = []
  for (const c of exported) {
    const lc = c.toLowerCase()
    let hit = false
    for (const [domain, keys] of domains) {
      if (keys.some(k => lc.includes(k))) { byDomain.get(domain).push(c); hit = true; break }
    }
    if (!hit)
      ungrouped.push(c)
  }
  const sections = []
  for (const [domain, list] of byDomain) {
    if (list.length)
      sections.push(`## ${domain}\n\n${list.map(c => `- [ ] \`${c}\``).join('\n')}`)
  }
  if (ungrouped.length)
    sections.push(`## other\n\n${ungrouped.map(c => `- [ ] \`${c}\``).join('\n')}`)

  const md = heading(
    'Port Manifest — eventa / IPC Channels',
    [
      'Generated from `apps/stage-tamagotchi/src/shared/eventa.ts`.',
      '',
      `Exported eventa constants: **${exported.length}**; unique channel string literals containing \`:\`: **${channelSet.size}**`,
      '',
      'Raw channel literals:',
      '',
      ...[...channelSet].map(c => `- [ ] \`${c}\``),
      '',
      'Exported constants grouped by domain:',
      '',
      ...sections,
    ].join('\n'),
  )
  write('ipc-channels.md', md)
}

// ---------- providers.md ----------
function providers() {
  // provider ids = direct child dirs of providers/ containing index.ts (excludes registry.ts and test fixtures)
  const ids = []
  for (const entry of readdirSync(REPO.providers)) {
    const dir = join(REPO.providers, entry)
    let stat
    try { stat = statSync(dir) }
    catch { continue }
    if (!stat.isDirectory())
      continue
    const idx = join(dir, 'index.ts')
    if (!existsSync(idx))
      continue
    const text = readFileSync(idx, 'utf8')
    const labelMatch = text.match(/label:\s*'([^']+)'/)
    const label = labelMatch ? labelMatch[1] : entry
    const compatible = /createOpenAICompatible|openaiCompatible|openai-compatible|chat\/completions/.test(text)
    ids.push({ id: entry, label, compatible, source: rel(idx) })
  }
  ids.sort((a, b) => a.id.localeCompare(b.id))
  const indexText = existsSync(join(REPO.providers, 'index.ts')) ? readFileSync(join(REPO.providers, 'index.ts'), 'utf8') : ''
  const registered = [...indexText.matchAll(/import\s+'\.\/([a-z0-9-]+)'/g)].map(m => m[1]).sort()

  const md = heading(
    'Port Manifest — Providers',
    [
      'Generated from `packages/stage-ui/src/libs/providers/providers/<id>/index.ts`.',
      `Provider ids detected from directory layout: **${ids.length}**; registered import fleet in \`providers/index.ts\`: **${registered.length}** (${registered.join(', ')}).`,
      '',
      ...ids.map(p => `- [ ] \`${p.id}\` — ${p.label} — OpenAI-compatible: ${p.compatible ? 'yes' : 'no'} — source \`${p.source}\``),
    ].join('\n'),
  )
  write('providers.md', md)
}

// ---------- speech.md ----------
function speech() {
  const modules = walk(join(root, 'packages', 'stage-ui', 'src', 'stores'), p => /(speech|hearing|audio|tts|stt|vad|transcription|whisper|elevenlabs|voicevox|kokoro|moss)/i.test(p) && !p.endsWith('.test.ts') && !p.includes('/providers/'))
  const providerFiles = []
  for (const entry of readdirSync(REPO.providers)) {
    const dir = join(REPO.providers, entry)
    let stat
    try { stat = statSync(dir) }
    catch { continue }
    if (stat.isDirectory() && /(speech|tts|stt|transcription|whisper|elevenlabs|voice|audio|kokoro|moss|aliyun|voicevox)/i.test(entry)) {
      providerFiles.push(join(dir, 'index.ts'))
    }
  }
  const speechDirProviders = walk(join(root, 'packages', 'stage-ui', 'src', 'stores', 'providers'), p => /(speech|tts|stt|transcription|whisper|elevenlabs|voice|audio|kokoro|moss|aliyun|voicevox|web-speech-api|web-llm)/i.test(p) && !p.endsWith('.test.ts'))
  const items = [...new Set([...modules, ...providerFiles.filter(existsSync), ...speechDirProviders])].sort()
  const md = heading(
    'Port Manifest — Speech / Hearing / Audio (TTS · STT · VAD)',
    [
      'Generated from `packages/stage-ui/src/stores/modules/**` (module stores) and `providers/<id>` (provider libs).',
      '',
      'Pipeline shape: mic/system-audio capture → `hearing` store (`hearing-speech-input-pipeline`) → VAD (`vad` ai-model store) → STT (provider registry `transcription`) → chat LLM → TTS (provider registry `speech`) → `speech-runtime` playback queue → speaker.',
      '',
      `Total entries: **${items.length}**`,
      '',
      ...items.map(f => `- [ ] \`${rel(f)}\``),
    ].join('\n'),
  )
  write('speech.md', md)
}

// ---------- stores.md ----------
function groupStores(files, baseRel) {
  const groups = new Map()
  for (const f of files) {
    const r = rel(f).replace(baseRel, '')
    const parts = r.split('/')
    const domain = parts.length > 1 ? parts[0] : '(root)'
    if (!groups.has(domain))
      groups.set(domain, [])
    groups.get(domain).push(rel(f))
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

function stores() {
  const stageUi = walk(REPO.stageUiStores, p => p.endsWith('.ts') && !p.endsWith('.test.ts'))
  const renderer = walk(REPO.rendererStores, p => p.endsWith('.ts') && !p.endsWith('.test.ts'))

  const renderGroup = (title, groups) => {
    const sections = groups.map(([domain, files]) => {
      const items = files.sort().map(p => `- [ ] \`${p}\``)
      return `## ${domain} (${files.length})\n\n${items.join('\n')}`
    })
    return [`## ${title}`, '', ...sections].join('\n')
  }

  const md = heading(
    'Port Manifest — Pinia Stores',
    [
      'Generated from `packages/stage-ui/src/stores/**` and `apps/stage-tamagotchi/src/renderer/stores/**` (excluding `.test.ts`).',
      '',
      `Total store/module files: **${stageUi.length + renderer.length}** (stage-ui ${stageUi.length} + renderer ${renderer.length})`,
      '',
      renderGroup('packages/stage-ui', groupStores(stageUi, 'packages/stage-ui/src/stores/')),
      '',
      renderGroup('apps/stage-tamagotchi renderer', groupStores(renderer, 'apps/stage-tamagotchi/src/renderer/stores/')),
    ].join('\n'),
  )
  write('stores.md', md)
}

// ---------- i18n-keys.md ----------
function i18nKeys() {
  const locales = readdirSync(REPO.locales).filter((e) => {
    try { return statSync(join(REPO.locales, e)).isDirectory() }
    catch { return false }
  }).sort()

  const lines = []
  let enTotal = 0
  for (const loc of locales) {
    const files = walk(join(REPO.locales, loc), p => p.endsWith('.yaml'))
    let keys = 0
    const perFile = []
    for (const f of files) {
      const n = countYamlLeaves(readFileSync(f, 'utf8'))
      keys += n
      perFile.push(`  - \`${rel(f).replace(`packages/i18n/src/locales/${loc}/`, '')}\`: ${n}`)
    }
    if (loc === 'en')
      enTotal = keys
    lines.push(`- [ ] \`${loc}\` — ${files.length} YAML files, ${keys} leaf keys`, ...perFile)
  }

  const md = heading(
    'Port Manifest — i18n Locale Layout and Key Counts',
    [
      'Generated from `packages/i18n/src/locales/<locale>/**/*.yaml`. Leaf-key counts produced by `scripts/gen-manifest/gen-manifest.mjs` (indentation-aware minimal parser; block scalars count as one key).',
      '',
      'Locale layout: `base.yaml` (prompt/edition/toaster), `settings.yaml`, `stage.yaml` (chat/speech), `onboarding.yaml`, `docs/*.yaml`, `tamagotchi/{settings,stage}.yaml`, `tamagotchi/electron/tray.yaml`, `server/*.yaml` (id only).',
      '',
      `Locales: **${locales.length}** — ${locales.join(', ')}`,
      `English reference leaf-key count (mapping keys only): **${enTotal}**. Note: \`airi-i18n\` build.rs (serde_yaml flatten) reports 1329 keys for en because it also counts sequence items; the two counts differ by design and serve as a cross-check.`,
      '',
      ...lines,
    ].join('\n'),
  )
  write('i18n-keys.md', md)
}

// ---------- electron-services.md ----------
function electronServices() {
  const checks = [
    ['tray', /\btray\b/i],
    ['updater', /auto-updater|electron-updater|autoUpdater|mock-update|checkForUpdates|updateAvailable|updateDownloaded|mockAutoUpdater/i],
    ['shortcut / hotkey', /shortcut|hotkey|keybinding/i],
    ['capture / screenshot / display', /screencapture|screen-capture|capture|desktopCapturer|display/i],
    ['dialog / file', /showOpenDialog|showSaveDialog|dialog/i],
    ['menu', /\bMenu\.(build|set)|Menu\b/i],
    ['power / suspend / resume', /powerSaveBlocker|powerMonitor|suspend|resume|screen-lock/i],
    ['protocol / scheme', /protocol\.register|registerSchemesAsPrivileged|registerFileProtocol/i],
    ['notification / notice', /Notification|notice/i],
    ['auto-launch / login item', /setLoginItemSettings|autoLaunch|openAtLogin/i],
    ['clipboard', /clipboard/i],
    ['window state / bounds persistence', /window-bounds|windowState|getBounds|setBounds/i],
  ]
  const results = new Map(checks.map(([n]) => [n, []]))
  const files = walk(REPO.electronMain, p => /\.(ts|js|mjs|cjs)$/.test(p) && !p.endsWith('.test.ts') && !p.endsWith('.min.js') && !p.includes('/public/assets/'))
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    for (const [name, re] of checks) {
      if (re.test(text))
        results.get(name).push(rel(f))
    }
  }
  const sections = []
  for (const [name, files] of results) {
    const uniq = [...new Set(files)].sort()
    sections.push(`## ${name} (${uniq.length})\n\n${uniq.map(p => `- [ ] \`${p}\``).join('\n')}`)
  }
  const md = heading(
    'Port Manifest — Electron Main-Process Services',
    [
      'Generated from `apps/stage-tamagotchi/src/**` (excluding tests).',
      '',
      ...sections,
    ].join('\n\n'),
  )
  write('electron-services.md', md)
}

mkdirSync(outDir, { recursive: true })
features()
windows()
settingsPanels()
ipcChannels()
providers()
speech()
stores()
i18nKeys()
electronServices()
console.log('done')
