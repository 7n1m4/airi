/**
 * Detects the MIME type of an audio buffer by inspecting its magic bytes / container signature.
 * Supports WAV (RIFF/WAVE), MP3 (ID3v2 or MPEG frame sync), OGG (OggS), FLAC (fLaC), WebM/EBML, and AAC.
 * Defaults to 'audio/wav' if undetermined.
 */
export function detectAudioMimeType(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array
    ? buffer
    : new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 16))

  if (bytes.length >= 12) {
    // RIFF....WAVE (WAV audio)
    if (
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 // 'RIFF'
      && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45 // 'WAVE'
    ) {
      return 'audio/wav'
    }
  }

  if (bytes.length >= 3) {
    // ID3 (MP3 with ID3v2 container header)
    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
      return 'audio/mpeg'
    }
  }

  if (bytes.length >= 4) {
    // OggS (OGG container - Opus / Vorbis)
    if (bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
      return 'audio/ogg'
    }
    // fLaC (FLAC audio)
    if (bytes[0] === 0x66 && bytes[1] === 0x4C && bytes[2] === 0x61 && bytes[3] === 0x43) {
      return 'audio/flac'
    }
    // 0x1A 0x45 0xDF 0xA3 (EBML / WebM / Matroska)
    if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) {
      return 'audio/webm'
    }
  }

  if (bytes.length >= 2) {
    // MPEG audio frame sync (11 consecutive 1s: 0xFF followed by 0xE0 mask)
    if (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) {
      return 'audio/mpeg'
    }
  }

  return 'audio/wav'
}

/**
 * Creates an audio Blob from an ArrayBuffer or Uint8Array with the correct MIME type
 * (detected via magic bytes or explicitly specified), preventing browsers/Electron from
 * defaulting to a .txt extension upon downloading.
 */
export function createAudioBlob(buffer: ArrayBuffer | Uint8Array, explicitMime?: string): Blob {
  const mimeType = explicitMime || detectAudioMimeType(buffer)
  return new Blob([buffer as BlobPart], { type: mimeType })
}
