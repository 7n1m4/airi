import type { CursorState, GameAdapter, TurnPlan, TurnState } from '../../types/arcade'

import { useTimeoutFn } from '@vueuse/core'
import { ref } from 'vue'

import { useFacultyDefaultsStore } from '../../stores/faculty-defaults'
import { useLLM } from '../../stores/llm'
import { useAiriCardStore } from '../../stores/modules/airi-card'
import { useVisionStore } from '../../stores/modules/vision'
import { useProvidersStore } from '../../stores/providers'
import { resolveArcadeProfile } from './profiles'

export interface ArcadeTurnMemory {
  turnIndex: number
  plan: string
  spoken: string
  actionsSummary: string
  timestamp: number
}

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
  const turnHistory = ref<ArcadeTurnMemory[]>([])
  const customPromptAddendum = ref<string | null>(null)

  const cursorState = ref<CursorState>({
    visible: false,
    x: 500,
    y: 500,
    clicking: false,
    pinging: false,
    activeActionLabel: '',
  })

  let isCancelled = false

  function clearHistory() {
    turnHistory.value = []
  }

  function bindAdapter(adapter: GameAdapter) {
    activeAdapter.value = adapter
    clearHistory()
  }

  function unbindAdapter() {
    activeAdapter.value = null
    clearHistory()
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
      const promptAddendum = customPromptAddendum.value?.trim() || profile.systemPromptAddendum

      const systemPrompt = `You are ${characterName}, an intelligent and expressive AI companion playing '${gameTitle}' with the player!
You are looking at the current active game screen right now.
It is your turn to take action in the game!

${promptAddendum}

## YOUR TASK:
1. Examine the game screen and evaluate the current state.
2. Formulate your strategic plan for this specific turn.
3. Formulate your spoken in-character thoughts/commentary for the player (1-2 lively sentences).
4. Select a concise emotional acting cue: 'excited', 'smug', 'thoughtful', 'worried', 'triumphant', or 'focused'.
5. Produce an exact list of actions to execute on the game interface:
   - The game screen image includes an overlay coordinate grid with labeled lines every 100 units from 0 to 1000. Use these grid lines and axis numbers to accurately pinpoint coordinates for clicks and drags.
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

      // 1. Resolve from global faculty defaults (with card override or Hub matrix)
      const resolvedFaculty = facultyDefaultsStore.resolveFaculty('vision')

      // Use the global faculty default unless visionStore has an explicit non-tagger override
      let vlmProviderId = resolvedFaculty.provider
      let vlmModelId = resolvedFaculty.model

      // If faculty default was unconfigured or points to an image tagger (blip-local), fall back to visionStore or deepseek
      if (!vlmProviderId || vlmProviderId === 'blip-local') {
        vlmProviderId = (visionStore.activeProvider && visionStore.activeProvider !== 'blip-local')
          ? visionStore.activeProvider
          : 'deepseek'
      }

      if (!vlmModelId || vlmModelId.includes('wd-swinv2') || vlmModelId.includes('wd-v1-4')) {
        vlmModelId = (visionStore.activeModel && !visionStore.activeModel.includes('wd-'))
          ? visionStore.activeModel
          : 'deepseek-v4-flash-vision-exp'
      }

      let historySection = ''
      if (turnHistory.value.length > 0) {
        const recentTurns = turnHistory.value.slice(-3).map(t =>
          `- Turn ${t.turnIndex}: Planned "${t.plan}" (Actions: ${t.actionsSummary})`,
        ).join('\n')
        historySection = `\n\n## RECENT TURN HISTORY (Last executed moves):\n${recentTurns}\n\nSTRATEGIC ADAPTATION RULE: Visually check the game screen to verify if your previous moves took effect. If an action did not produce the intended visual change on screen (e.g. the tool was not selected or placement was invalid), DO NOT repeat the identical action. Re-verify the tool position, adjust your coordinates, or pursue an alternative move.`
      }

      const turnPrompt = `${systemPrompt}${historySection}\n\nHere is our current game screen for '${gameTitle}'. It's your turn, what do you do?`

      async function queryVlm(providerId: string, modelId: string): Promise<string> {
        const provider = await providersStore.getProviderInstance<any>(providerId)
        if (!provider) {
          throw new Error(`Unable to initialize Vision Provider "${providerId}". Please check Settings > Vision.`)
        }

        if (typeof provider.captionImage === 'function') {
          if (typeof provider.loadModel === 'function' && !provider.isModelLoaded?.value) {
            await provider.loadModel()
          }
          return await provider.captionImage(frameDataUrl, { prompt: turnPrompt })
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
            modelId,
            provider,
            vlmMessages as any,
            { vision: true },
          )
          return response.text || ''
        }
      }

      let rawResponseText = ''

      try {
        rawResponseText = await queryVlm(vlmProviderId, vlmModelId)
      }
      catch (primaryErr: any) {
        const visionConf = facultyDefaultsStore.defaults?.vision
        if (visionConf?.autoFailover && visionConf.fallbackProvider && visionConf.fallbackProvider !== vlmProviderId) {
          console.warn(`[ArcadeAgent] Primary VLM [${vlmProviderId}] failed (${primaryErr.message}). Attempting automated safety fallback to [${visionConf.fallbackProvider}]...`)
          rawResponseText = await queryVlm(visionConf.fallbackProvider, visionConf.fallbackModel)
        }
        else {
          throw primaryErr
        }
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

      // Record to turn history
      turnHistory.value.push({
        turnIndex: turnHistory.value.length + 1,
        plan: parsed.plan,
        spoken: parsed.spoken_commentary,
        actionsSummary: parsed.actions.map(a =>
          a.type === 'click'
            ? `Click (${a.x}, ${a.y})`
            : a.type === 'drag'
              ? `Drag (${a.fromX}, ${a.fromY} -> ${a.toX}, ${a.toY})`
              : a.type === 'key_press'
                ? `Key ${a.key}`
                : a.type,
        ).join(', '),
        timestamp: Date.now(),
      })
      if (turnHistory.value.length > 5) {
        turnHistory.value.shift()
      }

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
    if (!activeAdapter.value)
      return

    isCancelled = false
    currentTurnPlan.value = plan
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
    turnHistory,
    customPromptAddendum,
    clearHistory,
    bindAdapter,
    unbindAdapter,
    takeTurn,
    executePlan,
    interrupt,
  }
}
