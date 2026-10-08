import type { ChatProvider } from '@xsai-ext/providers/utils'

import type { WebRwkvGenerateRequest } from '../../../libs/inference/contract'
import type { ChatMessage } from './format'

import { DEFAULT_WEB_RWKV_MODEL, PRESETS, WEB_RWKV_MODELS } from '../../../libs/inference'
import { getWebRwkvAdapter, resolveWebRwkvQuantization } from '../../../libs/inference/adapters/web-rwkv'
import { useAiriCardStore } from '../../modules/airi-card'
import { buildRwkvPrompt, createThinkPrefixStripper, openAIChatChunk, openAIChatCompletion, SSE_DONE } from './format'

export { buildRwkvPrompt, createThinkPrefixStripper } from './format'

export interface WebRwkvProviderConfig {
  /** Model `.safetensors` URL. Defaults to {@link DEFAULT_WEB_RWKV_MODEL}. */
  model?: string
  /** Tokenizer vocab URL. Omit to use the worker's bundled RWKV World vocab. */
  vocab?: string
  /** Enable RWKV-7 G1 reasoning prefill & prefix stripping. Defaults to true. */
  enableG1Prefill?: boolean
  /** Quantization precision mode: 'none' (FP16), 'nf4', 'int8'. Defaults to 'none'. */
  quantization?: 'none' | 'nf4' | 'int8'
}

// NucleusSampler penalty defaults matching the upstream web-rwkv-wasm usage
// (presence, count, decay). Sampling temperature / top_p come from the request.
const DEFAULT_PRESENCE_PENALTY = 0.4
const DEFAULT_COUNT_PENALTY = 0.4
const DEFAULT_PENALTY_DECAY = 0.996
const DEFAULT_MAX_TOKENS = 512

interface OpenAIChatBody {
  messages?: ChatMessage[]
  model?: string
  stream?: boolean
  temperature?: number
  top_p?: number
  max_tokens?: number
  presence_penalty?: number
}

/**
 * Local web-rwkv (WebGPU RWKV) chat provider.
 *
 * Use when:
 * - Registering an in-browser RWKV LLM as an OpenAI-compatible `chat` provider so
 *   the existing chat/consciousness flows (`streamText`/`generateText`) drive it
 *   unchanged.
 *
 * Expects:
 * - A WebGPU-capable renderer (web-rwkv has no WASM fallback).
 *
 * Returns:
 * - A {@link ChatProvider} whose `chat()` yields an OpenAI-compatible endpoint;
 *   its `fetch` intercepts `/chat/completions`, builds an RWKV "World" prompt from
 *   the messages, and streams the in-browser model's output as SSE (or a single
 *   JSON body when `stream` is false) — see {@link getWebRwkvAdapter}.
 */
