import type {
  Nan0Expression,
  Nan0HostBindings,
  Nan0Observation,
} from '../types'

export class CallbackHostBindings implements Nan0HostBindings {
  private readonly handlers = new Set<(observation: Nan0Observation) => void>()

  constructor(
    private readonly expressionDispatcher: (
      expression: Nan0Expression,
    ) => Promise<void>,
  ) {}

  subscribeObservations(
    handler: (observation: Nan0Observation) => void,
  ): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  emitObservation(observation: Nan0Observation): void {
    for (const handler of this.handlers)
      handler(observation)
  }

  async dispatchExpression(expression: Nan0Expression): Promise<void> {
    await this.expressionDispatcher(expression)
  }
}
