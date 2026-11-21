import type { BrowserWindow } from 'electron'

import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'
import type { WidgetsWindowManager } from '../widgets'

import { defineInvokeHandler } from '@moeru/eventa'

import { electronOnboardingClose, electronOnboardingCompleted, electronOnboardingSkipped } from '../../../shared/eventa'
import { createWidgetsService } from '../../services/airi/widgets'
import { createPortedWindow } from '../shared/ported'

export interface OnboardingWindowManager {
  getWindow: () => Promise<BrowserWindow>
  getAndToggleWindow: () => Promise<BrowserWindow>
  openWindow: (route?: string) => Promise<void>
}

export function setupOnboardingWindowManager(params: {
  serverChannel: ServerChannel
  i18n: I18n
  widgetsManager: WidgetsWindowManager
}): OnboardingWindowManager {
  let current: Awaited<ReturnType<typeof createPortedWindow>> | undefined
  let currentRoute = '/onboarding-v3'

  async function ensureWindow() {
    if (current && !current.isDestroyed())
      return current
    current = await createPortedWindow({
      tag: 'onboarding',
      title: 'AIRI - Companion Wizard',
      width: 1200,
      height: 760,
      route: currentRoute,
      setupBase: { i18n: params.i18n, serverChannel: params.serverChannel },
    })

    const close = async () => {
      current?.close()
    }
    defineInvokeHandler(current.context, electronOnboardingClose, close)
    defineInvokeHandler(current.context, electronOnboardingCompleted, close)
    defineInvokeHandler(current.context, electronOnboardingSkipped, close)
    createWidgetsService({
      context: current.context,
      widgetsManager: params.widgetsManager,
      window: current.window,
    })
    return current
  }

  return {
    getWindow: async () => (await ensureWindow()).window,
    getAndToggleWindow: async () => {
      const ported = await ensureWindow()
      if (ported.facade.isVisible())
        ported.facade.hide()
      else
        ported.facade.show()
      ported.facade.focus()
      return ported.window
    },
    openWindow: async (route = '/onboarding-v3') => {
      currentRoute = route
      const ported = await ensureWindow()
      if (!ported.facade.getURL().includes(`#${route}`))
        await ported.loadRoute(route)
      ported.facade.show()
      ported.facade.focus()
    },
  }
}
