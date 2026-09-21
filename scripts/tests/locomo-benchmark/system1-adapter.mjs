/**
 * Unified System-1 Coprocessor Adapter.
 *
 * Provides a polymorphic interface across:
 *   1. Local Convai Laya ONNX (CPU / WebGPU via @receptron/laya)
 *   2. TypeSafe AI Jev (Cloud API via TypeSafeJevClient)
 *
 * Both engines share the same typed contract:
 *   systemOne(state: string | object, questions: Record<string, Schema>): Promise<{ answers: Record<string, Answer> }>
 */

import { TypeSafeJevClient } from './jev-client.mjs'

export class SystemOneAdapter {
  /**
   * @param {'laya' | 'jev'} type
   * @param {object} engine
   */
  constructor(type, engine) {
    this.type = type
    this.engine = engine
    this.method = type === 'laya' ? 'laya_system1_onnx' : 'typesafe_jev_system1'
  }

  /**
   * Evaluates questions against state in one forward pass.
   *
   * @param {string | object} state
   * @param {Record<string, object>} questions
   * @returns {Promise<object>}
   */
  async systemOne(state, questions) {
    return this.engine.systemOne(state, questions)
  }

  /**
   * Cleans up resources if necessary.
   */
  async close() {
    if (this.engine && typeof this.engine.close === 'function') {
      await this.engine.close()
    }
  }
}

/**
 * Creates and initializes a System-1 Coprocessor.
 *
 * @param {'laya' | 'jev'} [type='laya']
 * @param {object} [opts]
 * @param {string[]} [opts.executionProviders=['cpu']]
 * @param {string} [opts.apiKey]
 * @returns {Promise<SystemOneAdapter>}
 */
export async function createSystemOneCoprocessor(type = 'laya', opts = {}) {
  if (type === 'laya') {
    const { Laya } = await import('@receptron/laya')
    const executionProviders = opts.executionProviders || ['cpu']
    const laya = await Laya.load({ executionProviders })
    return new SystemOneAdapter('laya', laya)
  }

  if (type === 'jev') {
    const jev = new TypeSafeJevClient(opts.apiKey)
    return new SystemOneAdapter('jev', jev)
  }

  throw new Error(`Unsupported System-1 coprocessor type: "${type}". Must be 'laya' or 'jev'.`)
}
