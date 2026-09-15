import { describe, expect, it } from 'vitest'

import { createAudioBlob, detectAudioMimeType } from './audio'

describe('audio MIME type detection and blob creation', () => {
  it('detects WAV headers correctly', () => {
    const wavBytes = new Uint8Array([
      0x52,
      0x49,
      0x46,
      0x46, // RIFF
      0x24,
      0x00,
      0x00,
      0x00, // file size
      0x57,
      0x41,
      0x56,
      0x45, // WAVE
    ])
    expect(detectAudioMimeType(wavBytes)).toBe('audio/wav')
    const blob = createAudioBlob(wavBytes)
    expect(blob.type).toBe('audio/wav')
  })

  it('detects MP3 ID3 header correctly', () => {
    const id3Bytes = new Uint8Array([
      0x49,
      0x44,
      0x33, // ID3
      0x03,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ])
    expect(detectAudioMimeType(id3Bytes)).toBe('audio/mpeg')
    const blob = createAudioBlob(id3Bytes)
    expect(blob.type).toBe('audio/mpeg')
  })

  it('detects MP3 frame sync header correctly', () => {
    const mp3Bytes = new Uint8Array([
      0xFF,
      0xFB,
      0x90,
      0x64, // MPEG-1 Layer 3
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ])
    expect(detectAudioMimeType(mp3Bytes)).toBe('audio/mpeg')
    const blob = createAudioBlob(mp3Bytes)
    expect(blob.type).toBe('audio/mpeg')
  })

  it('detects OGG header correctly', () => {
    const oggBytes = new Uint8Array([
      0x4F,
      0x67,
      0x67,
      0x53, // OggS
      0x00,
      0x02,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ])
    expect(detectAudioMimeType(oggBytes)).toBe('audio/ogg')
  })

  it('detects FLAC header correctly', () => {
    const flacBytes = new Uint8Array([
      0x66,
      0x4C,
      0x61,
      0x43, // fLaC
      0x00,
      0x00,
      0x00,
      0x22,
    ])
    expect(detectAudioMimeType(flacBytes)).toBe('audio/flac')
  })

  it('defaults to audio/wav for unknown raw audio data', () => {
    const randomBytes = new Uint8Array([0x01, 0x02, 0x03, 0x04])
    expect(detectAudioMimeType(randomBytes)).toBe('audio/wav')
    const blob = createAudioBlob(randomBytes)
    expect(blob.type).toBe('audio/wav')
  })

  it('respects explicit MIME type override', () => {
    const randomBytes = new Uint8Array([0x01, 0x02, 0x03, 0x04])
    const blob = createAudioBlob(randomBytes, 'audio/mp3')
    expect(blob.type).toBe('audio/mp3')
  })
})
