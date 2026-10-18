import { describe, expect, it, vi } from 'vitest'

import { cleanJsonSchema, sanitizeTools } from './tool-schema'

describe('cleanJsonSchema', () => {
  it('strips $schema and additionalProperties from schema nodes', () => {
    const schema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          additionalProperties: false,
        },
      },
    }

    cleanJsonSchema(schema)

    expect(schema).not.toHaveProperty('$schema')
    expect(schema).not.toHaveProperty('additionalProperties')
    expect(schema.properties.query).not.toHaveProperty('additionalProperties')
  })

  it('collapses anyOf with nullable primitives into the concrete type (Grok/OpenAI/Azure compatibility)', () => {
    const schema: any = {
      type: 'object',
      properties: {
        optionalText: {
          description: 'A test description',
          anyOf: [
            { type: 'string' },
            { type: 'null' },
          ],
        },
      },
    }

    cleanJsonSchema(schema)

    expect(schema.properties.optionalText).not.toHaveProperty('anyOf')
    expect(schema.properties.optionalText.type).toBe('string')
    expect(schema.properties.optionalText.description).toBe('A test description')
  })

  it('collapses oneOf with nullable primitives into the concrete type', () => {
    const schema: any = {
      type: 'object',
      properties: {
        optionalCount: {
          oneOf: [
            { type: 'number' },
            { type: 'null' },
          ],
        },
      },
    }

    cleanJsonSchema(schema)

    expect(schema.properties.optionalCount).not.toHaveProperty('oneOf')
    expect(schema.properties.optionalCount.type).toBe('number')
  })

  it('normalizes type arrays with null into a single concrete type', () => {
    const schema = {
      type: 'object',
      properties: {
        mixed: {
          type: ['string', 'null'],
        },
      },
    }

    cleanJsonSchema(schema)

    expect(schema.properties.mixed.type).toBe('string')
  })

  it('converts bare null types to string', () => {
    const schema = {
      type: 'object',
      properties: {
        nullField: {
          type: 'null',
        },
      },
    }

    cleanJsonSchema(schema)

    expect(schema.properties.nullField.type).toBe('string')
  })

  it('ensures type: object has properties record for strict validators', () => {
    const schema = {
      type: 'object',
    } as any

    cleanJsonSchema(schema)

    expect(schema.properties).toEqual({})
  })

  it('removes nullable fields from required list so strict validators do not require null', () => {
    const schema = {
      type: 'object',
      required: ['mandatoryField', 'nullableField'],
      properties: {
        mandatoryField: {
          type: 'string',
        },
        nullableField: {
          anyOf: [
            { type: 'string' },
            { type: 'null' },
          ],
        },
      },
    }

    cleanJsonSchema(schema)

    expect(schema.required).toEqual(['mandatoryField'])
  })

  it('deletes required array entirely if all fields were nullable', () => {
    const schema = {
      type: 'object',
      required: ['nullableField'],
      properties: {
        nullableField: {
          type: ['string', 'null'],
        },
      },
    }

    cleanJsonSchema(schema)

    expect(schema).not.toHaveProperty('required')
  })
})
describe('cleanJsonSchema desc', () => {
  it('preserves description when collapsing anyOf', () => {
    const schema: Record<string, unknown> = {
      description: 'outer desc',
      anyOf: [{ type: 'string' }],
    }
    cleanJsonSchema(schema)
    expect(schema.description).toBe('outer desc')
    expect(schema.type).toBe('string')
  })
  it('preserves description when collapsing anyOf whose chosen has falsy description', () => {
    const schema: Record<string, unknown> = {
      description: 'outer desc',
      anyOf: [{ type: 'string', description: null }],
    }
    cleanJsonSchema(schema)
    expect(schema.description).toBe('outer desc')
    expect(schema.type).toBe('string')
  })
  it('preserves description when collapsing oneOf whose chosen has falsy description', () => {
    const schema: Record<string, unknown> = {
      description: 'outer desc',
      oneOf: [{ type: 'string', description: null }],
    }
    cleanJsonSchema(schema)
    expect(schema.description).toBe('outer desc')
    expect(schema.type).toBe('string')
  })
  it('preserves description when collapsing oneOf', () => {
    const schema: Record<string, unknown> = {
      description: 'outer desc',
      oneOf: [{ type: 'string' }],
    }
    cleanJsonSchema(schema)
    expect(schema.description).toBe('outer desc')
    expect(schema.type).toBe('string')
  })
})

