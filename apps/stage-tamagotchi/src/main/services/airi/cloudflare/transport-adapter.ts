import type {
  TransportAdapter,
  TransportCapabilities,
  TransportHandler,
  TransportStatus,
} from '@proj-airi/stage-shared/transport'

const DEFAULT_CAPABILITIES: TransportCapabilities = {
  isLocalOnly: false,
  supportsMultiParty: true,
  supportsMeshGossip: false,
  requiresExternalRelay: true,
}

export function createCloudflareRelayTransportAdapter(): TransportAdapter {
  let status: TransportStatus = 'disconnected'

  const adapter: TransportAdapter = {
    id: 'cloudflare-edge',
    get status() { return status },
    capabilities: DEFAULT_CAPABILITIES,
    start: async () => { status = 'connected' },
    stop: async () => { status = 'disconnected' },
    sendToPeer: async <T>(peerId: string, topic: string, payload: T) => {
      void peerId
      void topic
      void payload
      return false
    },
    broadcast: async <T>(topic: string, payload: T) => {
      void topic
      void payload
    },
    subscribe: async <T>(topic: string, handler: TransportHandler<T>) => {
      void topic
      void handler
      return () => {}
    },
    initialize: async () => { status = 'connected' },
    dispose: async () => { status = 'disconnected' },
    publish: async <T>(topic: string, payload: T) => {
      void topic
      void payload
    },
  }

  return adapter
}
