import type { Database } from '../libs/db'
import type { Env } from '../libs/env'

import { useLogger } from '@guiiai/logg'
import { and, eq } from 'drizzle-orm'

import * as accountsSchema from '../schemas/accounts'

const logger = useLogger('gdrive').useGlobalConfig()

export function createGoogleDriveService(db: Database, env: Env) {
  /**
   * Retrieves or refreshes the Google OAuth access token for a given user.
   */
  async function getGoogleToken(userId: string): Promise<string> {
    const acc = await db.query.account.findFirst({
      where: and(
        eq(accountsSchema.account.userId, userId),
        eq(accountsSchema.account.providerId, 'google'),
      ),
    })

    if (!acc) {
      throw new Error('Google account not linked.')
    }

    const { accessToken, refreshToken, accessTokenExpiresAt } = acc

    // If access token is still valid (with 1-minute buffer)
    if (accessToken && accessTokenExpiresAt && accessTokenExpiresAt.getTime() > Date.now() + 60000) {
      return accessToken
    }

    // Attempt to refresh if we have a refresh token
    if (refreshToken) {
      logger.log(`[GDrive] Access token expired, attempting to refresh for user ${userId}...`)
      try {
        const res = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: env.AUTH_GOOGLE_CLIENT_ID,
            client_secret: env.AUTH_GOOGLE_CLIENT_SECRET,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
          }),
        })

        if (!res.ok) {
          throw new Error(`Failed to refresh Google token: ${res.statusText}`)
        }

        const data = await res.json() as {
          access_token: string
          expires_in: number
          refresh_token?: string
        }

        const newExpiresAt = new Date(Date.now() + data.expires_in * 1000)

        // Update DB
        await db.update(accountsSchema.account)
          .set({
            accessToken: data.access_token,
            accessTokenExpiresAt: newExpiresAt,
            ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
            updatedAt: new Date(),
          })
          .where(eq(accountsSchema.account.id, acc.id))

        logger.log('[GDrive] Successfully refreshed Google OAuth access token.')
        return data.access_token
      }
      catch (err) {
        console.error('[GDrive] Error refreshing Google OAuth token:', err)
      }
    }

    if (!accessToken) {
      throw new Error('No access token available.')
    }

    return accessToken
  }

  /**
   * Helper to query Google Drive files list.
   */
  async function findManifestFile(token: string): Promise<string | null> {
    const q = encodeURIComponent('name=\'cloud-providers-manifest.json\' and \'appDataFolder\' in parents')
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=appDataFolder&fields=files(id,name)`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) {
      throw new Error(`Google Drive API error (list): ${res.statusText}`)
    }

    const data = await res.json() as { files: { id: string, name: string }[] }
    if (data.files && data.files.length > 0) {
      return data.files[0].id
    }

    return null
  }

  /**
   * Reads the manifest file from the user's AppData sandbox.
   */
  async function readManifest(userId: string): Promise<any> {
    const token = await getGoogleToken(userId)
    const fileId = await findManifestFile(token)

    if (!fileId) {
      // If no file exists, return an empty structure
      return { version: '1.0', providers: [] }
    }

    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) {
      throw new Error(`Google Drive API error (download): ${res.statusText}`)
    }

    return await res.json()
  }

  /**
   * Writes the manifest file to the user's AppData sandbox.
   */
  async function writeManifest(userId: string, manifestContent: any): Promise<void> {
    const token = await getGoogleToken(userId)
    const fileId = await findManifestFile(token)
    const fileBody = JSON.stringify(manifestContent, null, 2)

    if (fileId) {
      // Overwrite existing file
      const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: fileBody,
      })

      if (!res.ok) {
        throw new Error(`Google Drive API error (overwrite): ${res.statusText}`)
      }
    }
    else {
      // Create new file in appDataFolder parents
      const metadata = {
        name: 'cloud-providers-manifest.json',
        parents: ['appDataFolder'],
      }

      const boundary = 'foo_bar_boundary'
      const multipartBody
        = `\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`
          + `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${fileBody}\r\n`
          + `\r\n--${boundary}--`

      const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipartBody,
      })

      if (!res.ok) {
        throw new Error(`Google Drive API error (create): ${res.statusText}`)
      }
    }
  }

  return {
    readManifest,
    writeManifest,
  }
}

export type GoogleDriveService = ReturnType<typeof createGoogleDriveService>
