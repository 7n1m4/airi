import { describe, expect, it } from 'vitest'

import { llmInferenceEndToken } from './index'

describe('constants/index', () => {
  it('exports the llm inference end token', () => {
    expect(llmInferenceEndToken).toBe('<|llm_inference_end|>')
  })
})
