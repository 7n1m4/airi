import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useConfiguratorByModsChannelServer } from './configurator'

const sendMock = vi.hoisted(() => vi.fn())

vi.mock('./mods/api/channel-server', () => ({
  useModsServerChannelStore: () => ({ send: sendMock }),
}))

describe('useConfiguratorByModsChannelServer', () => {
  beforeEach(() => {
    sendMock.mockClear()
    setActivePinia(createPinia())
  })

  it('sends ui:configure event with moduleName and config', () => {
    const store = useConfiguratorByModsChannelServer()
    const config = { foo: 'bar', n: 42 }
    store.updateFor('my-module', config)

    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock).toHaveBeenCalledWith({
      type: 'ui:configure',
      data: {
        moduleName: 'my-module',
        config,
      },
    })
  })

  it('forwards arbitrary config objects unchanged', () => {
    const store = useConfiguratorByModsChannelServer()
    const config = { nested: { a: [1, 2, 3] } }
    store.updateFor('mod-x', config)
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ui:configure',
      data: { moduleName: 'mod-x', config },
    }))
  })
})
