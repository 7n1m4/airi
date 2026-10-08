import type { ChatSlices } from '../types/chat'

import { describe, expect, it } from 'vitest'

import {
  appendActorAwareTextSlice,
  captureActorToken,
  createActorSliceState,
  hydrateLegacyActorSlices,
  hydrateStickerSlices,
} from './chat-actor-slices'

function createToolSlice(id = 'tool-1'): ChatSlices {
  return {
    type: 'tool-call',
    toolCall: {
      args: '{}',
      toolCallId: id,
      toolCallType: 'function',
      toolName: 'text_journal',
    },
  }
}

describe('actor-aware chat slices', () => {
  it('keeps zero-token text around a tool call completely actor-free', () => {
    const state = createActorSliceState()
    const tool = createToolSlice()
    const slices: ChatSlices[] = []

    appendActorAwareTextSlice(slices, 'Before the tool.', state)
    slices.push(tool)
    appendActorAwareTextSlice(slices, 'After the tool.', state)

    expect(slices).toEqual([
      { type: 'text', text: 'Before the tool.' },
      tool,
      { type: 'text', text: 'After the tool.' },
    ])
    expect(slices.filter(slice => slice.type === 'text').every(slice => !Object.hasOwn(slice, 'actorId') && !Object.hasOwn(slice, 'startsActor'))).toBe(true)
  })

  it('starts a new actor on each side of an interleaved tool call', () => {
    const state = createActorSliceState()
    const tool = createToolSlice()
    const slices: ChatSlices[] = []

    captureActorToken(state, '<|ACTOR:actor_one|>')
    appendActorAwareTextSlice(slices, 'Hi, how are you?', state)
    slices.push(tool)
    captureActorToken(state, '<|ACTOR:actor_two|>')
    appendActorAwareTextSlice(slices, 'I am great, thanks.', state)

    expect(slices).toEqual([
      { type: 'text', text: 'Hi, how are you?', actorId: 'actor_one', startsActor: true },
      tool,
      { type: 'text', text: 'I am great, thanks.', actorId: 'actor_two', startsActor: true },
    ])
  })

  it('carries the same actor across a tool call without duplicating the chip', () => {
    const state = createActorSliceState()
    const tool = createToolSlice()
    const slices: ChatSlices[] = []

    captureActorToken(state, '<|ACTOR:actor_one|>')
    appendActorAwareTextSlice(slices, 'First block.', state)
    slices.push(tool)
    appendActorAwareTextSlice(slices, 'Continuation.', state)

    expect(slices).toEqual([
      { type: 'text', text: 'First block.', actorId: 'actor_one', startsActor: true },
      tool,
      { type: 'text', text: 'Continuation.', actorId: 'actor_one', startsActor: false },
    ])
  })

  it('holds an actor token immediately before a tool until real text arrives', () => {
    const state = createActorSliceState()
    const tool = createToolSlice()
    const slices: ChatSlices[] = []

    captureActorToken(state, '<|ACTOR:actor_one|>')
    slices.push(tool)

    expect(slices).toEqual([tool])

    appendActorAwareTextSlice(slices, 'Text after the tool.', state)
    expect(slices).toEqual([
      tool,
      { type: 'text', text: 'Text after the tool.', actorId: 'actor_one', startsActor: true },
    ])
  })

  it('exposes actor metadata during streaming without waiting for rawContent', () => {
    const state = createActorSliceState()
    const slices: ChatSlices[] = []

    captureActorToken(state, '<|ACTOR:nords|>')
    appendActorAwareTextSlice(slices, 'Streaming ', state)
    appendActorAwareTextSlice(slices, 'now.', state)

    expect(slices).toEqual([
      { type: 'text', text: 'Streaming now.', actorId: 'nords', startsActor: true },
    ])
  })
})

describe('legacy actor slice hydration', () => {
  it('reconstructs actors across an existing tool-call boundary', () => {
    const tool = createToolSlice()
    const slices: ChatSlices[] = [
      { type: 'text', text: 'Hi, how are you?' },
      tool,
      { type: 'text', text: 'I am great, thanks.' },
    ]

    expect(hydrateLegacyActorSlices(
      slices,
      '<|ACTOR:actor_one|>Hi, how are you?<|ACT:emotion="happy"|><|ACTOR:actor_two|>I am great, thanks.',
    )).toEqual([
      { type: 'text', text: 'Hi, how are you?', actorId: 'actor_one', startsActor: true },
      tool,
      { type: 'text', text: 'I am great, thanks.', actorId: 'actor_two', startsActor: true },
    ])
  })

  it('splits a legacy single text slice at actor transitions', () => {
    const slices: ChatSlices[] = [
      { type: 'text', text: 'First.Second.' },
    ]

    expect(hydrateLegacyActorSlices(
      slices,
      '<|ACTOR:first|>First.<|ACTOR:second|>Second.',
    )).toEqual([
      { type: 'text', text: 'First.', actorId: 'first', startsActor: true },
      { type: 'text', text: 'Second.', actorId: 'second', startsActor: true },
    ])
  })

  it('keeps zero-token historical messages untouched', () => {
    const slices: ChatSlices[] = [
      { type: 'text', text: 'Before.' },
      createToolSlice(),
      { type: 'text', text: 'After.' },
    ]

    expect(hydrateLegacyActorSlices(slices, 'Before.After.')).toBe(slices)
  })

  it('fails closed when rawContent cannot be aligned to stored text', () => {
    const slices: ChatSlices[] = [
      { type: 'text', text: 'Stored display text.' },
    ]

    expect(hydrateLegacyActorSlices(slices, '<|ACTOR:first|>Different raw text.')).toBe(slices)
  })
})

describe('hydrateStickerSlices', () => {
  it('returns original slices when rawContent has no sticker tokens', () => {
    const slices: ChatSlices[] = [{ type: 'text', text: 'Hello world' }]
    expect(hydrateStickerSlices(slices, 'Hello world')).toBe(slices)
  })

  it('returns original slices when rawContent is undefined', () => {
    const slices: ChatSlices[] = [{ type: 'text', text: 'Hello' }]
    expect(hydrateStickerSlices(slices)).toBe(slices)
  })

  it('returns original slices when sticker already exists in slices', () => {
    const slices: ChatSlices[] = [
      { type: 'text', text: 'Look at this:' },
      { type: 'sticker', stickerId: 'airi-happy' },
    ]
    expect(hydrateStickerSlices(slices, 'Look at this:\n\n<|STICKER airi-happy|>')).toBe(slices)
  })

  it('hydrates sticker slice for empty slices array', () => {
    const slices: ChatSlices[] = []
    const raw = '<|STICKER airi-happy|>'
    expect(hydrateStickerSlices(slices, raw)).toEqual([
      { type: 'sticker', stickerId: 'airi-happy' },
    ])
  })

  it('inserts missing sticker slice between text slices based on rawContent position', () => {
    const slices: ChatSlices[] = [
      { type: 'text', text: 'Before sticker text.' },
      { type: 'text', text: 'After sticker text.' },
    ]
    const raw = 'Before sticker text.\n\n<|STICKER airi-happy|>\n\nAfter sticker text.'
    const result = hydrateStickerSlices(slices, raw)

    expect(result).toEqual([
      { type: 'text', text: 'Before sticker text.' },
      { type: 'sticker', stickerId: 'airi-happy' },
      { type: 'text', text: 'After sticker text.' },
    ])
  })
})
