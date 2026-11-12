/**
 * Boots the real, built Electrobun (CEF) app and asserts that the main window
 * actually renders content — not just that the process starts.
 *
 * This exists because Linux desktop breakage (frameless/transparent window
 * config, CEF flag plumbing in `electrobun.config.ts`, GPU init under a
 * headless display) has historically only surfaced when a contributor happened
 * to run the app on their own Linux desktop. CI only compiled the app; nothing
 * launched it. Run this under `xvfb-run` (X11) or weston (Wayland) in CI so it
 * exercises the display backend most Linux users hit.
 *
 * The bar is deliberately low and cheap to keep green: did a window appear and
 * did the renderer mount real DOM. It also confirms the window is *visible*,
 * not only that its renderer mounted — a hidden window still exposes a CDP
 * target and would otherwise pass the DOM check alone.
 */

import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { WriteStream } from 'node:fs'

import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { access, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { arch, platform, release } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { env, exit, kill as killProcess, version as nodeVersion } from 'node:process'
import { fileURLToPath } from 'node:url'

// NOTICE: do not import the stage-shared barrel here. It re-exports
// environment.ts, which reads `import.meta.env` at module scope. tsx runs
// this script outside Vite, so `import.meta.env` is undefined and the
// import crashes before the smoke starts (see PR #2519 CI failure). Use
// @moeru/std directly instead.
import { errorMessageFrom } from '@moeru/std'

import { CdpClient, fetchJson, findAvailablePort, findDebugTarget, isRecord, sleep, waitFor, waitForRemoteDebug } from './lib/remote-debug'

function errorMessageFromValue(error: unknown): string {
  return errorMessageFrom(error) ?? String(error)
}

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoDir = resolve(packageDir, '../..')
const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
// CI sets SMOKE_REPORT_DIR to a non-hidden path so actions/upload-artifact
// picks it up; `.temp/` is skipped by upload-artifact's hidden-file filter,
// which is why earlier failing runs uploaded nothing to diagnose.
const reportDir = env.SMOKE_REPORT_DIR?.trim()
  ? resolve(env.SMOKE_REPORT_DIR.trim())
  : resolve(repoDir, '.temp', `linux-window-render-smoke-${runId}`)
const screenshotPath = resolve(reportDir, 'main-window.png')
const stageLogPath = resolve(reportDir, 'stage.log')
const reportPath = resolve(reportDir, 'report.json')

/**
 * Display server the caller expects the app to run on (`x11` or `wayland`).
 * CEF picks its own backend (Electrobun's Linux defaults pin `ozone-platform=x11`
 * plus `use-x11`, so a Wayland session only reaches CEF through XWayland when
 * `DISPLAY` is set). When this is set, the smoke fails unless the session the
 * app was launched in matches, so the Wayland job cannot silently pass through
 * XWayland and the X11 job cannot drift.
 */
const expectedSessionType = env.SMOKE_EXPECT_SESSION_TYPE?.trim() || undefined

/** Prebuilt app bundle to launch instead of building one (e.g. `build/dev-linux-x64/AIRI-dev`). */
const appDirOverride = env.SMOKE_APP_DIR?.trim() || undefined

/**
 * Time budget for the renderer to mount `#app` and become visible after its
 * CDP target appears. Vue mounts asynchronously and cold CEF init under
 * Xvfb/Weston is slow on shared runners, so this polls instead of sleeping
 * for a fixed interval.
 */
const renderCheckTimeoutMs = 60_000
const renderCheckIntervalMs = 500

/** Hutch's own build script (`hutch.config.ts` → `build`), in order. */
const buildSteps: { label: string, command: string, args: string[], env?: Record<string, string> }[] = [
  { label: 'electrobun prepare', command: 'hutch', args: ['electrobun', 'prepare'] },
  // The renderer bundle needs a large V8 heap: Vite OOMs at Node's ~2 GB default.
  {
    label: 'vite build',
    command: 'hutch',
    args: ['pm', 'exec', '--', 'vite', 'build'],
    env: { NODE_OPTIONS: '--max-old-space-size=12288' },
  },
  { label: 'electrobun build', command: 'hutch', args: ['electrobun', 'build', '--env=stable'] },
]

/**
 * Resolves the `hutch` launcher and the dir to prepend to PATH so nested
 * `hutch` invocations resolve too. CI installs the `electrobun`
 * devDependency (whose bin forwards to a cached Hutch) but Hutch itself lives
 * in `~/.hutch/bin`, so PATH alone is not enough.
 */
async function resolveHutch(): Promise<{ command: string, pathPrepend: string }> {
  const home = env.HOME?.trim() || env.USERPROFILE?.trim()
  const bundled = home ? join(home, '.hutch', 'bin', 'hutch') : undefined
  if (bundled) {
    try {
      await access(bundled)
      return { command: bundled, pathPrepend: join(home, '.hutch', 'bin') }
    }
    catch {}
  }
  return { command: env.HUTCH?.trim() || 'hutch', pathPrepend: join(home ?? '.', '.hutch', 'bin') }
}

/** Hutch's per-target output dir: `build/<env>-<platform>-<arch>/<Name>/`. */
async function findBuiltAppDirs(): Promise<string[]> {
  const buildRoot = resolve(packageDir, 'build')
  let targets: string[]
  try {
    targets = await readdir(buildRoot)
  }
  catch {
    return []
  }

  const found: string[] = []
  for (const target of targets) {
    if (!/-linux-(x64|arm64)$/.test(target))
      continue
    const appRoot = join(buildRoot, target)
    let entries: string[]
    try {
      entries = await readdir(appRoot)
    }
    catch {
      continue
    }
    for (const entry of entries) {
      const candidate = join(appRoot, entry)
      if (await isLaunchableAppDir(candidate))
        found.push(candidate)
    }
  }
  return found
}

/** A launchable bundle is a dir whose `bin/launcher` sits next to CEF's `libcef.so`. */
async function isLaunchableAppDir(candidate: string): Promise<boolean> {
  for (const relative of ['bin/launcher', 'bin/libcef.so', 'bin/cef/libcef.so']) {
    try {
      await access(join(candidate, relative))
    }
    catch {
      return false
    }
  }
  return true
}

/**
 * `hutch electrobun build --env=stable` ships the runnable tree as a
 * `.tar.zst` under `artifacts/` (the `build/` copy only holds the installer
 * stub), so unpack it into the report dir and launch from there.
 */
async function extractPackagedApp(): Promise<string | undefined> {
  const artifactRoot = resolve(packageDir, 'artifacts')
  let entries: string[]
  try {
    entries = await readdir(artifactRoot)
  }
  catch {
    return undefined
  }

  const archive = entries.find(name => /^stable-linux-x64-.*\.tar\.zst$/.test(name))
  if (!archive)
    return undefined

  const destination = resolve(reportDir, 'app')
  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true })
  const extracted = spawn('tar', ['--zstd', '-xf', join(artifactRoot, archive), '-C', destination], {
    cwd: repoDir,
    stdio: 'pipe',
  })
  const { promise, resolve: resolveExit } = Promise.withResolvers<string>()
  let text = ''
  extracted.stdout.on('data', chunk => (text = (text + String(chunk)).slice(-2000)))
  extracted.stderr.on('data', chunk => (text = (text + String(chunk)).slice(-2000)))
  extracted.once('exit', () => resolveExit(text))
  const tail = await promise
  if (extracted.exitCode !== 0)
    throw new Error(`APP_START_FAILED: could not unpack ${archive}: ${tail}`)

  for (const entry of await readdir(destination)) {
    const candidate = join(destination, entry)
    if (await isLaunchableAppDir(candidate))
      return candidate
  }
  return undefined
}

