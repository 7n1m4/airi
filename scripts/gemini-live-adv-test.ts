import { env, stdout } from 'node:process'

import WebSocket from 'ws'

// GEMINI_API_KEY is read from the shell environment (or the repository-root .env loaded by the runner)
const PRIMARY_API_KEY = env.GEMINI_API_KEY ?? ''
const MODEL = 'models/gemini-3.1-flash-live-preview'
const URI = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${PRIMARY_API_KEY}`

const ws = new WebSocket(URI)

ws.on('open', () => {
  console.info('Connected to Gemini 3.1 Live (Advanced PoC)')

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
        parts: [{ text: 'You are Rick Sanchez. Analyze the provided image. Be cynical, scientific, and track your token usage.' }],
      },
    },
  }

  console.info('Sending Setup Message (Baseline with Vision)...')
  ws.send(JSON.stringify(setupMessage))
})

ws.on('message', (data) => {
  try {
    const response = JSON.parse(data.toString())

    if (response.usageMetadata) {
      console.info('\n===== METRICS REPORT =====')
      console.info(`Total Tokens: ${response.usageMetadata.totalTokenCount}`)
      if (response.usageMetadata.promptTokensDetails) {
        response.usageMetadata.promptTokensDetails.forEach((d: { modality?: string, tokenCount?: number }) => console.info(`  Input ${d.modality}: ${d.tokenCount}`))
      }
      if (response.usageMetadata.responseTokensDetails) {
        response.usageMetadata.responseTokensDetails.forEach((d: { modality?: string, tokenCount?: number }) => console.info(`  Output ${d.modality}: ${d.tokenCount}`))
      }
      console.info('==========================\n')
    }

    if (response.setupComplete) {
      console.info('Setup Complete. Sending Grounding query...')

      // Sending text asking about the game (Grounding test)
      ws.send(JSON.stringify({
        realtimeInput: {
          text: 'Rick, who won the game between the Dodgers and the Orioles last night? Also, are we in a simulation where 1007 errors are common?',
        },
      }))
    }

    if (response.serverContent) {
      const content = response.serverContent
      if (content.outputTranscription) {
        stdout.write(`\nRICK (Audio Transcript): ${content.outputTranscription.text}`)
      }
      if (content.modelTurn?.parts) {
        content.modelTurn.parts.forEach((p: { text?: string }) => {
          if (p.text)
            stdout.write(p.text)
        })
      }
    }
  }
  catch (err) {
    console.error('Message Parse Error:', err)
  }
})

ws.on('close', (code, reason) => console.info(`Connection closed [${code}]:`, reason.toString()))
setTimeout(() => ws.close(), 40000)
