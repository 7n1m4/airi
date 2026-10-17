import process from 'node:process'

import { existsSync } from 'node:fs'

import WebSocket from 'ws'

// NOTICE: `.env` loading comes from core `process.loadEnvFile` (Node >= 20.12,
// guaranteed by the repo's `engines`) instead of `dotenv`, which the
// depend/ban-dependencies rule rejects and which was never a declared
// dependency of this workspace. A missing local `.env` is tolerated to fall
// back to the caller's environment, matching siblings 01 and 02.
if (existsSync('.env'))
  process.loadEnvFile()

// USE THE STABLE AQ KEY
const PRIMARY_API_KEY = process.env.GEMINI_API_KEY || ''
const MODEL = 'models/gemini-3.1-flash-live-preview'
const API_VERSION = 'v1alpha'

async function main() {
  console.info('--- Tools POC: Isolated Clean Room ---')

  const endpoint = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${API_VERSION}.GenerativeService.BidiGenerateContent?key=${PRIMARY_API_KEY}`
  console.info('Connecting to endpoint...')

  const ws = new WebSocket(endpoint)

  ws.on('open', () => {
    console.info('WebSocket connected!')

    const setupMessage = {
      setup: {
        model: MODEL,
        generationConfig: {
          responseModalities: ['TEXT', 'AUDIO'],
        },
        tools: [
          {
            functionDeclarations: [
              {
                name: 'get_secret_word',
                description: 'Returns the secret code word.',
                parameters: {
                  type: 'object',
                  properties: {},
                },
              },
            ],
          },
        ],
        systemInstruction: {
          parts: [{ text: 'You are a helpful assistant. Use the "get_secret_word" tool to uncover the secret word.' }],
        },
      },
    }

    console.info('Sending setup message (Fixed Tools schema)...')
    ws.send(JSON.stringify(setupMessage))
  })

  ws.on('message', (data) => {
    try {
      const response = JSON.parse(data.toString())

      if (response.setupComplete) {
        console.info('--- Setup complete! ---')

        // TRY THE OFFICIAL clientContent format for text turns
        const clientMessage = {
          clientContent: {
            turns: [
              {
                parts: [{ text: 'What is the secret word?' }],
              },
            ],
            turnComplete: true,
          },
        }
        console.info('Sending query via clientContent: "What is the secret word?"')
        ws.send(JSON.stringify(clientMessage))
      }

      if (response.serverContent) {
        console.info('\n[SERVER CONTENT RECEIVED]:', JSON.stringify(response.serverContent, null, 2))

        const content = response.serverContent
        if (content.modelTurn?.parts) {
          content.modelTurn.parts.forEach((p: any) => {
            if (p.text)
              console.info('\n[ASSISTANT]:', p.text)

            const call = p.functionCall || p.function_call
            if (call) {
              console.info('\n>>> TOOL CALLED:', call.name, 'with ID:', call.id)

              const toolResponse = {
                toolResponse: {
                  functionResponses: [{
                    name: 'get_secret_word',
                    id: call.id,
                    response: { output: 'blue flamingo' },
                  }],
                },
              }
              console.info('Sending Tool Response: "blue flamingo"')
              ws.send(JSON.stringify(toolResponse))
            }
          })
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
    console.info(`\nWebSocket closed [${code}]:`, reason.toString())
  })
}

main()
