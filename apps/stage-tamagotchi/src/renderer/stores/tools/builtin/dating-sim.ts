import type { Tool } from '@xsai/shared-chat'

import z from 'zod'

import { useDatingSimStore } from '@proj-airi/stage-ui/stores/dating-sim'
import { tool } from '@xsai/tool'

const updateVariablesParams = z.object({
  intimacyChange: z.number().describe('Change to Intimacy (-20 to +20)'),
  tensionChange: z.number().describe('Change to Tension (-20 to +20)'),
  actionPointsChange: z.number().describe('Change to ActionPoints (-5 to +5)'),
  mood: z.string().describe('The new mood of the character. Use one of the standard expressions: happy, sad, angry, surprised, neutral, think, cool.'),
}).strict()

export async function datingSimTools(): Promise<Tool[]> {
  const t = await tool({
    name: 'update_dating_sim_variables',
    description: 'Update the dating sim variables (Intimacy, Tension, ActionPoints) and the overall mood based on the user\'s action or response. Intimacy (0-100) measures how close you are. Tension (0-100) measures romantic or awkward tension. ActionPoints (0-10) measure remaining actions. Mood describes your character\'s current feeling in 1-2 words.',
    parameters: updateVariablesParams,
    execute: async (args: any) => {
      const store = useDatingSimStore()
      if (!store.enabled) {
        return 'Dating Sim mode is disabled. Ignoring update.'
      }
      store.setVariable('Intimacy', Math.max(0, Math.min(100, store.getVariable('Intimacy') + args.intimacyChange)))
      store.setVariable('Tension', Math.max(0, Math.min(100, store.getVariable('Tension') + args.tensionChange)))
      store.setVariable('ActionPoints', Math.max(0, Math.min(10, store.getVariable('ActionPoints') + args.actionPointsChange)))

      if (args.mood) {
        store.broadcastMood(args.mood)
      }

      // Generate the next set of choices in the background
      setTimeout(() => {
        store.generateLiveChoices()
      }, 1000)

      return `Updated variables: Intimacy=${store.getVariable('Intimacy')}, Tension=${store.getVariable('Tension')}, ActionPoints=${store.getVariable('ActionPoints')}.`
    },
  })

  return [t]
}
