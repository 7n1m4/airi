import type {
  ProviderConfigValidator,
  ProviderDefinition,
  ProviderRuntimeValidator,
  ProviderTranslationFn,
} from '../types'

import { describe, expect, it, vi } from 'vitest'

import {
  createConfigValidationSteps,
  createProviderValidationSteps,
  getProviderValidationIntervalMs,
  getValidatorsOfProvider,
  validateProvider,
  validateProviderManual,
} from './run'

const t: ProviderTranslationFn = (key: string) => key

function makeConfigValidator(id = 'c1', name = 'Config1'): ProviderConfigValidator<Record<string, unknown>> {
  return {
    id,
    name,
    validator: vi.fn(async () => ({ valid: true, reason: '' })),
  } as unknown as ProviderConfigValidator<Record<string, unknown>>
}

function makeProviderValidator(id = 'p1', name = 'Prov1', manualOnly = false): ProviderRuntimeValidator<Record<string, unknown>> {
  return {
    id,
    name,
    manualOnly,
    validator: vi.fn(async () => ({ valid: true, reason: '' })),
    schedule: undefined,
  } as unknown as ProviderRuntimeValidator<Record<string, unknown>>
}

function makeDefinition(overrides: Partial<ProviderDefinition> = {}): ProviderDefinition {
  return {
    id: 'def',
    name: 'Def',
    validators: {
      validateConfig: [() => makeConfigValidator()],
      validateProvider: [() => makeProviderValidator()],
    },
    createProvider: vi.fn(async () => ({}) as any),
    validationRequiredWhen: () => true,
    extraMethods: undefined,
    ...overrides,
  } as unknown as ProviderDefinition
}

describe('createConfigValidationSteps', () => {
  it('maps validators', () => {
    const v = [makeConfigValidator('a', 'A'), makeConfigValidator('b', 'B')]
    const steps = createConfigValidationSteps(v)
    expect(steps).toHaveLength(2)
    expect(steps[0]).toMatchObject({ id: 'a', label: 'A', status: 'idle', reason: '', kind: 'config' })
  })
})

describe('createProviderValidationSteps', () => {
  it('maps validators', () => {
    const v = [makeProviderValidator('a', 'A')]
    const steps = createProviderValidationSteps(v)
    expect(steps[0]).toMatchObject({ id: 'a', label: 'A', kind: 'provider' })
  })
})

describe('getProviderValidationIntervalMs', () => {
  it('returns undefined when no interval validators', () => {
    const def = makeDefinition()
    expect(getProviderValidationIntervalMs({ definition: def, contextOptions: { t } })).toBeUndefined()
  })
  it('returns min interval', () => {
    const v1 = makeProviderValidator()
    v1.schedule = { mode: 'interval', intervalMs: 5000 } as any
    const v2 = makeProviderValidator()
    v2.schedule = { mode: 'interval', intervalMs: 3000 } as any
    const def = makeDefinition({
      validators: {
        validateConfig: [],
        validateProvider: [() => v1, () => v2],
      },
    } as any)
    expect(getProviderValidationIntervalMs({ definition: def, contextOptions: { t }, defaultIntervalMs: 15000 })).toBe(3000)
  })
  it('uses default interval when missing', () => {
    const v = makeProviderValidator()
    v.schedule = { mode: 'interval' } as any
    const def = makeDefinition({
      validators: { validateConfig: [], validateProvider: [() => v] },
    } as any)
    expect(getProviderValidationIntervalMs({ definition: def, contextOptions: { t }, defaultIntervalMs: 1000 })).toBe(1000)
  })
})

describe('getValidatorsOfProvider', () => {
  it('builds plan', () => {
    const def = makeDefinition()
    const plan = getValidatorsOfProvider({
      definition: def,
      config: { x: 1 },
      schemaDefaults: { y: 2 },
      contextOptions: { t },
    })
    expect(plan.steps).toHaveLength(2)
    expect(plan.config).toEqual({ y: 2, x: 1 })
    expect(plan.shouldValidate).toBe(true)
  })
  it('filters manual provider validators', () => {
    const mv = makeProviderValidator('m', 'M', true)
    const pv = makeProviderValidator('p', 'P', false)
    const def = makeDefinition({
      validators: {
        validateConfig: [],
        validateProvider: [() => mv, () => pv],
      },
    } as any)
    const plan = getValidatorsOfProvider({ definition: def, config: {}, schemaDefaults: {}, contextOptions: { t } })
    expect(plan.providerValidators).toHaveLength(1)
    expect(plan.manualProviderValidators).toHaveLength(1)
  })
  it('validationRequiredWhen default false', () => {
    const def = makeDefinition({ validationRequiredWhen: undefined as any })
    const plan = getValidatorsOfProvider({ definition: def, config: {}, schemaDefaults: {}, contextOptions: { t } })
    expect(plan.shouldValidate).toBe(false)
  })
})

