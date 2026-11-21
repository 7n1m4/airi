/**
 * Runtime platform sniff for the CEF renderer.
 *
 * Replaces the Electron preload's `window.platform`. The Electrobun webview injects
 * `__electrobunPlatform` with the friendly spellings ('macos' | 'windows' | 'linux');
 * the UA fallback keeps web/dev builds working. No Electron-shaped global is installed.
 */
export function isMacOSRenderer(): boolean {
  if (typeof window === 'undefined')
    return false

  const injected = (window as Window & { __electrobunPlatform?: string }).__electrobunPlatform
  if (injected === 'macos')
    return true
  if (injected === 'windows' || injected === 'linux')
    return false

  return /Mac/i.test(navigator.userAgent)
}
