import type { Rectangle } from 'electrobun/main'

import { BuildConfig, Screen } from 'electrobun/main'

const DEV_SERVER_PORT = 5173
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`

/**
 * Vite dev server wins in dev so HMR works; packaged builds read the copied `views://` asset.
 * The channel comes from the build config, so a packaged build never pays for the probe.
 */
export async function resolveViewUrl(html: string): Promise<string> {
  const channel = await BuildConfig.get().then(config => config.channel).catch(() => 'dev' as const)
  if (channel === 'dev') {
    try {
      const res = await fetch(DEV_SERVER_URL, { method: 'HEAD' })
      if (res.ok)
        return `${DEV_SERVER_URL}/${html}`
    }
    catch {
      console.warn(`[View] Vite dev server not running; falling back to views:// for ${html}`)
    }
  }
  return `views://main/${html}`
}

export function workArea(): Rectangle {
  try {
    return Screen.getPrimaryDisplay().workArea
  }
  catch (err) {
    console.warn('[View] Failed to read the primary display; assuming a 1920x1080 work area:', err)
    return { x: 0, y: 0, width: 1920, height: 1080 }
  }
}

export function centerOnWorkArea(width: number, height: number): { x: number, y: number } {
  const area = workArea()
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
  }
}

export const isDev = (): boolean => BuildConfig.getSync().channel === 'dev'
