import fs from 'node:fs'
import path from 'node:path'

import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { env } from 'node:process'

const require = createRequire(import.meta.url)

function getPlatformPath() {
  switch (process.platform) {
    case 'mas':
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron'
    case 'freebsd':
    case 'openbsd':
    case 'linux':
      return 'electron'
    case 'win32':
      return 'electron.exe'
    default:
      return 'electron'
  }
}

function sanitizePathTxt(electronDir) {
  const pathFile = path.join(electronDir, 'path.txt')
  const platformPath = getPlatformPath()
  const expectedBinaryPath = path.join(electronDir, 'dist', platformPath)

  if (fs.existsSync(pathFile)) {
    try {
      const rawContent = fs.readFileSync(pathFile, 'utf-8')
      const trimmed = rawContent.trim()

      if (rawContent !== trimmed || trimmed === 'Electron uninstall' || trimmed !== platformPath) {
        if (fs.existsSync(expectedBinaryPath)) {
          fs.writeFileSync(pathFile, platformPath)
          console.log(`[AIRI] Auto-repaired path.txt to point to valid binary (${platformPath}).`)
          return true
        }
      }
    }
    catch {
      // Ignore read errors
    }
  }
  else if (fs.existsSync(expectedBinaryPath)) {
    try {
      fs.writeFileSync(pathFile, platformPath)
      console.log(`[AIRI] Created missing path.txt pointing to (${platformPath}).`)
      return true
    }
    catch {
      // Ignore write errors
    }
  }

  return false
}

function isElectronBroken(electronDir, distDir) {
  sanitizePathTxt(electronDir)

  if (!fs.existsSync(distDir)) {
    return true
  }

  try {
    const electronResolved = require('electron')
    if (typeof electronResolved === 'string' && fs.existsSync(electronResolved)) {
      return false
    }
  }
  catch (err) {
    if (err.message && (err.message.includes('Electron uninstall') || err.message.includes('failed to install'))) {
      return true
    }
  }

  const platformPath = getPlatformPath()
  const expectedBinaryPath = path.join(distDir, platformPath)
  return !fs.existsSync(expectedBinaryPath)
}

function ensureElectron() {
  let electronPkgPath
  try {
    electronPkgPath = require.resolve('electron/package.json')
  }
  catch {
    console.error('[AIRI] Electron package is not installed in node_modules.')
    process.exit(1)
  }

  const electronDir = path.dirname(electronPkgPath)
  const distDir = path.join(electronDir, 'dist')

  // NOTICE: concise fs snapshot for CI forensics. install.js can exit 0
  // without downloading (skip-env set, or its own staleness check passing
  // while the binary is actually absent), which used to leave zero trace.
  function snapshotDist(label) {
    let detail
    try {
      const entries = fs.readdirSync(distDir)
      detail = `${entries.length} entries: ${entries.slice(0, 12).join(', ')}${entries.length > 12 ? ', ...' : ''}`
    }
    catch (err) {
      detail = `unreadable (${err.message})`
    }
    console.warn(`[AIRI] dist ${label}: ${detail}`)
  }

  if (isElectronBroken(electronDir, distDir)) {
    console.warn('[AIRI] Electron binary runtime is missing or in uninstalled state.')
    console.warn(`[AIRI] Electron package dir: ${electronDir} (platform binary: ${getPlatformPath()})`)
    console.warn(`[AIRI] env: ELECTRON_SKIP_BINARY_DOWNLOAD=${env.ELECTRON_SKIP_BINARY_DOWNLOAD ?? '<unset>'} ELECTRON_OVERRIDE_DIST_PATH=${env.ELECTRON_OVERRIDE_DIST_PATH ?? '<unset>'} npm_config_platform=${env.npm_config_platform ?? '<unset>'} npm_config_arch=${env.npm_config_arch ?? '<unset>'}`)
    snapshotDist('before repair')
    console.warn('[AIRI] Triggering automatic repair via electron/install.js...')

    const installScript = path.join(electronDir, 'install.js')
    if (fs.existsSync(installScript)) {
      // NOTICE: install.js short-circuits when dist/version + path.txt look
      // valid, which can disagree with the actual binary on disk (partially
      // restored installs, interrupted downloads). Since we already decided
      // the runtime is broken, wipe the stale state first so the reinstall
      // cannot skip, and bypass the @electron/get zip cache so a corrupt
      // cached archive cannot reproduce the same broken state.
      try {
        fs.rmSync(distDir, { recursive: true, force: true })
        console.warn('[AIRI] Removed stale dist directory.')
      }
      catch (err) {
        console.warn(`[AIRI] Failed to remove stale dist (repair continues anyway): ${err.message}`)
      }
      try {
        fs.unlinkSync(path.join(electronDir, 'path.txt'))
      }
      catch {
        // Missing path.txt is fine; install.js recreates it
      }
      try {
        execSync(`node "${installScript}"`, {
          stdio: 'inherit',
          env: { ...env, force_no_cache: 'true' },
        })
      }
      catch (err) {
        console.warn('[AIRI] Electron install.js execution warning:', err.message)
      }
      snapshotDist('after repair')
    }

    if (isElectronBroken(electronDir, distDir)) {
      console.error('[AIRI] Automatic repair via install.js did not populate Electron runtime.')
      console.error('[AIRI] Please run: pnpm rebuild electron')
      process.exit(1)
    }
    else {
      console.log('[AIRI] Electron binary runtime repaired successfully.')
    }
  }
}

ensureElectron()
