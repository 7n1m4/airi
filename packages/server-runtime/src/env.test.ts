import process from 'node:process'

import { describe, expect, it } from 'vitest'

import { fromEnv } from './config/env'

describe('env', () => {
  it('fromEnv returns default', () => {
    expect(fromEnv('NONEXISTENT_KEY_123', 'd')).toBe('d')
  })
  it('fromEnv undefined when no default', () => {
    expect(fromEnv('NONEXISTENT_KEY_123')).toBeUndefined()
  })
  it('fromEnv validator', () => {
    process.env.TEST_ENV_VALID = 'yes'
    expect(fromEnv('TEST_ENV_VALID', undefined, { validator: (v): v is 'yes' => v === 'yes' })).toBe('yes')
    delete process.env.TEST_ENV_VALID
  })
})
