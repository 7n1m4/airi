import type { Mock } from 'vitest'

import type { ProviderMetadata } from '../types'
import type { ProviderValidationDeps } from './validation'

import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { createProviderValidation, redactSecrets } from './validation'

const PROVIDER_ID = 'aliyun-nls-transcription'

// Aliyun NLS credentials: the secret is not `apiKey`.
const aliyunConfig = {
  accessKeyId: 'AKIDEXAMPLE',
  accessKeySecret: 'super-secret',
  appKey: 'app-key-value',
  region: 'cn-shanghai',
}

interface ProviderValidationPayload {
  providerId: string
  valid: boolean
  reason: string
  config?: Record<string, unknown>
}

// `window.electron` is injected by the Electron preload script and is absent from the
// DOM lib typings; confine that cast to the one place the fixture needs it.
interface ElectronWindow {
  electron: { ipcRenderer: { send: (channel: string, payload: ProviderValidationPayload) => void } }
}

const metadata: ProviderMetadata = {
  id: PROVIDER_ID,
  category: 'transcription',
  tasks: [],
  nameKey: 'settings.pages.providers.provider.aliyun-nls-transcription.name',
  name: 'Aliyun NLS',
  descriptionKey: 'settings.pages.providers.provider.aliyun-nls-transcription.description',
  description: 'Aliyun NLS',
  requiresCredentials: true,
  deployment: 'cloud',
  defaultOptions: () => ({ ...aliyunConfig }),
  // never invoked by the validation runtime
  createProvider: undefined as unknown as ProviderMetadata['createProvider'],
  capabilities: {},
  validators: {
    validateProviderConfig: () => Promise.resolve({ errors: [], reason: '', valid: true }),
  },
}

describe('redactSecrets', () => {
  it('masks every secret-ish key and leaves the rest untouched', () => {
    const redacted = redactSecrets({
      apiKey: 'sk-1',
      accessKeySecret: 's',
      secretAccessKey: 's',
      appKey: 'k',
      password: 'p',
      accessToken: 't',
      authorization: 'Bearer x',
      region: 'cn-shanghai',
      baseUrl: 'https://example.com',
      model: 'm',
      emptySecret: '',
    })

    expect(redacted).toEqual({
      apiKey: '***',
      accessKeySecret: '***',
      secretAccessKey: '***',
      appKey: '***',
      password: '***',
      accessToken: '***',
      authorization: '***',
      region: 'cn-shanghai',
      baseUrl: 'https://example.com',
      model: 'm',
      emptySecret: '',
    })
  })

  it('keeps empty secret keys present, since consumers check for presence', () => {
    const redacted = redactSecrets({ apiKey: '', baseUrl: 'https://example.com' })
    expect(redacted).toEqual({ apiKey: '', baseUrl: 'https://example.com' })
  })
})

describe('provider validation IPC payload', () => {
  async function sendPayloadFor(config: Record<string, unknown>) {
    const send: Mock<(channel: string, payload: ProviderValidationPayload) => void> = vi.fn()
    ;(window as unknown as ElectronWindow).electron = { ipcRenderer: { send } }

    const validation = createProviderValidation({
      providerCredentials: ref({ [PROVIDER_ID]: config }),
      providerRuntimeState: ref({}),
      providerValidationInFlight: new Map(),
      providerMetadata: { [PROVIDER_ID]: metadata },
      t: ((key: string) => key) as unknown as ProviderValidationDeps['t'],
      getDefaultProviderConfig: () => ({ ...aliyunConfig }),
      isProviderConfigured: () => true,
      markProviderAdded: () => {},
    })

    expect(await validation.validateProvider(PROVIDER_ID)).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
    delete (window as Partial<ElectronWindow>).electron

    const [channel, payload] = send.mock.calls[0]!
    return { channel, payload }
  }

  it('redacts non-apiKey secrets on the sending side', async () => {
    const { channel, payload } = await sendPayloadFor({ ...aliyunConfig })

    expect(channel).toBe('provider-validation-result')
    expect(payload.providerId).toBe(PROVIDER_ID)
    expect(payload.config).toEqual({
      accessKeyId: '***',
      accessKeySecret: '***',
      appKey: '***',
      region: 'cn-shanghai',
    })
  })
})
