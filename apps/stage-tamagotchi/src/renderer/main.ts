/* eslint-disable perfectionist/sort-imports -- view-context must evaluate before App.vue's module graph; the sorter would move this side-effect import last. */
import type { Plugin } from 'vue'
import type { RouteRecordRaw } from 'vue-router'

// Must be the first side-effect import: installs the Electrobun view context and the
// electron-vueuse provider before the app graph (App.vue and its stores) evaluates.
// No `window.electron` shim — call sites use the installed context directly.
import './view-context'

import Tres from '@tresjs/core'

import { autoAnimatePlugin } from '@formkit/auto-animate/vue'
import { defineInvoke } from '@moeru/eventa'
import { MotionPlugin } from '@vueuse/motion'
import { getViewEventaContext } from '@proj-anima/electrobun-eventa/view'
import { createPinia } from 'pinia'
import { setupLayouts } from 'virtual:generated-layouts'
import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import { routes } from 'vue-router/auto-routes'

import App from './App.vue'

import { widgetsAdd, widgetsClear } from '../shared/eventa'
import { i18n } from './modules/i18n'

import '@unocss/reset/tailwind.css'
import 'splitpanes/dist/splitpanes.css'
import 'vue-sonner/style.css'
import './styles/main.css'
import 'uno.css'
// Fonts
import '@proj-anima/font-cjkfonts-allseto/index.css'
import '@proj-anima/font-xiaolai/index.css'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/jura'
import '@fontsource-variable/quicksand'
import '@fontsource-variable/urbanist'
import '@fontsource-variable/comfortaa'
import '@fontsource/dm-mono'
import '@fontsource/dm-serif-display'
import '@fontsource/gugi'
import '@fontsource/kiwi-maru'
import '@fontsource/m-plus-rounded-1c'
import '@fontsource/sniglet'
/* eslint-enable perfectionist/sort-imports */

const pinia = createPinia()

const router = createRouter({
  history: createWebHashHistory(),
  // TODO: vite-plugin-vue-layouts is long deprecated, replace with another layout solution
  routes: setupLayouts(routes as RouteRecordRaw[]),
})

// Ground rule: a settings window must never fall through to the Control Strip
// ('/') when backing out of its root. Declared via route meta so individual
// layouts don't string-match `route.path === '/settings'`.
router.beforeEach((to, from) => {
  if (to.path === '/modules/artistry')
    return '/settings/modules/artistry'
  if (from.meta?.rootOfSettings && to.path === '/')
    return false
})

createApp(App)
  .use(MotionPlugin)
  // TODO: Fix autoAnimatePlugin type error
  .use(autoAnimatePlugin as unknown as Plugin)
  .use(router)
  .use(pinia)
  .use(i18n)
  .use(Tres)
  .mount('#app')

if (typeof window !== 'undefined') {
  const win = window as unknown as Window & {
    spawnSticker?: (stickerId: string, options?: { weight?: number, pos?: string, ttlMs?: number }) => Promise<string | undefined>
    clearStickers?: () => Promise<void>
  }
  // The view-context module (first import) installed the shared Electrobun view
  // context and published it to electron-vueuse before the app graph evaluated.
  // Eventa's own invoke, not a raw `ipcRenderer.invoke`: main registers exactly one
  // request method (`eventa:emit`, src/main/rpc/index.ts), so a per-channel invoke
  // could only ever reject.
  const context = getViewEventaContext()
  const addWidget = context ? defineInvoke(context, widgetsAdd) : undefined
  const clearWidget = context ? defineInvoke(context, widgetsClear) : undefined

  win.spawnSticker = async (stickerId, options = {}) => {
    return addWidget?.({
      componentName: 'sticker',
      componentProps: { stickerId, weight: options.weight ?? 0.5, pos: options.pos ?? 'random' },
      ttlMs: options.ttlMs ?? 0,
    })
  }
  win.clearStickers = async () => {
    await clearWidget?.()
  }
}
