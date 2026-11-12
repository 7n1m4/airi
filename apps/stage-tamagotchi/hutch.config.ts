export default {
  packageManager: 'pnpm',
  electrobun: {
    version: '2.0.6',
  },
  scripts: {
    'install': ['hutch', 'pm', 'exec', '--', 'pnpm', 'install'],
    'prepare': ['hutch', 'electrobun', 'prepare'],
    // The renderer bundle needs a large V8 heap: the old electron-vite build passed
    // `--max-old-space-size=12288`, and `hutch pm exec` otherwise spawns vite with Node's
    // ~2 GB default and OOMs. Raise the budget if the renderer grows rather than trimming it.
    'build:renderer': 'NODE_OPTIONS=--max-old-space-size=12288 hutch pm exec -- vite build',
    // The Electrobun build bundles the Bun main itself; only the renderer is a Vite build.
    'dev': 'hutch electrobun prepare && hutch run build:renderer && hutch electrobun dev --watch',
    // Vite serves the renderer on 5173 and the Bun main loads that URL instead of views://.
    // NOTICE: no `concurrently` dependency and Bun.$ has no `&`, so the pair is scripted.
    'dev:hmr': 'hutch electrobun prepare && hutch run hmr:vite:app',
    'hmr:vite:app': 'bun scripts/dev-hmr.ts',
    'hmr:vite': 'NODE_OPTIONS=--max-old-space-size=12288 hutch pm exec -- vite --port 5173',
    'hmr:app': 'hutch electrobun dev',
    'build': 'hutch electrobun prepare && hutch run build:renderer && hutch electrobun build --env=stable',
    'typecheck:node': 'hutch pm exec -- tsc --noEmit -p tsconfig.node.json --composite false',
    'typecheck:web': 'hutch pm exec -- node --stack-size=16384 --max-old-space-size=12288 ../../node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p tsconfig.web.json --composite false',
  },
}
