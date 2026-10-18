import { describe, expect, it } from 'vitest'

import { optionOrEnv } from './config'
import { normalizeLoggerConfig, setupApp } from './index'

describe('config', () => {
  it('normalizeLoggerConfig defaults', () => {
    const c = normalizeLoggerConfig()
    expect(c.appLogLevel).toBeDefined()
    expect(c.appLogFormat).toBeDefined()
  })

  it('setupApp returns app and closeAllPeers', () => {
    const { app, closeAllPeers } = setupApp({ auth: { token: 't' } })
    expect(app).toBeDefined()
    closeAllPeers()
  })

  it('optionOrEnv prefers option', () => {
    expect(optionOrEnv('x', 'KEY', 'd')).toBe('x')
  })
})
