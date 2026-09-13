import type { ElectronExecuteShellCommandResult } from '@proj-airi/stage-shared'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { electronExecuteShellCommand } from '@proj-airi/stage-shared'
import { useLocalStorage } from '@vueuse/core'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'

export interface ProcessSpawnerLogEntry {
  action: 'spawn' | 'stop'
  success: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  error?: string
  timestamp: string
}

export interface UseProcessSpawnerOptions {
  storageKeyPrefix: string
  defaultSpawnCommand?: string
  defaultStopCommand?: string
  defaultAutoSpawn?: boolean
  spawnSuccessDelayMs?: number
  stopSuccessDelayMs?: number
  onSpawnSuccess?: (result: ElectronExecuteShellCommandResult) => Promise<void> | void
  onStopSuccess?: (result: ElectronExecuteShellCommandResult) => Promise<void> | void
}

export function useProcessSpawner(options: UseProcessSpawnerOptions) {
  const isElectron = computed(() => typeof window !== 'undefined' && Boolean((window as any)?.electron))
  const executeShellInvoke = isElectron.value ? useElectronEventaInvoke(electronExecuteShellCommand) : null

  const spawnCommand = useLocalStorage<string>(
    `${options.storageKeyPrefix}:spawn-command`,
    options.defaultSpawnCommand ?? '',
  )
  const stopCommand = useLocalStorage<string>(
    `${options.storageKeyPrefix}:stop-command`,
    options.defaultStopCommand ?? '',
  )
  const autoSpawnOnLaunch = useLocalStorage<boolean>(
    `${options.storageKeyPrefix}:auto-spawn`,
    options.defaultAutoSpawn ?? false,
  )

  const isExecuting = ref(false)
  const executingAction = ref<'spawn' | 'stop' | null>(null)
  const showLogs = ref(false)
  const copiedLogs = ref(false)
  const lastResult = ref<ProcessSpawnerLogEntry | null>(null)

  async function handleSpawn(): Promise<ElectronExecuteShellCommandResult | null> {
    const cmd = spawnCommand.value.trim()
    if (!cmd) {
      toast.error('Please configure a spawn command first.')
      return null
    }

    if (!isElectron.value || !executeShellInvoke) {
      if (typeof navigator !== 'undefined') {
        await navigator.clipboard.writeText(cmd)
      }
      toast.info('Command copied to clipboard. Direct process execution requires the desktop Electron app.')
      return null
    }

    isExecuting.value = true
    executingAction.value = 'spawn'
    try {
      const res = await executeShellInvoke({ command: cmd })
      lastResult.value = {
        action: 'spawn',
        success: res.success,
        exitCode: res.exitCode,
        stdout: res.stdout,
        stderr: res.stderr,
        error: res.error,
        timestamp: new Date().toLocaleTimeString(),
      }
      showLogs.value = true

      if (res.success) {
        toast.success('Spawn command executed successfully')
        if (options.spawnSuccessDelayMs) {
          await new Promise(r => setTimeout(r, options.spawnSuccessDelayMs))
        }
        if (options.onSpawnSuccess) {
          await options.onSpawnSuccess(res)
        }
      }
      else {
        toast.error(`Spawn failed (Exit ${res.exitCode ?? '!'}): ${res.error || res.stderr.slice(0, 120) || 'Unknown error'}`)
      }
      return res
    }
    catch (err: any) {
      lastResult.value = {
        action: 'spawn',
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: err.message,
        error: err.message,
        timestamp: new Date().toLocaleTimeString(),
      }
      showLogs.value = true
      toast.error(`Process spawner error: ${err.message}`)
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: err.message,
        error: err.message,
      }
    }
    finally {
      isExecuting.value = false
      executingAction.value = null
    }
  }

  async function handleStop(): Promise<ElectronExecuteShellCommandResult | null> {
    const cmd = stopCommand.value.trim()
    if (!cmd) {
      toast.error('Please configure a stop command first.')
      return null
    }

    if (!isElectron.value || !executeShellInvoke) {
      if (typeof navigator !== 'undefined') {
        await navigator.clipboard.writeText(cmd)
      }
      toast.info('Command copied to clipboard. Direct process execution requires the desktop Electron app.')
      return null
    }

    isExecuting.value = true
    executingAction.value = 'stop'
    try {
      const res = await executeShellInvoke({ command: cmd })
      lastResult.value = {
        action: 'stop',
        success: res.success,
        exitCode: res.exitCode,
        stdout: res.stdout,
        stderr: res.stderr,
        error: res.error,
        timestamp: new Date().toLocaleTimeString(),
      }
      showLogs.value = true

      if (res.success) {
        toast.success('Stop command executed successfully')
        if (options.stopSuccessDelayMs) {
          await new Promise(r => setTimeout(r, options.stopSuccessDelayMs))
        }
        if (options.onStopSuccess) {
          await options.onStopSuccess(res)
        }
      }
      else {
        toast.error(`Stop failed (Exit ${res.exitCode ?? '!'}): ${res.error || res.stderr.slice(0, 120) || 'Unknown error'}`)
      }
      return res
    }
    catch (err: any) {
      lastResult.value = {
        action: 'stop',
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: err.message,
        error: err.message,
        timestamp: new Date().toLocaleTimeString(),
      }
      showLogs.value = true
      toast.error(`Process stopper error: ${err.message}`)
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: err.message,
        error: err.message,
      }
    }
    finally {
      isExecuting.value = false
      executingAction.value = null
    }
  }

  function copyLogs() {
    if (!lastResult.value || typeof navigator === 'undefined')
      return
    const text = [
      `=== Action: ${lastResult.value.action.toUpperCase()} (${lastResult.value.timestamp}) ===`,
      `Exit Code: ${lastResult.value.exitCode ?? 'N/A'}`,
      lastResult.value.stdout ? `\n--- STDOUT ---\n${lastResult.value.stdout}` : '',
      lastResult.value.stderr ? `\n--- STDERR ---\n${lastResult.value.stderr}` : '',
      lastResult.value.error ? `\n--- ERROR ---\n${lastResult.value.error}` : '',
    ].filter(Boolean).join('\n')

    navigator.clipboard.writeText(text)
    copiedLogs.value = true
    setTimeout(() => {
      copiedLogs.value = false
    }, 2000)
  }

  return {
    isElectron,
    spawnCommand,
    stopCommand,
    autoSpawnOnLaunch,
    isExecuting,
    executingAction,
    showLogs,
    copiedLogs,
    lastResult,
    handleSpawn,
    handleStop,
    copyLogs,
  }
}

export type ProcessSpawnerInstance = ReturnType<typeof useProcessSpawner>
