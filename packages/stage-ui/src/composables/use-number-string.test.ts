import { describe, expect, it } from 'vitest'
import { ref } from 'vue'

import { useNumberString } from './use-number-string'

describe('useNumberString', () => {
  it('returns empty string when numberRef is null', () => {
    const numberRef = ref<number | null>(null)
    const result = useNumberString(numberRef)
    expect(result.value).toBe('')
  })

  it('returns number string when numberRef has value', () => {
    const numberRef = ref<number | null>(42)
    const result = useNumberString(numberRef)
    expect(result.value).toBe('42')
  })

  it('sets numberRef to null when value is empty string', () => {
    const numberRef = ref<number | null>(42)
    const result = useNumberString(numberRef)
    result.value = ''
    expect(numberRef.value).toBeNull()
  })

  it('sets numberRef when value parses to number', () => {
    const numberRef = ref<number | null>(null)
    const result = useNumberString(numberRef)
    result.value = '7'
    expect(numberRef.value).toBe(7)
  })

  it('does not change numberRef when value is non-numeric', () => {
    const numberRef = ref<number | null>(5)
    const result = useNumberString(numberRef)
    result.value = 'abc'
    expect(numberRef.value).toBe(5)
  })
})
