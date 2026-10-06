import { describe, expect, it } from 'vitest'

import { useMarkdown } from './markdown'

describe('markdown fence detection invariant tests', () => {
  const { process } = useMarkdown()

  it('detects and highlights code fences delimited by backticks (```)', async () => {
    const md = '```ts\nconst x = 1\n```'
    const result = await process(md)
    expect(result).toContain('<code')
  })

  it('detects and highlights code fences delimited by tildes (~~~)', async () => {
    const md = '~~~ts\nconst y = 2\n~~~'
    const result = await process(md)
    expect(result).toContain('<code')
  })

  it('correctly parses markdown with mixed backtick and tilde fences', async () => {
    const md = '```js\nconsole.log(1)\n```\n\n~~~js\nconsole.log(2)\n~~~'
    const result = await process(md)
    expect(result).toContain('<code')
  })
})