/**
 * Resolves the app bundle to launch: an explicit override wins, then an
 * already-built tree, then a Hutch build (followed by unpacking the packaged
 * archive). Throws with the build command when nothing runnable is found.
 */
async function ensureAppDir(onStep: (label: string) => void): Promise<string> {
  if (appDirOverride) {
    if (!await isLaunchableAppDir(appDirOverride))
      throw new Error(`APP_START_FAILED: SMOKE_APP_DIR is not a launchable bundle (needs bin/launcher and bin/cef/libcef.so): ${appDirOverride}`)
    return appDirOverride
  }

  const existing = await findBuiltAppDirs()
  if (existing.length > 0)
    return existing[0]

  const { command: hutchCommand, pathPrepend } = await resolveHutch()
  const path = env.PATH ? `${pathPrepend}:${env.PATH}` : pathPrepend
  for (const step of buildSteps) {
    onStep(step.label)
    const command = step.command === 'hutch' ? hutchCommand : step.command
    const child = spawn(command, step.args, {
      cwd: packageDir,
      env: { ...env, PATH: path, ...step.env },
      stdio: 'pipe',
    })
    const { promise, resolve: resolveExit, reject: rejectExit } = Promise.withResolvers<string>()
    let text = ''
    child.stdout.on('data', chunk => (text = (text + String(chunk)).slice(-4000)))
    child.stderr.on('data', chunk => (text = (text + String(chunk)).slice(-4000)))
    child.once('exit', (code, signal) => {
      if (code === 0)
        resolveExit(text)
      else
        rejectExit(new Error(`APP_START_FAILED: build step "${step.label}" exited with code=${String(code)} signal=${String(signal)}\n${text}`))
    })
    console.info(`[build] ${step.label} ok\n${await promise}`)
  }

  const built = await findBuiltAppDirs()
  if (built.length > 0)
    return built[0]

  const unpacked = await extractPackagedApp()
  if (unpacked)
    return unpacked

  throw new Error([
    'APP_START_FAILED: Hutch build finished but no launchable bundle was found.',
    `Looked for bin/launcher + bin/cef/libcef.so under ${resolve(packageDir, 'build')}/<env>-linux-<arch>/ and ${resolve(packageDir, 'artifacts')}.`,
    `Build manually with: cd apps/stage-tamagotchi && ${buildSteps.map(step => [step.command, ...step.args].join(' ')).join(' && ')}`,
  ].join(' '))
}

