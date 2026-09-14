#!/usr/bin/env node

/**
 * AIRI Monorepo Localization & Translation Parity Auditor
 *
 * Scans `packages/i18n/src/locales/` across all supported languages:
 * 1. Validates YAML syntax and asserts zero duplicate keys.
 * 2. Compares all language files against the English (`en`) reference baseline.
 * 3. Calculates per-file and per-locale coverage metrics.
 * 4. Checks for missing translation keys in critical domains (e.g. onboarding.yaml).
 *
 * Usage:
 *   node scripts/audit-i18n.mjs
 *   node scripts/audit-i18n.mjs --verbose
 *   node scripts/audit-i18n.mjs --strict
 */

import fs from 'node:fs'
import path from 'node:path'

import { fileURLToPath } from 'node:url'

import yaml, { isMap, parseDocument } from 'yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const LOCALES_DIR = path.resolve(REPO_ROOT, 'packages/i18n/src/locales')

const args = process.argv.slice(2)
const isVerbose = args.includes('--verbose') || args.includes('-v')
const isStrict = args.includes('--strict')

console.log('🌐 AIRI Monorepo Localization Audit')
console.log(`📁 Locales root: ${LOCALES_DIR}\n`)

if (!fs.existsSync(LOCALES_DIR)) {
  console.error(`❌ Locales directory not found: ${LOCALES_DIR}`)
  process.exit(1)
}

// Discover all locale directories
const locales = fs.readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter(dirent => dirent.isDirectory())
  .map(dirent => dirent.name)

if (!locales.includes('en')) {
  console.error('❌ Baseline locale "en" not found!')
  process.exit(1)
}

// Recursively find all YAML files relative to a locale directory
function findYamlFiles(dir, baseDir = dir) {
  const results = []
  if (!fs.existsSync(dir))
    return results

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...findYamlFiles(fullPath, baseDir))
    }
    else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) {
      results.push(path.relative(baseDir, fullPath).replace(/\\/g, '/'))
    }
  }
  return results
}

// Extract all dotted leaf keys from an object
function extractLeafKeys(obj, prefix = '') {
  const keys = []
  if (!obj || typeof obj !== 'object')
    return keys

  for (const [k, v] of Object.entries(obj)) {
    const keyPath = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...extractLeafKeys(v, keyPath))
    }
    else {
      keys.push(keyPath)
    }
  }
  return keys
}

// Audit duplicate keys using YAML parseDocument CST
function checkDuplicateKeys(filePath) {
  const content = fs.readFileSync(filePath, 'utf8')
  const duplicates = []

  try {
    const doc = parseDocument(content)
    if (doc.errors && doc.errors.length > 0) {
      return { error: doc.errors[0].message, duplicates }
    }

    function checkMap(node, p = []) {
      if (!isMap(node))
        return
      const seen = new Set()
      node.items.forEach((item) => {
        const k = item.key?.value ?? item.key?.toString()
        if (seen.has(k)) {
          duplicates.push([...p, k].join('.'))
        }
        seen.add(k)
        if (isMap(item.value)) {
          checkMap(item.value, [...p, k])
        }
      })
    }

    checkMap(doc.contents)
  }
  catch (err) {
    return { error: err.message, duplicates }
  }

  return { error: null, duplicates }
}

const enFiles = findYamlFiles(path.join(LOCALES_DIR, 'en'))
console.log(`📋 Baseline files in "en" (${enFiles.length} files): ${enFiles.join(', ')}`)
console.log(`🌍 Target locales discovered (${locales.length - 1}): ${locales.filter(l => l !== 'en').join(', ')}\n`)

let totalMissingAcrossMonorepo = 0
let totalErrors = 0
const domainAuditResults = {}

for (const relFile of enFiles) {
  const enFilePath = path.join(LOCALES_DIR, 'en', relFile)
  let enKeys = []
  let enData = {}

  try {
    enData = yaml.parse(fs.readFileSync(enFilePath, 'utf8')) || {}
    enKeys = extractLeafKeys(enData)
  }
  catch (e) {
    console.error(`❌ Failed to parse EN reference file: ${relFile} (${e.message})`)
    totalErrors++
    continue
  }

  domainAuditResults[relFile] = {
    totalEnKeys: enKeys.length,
    locales: {},
  }

  console.log(`\n======================================================================`)
  console.log(`📄 Domain File: ${relFile} (Baseline: ${enKeys.length} keys)`)
  console.log(`======================================================================`)

  for (const loc of locales) {
    if (loc === 'en')
      continue

    const targetFilePath = path.join(LOCALES_DIR, loc, relFile)
    if (!fs.existsSync(targetFilePath)) {
      console.log(`  ❌ ${loc.padEnd(8)}: FILE MISSING! (0 / ${enKeys.length} keys - 0.0%)`)
      totalMissingAcrossMonorepo += enKeys.length
      domainAuditResults[relFile].locales[loc] = {
        exists: false,
        present: 0,
        missing: enKeys.length,
        coverage: 0,
        missingKeys: enKeys,
      }
      continue
    }

    // Check duplicate keys & syntax
    const dupCheck = checkDuplicateKeys(targetFilePath)
    if (dupCheck.error) {
      console.log(`  ⚠️  ${loc.padEnd(8)}: YAML Parse error (${dupCheck.error})`)
      totalErrors++
    }
    if (dupCheck.duplicates.length > 0) {
      console.log(`  ⚠️  ${loc.padEnd(8)}: ${dupCheck.duplicates.length} duplicate key(s) detected: ${dupCheck.duplicates.slice(0, 3).join(', ')}...`)
      totalErrors++
    }

    try {
      const targetData = yaml.parse(fs.readFileSync(targetFilePath, 'utf8')) || {}
      const targetKeys = new Set(extractLeafKeys(targetData))

      const missingKeys = enKeys.filter(k => !targetKeys.has(k))
      const coverage = enKeys.length > 0
        ? (((enKeys.length - missingKeys.length) / enKeys.length) * 100).toFixed(1)
        : '100.0'

      const statusIcon = missingKeys.length === 0 ? '✅' : (Number(coverage) > 80 ? '⚡' : '⚠️')
      console.log(`  ${statusIcon} ${loc.padEnd(8)}: ${String(targetKeys.size).padStart(4)} / ${enKeys.length} keys (${coverage.padStart(5)}% coverage) - Missing: ${missingKeys.length}`)

      if (isVerbose && missingKeys.length > 0) {
        console.log(`     Missing: ${missingKeys.slice(0, 10).join(', ')}${missingKeys.length > 10 ? ` ...and ${missingKeys.length - 10} more` : ''}`)
      }

      totalMissingAcrossMonorepo += missingKeys.length
      domainAuditResults[relFile].locales[loc] = {
        exists: true,
        present: targetKeys.size,
        missing: missingKeys.length,
        coverage: Number(coverage),
        missingKeys,
      }
    }
    catch (e) {
      console.log(`  ❌ ${loc.padEnd(8)}: Could not read/parse file (${e.message})`)
      totalErrors++
    }
  }
}

