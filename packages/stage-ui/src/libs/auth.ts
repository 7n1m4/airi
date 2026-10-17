import { createAuthClient } from 'better-auth/vue'

import { useAuthStore } from '../stores/auth'

export type OAuthProvider = 'google' | 'github'

export const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000'
export const REMOTE_SYNC_STORAGE_KEY = 'settings/privacy/remote-sync-enabled'

export function isRemoteSyncEnabled() {
  if (typeof localStorage === 'undefined')
    return false

  return localStorage.getItem(REMOTE_SYNC_STORAGE_KEY) === 'true'
}

export const authClient = createAuthClient({
  baseURL: SERVER_URL,
  credentials: 'include',
})

export async function fetchSession() {
  if (!isRemoteSyncEnabled()) {
    console.info('[Auth] fetchSession skipped: remote sync not enabled in localStorage')
    return false
  }

  console.info('[Auth] fetchSession: calling authClient.getSession()...')
  try {
    const res = await authClient.getSession()
    console.info('[Auth] fetchSession response:', res)
    if (res.data) {
      const authStore = useAuthStore()
      authStore.user = res.data.user
      authStore.session = res.data.session
      console.info('[Auth] fetchSession successfully updated authStore with user:', res.data.user.email)
      return true
    }
    else {
      console.warn('[Auth] fetchSession returned no data (user not logged in or cookie blocked):', res)
    }
  }
  catch (err) {
    console.error('[Auth] fetchSession error during getSession call:', err)
  }

  return false
}

export async function listSessions() {
  return await authClient.listSessions()
}

export async function signOut() {
  await authClient.signOut()

  const authStore = useAuthStore()
  authStore.user = undefined
  authStore.session = undefined
}

export async function signIn(provider: OAuthProvider) {
  const isElectron = typeof window !== 'undefined' && !!(window as any).electron

  if (isElectron) {
    const authUrl = `${SERVER_URL}/api/auth/login/social?provider=${provider}&callbackURL=${SERVER_URL}/health`
    const popup = window.open(authUrl, 'oauth-signin', 'width=580,height=650')
    if (popup) {
      return new Promise<void>((resolve) => {
        const pollTimer = setInterval(async () => {
          if (popup.closed) {
            clearInterval(pollTimer)
            await fetchSession()
            resolve()
          }
          else {
            const success = await fetchSession()
            if (success) {
              clearInterval(pollTimer)
              popup.close()
              resolve()
            }
          }
        }, 1000)
      })
    }
  }

  return await authClient.signIn.social({
    provider,
    callbackURL: window.location.origin,
  })
}
