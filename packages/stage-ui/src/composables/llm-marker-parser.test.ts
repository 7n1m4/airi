import { describe, expect, it } from 'vitest'

import { useLlmmarkerParser } from './llm-marker-parser'

describe('useLlmmarkerParser', async () => {
  it('should parse pure literals', async () => {
    const fullText = 'Hello, world!'
    const collectedLiterals: string[] = []
    const collectedSpecials: string[] = []

    const parser = useLlmmarkerParser({
      onLiteral(literal) {
        collectedLiterals.push(literal)
      },
      onSpecial(special) {
        collectedSpecials.push(special)
      },
    })

    for (const char of fullText) {
      await parser.consume(char)
    }

    await parser.end()

    expect(collectedLiterals.join('')).toBe('Hello, world!')
    expect(collectedSpecials).toEqual([])
  })

  it('should parse pure specials', async () => {
    const fullText = '<|Hello, world!|>'
    const collectedLiterals: string[] = []
    const collectedSpecials: string[] = []

    const parser = useLlmmarkerParser({
      onLiteral(literal) {
        collectedLiterals.push(literal)
      },
      onSpecial(special) {
        collectedSpecials.push(special)
      },
    })

    for (const char of fullText) {
      await parser.consume(char)
    }

    await parser.end()

    expect(collectedLiterals).toEqual([])
    expect(collectedSpecials).toEqual(['<|Hello, world!|>'])
  })

  it('should parse escaped specials', async () => {
    const fullText = '<{\'|\'}Hello, world!{\'|\'}>'
    const collectedLiterals: string[] = []
    const collectedSpecials: string[] = []

    const parser = useLlmmarkerParser({
      onLiteral(literal) {
        collectedLiterals.push(literal)
      },
      onSpecial(special) {
        collectedSpecials.push(special)
      },
    })

    for (const char of fullText) {
      await parser.consume(char)
    }

    await parser.end()

    expect(collectedLiterals).toEqual([])
    expect(collectedSpecials).toEqual(['<|Hello, world!|>'])
  })

  it('should not include unfinished special', async () => {
    const fullText = '<|Hello, world'
    const collectedLiterals: string[] = []
    const collectedSpecials: string[] = []

    const parser = useLlmmarkerParser({
      onLiteral(literal) {
        collectedLiterals.push(literal)
      },
      onSpecial(special) {
        collectedSpecials.push(special)
      },
    })

    for (const char of fullText) {
      await parser.consume(char)
    }

    await parser.end()

    expect(collectedLiterals).toEqual([])
    expect(collectedSpecials).toEqual([])
  })

  it('should not include unfinished escaped special', async () => {
    const fullText = '<{\'|\'}Hello, world'
    const collectedLiterals: string[] = []
    const collectedSpecials: string[] = []

    const parser = useLlmmarkerParser({
      onLiteral(literal) {
        collectedLiterals.push(literal)
      },
      onSpecial(special) {
        collectedSpecials.push(special)
      },
    })

    for (const char of fullText) {
      await parser.consume(char)
    }

    await parser.end()

    expect(collectedLiterals).toEqual([])
    expect(collectedSpecials).toEqual([])
  })

  it('should parse with mixed input, ends with special', async () => {
    const fullText = 'This is sentence 1, <|HELLO|> and this is sentence 2.<|WORLD|>'
    const collectedLiterals: string[] = []
    const collectedSpecials: string[] = []

    const parser = useLlmmarkerParser({
      onLiteral(literal) {
        collectedLiterals.push(literal)
      },
      onSpecial(special) {
        collectedSpecials.push(special)
      },
    })

    for (const char of fullText) {
      await parser.consume(char)
    }

    await parser.end()

    expect(collectedLiterals.join('')).toBe('This is sentence 1,  and this is sentence 2.')
    expect(collectedSpecials).toEqual(['<|HELLO|>', '<|WORLD|>'])
  })

  it('should parse with mixed input, ends with escaped special', async () => {
    const fullText = 'This is sentence 1, <{\'|\'}HELLO{\'|\'}> and this is sentence 2.<{\'|\'}WORLD{\'|\'}>'
    const collectedLiterals: string[] = []
    const collectedSpecials: string[] = []

    const parser = useLlmmarkerParser({
      onLiteral(literal) {
        collectedLiterals.push(literal)
      },
      onSpecial(special) {
        collectedSpecials.push(special)
      },
    })

    for (const char of fullText) {
      await parser.consume(char)
    }

    await parser.end()

    expect(collectedLiterals.join('')).toBe('This is sentence 1,  and this is sentence 2.')
    expect(collectedSpecials).toEqual(['<|HELLO|>', '<|WORLD|>'])
  })

  it('should parse correctly', async () => {
    const testCases: { input: string, expectedLiterals: string, expectedSpecials: string[] }[] = [
      {
        input: `<|A|> Wow, hello there!`,
        expectedLiterals: ' Wow, hello there!',
        expectedSpecials: ['<|A|>'],
      },
      {
        input: `<|A|> Hello!`,
        expectedLiterals: ' Hello!',
        expectedSpecials: ['<|A|>'],
      },
      {
        input: `<|A|> Hello! <|B|>`,
        expectedLiterals: ' Hello! ',
        expectedSpecials: ['<|A|>', '<|B|>'],
      },
      {
        input: '<{\'|\'}A{\'|\'}> Wow, hello there!',
        expectedLiterals: ' Wow, hello there!',
        expectedSpecials: ['<|A|>'],
      },
      {
        input: '<{\'|\'}A{\'|\'}> Hello!',
        expectedLiterals: ' Hello!',
        expectedSpecials: ['<|A|>'],
      },
      {
        input: '<{\'|\'}A{\'|\'}> Hello! <{\'|\'}B{\'|\'}>',
        expectedLiterals: ' Hello! ',
        expectedSpecials: ['<|A|>', '<|B|>'],
      },
    ]

    for (const tc of testCases) {
      const { input, expectedLiterals, expectedSpecials } = tc
      const collectedLiterals: string[] = []
      const collectedSpecials: string[] = []

      const parser = useLlmmarkerParser({
        onLiteral(literal) {
          collectedLiterals.push(literal)
        },
        onSpecial(special) {
          collectedSpecials.push(special)
        },
      })

      for (const char of input) {
        await parser.consume(char)
      }

      await parser.end()

      expect(collectedLiterals.join('')).toBe(expectedLiterals)
      expect(collectedSpecials).toEqual(expectedSpecials)
    }
  })

  it('should normalize legacy ACT markers closed with plain > and continue emitting literals', async () => {
    const input = '<|ACT:"emotion":{"name":"annoyed","intensity":1}> Hello there.'
    const collectedLiterals: string[] = []
    const collectedSpecials: string[] = []

    const parser = useLlmmarkerParser({
      onLiteral(literal) {
        collectedLiterals.push(literal)
      },
      onSpecial(special) {
        collectedSpecials.push(special)
      },
    })

    for (const char of input) {
      await parser.consume(char)
    }

    await parser.end()

    expect(collectedSpecials).toEqual(['<|ACT:"emotion":{"name":"annoyed","intensity":1}|>'])
    expect(collectedLiterals.join('')).toBe(' Hello there.')
  })

  it('should normalize malformed ACT markers closed with curly brace |} and continue emitting literals', async () => {
    const input = '<|ACT:"emotion":{"name":"happy","intensity":0.3}|} Hello there.'
    const collectedLiterals: string[] = []
    const collectedSpecials: string[] = []

    const parser = useLlmmarkerParser({
      onLiteral(literal) {
        collectedLiterals.push(literal)
      },
      onSpecial(special) {
        collectedSpecials.push(special)
      },
    })

    for (const char of input) {
      await parser.consume(char)
    }

    await parser.end()

    expect(collectedSpecials).toEqual(['<|ACT:"emotion":{"name":"happy","intensity":0.3}|>'])
    expect(collectedLiterals.join('')).toBe(' Hello there.')
  })

  it('should call onEnd with full text', async () => {
    const fullText = 'Hello, world!'
    let endText = ''

    const parser = useLlmmarkerParser({
      onEnd(text) {
        endText = text
      },
    })

    for (const char of fullText) {
      await parser.consume(char)
    }

    await parser.end()

    expect(endText).toBe(fullText)
  })

  it('should call onEnd with full text including specials', async () => {
    const fullText = 'Hello <|special|> world!'
    let endText = ''

    const parser = useLlmmarkerParser({
      onEnd(text) {
        endText = text
      },
    })

    for (const char of fullText) {
      await parser.consume(char)
    }

    await parser.end()

    expect(endText).toBe(fullText)
  })

  it('should call onEnd with full text including escaped specials', async () => {
    const fullText = 'Hello <{\'|\'}special{\'|\'}> world!'
    let endText = ''

    const parser = useLlmmarkerParser({
      onEnd(text) {
        endText = text
      },
    })

    for (const char of fullText) {
      await parser.consume(char)
    }

    await parser.end()

    expect(endText).toBe(fullText)
  })

  it('should parse STICKER tokens in standard format', async () => {
    const fullText = 'Here is a sticker: <|STICKER airi-happy|> Have a great day!'
    const collectedLiterals: string[] = []
    const collectedSpecials: string[] = []

    const parser = useLlmmarkerParser({
      onLiteral(literal) {
        collectedLiterals.push(literal)
      },
      onSpecial(special) {
        collectedSpecials.push(special)
      },
    })

    for (const char of fullText) {
      await parser.consume(char)
    }

    await parser.end()

    expect(collectedLiterals.join('')).toBe('Here is a sticker:  Have a great day!')
    expect(collectedSpecials).toEqual(['<|STICKER airi-happy|>'])
  })

  it('should parse STICKER tokens with legacy close bracket and normalize to |>', async () => {
    const fullText = 'Check this out <|STICKER airi-celebrate> woohoo!'
    const collectedLiterals: string[] = []
    const collectedSpecials: string[] = []

    const parser = useLlmmarkerParser({
      onLiteral(literal) {
        collectedLiterals.push(literal)
      },
      onSpecial(special) {
        collectedSpecials.push(special)
      },
    })

    for (const char of fullText) {
      await parser.consume(char)
    }

    await parser.end()

    expect(collectedLiterals.join('')).toBe('Check this out  woohoo!')
    expect(collectedSpecials).toEqual(['<|STICKER airi-celebrate|>'])
  })
})
