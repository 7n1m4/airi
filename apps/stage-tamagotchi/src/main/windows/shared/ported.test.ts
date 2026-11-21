import type { BrowserView, BrowserWindow } from 'electrobun/main'

import type { RpcBootstrap } from '../../rpc'

import { describe, expect, it, vi } from 'vitest'

import { PortedBrowserWindow } from './ported'

function makeFakeNative() {
  const handlers = new Map<string, (payload?: unknown) => void>()
  const frame = { x: 10, y: 20, width: 640, height: 480 }
  return {
    id: 7,
    frame,
    on: vi.fn((name: string, handler: (payload?: unknown) => void) => {
      handlers.set(name, handler)
    }),
    show: vi.fn(),
    showInactive: vi.fn(),
    hide: vi.fn(),
    activate: vi.fn(),
    close: vi.fn(),
    unminimize: vi.fn(),
    minimize: vi.fn(),
    isVisible: vi.fn(() => true),
    isMinimized: vi.fn(() => false),
    setTitle: vi.fn(),
    setFrame: vi.fn(),
    setSize: vi.fn(),
    setPosition: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    getFrame: vi.fn(() => ({ ...frame })),
    webview: { id: 42, loadURL: vi.fn() },
    emit(name: string, payload?: unknown) {
      handlers.get(name)?.(payload)
    },
  }
}

describe('portedBrowserWindow', () => {
  it('maps the native frame to Electron bounds and rounds on write', () => {
    const native = makeFakeNative()
    const facade = new PortedBrowserWindow(native as unknown as BrowserWindow, native.webview as unknown as BrowserView, {} as RpcBootstrap)

    expect(facade.getBounds()).toEqual({ x: 10, y: 20, width: 640, height: 480 })
    facade.setBounds({ x: 1.4, y: 2.6, width: 300.5, height: 200.4 })
    expect(native.setFrame).toHaveBeenCalledWith(1, 3, 301, 200)
  })

  it('emits ready-to-show once and forwards native close to closed/webContents', () => {
    const native = makeFakeNative()
    const facade = new PortedBrowserWindow(native as unknown as BrowserWindow, native.webview as unknown as BrowserView, {} as RpcBootstrap)
    const ready = vi.fn()
    const closed = vi.fn()
    const destroyed = vi.fn()
    facade.on('ready-to-show', ready)
    facade.on('closed', closed)
    facade.webContents.on('destroyed', destroyed)

    facade.show()
    facade.show()
    expect(ready).toHaveBeenCalledTimes(1)
    expect(native.show).toHaveBeenCalledTimes(2)

    native.emit('close')
    expect(closed).toHaveBeenCalledTimes(1)
    expect(destroyed).toHaveBeenCalledTimes(1)
  })

  it('routes eventa webContents.send through the view RPC and drops raw channels', () => {
    const native = makeFakeNative()
    const sendTo = vi.fn()
    const facade = new PortedBrowserWindow(native as unknown as BrowserWindow, native.webview as unknown as BrowserView, { sendTo } as unknown as RpcBootstrap)

    expect(facade.webContents.id).toBe(42)
    facade.webContents.send('eventa-message', { id: 'x', type: 'chat:state', payload: { id: 'chat:state', type: 'event', body: true } })
    expect(sendTo).toHaveBeenCalledWith(native.webview, { id: 'chat:state' }, true)

    sendTo.mockClear()
    facade.webContents.send('raw-channel', 'payload')
    expect(sendTo).not.toHaveBeenCalled()
  })
})
