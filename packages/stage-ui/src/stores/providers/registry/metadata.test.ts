import { describe, expect, it } from 'vitest'

import { chatLocalMetadata } from './chat-local'
import { localEngineMetadata } from './local-engines'
import {
  chatLocalMetadata as reexportedChatLocal,
  createSpeechMetadata as reexportedCreateSpeech,
  localEngineMetadata as reexportedLocalEngine,
  transcriptionMetadata as reexportedTranscription,
} from './metadata'
import { createSpeechMetadata } from './speech'
import { transcriptionMetadata } from './transcription'

describe('registry/metadata re-exports', () => {
  it('re-exports chatLocalMetadata', () => {
    expect(reexportedChatLocal).toBe(chatLocalMetadata)
  })

  it('re-exports localEngineMetadata', () => {
    expect(reexportedLocalEngine).toBe(localEngineMetadata)
  })

  it('re-exports createSpeechMetadata', () => {
    expect(reexportedCreateSpeech).toBe(createSpeechMetadata)
  })

  it('re-exports transcriptionMetadata', () => {
    expect(reexportedTranscription).toBe(transcriptionMetadata)
  })
})
