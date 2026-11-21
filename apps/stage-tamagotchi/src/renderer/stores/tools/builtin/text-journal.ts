import type { Tool } from '@xsai/shared-chat'

import {
  createTextJournalTool,
  executeCreateTextJournalEntry,
  executeSearchTextJournalEntries,
  executeTextJournalAction,
  textJournalParams,
} from '@proj-anima/stage-ui/stores'

export type { TextJournalEvidenceItem } from '@proj-anima/stage-ui/stores'
export {
  createTextJournalTool,
  executeCreateTextJournalEntry,
  executeSearchTextJournalEntries,
  executeTextJournalAction,
  textJournalParams,
}

const tools: Promise<Tool>[] = [
  Promise.resolve(createTextJournalTool()),
]

export const textJournalTools = async () => Promise.all(tools)
