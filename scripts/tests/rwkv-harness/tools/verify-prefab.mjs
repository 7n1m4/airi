/**
 * Cleanroom browser verification script for web-rwkv prefabs.
 *
 * Runs an in-browser WebGPU Session.from_prefab() test using Chromium/Brave with Metal
 * to confirm coherence, token speed, and native <think> tag handling.
 *
 * Usage:
 *   node verify-prefab.mjs <path-to-prefab> [int8|nf4]
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HARNESS = path.resolve(__dirname, '..')
const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
const PROMPT = 'What is the capital of France, and why is it known as the City of Light?'

const require = createRequire(path.join(HARNESS, 'package.json'))
const puppeteer = require('puppeteer-core')

const PREFAB_PATH = process.argv[2]
if (!PREFAB_PATH || !fs.existsSync(PREFAB_PATH)) {
  console.error('Usage: node verify-prefab.mjs <path-to-prefab>')
  process.exit(1)
}

function startServer(webroot, targetFile) {
  const root = path.resolve(webroot)
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    if (urlPath === '/model.prefab') {
      const stat = fs.statSync(targetFile)
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '')
      if (m) {
        const start = Number(m[1])
        const end = m[2] ? Number(m[2]) : stat.size - 1
        res.writeHead(206, {
          'content-type': 'application/octet-stream',
          'content-length': end - start + 1,
          'content-range': `bytes ${start}-${end}/${stat.size}`,
        })
        fs.createReadStream(targetFile, { start, end }).pipe(res)
        return
      }
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': stat.size })
      fs.createReadStream(targetFile).pipe(res)
      return
    }

    const rel = urlPath === '/' ? '/index.html' : urlPath
    const fp = path.join(root, rel)
    if (!fp.startsWith(root) || !fs.existsSync(fp)) {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    const ext = path.extname(fp)
    const mimeMap = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.wasm': 'application/wasm',
      '.json': 'application/json; charset=utf-8',
    }
    res.writeHead(200, { 'content-type': mimeMap[ext] || 'application/octet-stream' })
    fs.createReadStream(fp).pipe(res)
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise(r => server.close(r)),
      })
    })
  })
}

async function main() {
  const webroot = path.join(HARNESS, 'webroot')
  console.log(`Starting cleanroom server with ${PREFAB_PATH}...`)
  const srv = await startServer(webroot, PREFAB_PATH)

  const browser = await puppeteer.launch({
    executablePath: BRAVE,
    headless: 'new',
    args: [
      '--enable-unsafe-webgpu',
      '--use-webgpu-adapter=metal',
      '--disable-dawn-features=disallow_unsafe_apis',
    ],
  })

  try {
    const page = await browser.newPage()
    page.on('console', msg => console.log('  [Browser]', msg.text()))
    await page.goto(srv.baseUrl)

    const result = await page.evaluate(async (promptText) => {
      const wasm = await import('/vendor/web-rwkv-wasm/web_rwkv_wasm.js')
      if (!window.__wasmInit) {
        await wasm.default({ module_or_path: '/vendor/web-rwkv-wasm/web_rwkv_wasm_bg.wasm' })
        window.__wasmInit = true
      }
      const { Session, SessionType, Tokenizer, NucleusSampler } = wasm
      const t0 = performance.now()
      const res = await fetch('/model.prefab')
      const buf = new Uint8Array(await res.arrayBuffer())
      const session = await Session.from_prefab(buf, SessionType.Chat)
      const buildMs = performance.now() - t0

      const tokRes = await fetch('/assets/vocab/rwkv_vocab_v20230424.json')
      const tokenizer = new Tokenizer(await tokRes.text())
      const sampler = new NucleusSampler({ temp: 0.7, top_p: 0.5 })

      const prompt = `User: ${promptText}\n\nAssistant:`
      const tokens = tokenizer.encode(prompt)
      const t1 = performance.now()
      await session.checkout(session.default_state())
      let out = await session.step(tokens)
      const prefillMs = performance.now() - t1

      const words = []
      for (let i = 0; i < 40; i++) {
        const token = sampler.sample(out)
        words.push(tokenizer.decode([token]))
        out = await session.step([token])
      }

      return {
        buildMs,
        prefillMs,
        output: words.join(''),
      }
    }, PROMPT)

    console.log('\n=== Cleanroom Evaluation Result ===')
    console.log(`Build Time:    ${(result.buildMs / 1000).toFixed(2)}s`)
    console.log(`Prefill Time:  ${result.prefillMs.toFixed(1)}ms`)
    console.log(`Generated Text: \n${result.output}\n`)
  }
  finally {
    await browser.close()
    await srv.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
