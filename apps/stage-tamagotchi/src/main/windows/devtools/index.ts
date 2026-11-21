import type { BrowserWindow } from 'electron'

import { createPortedWindow } from '../shared/ported'

export interface DevtoolsWindowManager {
  openWindow: (route?: string) => Promise<BrowserWindow>
  getWindow: () => Promise<BrowserWindow>
}

/** Devtools is just another hash route in the shared renderer entry. */
export function setupDevtoolsWindow(): DevtoolsWindowManager {
  const defaultRoute = '/devtools/markdown-stress'
  let currentRoute = defaultRoute
  let current: Awaited<ReturnType<typeof createPortedWindow>> | undefined

  async function ensureWindow() {
    if (current && !current.isDestroyed())
      return current
    current = await createPortedWindow({
      tag: 'devtools',
      title: 'AIRI — Devtools',
      width: 1020,
      height: 720,
      route: currentRoute,
    })
    return current
  }

  return {
    openWindow: async (route) => {
      if (route)
        currentRoute = route
      const ported = await ensureWindow()
      if (!ported.facade.getURL().includes(`#${currentRoute}`))
        await ported.loadRoute(currentRoute)
      ported.facade.show()
      ported.facade.focus()
      return ported.window
    },
    getWindow: async () => {
      const ported = await ensureWindow()
      ported.facade.show()
      return ported.window
    },
  }
}
