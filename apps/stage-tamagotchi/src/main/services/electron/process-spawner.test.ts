import type { EventContext } from '@moeru/eventa'
import type { ElectronExecuteShellCommandResult } from '@proj-airi/stage-shared'

import { createContext, defineEventa } from '@moeru/eventa'
import { electronExecuteShellCommand } from '@proj-airi/stage-shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createProcessSpawnerService } from './process-spawner'

// The logger is a pure sink here; the assertions only care what the handler did.
vi.mock('@guiiai/logg', () => ({
  useLogg: () => ({
    useGlobalConfig: () => ({
      withFields: () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() }),
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }),
}))

// Mirrors eventa's invoke wire shape: the send event body is `{ invokeId, content }`,
// and the reply arrives on `${receiveEvent.id}-${invokeId}` as `payload.body.content`.
interface InvokeEnvelope {
  invokeId?: string
  content?: unknown
}

interface InvokeHandler {
  onSend: (event: { body: { invokeId: string, content: unknown } }) => void
}

type InvokeHandlersContext = EventContext<unknown> & {
  invokeHandlers?: Map<string, Map<unknown, InvokeHandler>>
}

/** Drives the registered handler and resolves with the reply it emits. */
function invoke(payload: unknown): Promise<ElectronExecuteShellCommandResult> {
  const context = createContext() as InvokeHandlersContext
  createProcessSpawnerService({ context: context as never })

  const handler = context.invokeHandlers?.get(electronExecuteShellCommand.sendEvent.id)?.values().next().value
  if (!handler)
    throw new Error('process spawner handler was not registered')

  const { promise, resolve } = Promise.withResolvers<ElectronExecuteShellCommandResult>()
  const invokeId = 'test-invoke'
  // The reply lands on a per-invoke id suffixed onto the receive event tag.
  const receive = defineEventa<InvokeEnvelope>(`${electronExecuteShellCommand.receiveEvent.id}-${invokeId}`)
  context.on(receive, (event) => {
    if (event.body?.invokeId === invokeId)
      resolve(event.body.content as ElectronExecuteShellCommandResult)
  })

  handler.onSend({ body: { invokeId, content: payload } })
  return promise
}

describe('createProcessSpawnerService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refuses argv[0] outside the allowlist without spawning anything', async () => {
    const res = await invoke({ argv: ['/bin/sh', '-c', 'echo pwned'] })

    expect(res.success).toBe(false)
    expect(res.error).toBe('Executable not allowed: /bin/sh')
  })

  it('refuses an empty argv', async () => {
    const res = await invoke({ argv: [] })

    expect(res.success).toBe(false)
    expect(res.error).toBe('argv cannot be empty')
  })

  it('keeps PATH/HOME/LD_PRELOAD/NODE_OPTIONS from the payload env', async () => {
    const res = await invoke({
      argv: ['python3', '-c', 'import os; print(os.environ.get("AIRI_TEST_ENV"), os.environ.get("PATH"))'],
      env: {
        AIRI_TEST_ENV: 'kept',
        PATH: '/tmp/evil',
        HOME: '/tmp/evil',
        LD_PRELOAD: '/tmp/evil.so',
        NODE_OPTIONS: '--require /tmp/evil.js',
      },
    })

    expect(res.success).toBe(true)
    expect(res.stdout).toContain('kept')
    expect(res.stdout).not.toContain('/tmp/evil')
  })
})