/** Owns the spawned launcher plus the process group it leads, so cleanup can signal the whole tree. */
interface StageProcess {
  child: ChildProcessWithoutNullStreams
  /** `child.pid` is the group leader; kept separately so the narrowed value survives into cleanup. */
  processGroupId?: number
}

/**
 * Starts the packaged app. Keeps the run hermetic by pointing `HOME` and the
 * XDG data/state/cache/config roots at the per-run report dir: CEF derives its
 * `root_cache_path` from `$HOME/.cache/<identifier>/<channel>/CEF`
 * (nativeWrapper.cpp) and Electrobun's `appDataRoot()` from
 * `$XDG_DATA_HOME`/`HOME`, and Electrobun exposes no `--user-data-dir`
 * equivalent, so redirecting the roots is the only way to keep state from
 * leaking between runs.
 *
 * `XDG_RUNTIME_DIR` is deliberately inherited: that is where the Wayland
 * compositor's socket lives, so overriding it would break the Wayland job.
 */
function startStage(appDir: string, debugPort: number): StageProcess {
  const child = spawn(join(appDir, 'bin', 'launcher'), [], {
    cwd: appDir,
    detached: true,
    env: {
      ...env,
      // Electrobun reads the CEF debug port from `chromiumFlags['remote-debugging-port']`
      // baked into Resources/build.json at build time; this env var overrides it per launch
      // (see chromium_flags.h resolveRemoteDebugging), which is what lets each run use a
      // freshly allocated free port instead of scanning 9222-9232.
      ELECTROBUN_CEF_REMOTE_DEBUGGING_PORT: String(debugPort),
      HOME: reportDir,
      XDG_DATA_HOME: join(reportDir, 'xdg-data'),
      XDG_STATE_HOME: join(reportDir, 'xdg-state'),
      XDG_CACHE_HOME: join(reportDir, 'xdg-cache'),
      XDG_CONFIG_HOME: join(reportDir, 'xdg-config'),
      // Inherited (not overridden): the Wayland job's compositor socket lives here.
      ...(env.XDG_RUNTIME_DIR ? {} : { XDG_RUNTIME_DIR: join(reportDir, 'xdg-runtime') }),
    },
    stdio: 'pipe',
  })
  return { child, processGroupId: child.pid }
}

