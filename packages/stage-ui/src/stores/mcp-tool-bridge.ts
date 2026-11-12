export interface McpToolDescriptor {
  serverName: string
  name: string
  toolName: string
  description?: string
  inputSchema: Record<string, unknown>
}

export interface McpCallToolPayload {
  name: string
  arguments?: Record<string, unknown>
}

export interface McpCallToolResult {
  content?: Array<Record<string, unknown>>
  structuredContent?: Record<string, unknown>
  toolResult?: unknown
  isError?: boolean
}

export interface McpHttpServerConfig {
  url: string
  headers?: Record<string, string>
  enabled?: boolean
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig

export function isHttpServerConfig(config: McpServerConfig): config is McpHttpServerConfig {
  return 'url' in config && typeof (config as McpHttpServerConfig).url === 'string'
}

export function isStdioServerConfig(config: McpServerConfig): config is McpStdioServerConfig {
  return 'command' in config && typeof (config as McpStdioServerConfig).command === 'string'
}

export const toolNameSeparator = '::'

export function parseQualifiedToolName(name: string): { serverName: string, toolName: string } {
  const separatorIndex = name.indexOf(toolNameSeparator)
  if (separatorIndex <= 0 || separatorIndex === name.length - toolNameSeparator.length) {
    throw new Error(`invalid qualified tool name: ${name}`)
  }

  return {
    serverName: name.slice(0, separatorIndex),
    toolName: name.slice(separatorIndex + toolNameSeparator.length),
  }
}

export interface McpConfigFile {
  mcpServers: Record<string, McpServerConfig>
}

// Backwards compatibility alias
export type McpStdioConfigFile = McpConfigFile

export type McpServerRuntimeStatus
  = | {
    name: string
    state: 'running' | 'stopped' | 'error'
    transport?: 'stdio'
    command: string
    args: string[]
    pid: number | null
    lastError?: string
  }
  | {
    name: string
    state: 'running' | 'stopped' | 'error'
    transport: 'http'
    url: string
    lastError?: string
    command?: never
    args?: never
    pid?: null
  }

export interface McpRuntimeStatus {
  path: string
  servers: McpServerRuntimeStatus[]
  updatedAt: number
}

export interface McpStdioServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  enabled?: boolean
}

export interface McpTestResult {
  ok: boolean
  error?: string
  tools?: string[]
  durationMs: number
}

export interface McpTestPayload {
  name: string
  config: McpServerConfig
}

export interface McpToolBridge {
  listTools: () => Promise<McpToolDescriptor[]>
  callTool: (payload: McpCallToolPayload) => Promise<McpCallToolResult>
  getRuntimeStatus: () => Promise<McpRuntimeStatus>
  getConfig?: () => Promise<McpConfigFile>
  updateConfig?: (partial: Partial<McpConfigFile>) => Promise<void>
  applyAndRestart?: () => Promise<unknown>
  testServer?: (payload: McpTestPayload) => Promise<McpTestResult>
}

/**
 * Default REST base URL for the local AIRI Audio Server. Mirrors the
 * `defaultBaseUrl` of the `airi-audio-server` speech provider registry entry.
 */
export const DEFAULT_AUDIO_SERVER_BASE_URL = 'http://127.0.0.1:8095/v1/'

/** Key used for the audio server inside `mcp.json` (also the qualified tool prefix). */
export const MUSIC_MCP_SERVER_NAME = 'airi-audio-server'

/** Key used for the web search server inside `mcp.json` (also the qualified tool prefix). */
export const WEB_SEARCH_MCP_SERVER_NAME = 'open-websearch'

/** Key used for the filesystem server inside `mcp.json` (also the qualified tool prefix). */
export const FILESYSTEM_MCP_SERVER_NAME = 'filesystem'

export type MusicToolProvisionFailure = 'no-bridge' | 'config-error' | 'unreachable' | 'not-advertised'

export type MusicToolProvisionOutcome
  = | { ok: true, url?: string, source: 'existing' | 'provisioned' }
    | { ok: false, reason: MusicToolProvisionFailure }

export function normalizeAudioServerBaseUrl(raw?: string): string {
  const value = (raw ?? '').trim() || DEFAULT_AUDIO_SERVER_BASE_URL
  return value.endsWith('/') ? value : `${value}/`
}

/**
 * Turns a provisioning failure into copy safe to show a user.
 * Shared by every surface that exposes the music toggle.
 */
