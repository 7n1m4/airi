import { array, literal, maxLength, number, object, optional, pipe, string, union } from 'valibot'

const ChatTypeSchema = union([
  literal('private'),
  literal('bot'),
  literal('group'),
  literal('channel'),
])

const ChatMemberTypeSchema = union([
  literal('user'),
  literal('character'),
  literal('bot'),
])

const ChatMessageRoleSchema = union([
  literal('system'),
  literal('user'),
  literal('assistant'),
  literal('tool'),
  literal('error'),
])

export const ChatSyncMessageSchema = object({
  id: string(),
  role: ChatMessageRoleSchema,
  content: string(),
  createdAt: optional(number()),
})

export const ChatSyncSchema = object({
  chat: object({
    id: string(),
    type: optional(ChatTypeSchema),
    title: optional(string()),
    createdAt: optional(number()),
    updatedAt: optional(number()),
  }),
  members: optional(pipe(array(object({
    type: ChatMemberTypeSchema,
    userId: optional(string()),
    characterId: optional(string()),
  })), maxLength(64))), // Bound the per-member SELECT storm a full sync can trigger
  messages: array(ChatSyncMessageSchema),
})
