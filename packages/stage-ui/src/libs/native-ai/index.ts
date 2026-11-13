import type {
  DeleteCachedModelOptions,
  DownloadModelOptions,
  DownloadProgressEvent,
  GenerateStreamOptions,
  HardwareTelemetry,
  ListCachedModelsResult,
  LoadModelOptions,
  LoadModelResult,
  PingResponse,
  TestStreamOptions,
  TokenStreamEvent,
  UnloadModelOptions,
} from './definitions'

export * from './definitions'

// NOTICE: The Capacitor-based native bridge (on-device Apple Core AI via a Swift plugin) is
// gone with the mobile app purge. Everything below is the mock/simulated path the web and
// desktop builds always used. Reintroduce a native provider behind the same `NativeAI`
// surface when the unified Rust-native app grows an on-device inference path.

/**
 * Format raw bytes into human-readable memory strings (e.g. "6.0 GB" or "350.2 MB")
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || Number.isNaN(bytes) || bytes <= 0)
    return '0 B'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Number.parseFloat((bytes / k ** i).toFixed(dm))} ${sizes[i]}`
}

/**
 * Fallback telemetry for Web/Browser — the only environment now.
 */
function createSafeFallbackTelemetry(partial?: Partial<HardwareTelemetry>, raw?: Record<string, unknown>): HardwareTelemetry {
  const isWeb = typeof navigator !== 'undefined'
  const navMemory = isWeb && 'deviceMemory' in navigator ? (navigator as any).deviceMemory * 1024 * 1024 * 1024 : 4 * 1024 * 1024 * 1024
  const cpuCores = isWeb ? navigator.hardwareConcurrency || 4 : 4
  const userAgent = isWeb ? navigator.userAgent : 'Unknown Environment'

  return {
    deviceModel: partial?.deviceModel || 'Generic Web / Desktop Client',
    rawMachineId: partial?.rawMachineId || 'web-environment',
    chipFamily: partial?.chipFamily || (isWeb && /Mac/i.test(userAgent) ? 'Apple Silicon (Web)' : 'Browser Runtime'),
    cpuCores: partial?.cpuCores || cpuCores,
    totalMemoryBytes: partial?.totalMemoryBytes || navMemory,
    totalMemoryFormatted: partial?.totalMemoryFormatted || formatBytes(partial?.totalMemoryBytes || navMemory),
    availableMemoryBytes: partial?.availableMemoryBytes || Math.floor(navMemory * 0.6),
    availableMemoryFormatted: partial?.availableMemoryFormatted || formatBytes(partial?.availableMemoryBytes || Math.floor(navMemory * 0.6)),
    gpuDeviceName: partial?.gpuDeviceName || 'Browser WebGPU / WebGL Engine',
    hasUnifiedMemory: partial?.hasUnifiedMemory ?? true,
    maxWorkingSetBytes: partial?.maxWorkingSetBytes || Math.floor(navMemory * 0.4),
    osVersion: partial?.osVersion || (isWeb ? `${navigator.platform || 'Web'} (${userAgent.slice(0, 40)}...)` : 'Web 1.0'),
    isCoreAIAvailable: partial?.isCoreAIAvailable ?? false,
    isNeuralEngineAvailable: partial?.isNeuralEngineAvailable ?? false,
    rawDiagnostics: raw || {
      userAgent,
      platform: 'web',
      isNative: false,
      timestamp: Date.now(),
      ...partial?.rawDiagnostics,
    },
  }
}

/**
 * NativeAI with the native bridge removed; every method resolves through the simulated
 * web path so existing call sites keep working unchanged.
 */
