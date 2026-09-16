import type { Nan0HeartbeatEngine } from '../heartbeat/Nan0HeartbeatEngine'
import type { Nan0Kernel } from '../kernel/Nan0Kernel'
import type {
  Nan0Expression,
  Nan0HostBindings,
  Nan0Observation,
} from '../types'

export class Nan0HostAdapter {
  private unsubscribeHost: (() => void) | null = null
  private unsubscribeKernel: (() => void) | null = null
  private started = false

  constructor(
    private readonly kernel: Nan0Kernel,
    private readonly host: Nan0HostBindings,
    private readonly heartbeat?: Nan0HeartbeatEngine,
  ) {}

  async start(): Promise<void> {
    if (this.started)
      return

    await this.kernel.boot()

    this.unsubscribeHost = this.host.subscribeObservations(
      (observation: Nan0Observation) => {
        void this.kernel.observe(observation).catch((error) => {
          console.error('[Nan0HostAdapter] observation failed', error)
        })
      },
    )

    this.unsubscribeKernel = this.kernel.onExpression(
      (expression: Nan0Expression) => {
        void this.host.dispatchExpression(expression).catch((error) => {
          console.error('[Nan0HostAdapter] expression dispatch failed', error)
        })
      },
    )

    this.started = true
    this.heartbeat?.start()
  }

  async stop(): Promise<void> {
    if (!this.started)
      return

    this.heartbeat?.stop()
    this.unsubscribeHost?.()
    this.unsubscribeKernel?.()
    this.unsubscribeHost = null
    this.unsubscribeKernel = null

    await this.kernel.shutdown()
    this.started = false
  }
}
