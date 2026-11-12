import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { ElectronExecuteShellCommandResult } from '@proj-airi/stage-shared'
import type { BrowserWindow } from 'electron'

import process from 'node:process'

import { execFile } from 'node:child_process'
import { basename } from 'node:path'

import { useLogg } from '@guiiai/logg'
import { defineInvokeHandler } from '@moeru/eventa'
import { electronExecuteShellCommand } from '@proj-airi/stage-shared'

// Env from the renderer sits on top of process.env, minus the keys that would
// let a payload rewrite the interpreter environment (PATH/loader/preload).
const ENV_DENYLIST: Record<string, true> = {
  PATH: true,
  HOME: true,
  LD_PRELOAD: true,
  LD_LIBRARY_PATH: true,
  NODE_OPTIONS: true,
  PYTHONPATH: true,
  PYTHONHOME: true,
  SHELL: true,
  BASH_ENV: true,
  ENV: true,
  ZDOTDIR: true,
  IFS: true,
}

// Executables the two settings pages need to boot and stop their local server.
// The command string stays user-editable, so this stops accidental shell payloads
// and stray binaries, not a determined user: `python3 -c ...` can still run code.
// shortcut: basename allowlist, not a sandbox; upgrade to a per-feature signed
// capability (or drop the user-editable command) if untrusted input reaches here.
const ALLOWED_COMMANDS: Record<string, true> = {
  'python': true,
  'python3': true,
  'py': true,
  'npx': true,
  'npm': true,
  'pnpm': true,
  'node': true,
  'bun': true,
  'uv': true,
  'uvx': true,
  'killall': true,
  'pkill': true,
  'airi-audio-server': true,
}

function getAugmentedEnv(customEnv?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }

  for (const [key, value] of Object.entries(customEnv ?? {})) {
    if (!ENV_DENYLIST[key])
      env[key] = value
  }

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
    const argv = (payload?.argv ?? []).filter(arg => typeof arg === 'string' && arg.length > 0)
    if (argv.length === 0) {
      return {
        success: false,
        stdout: '',
        stderr: 'No argv provided to execute',
        exitCode: 1,
        error: 'argv cannot be empty',
      }
    }

    const command = argv[0]
    const args = argv.slice(1)
    if (!ALLOWED_COMMANDS[basename(command)]) {
      const error = `Executable not allowed: ${command}`
      log.withFields({ command, argv }).warn(error)
      return { success: false, stdout: '', stderr: error, exitCode: 1, error }
    }

    const timeoutMs = payload.timeoutMs ?? 30_000
    const cwd = payload.cwd || undefined
    const env = getAugmentedEnv(payload.env)

    log.withFields({ command, args, timeoutMs, cwd }).log('Executing command')

    const { promise, resolve } = Promise.withResolvers<ElectronExecuteShellCommandResult>()

    execFile(
      command,
      args,
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
          log.withFields({ command, error: error.message, exitCode: error.code }).warn('Command execution finished with error')
          resolve({
            success: false,
            stdout: stdoutStr,
            stderr: stderrStr,
            exitCode: typeof error.code === 'number' ? error.code : 1,
            error: error.message,
          })
        }
        else {
          log.withFields({ command }).log('Command executed successfully')
          resolve({
            success: true,
            stdout: stdoutStr,
            stderr: stderrStr,
            exitCode: 0,
          })
        }
      },
    )

    return promise
  })
}
