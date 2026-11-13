import type { ElectronServerChannelConfig } from '../../../shared/eventa'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { useAsyncState, useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

import { electronApplyServerChannelConfig, electronGetServerChannelConfig } from '../../../shared/eventa'

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object')
    return JSON.stringify(value ?? null)
  if (Array.isArray(value))
    return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map(k => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
  return `{${entries.join(',')}}`
}

export const useServerChannelSettingsStore = defineStore('tamagotchi-server-channel-settings', () => {
  const websocketTlsConfig = useLocalStorage<{ cert?: string, key?: string, passphrase?: string } | null | undefined>('settings/server-channel/websocket-tls-config', null)
  const hostname = useLocalStorage<string>('settings/server-channel/hostname', '127.0.0.1')
  const port = useLocalStorage<string>('settings/server-channel/port', '')
  const tlsEnabled = useLocalStorage<string>('settings/server-channel/tls-enabled', 'false')
  const authToken = useLocalStorage<string>('settings/server-channel/auth-token', '')

  const getServerChannelConfig = useElectronEventaInvoke(electronGetServerChannelConfig)
  const applyServerChannelConfig = useElectronEventaInvoke(electronApplyServerChannelConfig)

  // Last apply failure reported by the main process (daemon rejection, transport
  // failure, or in-app exception). Cleared on the next successful apply.
  const lastApplyError = ref<string | null>(null)

  const serverChannelConfig = useAsyncState(getServerChannelConfig, null as any)

  let applyTimer: ReturnType<typeof setTimeout> | undefined

  watch([websocketTlsConfig, hostname, authToken], ([newTls, newHost, newAuth]) => {
    if (applyTimer) {
      clearTimeout(applyTimer)
    }
    // Debounce so residual back-to-back fires collapse into one apply.
    applyTimer = setTimeout(async () => {
      const effectiveToken = newAuth || serverChannelConfig.state.value?.authToken
      if (!effectiveToken) {
        return
      }

      try {
        // The daemon rides its { ok, error } reply along on the config snapshot;
        // the in-app path adds ok:false/error on failure. Treat either as an error.
        const result = await applyServerChannelConfig({
          websocketTlsConfig: newTls ? {} : null,
          hostname: newHost,
          authToken: effectiveToken,
        }) as (ElectronServerChannelConfig & { ok?: boolean, error?: unknown }) | undefined
        if (result && (result.ok === false || result.error)) {
          lastApplyError.value = String(result.error ?? 'Server channel configuration was rejected')
        }
        else {
          lastApplyError.value = null
        }
      }
      catch (error) {
        lastApplyError.value = error instanceof Error ? error.message : String(error)
      }
    }, 300)
  })

  watch(serverChannelConfig.state, (newConfig) => {
    // NOTICE: port/tlsEnabled/bound/lastError are additive on the daemon Get response and may not exist yet; read defensively.
    const extended = newConfig as (ElectronServerChannelConfig & { port?: number | string, tlsEnabled?: boolean, bound?: string, lastError?: string | null }) | null | undefined
    if (extended?.websocketTlsConfig !== undefined
      && stableStringify(websocketTlsConfig.value ?? null) !== stableStringify(extended.websocketTlsConfig ?? null)) {
      websocketTlsConfig.value = extended.websocketTlsConfig
    }
    if (extended?.hostname !== undefined && hostname.value !== extended.hostname) {
      hostname.value = extended.hostname
    }
    if (extended?.authToken && authToken.value !== extended.authToken) {
      authToken.value = extended.authToken
    }
    if (extended?.port !== undefined) {
      const nextPort = String(extended.port)
      if (port.value !== nextPort) {
        port.value = nextPort
      }
    }
    const nextTlsEnabled = extended?.tlsEnabled !== undefined
      ? String(extended.tlsEnabled)
      // Daemon has not grown a tlsEnabled field yet: derive from the TLS config presence so the mirror stays truthful.
      : extended?.websocketTlsConfig !== undefined ? (extended.websocketTlsConfig ? 'true' : 'false') : undefined
    if (nextTlsEnabled !== undefined && tlsEnabled.value !== nextTlsEnabled) {
      tlsEnabled.value = nextTlsEnabled
    }
  })

  return {
    websocketTlsConfig,
    hostname,
    port,
    tlsEnabled,
    authToken,
    lastApplyError,
  }
})
