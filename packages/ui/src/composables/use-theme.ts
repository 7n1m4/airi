import { useBroadcastChannel, useDark, useToggle } from '@vueuse/core'
import { ref, watch } from 'vue'

const isDark = useDark({
  disableTransition: true,
})

const toggleDark = useToggle(isDark)

// NOTICE: useBroadcastChannel at module scope creates a *native Node*
// BroadcastChannel when this module is imported outside a browser
// (histoire story collection, vitest, SSR). Its immediate post below then
// crashes Node with ERR_INVALID_ARG_TYPE once a cross-realm MessageEvent
// arrives. Only wire cross-window sync in a real browser window.
const isBrowserWindow = typeof window !== 'undefined' && typeof window.BroadcastChannel !== 'undefined'
const { data, post } = isBrowserWindow
  ? useBroadcastChannel<boolean, boolean>({ name: 'airi-theme-sync' })
  : { data: ref<boolean | undefined>(undefined), post: () => {} }

watch(isDark, (val) => {
  if (data.value !== val) {
    post(val)
  }
}, { immediate: true })

watch(data, (val) => {
  if (val !== undefined && isDark.value !== val) {
    isDark.value = val
  }
})

export function useTheme() {
  return {
    isDark,
    toggleDark,
  }
}
