import process from 'node:process'

// Vite dev server + Electrobun dev shell: the renderer needs :5173 up before the Bun main
// loads it instead of views://. Bun.$ has no `&` and `concurrently` is not a dependency,
// so the two processes are paired here.
const vite = Bun.spawn(['hutch', 'pm', 'exec', '--', 'vite', '--port', '5173'], {
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
})

const app = Bun.spawn(['hutch', 'electrobun', 'dev'], {
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
})

let shuttingDown = false
async function shutdown(code: number) {
  if (shuttingDown)
    return
  shuttingDown = true
  vite.kill()
  await Promise.all([vite.exited, app.exited])
  process.exit(code)
}

app.exited.then(shutdown)
vite.exited.then(code => shutdown(code === 0 ? 1 : code))

for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => void shutdown(0))