describe('validateProvider', () => {
  it('all valid', async () => {
    const def = makeDefinition()
    const plan = getValidatorsOfProvider({ definition: def, config: {}, schemaDefaults: {}, contextOptions: { t } })
    const steps = await validateProvider(plan, { t })
    expect(steps.every(s => s.status === 'valid')).toBe(true)
  })
  it('config invalid skips provider', async () => {
    const cv = makeConfigValidator()
    cv.validator = vi.fn(async () => ({ valid: false, reason: 'bad' })) as any
    const def = makeDefinition({ validators: { validateConfig: [() => cv], validateProvider: [() => makeProviderValidator()] } } as any)
    const plan = getValidatorsOfProvider({ definition: def, config: {}, schemaDefaults: {}, contextOptions: { t } })
    const steps = await validateProvider(plan, { t })
    expect(steps[1].status).toBe('invalid')
    expect(steps[1].reason).toBe('Fix configuration checks first.')
  })
  it('config throws', async () => {
    const cv = makeConfigValidator()
    cv.validator = vi.fn(async () => { throw new Error('boom') }) as any
    const def = makeDefinition({ validators: { validateConfig: [() => cv], validateProvider: [] } } as any)
    const plan = getValidatorsOfProvider({ definition: def, config: {}, schemaDefaults: {}, contextOptions: { t } })
    const cb = { onValidatorError: vi.fn(), onValidatorStart: vi.fn(), onValidatorSuccess: vi.fn() }
    const steps = await validateProvider(plan, { t }, cb)
    expect(steps[0].status).toBe('invalid')
    expect(steps[0].reason).toBe('boom')
    expect(cb.onValidatorError).toHaveBeenCalled()
  })
  it('createProvider throws', async () => {
    const def = makeDefinition()
    def.createProvider = vi.fn(async () => { throw new Error('nope') }) as any
    const plan = getValidatorsOfProvider({ definition: def, config: {}, schemaDefaults: {}, contextOptions: { t } })
    const steps = await validateProvider(plan, { t })
    expect(steps[1].status).toBe('invalid')
    expect(steps[1].reason).toBe('nope')
  })
  it('provider validator invalid and throws', async () => {
    const pv = makeProviderValidator()
    pv.validator = vi.fn(async () => ({ valid: false, reason: 'r' })) as any
    const pv2 = makeProviderValidator('p2', 'P2')
    pv2.validator = vi.fn(async () => { throw new Error('x') }) as any
    const def = makeDefinition({ validators: { validateConfig: [], validateProvider: [() => pv, () => pv2] } } as any)
    const plan = getValidatorsOfProvider({ definition: def, config: {}, schemaDefaults: {}, contextOptions: { t } })
    const cb = { onValidatorSuccess: vi.fn(), onValidatorError: vi.fn(), onValidatorStart: vi.fn() }
    const steps = await validateProvider(plan, { t }, cb)
    expect(steps[0].status).toBe('invalid')
    expect(steps[0].reason).toBe('r')
    expect(steps[1].status).toBe('invalid')
    expect(steps[1].reason).toBe('x')
  })
  it('callbacks invoked on success', async () => {
    const def = makeDefinition()
    const plan = getValidatorsOfProvider({ definition: def, config: {}, schemaDefaults: {}, contextOptions: { t } })
    const cb = { onValidatorStart: vi.fn(), onValidatorSuccess: vi.fn() }
    await validateProvider(plan, { t }, cb)
    expect(cb.onValidatorStart).toHaveBeenCalled()
    expect(cb.onValidatorSuccess).toHaveBeenCalled()
  })
})

describe('validateProviderManual', () => {
  it('returns [] when no manual validators', async () => {
    const def = makeDefinition()
    const plan = getValidatorsOfProvider({ definition: def, config: {}, schemaDefaults: {}, contextOptions: { t } })
    const res = await validateProviderManual(plan, { t })
    expect(res).toEqual([])
  })
  it('createProvider throws maps to steps', async () => {
    const mv = makeProviderValidator('m', 'M', true)
    const def = makeDefinition({ validators: { validateConfig: [], validateProvider: [() => mv] } } as any)
    // force manual by marking manualOnly
    mv.manualOnly = true as any
    def.createProvider = vi.fn(async () => { throw new Error('cp') }) as any
    const plan = getValidatorsOfProvider({ definition: def, config: {}, schemaDefaults: {}, contextOptions: { t } })
    const res = await validateProviderManual(plan, { t })
    expect(res[0].status).toBe('invalid')
    expect(res[0].reason).toBe('cp')
  })
  it('runs manual validators', async () => {
    const mv = makeProviderValidator('m', 'M', true)
    mv.manualOnly = true as any
    const def = makeDefinition({ validators: { validateConfig: [], validateProvider: [() => mv] } } as any)
    const plan = getValidatorsOfProvider({ definition: def, config: {}, schemaDefaults: {}, contextOptions: { t } })
    const cb = { onValidatorStart: vi.fn(), onValidatorSuccess: vi.fn(), onValidatorError: vi.fn() }
    const res = await validateProviderManual(plan, { t }, cb)
    expect(res[0].status).toBe('valid')
  })
  it('manual validator throws', async () => {
    const mv = makeProviderValidator('m', 'M', true)
    mv.manualOnly = true as any
    mv.validator = vi.fn(async () => { throw new Error('mv') }) as any
    const def = makeDefinition({ validators: { validateConfig: [], validateProvider: [() => mv] } } as any)
    const plan = getValidatorsOfProvider({ definition: def, config: {}, schemaDefaults: {}, contextOptions: { t } })
    const res = await validateProviderManual(plan, { t })
    expect(res[0].status).toBe('invalid')
    expect(res[0].reason).toBe('mv')
  })
  it('manual validator invalid', async () => {
    const mv = makeProviderValidator('m', 'M', true)
    mv.manualOnly = true as any
    mv.validator = vi.fn(async () => ({ valid: false, reason: 'badm' })) as any
    const def = makeDefinition({ validators: { validateConfig: [], validateProvider: [() => mv] } } as any)
    const plan = getValidatorsOfProvider({ definition: def, config: {}, schemaDefaults: {}, contextOptions: { t } })
    const res = await validateProviderManual(plan, { t })
    expect(res[0].status).toBe('invalid')
    expect(res[0].reason).toBe('badm')
  })
})
