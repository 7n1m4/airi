import type { CursorState, GameAdapter, TurnPlan, TurnState } from '../../types/arcade'

import { useTimeoutFn } from '@vueuse/core'
import { ref } from 'vue'

import { useFacultyDefaultsStore } from '../../stores/faculty-defaults'
import { useLLM } from '../../stores/llm'
import { useAiriCardStore } from '../../stores/modules/airi-card'
import { useVisionStore } from '../../stores/modules/vision'
import { useProvidersStore } from '../../stores/providers'
import { resolveArcadeProfile } from './profiles'

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function useArcadeAgent() {
  const llmStore = useLLM()
  const visionStore = useVisionStore()
  const providersStore = useProvidersStore()
  const facultyDefaultsStore = useFacultyDefaultsStore()
  const cardStore = useAiriCardStore()

  const turnState = ref<TurnState>('idle')
  const activeAdapter = ref<GameAdapter | null>(null)
  const currentTurnPlan = ref<TurnPlan | null>(null)
  const autoPlay = ref<boolean>(false)
  const stepConfirmation = ref<boolean>(false)
  const lastError = ref<string | null>(null)

  const cursorState = ref<CursorState>({
    visible: false,
    x: 500,
    y: 500,
    clicking: false,
    pinging: false,
    activeActionLabel: '',
  })

  let isCancelled = false

  function bindAdapter(adapter: GameAdapter) {
    activeAdapter.value = adapter
  }

  function unbindAdapter() {
    activeAdapter.value = null
    interrupt()
  }

  function interrupt() {
    isCancelled = true
    turnState.value = 'interrupted'
    autoPlay.value = false
    cursorState.value.visible = false
    cursorState.value.clicking = false
    cursorState.value.pinging = false
    if (activeAdapter.value?.duckAudio) {
      activeAdapter.value.duckAudio(false)
    }
    setTimeout(() => {
      if (turnState.value === 'interrupted') {
        turnState.value = 'idle'
      }
    }, 200)
  }

  async function animateCursor(startX: number, startY: number, targetX: number, targetY: number, durationMs = 200) {
    const startTime = performance.now()
    const raf = typeof requestAnimationFrame !== 'undefined'
      ? requestAnimationFrame
      : (cb: (time: number) => void) => setTimeout(() => cb(performance.now()), 16)

    return new Promise<void>((resolve) => {
      function step(currentTime: number) {
        if (isCancelled) {
          resolve()
          return
        }
        const elapsed = currentTime - startTime
        const progress = Math.min(elapsed / durationMs, 1)
        // Ease-out cubic
        const ease = 1 - (1 - progress) ** 3
        cursorState.value.x = Math.round(startX + (targetX - startX) * ease)
        cursorState.value.y = Math.round(startY + (targetY - startY) * ease)

        if (progress < 1) {
          raf(step)
        }
        else {
          cursorState.value.x = targetX
          cursorState.value.y = targetY
          resolve()
        }
      }
      raf(step)
    })
  }

  async function takeTurn(options?: {
    onCommentary?: (plan: TurnPlan) => void
    speakCommentary?: (textWithEmotion: string) => Promise<void> | void
  }): Promise<TurnPlan | null> {
    if (!activeAdapter.value) {
      lastError.value = 'No active game adapter bound'
      return null
    }

    isCancelled = false
    lastError.value = null
    turnState.value = 'capturing'

    try {
      const frameDataUrl = await activeAdapter.value.captureFrame()
      if (!frameDataUrl) {
        throw new Error('Failed to capture active game frame')
      }

      if (isCancelled)
        return null

      turnState.value = 'thinking'

      const gameTitle = activeAdapter.value.title
      const profile = resolveArcadeProfile(gameTitle)
      const characterName = cardStore.activeCard?.name || 'Airi'

      const systemPrompt = `You are ${characterName}, an intelligent and expressive AI companion playing '${gameTitle}' with the player!
You are looking at the current active game screen right now.
It is your turn to take action in the game!

${profile.systemPromptAddendum}

## YOUR TASK:
1. Examine the game screen and evaluate the current state.
2. Formulate your strategic plan for this specific turn.
3. Formulate your spoken in-character thoughts/commentary for the player (1-2 lively sentences).
4. Select a concise emotional acting cue: 'excited', 'smug', 'thoughtful', 'worried', 'triumphant', or 'focused'.
5. Produce an exact list of actions to execute on the game interface:
   - Mouse clicks use normalized coordinates [0, 1000] (0 = top/left, 1000 = bottom/right).
   - Key presses use standardized key strings ('ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Space', 'y', 'n', etc.).

Return ONLY a JSON object with this exact structure:
\`\`\`json
{
  "spoken_commentary": "I'm going to zone a nice residential area right here near the trees!",
  "emotion": "excited",
  "plan": "Select Residential Zone tool from left menu (X: 50, Y: 185) and place at (X: 350, Y: 420).",
  "actions": [
    { "type": "click", "x": 50, "y": 185, "label": "Select Residential Zone" },
    { "type": "wait", "durationMs": 200 },
    { "type": "click", "x": 350, "y": 420, "label": "Place Residential Zone" }
  ]
}
\`\`\``

      const vlmProviderId = visionStore.activeProvider
        || facultyDefaultsStore.defaults.vision?.primaryProvider
        || 'deepseek'
      const vlmModelId = visionStore.activeModel
        || facultyDefaultsStore.defaults.vision?.primaryModel
        || 'deepseek-v4-flash-vision-exp'

      const vlmProvider = await providersStore.getProviderInstance<any>(vlmProviderId)
      if (!vlmProvider) {
        throw new Error(`Unable to initialize Vision Provider "${vlmProviderId}". Please check Settings > Vision.`)
      }

      const turnPrompt = `${systemPrompt}\n\nHere is our current game screen for '${gameTitle}'. It's your turn, what do you do?`

      let rawResponseText = ''

      if (typeof vlmProvider.captionImage === 'function') {
        if (typeof vlmProvider.loadModel === 'function' && !vlmProvider.isModelLoaded?.value) {
          await vlmProvider.loadModel()
        }
        rawResponseText = await vlmProvider.captionImage(frameDataUrl, { prompt: turnPrompt })
      }
      else {
        const vlmMessages = [
          {
            role: 'user' as const,
            content: [
              { type: 'text' as const, text: turnPrompt },
              { type: 'image_url' as const, image_url: { url: frameDataUrl } },
            ],
          },
        ]
        const response = await llmStore.generate(
          vlmModelId,
          vlmProvider,
          vlmMessages as any,
          { vision: true },
        )
        rawResponseText = response.text || ''
      }

      if (isCancelled)
        return null

      const cleaned = rawResponseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('VLM response did not contain a valid JSON turn plan')
      }

      const parsed: TurnPlan = JSON.parse(jsonMatch[0])
      currentTurnPlan.value = parsed

      if (options?.onCommentary) {
        options.onCommentary(parsed)
      }

      if (options?.speakCommentary) {
        const emotionTag = parsed.emotion ? `<|ACT:emotion="${parsed.emotion}"|> ` : ''
        options.speakCommentary(`${emotionTag}${parsed.spoken_commentary}`)
      }

      if (stepConfirmation.value) {
        // Halt here so player can review plan
        turnState.value = 'idle'
        return parsed
      }

      await executePlan(parsed)

      // If autoplay is still active and not cancelled, loop
      if (autoPlay.value && !isCancelled) {
        useTimeoutFn(() => {
          if (autoPlay.value && !isCancelled && turnState.value === 'idle') {
            takeTurn(options)
          }
        }, 3000)
      }

      return parsed
    }
    catch (err: any) {
      console.error('[ArcadeAgent] Turn execution failed:', err)
      lastError.value = err.message || 'Turn failed'
      turnState.value = 'idle'
      if (activeAdapter.value?.duckAudio) {
        activeAdapter.value.duckAudio(false)
      }
      return null
    }
  }

  async function executePlan(plan: TurnPlan): Promise<void> {
    if (!activeAdapter.value || isCancelled)
      return

    turnState.value = 'executing'
    cursorState.value.visible = true

    if (activeAdapter.value.duckAudio) {
      activeAdapter.value.duckAudio(true)
    }

    try {
      for (const action of plan.actions) {
        if (isCancelled)
          break

        if (action.type === 'click') {
          const startX = cursorState.value.x
          const startY = cursorState.value.y
          const targetX = Math.max(0, Math.min(1000, action.x))
          const targetY = Math.max(0, Math.min(1000, action.y))

          await animateCursor(startX, startY, targetX, targetY, 220)
          if (isCancelled)
            break

          cursorState.value.activeActionLabel = action.label || 'Click'
          cursorState.value.clicking = true

          await activeAdapter.value.executeClick(targetX, targetY, action.button)
          await delay(120)
          cursorState.value.clicking = false
        }
        else if (action.type === 'drag') {
          const startX = Math.max(0, Math.min(1000, action.fromX))
          const startY = Math.max(0, Math.min(1000, action.fromY))
          const endX = Math.max(0, Math.min(1000, action.toX))
          const endY = Math.max(0, Math.min(1000, action.toY))

          await animateCursor(cursorState.value.x, cursorState.value.y, startX, startY, 200)
          cursorState.value.clicking = true
          await animateCursor(startX, startY, endX, endY, 300)

          if (activeAdapter.value.executeDrag) {
            await activeAdapter.value.executeDrag(startX, startY, endX, endY)
          }
          else {
            await activeAdapter.value.executeClick(endX, endY)
          }
          cursorState.value.clicking = false
        }
        else if (action.type === 'key_press') {
          cursorState.value.activeActionLabel = action.label || action.key
          cursorState.value.pinging = true
          await activeAdapter.value.executeKeyPress(action.key, action.durationMs)
          await delay(120)
          cursorState.value.pinging = false
        }
        else if (action.type === 'type_text') {
          cursorState.value.activeActionLabel = `Type: ${action.text}`
          await activeAdapter.value.executeTypeText(action.text)
        }
        else if (action.type === 'wait') {
          await delay(action.durationMs)
        }

        await delay(180)
      }
    }
    finally {
      if (activeAdapter.value?.duckAudio) {
        activeAdapter.value.duckAudio(false)
      }
      setTimeout(() => {
        if (turnState.value !== 'executing') {
          cursorState.value.visible = false
          cursorState.value.activeActionLabel = ''
        }
      }, 700)
      turnState.value = 'idle'
    }
  }

  return {
    turnState,
    cursorState,
    activeAdapter,
    currentTurnPlan,
    autoPlay,
    stepConfirmation,
    lastError,
    bindAdapter,
    unbindAdapter,
    takeTurn,
    executePlan,
    interrupt,
  }
}
