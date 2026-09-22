/**
 * Vision Orchestrator Store (proposal §10).
 *
 * Routes captured frames to the selected vision workload:
 *   - `screen:attention-ecology-guard` -> the 0-cost local cascading guard
 *     (Web Worker). Promotions publish a [Visual Event] summary into the
 *     character context via `modsServerChannelStore.sendContextUpdate`.
 *   - Upstream VLM workloads (`screen:interpret`, ...) -> the existing cloud
 *     vision ingestion path (chat orchestrator with an image attachment).
 *
 * Tracks telemetry (`lastResultText/At/Error/WorkloadId`) and enforces §6
 * promotion discipline (attention budget + hysteresis cooldown).
 */

import type { AttentionGuardAdapter } from '../../../libs/inference/adapters/attention-guard'
import type { AttentionGuardProcessResult } from '../../../libs/inference/contract'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { defineStore } from 'pinia'
import { ref } from 'vue'

import { ATTENTION_GUARD_WORKLOAD_ID } from '../../../composables/vision/use-vision-workloads'
import { createAttentionGuardAdapter } from '../../../libs/inference/adapters/attention-guard'
import { useChatOrchestratorStore } from '../../chat'
import { useLLM } from '../../llm'
import { useModsServerChannelStore } from '../../mods/api/channel-server'
import { useProvidersStore } from '../../providers'
import { useLiveSessionStore } from '../live-session'
import { useVisionStore } from '../vision'

export { ATTENTION_GUARD_WORKLOAD_ID, useVisionWorkloads, VISION_WORKLOADS } from '../../../composables/vision/use-vision-workloads'

/** §6: maximum unsolicited promotions per rolling hour. */
const ATTENTION_BUDGET_PER_HOUR = 3
/** §6: hysteresis cooldown after a promotion (threshold spikes, then decays). */
const HYSTERESIS_COOLDOWN_MS = 60_000

export interface VisionCapturePayload {
  /** Base64/URL-encoded capture frame. */
  dataUrl: string
  width: number
  height: number
  sourceId: string
  workloadId: string
  timestamp: number
  interestTags?: string[]
  enableVlm?: boolean
  vlmTier?: 'lightweight' | 'moondream' | 'external'
}

export interface VisionOrchestratorResult {
  decision: 'IGNORE' | 'NOTE' | 'PROMOTE' | 'BASELINE'
  summary?: string
  novelty?: number
  ocrErrorPatternHits?: number
  ocrErrorPatterns?: string[]
  interestKeywordHits?: number
  interestKeywords?: string[]
}

