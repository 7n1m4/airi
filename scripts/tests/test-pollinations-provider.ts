import process from 'node:process'

import { PollinationsProvider } from '../../apps/stage-tamagotchi/src/main/services/airi/widgets/providers/pollinations'

async function main() {
  console.info('🌸 [Test] Testing PollinationsProvider integration...')

  const provider = new PollinationsProvider()
  await provider.initialize({
    pollinationsModel: '',
    pollinationsWidth: 512,
    pollinationsHeight: 512,
  })

  console.info('🌸 [Test] Provider initialized:', provider.name, 'ID:', provider.id)

  const prompt = 'A serene watercolor landscape of Mount Fuji during sunrise with cherry blossoms'
  console.info(`🌸 [Test] Generating image with prompt: "${prompt}"`)

  const job = await provider.generate({
    prompt,
    width: 512,
    height: 512,
    extra: {
      seed: 42,
    },
  })

  console.info(`🌸 [Test] Job created: ${job.jobId}`)

  // Wait for status completion
  let status = await provider.getStatus(job.jobId)
  const startTime = Date.now()

  while (status.status === 'running' || status.status === 'queued') {
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, 1000)
    await promise
    status = await provider.getStatus(job.jobId)
    console.info(`🌸 [Test] Progress: ${status.progress}% - ${status.actionLabel || status.status}`)
  }

  if (status.status === 'succeeded') {
    const isDataUrl = status.imageUrl?.startsWith('data:image/')
    const base64Len = status.imageUrl?.length || 0
    console.info('✅ [Test] Generation succeeded!')
    console.info(`🌸 [Test] Image data URL length: ${base64Len} chars (Is Data URL: ${isDataUrl})`)
    console.info(`🌸 [Test] Total time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`)
  }
  else {
    console.error('❌ [Test] Generation failed:', status.error)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('❌ [Test] Unhandled error:', err)
  process.exit(1)
})
