/// <reference lib="dom" />

import { isStageTamagotchi } from './environment'

/**
 * True when running inside the desktop renderer, not the web/Stage build.
 *
 * The Electron preload's `window.electron` bridge has been retired in the Electrobun
 * shell, so the predicate now recognises either that legacy shape (other packages that
 * still ship an Electron build) or the Electrobun webview globals the CEF runtime injects.
 * It is a plain boolean: no `window.electron` / `window.platform` typings are declared,
 * and stage-shared no longer augments the global `Window` interface.
 */
export function isElectronWindow(window: Window): boolean {
  if (!isStageTamagotchi() || typeof window !== 'object' || window === null)
    return false

  const target = window as Window & {
    electron?: unknown
    __electrobunWebviewId?: number
    __electrobun?: unknown
  }
  return 'electron' in target
    || typeof target.__electrobunWebviewId === 'number'
    || Boolean(target.__electrobun)
}
