/**
 * Direct Node.js WASM Runner for Needle 2 (Cactus SAN 45M).
 * Runs completely on CPU / WASM using cached weights (~14 MB) in ~/.cache/needle2.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createRequire } from 'node:module'

import { EXTRACT_MEMORY_FRAGMENTS_TOOL, validateExtractionSpans } from './needle-schema.mjs'

const require = createRequire(import.meta.url)

export class NeedleNode {
  constructor(moduleInstance, cfuncs, cacheDir) {
    this.Module = moduleInstance
    this.cfuncs = cfuncs
    this.cacheDir = cacheDir
    this.isInitialized = false
    this.outCap = 8192
    this.outPtr = this.Module._malloc(this.outCap)
  }

  static async load(opts = {}) {
    const cacheDir = opts.cacheDir || path.join(os.homedir(), '.cache', 'needle2')
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true })
    }

    const wasmPath = path.join(cacheDir, 'needle.wasm')
    const cactPath = path.join(cacheDir, 'needle2.cact')
    const jsPath = path.join(cacheDir, 'needle.js')

    // Download if missing
    if (!fs.existsSync(wasmPath) || !fs.existsSync(cactPath) || !fs.existsSync(jsPath)) {
      throw new Error(`Needle assets missing in ${cacheDir}. Please run asset download script.`)
    }

    const createNeedle = require(jsPath)
    const wasmBinary = fs.readFileSync(wasmPath)
    const cactBinary = fs.readFileSync(cactPath)

    const Module = await createNeedle({
      wasmBinary,
      locateFile: f => path.join(cacheDir, f),
    })

    const needle_load = Module.cwrap('needle_load', 'number', ['number', 'number'])
    const needle_init = Module.cwrap('needle_init', 'number', ['string', 'string', 'string'])
    const needle_complete = Module.cwrap('needle_complete', 'number', ['string', 'number', 'number', 'number'])
    const needle_reset = Module.cwrap('needle_reset', 'void', [])

    // Allocate cact buffer in wasm memory
    const cactPtr = Module._malloc(cactBinary.length)
    Module.HEAPU8.set(cactBinary, cactPtr)
    const loadRet = needle_load(cactPtr, BigInt(cactBinary.length))
    Module._free(cactPtr)

    if (loadRet !== 0) {
      console.warn(`[NeedleNode] needle_load returned non-zero code: ${loadRet}`)
    }

    const instance = new NeedleNode(Module, {
      needle_init,
      needle_complete,
      needle_reset,
    }, cacheDir)

    instance.initExtractionTool()
    return instance
  }

  initExtractionTool() {
    const sysPrompt = 'You are an information extraction assistant. Extract mentions, temporal phrases, and factual claims using extract_memory_fragments.'
    const toolsJson = JSON.stringify([EXTRACT_MEMORY_FRAGMENTS_TOOL])
    this.cfuncs.needle_init(sysPrompt, toolsJson, '')
    this.isInitialized = true
  }

  /**
   * Extract mentions and claims from a target passage using Needle WASM with span validation.
   * @param {string} passage - Full passage (e.g. 3-turn window)
   * @param {string} targetText - The specific target turn text
   * @returns {{ mentions: string[], temporal_phrase: string|null, claims: any[], rawOutput?: any }}
   */
  extractFragments(passage, targetText = passage) {
    if (!this.isInitialized) {
      this.initExtractionTool()
    }

    this.cfuncs.needle_reset()

    const prompt = `Dialogue Context:\n${passage}\n\nTask: Extract mentions, temporal phrases, and claims from the target passage using extract_memory_fragments.`
    const compRet = this.cfuncs.needle_complete(prompt, 192, this.outPtr, this.outCap)
    const outStr = this.Module.UTF8ToString(this.outPtr)

    let parsed = null
    try {
      parsed = JSON.parse(outStr)
    }
    catch {
      // Fallback regex extraction if JSON parse fails
      return this.fallbackExtract(targetText)
    }

    if (parsed && Array.isArray(parsed.function_calls) && parsed.function_calls.length > 0) {
      const call = parsed.function_calls[0]
      const args = call.arguments || {}
      const validated = validateExtractionSpans(targetText, args)
      return {
        ...validated,
        confidence: parsed.confidence ?? 0.5,
        rawOutput: parsed,
      }
    }

    // If no tool was called or empty, use fallback
    return this.fallbackExtract(targetText)
  }

  /**
   * Complete a general query using Needle as an SLM answer head.
   * @param {string} prompt
   * @param {number} maxTokens
   * @returns {string}
   */
  complete(prompt, maxTokens = 64) {
    this.cfuncs.needle_reset()
    this.cfuncs.needle_complete(prompt, maxTokens, this.outPtr, this.outCap)
    const outStr = this.Module.UTF8ToString(this.outPtr)
    try {
      const parsed = JSON.parse(outStr)
      if (parsed.reasoning)
        return parsed.reasoning
      if (parsed.text)
        return parsed.text
      return outStr
    }
    catch {
      return outStr
    }
  }

  /**
   * Robust heuristic fallback extractor for dialogue turns.
   */
  fallbackExtract(text) {
    const mentions = []
    const claims = []
    let temporal_phrase = null

    // Temporal patterns
    const timeMatch = text.match(/\b(last week|yesterday|three days ago|a few weeks ago|in April 2022|today|first week of April|last month)\b/i)
    if (timeMatch) {
      temporal_phrase = timeMatch[0]
    }

    // Capitalized entity names
    const words = text.split(/\s+/)
    for (const w of words) {
      const clean = w.replace(/^\W+|\W+$/g, '')
      if (clean.length > 2 && /^[A-Z][a-z]+$/.test(clean)) {
        if (!['Hey', 'The', 'And', 'Yes', 'What', 'When', 'Where', 'How', 'Did', 'Does', 'Any'].includes(clean)) {
          if (!mentions.includes(clean))
            mentions.push(clean)
        }
      }
    }

    // Check for pets / animals
    const animalMatch = text.match(/\b(pup|puppy|dog|dogs|cat|kitten)\b/i)
    if (animalMatch && !mentions.includes(animalMatch[0])) {
      mentions.push(animalMatch[0])
    }

    return {
      mentions,
      temporal_phrase,
      claims,
      confidence: 0.5,
    }
  }

  close() {
    if (this.outPtr) {
      this.Module._free(this.outPtr)
      this.outPtr = 0
    }
  }
}
