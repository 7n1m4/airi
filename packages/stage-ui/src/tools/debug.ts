import z from 'zod'

import { tool } from '@xsai/tool'

const tools = [
  tool({
    name: 'debug_random_number',
    description: 'Generate a random number between 0 and 1',
    execute: async () => {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(Math.random().toString())
        }, 1000)
      })
    },
    parameters: z.object({}),
  }),
]

export const debug = async () => Promise.all(tools)
