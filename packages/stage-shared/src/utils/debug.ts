let debugEnabled = false

// NOTICE: histoire collection and SSR provide a JSDOM `window` without a
// `localStorage` global, so guard both (bare `localStorage` would throw).
if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
  debugEnabled = localStorage.getItem('debug') === 'true' || localStorage.getItem('DEBUG') === 'true'
}
else if (typeof process !== 'undefined') {
  debugEnabled = process.env.DEBUG === 'true' || process.env.AIRI_DEBUG === 'true'
}

export function isDebugEnabled(): boolean {
  return debugEnabled
}

export function setDebugEnabled(enabled: boolean): void {
  debugEnabled = enabled
  if (typeof window !== 'undefined') {
    localStorage.setItem('debug', String(enabled))
  }
}

export function debug(...args: any[]): void {
  if (debugEnabled) {
    console.log(...args)
  }
}
