#!/usr/bin/env node

/**
 * Orphan Dependency Auditor
 *
 * Scans every workspace package.json across the monorepo and checks if declared
 * dependencies are actually imported in .ts, .tsx, .vue, .js source files.
 *
 * Categorizes dependencies as:
 * - ACTIVE: Imported in src/ application code
 * - CONFIG_ONLY: Only cited in build/vite/electron configs (e.g. optimizeDeps.exclude)
 * - CLI_TOOL: Invoked via package.json scripts (common for devDependencies)
 * - ORPHAN: Zero citations in source or configs
 */

import fs from 'node:fs'
import path from 'node:path'

import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.turbo',
  'mate-engine',
  'scratch',
  'coverage',
  '.output',
  'bin',
])

function findPackageJsons(dir, results = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name))
      continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      findPackageJsons(fullPath, results)
    }
    else if (entry.name === 'package.json' && fullPath !== path.join(REPO_ROOT, 'package.json')) {
      results.push(fullPath)
    }
  }
  return results
}

function collectSourceFiles(dir, results = { src: [], configs: [] }) {
  if (!fs.existsSync(dir))
    return results
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name))
      continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectSourceFiles(fullPath, results)
    }
    else if (/\.(?:ts|tsx|vue|js|mjs|cjs)$/.test(entry.name)) {
      if (fullPath.includes(`${path.sep}src${path.sep}`)) {
        results.src.push(fullPath)
      }
      else {
        results.configs.push(fullPath)
      }
    }
  }
  return results
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function checkImportInFile(content, pkgName) {
  const escaped = escapeRegex(pkgName)
  // Matches:
  // - from 'pkg' / from "pkg"
  // - from 'pkg/...' / from "pkg/..."
  // - import('pkg') / import('pkg/...')
  // - require('pkg') / require('pkg/...')
  const importRegex = new RegExp(
    `(?:from\\s+['"]${escaped}(?:/.*)?['"]|import\\s*\\(\\s*['"]${escaped}(?:/.*)?['"]\\s*\\)|require\\s*\\(\\s*['"]${escaped}(?:/.*)?['"]\\s*\\)|import\\s+['"]${escaped}(?:/.*)?['"])`,
  )
  return importRegex.test(content)
}

function checkMentionInFile(content, pkgName) {
  const escaped = escapeRegex(pkgName)
  const mentionRegex = new RegExp(`['"]${escaped}(?:/.*)?['"]`)
  return mentionRegex.test(content)
}

function audit() {
  console.log('🔍 Scanning workspace packages for orphaned dependencies...\n')

  const packageJsonPaths = findPackageJsons(REPO_ROOT).sort()
  const totalFindings = {
    orphans: [],
    configOnly: [],
  }

  for (const pkgJsonPath of packageJsonPaths) {
    const pkgDir = path.dirname(pkgJsonPath)
    const relPkgDir = path.relative(REPO_ROOT, pkgDir)
    let pkgJson
    try {
      pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
    }
    catch {
      continue
    }

    const pkgName = pkgJson.name || relPkgDir
    const deps = pkgJson.dependencies || {}
    const depNames = Object.keys(deps)

    if (depNames.length === 0)
      continue

    const files = collectSourceFiles(pkgDir)
    const srcContents = files.src.map(f => ({ path: f, content: fs.readFileSync(f, 'utf8') }))
    const configContents = files.configs.map(f => ({ path: f, content: fs.readFileSync(f, 'utf8') }))
    const scriptsString = JSON.stringify(pkgJson.scripts || {})

    const pkgOrphans = []
    const pkgConfigOnly = []

    for (const dep of depNames) {
      // 1. Check if imported in src/
      const importedInSrc = srcContents.some(f => checkImportInFile(f.content, dep))
      if (importedInSrc)
        continue

      // 2. Check if imported in configs or other non-src code
      const importedInConfig = configContents.some(f => checkImportInFile(f.content, dep))
      if (importedInConfig)
        continue

      // 3. Check if mentioned in configs (e.g. optimizeDeps.exclude, plugins, etc.)
      const mentionedInConfig = configContents.some(f => checkMentionInFile(f.content, dep))

      // 4. Check if invoked via scripts (CLI)
      const binaryName = dep.split('/').pop()
      const usedInScript = scriptsString.includes(dep) || (binaryName && scriptsString.includes(`"${binaryName}"`)) || (binaryName && scriptsString.includes(` ${binaryName} `))

      if (mentionedInConfig && !usedInScript) {
        pkgConfigOnly.push(dep)
      }
      else if (!usedInScript) {
        pkgOrphans.push(dep)
      }
    }

    if (pkgOrphans.length > 0 || pkgConfigOnly.length > 0) {
      console.log(`📦 \x1B[1m${pkgName}\x1B[0m (\x1B[90m${relPkgDir}\x1B[0m)`)

      if (pkgOrphans.length > 0) {
        console.log('  \x1B[31m❌ Orphaned Dependencies (0 imports or citations anywhere):\x1B[0m')
        for (const dep of pkgOrphans) {
          console.log(`     - \x1B[31m${dep}\x1B[0m \x1B[90m(${deps[dep]})\x1B[0m`)
          totalFindings.orphans.push({ pkgName, relPkgDir, dep, version: deps[dep] })
        }
      }

      if (pkgConfigOnly.length > 0) {
        console.log('  \x1B[33m⚠️  Config-Only Citations (Cited in config/exclude, but never imported in src):\x1B[0m')
        for (const dep of pkgConfigOnly) {
          console.log(`     - \x1B[33m${dep}\x1B[0m \x1B[90m(${deps[dep]})\x1B[0m`)
          totalFindings.configOnly.push({ pkgName, relPkgDir, dep, version: deps[dep] })
        }
      }

      console.log('')
    }
  }

  console.log('========================================================')
  console.log('                 AUDIT SUMMARY')
  console.log('========================================================')
  console.log(`  Total Completely Orphaned Dependencies : \x1B[31m${totalFindings.orphans.length}\x1B[0m`)
  console.log(`  Total Config-Only / Lingering Packages : \x1B[33m${totalFindings.configOnly.length}\x1B[0m`)
  console.log('========================================================')

  return totalFindings
}

audit()
