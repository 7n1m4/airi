import type { TransportRegistry } from '@proj-airi/stage-shared'

import { createCloudflareRelayTransportAdapter } from './transport-adapter'

const ENABLE_CLOUD_ADAPTERS = typeof process !== 'undefined' && process.env?.AIRI_ENABLE_CLOUD_ADAPTERS === '1'

export function registerCloudAdapters(registry: TransportRegistry, sovereign: boolean = false): void {
  if (sovereign || !ENABLE_CLOUD_ADAPTERS)
    return
  try {
    registry.register(createCloudflareRelayTransportAdapter())
  }
  catch {
    // best-effort
  }
}
