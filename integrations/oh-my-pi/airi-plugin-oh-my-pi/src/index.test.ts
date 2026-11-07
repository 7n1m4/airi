import { describe, expect, it, vi } from 'vitest'

import airiBridge from './index'

describe('airiBridge', () => {
  it('gating + correlation + shutdown', () => {
    const handlers: Record<string, (e: any, c?: any) => void> = {}
    const pi: any = {
      setLabel: vi.fn(),
      logger: { error: vi.fn() },
      on: (name: string, h: any) => { handlers[name] = h },
      sendMessage: vi.fn(),
    }
    const client: any = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      send: vi.fn(),
      onEvent: vi.fn(),
    }
    airiBridge(pi, { client })
    const cb = client.onEvent.mock.calls.find((c: any) => c[0] === 'output:gen-ai:chat:message')[1]

    handlers.before_agent_start({ reason: 'revive', prompt: 'hi' }, { cwd: '/w', model: { id: 'm' } })
    expect(client.send).not.toHaveBeenCalled()

    handlers.before_agent_start({ reason: 'prompt', prompt: '   ' }, { cwd: '/w' })
    expect(client.send).not.toHaveBeenCalled()

    handlers.before_agent_start({ reason: 'prompt', prompt: 'hello' }, { cwd: '/w', model: { id: 'm' } })
    expect(client.send).toHaveBeenCalledWith({ type: 'input:text', data: expect.objectContaining({ textRaw: 'hello', overrides: expect.objectContaining({ messagePrefix: expect.stringContaining('m') }) }) })

    const beforeWillContinue = client.send.mock.calls.length
    handlers.agent_end({ willContinue: true, messages: [{ role: 'assistant', content: 'done' }] }, { cwd: '/w' })
    expect(client.send.mock.calls.length).toBe(beforeWillContinue)

    handlers.agent_end({ messages: [{ role: 'assistant', content: 'done' }] }, { cwd: '/w' })
    expect(client.send).toHaveBeenCalledWith({ type: 'spark:notify', data: expect.objectContaining({ kind: 'ping', urgency: 'later', destinations: ['proj-airi:stage-web', 'proj-airi:stage-tamagotchi'], headline: expect.stringContaining('oh-my-pi') }) })

    cb({ data: { textRaw: 'hello', message: { content: 'reply' } } })
    expect(pi.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ customType: 'airi-reply', attribution: 'agent' }), expect.objectContaining({ deliverAs: 'nextTurn' }))

    const beforeSend = pi.sendMessage.mock.calls.length
    cb({ data: { textRaw: 'other', message: { content: 'x' } } })
    expect(pi.sendMessage.mock.calls.length).toBe(beforeSend)

    handlers.before_agent_start({ reason: 'prompt', prompt: 'hello2' }, { cwd: '/w' })
    cb({ data: { textRaw: 'hello2', message: { content: '' } } })
    expect(pi.sendMessage.mock.calls.length).toBe(beforeSend)

    handlers.session_shutdown(undefined, undefined)
    expect(client.close).toHaveBeenCalled()
  })
})
