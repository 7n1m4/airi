export interface AiriBridgeConfig { url: string, token?: string }

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw)
    if (u.pathname === '' || u.pathname === '/')
      u.pathname = '/ws'
    return u.toString()
  }
  catch {
    return raw
  }
}

export function resolveConfig(env: Record<string, string | undefined> = process.env): AiriBridgeConfig {
  const rawUrl = env.AIRI_WS_URL && env.AIRI_WS_URL.trim() !== '' ? env.AIRI_WS_URL : 'ws://localhost:6121/ws'
  const url = normalizeUrl(rawUrl)
  const token = env.AIRI_TOKEN && env.AIRI_TOKEN.trim() !== '' ? env.AIRI_TOKEN : undefined
  return token ? { url, token } : { url }
}
