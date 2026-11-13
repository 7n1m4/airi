import type { Database } from './db'
import type { Env } from './env'

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { bearer } from 'better-auth/plugins'

import { deployedOrigin } from '../utils/origin'

import * as authSchema from '../schemas/accounts'

export function createAuth(db: Database, env: Env) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        ...authSchema,
      },
    }),

    plugins: [
      bearer(),
    ],

    session: {
      // Cache the session in the signed cookie for 5 minutes so /api/* does not
      // hit Postgres on every request; revocation latency is bounded by maxAge.
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },

    emailAndPassword: {
      enabled: true,
    },

    baseURL: env.API_SERVER_URL,
    // Same allowlist as the CORS middleware (utils/origin.ts). Localhost is dev-only.
    trustedOrigins: process.env.NODE_ENV !== 'production'
      ? [deployedOrigin, 'http://localhost:*']
      : [deployedOrigin],

    // To skip state-mismatch errors
    // https://github.com/better-auth/better-auth/issues/4969#issuecomment-3397804378
    advanced: {
      defaultCookieAttributes: {
        sameSite: 'None', // this enables cross-site cookies
        secure: true, // required for SameSite=None
      },
    },

    socialProviders: {
      google: {
        clientId: env.AUTH_GOOGLE_CLIENT_ID,
        clientSecret: env.AUTH_GOOGLE_CLIENT_SECRET,
        scope: ['openid', 'profile', 'email', 'https://www.googleapis.com/auth/drive.appdata'],
      },
      github: {
        clientId: env.AUTH_GITHUB_CLIENT_ID,
        clientSecret: env.AUTH_GITHUB_CLIENT_SECRET,
      },
    },
  })
}
