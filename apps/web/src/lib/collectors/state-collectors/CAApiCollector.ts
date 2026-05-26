/**
 * California Secretary of State XML API Collector
 *
 * Production-ready implementation for the CA SOS Business Search API.
 * API Developer Portal: https://bizfileonline.sos.ca.gov/developer
 *
 * Authentication:
 * - Requires Ocp-Apim-Subscription-Key header
 * - Requires SOS-Key header for UCC-specific endpoints
 *
 * Rate Limits:
 * - 60 requests/minute
 * - 1,200 requests/hour
 * - 12,000 requests/day
 *
 * Cost: $0.01 per request (subscription tier dependent)
 */

import { RateLimiter } from '../RateLimiter'
import type {
  StateCollector,
  UCCFiling,
  SearchResult,
  CollectionOptions,
  ValidationResult,
  CollectorStatus,
  Party,
  Amendment
} from '../types'

// CA API Response Types
interface CAApiFilingResponse {
  FileNumber: string
  FilingType: string
  FilingDate: string
  ExpirationDate?: string
  Status: string
  PageCount?: number
  LapseDate?: string
  Debtors: CAApiParty[]
  SecuredParties: CAApiParty[]
  Assignees?: CAApiParty[]
  CollateralDescription?: string
  Amendments?: CAApiAmendment[]
}

interface CAApiParty {
  Name: string
  Type?: string
  Address?: {
    Street1?: string
    Street2?: string
    City?: string
    State?: string
    PostalCode?: string
    Country?: string
  }
}

interface CAApiAmendment {
  AmendmentNumber: string
  AmendmentDate: string
  AmendmentType: string
  Description?: string
}

interface CAApiSearchResponse {
  TotalCount: number
  CurrentPage: number
  PageSize: number
  Results: CAApiFilingResponse[]
  HasMore: boolean
}

interface CAApiConfig {
  subscriptionKey: string
  sosKey?: string
  baseUrl?: string
  timeout?: number
  maxRetries?: number
}

export class CAApiCollector implements StateCollector {
  private config: Required<CAApiConfig>
  private rateLimiter: RateLimiter
  private stats: {
    totalCollected: number
    totalErrors: number
    totalRequests: number
    lastCollectionTime?: string
    latencies: number[]
  }

  constructor(config: CAApiConfig) {
    if (!config.subscriptionKey) {
      throw new Error('CA API subscription key is required')
    }

    this.config = {
      subscriptionKey: config.subscriptionKey,
      sosKey: config.sosKey || '',
      baseUrl: config.baseUrl || 'https://bizfileonline.sos.ca.gov/api/v1',
      timeout: config.timeout || 30000,
      maxRetries: config.maxRetries || 3
    }

    this.rateLimiter = new RateLimiter({
      requestsPerMinute: 60,
      requestsPerHour: 1200,
      requestsPerDay: 12000
    })

    this.stats = {
      totalCollected: 0,
      totalErrors: 0,
      totalRequests: 0,
      latencies: []
    }
  }

