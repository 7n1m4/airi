import { PGlite } from '@electric-sql/pglite'
import { useLogger } from '@guiiai/logg'
import { migrate } from '@proj-airi/drizzle-orm-browser-migrator/pg'
import { migrations } from '@proj-airi/server-schema'
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { Pool } from 'pg'

import * as fullSchema from '../schemas'

const logger = useLogger('db').useGlobalConfig()

export type Database = any

export function createDrizzle(dsn: string) {
  const usePglite = !dsn || dsn.includes('@db:') || dsn.startsWith('pglite://')

  if (usePglite) {
    logger.log('[Database] Using local embedded PGlite database (no Postgres server required)')
    const client = new PGlite()
    const db = drizzlePglite(client, { schema: fullSchema })
    return {
      db,
      pool: {
        end: async () => {
          await client.close()
        },
      },
    }
  }

  logger.log('[Database] Connecting to external Postgres server')
  const pool = new Pool({ connectionString: dsn })
  const db = drizzlePg(pool, { schema: fullSchema })
  return { db, pool }
}

export function migrateDatabase(db: Database) {
  return migrate(db, migrations)
}
