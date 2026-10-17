import https from 'node:https'

import { env } from 'node:process'

const API_KEY = env.GEMINI_API_KEY || ''

const options = {
  hostname: 'generativelanguage.googleapis.com',
  path: `/v1beta/models?key=${API_KEY}`,
  method: 'GET',
  headers: {
    'Content-Type': 'application/json',
  },
}

const req = https.request(options, (res) => {
  let data = ''
  res.on('data', (chunk) => {
    data += chunk
  })
  res.on('end', () => {
    console.info('Response status:', res.statusCode)
    try {
      const parsed: unknown = JSON.parse(data)
      const models = typeof parsed === 'object' && parsed !== null && 'models' in parsed
        ? parsed.models
        : undefined
      if (Array.isArray(models)) {
        console.info('Available models:')
        models.forEach(m => console.info(`- ${(m as { name?: string }).name}`))
      }
      else {
        console.info('No models found or error:', data)
      }
    }
    catch {
      console.info('Raw response:', data)
    }
  })
})

req.on('error', (e) => {
  console.error('Request error:', e)
})

req.end()
