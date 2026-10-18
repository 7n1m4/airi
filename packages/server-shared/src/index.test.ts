import { describe, expect, it } from 'vitest'

import './index'

describe('@proj-airi/server-shared entrypoint', () => {
  it('loads the entrypoint module', () => {
    // Importing src/index.ts executes its console.warn side effect.
    expect(true).toBe(true)
  })
})
