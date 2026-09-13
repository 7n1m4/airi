import EventEmitter from 'node:events'

import { createContext, defineInvoke } from '@moeru/eventa'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  electronGetWindowLifecycleState,
  electronWindowLifecycleChanged,
} from '../../../shared/eventa'
import { createWindowService } from './window'

const { powerMonitorMock } = vi.hoisted(() => {
  // eslint-disable-next-line ts/no-require-imports
  const EventEmitter = require('node:events')
  return {
    powerMonitorMock: new EventEmitter(),
  }
})

vi.mock('electron', () => ({
  powerMonitor: powerMonitorMock,
}))

vi.mock('@proj-airi/electron-vueuse/main', () => ({
  createRendererLoop: () => ({
    start: vi.fn(),
    stop: vi.fn(),
  }),
}))

vi.mock('../../libs/bootkit/lifecycle', () => ({
  onAppBeforeQuit: vi.fn(),
  onAppWindowAllClosed: vi.fn(),
}))

vi.mock('../../windows/shared/window', () => ({
  resizeWindowByDelta: vi.fn(),
}))

function createMockWindow() {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    close: vi.fn(),
    getBounds: vi.fn(() => ({ height: 600, width: 800, x: 0, y: 0 })),
    hide: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isFocused: vi.fn(() => true),
    isMinimized: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    setAlwaysOnTop: vi.fn(),
    setBackgroundMaterial: vi.fn(),
    setBounds: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    setTitle: vi.fn(),
    setVibrancy: vi.fn(),
    webContents: { id: 42 },
  })
}

describe('createWindowService - Lifecycle and powerMonitor', () => {
  let context: ReturnType<typeof createContext>
  let mockWindow: ReturnType<typeof createMockWindow>

  beforeEach(() => {
    vi.clearAllMocks()
    powerMonitorMock.removeAllListeners()
    context = createContext()
    mockWindow = createMockWindow()
  })

  it('emits show and hide lifecycle states', () => {
    createWindowService({ context: context as never, window: mockWindow as never })
    const emissions: any[] = []
    context.on(electronWindowLifecycleChanged, (event) => {
      emissions.push(event.body)
    })

    mockWindow.emit('show')
    expect(emissions).toHaveLength(1)
    expect(emissions[0]).toMatchObject({
      focused: true,
      minimized: false,
      reason: 'show',
      visible: true,
    })

    mockWindow.isVisible.mockReturnValue(false)
    mockWindow.emit('hide')
    expect(emissions).toHaveLength(2)
    expect(emissions[1]).toMatchObject({
      reason: 'hide',
      visible: false,
    })
  })

  it('emits minimize and restore lifecycle states', () => {
    createWindowService({ context: context as never, window: mockWindow as never })
    const emissions: any[] = []
    context.on(electronWindowLifecycleChanged, (event) => {
      emissions.push(event.body)
    })

    mockWindow.isMinimized.mockReturnValue(true)
    mockWindow.emit('minimize')
    expect(emissions[0]).toMatchObject({
      minimized: true,
      reason: 'minimize',
    })

    mockWindow.isMinimized.mockReturnValue(false)
    mockWindow.emit('restore')
    expect(emissions[1]).toMatchObject({
      minimized: false,
      reason: 'restore',
      visible: true,
    })
  })

  it('forces visible: false when powerMonitor emits suspend or lock-screen', () => {
    createWindowService({ context: context as never, window: mockWindow as never })
    const emissions: any[] = []
    context.on(electronWindowLifecycleChanged, (event) => {
      emissions.push(event.body)
    })

    // Window is physically visible, but system enters suspend
    mockWindow.isVisible.mockReturnValue(true)
    powerMonitorMock.emit('suspend')

    expect(emissions).toHaveLength(1)
    expect(emissions[0]).toMatchObject({
      reason: 'suspend',
      visible: false,
    })

    // Screen locks
    powerMonitorMock.emit('lock-screen')
    expect(emissions).toHaveLength(2)
    expect(emissions[1]).toMatchObject({
      reason: 'suspend',
      visible: false,
    })
  })

  it('restores visible: true when powerMonitor emits resume or unlock-screen', () => {
    createWindowService({ context: context as never, window: mockWindow as never })
    const emissions: any[] = []
    context.on(electronWindowLifecycleChanged, (event) => {
      emissions.push(event.body)
    })

    mockWindow.isVisible.mockReturnValue(true)
    powerMonitorMock.emit('unlock-screen')

    expect(emissions).toHaveLength(1)
    expect(emissions[0]).toMatchObject({
      reason: 'restore',
      visible: true,
    })

    powerMonitorMock.emit('resume')
    expect(emissions).toHaveLength(2)
    expect(emissions[1]).toMatchObject({
      reason: 'restore',
      visible: true,
    })
  })

  it('returns lifecycle snapshot via electronGetWindowLifecycleState invoke', async () => {
    createWindowService({ context: context as never, window: mockWindow as never })
    const getLifecycle = defineInvoke(context, electronGetWindowLifecycleState)

    const state = await getLifecycle(undefined, {
      raw: { ipcMainEvent: { sender: { id: 42 } } },
    } as never)

    expect(state).toMatchObject({
      focused: true,
      minimized: false,
      reason: 'snapshot',
      visible: true,
    })
  })

  it('unregisters powerMonitor listeners on window close', () => {
    createWindowService({ context: context as never, window: mockWindow as never })

    expect(powerMonitorMock.listenerCount('suspend')).toBe(1)
    expect(powerMonitorMock.listenerCount('lock-screen')).toBe(1)
    expect(powerMonitorMock.listenerCount('resume')).toBe(1)
    expect(powerMonitorMock.listenerCount('unlock-screen')).toBe(1)

    mockWindow.emit('close')

    expect(powerMonitorMock.listenerCount('suspend')).toBe(0)
    expect(powerMonitorMock.listenerCount('lock-screen')).toBe(0)
    expect(powerMonitorMock.listenerCount('resume')).toBe(0)
    expect(powerMonitorMock.listenerCount('unlock-screen')).toBe(0)
  })
})
