/**
 * NOTICE: CJK characters tokenize roughly 1:1 (one char ≈ one token) while ASCII/Latin
 * text tokenizes at ~4 chars per token. Counts are summed separately so estimates remain
 * accurate for the multilingual (Japanese/Chinese/Korean) content this project targets.
 */
export function estimateTokens(text: string): number {
  const trimmed = text.trim()
  if (!trimmed)
    return 1

  let cjkCount = 0
  for (const char of trimmed) {
    const cp = char.codePointAt(0) ?? 0
    if (
      (cp >= 0x4E00 && cp <= 0x9FFF) // CJK Unified Ideographs
      || (cp >= 0x3400 && cp <= 0x4DBF) // CJK Ext-A
      || (cp >= 0x20000 && cp <= 0x2A6DF) // CJK Ext-B
      || (cp >= 0xF900 && cp <= 0xFAFF) // CJK Compatibility Ideographs
      || (cp >= 0x3000 && cp <= 0x303F) // CJK Symbols and Punctuation
      || (cp >= 0x3040 && cp <= 0x309F) // Hiragana
      || (cp >= 0x30A0 && cp <= 0x30FF) // Katakana
      || (cp >= 0xAC00 && cp <= 0xD7AF) // Hangul Syllables
    ) {
      cjkCount++
    }
  }

  const nonCjkCount = trimmed.length - cjkCount
  return Math.max(1, cjkCount + Math.ceil(nonCjkCount / 4))
}

/**
 * Mapping of Windows-1252 specific high-range Unicode characters back to their original byte values.
 * This is used to "un-mismatch" encoding when a UTF-8 stream was misinterpreted as Windows-1252.
 */
const WIN1252_TO_BYTE: Record<number, number> = {
  0x20AC: 0x80, // €
  0x201A: 0x82, // ‚
  0x0192: 0x83, // ƒ
  0x201E: 0x84, // „
  0x2026: 0x85, // …
  0x2020: 0x86, // †
  0x2021: 0x87, // ‡
  0x02C6: 0x88, // ˆ
  0x2030: 0x89, // ‰
  0x0160: 0x8A, // Š
  0x2039: 0x8B, // ‹
  0x0152: 0x8C, // Œ
  0x017D: 0x8E, // Ž
  0x2018: 0x91, // ‘
  0x2019: 0x92, // ’
  0x201C: 0x93, // “
  0x201D: 0x94, // ”
  0x2022: 0x95, // •
  0x2013: 0x96, // –
  0x2014: 0x97, // —
  0x02DC: 0x98, // ˜
  0x2122: 0x99, // ™
  0x0161: 0x9A, // š
  0x203A: 0x9B, // ›
  0x0153: 0x9C, // œ
  0x017E: 0x9E, // ž
  0x0178: 0x9F, // Ÿ
}

/**
 * Heals "Mozibake" (character scramble) where UTF-8 bytes were interpreted as Windows-1252/Latin-1.
 * Matches common mangled Kaomoji fragments like 'Ê·' -> 'ʷ' by identifying sequences of
 * misinterpreted characters and restoring them while leaving valid Unicode symbols untouched.
 */
export function healMozibake(text: string): string {
  if (!text || !/[^\u0000-\u007F]/.test(text))
    return text

  // Literal mappings for common fragments that are hard to recover via bit-shifting
  const commonScrambles: Record<string, string> = {
    'Ê·': 'ʷ',
    'â—´': '◴',
    'â—•': '•',
    'á´¥': 'ᴥ',
    'â‰§': '≧',
    'ï¿£': '￣',
    'ãƒ˜': 'ヘ',
    'â¬½': '⬽',
    'Â¬': '¬',
    'â–½': '▽',
    'Ê•': 'ʕ',
    'Ê"': 'ʔ',
    'â‰¦': '≦',
  }

  let healed = text
  for (const [key, val] of Object.entries(commonScrambles)) {
    healed = healed.replaceAll(key, val)
  }

  // Selective healing of remaining misinterpreted byte sequences
  // We scan the string for "suspicious" sequences that are likely UTF-8 start/cont bytes
  try {
    const bytes: number[] = []
    let changed = false

    for (const char of healed) {
      const code = char.codePointAt(0) ?? 0

      // If it's a single-unit character that COULD be a mis-decoded byte (0x80-0xFF or mapping)
      if (char.length === 1 && (code <= 0xFF || WIN1252_TO_BYTE[code] !== undefined)) {
        const byte = (code <= 0xFF) ? code : WIN1252_TO_BYTE[code]
        bytes.push(byte)
        if (code !== byte)
          changed = true
      }
      else {
        // It's a high-range character or a surrogate pair (multiple code units).
        // To preserve it, we'll encode the whole code point back to its UTF-8 bytes and push those.
        // This keeps the byte stream consistent for the final TextDecoder.
        const encoded = new TextEncoder().encode(char)
        for (const b of encoded) bytes.push(b)
      }
    }

    if (changed || bytes.length !== healed.length) {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes))
      if (decoded && decoded !== healed)
        return decoded
    }
  }
  catch {
    // If selective byte-reconstruction fails, stick with the literal replacements.
  }

  return healed
}

/**
 * Normalizes text for resilient search comparisons:
 * 1. NFKC normalization (converts full-width Latin/numbers, half-width katakana, ligatures)
 * 2. Lowercase
 * 3. NFD normalization and diacritic removal (accents, umlauts)
 * 4. Whitespace trimming
 */
export function normalizeSearchText(text?: string | null): string {
  if (!text)
    return ''
  return text
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '')
    .trim()
}
