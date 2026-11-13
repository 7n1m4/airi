// Deployed API origin (same one better-auth trusts via trustedOrigins) plus
// localhost dev origins; everything else is blocked. Origin headers carry no path
// or trailing slash, so compare against the URL-normalization of API_SERVER_URL.
const rawApiServerUrl = process.env.API_SERVER_URL ?? 'http://localhost:3000'
export const deployedOrigin = (() => {
  try {
    return new URL(rawApiServerUrl).origin
  }
  catch {
    return rawApiServerUrl
  }
})()

export function getTrustedOrigin(origin: string): string {
  if (!origin)
    return origin
  if (origin === deployedOrigin)
    return origin
  // Localhost is trusted only outside production (dev/webview convenience).
  if (process.env.NODE_ENV !== 'production' && origin.startsWith('http://localhost:'))
    return origin

  return ''
}
