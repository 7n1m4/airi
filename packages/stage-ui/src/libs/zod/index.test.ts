import z from 'zod'

import { describe, expect, it } from 'vitest'

import { getSchemaDefault } from './index'

describe('getSchemaDefault', () => {
  it('returns empty object for null/undefined', () => {
    expect(getSchemaDefault(null)).toEqual({})
    expect(getSchemaDefault(undefined)).toEqual({})
  })

  it('returns defaults for ZodDefault fields', () => {
    const schema = z.object({
      a: z.string().default('x'),
      b: z.number(),
      c: z.boolean().default(true),
    })
    expect(getSchemaDefault(schema)).toEqual({ a: 'x', c: true })
  })

  it('returns empty object for schema with no defaults', () => {
    const schema = z.object({ a: z.string(), b: z.number() })
    expect(getSchemaDefault(schema)).toEqual({})
  })
})
