import { defineInvokeEventa } from '@moeru/eventa'

export interface ElectronExecuteShellCommandPayload {
  command: string
  cwd?: string
  timeoutMs?: number
  env?: Record<string, string>
}

export interface ElectronExecuteShellCommandResult {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  error?: string
}

export const electronExecuteShellCommand = defineInvokeEventa<
  ElectronExecuteShellCommandResult,
  ElectronExecuteShellCommandPayload
>('eventa:invoke:electron:execute-shell-command')