export const useVisionOrchestratorStore = defineStore('vision-orchestrator', () => {
  const modsServerChannelStore = useModsServerChannelStore()

  // Telemetry
  const lastResultText = ref('')
  const lastResultAt = ref<number>(0)
  const lastError = ref<string | null>(null)
  const lastWorkloadId = ref<string>('')

  // §6 promotion discipline state
  const promotionTimes: number[] = []
  const lastPromotionAt = ref<number>(0)

  // Provisioning state
  const isProvisioning = ref(false)
  const provisioningPercent = ref<number>(0)
  const provisioningMessage = ref<string>('')
  const provisioningPhase = ref<'idle' | 'downloading' | 'compiling' | 'ready' | 'error'>('idle')
  const isLightweightReady = ref(false)
  const isVlmReady = ref(false)

  // Guard adapter (lazy)
  let guardAdapter: AttentionGuardAdapter | null = null
  let guardLoadPromise: Promise<void> | null = null

  function ensureGuardAdapter(): AttentionGuardAdapter {
    if (!guardAdapter)
      guardAdapter = createAttentionGuardAdapter()
    return guardAdapter
  }

  async function ensureGuardLoaded(options?: {
    enableVlm?: boolean
    forceReload?: boolean
    onProgress?: (p: any) => void
    signal?: AbortSignal
  }): Promise<AttentionGuardAdapter> {
    const adapter = ensureGuardAdapter()
    const needsReload = Boolean(options?.forceReload)
      || (Boolean(options?.enableVlm) && !adapter.lastLoadConfig?.enableVlm)

    if (!needsReload && (adapter.state === 'ready' || adapter.state === 'processing')) {
      if (options?.enableVlm) {
        isVlmReady.value = true
        isLightweightReady.value = true
      }
      else {
        isLightweightReady.value = true
      }
      return adapter
    }

    if (!guardLoadPromise || adapter.state === 'idle' || adapter.state === 'error' || adapter.state === 'terminated' || needsReload) {
      guardLoadPromise = (async () => {
        try {
          await adapter.load({
            enableVlm: options?.enableVlm,
            signal: options?.signal,
            onProgress: (p) => {
              if (p.phase === 'warmup' || (typeof p.percent === 'number' && p.percent >= 100)) {
                provisioningPhase.value = 'compiling'
                provisioningPercent.value = 100
                provisioningMessage.value = p.message || 'Compiling WebGPU shaders & warming up model…'
              }
              else if (typeof p.percent === 'number' && p.percent >= 0) {
                provisioningPhase.value = 'downloading'
                const candidate = Math.min(99, Math.round(p.percent))
                provisioningPercent.value = Math.max(provisioningPercent.value, candidate)
                provisioningMessage.value = p.message || `Downloading shards (${provisioningPercent.value}%)...`
              }
              else if (p.message) {
                provisioningMessage.value = p.message
              }
              options?.onProgress?.(p)
            },
          })
          if (options?.enableVlm) {
            isVlmReady.value = true
            isLightweightReady.value = true
          }
          else {
            isLightweightReady.value = true
          }
          provisioningPhase.value = 'ready'
        }
        catch (err: any) {
          provisioningPhase.value = 'error'
          lastError.value = `guard load failed: ${err.message || String(err)}`
          throw err
        }
        finally {
          guardLoadPromise = null
        }
      })()
    }

    await guardLoadPromise
    return adapter
  }

  async function provisionModels(options: { enableVlm?: boolean }): Promise<void> {
    if (isProvisioning.value)
      return

    isProvisioning.value = true
    provisioningPercent.value = 0
    provisioningPhase.value = 'downloading'
    provisioningMessage.value = options.enableVlm
      ? 'Downloading and compiling Moondream2 VLM (~1.1GB)...'
      : 'Downloading and compiling Lightweight models (CLIP + Tesseract ~307MB)...'

    try {
      await ensureGuardLoaded({
        enableVlm: options.enableVlm,
        forceReload: true,
      })
      provisioningPercent.value = 100
      provisioningPhase.value = 'ready'
      provisioningMessage.value = options.enableVlm
        ? 'Moondream2 VLM primed & ready for real-time commentary.'
        : 'Lightweight OCR & CLIP engine primed and ready.'
    }
    catch (err: any) {
      provisioningPhase.value = 'error'
      provisioningMessage.value = `Provisioning failed: ${err.message || String(err)}`
      throw err
    }
    finally {
      isProvisioning.value = false
    }
  }

  /** True when the §6 promotion budget + hysteresis cooldown allow a publish. */
  function promotionAllowed(now = Date.now()): boolean {
    if (now - lastPromotionAt.value < HYSTERESIS_COOLDOWN_MS)
      return false
    const windowStart = now - 60 * 60 * 1000
    while (promotionTimes.length > 0 && promotionTimes[0] < windowStart) promotionTimes.shift()
    return promotionTimes.length < ATTENTION_BUDGET_PER_HOUR
  }

  function recordPromotion(): void {
    const now = Date.now()
    lastPromotionAt.value = now
    promotionTimes.push(now)
  }

  /** Publish a promotion summary into character context (ReplaceSelf). */
  function publishContext(summary: string, workloadId: string, sourceId: string): void {
    modsServerChannelStore.sendContextUpdate({
      strategy: ContextUpdateStrategy.ReplaceSelf,
      contextId: `vision:${workloadId}:${sourceId}`,
      text: summary,
      metadata: { kind: 'vision', workload: workloadId },
    })
  }

  /** Cloud VLM path: existing chat-orchestrator ingestion with the frame attached. */
  async function runCloudWorkload(payload: VisionCapturePayload): Promise<void> {
    const chatOrchestrator = useChatOrchestratorStore()
    const base64 = payload.dataUrl.split(',')[1] ?? payload.dataUrl
    await chatOrchestrator.ingest('You are acting as a continuous ambient vision observer. Observe the screen and describe anything interesting, relevant, or notable. Stay in character.', {
      attachments: [
        {
          type: 'image',
          data: base64,
          mimeType: 'image/png',
          fileName: 'screenshot.png',
          size: 0,
        },
      ],
    })
  }

  /**
   * Route one captured frame through the selected workload. The guard path
   * returns the cascade result; the cloud path ingests via the chat
   * orchestrator (promotions surface through the normal reply flow).
   */
  async function processCapture(payload: VisionCapturePayload): Promise<VisionOrchestratorResult | null> {
    lastWorkloadId.value = payload.workloadId

    if (payload.workloadId === ATTENTION_GUARD_WORKLOAD_ID) {
      try {
        const isMoondream = payload.vlmTier === 'moondream' || (Boolean(payload.enableVlm) && payload.vlmTier !== 'external')
        const adapter = await ensureGuardLoaded({ enableVlm: isMoondream })
        const tags = Array.isArray(payload.interestTags) ? Array.from(payload.interestTags).map(t => String(t)) : []
        const result: AttentionGuardProcessResult = await adapter.process(
          payload.dataUrl,
          payload.width,
          payload.height,
          tags,
        )

        lastResultAt.value = Date.now()
        lastError.value = null

        if (result.decision === 'PROMOTE') {
          // If external VLM tier is selected, query the global VLM for a rich scene caption
          if (payload.vlmTier === 'external') {
            try {
              const visionStore = useVisionStore()
              const providersStore = useProvidersStore()
              const llmStore = useLLM()

              if (visionStore.activeProvider && visionStore.activeModel) {
                const vlmProvider = await providersStore.getProviderInstance(visionStore.activeProvider) as any
                const base64 = payload.dataUrl.includes(',') ? payload.dataUrl.split(',')[1] : payload.dataUrl
                const prompt = 'Observe this screenshot and describe what is happening in 1-2 concise, objective sentences. Mention any visible applications, active tasks, code, games, or errors. Do not use conversational filler or speak as a character.'

                const vlmMessages = [
                  {
                    role: 'user' as const,
                    content: [
                      { type: 'text', text: prompt },
                      {
                        type: 'image_url' as const,
                        image_url: {
                          url: `data:image/png;base64,${base64}`,
                        },
                      },
                    ],
                  },
                ]

                console.log(`[Vision Orchestrator] Requesting external VLM (${visionStore.activeProvider}/${visionStore.activeModel}) caption for promoted event...`)
                const vlmResponse = await llmStore.generate(
                  visionStore.activeModel,
                  vlmProvider,
                  vlmMessages as any,
                  { vision: true },
                )

                const caption = vlmResponse.text?.trim().replace(/^["']|["']$/g, '').replace(/\r?\n+/g, ' ').trim()
                if (caption) {
                  result.caption = caption
                  if (result.summary && result.summary.includes('[Visual Event]')) {
                    const lines = result.summary.split('\n')
                    const matchIdx = lines.findIndex(l => l.startsWith('Matched Interests:'))
                    const insertIdx = matchIdx >= 0 ? matchIdx + 1 : (lines.length > 1 ? 2 : lines.length)
                    lines.splice(insertIdx, 0, `Screen Content Tags: ${caption}`)
                    result.summary = lines.join('\n')
                  }
                  else {
                    result.summary = `[Visual Event]\nScreen Content Tags: ${caption}${result.summary ? `\n${result.summary}` : ''}`
                  }
                  useLiveSessionStore().recordInferenceUsage(vlmResponse.usage)
                }
              }
              else {
                console.warn('[Vision Orchestrator] External VLM tier selected, but no global vision provider/model is configured in Vision Settings.')
              }
            }
            catch (vlmErr: any) {
              console.warn('[Vision Orchestrator] External VLM caption failed, keeping deterministic summary:', vlmErr)
            }
          }

          lastResultText.value = result.summary ?? `[Visual Event] (${result.ocrErrorPatterns.join(', ')})`
          if (result.summary && promotionAllowed()) {
            publishContext(result.summary, payload.workloadId, payload.sourceId)
            recordPromotion()
          }
        }
        else {
          lastResultText.value = `${result.decision} (novelty=${result.novelty.toFixed(4)})`
        }

        return {
          decision: result.decision,
          summary: result.summary,
          novelty: result.novelty,
          ocrErrorPatternHits: result.ocrErrorPatternHits,
          ocrErrorPatterns: result.ocrErrorPatterns,
          interestKeywordHits: result.interestKeywordHits,
          interestKeywords: result.interestKeywords,
        }
      }
      catch (err: any) {
        lastError.value = err.message || String(err)
        throw err
      }
    }

    // Upstream cloud VLM workloads -> existing ingestion path.
    try {
      await runCloudWorkload(payload)
      lastResultText.value = 'cloud vision ingestion dispatched'
      lastResultAt.value = Date.now()
      lastError.value = null
      return { decision: 'NOTE' }
    }
    catch (err: any) {
      lastError.value = err.message || String(err)
      throw err
    }
  }

  function terminate(): void {
    guardAdapter?.terminate()
    guardAdapter = null
    guardLoadPromise = null
  }

  return {
    lastResultText,
    lastResultAt,
    lastError,
    lastWorkloadId,
    isProvisioning,
    provisioningPercent,
    provisioningMessage,
    provisioningPhase,
    isLightweightReady,
    isVlmReady,
    provisionModels,
    processCapture,
    publishContext,
    terminate,
    ensureGuardLoaded,
  }
})
