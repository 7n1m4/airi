import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow } from 'electron'

import { exec } from 'node:child_process'

import { useLogg } from '@guiiai/logg'
import { defineInvokeHandler } from '@moeru/eventa'
import { electronExecuteShellCommand } from '@proj-airi/stage-shared'

function getAugmentedEnv(customEnv?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...customEnv }

  if (process.platform === 'darwin' || process.platform === 'linux') {
    const defaultPaths = [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
    ]

    const home = process.env.HOME
    if (home) {
      defaultPaths.unshift(
        `${home}/.local/bin`,
        `${home}/bin`,
        `${home}/.cargo/bin`,
      )
    }

    const currentPath = env.PATH || ''
    const existing = new Set(currentPath.split(':').filter(Boolean))
    const extra = defaultPaths.filter(p => !existing.has(p))

    if (extra.length > 0) {
      env.PATH = `${currentPath}:${extra.join(':')}`
    }
  }

  return env
}

export function createProcessSpawnerService(params: {
  context: ReturnType<typeof createContext>['context']
  window?: BrowserWindow
}) {
  const log = useLogg('main/process-spawner').useGlobalConfig()

  defineInvokeHandler(params.context, electronExecuteShellCommand, async (payload) => {
    const command = payload?.command?.trim()
    if (!command) {
      return {
        success: false,
        stdout: '',
        stderr: 'No command provided to execute',
        exitCode: 1,
        error: 'Command cannot be empty',
      }
    }

    const timeoutMs = payload.timeoutMs ?? 30_000
    const cwd = payload.cwd || undefined
    const env = getAugmentedEnv(payload.env)

    log.withFields({ command, timeoutMs, cwd }).log('Executing shell command')

    return new Promise((resolve) => {
      exec(
        command,
        {
          cwd,
          env,
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          const stdoutStr = stdout ? stdout.toString() : ''
          const stderrStr = stderr ? stderr.toString() : ''

          if (error) {
            log.withFields({ command, error: error.message, exitCode: error.code }).warn('Shell command execution finished with error')
            resolve({
              success: false,
              stdout: stdoutStr,
              stderr: stderrStr,
              exitCode: typeof error.code === 'number' ? error.code : 1,
              error: error.message,
            })
          }
          else {
            log.withFields({ command }).log('Shell command executed successfully')
            resolve({
              success: true,
              stdout: stdoutStr,
              stderr: stderrStr,
              exitCode: 0,
            })
          }
        },
      )
    })
  })
}
