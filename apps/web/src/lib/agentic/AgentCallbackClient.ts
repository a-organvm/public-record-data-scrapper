import { AgentCallbackOptions, AgentCallbackPayload } from './types'

export class AgentCallbackError extends Error {
  public readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'AgentCallbackError'
    this.cause = cause
  }
}

export class AgentCallbackClient {
  private connected = false
  private readonly options: AgentCallbackOptions
  private readonly retries: number
  private readonly retryDelay: number

  constructor(options: AgentCallbackOptions) {
    if (!options.transport && !options.endpoint) {
      throw new AgentCallbackError(
        'AgentCallbackClient requires either a transport or an endpoint to deliver payloads.'
      )
    }

    this.options = {
      retries: 3,
      retryDelayMs: 500,
      headers: { 'Content-Type': 'application/json' },
      ...options
    }

    this.retries = this.options.retries ?? 3
    this.retryDelay = this.options.retryDelayMs ?? 500
  }

  async sendCycleResult(payload: AgentCallbackPayload): Promise<void> {
    await this.ensureConnected()

    // The initial send is attempt 1; we then allow up to `retries` additional
    // attempts, so the maximum number of attempts is `retries + 1`.
    const maxAttempts = this.retries + 1

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.performSend(payload)
        return
      } catch (error) {
        // Log the attempt that actually just failed (1-based).
        console.warn(`⚠️ Agent callback attempt ${attempt}/${maxAttempts} failed`, error)

        if (attempt >= maxAttempts) {
          throw new AgentCallbackError('Unable to deliver agent callback after retrying.', error)
        }

        // Exponential backoff based on the number of retries performed so far.
        const delay = this.retryDelay * Math.pow(2, attempt - 1)
        await this.delay(delay)
      }
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) {
      return
    }

    const { transport } = this.options

    if (transport && hasCallable(transport, 'disconnect')) {
      try {
        await transport.disconnect!()
      } catch (error) {
        console.warn('⚠️ Failed to disconnect agent callback transport cleanly.', error)
      }
    }

    this.connected = false
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) {
      return
    }

    const { transport } = this.options

    if (transport) {
      if ('connect' in transport) {
        if (!hasCallable(transport, 'connect')) {
          throw new AgentCallbackError(
            'Configured callback transport exposes a non-callable connect handler.'
          )
        }

        await transport.connect!()
      }

      this.connected = true
      return
    }

    // Fetch transport does not require a connection step
    this.connected = true
  }

  private async performSend(payload: AgentCallbackPayload): Promise<void> {
    const { transport, endpoint, headers } = this.options

    if (transport) {
      if (!hasCallable(transport, 'send')) {
        throw new AgentCallbackError(
          'Configured callback transport is missing a callable send() method.'
        )
      }

      await transport.send(payload)
      return
    }

    if (!endpoint) {
      throw new AgentCallbackError('No callback endpoint configured for AgentCallbackClient.')
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      throw new AgentCallbackError(
        `Callback request failed with status ${response.status}${response.statusText ? ` - ${response.statusText}` : ''}.`
      )
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

function hasCallable<T extends object, K extends keyof T>(
  value: T,
  key: K
): value is T & Record<K, (...args: unknown[]) => unknown> {
  return typeof value[key] === 'function'
}