  /**
   * Make authenticated API request
   */
  private async request<T>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST'
      params?: Record<string, string>
      body?: unknown
    } = {}
  ): Promise<T> {
    const url = new URL(`${this.config.baseUrl}${endpoint}`)
    if (options.params) {
      Object.entries(options.params).forEach(([key, value]) => {
        url.searchParams.append(key, value)
      })
    }

    const headers: Record<string, string> = {
      'Ocp-Apim-Subscription-Key': this.config.subscriptionKey,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }

    if (this.config.sosKey) {
      headers['SOS-Key'] = this.config.sosKey
    }

    const startTime = Date.now()
    let lastError: Error | null = null

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        // Acquire a rate-limit slot on EVERY attempt. Retries (including the
        // 429 `continue` path below) are real outbound requests and must count
        // against the limit, otherwise retries silently bypass rate limiting.
        await this.rateLimiter.acquire()

        this.stats.totalRequests++

        const response = await fetch(url.toString(), {
          method: options.method || 'GET',
          headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: AbortSignal.timeout(this.config.timeout)
        })

        const latency = Date.now() - startTime
        this.recordLatency(latency)

        if (!response.ok) {
          if (response.status === 429) {
            // Rate limited - wait and retry
            const retryAfter = parseInt(response.headers.get('Retry-After') || '60')
            await this.delay(retryAfter * 1000)
            continue
          }

          const errorText = await response.text()
          throw new Error(`CA API error ${response.status}: ${errorText}`)
        }

        return await response.json() as T
      } catch (error) {
        lastError = error as Error
        this.stats.totalErrors++

        if (attempt < this.config.maxRetries - 1) {
          await this.delay(Math.pow(2, attempt) * 1000) // Exponential backoff
        }
      }
    }

    throw lastError || new Error('Request failed after retries')
  }

  /**
   * Search for filings by business name
   */
  async searchByBusinessName(name: string): Promise<SearchResult> {
    const response = await this.request<CAApiSearchResponse>('/ucc/search', {
      params: {
        debtorName: name,
        searchType: 'contains',
        status: 'all',
        pageSize: '50'
      }
    })

    const filings = response.Results.map(this.transformFiling.bind(this))
    this.stats.totalCollected += filings.length
    this.stats.lastCollectionTime = new Date().toISOString()

    return {
      filings,
      total: response.TotalCount,
      hasMore: response.HasMore,
      nextOffset: response.HasMore ? (response.CurrentPage + 1) * response.PageSize : undefined
    }
  }

  /**
   * Search for a specific filing by number
   */
  async searchByFilingNumber(filingNumber: string): Promise<UCCFiling | null> {
    try {
      const response = await this.request<CAApiFilingResponse>(
        `/ucc/filing/${encodeURIComponent(filingNumber)}`
      )

      const filing = this.transformFiling(response)
      this.stats.totalCollected++
      this.stats.lastCollectionTime = new Date().toISOString()

      return filing
    } catch (error) {
      if ((error as Error).message.includes('404')) {
        return null
      }
      throw error
    }
  }

  /**
   * Get detailed filing information
   */
  async getFilingDetails(filingNumber: string): Promise<UCCFiling> {
    const response = await this.request<CAApiFilingResponse>(
      `/ucc/filing/${encodeURIComponent(filingNumber)}`,
      {
        params: { includeAmendments: 'true', includeImages: 'false' }
      }
    )

    return this.transformFiling(response)
  }

  /**
   * Collect new filings since a given date
   */
  async collectNewFilings(options: CollectionOptions): Promise<UCCFiling[]> {
    const allFilings: UCCFiling[] = []
    let page = 1
    const pageSize = 100
    let hasMore = true

    const params: Record<string, string> = {
      pageSize: pageSize.toString(),
      sortBy: 'filingDate',
      sortOrder: 'desc'
    }

    if (options.since) {
      params.filingDateFrom = options.since.toISOString().split('T')[0]
    }

    if (options.filingTypes?.length) {
      params.filingType = options.filingTypes.join(',')
    }

    if (!options.includeInactive) {
      params.status = 'active'
    }

    while (hasMore && (!options.limit || allFilings.length < options.limit)) {
      params.page = page.toString()

      const response = await this.request<CAApiSearchResponse>('/ucc/filings', { params })

      const filings = response.Results.map(this.transformFiling.bind(this))
      allFilings.push(...filings)

      hasMore = response.HasMore
      page++

      // Respect limit
      if (options.limit && allFilings.length >= options.limit) {
        break
      }
    }

    this.stats.totalCollected += allFilings.length
    this.stats.lastCollectionTime = new Date().toISOString()

    return options.limit ? allFilings.slice(0, options.limit) : allFilings
  }

  /**
   * Validate a filing object
   */
  validateFiling(filing: UCCFiling): ValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    // Required fields
    if (!filing.filingNumber) errors.push('Missing filing number')
    if (!filing.filingDate) errors.push('Missing filing date')
    if (!filing.debtor?.name) errors.push('Missing debtor name')
    if (!filing.securedParty?.name) errors.push('Missing secured party name')

    // State validation
    if (filing.state !== 'CA') {
      errors.push(`Invalid state: ${filing.state}, expected CA`)
    }

    // Filing number format validation
    if (filing.filingNumber && !/^[0-9]{7,}$/.test(filing.filingNumber.replace(/\D/g, ''))) {
      warnings.push('Filing number format may be invalid')
    }

    // Date validation
    if (filing.filingDate) {
      const date = new Date(filing.filingDate)
      if (isNaN(date.getTime())) {
        errors.push('Invalid filing date format')
      }
      if (date > new Date()) {
        warnings.push('Filing date is in the future')
      }
    }

    // Collateral warning
    if (!filing.collateral) {
      warnings.push('Missing collateral description')
    }

    return { valid: errors.length === 0, errors, warnings }
  }

  /**
   * Get collector status
   */
  getStatus(): CollectorStatus {
    const rateLimitStats = this.rateLimiter.getStats()

    return {
      isHealthy: this.stats.totalRequests > 0
        ? this.stats.totalErrors / this.stats.totalRequests < 0.1
        : true,
      lastCollectionTime: this.stats.lastCollectionTime,
      totalCollected: this.stats.totalCollected,
      errorRate: this.stats.totalRequests > 0
        ? this.stats.totalErrors / this.stats.totalRequests
        : 0,
      averageLatency: this.stats.latencies.length > 0
        ? this.stats.latencies.reduce((a, b) => a + b, 0) / this.stats.latencies.length
        : 0,
      rateLimitStats: {
        perMinute: rateLimitStats.perMinute,
        perHour: rateLimitStats.perHour,
        perDay: rateLimitStats.perDay
      }
    }
  }

  /**
   * Transform CA API response to standard format
   */
  private transformFiling(response: CAApiFilingResponse): UCCFiling {
    return {
      filingNumber: response.FileNumber,
      filingType: this.normalizeFilingType(response.FilingType),
      filingDate: response.FilingDate,
      expirationDate: response.ExpirationDate || response.LapseDate,
      status: this.normalizeStatus(response.Status),
      state: 'CA',
      securedParty: this.transformParty(response.SecuredParties[0]),
      debtor: this.transformParty(response.Debtors[0]),
      assignee: response.Assignees?.[0] ? this.transformParty(response.Assignees[0]) : undefined,
      collateral: response.CollateralDescription || '',
      pages: response.PageCount,
      amendments: response.Amendments?.map(this.transformAmendment.bind(this)),
      rawData: response as unknown as Record<string, unknown>
    }
  }

  /**
   * Transform party data
   */
  private transformParty(party: CAApiParty | undefined): Party {
    if (!party) {
      return { name: 'Unknown' }
    }

    return {
      name: party.Name,
      organizationType: party.Type?.toLowerCase().includes('individual')
        ? 'individual'
        : 'organization',
      address: party.Address ? {
        street: [party.Address.Street1, party.Address.Street2].filter(Boolean).join(' '),
        city: party.Address.City,
        state: party.Address.State,
        zipCode: party.Address.PostalCode,
        country: party.Address.Country || 'US'
      } : undefined
    }
  }

  /**
   * Transform amendment data
   */
  private transformAmendment(amendment: CAApiAmendment): Amendment {
    return {
      filingNumber: amendment.AmendmentNumber,
      filingDate: amendment.AmendmentDate,
      amendmentType: this.normalizeAmendmentType(amendment.AmendmentType),
      description: amendment.Description
    }
  }

  /**
   * Normalize filing type to standard format
   */
  private normalizeFilingType(type: string): string {
    const normalized = type.toUpperCase().replace(/\s+/g, '')
    if (normalized.includes('UCC1') || normalized.includes('UCC-1')) return 'UCC-1'
    if (normalized.includes('UCC3') || normalized.includes('UCC-3')) return 'UCC-3'
    if (normalized.includes('UCC5') || normalized.includes('UCC-5')) return 'UCC-5'
    return type
  }

  /**
   * Normalize status to standard format
   */
  private normalizeStatus(status: string): 'active' | 'lapsed' | 'terminated' | 'amended' {
    const normalized = status.toLowerCase()
    if (normalized.includes('active')) return 'active'
    if (normalized.includes('laps')) return 'lapsed'
    if (normalized.includes('termin')) return 'terminated'
    if (normalized.includes('amend')) return 'amended'
    return 'active' // Default to active
  }

  /**
   * Normalize amendment type
   */
  private normalizeAmendmentType(type: string): Amendment['amendmentType'] {
    const normalized = type.toLowerCase()
    if (normalized.includes('continu')) return 'continuation'
    if (normalized.includes('assign')) return 'assignment'
    if (normalized.includes('termin')) return 'termination'
    return 'amendment'
  }

  /**
   * Record latency for metrics
   */
  private recordLatency(latency: number): void {
    this.stats.latencies.push(latency)
    if (this.stats.latencies.length > 100) {
      this.stats.latencies.shift()
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

/**
 * Create CA API collector with environment variables
 */
export function createCAApiCollector(): CAApiCollector | null {
  const subscriptionKey = process.env.CA_SOS_API_KEY
  const sosKey = process.env.CA_SOS_UCC_KEY

  if (!subscriptionKey) {
    console.warn('CA_SOS_API_KEY not set, CA API collector unavailable')
    return null
  }

  return new CAApiCollector({
    subscriptionKey,
    sosKey
  })
}