export const NativeAI = {
  isNative(): boolean {
    return false
  },

  async getHardwareTelemetry(): Promise<HardwareTelemetry> {
    return createSafeFallbackTelemetry()
  },

  async ping(): Promise<PingResponse> {
    const clientTimestamp = Date.now()
    return {
      pong: true,
      clientTimestamp,
      serverTimestamp: clientTimestamp,
      roundtripLatencyMs: 0.1,
      platform: 'web-fallback',
      engine: 'Mock Bridge',
    }
  },

  async isModelCached(_modelId: string): Promise<boolean> {
    return false
  },

  async downloadModel(
    options: DownloadModelOptions,
    onProgress?: (event: DownloadProgressEvent) => void,
  ): Promise<{ modelId: string, status: string }> {
    // Browser mock download simulation
    let bytes = 0
    const totalBytes = 1.3 * 1024 * 1024 * 1024 // 1.3 GB
    const stepBytes = 150 * 1024 * 1024 // 150 MB steps
    const startTime = Date.now()

    return new Promise((resolve) => {
      const interval = setInterval(() => {
        bytes = Math.min(totalBytes, bytes + stepBytes)
        const percentage = Number(((bytes / totalBytes) * 100).toFixed(1))
        const elapsedSec = (elapsed => elapsed / 1000)(Date.now() - startTime)
        const speedMBs = Number(((bytes / (1024 * 1024)) / Math.max(0.1, elapsedSec)).toFixed(1))
        const isCompleted = bytes >= totalBytes

        onProgress?.({
          modelId: options.modelId,
          bytesWritten: bytes,
          totalBytes,
          percentage,
          speedMBs,
          isCompleted,
        })

        if (isCompleted) {
          clearInterval(interval)
          resolve({ modelId: options.modelId, status: 'downloaded' })
        }
      }, 300)
    })
  },

  async ensureModelReady(
    options: LoadModelOptions,
    _onProgress?: (event: DownloadProgressEvent) => void,
  ): Promise<LoadModelResult> {
    return await this.loadModel(options)
  },

  async loadModel(options: LoadModelOptions): Promise<LoadModelResult> {
    await new Promise(resolve => setTimeout(resolve, 600))
    return {
      modelId: options.modelId,
      isLoaded: true,
      loadTimeMs: 580,
      computeUnitsUsed: 'Simulated Web Neural Engine',
      residentMemoryBytes: 1.2 * 1024 * 1024 * 1024,
    }
  },

  async unloadModel(_options?: UnloadModelOptions): Promise<{ success: boolean }> {
    return { success: true }
  },

  async listCachedModels(): Promise<ListCachedModelsResult> {
    return {
      models: [],
      totalSizeBytes: 0,
    }
  },

  async deleteCachedModel(_options: DeleteCachedModelOptions): Promise<{ success: boolean }> {
    return { success: true }
  },

  async generateStream(
    options: GenerateStreamOptions,
    onToken: (event: TokenStreamEvent) => void,
  ): Promise<{ stop: () => Promise<void> }> {
    const requestId = options.requestId || `gen-${Date.now()}`

    return this.testTokenStream({
      requestId,
      prompt: options.prompt || options.messages?.[options.messages.length - 1]?.content || 'Hello!',
      tokenCount: options.maxTokens || 40,
      speedTokSec: 45,
    }, onToken)
  },

  async testTokenStream(options: TestStreamOptions, onToken: (event: TokenStreamEvent) => void): Promise<{ stop: () => Promise<void> }> {
    const requestId = options.requestId || `test-${Date.now()}`

    // In-browser mock stream simulation
    let isCancelled = false
    const inputPrompt = options.prompt?.trim() || 'Hello AIRI!'
    const totalTokens = options.tokenCount || 30
    const delayMs = Math.max(10, Math.floor(1000 / (options.speedTokSec || 30)))
    const startTime = Date.now()

    const mockWords = [
      `[Prompt: ${inputPrompt.slice(0, 15)}...]`,
      ' Greetings',
      ' from',
      ' the',
      ' Apple',
      ' Silicon',
      ' Neural',
      ' Bridge!',
      ' This',
      ' is',
      ' a',
      ' simulated',
      ' Core',
      ' AI',
      ' token',
      ' stream',
      ' running',
      ' inside',
      ' Project',
      ' AIRI.',
      ' Real-time',
      ' events',
      ' stream',
      ' over',
      ' the',
      ' eventa',
      ' bus',
      ' with',
      ' sub-millisecond',
      ' latency.',
    ]

    ;(async () => {
      for (let i = 0; i < totalTokens; i++) {
        if (isCancelled) {
          onToken({ requestId, token: '', isFinished: true, finishReason: 'cancelled' })
          return
        }

        await new Promise(resolve => setTimeout(resolve, delayMs))
        const word = mockWords[i % mockWords.length]
        const elapsedMs = Date.now() - startTime
        const tokensPerSecond = Number(((i + 1) / (elapsedMs / 1000)).toFixed(1))

        onToken({
          requestId,
          token: word,
          isFinished: false,
          completionTokens: i + 1,
          elapsedMs,
          tokensPerSecond,
        })
      }

      const elapsedMs = Date.now() - startTime
      onToken({
        requestId,
        token: '',
        isFinished: true,
        finishReason: 'stop',
        completionTokens: totalTokens,
        elapsedMs,
        tokensPerSecond: Number((totalTokens / (elapsedMs / 1000)).toFixed(1)),
      })
    })()

    return {
      stop: async () => {
        isCancelled = true
      },
    }
  },
}
