/**
 * California legacy collector compatibility shim.
 *
 * The production California path is [CAApiCollector]. This legacy class is kept
 * only for compatibility with older imports and now fails closed instead of
 * generating synthetic filings.
 */

import { RateLimiter } from '../RateLimiter'
import {
  CollectionError,
  type CollectionErrorType,
  type CollectionOptions,
  type CollectorStatus,
  type SearchResult,
  type StateCollector,
  type UCCFiling,
  type ValidationResult
} from '../types'

interface CAAPIConfig {
  baseUrl?: string
  apiKey?: string
  clientId?: string
  clientSecret?: string
  timeout?: number
  retryAttempts?: number
  costPerRequest?: number
}

export class CAStateCollector implements StateCollector {
  private readonly config: Required<CAAPIConfig>
  private readonly rateLimiter: RateLimiter
  private readonly stats: {
    totalCollected: number
    totalErrors: number
    totalRequests: number
    lastCollectionTime?: string
  }

  constructor(config: CAAPIConfig = {}) {
    this.config = {
      baseUrl: config.baseUrl || 'https://bizfileonline.sos.ca.gov/api/v1',
      apiKey: config.apiKey || '',
      clientId: config.clientId || '',
      clientSecret: config.clientSecret || '',
      timeout: config.timeout || 30000,
      retryAttempts: config.retryAttempts || 3,
      costPerRequest: config.costPerRequest || 0.01
    }

    this.rateLimiter = new RateLimiter({
      requestsPerMinute: 60,
      requestsPerHour: 1200,
      requestsPerDay: 12000
    })

    this.stats = {
      totalCollected: 0,
      totalErrors: 0,
      totalRequests: 0
    }
  }

  async searchByBusinessName(name: string): Promise<SearchResult> {
    void name
    throw this.createUnsupportedError('searchByBusinessName')
  }

  async searchByFilingNumber(number: string): Promise<UCCFiling | null> {
    void number
    throw this.createUnsupportedError('searchByFilingNumber')
  }

  async getFilingDetails(filingNumber: string): Promise<UCCFiling> {
    void filingNumber
    throw this.createUnsupportedError('getFilingDetails')
  }

  async collectNewFilings(options: CollectionOptions): Promise<UCCFiling[]> {
    void options
    throw this.createUnsupportedError('collectNewFilings')
  }

  validateFiling(filing: UCCFiling): ValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    if (!filing.filingNumber) errors.push('Missing filing number')
    if (!filing.filingDate) errors.push('Missing filing date')
    if (!filing.debtor?.name) errors.push('Missing debtor name')
    if (!filing.securedParty?.name) errors.push('Missing secured party name')
    if (!filing.collateral) warnings.push('Missing collateral description')
    if (filing.state !== 'CA') errors.push(`Invalid state: ${filing.state}, expected CA`)

    return {
      valid: errors.length === 0,
      errors,
      warnings
    }
  }

  getStatus(): CollectorStatus {
    const rateLimitStats = this.rateLimiter.getStats()

    return {
      isHealthy: false,
      lastCollectionTime: this.stats.lastCollectionTime,
      totalCollected: this.stats.totalCollected,
      errorRate:
        this.stats.totalRequests > 0 ? this.stats.totalErrors / this.stats.totalRequests : 1,
      averageLatency: 0,
      rateLimitStats: {
        perMinute: rateLimitStats.perMinute,
        perHour: rateLimitStats.perHour,
        perDay: rateLimitStats.perDay
      }
    }
  }

  private createUnsupportedError(operation: string): CollectionError {
    this.stats.totalRequests++
    this.stats.totalErrors++

    return new CollectionError(
      'CA',
      this.resolveErrorType(),
      false,
      `CAStateCollector is disabled. Use CAApiCollector with live credentials for ${operation}.`
    )
  }

  private resolveErrorType(): CollectionErrorType {
    return this.config.clientId && this.config.clientSecret ? 'AUTH' : 'STRUCTURE_CHANGE'
  }
}