function isProcessGroupAlive(pid: number): boolean {
  try {
    killProcess(-pid, 0)
    return true
  }
  catch {
    return false
  }
}

async function stopStage(stage: StageProcess | undefined) {
  if (!stage)
    return

  const { child, processGroupId } = stage
  // NOTICE:
  // The launcher re-execs itself to set LD_PRELOAD and CEF spawns helpers, all
  // inside this process group. Check the group, not the wrapper's exit code,
  // so no CEF child outlives the smoke.
  if (child.exitCode !== null && (processGroupId === undefined || !isProcessGroupAlive(processGroupId)))
    return

  const signalStageProcessGroup = (signal: NodeJS.Signals) => {
    try {
      if (processGroupId !== undefined) {
        killProcess(-processGroupId, signal)
        return
      }
    }
    catch {
      // Fall back to the direct process handle if process-group signalling
      // is unavailable on this platform.
    }

    child.kill(signal)
  }

  signalStageProcessGroup('SIGTERM')
  if (processGroupId === undefined) {
    const { promise, resolve } = Promise.withResolvers<void>()
    child.once('exit', () => resolve())
    await Promise.race([promise, sleep(5_000).then(() => signalStageProcessGroup('SIGKILL'))])
    return
  }
  await waitFor('stage process group exit', () => isProcessGroupAlive(processGroupId) ? undefined : true, 5_000, 100)
    .catch(() => signalStageProcessGroup('SIGKILL'))
}

/**
 * Streams the full stage stdout/stderr into `stage.log` (uploaded as a CI
 * artifact) and rejects if the stage exits before the smoke finishes. Only
 * the tail is inlined into the error so the job log stays readable.
 */
function rejectWhenStageExits(stage: StageProcess, log: WriteStream): Promise<never> {
  const { promise, reject } = Promise.withResolvers<never>()
  let tail = ''
  const collect = (chunk: Buffer) => {
    log.write(chunk)
    tail = (tail + chunk.toString('utf-8')).slice(-4000)
  }
  stage.child.stdout.on('data', collect)
  stage.child.stderr.on('data', collect)
  stage.child.once('exit', (code, signal) => {
    reject(new Error(`stage-tamagotchi exited with code=${String(code)} signal=${String(signal)}\n${tail}`))
  })
  // Callers race this against each phase; a late exit during cleanup must
  // not surface as an unhandled rejection.
  promise.catch(() => {})
  return promise
}

async function findMainWindowTarget(debugPort: number) {
  // The main window is the only eagerly-created window loaded at the renderer
  // root (`views://main/index.html`, optionally with the hash-router's `#/`);
  // every other window (settings, chat, onboarding, ...) loads a nested route.
  return await findDebugTarget(
    debugPort,
    'main window debug target',
    target => target.type === 'page' && /(index\.html)?#?\/?$/.test(target.url),
  )
}

interface RenderCheck {
  readyState: DocumentReadyState
  appRootChildCount: number
  bodyTextLength: number
  visibilityState: DocumentVisibilityState
  innerWidth: number
  innerHeight: number
  devicePixelRatio: number
}

const renderCheckExpression = `(() => {
  const root = document.querySelector('#app')
  return {
    readyState: document.readyState,
    appRootChildCount: root ? root.children.length : -1,
    bodyTextLength: document.body ? document.body.innerText.length : 0,
    visibilityState: document.visibilityState,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  }
})()`

/**
 * Returns why the window does not count as rendered yet, or undefined once
 * it does. Used both as the polling predicate and as the final failure
 * message so the reported reason is the last one actually observed.
 */
