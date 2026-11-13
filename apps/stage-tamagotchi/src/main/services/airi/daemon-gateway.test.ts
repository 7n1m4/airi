import { describe, expect, it } from 'vitest'

import { parseBusctlStringReply, parseServerChannelPort } from './daemon-gateway'

function busctlReply(payload: unknown): string {
  return `${JSON.stringify({ type: 's', data: JSON.stringify(payload) })}\n`
}

describe('parseBusctlStringReply', () => {
  it('decodes the double-encoded happy path', () => {
    const inner = {
      hostname: '127.0.0.1',
      port: 6121,
      tlsEnabled: false,
      bound: true,
      lastError: null,
      adoptedFrom: null,
      caCertPath: null,
      authToken: '00000000-0000-0000-0000-000000000000',
    }
    expect(parseBusctlStringReply(busctlReply(inner))).toEqual(inner)
  })

  it('handles escaped quotes and apostrophes inside lastError', () => {
    const inner = {
      hostname: '0.0.0.0',
      port: 6121,
      tlsEnabled: false,
      bound: false,
      lastError: `can't bind: address in use ("6121" taken)`,
      authToken: 'tok',
    }
    expect(parseBusctlStringReply(busctlReply(inner))).toEqual(inner)
  })

  it('returns undefined for garbage output', () => {
    expect(parseBusctlStringReply('not json at all')).toBeUndefined()
  })

  it('returns undefined when .type is not "s"', () => {
    const stdout = JSON.stringify({ type: 'i', data: '42' })
    expect(parseBusctlStringReply(stdout)).toBeUndefined()
  })

  it('returns undefined for truncated output', () => {
    const full = busctlReply({ hostname: '127.0.0.1' })
    expect(parseBusctlStringReply(full.slice(0, full.length - 10))).toBeUndefined()
  })

  it('returns undefined for empty output', () => {
    expect(parseBusctlStringReply('')).toBeUndefined()
  })
})

describe('parseServerChannelPort', () => {
  it('falls back to 6121 for non-numeric input', () => {
    expect(parseServerChannelPort('abc')).toBe(6121)
  })

  it('accepts a valid port', () => {
    expect(parseServerChannelPort('8080')).toBe(8080)
  })

  it('rejects 0', () => {
    expect(parseServerChannelPort('0')).toBe(6121)
  })

  it('rejects ports above 65535', () => {
    expect(parseServerChannelPort('70000')).toBe(6121)
  })

  it('falls back to 6121 for undefined', () => {
    expect(parseServerChannelPort(undefined)).toBe(6121)
  })
})