console.log(`\n======================================================================`)
console.log(`📊 MONOREPO LOCALIZATION AUDIT SUMMARY`)
console.log(`======================================================================`)
console.log(`Total Locales:             ${locales.length}`)
console.log(`Total Files Checked:       ${enFiles.length} per locale`)
console.log(`Total Parse/Syntax Errors: ${totalErrors}`)
console.log(`Total Missing Keys:        ${totalMissingAcrossMonorepo}`)

// Check Onboarding specific health
if (enFiles.includes('onboarding.yaml')) {
  console.log(`\n✨ Onboarding V3 Domain Health Check:`)
  const onboardingResults = domainAuditResults['onboarding.yaml']
  let onboardingMissingTotal = 0
  if (onboardingResults && onboardingResults.locales) {
    for (const [loc, res] of Object.entries(onboardingResults.locales)) {
      if (res.missing > 0 || !res.exists) {
        onboardingMissingTotal += res.missing
        console.log(`   - ${loc}: ${res.missing} keys missing (${res.coverage}% coverage)`)
      }
    }
    if (onboardingMissingTotal === 0) {
      console.log(`   ✅ 100% Onboarding Parity across all ${locales.length} languages!`)
    }
  }

  // Component Template Audit: Scan Vue/TS components in Onboarding V3
  console.log(`\n🔍 Onboarding V3 Component Template Key Audit:`)
  const ONBOARDING_V3_DIR = path.resolve(REPO_ROOT, 'packages/stage-ui/src/components/scenarios/dialogs/onboarding/v3')
  if (fs.existsSync(ONBOARDING_V3_DIR)) {
    const enOnboardingPath = path.join(LOCALES_DIR, 'en', 'onboarding.yaml')
    try {
      const enYaml = yaml.parse(fs.readFileSync(enOnboardingPath, 'utf8')) || {}
      function getYamlKeys(obj, prefix = '') {
        const set = new Set()
        for (const [k, v] of Object.entries(obj)) {
          const p = prefix ? `${prefix}.${k}` : k
          set.add(p)
          if (v && typeof v === 'object' && !Array.isArray(v)) {
            for (const child of getYamlKeys(v, p)) {
              set.add(child)
            }
          }
        }
        return set
      }
      const validEnKeys = getYamlKeys(enYaml, 'onboarding')

      function findComponentFiles(dir) {
        const list = []
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory())
            list.push(...findComponentFiles(full))
          else if (entry.name.endsWith('.vue') || entry.name.endsWith('.ts'))
            list.push(full)
        }
        return list
      }

      const componentFiles = findComponentFiles(ONBOARDING_V3_DIR)
      const keyRegex = /[\b\s(](?:t|te)\(\s*['"](onboarding\.[\w.-]+)['"]/g
      const usedKeys = new Map()

      for (const compFile of componentFiles) {
        const src = fs.readFileSync(compFile, 'utf8')
        let match
        while ((match = keyRegex.exec(src)) !== null) {
          const key = match[1]
          if (!usedKeys.has(key))
            usedKeys.set(key, [])
          usedKeys.get(key).push(path.relative(REPO_ROOT, compFile).replace(/\\/g, '/'))
        }
      }

      const missingTemplateKeys = []
      for (const [key, files] of usedKeys.entries()) {
        if (!validEnKeys.has(key)) {
          missingTemplateKeys.push({ key, files: [...new Set(files)] })
        }
      }

      if (missingTemplateKeys.length === 0) {
        console.log(`   ✅ 100% Template-to-YAML Parity: All ${usedKeys.size} keys used in ${componentFiles.length} V3 components exist in en/onboarding.yaml!`)
      }
      else {
        console.error(`   ❌ Found ${missingTemplateKeys.length} missing translation key(s) called in templates:`)
        for (const item of missingTemplateKeys) {
          console.error(`      - ${item.key} (used in: ${item.files.join(', ')})`)
        }
        totalErrors += missingTemplateKeys.length
      }
    }
    catch (e) {
      console.error(`   ❌ Failed component template key audit: ${e.message}`)
      totalErrors++
    }
  }
}

if (isStrict && (totalErrors > 0 || totalMissingAcrossMonorepo > 0)) {
  console.error(`\n❌ Strict mode failed: detected ${totalErrors} errors and ${totalMissingAcrossMonorepo} missing keys across locales.`)
  process.exit(1)
}

process.exit(totalErrors > 0 ? 1 : 0)
