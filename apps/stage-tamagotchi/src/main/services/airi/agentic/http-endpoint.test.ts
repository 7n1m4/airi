import { describe, expect, it } from 'vitest'

import {
  AGENTIC_HTTP_ROUTES,
  authorizeAgenticHttpRequest,
  resolveAgenticHttpRoute,
  timingSafeEqual,
} from './http-endpoint'

const token = '0123456789abcdef0123456789abcdef'

function authorize(overrides: { authorization?: string, expectedToken?: string } = {}) {
  return authorizeAgenticHttpRequest({
    authorizationHeader: overrides.authorization,
    expectedToken: overrides.expectedToken ?? token,
  })
}

describe('agentic HTTP auth', () => {
  it('accepts a matching bearer token', () => {
    expect(authorize({ authorization: `Bearer ${token}` }).authorized).toBe(true)
  })

  it('rejects a request when the server has no token configured', () => {
    // An endpoint with no token is *disabled*, not open: loopback must never
    // stand in for authorization.
    expect(authorize({ authorization: `Bearer ${token}`, expectedToken: '' })).toEqual({
      authorized: false,
      status: 401,
      reason: 'endpoint-disabled',
    })
  })

  it('rejects a missing authorization header', () => {
    expect(authorize({ authorization: undefined }).authorized).toBe(false)
  })

  it('rejects a wrong token', () => {
    expect(authorize({ authorization: 'Bearer deadbeef' }).authorized).toBe(false)
  })

  it('rejects a non-Bearer scheme', () => {
    expect(authorize({ authorization: `Basic ${token}` }).authorized).toBe(false)
  })

  it('rejects a longer token that merely starts with the real one', () => {
    // A prefix match must not authenticate, and the length guard must not
    // short-circuit before the comparison.
    expect(authorize({ authorization: `Bearer ${token}ff` }).authorized).toBe(false)
  })

  it('rejects an over-long header instead of scanning it', () => {
    expect(authorize({ authorization: `Bearer ${'a'.repeat(5000)}` }).authorized).toBe(false)
  })

  it('tolerates surrounding whitespace in the header', () => {
    expect(authorize({ authorization: `Bearer  ${token}  ` }).authorized).toBe(true)
  })
})

describe('timingSafeEqual', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqual(token, token)).toBe(true)
  })

  it('returns false for a differing string of the same length', () => {
    const other = `${token.slice(0, -1)}0`
    expect(timingSafeEqual(other, token)).toBe(false)
  })

  it('returns false for different lengths rather than throwing', () => {
    expect(timingSafeEqual('abc', token)).toBe(false)
  })

  it('does not leak a shared prefix by length', () => {
    const sameLengthPrefix = `${token.slice(0, 8)}${'x'.repeat(token.length - 8)}`
    expect(timingSafeEqual(sameLengthPrefix, token)).toBe(false)
  })
})

describe('agentic HTTP routing', () => {
  it('resolves the cycle route', () => {
    expect(resolveAgenticHttpRoute('POST', AGENTIC_HTTP_ROUTES.cycle)).toBe(AGENTIC_HTTP_ROUTES.cycle)
  })

  it('resolves the status route', () => {
    expect(resolveAgenticHttpRoute('GET', AGENTIC_HTTP_ROUTES.status)).toBe(AGENTIC_HTTP_ROUTES.status)
  })

  it('refuses an unknown route', () => {
    expect(resolveAgenticHttpRoute('GET', '/memory')).toBeNull()
  })

  it('refuses the wrong method on a known route', () => {
    // `/status` is a read-only surface, so it is GET-only; a POST cannot reach
    // it and a GET cannot trigger a cycle.
    expect(resolveAgenticHttpRoute('POST', AGENTIC_HTTP_ROUTES.status)).toBeNull()
    expect(resolveAgenticHttpRoute('GET', AGENTIC_HTTP_ROUTES.cycle)).toBeNull()
  })

  it('strips a trailing slash so the two spellings of a route agree', () => {
    expect(resolveAgenticHttpRoute('GET', '/status/')).toBe(AGENTIC_HTTP_ROUTES.status)
  })
})
