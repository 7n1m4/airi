import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow } from 'electron'

import type { ElectronWindowLifecycleState } from '../../../shared/eventa'

import { defineInvokeHandler } from '@moeru/eventa'
import { bounds, startLoopGetBounds } from '@proj-airi/electron-eventa'
import { createRendererLoop } from '@proj-airi/electron-vueuse/main'
import { powerMonitor } from 'electron'

import {
  electron,
  electronGetWindowLifecycleState,
  electronWindowClose,
  electronWindowHide,
  electronWindowLifecycleChanged,
  electronWindowSetAlwaysOnTop,
} from '../../../shared/eventa'
import { onAppBeforeQuit, onAppWindowAllClosed } from '../../libs/bootkit/lifecycle'
import { resizeWindowByDelta } from '../../windows/shared/window'

export function createWindowService(params: { context: ReturnType<typeof createContext>['context'], window: BrowserWindow }) {
  function getWindowLifecycleState(reason: ElectronWindowLifecycleState['reason']): ElectronWindowLifecycleState {
    if (params.window.isDestroyed()) {
      return {
        focused: false,
        minimized: false,
        reason,
        updatedAt: Date.now(),
        visible: false,
      }
    }
    return {
      focused: params.window.isFocused(),
      minimized: params.window.isMinimized(),
      reason,
      updatedAt: Date.now(),
      visible: reason !== 'suspend' && params.window.isVisible(),
    }
  }

  function emitWindowLifecycle(reason: ElectronWindowLifecycleState['reason']) {
    if (params.window.isDestroyed())
      return
    params.context.emit(electronWindowLifecycleChanged, getWindowLifecycleState(reason))
  }

  const { start, stop } = createRendererLoop({
    window: params.window,
    run: () => {
      if (params.window.isDestroyed())
        return

      params.context.emit(bounds, params.window.getBounds())
    },
  })

  const onShow = () => emitWindowLifecycle('show')
  const onHide = () => emitWindowLifecycle('hide')
  const onMinimize = () => emitWindowLifecycle('minimize')
  const onRestore = () => emitWindowLifecycle('restore')
  const onFocus = () => emitWindowLifecycle('focus')
  const onBlur = () => emitWindowLifecycle('blur')

  params.window.on('show', onShow)
  params.window.on('hide', onHide)
  params.window.on('minimize', onMinimize)
  params.window.on('restore', onRestore)
  params.window.on('focus', onFocus)
  params.window.on('blur', onBlur)

  const onSuspend = () => emitWindowLifecycle('suspend')
  const onResume = () => emitWindowLifecycle('restore')
  const onLockScreen = () => emitWindowLifecycle('suspend')
  const onUnlockScreen = () => emitWindowLifecycle('restore')

  powerMonitor.on('suspend', onSuspend)
  powerMonitor.on('lock-screen', onLockScreen)
  powerMonitor.on('resume', onResume)
  powerMonitor.on('unlock-screen', onUnlockScreen)

  const cleanup = () => {
    stop()
    powerMonitor.off('suspend', onSuspend)
    powerMonitor.off('lock-screen', onLockScreen)
    powerMonitor.off('resume', onResume)
    powerMonitor.off('unlock-screen', onUnlockScreen)
  }

  onAppWindowAllClosed(cleanup)
  onAppBeforeQuit(cleanup)
  params.window.on('close', cleanup)
  params.window.on('closed', cleanup)

  defineInvokeHandler(params.context, startLoopGetBounds, () => start())

  defineInvokeHandler(params.context, electronGetWindowLifecycleState, (_, options) => {
    if (params.window.isDestroyed())
      return
    if (params.window.webContents.id === options?.raw.ipcMainEvent.sender.id) {
      return getWindowLifecycleState('snapshot')
    }
  })

  defineInvokeHandler(params.context, electron.window.getBounds, (_, options) => {
    if (params.window.isDestroyed())
      return

    if (params.window.webContents.id === options?.raw.ipcMainEvent.sender.id) {
      return params.window.getBounds()
    }

    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    }
  })

  defineInvokeHandler(params.context, electron.window.setBounds, (newBounds, options) => {
    if (params.window.isDestroyed())
      return

    if (newBounds && params.window.webContents.id === options?.raw.ipcMainEvent.sender.id) {
      params.window.setBounds(newBounds[0])
    }
  })

  defineInvokeHandler(params.context, electron.window.setIgnoreMouseEvents, (opts, options) => {
    if (params.window.isDestroyed())
      return

    if (opts && params.window.webContents.id === options?.raw.ipcMainEvent.sender.id) {
      params.window.setIgnoreMouseEvents(...opts)
    }
  })

  defineInvokeHandler(params.context, electronWindowSetAlwaysOnTop, (flag, options) => {
    if (params.window.isDestroyed())
      return

    if (params.window.webContents.id === options?.raw.ipcMainEvent.sender.id) {
      if (flag) {
        const level = (params.window as any).__is_main_window ? 2 : 1
        params.window.setAlwaysOnTop(true, 'screen-saver', level)
      }
      else {
        params.window.setAlwaysOnTop(false)
      }
    }
  })

  defineInvokeHandler(params.context, electron.window.setVibrancy, (vibrancy, options) => {
    if (params.window.isDestroyed())
      return

    if (vibrancy && params.window.webContents.id === options?.raw.ipcMainEvent.sender.id) {
      params.window.setVibrancy(vibrancy[0])
    }
  })

  defineInvokeHandler(params.context, electron.window.setBackgroundMaterial, (backgroundMaterial, options) => {
    if (params.window.isDestroyed())
      return

    if (backgroundMaterial && params.window.webContents.id === options?.raw.ipcMainEvent.sender.id) {
      params.window.setBackgroundMaterial(backgroundMaterial[0])
    }
  })

  defineInvokeHandler(params.context, electron.window.resize, (payload, options) => {
    if (params.window.isDestroyed())
      return

    if (!payload || params.window.webContents.id !== options?.raw.ipcMainEvent.sender.id) {
      return
    }

    resizeWindowByDelta({
      window: params.window,
      deltaX: payload.deltaX,
      deltaY: payload.deltaY,
      direction: payload.direction,
    })
  })

  defineInvokeHandler(params.context, electronWindowClose, (_, options) => {
    if (params.window.isDestroyed())
      return

    if (params.window.webContents.id === options?.raw.ipcMainEvent.sender.id) {
      params.window.close()
    }
  })

  defineInvokeHandler(params.context, electronWindowHide, (_, options) => {
    if (params.window.isDestroyed())
      return

    if (params.window.webContents.id === options?.raw.ipcMainEvent.sender.id) {
      params.window.hide()
    }
  })

  return cleanup
}
