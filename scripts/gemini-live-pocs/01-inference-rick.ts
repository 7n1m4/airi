import process from 'node:process'

import { existsSync } from 'node:fs'

import WebSocket from 'ws'

// NOTICE: `.env` loading comes from core `process.loadEnvFile` (Node >= 20.12,
// guaranteed by the repo's `engines`) instead of `dotenv`, which was never a
// declared dependency of this workspace and only resolved through hoisting.
if (existsSync('.env'))
  process.loadEnvFile()

const PRIMARY_API_KEY = process.env.GEMINI_API_KEY

if (!PRIMARY_API_KEY) {
  console.error('Please set your GEMINI_API_KEY environment variable.')
  process.exit(1)
}

const MODEL = 'models/gemini-3.1-flash-live-preview'
const API_VERSION = 'v1alpha'

async function main() {
  console.info('--- Phase 2: Raw Bidi Connection (API Key + camelCase) ---')

  // Using the correct URI format discovered in SDK/Examples
  const endpoint = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${API_VERSION}.GenerativeService.BidiGenerateContent?key=${PRIMARY_API_KEY}`
  console.info('Connecting to endpoint...')

  const ws = new WebSocket(endpoint)

  ws.on('open', () => {
    console.info('WebSocket connected!')

    // Following the schema found in geminilive.js (from ephemeral-tokens example)
    const setupMessage = {
      setup: {
        model: MODEL,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Puck',
              },
            },
          },
        },
        systemInstruction: {
          parts: [{
            text: 'You are Rick Sanchez from Rick and Morty. You are cynical, brilliant, and speak to the user as if they are Morty or a slow research assistant. Use science-heavy jargon and occasional belches in text form [burp].',
          }],
        },
      },
    }

    console.info('Sending setup message (camelCase)...')
    ws.send(JSON.stringify(setupMessage))
  })

  ws.on('message', (data) => {
    try {
      const response = JSON.parse(data.toString())
      // console.info('Received RAW:', JSON.stringify(response, null, 2));

      if (response.setupComplete) {
        console.info('Setup handshake complete! Rick is listening.')
        const clientMessage = {
          realtimeInput: {
            text: 'Rick, i just saw a massive floating head in the sky. It said DISQUALIFIED. What is it?',
          },
        }
        ws.send(JSON.stringify(clientMessage))
      }

      if (response.serverContent) {
        const content = response.serverContent
        if (content.outputTranscription) {
          process.stdout.write(`\nRICK (transcription): ${content.outputTranscription.text}`)
        }
        if (content.modelTurn?.parts) {
          content.modelTurn.parts.forEach((p: any) => {
            if (p.text)
              process.stdout.write(p.text)
          })
        }
        if (content.turnComplete) {
          console.info('\n--- Rick is done talking ---')

          // Requesting metadata by sending an empty input or just waiting for the next turn?
          // Actually usageMetadata should be in the message already if provided.
        }
      }

      if (response.usageMetadata) {
        console.info('\n--- Usage Metadata ---')
        console.info(`Total Tokens: ${response.usageMetadata.totalTokenCount}`)
        if (response.usageMetadata.promptTokensDetails) {
          console.info('Prompt Tokens:', response.usageMetadata.promptTokensDetails)
        }
        if (response.usageMetadata.responseTokensDetails) {
          console.info('Response Tokens:', response.usageMetadata.responseTokensDetails)
        }
        console.info('----------------------')
      }
    }
    catch (err) {
      console.error('Message Parse Error:', err)
    }
  })

  ws.on('error', (err) => {
    console.error('WebSocket Error:', err)
  })

  ws.on('close', (code, reason) => {
    console.info(`WebSocket closed [${code}]:`, reason.toString())
  })
}

main()
