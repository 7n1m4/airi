import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { normalizeCloneProviderId, useLocalVoiceClone } from './use-local-voice-clone'

describe('useLocalVoiceClone', () => {
  describe('normalizeCloneProviderId', () => {
    it('normalizes pocket provider ids', () => {
      expect(normalizeCloneProviderId('pocket')).toBe('pocket-tts-local')
      expect(normalizeCloneProviderId('pocket-tts-local')).toBe('pocket-tts-local')
    })

    it('normalizes moss provider ids', () => {
      expect(normalizeCloneProviderId('moss')).toBe('moss-nano-local')
      expect(normalizeCloneProviderId('moss-nano-local')).toBe('moss-nano-local')
    })

    it('normalizes airi-audio-server and chatterbox provider ids', () => {
      expect(normalizeCloneProviderId('airi-audio-server')).toBe('airi-audio-server')
      expect(normalizeCloneProviderId('chatterbox')).toBe('airi-audio-server')
    })

    it('preserves other provider ids', () => {
      expect(normalizeCloneProviderId('kokoro-local')).toBe('kokoro-local')
      expect(normalizeCloneProviderId('elevenlabs')).toBe('elevenlabs')
    })
  })

  describe('supportsVoiceCloning', () => {
    it('reports true for pocket-tts, moss-nano, and airi-audio-server', () => {
      const provider = ref('pocket')
      const { supportsVoiceCloning } = useLocalVoiceClone(provider)
      expect(supportsVoiceCloning.value).toBe(true)

      provider.value = 'moss'
      expect(supportsVoiceCloning.value).toBe(true)

      provider.value = 'pocket-tts-local'
      expect(supportsVoiceCloning.value).toBe(true)

      provider.value = 'moss-nano-local'
      expect(supportsVoiceCloning.value).toBe(true)

      provider.value = 'airi-audio-server'
      expect(supportsVoiceCloning.value).toBe(true)

      provider.value = 'chatterbox'
      expect(supportsVoiceCloning.value).toBe(true)
    })

    it('reports false for non-cloning providers', () => {
      const provider = ref('kokoro-local')
      const { supportsVoiceCloning } = useLocalVoiceClone(provider)
      expect(supportsVoiceCloning.value).toBe(false)

      provider.value = 'elevenlabs'
      expect(supportsVoiceCloning.value).toBe(false)
    })
  })

  describe('cloning operations', () => {
    it('rejects cloning for unsupported providers', async () => {
      const provider = ref('kokoro-local')
      const { cloneVoiceFromFile } = useLocalVoiceClone(provider)
      const fakeBlob = new Blob(['mock audio'], { type: 'audio/wav' })

      await expect(cloneVoiceFromFile(fakeBlob)).rejects.toThrow(
        'Provider "kokoro-local" does not support zero-shot voice cloning',
      )
    })

    it('rejects empty or oversized files', async () => {
      const provider = ref('pocket')
      const { cloneVoiceFromFile } = useLocalVoiceClone(provider)
      const emptyBlob = new Blob([], { type: 'audio/wav' })

      await expect(cloneVoiceFromFile(emptyBlob)).rejects.toThrow('Audio file is empty or missing.')
    })
  })

  describe('airi-audio-server remote operations', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('uploads voice with reference text to airi-audio-server via POST /v1/voices', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ voice_id: 'voice_elysia', name: 'Elysia' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const provider = ref('airi-audio-server')
      const { cloneVoiceFromFile } = useLocalVoiceClone(provider)
      const fakeFile = new File(['audio binary data'], 'elysia_sample.wav', { type: 'audio/wav' })

      const result = await cloneVoiceFromFile(fakeFile, {
        name: 'Elysia',
        referenceText: 'Hello, this is Elysia speaking.',
      })

      expect(result.id).toBe('voice_elysia')
      expect(result.name).toBe('Elysia')
      expect(result.provider).toBe('airi-audio-server')
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:8095/v1/voices',
        expect.objectContaining({
          method: 'POST',
        }),
      )
    })

    it('deletes cloned voice from airi-audio-server via DELETE /v1/voices/:id', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, voice_id: 'voice_elysia' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const provider = ref('airi-audio-server')
      const { removeClonedVoice } = useLocalVoiceClone(provider)

      await removeClonedVoice('voice_elysia')

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:8095/v1/voices/voice_elysia',
        expect.objectContaining({
          method: 'DELETE',
        }),
      )
    })

    it('lists cloned voices from airi-audio-server and filters out system voices', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            voices: [
              { id: 'system_morgan', name: 'Morgan Freeman', type: 'system' },
              { id: 'custom_elysia', name: 'Elysia', type: 'cloned' },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )

      const provider = ref('airi-audio-server')
      const { listClonedVoices } = useLocalVoiceClone(provider)

      const clonedVoices = await listClonedVoices()
      expect(clonedVoices).toHaveLength(1)
      expect(clonedVoices[0].id).toBe('custom_elysia')
      expect(clonedVoices[0].name).toBe('Elysia')
    })
  })
})
