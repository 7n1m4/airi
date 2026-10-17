#!/usr/bin/env tsx

import process from 'node:process'

import { createServer } from '../server'

const server = createServer({
  port: process.env.PORT ? Number.parseInt(process.env.PORT) : 6121,
})

let stopping = false

async function shutdown() {
  if (stopping)
    return
  stopping = true
  await server.stop()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

server.start()
