import { filterCandidateExpressions } from './expression-noise-gate'

export interface ModelCapabilityItem {
  rawKey: string
  label: string
  usable: boolean
}

/**
 * Normalizes VRM blendshape/morph keys into readable Title Case labels
 * by stripping internal engine prefixes (Fcl_, vrc_, ARKit_) and formatting delimiters.
 */
export function normalizeVrmKey(key: string): string {
  const prefixes = [
    /^Face\.M_F00_000_00_Fcl_ALL_/i,
    /^Face\.M_F00_000_00_Fcl_/i,
    /^Face\.M_F00_000_00_/i,
    /^Fcl_ALL_/i,
    /^Fcl_BRW_/i,
    /^Fcl_/i,
    /^vrc\.v_/i,
    /^vrc_/i,
    /^vrc\./i,
    /^INA-/i,
    /^ARKit_BS\./i,
    /^ARKit_/i,
  ]
  let clean = key
  for (const p of prefixes) {
    clean = clean.replace(p, '')
  }

  // Split camelCase
  clean = clean.replace(/(?<=[a-z])(?=[A-Z])/g, ' ')
  clean = clean.replace(/(?<=[A-Z])(?=[A-Z][a-z])/g, ' ')

  // Replace delimiters with spaces
  clean = clean.replace(/[_\-.]/g, ' ')

  // Title Case
  return clean.split(/\s+/).map((word) => {
    if (!word)
      return ''
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  }).join(' ').trim() || key
}

/**
 * Normalizes motion filenames into clean display names.
 * Unpacks auto-generated packed names like "Motions_A10_1_File_0" into "A10 #2".
 */
export function resolveDefaultMotionLabel(key: string): string {
  const base = key.split(/[\\/]/).pop() || key
  const cleanBase = base.replace(/\.motion3\.json$/i, '').replace(/\.(motion3|mtn|vmd|json)$/i, '')

  const unpackMatch = cleanBase.match(/^Motions_([A-Z0-9]+)_(\d+)_File_(\d+)$/i)
  if (unpackMatch) {
    return `${unpackMatch[1]} #${Number(unpackMatch[2]) + 1}`
  }

  return cleanBase.replace(/[_\-.]/g, ' ').trim() || key
}

/**
 * Resolves a default human label for an expression based on format.
 */
export function resolveDefaultExpressionLabel(key: string, isVrm = false): string {
  if (isVrm) {
    return normalizeVrmKey(key)
  }
  const base = key.split(/[\\/]/).pop() || key
  const cleanBase = base.replace(/\.(exp3|json)$/i, '')
  return cleanBase.replace(/[_\-.]/g, ' ').trim() || key
}

/**
 * Builds a clean, deduplicated ModelCapabilityItem array for expressions.
 * Automatically runs the noise gate to assign usable: true for emotes and usable: false for noise/physics.
 */
export function buildExpressionCapabilities(rawKeys: string[], isVrm = false): ModelCapabilityItem[] {
  const unique = [...new Set(rawKeys)].sort((a, b) => a.localeCompare(b))
  const gateResult = filterCandidateExpressions(unique)

  return unique.map((rawKey) => {
    const isUsable = gateResult.candidates.includes(rawKey)
    return {
      rawKey,
      label: resolveDefaultExpressionLabel(rawKey, isVrm),
      usable: isUsable,
    }
  })
}

/**
 * Builds a clean, deduplicated ModelCapabilityItem array for motions.
 * Motions default to usable: true.
 */
export function buildMotionCapabilities(rawKeys: string[]): ModelCapabilityItem[] {
  const unique = [...new Set(rawKeys)].sort((a, b) => a.localeCompare(b))

  return unique.map((rawKey) => {
    return {
      rawKey,
      label: resolveDefaultMotionLabel(rawKey),
      usable: true,
    }
  })
}