describe('cleanJsonSchema edge cases', () => {
  it('returns early for non-object input', () => {
    expect(() => cleanJsonSchema(null)).not.toThrow()
    expect(() => cleanJsonSchema('x')).not.toThrow()
    expect(() => cleanJsonSchema(42)).not.toThrow()
  })

  it('recurses into array items', () => {
    const schema = {
      type: 'array',
      items: [
        { type: 'object', properties: { a: { type: ['string', 'null'] } } },
        { type: 'object' },
      ],
    }
    cleanJsonSchema(schema)
    expect(schema.items[0].properties.a.type).toBe('string')
    expect(schema.items[0].properties).toBeDefined()
    expect(schema.items[1].properties).toEqual({})
  })

  it('recurses into object items', () => {
    const schema = {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
    }
    cleanJsonSchema(schema)
    expect(schema.items).not.toHaveProperty('additionalProperties')
    expect(schema.items.properties).toEqual({})
  })
  it('handles anyOf with only null schemas (no collapse)', () => {
    const schema: Record<string, unknown> = { anyOf: [{ type: 'null' }] }
    cleanJsonSchema(schema)
    expect(schema.anyOf).toBeDefined()
  })
  it('handles oneOf with only null schemas (no collapse)', () => {
    const schema: Record<string, unknown> = { oneOf: [{ type: 'null' }] }
    cleanJsonSchema(schema)
    expect(schema.oneOf).toBeDefined()
  })
  it('skips non-object properties', () => {
    const schema: Record<string, unknown> = { type: 'object', properties: { a: null, b: 5 } }
    cleanJsonSchema(schema)
    expect(schema.properties).toEqual({ a: null, b: 5 })
  })
  it('handles items that are neither array nor object gracefully', () => {
    const schema: Record<string, unknown> = { items: 'x' }
    cleanJsonSchema(schema)
    expect(schema.items).toBe('x')
  })
  it('sanitizeTools handles tool without parameters', () => {
    const tools = [{ type: 'function', function: { name: 'f', description: 'd' }, execute: async () => 1 }] as unknown as Parameters<typeof sanitizeTools>[0]
    const out = sanitizeTools(tools)
    expect(out).toHaveLength(1)
    expect(typeof out![0].execute).toBe('function')
  })
})

// (placeholder removed)

describe('sanitizeTools', () => {
  it('returns undefined if tools is undefined', () => {
    expect(sanitizeTools(undefined)).toBeUndefined()
  })

  it('deep-clones tool definitions and preserves execute callbacks', () => {
    const executeMock = vi.fn()
    const originalTools: any[] = [
      {
        name: 'testTool',
        description: 'A tool for testing',
        execute: executeMock,
        function: {
          name: 'testTool',
          description: 'A tool for testing',
          parameters: {
            type: 'object',
            required: ['foo'],
            properties: {
              foo: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
              },
            },
          },
        },
      },
    ]

    const sanitized = sanitizeTools(originalTools)

    expect(sanitized).toBeDefined()
    expect(sanitized).toHaveLength(1)
    expect(sanitized![0].execute).toBe(executeMock)

    // Original tool object is unmutated
    expect((originalTools[0] as any).function.parameters.properties.foo).toHaveProperty('anyOf')

    // Sanitized tool has anyOf collapsed
    const sanitizedParams = (sanitized![0] as any).function.parameters
    expect(sanitizedParams.properties.foo).not.toHaveProperty('anyOf')
    expect(sanitizedParams.properties.foo.type).toBe('string')
    expect(sanitizedParams).not.toHaveProperty('required')
  })
})

describe('sanitizeTools extra', () => {
  it('normalizes parameters whose type is not object and missing properties', () => {
    const executeMock = vi.fn()
    const tools = [
      {
        execute: executeMock,
        function: {
          name: 't',
          parameters: { type: 'string' },
        },
      },
    ] as unknown as Parameters<typeof sanitizeTools>[0]
    const sanitized = sanitizeTools(tools)
    const sanitizedTool = sanitized![0] as { function: { parameters: { type: string, properties: Record<string, unknown> } } }
    const params = sanitizedTool.function.parameters
    expect(params.type).toBe('object')
    expect(params.properties).toEqual({})
    expect(sanitized![0].execute).toBe(executeMock)
  })
})