function renderCheckFailure(check: RenderCheck): string | undefined {
  if (check.readyState !== 'complete')
    return `document.readyState=${check.readyState}`
  if (check.appRootChildCount <= 0)
    return `#app root has no children (appRootChildCount=${check.appRootChildCount}). The window likely came up blank.`
  // A hidden window (the native window never shown) still passes the DOM
  // checks over CDP, but Chromium reports it as visibilityState='hidden'.
  if (check.visibilityState !== 'visible')
    return `document.visibilityState=${check.visibilityState}; the window is not visible`
  if (check.innerWidth <= 0 || check.innerHeight <= 0)
    return `window has no area (${check.innerWidth}x${check.innerHeight})`
  return undefined
}

interface RendererDiagnostic {
  kind: 'console' | 'exception'
  level: string
  text: string
}

/**
 * Records renderer console warnings/errors and uncaught exceptions into the
 * report. They do not fail the smoke on their own (a missing provider key
 * logs errors on a fresh profile), but they are usually the first clue when
 * the window does come up blank. `Runtime.enable` replays messages logged
 * before the client attached, so early boot errors are captured too.
 */
async function collectRendererDiagnostics(client: CdpClient, diagnostics: RendererDiagnostic[]) {
  client.on('Runtime.consoleAPICalled', (params) => {
    const level = typeof params.type === 'string' ? params.type : 'log'
    if (level !== 'error' && level !== 'warning' && level !== 'assert')
      return
    const args = Array.isArray(params.args) ? params.args : []
    const text = args
      .map(arg => isRecord(arg) ? String(arg.value ?? arg.description ?? '') : '')
      .join(' ')
    diagnostics.push({ kind: 'console', level, text })
  })
  client.on('Runtime.exceptionThrown', (params) => {
    const details = isRecord(params.exceptionDetails) ? params.exceptionDetails : {}
    const exception = isRecord(details.exception) ? details.exception : {}
    const text = String(exception.description ?? details.text ?? 'unknown exception')
    diagnostics.push({ kind: 'exception', level: 'error', text })
  })
  await client.send('Runtime.enable')
}

async function readBrowserVersion(debugPort: number): Promise<Record<string, unknown> | undefined> {
  try {
    return await fetchJson<Record<string, unknown>>(`http://127.0.0.1:${debugPort}/json/version`)
  }
  catch {
    return undefined
  }
}

/**
 * The display server the app actually ran on, read from the session the smoke
 * itself was launched in (CEF picks its GDK backend from these, not from a
 * Chromium switch this script could set).
 */
function describeSession() {
  const wayland = env.WAYLAND_DISPLAY?.trim() || undefined
  const x11 = env.DISPLAY?.trim() || undefined
  const declared = env.XDG_SESSION_TYPE?.trim() || undefined
  const actual = wayland ? 'wayland' : (x11 ? 'x11' : undefined)
  return { actual, declared, display: x11, waylandDisplay: wayland, xdgSessionType: declared }
}

/**
 * Runtime facts that decide which Linux code path ran. Recorded in every
 * report so a CI failure can be replayed locally with the same display
 * server, session type, and toolchain.
 */
function describeEnvironment(appDir: string, debugPort: number) {
  return {
    node: nodeVersion,
    platform: platform(),
    arch: arch(),
    kernel: release(),
    appDir,
    cefRemoteDebuggingPort: debugPort,
    session: describeSession(),
    expectedSessionType,
    lang: env.LANG,
    tz: env.TZ,
  }
}

