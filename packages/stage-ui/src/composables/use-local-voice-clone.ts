import type { MaybeRef } from 'vue'

import localforage from 'localforage'

import { computed, ref, toValue } from 'vue'

import { useProvidersStore } from '../stores/providers'

export interface LocalVoiceCloneItem {
  id: string
  name: string
  createdAt: number
  provider: string
  sourceFilename?: string
}

export interface CloneVoiceOptions {
  name?: string
  referenceText?: string
}

export function normalizeCloneProviderId(providerId: string): string {
  if (providerId === 'pocket' || providerId === 'pocket-tts-local')
    return 'pocket-tts-local'
  if (providerId === 'moss' || providerId === 'moss-nano-local')
    return 'moss-nano-local'
  if (providerId === 'chatterbox' || providerId === 'airi-audio-server')
    return 'airi-audio-server'
  return providerId
}

/**
 * Stores mapping for local voice cloning engines.
 *
 * Pocket-TTS uses `pocket-voice-profiles-metadata` and `pocket-voice-profiles-blobs`.
 * MOSS-TTS uses `moss-voice-profiles-metadata` and `voice-profile-blobs`.
 */
function getCloneStores(providerId: string) {
  const norm = normalizeCloneProviderId(providerId)
  if (norm === 'pocket-tts-local') {
    return {
      metaStore: localforage.createInstance({ name: 'pocket-voice-profiles-metadata' }),
      blobStore: localforage.createInstance({ name: 'pocket-voice-profiles-blobs' }),
      provider: norm,
    }
  }
  if (norm === 'moss-nano-local') {
    return {
      metaStore: localforage.createInstance({ name: 'moss-voice-profiles-metadata' }),
      blobStore: localforage.createInstance({ name: 'voice-profile-blobs' }),
      provider: norm,
    }
  }
  throw new Error(`Provider "${providerId}" does not support local zero-shot voice cloning.`)
}

/**
 * Unified composable for local zero-shot voice cloning across Pocket-TTS, MOSS-TTS, and AIRI Audio Server.
 */
