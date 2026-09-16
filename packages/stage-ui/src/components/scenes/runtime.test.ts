import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { shouldRunLive2dLipSyncLoop } from './runtime'

describe('shouldRunLive2dLipSyncLoop', () => {
  it('runs only for live2d while not paused', () => {
    expect(shouldRunLive2dLipSyncLoop({ stageModelRenderer: 'live2d', paused: false })).toBe(true)
    expect(shouldRunLive2dLipSyncLoop({ stageModelRenderer: 'live2d', paused: true })).toBe(false)
    expect(shouldRunLive2dLipSyncLoop({ stageModelRenderer: 'vrm', paused: false })).toBe(false)
  })

  it('keeps stage mount independent from the experimental DuckDB runtime', () => {
    const source = readFileSync(new URL('./ControlStripHost.vue', import.meta.url), 'utf8')

    expect(source).not.toContain('@proj-airi/drizzle-duckdb-wasm')
    expect(source).not.toContain('getImportUrlBundles')
    expect(source).not.toContain('memory_test')
    expect(source).toMatch(/if\s*\(isElectron\.value\)\s*state\.value\s*=\s*['"]mounted['"]/)
  })
})
