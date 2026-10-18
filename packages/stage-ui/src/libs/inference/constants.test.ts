import { describe, expect, it } from 'vitest'

import * as C from './constants'

describe('inference constants', () => {
  it('exports all constants', () => {
    expect(C.MODEL_IDS).toBeDefined()
    expect(C.MODEL_NAMES).toBeDefined()
    expect(C.LOCAL_VISION_MODELS).toBeDefined()
    expect(C.DEFAULT_LOCAL_VISION_MODEL).toBeDefined()
    expect(C.WHISPER_MODELS).toBeDefined()
    expect(C.DEFAULT_WHISPER_MODEL).toBeDefined()
    expect(C.WEB_RWKV_MODELS).toBeDefined()
    expect(C.WEB_RWKV_STATE_CARTRIDGES).toBeDefined()
    expect(C.DEFAULT_WEB_RWKV_MODEL).toBeDefined()
    expect(C.WEB_LLM_MODELS).toBeDefined()
    expect(C.DEFAULT_WEB_LLM_MODEL).toBeDefined()
    expect(C.DEFAULT_WEB_LLM_FP32_MODEL).toBeDefined()
    expect(C.TIMEOUTS).toBeDefined()
    expect(C.MAX_RESTARTS).toBeDefined()
    expect(C.RESTART_DELAY_MS).toBeDefined()
    expect(C.DEVICE_LOSS_WASM_THRESHOLD).toBeDefined()
  })

  it('has consistent defaults', () => {
    expect(C.DEFAULT_WEB_RWKV_MODEL).toBe(C.WEB_RWKV_MODELS[0].id)
    expect(C.DEFAULT_WEB_LLM_MODEL).toBe(C.WEB_LLM_MODELS[0].id)
  })
})