async function main() {
  let stage: StageProcess | undefined
  let client: CdpClient | undefined
  let stageLog: WriteStream | undefined

  // Written on success and on failure; `phase` tells which step failed.
  const report: Record<string, unknown> = {
    ok: false,
    phase: 'prerequisites',
    reportDir,
  }
  const rendererDiagnostics: RendererDiagnostic[] = []
  report.rendererDiagnostics = rendererDiagnostics

  try {
    if (typeof WebSocket !== 'function') {
      throw new TypeError('APP_START_FAILED: WebSocket is unavailable in this Node runtime. Run through the package script or set NODE_OPTIONS=--experimental-websocket.')
    }

    await mkdir(reportDir, { recursive: true })
    stageLog = createWriteStream(stageLogPath)

    report.phase = 'build'
    const appDir = await ensureAppDir(label => (report.buildStep = label))
    report.appDir = appDir
    report.environment = describeEnvironment(appDir, 0)

    report.phase = 'launch'
    const debugPort = await findAvailablePort()
    report.environment = describeEnvironment(appDir, debugPort)
    stage = startStage(appDir, debugPort)
    const stageExited = rejectWhenStageExits(stage, stageLog)

    await Promise.race([waitForRemoteDebug(debugPort), stageExited]).catch((error) => {
      throw new Error(`APP_START_FAILED: ${errorMessageFromValue(error)}`)
    })
    report.browserVersion = await readBrowserVersion(debugPort)

    report.phase = 'find-main-window'
    const mainWindowTarget = await Promise.race([findMainWindowTarget(debugPort), stageExited]).catch((error) => {
      throw new Error(`APP_START_FAILED: ${errorMessageFromValue(error)}`)
    })
    if (!mainWindowTarget.webSocketDebuggerUrl)
      throw new Error('APP_START_FAILED: main window target missing webSocketDebuggerUrl')
    report.mainWindowUrl = mainWindowTarget.url

    client = await CdpClient.connect(mainWindowTarget.webSocketDebuggerUrl)
    await collectRendererDiagnostics(client, rendererDiagnostics)

    report.phase = 'render-check'
    let lastCheck: RenderCheck | undefined
    const renderedClient = client
    const check = await Promise.race([
      waitFor('main window render', async () => {
        lastCheck = await renderedClient.evaluate<RenderCheck>(renderCheckExpression)
        return renderCheckFailure(lastCheck) === undefined ? lastCheck : undefined
      }, renderCheckTimeoutMs, renderCheckIntervalMs),
      stageExited,
    ]).catch((error) => {
      // Report both the wait/exit error and the last condition that was
      // actually observed, so a timeout says *what* never became true.
      report.check = lastCheck
      const lastFailure = lastCheck ? renderCheckFailure(lastCheck) : 'renderer never answered Runtime.evaluate'
      throw new Error(`RENDER_CHECK_FAILED: ${lastFailure} (${errorMessageFromValue(error)})`)
    })
    report.check = check

    report.phase = 'session-type'
    // CEF has no Ozone switch of its own to assert on: Electrobun's Linux
    // defaults pin `ozone-platform=x11`/`use-x11`, so a Wayland session only
    // reaches CEF through XWayland. Assert on the session that is actually
    // running instead, which is what decides that code path.
    if (expectedSessionType) {
      const session = describeSession()
      if (session.actual !== expectedSessionType)
        throw new Error(`SESSION_TYPE_MISMATCH: expected ${expectedSessionType}, app ran in ${session.actual ?? 'no display'}`)
    }

    report.phase = 'screenshot'
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png' })
    const screenshotData = isRecord(screenshot.result) ? screenshot.result.data : undefined
    if (typeof screenshotData !== 'string' || screenshotData.length === 0)
      throw new Error('RENDER_CHECK_FAILED: Page.captureScreenshot returned no image data')
    await writeFile(screenshotPath, Buffer.from(screenshotData, 'base64'))
    report.screenshotPath = screenshotPath

    report.phase = 'done'
    report.ok = true
  }
  catch (error) {
    report.error = errorMessageFromValue(error)
    throw error
  }
  finally {
    client?.close()
    await stopStage(stage)
    stageLog?.end()
    // Create the dir in case prerequisites failed before it existed. A
    // failed report write must not mask the smoke's own error.
    await mkdir(reportDir, { recursive: true })
      .then(() => writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`))
      .catch(() => {})
    console.info(JSON.stringify(report, null, 2))
  }
}

// NOTICE:
// No `if (import.meta.main)` guard. It is undefined on Node < 24.2, so the
// guarded smoke exited 0 without launching anything. Nothing imports this
// file, so the guard protected nothing.
// Removal condition: none; keep this file a pure entrypoint.
main().catch((error) => {
  console.error(errorMessageFromValue(error))
  exit(1)
})
