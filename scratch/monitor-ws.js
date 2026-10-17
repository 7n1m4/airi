import WebSocket from 'ws'

const ws = new WebSocket('ws://localhost:3000')

let latestTelemetry = null
const collectedLogs = []
const collectedEvents = []

ws.on('open', () => {
  console.info('Connected to ws://localhost:3000')
})

ws.on('message', (data) => {
  try {
    const packet = JSON.parse(data)

    if (packet.type === 'telemetry') {
      latestTelemetry = packet.data
      // Console log of telemetry is verbose, let's keep track silently
    }
    else if (packet.type === 'log') {
      collectedLogs.push(packet.data)
      console.info(`Log received [Total: ${collectedLogs.length}]: ${packet.data.message}`)
    }
    else if (packet.type === 'llm_event') {
      collectedEvents.push(packet.data)
      console.info('LLM event received:', packet.data.name)
    }
  }
  catch (err) {
    console.error('Error parsing message:', err)
  }
})

ws.on('error', (err) => {
  console.error('WebSocket Error:', err)
})

// Run for 25 seconds to gather sufficient logs
setTimeout(() => {
  ws.close()

  console.info('\n========================================')
  console.info('--- CAPTURED TELEMETRY ---')
  console.info(JSON.stringify(latestTelemetry, null, 2))

  console.info('\n--- LAST 20 LOGS ---')
  const last20Logs = collectedLogs.slice(-20)
  last20Logs.forEach((log, idx) => {
    console.info(`${idx + 1}. [${log.timestamp}] ${log.message}`)
  })
  console.info('========================================')
}, 25000)
