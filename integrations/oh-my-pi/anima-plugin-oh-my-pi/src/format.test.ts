import { describe, expect, it } from 'vitest'

import { resolveConfig } from './config'
import { buildPromptEvent, buildTurnSummaryNotify, extractText } from './format'

describe('resolveConfig', () => {
  it('defaults', () => {
    expect(resolveConfig({})).toEqual({ url: 'ws://localhost:6121/ws' })
  })
  it('env overrides', () => {
    expect(resolveConfig({ AIRI_WS_URL: 'ws://x/custom', AIRI_TOKEN: 't' })).toEqual({ url: 'ws://x/custom', token: 't' })
  })
  it('empty token omitted', () => {
    expect(resolveConfig({ AIRI_TOKEN: '' })).toEqual({ url: 'ws://localhost:6121/ws' })
  })
})

describe('buildPromptEvent', () => {
  it('prefix + raw', () => {
    const e = buildPromptEvent('hi', '/a/b', 'm1')
    expect(e.textRaw).toBe('hi')
    expect(e.overrides.messagePrefix).toContain('b')
    expect(e.overrides.messagePrefix).toContain('m1')
  })
})

describe('buildTurnSummaryNotify', () => {
  it('null when no assistant', () => {
    expect(buildTurnSummaryNotify({ cwd: '/x', messages: [{ role: 'user', content: 'hi' }] })).toBeNull()
  })
  it('truncates 400', () => {
    const long = 'a'.repeat(500)
    const n = buildTurnSummaryNotify({ cwd: '/x', messages: [{ role: 'assistant', content: long }] })!
    expect(n.note!.length).toBe(401)
    expect(n.kind).toBe('ping')
    expect(n.urgency).toBe('later')
    expect(n.destinations).toEqual(['proj-airi:stage-web', 'proj-airi:stage-tamagotchi'])
  })
})

describe('extractText', () => {
  it('array', () => {
    expect(extractText([{ type: 'text', text: 'a' }, { type: 'img' }, { type: 'text', text: 'b' }])).toBe('a\n\nb')
  })
})
