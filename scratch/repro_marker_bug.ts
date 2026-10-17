import { createLlmMarkerParser } from '../packages/stage-ui/src/composables/llm-marker-parser'

async function test() {
  const parser = createLlmMarkerParser({ minLiteralEmitLength: 1 })
  const literals: string[] = []
  const specials: string[] = []

  const onLiteral = (v: string) => {
    console.info('Literal:', v)
    literals.push(v)
  }
  const onSpecial = (v: string) => {
    console.info('Special:', v)
    specials.push(v)
  }

  // Simulating the bug: unclosed ACT inside think, followed by response
  const input = '<think> Planning... <|ACT: emotion="excited" </think> Hello world! This is the response.'

  console.info('--- Consuming input ---')
  await parser.consume(input, onLiteral, onSpecial)
  console.info('--- Ending parser ---')
  await parser.end(onLiteral, onSpecial)

  console.info('\nResults:')
  console.info('Literals total:', literals.join(''))
  console.info('Specials total:', specials.join(''))
}

test()
