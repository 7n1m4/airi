import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    './src/index.ts',
  ],
  noExternal: [
    '@proj-anima/font-cjkfonts-allseto',
    '@proj-anima/font-departure-mono',
    '@proj-anima/font-xiaolai',
  ],
  dts: true,
  sourcemap: true,
})
