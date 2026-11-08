import type { MathJson } from '@proj-airi/mathjson'

import { chemistry } from '@proj-airi/speech-transformer-chem'
import { MathSpeech } from '@proj-airi/speech-transformer-math'

/**
 * The formula and chemical speech reader for AIRI.
 * Extends `@proj-airi/speech-transformer-math` with the `chemistry()` extension from `@proj-airi/speech-transformer-chem`.
 */
export const mathSpeech = new MathSpeech({ extensions: [chemistry()] })

/** Reads TeX math or chemical source as spoken words in one language. */
export function speakMath(tex: string, language: string): string {
  try {
    return mathSpeech.speak(tex, language)
  }
  catch {
    return tex
  }
}

/** Lowers TeX math source into MathJSON AST. */
export function toMathJson(tex: string): MathJson {
  return mathSpeech.toMathJson(tex)
}

/**
 * The primary language subtag of a BCP 47 code: `zh` for `zh-CN`, `ko` for `ko_KR`.
 * Chinese dialect codes map to `zh`.
 */
export function toSpeechLanguage(code: string | undefined): string | undefined {
  if (code === undefined)
    return undefined
  const primary = code.toLowerCase().split(/[-_]/)[0] ?? ''
  if (primary === 'cmn' || primary === 'yue')
    return 'zh'
  return primary || undefined
}

const kana = /[\p{Script=Hiragana}\p{Script=Katakana}]/u
const hangul = /\p{Script=Hangul}/u
const han = /\p{Script=Han}/u
const latinWord = /[a-z]{2,}/i

/**
 * Selects the language of a formula or price from the surrounding sentence/words.
 */
export function detectSpeechLanguage(context: string, fallback?: string): string {
  if (kana.test(context))
    return 'ja'
  if (hangul.test(context))
    return 'ko'
  if (han.test(context))
    return fallback === 'ja' ? 'ja' : 'zh'
  if (latinWord.test(context))
    return 'en'
  return fallback ?? 'en'
}

/**
 * Commands that start a bare formula in plain text.
 */
const knownCommands = new Set([
  ...Object.keys(mathSpeech.locale('en').words),
  ...Object.keys(mathSpeech.locale('en').relations),
  ...Object.keys(mathSpeech.locale('en').operators),
  ...mathSpeech.rawCommands.map(command => `\\${command}`),
  ...['frac', 'dfrac', 'tfrac', 'sqrt', 'text', 'mathrm', 'mathbb', 'overline', 'vec', 'hat', 'left', 'right', 'sum', 'prod', 'int', 'binom', 'overset', 'prime', 'circ'].map(name => `\\${name}`),
].filter(key => key.startsWith('\\')))

const mathToken = /^(?:\s+|\d+(?:\.\d+)?|[A-Z]+|[a-z](?![a-z])|[=+\-*/<>()|'!^_[\]∞⊥∥≤≥≠≈∈∉⊆⊂∠△°±×÷→])/
const trigger = /\\([a-z]+)|[a-z0-9)]\^[{\w]|_\{/gi

function readBalanced(text: string, start: number): number {
  let depth = 0
  for (let index = start; index < text.length; index++) {
    if (text[index] === '\\') {
      index++
      continue
    }
    if (text[index] === '{')
      depth++
    if (text[index] === '}' && --depth === 0)
      return index + 1
  }
  return text.length
}

/**
 * Finds TeX formulas written without delimiters in plain text (e.g. `\frac{1}{2}`, `\alpha = 5`, `\ce{H2O}`).
 */
export function findBareLatex(text: string): { start: number, end: number }[] {
  const spans: { start: number, end: number }[] = []
  for (const match of text.matchAll(trigger)) {
    if (match.index < (spans.at(-1)?.end ?? 0))
      continue
    if (match[1] !== undefined && !knownCommands.has(`\\${match[1]}`))
      continue

    let start = match.index
    while (start > 0) {
      const before = text.slice(0, start)
      const token = /(?:\s+|\d+(?:\.\d+)?|[A-Z]+|(?<![a-z])[a-z]|[=+\-*/<>()|'!^_])$/.exec(before)
      if (!token || before.length - token[0].length < (spans.at(-1)?.end ?? 0))
        break
      start -= token[0].length
    }

    let end = match.index
    while (end < text.length) {
      const rest = text.slice(end)
      if (rest[0] === '\\') {
        end += /^\\(?:[a-z]+|.)/i.exec(rest)![0].length
        continue
      }
      if (rest[0] === '{') {
        end = readBalanced(text, end)
        continue
      }
      const token = mathToken.exec(rest)
      if (!token)
        break
      end += token[0].length
    }

    while (start < end && /\s/.test(text[start]!))
      start++
    while (end > start && /\s/.test(text[end - 1]!))
      end--
    if (end > start)
      spans.push({ start, end })
  }
  return spans
}

/**
 * Braces a multi-digit script in bare TeX (e.g. `2^10` -> `2^{10}`).
 */
export function braceBareScripts(tex: string): string {
  return tex.replace(/([\^_])(\d{2,}(?:\.\d+)?|\d+\.\d+)/g, '$1{$2}')
}

/**
 * Replaces balanced TeX command invocations like `\ce{...}` in text.
 */
export function replaceBalancedCommand(
  text: string,
  command: string,
  replacer: (fullMatch: string, inner: string) => string,
): string {
  const prefix = `\\${command}{`
  let index = 0
  let result = ''
  while (index < text.length) {
    const start = text.indexOf(prefix, index)
    if (start === -1) {
      result += text.slice(index)
      break
    }
    let backslashes = 0
    let b = start - 1
    while (b >= 0 && text[b] === '\\') {
      backslashes++
      b--
    }
    if (backslashes % 2 !== 0) {
      result += text.slice(index, start + prefix.length)
      index = start + prefix.length
      continue
    }

    result += text.slice(index, start)
    let depth = 1
    let pos = start + prefix.length
    while (pos < text.length && depth > 0) {
      if (text[pos] === '\\') {
        pos += 2
        continue
      }
      if (text[pos] === '{')
        depth++
      else if (text[pos] === '}')
        depth--
      pos++
    }

    if (depth === 0) {
      const fullMatch = text.slice(start, pos)
      const inner = text.slice(start + prefix.length, pos - 1)
      result += replacer(fullMatch, inner)
      index = pos
    }
    else {
      result += text.slice(start, pos)
      index = pos
    }
  }
  return result
}
