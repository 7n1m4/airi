/**
 * Electrobun port: asset paths instead of electron-vite's `?asset` imports.
 *
 * electron-vite turned `import icon from '...png?asset'` into a bundled file and
 * handed back its path; Bun's bundler does not know the suffix, and Electrobun's
 * `Tray({ image })` / window icon want a filesystem path anyway. So the resources
 * directory is resolved at runtime and existence-checked once.
 */

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const RESOURCES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'resources')

/** Absolute path when the asset exists, otherwise `undefined` (icons are cosmetic). */
export function asset(...segments: string[]): string | undefined {
  const path = join(RESOURCES_DIR, ...segments)
  return existsSync(path) ? path : undefined
}

// shortcut: module-level constants evaluate once, so the three hot icons cost one stat each.
export const APP_ICON = asset('icon.png')
export const TRAY_ICON = asset('icon.png')
export const TRAY_ICON_MACOS = asset('tray-icon-macos.png')
