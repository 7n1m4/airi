import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { DockModeConfig, DockModeStatus, DockPosition, TargetWindowBounds } from '@proj-airi/electron-eventa'
import type { BrowserWindow } from 'electron'

import { defineInvokeHandler } from '@moeru/eventa'
import { dockModeStatusChanged, dockModeTargetBounds, electron } from '@proj-airi/electron-eventa'

import { onAppBeforeQuit, onAppWindowAllClosed } from '../../libs/bootkit/lifecycle'
import { notImplemented } from '../../rpc'
import { createWindowBoundsPoller } from './window-bounds-provider'

function calculateDockedPosition(
  targetBounds: TargetWindowBounds,
  airiSize: { width: number, height: number },
  position: DockPosition,
  offset: { x: number, y: number },
): { x: number, y: number } {
  switch (position) {
    case 'right':
      return {
        x: targetBounds.x + targetBounds.width + offset.x,
        y: targetBounds.y + offset.y,
      }
    case 'left':
      return {
        x: targetBounds.x - airiSize.width + offset.x,
        y: targetBounds.y + offset.y,
      }
    case 'top':
      return {
        x: targetBounds.x + offset.x,
        y: targetBounds.y - airiSize.height + offset.y,
      }
    case 'bottom':
      return {
        x: targetBounds.x + offset.x,
        y: targetBounds.y + targetBounds.height + offset.y,
      }
  }
}

export function createDockModeService(params: {
  context: ReturnType<typeof createContext>['context']
  window: BrowserWindow
}) {
  let currentPoller: { stop: () => void } | null = null
  let currentStatus: DockModeStatus = { active: false }
  let currentConfig: DockModeConfig | null = null

  function stopDocking(): DockModeStatus {
    if (currentPoller) {
      currentPoller.stop()
      currentPoller = null
    }
    currentConfig = null
    currentStatus = { active: false }
    params.context.emit(dockModeStatusChanged, currentStatus)
    return currentStatus
  }

  onAppWindowAllClosed(() => {
    stopDocking()
  })
  onAppBeforeQuit(() => {
    stopDocking()
  })

  // NOTICE (design doc §1.2): `desktopCapturer.getSources` has no Electrobun
  // equivalent — there is no per-window source enumeration or thumbnail. Fail
  // loudly instead of returning an empty list that would look like "no windows".
  defineInvokeHandler(params.context, electron.dockMode.listWindows, async () => {
    notImplemented('desktopCapturer.getSources')
  })

  // Start dock mode
  defineInvokeHandler(params.context, electron.dockMode.start, (config: DockModeConfig | undefined) => {
    if (!config)
      return currentStatus

    // Stop any existing dock
    if (currentPoller) {
      currentPoller.stop()
      currentPoller = null
    }

    currentConfig = config

    const poller = createWindowBoundsPoller(config.targetWindowId, (targetBounds) => {
      if (params.window.isDestroyed()) {
        stopDocking()
        return
      }

      if (!targetBounds) {
        // Target window is gone, stop docking
        stopDocking()
        return
      }

      params.context.emit(dockModeTargetBounds, targetBounds)

      // Move our window to match
      const airiSize = params.window.getBounds()
      const newPos = calculateDockedPosition(
        targetBounds,
        { width: airiSize.width, height: airiSize.height },
        currentConfig!.position,
        currentConfig!.offset,
      )

      params.window.setPosition(newPos.x, newPos.y, false)
    })

    if (!poller) {
      currentStatus = { active: false }
      params.context.emit(dockModeStatusChanged, currentStatus)
      return currentStatus
    }

    currentPoller = poller
    currentStatus = {
      active: true,
      targetWindowId: config.targetWindowId,
      position: config.position,
    }
    params.context.emit(dockModeStatusChanged, currentStatus)
    return currentStatus
  })

  // Stop dock mode
  defineInvokeHandler(params.context, electron.dockMode.stop, () => {
    return stopDocking()
  })

  // Get current status
  defineInvokeHandler(params.context, electron.dockMode.getStatus, () => {
    return currentStatus
  })
}
