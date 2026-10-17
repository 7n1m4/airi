import process from 'node:process'

import WebSocket from 'ws'

// NOTICE: this POC used `dotenv`, which the depend/ban-dependencies rule rejects.
// Node >= 20.12 (repo engines require >= 20.14) exposes `process.loadEnvFile()`
// natively, so no dependency is needed. A missing local `.env` is tolerated to
// preserve the old `dotenv.config()` behaviour of falling back to the caller's
// environment.
try {
  process.loadEnvFile('.env')
}
catch {
  // No local .env — fall back to variables from the caller's environment.
}

// USE PROVIDED API KEY (Second one)
const PRIMARY_API_KEY = process.env.GEMINI_API_KEY || ''
const MODEL = 'models/gemini-3.1-flash-live-preview'
const API_VERSION = 'v1alpha'

async function main() {
  console.info('--- Grounding POC: Isolated Clean Room ---')

  const endpoint = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${API_VERSION}.GenerativeService.BidiGenerateContent?key=${PRIMARY_API_KEY}`
  console.info('Connecting to endpoint...')

  const ws = new WebSocket(endpoint)

  ws.on('open', () => {
    console.info('WebSocket connected!')

    const setupMessage = {
      setup: {
        model: MODEL,
        generationConfig: {
          responseModalities: ['AUDIO'],
        },
        tools: [
          { google_search: {} },
        ],
        systemInstruction: {
          parts: [{ text: 'You are a helpful assistant. Use Google Search for current events.' }],
        },
      },
    }

    console.info('Sending setup message (AUDIO + google_search)...')
    ws.send(JSON.stringify(setupMessage))
  })

  ws.on('message', (data) => {
    try {
      const response = JSON.parse(data.toString())

      // LOG EVERYTHING for deep inspection
      if (!response.serverContent) {
        console.info('\n[RAW RESPONSE]:', JSON.stringify(response, null, 2))
      }

      if (response.setupComplete) {
        console.info('--- Setup complete! ---')
        const clientMessage = {
          realtimeInput: {
            text: 'Who won the game between the Dodgers and the Orioles last night?',
          },
        }
        console.info('Sending query: "Who won the Dodgers/Orioles game last night?"')
        ws.send(JSON.stringify(clientMessage))
      }

      if (response.serverContent) {
        const content = response.serverContent

        if (content.modelTurn?.parts) {
          content.modelTurn.parts.forEach((p: any) => {
            if (p.text) {
              console.info('\n[ASSISTANT]:', p.text)
            }
            if (p.call) {
              console.info('\n[TOOL CALL]:', JSON.stringify(p.call, null, 2))
            }
          })
        }

        if (content.groundingMetadata) {
          console.info('\n[GROUNDING METADATA]:', JSON.stringify(content.groundingMetadata, null, 2))
        }

        if (content.turnComplete) {
          console.info('\n--- Turn Complete ---')
          ws.close()
        }
      }

      if (response.error) {
        console.error('\n[ERROR]:', response.error)
        ws.close()
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
