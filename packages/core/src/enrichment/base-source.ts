/**
 * Base Data Source (shared)
 *
 * Abstract base class for all data sources with common functionality
 * (rate limiting, retries, timeout). Framework-free so the same source
 * implementations run in the browser app and the Node server.
 */

import { rateLimiterManager } from './rate-limiter'

/**
 * Subscription / data tiers. Declared locally to keep this module free of any
 * browser-side coupling; mirrors the web app's `SubscriptionTier` union.
 */
export type SubscriptionTier = 'free' | 'starter' | 'professional' | 'enterprise'

export interface DataSourceConfig {
  name: string
  tier: SubscriptionTier
  cost: number
  timeout: number
  retryAttempts: number
  retryDelay: number
}

export interface DataSourceResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  source: string
  timestamp: string
  responseTime: number
}

export abstract class BaseDataSource {
  protected config: DataSourceConfig

  constructor(config: DataSourceConfig) {
    this.config = config
  }

  /**
   * Fetch data from the source.
   */
  abstract fetchData(query: Record<string, unknown>): Promise<DataSourceResponse>

  /**
   * Validate the query parameters.
   */
  protected abstract validateQuery(query: Record<string, unknown>): boolean

  /**
   * Execute fetch with rate limiting, retries, and timeout.
   */
  protected async executeFetch(
    fetchFn: () => Promise<unknown>,
    query: Record<string, unknown>
  ): Promise<DataSourceResponse> {
    const startTime = Date.now()

    // Validate query
    if (!this.validateQuery(query)) {
      return {
        success: false,
        error: 'Invalid query parameters',
        source: this.config.name,
        timestamp: new Date().toISOString(),
        responseTime: Date.now() - startTime
      }
    }

    // Check rate limit (courteous public APIs — token bucket per source).
    if (!rateLimiterManager.tryConsume(this.config.name)) {
      return {
        success: false,
        error: 'Rate limit exceeded',
        source: this.config.name,
        timestamp: new Date().toISOString(),
        responseTime: Date.now() - startTime
      }
    }

    // Retry logic with exponential backoff.
    let lastError: Error | null = null
    for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
      try {
        const data = await this.withTimeout(fetchFn(), this.config.timeout)
        return {
          success: true,
          data,
          source: this.config.name,
          timestamp: new Date().toISOString(),
          responseTime: Date.now() - startTime
        }
      } catch (error) {
        lastError = error as Error

        // Don't retry on validation errors.
        if (error instanceof Error && error.message.includes('Invalid')) {
          break
        }

        // Wait before retry with exponential backoff.
        if (attempt < this.config.retryAttempts - 1) {
          const delay = this.config.retryDelay * Math.pow(2, attempt)
          await this.sleep(delay)
        }
      }
    }

    return {
      success: false,
      error: lastError?.message || 'Unknown error',
      source: this.config.name,
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime
    }
  }

  /**
   * Add a timeout to a promise.
   */
  protected withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
      )
    ])
  }

  /**
   * Sleep helper.
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Get source configuration.
   */
  getConfig(): DataSourceConfig {
    return { ...this.config }
  }

  /**
   * Check if the source is available for a tier.
   */
  isAvailableForTier(tier: SubscriptionTier): boolean {
    const tiers: SubscriptionTier[] = ['free', 'starter', 'professional', 'enterprise']
    const requiredTierIndex = tiers.indexOf(this.config.tier)
    const userTierIndex = tiers.indexOf(tier)
    return userTierIndex >= requiredTierIndex
  }
}
