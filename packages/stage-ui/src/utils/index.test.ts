import { describe, expect, it } from 'vitest'

import * as utils from './index'

describe('utils/index barrel', () => {
  it('re-exports expected members', () => {
    expect(typeof utils.getEventSourceKey).toBe('function')
    expect(typeof utils.initMemorySentinel).toBe('function')
    expect(typeof utils.logMemoryProbe).toBe('function')
    expect(typeof utils.buildVRMA).toBe('function')
    expect(utils.VRMA_SYSTEM_PROMPT).toBeDefined()
    expect(utils.VRMAMotionSpecSchema).toBeDefined()
    expect(typeof utils.randomSaccadeInterval).toBe('function')
  })
})