export function useLocalVoiceClone(providerIdSource: MaybeRef<string>) {
  const isCloning = ref(false)
  const cloneError = ref<string | null>(null)

  const activeProviderId = computed(() => normalizeCloneProviderId(toValue(providerIdSource)))

  const supportsVoiceCloning = computed(() => {
    return (
      activeProviderId.value === 'pocket-tts-local'
      || activeProviderId.value === 'moss-nano-local'
      || activeProviderId.value === 'airi-audio-server'
    )
  })

  function getAiriAudioServerConfig() {
    let baseUrl = 'http://127.0.0.1:8095/v1/'
    let apiKey: string | undefined
    try {
      const providersStore = useProvidersStore()
      const cfg = providersStore.getProviderConfig('airi-audio-server')
      if (cfg?.baseUrl && typeof cfg.baseUrl === 'string') {
        baseUrl = cfg.baseUrl.endsWith('/') ? cfg.baseUrl : `${cfg.baseUrl}/`
      }
      if (cfg?.apiKey && typeof cfg.apiKey === 'string') {
        apiKey = cfg.apiKey.trim()
      }
    }
    catch {
      // Gracefully fall back if called outside active Pinia context
    }
    return { baseUrl, apiKey }
  }

  /**
   * Clone a voice from an audio File or Blob and persist to localforage or airi-audio-server.
   */
  async function cloneVoiceFromFile(file: File | Blob, options?: CloneVoiceOptions): Promise<LocalVoiceCloneItem> {
    isCloning.value = true
    cloneError.value = null

    try {
      const provider = activeProviderId.value
      if (!supportsVoiceCloning.value) {
        throw new Error(`Provider "${provider}" does not support zero-shot voice cloning.`)
      }

      if (!file || file.size === 0) {
        throw new Error('Audio file is empty or missing.')
      }

      if (file.size > 30 * 1024 * 1024) {
        throw new Error('Audio file exceeds maximum size limit of 30MB.')
      }

      const timestamp = Date.now()
      const randomSuffix = Math.random().toString(36).substring(2, 8)

      let filename = 'audio_sample.wav'
      let name = options?.name?.trim()

      if ('name' in file && typeof file.name === 'string' && file.name) {
        filename = file.name
        if (!name) {
          name = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ')
        }
      }

      if (!name) {
        name = `Cloned Voice (${new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`
      }

      // If airi-audio-server: upload directly via POST /v1/voices
      if (provider === 'airi-audio-server') {
        const { baseUrl, apiKey } = getAiriAudioServerConfig()
        const formData = new FormData()
        formData.append('audio', file, filename)
        formData.append('name', name)
        if (options?.referenceText?.trim()) {
          formData.append('reference_text', options.referenceText.trim())
        }

        const headers: Record<string, string> = {}
        if (apiKey) {
          headers.Authorization = `Bearer ${apiKey}`
        }

        const response = await fetch(`${baseUrl}voices`, {
          method: 'POST',
          body: formData,
          headers,
        })

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}))
          throw new Error(errData?.error || `Upload to airi-audio-server failed with HTTP ${response.status}`)
        }

        const resData = await response.json()
        return {
          id: resData.voice_id || resData.id,
          name: resData.name || name,
          createdAt: timestamp,
          provider: 'airi-audio-server',
          sourceFilename: filename,
        }
      }

      // Otherwise Pocket-TTS or MOSS-TTS localforage storage
      const { metaStore, blobStore } = getCloneStores(provider)
      const id = `voice-profile-${timestamp}-${randomSuffix}`

      // 1. Save audio binary into localforage blob store
      await blobStore.setItem(id, file)

      // 2. Save voice metadata
      const metaItem: LocalVoiceCloneItem = {
        id,
        name,
        createdAt: timestamp,
        provider,
        sourceFilename: filename,
      }
      await metaStore.setItem(id, metaItem)

      return metaItem
    }
    catch (err: any) {
      const msg = err?.message || 'Failed to clone voice from audio sample.'
      cloneError.value = msg
      throw err
    }
    finally {
      isCloning.value = false
    }
  }

  /**
   * List custom cloned voices for the active provider.
   */
  async function listClonedVoices(): Promise<LocalVoiceCloneItem[]> {
    if (!supportsVoiceCloning.value)
      return []

    try {
      if (activeProviderId.value === 'airi-audio-server') {
        const { baseUrl, apiKey } = getAiriAudioServerConfig()
        const headers: Record<string, string> = {}
        if (apiKey) {
          headers.Authorization = `Bearer ${apiKey}`
        }
        const response = await fetch(`${baseUrl}voices`, { headers }).catch(() => null)
        if (!response || !response.ok)
          return []
        const data = await response.json()
        const voices = Array.isArray(data?.voices) ? data.voices : []
        return voices
          .filter((v: any) => v.type === 'cloned' || v.type === 'custom')
          .map((v: any) => ({
            id: v.voice_id || v.id,
            name: v.name,
            createdAt: 0,
            provider: 'airi-audio-server',
            sourceFilename: v.id,
          }))
      }

      const { metaStore, provider } = getCloneStores(activeProviderId.value)
      const items: LocalVoiceCloneItem[] = []

      await metaStore.iterate((val: any) => {
        if (val && val.id && val.name) {
          items.push({
            id: val.id,
            name: val.name,
            createdAt: val.createdAt || 0,
            provider,
            sourceFilename: val.sourceFilename,
          })
        }
      })

      return items.sort((a, b) => b.createdAt - a.createdAt)
    }
    catch (err) {
      console.warn('[useLocalVoiceClone] Failed to list cloned voices:', err)
      return []
    }
  }

  /**
   * Remove a custom voice clone and its associated audio blob.
   */
  async function removeClonedVoice(id: string): Promise<void> {
    if (!supportsVoiceCloning.value || !id)
      return

    try {
      if (activeProviderId.value === 'airi-audio-server') {
        const { baseUrl, apiKey } = getAiriAudioServerConfig()
        const headers: Record<string, string> = {}
        if (apiKey) {
          headers.Authorization = `Bearer ${apiKey}`
        }
        const response = await fetch(`${baseUrl}voices/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers,
        })
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}))
          throw new Error(errData?.error || `Failed to delete voice from server with HTTP ${response.status}`)
        }
        return
      }

      const { metaStore, blobStore } = getCloneStores(activeProviderId.value)
      await Promise.all([
        metaStore.removeItem(id),
        blobStore.removeItem(id),
      ])
    }
    catch (err) {
      console.warn('[useLocalVoiceClone] Failed to remove cloned voice:', err)
      throw err
    }
  }

  return {
    isCloning,
    cloneError,
    supportsVoiceCloning,
    activeProviderId,
    cloneVoiceFromFile,
    listClonedVoices,
    removeClonedVoice,
  }
}