export function createWebRwkvChatProvider(config: WebRwkvProviderConfig = {}): ChatProvider {
  const defaultModelUrl = config.model || DEFAULT_WEB_RWKV_MODEL
  const vocabUrl = config.vocab || undefined
  const enableG1Prefill = config.enableG1Prefill === true
  const quantization = config.quantization ?? 'none'

  return {
    chat: (model: string) => ({
      baseURL: 'http://web-rwkv/v1/',
      model: model || defaultModelUrl,
      headers: {},
      fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = (init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : {}) as OpenAIChatBody
        let modelUrl = body.model || model || defaultModelUrl

        // Resolve shorthand model parameters (e.g. '1.5B', '0.4B') against catalog
        const matchedCatalogModel = WEB_RWKV_MODELS.find(m =>
          m.id === modelUrl || m.params.toLowerCase() === modelUrl.toLowerCase(),
        )
        if (matchedCatalogModel) {
          modelUrl = matchedCatalogModel.id
        }
        else if (modelUrl === 'https' || !modelUrl.startsWith('http')) {
          modelUrl = defaultModelUrl
        }

        const adapter = await getWebRwkvAdapter()
        // Load-on-demand and reload when the selected model/vocab/quantization differs from
        // what's loaded (the adapter is a singleton shared across requests).
        // G1 catalog models resolve quant to FP16 (quant kernels garble G1 output).
        const effectiveQuantization = resolveWebRwkvQuantization(modelUrl, quantization)
        if (adapter.state !== 'ready'
          || adapter.manifest?.model !== modelUrl
          || adapter.manifest?.vocab !== (vocabUrl ?? '')
          || adapter.manifest?.quantization !== effectiveQuantization) {
          await adapter.loadModel(modelUrl, vocabUrl, { quantization: effectiveQuantization, signal: init?.signal ?? undefined })
        }

        let stateCartridgeId: string | undefined
        let stateCartridgeUrl: string | undefined
        let conditioningTexts: string[] | undefined
        let isZeroPrompt = false
        let recommendedTemp: number | undefined
        let recommendedTopP: number | undefined

        try {
          const cardStore = useAiriCardStore()
          const rwkvConfig = (cardStore.activeCard as any)?.extensions?.airi?.rwkv
          if (rwkvConfig?.stateCartridgeId) {
            stateCartridgeId = rwkvConfig.stateCartridgeId
            stateCartridgeUrl = rwkvConfig.stateCartridgeUrl
            isZeroPrompt = rwkvConfig.zeroPromptVerified === true
            recommendedTemp = rwkvConfig.recommendedTemperature
            recommendedTopP = rwkvConfig.recommendedTopP

            // Fallback in-situ synthesis corpus from card conditioningTurns or catalog presets
            if (rwkvConfig.conditioningTurns && Array.isArray(rwkvConfig.conditioningTurns) && rwkvConfig.conditioningTurns.length > 0) {
              conditioningTexts = rwkvConfig.conditioningTurns
            }
            else if (rwkvConfig.archetype && rwkvConfig.archetype !== 'custom') {
              const preset = PRESETS.find(p => p.id === rwkvConfig.archetype)
              if (preset?.conditioningTurns) {
                conditioningTexts = preset.conditioningTurns
              }
            }
          }
        }
        catch {
          // Outside active Pinia scope fallback
        }

        const prompt = buildRwkvPrompt(body.messages ?? [], {
          enableG1Prefill: enableG1Prefill && !isZeroPrompt,
          zeroPrompt: isZeroPrompt,
        })

        const request: WebRwkvGenerateRequest = {
          prompt,
          maxTokens: body.max_tokens ?? DEFAULT_MAX_TOKENS,
          temperature: body.temperature ?? recommendedTemp ?? 1.0,
          topP: body.top_p ?? recommendedTopP ?? 0.5,
          presencePenalty: body.presence_penalty ?? DEFAULT_PRESENCE_PENALTY,
          countPenalty: DEFAULT_COUNT_PENALTY,
          penaltyDecay: DEFAULT_PENALTY_DECAY,
          stateCartridgeId,
          stateCartridgeUrl,
          conditioningTexts,
        }

        const id = `chatcmpl-${Date.now()}`
        const created = Math.floor(Date.now() / 1000)
        const encoder = new TextEncoder()

        if (body.stream) {
          // Drops the leftover `>` the model emits to close the fake-think prefill
          // (see buildRwkvPrompt / createThinkPrefixStripper). Stateful — one per stream.
          const stripThinkPrefix = enableG1Prefill ? createThinkPrefixStripper() : (text: string) => text
          const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
              try {
                controller.enqueue(encoder.encode(openAIChatChunk(id, created, modelUrl, { role: 'assistant' }, null)))
                await adapter.generate(request, {
                  signal: init?.signal ?? undefined,
                  onToken: (text) => {
                    const content = stripThinkPrefix(text)
                    if (content)
                      controller.enqueue(encoder.encode(openAIChatChunk(id, created, modelUrl, { content }, null)))
                  },
                })
                controller.enqueue(encoder.encode(openAIChatChunk(id, created, modelUrl, {}, 'stop')))
                controller.enqueue(encoder.encode(SSE_DONE))
                controller.close()
              }
              catch (error) {
                controller.error(error)
              }
            },
          })

          return new Response(stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
          })
        }

        const text = await adapter.generate(request, { signal: init?.signal ?? undefined })
        // Drop the fake-think prefill's leftover `>` (see buildRwkvPrompt). Token
        // usage isn't tracked on the JS side (the worker owns tokenization), so
        // usage counts are reported as 0.
        const content = enableG1Prefill ? createThinkPrefixStripper()(text) : text
        return new Response(openAIChatCompletion(id, created, modelUrl, content, 0, 0), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    }),
  }
}
