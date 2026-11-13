import type { Server } from './server'

import { createServer as createNetServer } from 'node:net'

import { parse as superjsonParse } from 'superjson'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createServer } from './server'

const TOKEN = 'test-token'

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address()
      const port = typeof address === 'object' && address ? address.port : 0
      srv.close(() => resolve(port))
    })
  })
}

interface TestClient {
  ws: WebSocket
  messages: Array<Record<string, any>>
  close: () => void
}

async function connect(port: number): Promise<TestClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
  const messages: Array<Record<string, any>> = []
  ws.addEventListener('message', (event) => {
    const raw = String(event.data)
    try {
      messages.push(superjsonParse(raw) as Record<string, any>)
    }
    catch {
      try {
        messages.push(JSON.parse(raw))
      }
      catch {
        messages.push({ type: 'unparsable', raw })
      }
    }
  })
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true })
    ws.addEventListener('error', () => reject(new Error('ws connect failed')), { once: true })
  })

  return { ws, messages, close: () => ws.close() }
}

function authenticate(client: TestClient) {
  client.ws.send(JSON.stringify({
    type: 'module:authenticate',
    data: { token: TOKEN },
    metadata: { source: { kind: 'plugin', plugin: { id: 'test-client' }, id: 'test-client' }, event: { id: 'evt-auth' } },
  }))
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate())
      return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('timed out waiting for condition')
}

async function waitForAuthenticated(client: TestClient) {
  await waitFor(() => client.messages.some(m => m.type === 'module:authenticated'))
}

describe('gateway pre-auth hardening', () => {
  let server: Server | undefined
  let port: number

  beforeEach(async () => {
    port = await getFreePort()
    server = createServer({ port, hostname: '127.0.0.1', auth: { token: TOKEN } })
    await server.start()
  })

  afterEach(async () => {
    await server?.stop()
    server = undefined
  })

  it('rejects a data-less frame pre-auth and keeps serving', async () => {
    const client = await connect(port)

    client.ws.send(JSON.stringify({ type: 'transport:connection:heartbeat' }))
    await waitFor(() => client.messages.length > 0)

    expect(client.messages[0].type).toBe('error')
    expect(client.messages[0].data?.message).toBe('invalid event payload')

    // gateway survived: the same connection can authenticate afterwards
    authenticate(client)
    await waitForAuthenticated(client)

    client.close()
  })

  it('does not fan out broadcasts to unauthenticated peers', async () => {
    const alice = await connect(port)
    const carol = await connect(port)
    const bob = await connect(port)

    authenticate(alice)
    authenticate(carol)
    await waitForAuthenticated(alice)
    await waitForAuthenticated(carol)

    const event = {
      type: 'test:broadcast',
      data: { hello: 'world' },
      metadata: { source: { kind: 'plugin', plugin: { id: 'test-client' }, id: 'test-client' }, event: { id: 'evt-1' } },
    }
    alice.ws.send(JSON.stringify(event))

    await waitFor(() => carol.messages.some(m => m.type === 'test:broadcast'))
    // bob never authenticated — must not receive the broadcast
    expect(bob.messages.filter(m => m.type === 'test:broadcast')).toHaveLength(0)

    // after bob authenticates, he receives subsequent broadcasts
    authenticate(bob)
    await waitForAuthenticated(bob)
    bob.messages.length = 0

    alice.ws.send(JSON.stringify({ ...event, metadata: { ...event.metadata, event: { id: 'evt-2' } } }))
    await waitFor(() => bob.messages.some(m => m.type === 'test:broadcast'))

    alice.close()
    carol.close()
    bob.close()
  })
})
