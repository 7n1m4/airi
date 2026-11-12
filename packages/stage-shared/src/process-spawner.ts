import { defineInvokeEventa } from '@moeru/eventa'

/**
 * Renderers send an argv array, never a shell string: the main process runs
 * argv[0] directly (no /bin/sh), so shell metacharacters cannot execute.
 */
export interface ElectronExecuteShellCommandPayload {
  argv: string[]
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
