import type { Database } from '../libs/db'

import { and, eq, isNull, sql } from 'drizzle-orm'

import { createNotFoundError } from '../utils/error'

import * as schema from '../schemas/characters'
import * as userCharacterSchema from '../schemas/user-character'

// Client-writable columns only; server-managed counters, ownership, and
// identity fields are never accepted from a PATCH body.
const UPDATABLE_KEYS = ['version', 'coverUrl', 'avatarUrl', 'creatorRole'] as const

export function createCharacterService(db: Database) {
  return {
    async findById(id: string) {
      return await db.query.character.findFirst({
        where: and(
          eq(schema.character.id, id),
          isNull(schema.character.deletedAt),
        ),
        with: {
          capabilities: true,
          avatarModels: true,
          i18n: true,
          prompts: true,
          likes: true,
          bookmarks: true,
          cover: true,
        },
      })
    },

    async findByOwnerId(ownerId: string) {
      return await db.query.character.findMany({
        where: and(
          eq(schema.character.ownerId, ownerId),
          isNull(schema.character.deletedAt),
        ),
        with: {
          i18n: true,
          capabilities: true,
          likes: true,
          bookmarks: true,
          cover: true,
        },
      })
    },

    async findAll() {
      return await db.query.character.findMany({
        where: isNull(schema.character.deletedAt),
        with: {
          i18n: true,
          capabilities: true,
          likes: true,
          bookmarks: true,
          cover: true,
        },
      })
    },

    async like(userId: string, characterId: string) {
      return await db.transaction(async (tx: any) => {
        const target = await tx.query.character.findFirst({
          where: and(
            eq(schema.character.id, characterId),
            isNull(schema.character.deletedAt),
          ),
        })
        if (!target)
          throw createNotFoundError('Character not found')

        const existing = await tx.query.characterLikes.findFirst({
          where: and(
            eq(userCharacterSchema.characterLikes.userId, userId),
            eq(userCharacterSchema.characterLikes.characterId, characterId),
          ),
        })

        if (existing) {
          await tx.delete(userCharacterSchema.characterLikes)
            .where(and(
              eq(userCharacterSchema.characterLikes.userId, userId),
              eq(userCharacterSchema.characterLikes.characterId, characterId),
            ))

          await tx.update(schema.character)
            .set({
              likesCount: sql`GREATEST(0, ${schema.character.likesCount} - 1)`,
            })
            .where(eq(schema.character.id, characterId))

          return { liked: false }
        }
        else {
          // Lost a concurrent first-like race: keep {liked:true}, don't double-count.
          const inserted = await tx.insert(userCharacterSchema.characterLikes).values({ userId, characterId }).onConflictDoNothing().returning({ userId: userCharacterSchema.characterLikes.userId })
          if (inserted.length === 0)
            return { liked: true }

          await tx.update(schema.character)
            .set({
              likesCount: sql`${schema.character.likesCount} + 1`,
            })
            .where(eq(schema.character.id, characterId))

          return { liked: true }
        }
      })
    },

    async bookmark(userId: string, characterId: string) {
      return await db.transaction(async (tx: any) => {
        const target = await tx.query.character.findFirst({
          where: and(
            eq(schema.character.id, characterId),
            isNull(schema.character.deletedAt),
          ),
        })
        if (!target)
          throw createNotFoundError('Character not found')

        const existing = await tx.query.characterBookmarks.findFirst({
          where: and(
            eq(userCharacterSchema.characterBookmarks.userId, userId),
            eq(userCharacterSchema.characterBookmarks.characterId, characterId),
          ),
        })

        if (existing) {
          await tx.delete(userCharacterSchema.characterBookmarks)
            .where(and(
              eq(userCharacterSchema.characterBookmarks.userId, userId),
              eq(userCharacterSchema.characterBookmarks.characterId, characterId),
            ))

          await tx.update(schema.character)
            .set({
              bookmarksCount: sql`GREATEST(0, ${schema.character.bookmarksCount} - 1)`,
            })
            .where(eq(schema.character.id, characterId))

          return { bookmarked: false }
        }
        else {
          const inserted = await tx.insert(userCharacterSchema.characterBookmarks).values({ userId, characterId }).onConflictDoNothing().returning({ userId: userCharacterSchema.characterBookmarks.userId })
          if (inserted.length === 0)
            return { bookmarked: true }

          await tx.update(schema.character)
            .set({
              bookmarksCount: sql`${schema.character.bookmarksCount} + 1`,
            })
            .where(eq(schema.character.id, characterId))

          return { bookmarked: true }
        }
      })
    },

    async create(data: {
      character: schema.NewCharacter
      cover?: Omit<schema.NewCharacterCover, 'characterId'>
      capabilities?: Omit<schema.NewCharacterCapability, 'characterId'>[]
      avatarModels?: Omit<schema.NewAvatarModel, 'characterId'>[]
      i18n?: Omit<schema.NewCharacterI18n, 'characterId'>[]
      prompts?: Omit<schema.NewCharacterPrompt, 'characterId'>[]
    }) {
      return await db.transaction(async (tx: any) => {
        const [inserted] = await tx.insert(schema.character).values(data.character).returning()

        if (data.cover) {
          await tx.insert(schema.characterCovers).values({
            ...data.cover,
            characterId: inserted.id,
          })
        }

        if (data.capabilities?.length) {
          await tx.insert(schema.characterCapabilities).values(
            data.capabilities.map(c => ({ ...c, characterId: inserted.id })),
          )
        }

        if (data.avatarModels?.length) {
          await tx.insert(schema.avatarModel).values(
            data.avatarModels.map(a => ({ ...a, characterId: inserted.id })),
          )
        }

        if (data.i18n?.length) {
          await tx.insert(schema.characterI18n).values(
            data.i18n.map(i => ({ ...i, characterId: inserted.id })),
          )
        }

        if (data.prompts?.length) {
          await tx.insert(schema.characterPrompts).values(
            data.prompts.map(p => ({ ...p, characterId: inserted.id })),
          )
        }

        return inserted
      })
    },

    async update(id: string, data: Partial<schema.NewCharacter>) {
      const patch: Record<string, unknown> = {}
      for (const key of UPDATABLE_KEYS) {
        if (data[key] !== undefined)
          patch[key] = data[key]
      }
      if (Object.keys(patch).length === 0)
        return undefined // Nothing the client is allowed to change
      const rows = await db.update(schema.character)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(
          eq(schema.character.id, id),
          isNull(schema.character.deletedAt),
        ))
        .returning()
      return rows[0]
    },

    async delete(id: string) {
      return await db.update(schema.character)
        .set({ deletedAt: new Date() })
        .where(and(
          eq(schema.character.id, id),
          isNull(schema.character.deletedAt),
        ))
        .returning()
    },
  }
}

export type CharacterService = ReturnType<typeof createCharacterService>