export function describeMusicProvisionFailure(reason: MusicToolProvisionFailure): string {
  switch (reason) {
    case 'no-bridge':
      return 'MCP is unavailable in this runtime (desktop app only).'
    case 'config-error':
      return 'Could not write the MCP configuration file.'
    case 'unreachable':
      return 'AIRI Audio Server is not running. Start it and try again.'
    case 'not-advertised':
      return 'The audio server is running but does not expose an MCP endpoint.'
  }
}

/**
 * Asks the audio server for its MCP endpoint.
 *
 * The endpoint is advertised through `GET /v1/capabilities` rather than derived
 * from the REST base URL, so custom ports and reverse proxies keep working.
 */
export async function resolveAudioServerMcpEndpoint(
  baseUrl: string,
  timeoutMs = 2500,
): Promise<{ url?: string, reason?: 'unreachable' | 'not-advertised' }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${normalizeAudioServerBaseUrl(baseUrl)}capabilities`, {
      method: 'GET',
      signal: controller.signal,
    })
    if (!response.ok)
      return { reason: 'unreachable' }

    const payload = await response.json() as { mcp?: { url?: unknown } }
    const url = typeof payload?.mcp?.url === 'string' ? payload.mcp.url.trim() : ''
    return url ? { url } : { reason: 'not-advertised' }
  }
  catch {
    return { reason: 'unreachable' }
  }
  finally {
    clearTimeout(timer)
  }
}

/**
 * Ensures the `airi-audio-server` entry exists in the supplied server map.
 *
 * Mirrors the web-search and filesystem branches: the `mcp.json` entry is the
 * activation record. An existing entry is reused without a network call, so the
 * server does not need to be running on later toggles.
 */
async function applyMusicServerEntry(
  servers: Record<string, McpServerConfig>,
  providerBaseUrl?: string,
): Promise<{ changed: boolean, url?: string, failure?: 'unreachable' | 'not-advertised' }> {
  const existing = servers[MUSIC_MCP_SERVER_NAME]
  if (existing) {
    // Never clobber a transport the user wired by hand.
    if (!isHttpServerConfig(existing))
      return { changed: false }

    if (existing.enabled !== false)
      return { changed: false, url: existing.url }

    servers[MUSIC_MCP_SERVER_NAME] = { ...existing, enabled: true }
    return { changed: true, url: existing.url }
  }

  const probe = await resolveAudioServerMcpEndpoint(providerBaseUrl ?? DEFAULT_AUDIO_SERVER_BASE_URL)
  if (!probe.url)
    return { changed: false, failure: probe.reason ?? 'not-advertised' }

  servers[MUSIC_MCP_SERVER_NAME] = { url: probe.url, enabled: true }
  return { changed: true, url: probe.url }
}

/**
 * Reads the configured music MCP endpoint without probing the server.
 * Used by UI surfaces that only need to display the current connection target.
 */
export async function readMusicMcpEndpoint(): Promise<string | undefined> {
  const bridge = tryGetMcpToolBridge()
  if (!bridge?.getConfig)
    return undefined

  try {
    const config = await bridge.getConfig()
    const entry = config?.mcpServers?.[MUSIC_MCP_SERVER_NAME]
    return entry && isHttpServerConfig(entry) ? entry.url : undefined
  }
  catch {
    return undefined
  }
}

/**
 * Enables the music tool by provisioning `airi-audio-server` into `mcp.json`.
 *
 * This is the hard blocker for the music toggle: it only succeeds once the
 * audio server is reachable and advertising an MCP endpoint.
 */
export async function ensureMusicToolProvisioned(
  options: { providerBaseUrl?: string } = {},
): Promise<MusicToolProvisionOutcome> {
  const bridge = tryGetMcpToolBridge()
  if (!bridge?.getConfig || !bridge?.updateConfig)
    return { ok: false, reason: 'no-bridge' }

  try {
    const currentConfig = await bridge.getConfig()
    const servers: Record<string, McpServerConfig> = { ...currentConfig?.mcpServers }
    const result = await applyMusicServerEntry(servers, options.providerBaseUrl)

    if (result.failure)
      return { ok: false, reason: result.failure }

    if (!result.changed)
      return { ok: true, url: result.url, source: 'existing' }

    await bridge.updateConfig({ mcpServers: servers })
    bridge.applyAndRestart?.().catch((error) => {
      console.warn('[mcp-tool-bridge] Failed to restart MCP servers after enabling music tools:', error)
    })

    return { ok: true, url: result.url, source: 'provisioned' }
  }
  catch (error) {
    console.error('[mcp-tool-bridge] Failed to provision music tools:', error)
    return { ok: false, reason: 'config-error' }
  }
}

/**
 * Renderer host interface exposing a sliver of `process` when the embedder
 * provides it (Electron with nodeIntegration/preload bridging). Browsers and
 * contextIsolated renderers omit it entirely.
 */
interface NodeProcessHost {
  readonly process?: { readonly env?: Record<string, string | undefined> }
}

const PROCESS_KEY = 'process'

/**
 * Resolves the user's home directory for MCP filesystem server defaults.
 * Falls back to the macOS convention when the host exposes no `process.env`,
 * which is the case in every non-Electron runtime.
 */
function resolveRendererHomeDirectory(): string {
  // NOTICE: `process` is absent under renderer contextIsolation and in browser
  // bundles, so read it via the typed host interface instead of the bare global.
  // Bracket access keeps the lookup off the identifier that lint rules treat as
  // an unused Node global in the renderer.
  const host = globalThis as NodeProcessHost
  const env = host[PROCESS_KEY]?.env
  return env?.HOME || '/Users'
}

export async function ensureMcpServersForAllowedTools(
  allowedTools: string[] | undefined,
  options: { providerBaseUrl?: string } = {},
): Promise<boolean> {
  if (!allowedTools || !allowedTools.length)
    return false

  const bridge = tryGetMcpToolBridge()
  if (!bridge?.getConfig || !bridge?.updateConfig) {
    return false
  }

  try {
    const currentConfig = await bridge.getConfig()
    const servers = { ...currentConfig?.mcpServers }
    let changed = false

    const hasWebSearch = allowedTools.includes('web_search') || allowedTools.includes('mcp_web_search')
    const hasFilesystem = allowedTools.includes('filesystem') || allowedTools.includes('mcp_filesystem')
    const hasMusic = allowedTools.includes('music') || allowedTools.includes('mcp_music')

    // 1. Ensure open-websearch if web_search is enabled
    if (hasWebSearch) {
      if (!servers['open-websearch']) {
        servers['open-websearch'] = {
          command: 'npx',
          args: ['-y', 'open-websearch@latest'],
          env: {
            DEFAULT_SEARCH_ENGINE: 'duckduckgo',
            SEARCH_MODE: 'auto',
            MODE: 'stdio',
          },
          enabled: true,
        }
        changed = true
      }
      else {
        const existing = servers['open-websearch']
        const currentEnv = ('env' in existing ? existing.env : undefined) || {}
        if (existing.enabled === false || !currentEnv.DEFAULT_SEARCH_ENGINE) {
          servers['open-websearch'] = {
            ...existing,
            command: 'command' in existing ? existing.command : 'npx',
            env: {
              DEFAULT_SEARCH_ENGINE: 'duckduckgo',
              SEARCH_MODE: 'auto',
              MODE: 'stdio',
              ...currentEnv,
            },
            enabled: true,
          }
          changed = true
        }
      }
    }

    // 2. Ensure filesystem if filesystem is enabled
    if (hasFilesystem) {
      if (!servers.filesystem) {
        const home = resolveRendererHomeDirectory()
        servers.filesystem = {
          command: 'npx',
          args: [
            '-y',
            '@modelcontextprotocol/server-filesystem',
            `${home}/Documents/Projects`,
            `${home}/Downloads`,
            `${home}/Desktop`,
          ],
          enabled: true,
        }
        changed = true
      }
      else if (servers.filesystem.enabled === false) {
        servers.filesystem = {
          ...servers.filesystem,
          enabled: true,
        }
        changed = true
      }
    }

    // 3. Ensure airi-audio-server if music is enabled.
    // Unlike web search and filesystem there is no fixed command to spawn: the
    // endpoint is advertised by the running server, so provisioning is gated on
    // a capabilities probe.
    if (hasMusic) {
      const music = await applyMusicServerEntry(servers, options.providerBaseUrl)
      if (music.changed)
        changed = true
    }

    if (changed) {
      console.info('[mcp-tool-bridge] 🛠️ Automatically updating mcp.json with required server configs:', Object.keys(servers))
      await bridge.updateConfig({ mcpServers: servers })
      if (bridge.applyAndRestart) {
        bridge.applyAndRestart().catch((err) => {
          console.warn('[mcp-tool-bridge] Background applyAndRestart encountered an error:', err)
        })
      }
      return true
    }
  }
  catch (error) {
    console.error('[mcp-tool-bridge] Failed to ensure MCP servers for allowed tools:', error)
  }

  return false
}

let bridge: McpToolBridge | undefined

/**
 * Sets the MCP tool bridge for the current runtime.
 * Also exposes it globally on the `window` object to ensure cross-module
 * and cross-window stability in Electron's multi-renderer architecture.
 */
export function setMcpToolBridge(nextBridge: McpToolBridge) {
  bridge = nextBridge

  // Expose globally for cross-context stability
  if (typeof window !== 'undefined') {
    ;(window as any).__AIRI_MCP_BRIDGE__ = nextBridge
  }
}

export function clearMcpToolBridge() {
  bridge = undefined
  if (typeof window !== 'undefined') {
    delete (window as any).__AIRI_MCP_BRIDGE__
  }
}

let _lazyBridgeFallback: (() => McpToolBridge | undefined) | undefined

/**
 * Registers a lazy fallback factory for the MCP tool bridge (e.g. WebMcpClient in browser environments).
 */
export function registerLazyMcpToolBridgeFallback(fn: () => McpToolBridge | undefined): void {
  _lazyBridgeFallback = fn
}

/**
 * Safely tries to retrieve the MCP tool bridge without throwing an error.
 * Returns undefined if the bridge is not initialized.
 */
export function tryGetMcpToolBridge(): McpToolBridge | undefined {
  if (bridge)
    return bridge
  if (typeof window !== 'undefined' && (window as any).__AIRI_MCP_BRIDGE__)
    return (window as any).__AIRI_MCP_BRIDGE__
  if (_lazyBridgeFallback) {
    const fallback = _lazyBridgeFallback()
    if (fallback) {
      setMcpToolBridge(fallback)
      return fallback
    }
  }
  return undefined
}

/**
 * Retrieves the MCP tool bridge.
 * Throws an error if the bridge is not available.
 */
export function getMcpToolBridge(): McpToolBridge {
  const resolvedBridge = tryGetMcpToolBridge()

  if (!resolvedBridge) {
    throw new Error('MCP tool bridge is not available in this runtime.')
  }

  return resolvedBridge
}

/**
 * Filters discovered MCP tools against the allowed tools configuration of a character card.
 *
 * Rules:
 * - Returns empty array when allowedTools is undefined or empty.
 * - If allowedTools includes 'mcp', all tools are permitted.
 * - A bare family grant ('web_search', 'filesystem', 'music') resolves to the ONE
 *   server that family provisions, never to every server whose name happens to
 *   contain the family word (an unrelated `my-search-helper` stays unreachable).
 * - Explicit tool names or qualified server::tool names also pass.
 */
export function filterMcpToolsForCard(
  rawTools: McpToolDescriptor[],
  allowedTools: string[] | undefined,
): McpToolDescriptor[] {
  if (!allowedTools || !allowedTools.length) {
    return []
  }
  if (allowedTools.includes('mcp')) {
    return rawTools
  }

  const families: Array<{ grants: string[], serverName: string }> = [
    { grants: ['web_search', 'mcp_web_search'], serverName: WEB_SEARCH_MCP_SERVER_NAME },
    { grants: ['filesystem', 'mcp_filesystem'], serverName: FILESYSTEM_MCP_SERVER_NAME },
    { grants: ['music', 'mcp_music'], serverName: MUSIC_MCP_SERVER_NAME },
  ]
  const allowedServers = new Set<string>(
    families.filter(f => f.grants.some(g => allowedTools.includes(g))).map(f => f.serverName),
  )

  return rawTools.filter(t =>
    allowedTools.includes(t.name)
    || allowedTools.includes(t.toolName)
    || allowedServers.has(t.serverName))
}

/**
 * Whether a qualified `server::tool` name passes a card's allowedTools.
 *
 * Shares the allowlist semantics with {@link filterMcpToolsForCard} so the
 * sandbox `mcp` CLI and the LLM meta-tool cannot disagree about a tool. A name
 * no server advertises stays reachable: tool sets change at runtime and a
 * stale descriptor list must not hard-fail an otherwise allowed call.
 *
 * A card with no `generation.known.allowedTools` gate is not a decision, so the
 * caller is told to skip the check rather than deny everything (headless
 * runtimes and pre-generation cards carry no allowlist).
 */
export function isMcpToolAllowedForCard(
  name: string,
  allowedTools: string[] | undefined,
  knownTools: McpToolDescriptor[] = [],
): boolean | undefined {
  if (!allowedTools)
    return undefined
  if (!allowedTools.length)
    return false
  const sep = name.indexOf(toolNameSeparator)
  if (sep <= 0 || sep === name.length - toolNameSeparator.length)
    return false
  if (allowedTools.includes('mcp') || allowedTools.includes(name))
    return true

  const advertised = knownTools.some(t => t.name === name)
  return advertised && filterMcpToolsForCard(knownTools, allowedTools).some(t => t.name === name)
}
