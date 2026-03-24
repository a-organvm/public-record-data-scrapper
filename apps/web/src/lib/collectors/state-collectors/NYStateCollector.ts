/**
 * New York legacy collector compatibility shim.
 *
 * The NY portal scraper is not wired to a production-grade collector yet.
 * This compatibility class fails closed instead of fabricating filings.
 */

import { RateLimiter } from '../RateLimiter'
import {
  CollectionError,
  type CollectionOptions,
  type CollectorStatus,
  type SearchResult,
  type StateCollector,
  type UCCFiling,
  type ValidationResult
} from '../types'

interface NYCollectorConfig {
  portalUrl?: string
  timeout?: number
  retryAttempts?: number
  retryDelay?: number
}

export class NYStateCollector implements StateCollector {
  private readonly config: Required<NYCollectorConfig>
  private readonly rateLimiter: RateLimiter
  private readonly stats: {
    totalCollected: number
    totalErrors: number
    totalRequests: number
    lastCollectionTime?: string
  }

  constructor(config: NYCollectorConfig = {}) {
    this.config = {
      portalUrl:
        config.portalUrl || 'https://appext20.dos.ny.gov/pls/ucc_public/web_search.main_frame',
      timeout: config.timeout || 30000,
      retryAttempts: config.retryAttempts || 3,
      retryDelay: config.retryDelay || 2000
    }

    this.rateLimiter = new RateLimiter({
      requestsPerMinute: 30,
      requestsPerHour: 500,
      requestsPerDay: 5000
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
    if (filing.state !== 'NY') errors.push(`Invalid state: ${filing.state}, expected NY`)

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
      'NY',
      'STRUCTURE_CHANGE',
      false,
      `NYStateCollector is disabled until a production scraper is wired for ${operation}.`
    )
  }
}
