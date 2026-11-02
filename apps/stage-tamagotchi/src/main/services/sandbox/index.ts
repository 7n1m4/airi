import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { SandboxCompileRequest, SandboxCompileResult } from '@proj-airi/stage-shared'

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

import { defineInvokeHandler } from '@moeru/eventa'
import { electronSandboxCompileTypeScript } from '@proj-airi/stage-shared'

const require = createRequire(import.meta.url)

let tscBinPath: string | null = null
try {
  const pkgPath = require.resolve('tsc-rs/package.json')
  tscBinPath = path.join(path.dirname(pkgPath), 'bin/tsc-rs')
}
catch (err) {
  console.warn('[Sandbox] Failed to resolve native tsc-rs binary path:', err)
}

export function createSandboxService(params: { context: ReturnType<typeof createContext>['context'] }) {
  defineInvokeHandler(params.context, electronSandboxCompileTypeScript, async (req: SandboxCompileRequest): Promise<SandboxCompileResult> => {
    // Validate request shape
    if (!req || typeof req !== 'object') {
      return { stdout: '', stderr: 'Invalid sandbox compile request\n', exitCode: 1, emittedFiles: {} }
    }
    if (!req.files || typeof req.files !== 'object' || Array.isArray(req.files)) {
      return { stdout: '', stderr: 'Invalid sandbox compile request: files must be an object\n', exitCode: 1, emittedFiles: {} }
    }
    for (const [k, v] of Object.entries(req.files)) {
      if (typeof k !== 'string' || typeof v !== 'string') {
        return { stdout: '', stderr: 'Invalid sandbox compile request: file keys and values must be strings\n', exitCode: 1, emittedFiles: {} }
      }
    }
    if (req.args !== undefined && !Array.isArray(req.args)) {
      return { stdout: '', stderr: 'Invalid sandbox compile request: args must be an array\n', exitCode: 1, emittedFiles: {} }
    }
    if (Array.isArray(req.args) && !req.args.every(a => typeof a === 'string')) {
      return { stdout: '', stderr: 'Invalid sandbox compile request: args must be strings\n', exitCode: 1, emittedFiles: {} }
    }

    if (!tscBinPath) {
      return {
        stdout: '',
        stderr: 'tsc-rs binary not available in host environment\n',
        exitCode: 1,
        emittedFiles: {},
      }
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'airi-tsc-'))
    try {
      // 1. Mirror virtual in-memory files into scratch directory (validated safe paths)
      for (const [relPath, content] of Object.entries(req.files)) {
        // Reject absolute paths or empty
        if (relPath === '' || path.isAbsolute(relPath)) {
          throw new Error(`Unsafe file path rejected: ${relPath}`)
        }
        const resolved = path.resolve(tempDir, relPath)
        const relative = path.relative(tempDir, resolved)
        if (relative.startsWith('..') || path.isAbsolute(relative) || relative === '') {
          throw new Error(`Path escapes scratch root rejected: ${relPath}`)
        }
        // Reject traversal segments
        if (relPath.split(/[\\/]/).includes('..')) {
          throw new Error(`Path traversal rejected: ${relPath}`)
        }
        await fs.mkdir(path.dirname(resolved), { recursive: true })
        await fs.writeFile(resolved, content, 'utf-8')
      }

      // 2. Inject ambient node types so node:fs and node:path compile without @types/node
      const ambientNodeDts = `
declare module "fs" {
  export function readFileSync(path: string, options?: any): string;
  export function writeFileSync(path: string, data: any, options?: any): void;
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string, options?: any): string[];
  export function statSync(path: string, options?: any): any;
  export const promises: {
    readFile(path: string, options?: any): Promise<string>;
    writeFile(path: string, data: any, options?: any): Promise<void>;
    readdir(path: string, options?: any): Promise<string[]>;
    stat(path: string, options?: any): Promise<any>;
  };
}
declare module "node:fs" { export * from "fs"; }
declare module "path" {
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
  export function dirname(p: string): string;
  export function basename(p: string, ext?: string): string;
  export function extname(p: string): string;
  export const posix: any;
}
declare module "node:path" { export * from "path"; }
declare module "mcp" {
  export function listTools(): Promise<any[]>;
  export function callTool(name: string, args?: Record<string, any>): Promise<any>;
  export function getRuntimeStatus(): Promise<any>;
}
declare module "node:mcp" { export * from "mcp"; }
`
      await fs.writeFile(path.join(tempDir, 'ambient-node.d.ts'), ambientNodeDts, 'utf-8')

      // 3. Parse and normalize compiler arguments
      const args = req.args || []
      const fileArgs: string[] = []
      const normalizedFlags: string[] = []
      let hasTarget = false
      let hasLib = false
      let hasModule = false

      for (let i = 0; i < args.length; i++) {
        const a = args[i]
        if (a === '--outDir') {
          const next = args[++i]
          if (next) {
            if (next === '/workspace' || next === '/workspace/' || next === '.') {
              normalizedFlags.push('--outDir', tempDir)
            }
            else if (next.startsWith('/workspace/')) {
              normalizedFlags.push('--outDir', path.join(tempDir, next.slice('/workspace/'.length)))
            }
            else {
              normalizedFlags.push('--outDir', next)
            }
          }
        }
        else if (a.startsWith('--outDir=')) {
          const val = a.slice('--outDir='.length)
          if (val === '/workspace' || val === '/workspace/' || val === '.') {
            normalizedFlags.push(`--outDir=${tempDir}`)
          }
          else if (val.startsWith('/workspace/')) {
            normalizedFlags.push(`--outDir=${path.join(tempDir, val.slice('/workspace/'.length))}`)
          }
          else {
            normalizedFlags.push(a)
          }
        }
        else if (a === '--target') {
          hasTarget = true
          const next = args[++i]
          if (next)
            normalizedFlags.push('--target', next.toLowerCase())
        }
        else if (a.startsWith('--target=')) {
          hasTarget = true
          normalizedFlags.push(`--target=${a.slice('--target='.length).toLowerCase()}`)
        }
        else if (a === '--lib') {
          hasLib = true
          const next = args[++i]
          if (next)
            normalizedFlags.push('--lib', next.toLowerCase())
        }
        else if (a.startsWith('--lib=')) {
          hasLib = true
          normalizedFlags.push(`--lib=${a.slice('--lib='.length).toLowerCase()}`)
        }
        else if (a === '--module') {
          hasModule = true
          const next = args[++i]
          if (next)
            normalizedFlags.push('--module', next.toLowerCase())
        }
        else if (a.startsWith('--module=')) {
          hasModule = true
          normalizedFlags.push(a)
        }
        else if (a === '--moduleResolution') {
          const next = args[++i]
          if (next)
            normalizedFlags.push('--moduleResolution', next.toLowerCase())
        }
        else if (a.startsWith('--moduleResolution=')) {
          normalizedFlags.push(a)
        }
        else if (a === '--jsx') {
          const next = args[++i]
          if (next)
            normalizedFlags.push('--jsx', next.toLowerCase())
        }
        else if (a.startsWith('--jsx=')) {
          normalizedFlags.push(a)
        }
        else if (a.startsWith('-')) {
          normalizedFlags.push(a)
        }
        else {
          let f = a
          if (f.startsWith('/workspace/'))
            f = f.slice('/workspace/'.length)
          else if (f.startsWith('/'))
            f = f.slice(1)
          fileArgs.push(f)
        }
      }

      let effectiveFiles = fileArgs
      if (effectiveFiles.length === 0) {
        effectiveFiles = Object.keys(req.files).filter(
          p => (p.endsWith('.ts') || p.endsWith('.tsx')) && !p.endsWith('.d.ts'),
        )
      }

      if (effectiveFiles.length === 0) {
        return {
          stdout: '',
          stderr: 'error TS18003: No inputs were found in /workspace\n',
          exitCode: 1,
          emittedFiles: {},
        }
      }

      // Purge stale compiled artifacts before compilation
      for (const ef of effectiveFiles) {
        const outBase = ef.replace(/\.tsx?$/, '')
        await fs.rm(path.join(tempDir, `${outBase}.js`), { force: true }).catch(() => {})
        await fs.rm(path.join(tempDir, `${outBase}.d.ts`), { force: true }).catch(() => {})
        await fs.rm(path.join(tempDir, `${outBase}.map`), { force: true }).catch(() => {})
      }

      const tscArgs = [...effectiveFiles, 'ambient-node.d.ts', '--ignoreConfig']
      if (!hasTarget)
        tscArgs.push('--target', 'es2022')
      if (!hasLib)
        tscArgs.push('--lib', 'es2022,dom')
      if (!hasModule)
        tscArgs.push('--module', 'es2022')
      tscArgs.push(...normalizedFlags)

      const res = spawnSync(tscBinPath, tscArgs, {
        cwd: tempDir,
        encoding: 'utf-8',
      })

      // 3. Collect emitted artifacts (.js, .d.ts, .map)
      const emittedFiles: Record<string, string> = {}
      async function collectEmitted(dir: string) {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            await collectEmitted(full)
          }
          else if (!entry.name.startsWith('ambient-node.') && (entry.name.endsWith('.js') || entry.name.endsWith('.d.ts') || entry.name.endsWith('.map'))) {
            const rel = path.relative(tempDir, full).split(path.sep).join('/')
            emittedFiles[rel] = await fs.readFile(full, 'utf-8')
          }
        }
      }
      await collectEmitted(tempDir)

      return {
        stdout: res.stdout || '',
        stderr: res.stderr || '',
        exitCode: res.status ?? 0,
        emittedFiles,
      }
    }
    catch (err: any) {
      return {
        stdout: '',
        stderr: `tsc: internal error: ${err.message}\n`,
        exitCode: 1,
        emittedFiles: {},
      }
    }
    finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  })
}
