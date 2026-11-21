import type { CommonRequestOptions } from '@xsai/shared'
import type { Message } from '@xsai/shared-chat'
import type { Infer, Schema } from 'xsschema'

import { generateObject as sharedGenerateObject } from '@proj-anima/stage-shared'

type SchemaOrString<S extends Schema | undefined | unknown> = S extends unknown ? string : S extends Schema ? Infer<S> : never

/**
 * Processes user input and generates LLM response along with thought nodes.
 */
export async function generateObject<S extends Schema, R extends SchemaOrString<S>>(
  options: { messages: Message[], model: string, apiKey?: string, baseURL: string } & Partial<CommonRequestOptions>,
  schema?: S,
): Promise<R> {
  // Use the shared canary structured output protocol
  return await sharedGenerateObject({
    ...options,
    schema: schema as any,
    maxAttempts: 3,
  }) as R
}
