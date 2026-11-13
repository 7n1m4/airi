// Deployed API origin (same one better-auth trusts via trustedOrigins) plus
// localhost dev origins; everything else is blocked. Origin headers have no
// path and no trailing slash, so an exact string compare is correct.
const deployedOrigin = process.env.API_SERVER_URL ?? 'http://localhost:3000'

export function getTrustedOrigin(origin: string): string {
  if (!origin || origin === deployedOrigin || origin.startsWith('http://localhost:')) {
    return origin
  }

  return ''
}
