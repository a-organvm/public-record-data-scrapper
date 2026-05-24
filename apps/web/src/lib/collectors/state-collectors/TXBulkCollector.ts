/**
 * Texas SOSDirect Bulk Collector
 *
 * Production implementation for Texas Secretary of State bulk UCC filing data.
 * Texas offers daily filing updates via SOSDirect subscription service.
 *
 * Data Source:
 * - SOSDirect "Daily Filing Update" JSON exports
 * - Subscription-based bulk download service
 * - Updates available at 5:00 AM CT daily
 *
 * Authentication:
 * - SOSDirect account with UCC bulk access subscription
 * - API key for automated downloads
 *
 * Cost Structure:
 * - Monthly subscription: ~$150-500/month depending on tier
 * - Per-download fees may apply for on-demand requests
 *
 * Rate Limits:
 * - Daily downloads: 10 per day (standard tier)
 * - Hourly requests: 30 per hour
 * - Concurrent connections: 2
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

// TX SOSDirect Bulk Data Types
interface TXBulkFilingRecord {
  document_number: string
  filing_type: string
  filing_date: string
  effective_date?: string
  expiration_date?: string
  lapse_date?: string
  status: string
  debtor_information: TXBulkParty[]
  secured_party_information: TXBulkParty[]
  collateral_description?: string
  additional_parties?: TXBulkParty[]
  amendments?: TXBulkAmendment[]
  image_available: boolean
  page_count?: number
}

interface TXBulkParty {
  party_type: 'DEBTOR' | 'SECURED_PARTY' | 'ASSIGNEE'
  organization_name?: string
  individual_name?: {
    first_name?: string
    middle_name?: string
    last_name?: string
    suffix?: string
  }
  mailing_address?: TXBulkAddress
}

interface TXBulkAddress {
  address_line_1?: string
  address_line_2?: string
  city?: string
  state?: string
  postal_code?: string
  country?: string
}

interface TXBulkAmendment {
  document_number: string
  amendment_type: string
  filing_date: string
  description?: string
}

interface TXBulkDownloadManifest {
  download_date: string
  filing_date_from: string
  filing_date_to: string
  total_records: number
  file_size_bytes: number
  checksum: string
  download_url: string
  expires_at: string
}

interface TXBulkConfig {
  apiKey: string
  accountId: string
  baseUrl?: string
  downloadDir?: string
  timeout?: number
  maxRetries?: number
}

export class TXBulkCollector implements StateCollector {
  private config: Required<TXBulkConfig>
  private rateLimiter: RateLimiter
  private cachedFilings: Map<string, UCCFiling> = new Map()
  private lastBulkDownload?: Date
  private stats: {
    totalCollected: number
    totalErrors: number
    totalDownloads: number
    lastCollectionTime?: string
    latencies: number[]
  }

  constructor(config: TXBulkConfig) {
    if (!config.apiKey) {
      throw new Error('TX SOSDirect API key is required')
    }
    if (!config.accountId) {
      throw new Error('TX SOSDirect account ID is required')
    }

    this.config = {
      apiKey: config.apiKey,
      accountId: config.accountId,
      baseUrl: config.baseUrl || 'https://direct.sos.state.tx.us/api/v2',
      downloadDir: config.downloadDir || '/tmp/tx-bulk-downloads',
      timeout: config.timeout || 120000, // 2 minutes for bulk downloads
      maxRetries: config.maxRetries || 3
    }

    // Conservative rate limiting for bulk operations
    this.rateLimiter = new RateLimiter({
      requestsPerMinute: 30,
      requestsPerHour: 300,
      requestsPerDay: 1000
    })

    this.stats = {
      totalCollected: 0,
      totalErrors: 0,
      totalDownloads: 0,
      latencies: []
    }
  }

  /**
   * Make authenticated API request to SOSDirect
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
      'X-SOSDirect-API-Key': this.config.apiKey,
      'X-SOSDirect-Account-ID': this.config.accountId,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }

    const startTime = Date.now()
    let lastError: Error | null = null

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        // Acquire a rate-limit slot on every attempt so retries (including the
        // 429 `continue` path) count against the limit instead of bypassing it.
        await this.rateLimiter.acquire()

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
            const retryAfter = parseInt(response.headers.get('Retry-After') || '60')
            await this.delay(retryAfter * 1000)
            continue
          }

          if (response.status === 401 || response.status === 403) {
            throw new Error('TX SOSDirect authentication failed. Check API key and account ID.')
          }

          const errorText = await response.text()
          throw new Error(`TX SOSDirect error ${response.status}: ${errorText}`)
        }

        return await response.json() as T
      } catch (error) {
        lastError = error as Error
        this.stats.totalErrors++

        if (attempt < this.config.maxRetries - 1) {
          await this.delay(Math.pow(2, attempt) * 1000)
        }
      }
    }

    throw lastError || new Error('Request failed after retries')
  }

  /**
   * Download and process daily bulk filing update
   */
  async downloadDailyUpdate(date?: Date): Promise<UCCFiling[]> {
    const targetDate = date || new Date()
    const dateStr = targetDate.toISOString().split('T')[0]

    // Get download manifest
    const manifest = await this.request<TXBulkDownloadManifest>('/ucc/bulk/daily', {
      params: { date: dateStr }
    })

    if (!manifest.download_url) {
      console.warn(`No bulk download available for ${dateStr}`)
      return []
    }

    // Download the bulk file
    const bulkData = await this.downloadBulkFile(manifest.download_url)

    // Parse and transform filings
    const filings = bulkData.map(this.transformFiling.bind(this))

    // Cache filings for quick lookup
    filings.forEach(filing => {
      this.cachedFilings.set(filing.filingNumber, filing)
    })

    this.stats.totalCollected += filings.length
    this.stats.totalDownloads++
    this.stats.lastCollectionTime = new Date().toISOString()
    this.lastBulkDownload = new Date()

    return filings
  }

  /**
   * Download bulk file from SOSDirect
   */
  private async downloadBulkFile(url: string): Promise<TXBulkFilingRecord[]> {
    await this.rateLimiter.acquire()

    const response = await fetch(url, {
      headers: {
        'X-SOSDirect-API-Key': this.config.apiKey,
        'X-SOSDirect-Account-ID': this.config.accountId,
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(this.config.timeout)
    })

    if (!response.ok) {
      throw new Error(`Failed to download bulk file: ${response.status}`)
    }

    return await response.json() as TXBulkFilingRecord[]
  }

  /**
   * Search for filings by business name
   * Uses cached data from bulk downloads or falls back to API search
   */
  async searchByBusinessName(name: string): Promise<SearchResult> {
    // First, try to search from cache
    const cachedResults = this.searchCache(name)
    if (cachedResults.length > 0) {
      return {
        filings: cachedResults,
        total: cachedResults.length,
        hasMore: false
      }
    }

    // Fall back to API search if cache miss
    const response = await this.request<{
      results: TXBulkFilingRecord[]
      total_count: number
      has_more: boolean
    }>('/ucc/search', {
      params: {
        debtor_name: name,
        search_type: 'contains',
        status: 'all',
        page_size: '50'
      }
    })

    const filings = response.results.map(this.transformFiling.bind(this))
    this.stats.totalCollected += filings.length

    return {
      filings,
      total: response.total_count,
      hasMore: response.has_more
    }
  }

  /**
   * Search cached filings by debtor name
   */
  private searchCache(name: string): UCCFiling[] {
    const normalizedSearch = name.toLowerCase()
    const results: UCCFiling[] = []

    for (const filing of this.cachedFilings.values()) {
      if (filing.debtor.name.toLowerCase().includes(normalizedSearch)) {
        results.push(filing)
      }
    }

    return results
  }

  /**
   * Search for a specific filing by number
   */
  async searchByFilingNumber(filingNumber: string): Promise<UCCFiling | null> {
    // Check cache first
    if (this.cachedFilings.has(filingNumber)) {
      return this.cachedFilings.get(filingNumber)!
    }

    try {
      const response = await this.request<TXBulkFilingRecord>(
        `/ucc/filing/${encodeURIComponent(filingNumber)}`
      )
      const filing = this.transformFiling(response)

      // Cache the result
      this.cachedFilings.set(filingNumber, filing)
      this.stats.totalCollected++

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
    const response = await this.request<TXBulkFilingRecord>(
      `/ucc/filing/${encodeURIComponent(filingNumber)}`,
      {
        params: { include_amendments: 'true', include_images: 'false' }
      }
    )

    return this.transformFiling(response)
  }

  /**
   * Collect new filings since a given date
   * Uses bulk downloads for efficiency
   */
  async collectNewFilings(options: CollectionOptions): Promise<UCCFiling[]> {
    const allFilings: UCCFiling[] = []
    const startDate = options.since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Default: last 7 days
    const endDate = new Date()

    // Download bulk data for each day in range
    const currentDate = new Date(startDate)
    while (currentDate <= endDate) {
      try {
        const dayFilings = await this.downloadDailyUpdate(currentDate)

        // Filter by filing types if specified
        let filtered = dayFilings
        if (options.filingTypes?.length) {
          filtered = dayFilings.filter(f =>
            options.filingTypes!.includes(f.filingType)
          )
        }

        // Filter by status if not including inactive
        if (!options.includeInactive) {
          filtered = filtered.filter(f => f.status === 'active')
        }

        allFilings.push(...filtered)

        // Respect limit
        if (options.limit && allFilings.length >= options.limit) {
          break
        }
      } catch (error) {
        console.warn(`Failed to download bulk data for ${currentDate.toISOString().split('T')[0]}:`, error)
      }

      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1)
    }

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
    if (filing.state !== 'TX') {
      errors.push(`Invalid state: ${filing.state}, expected TX`)
    }

    // TX document number format validation (usually 7+ digits)
    if (filing.filingNumber && !/^[0-9]{7,}$/.test(filing.filingNumber.replace(/\D/g, ''))) {
      warnings.push('Filing number format may be invalid for TX')
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
      isHealthy: this.stats.totalDownloads > 0
        ? this.stats.totalErrors / this.stats.totalDownloads < 0.1
        : true,
      lastCollectionTime: this.stats.lastCollectionTime,
      totalCollected: this.stats.totalCollected,
      errorRate: this.stats.totalDownloads > 0
        ? this.stats.totalErrors / this.stats.totalDownloads
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
   * Get information about cached filings
   */
  getCacheStats(): {
    cachedCount: number
    lastBulkDownload?: Date
    cacheHitRate: number
  } {
    return {
      cachedCount: this.cachedFilings.size,
      lastBulkDownload: this.lastBulkDownload,
      cacheHitRate: 0 // Would need to track cache hits/misses
    }
  }

  /**
   * Clear the filing cache
   */
  clearCache(): void {
    this.cachedFilings.clear()
  }

  /**
   * Transform TX bulk record to standard UCCFiling format
   */
  private transformFiling(record: TXBulkFilingRecord): UCCFiling {
    return {
      filingNumber: record.document_number,
      filingType: this.normalizeFilingType(record.filing_type),
      filingDate: record.filing_date,
      expirationDate: record.expiration_date || record.lapse_date,
      status: this.normalizeStatus(record.status),
      state: 'TX',
      securedParty: this.transformParty(record.secured_party_information[0]),
      debtor: this.transformParty(record.debtor_information[0]),
      assignee: record.additional_parties?.find(p => p.party_type === 'ASSIGNEE')
        ? this.transformParty(record.additional_parties.find(p => p.party_type === 'ASSIGNEE'))
        : undefined,
      collateral: record.collateral_description || '',
      pages: record.page_count,
      amendments: record.amendments?.map(this.transformAmendment.bind(this)),
      rawData: record as unknown as Record<string, unknown>
    }
  }

  /**
   * Transform party data
   */
  private transformParty(party: TXBulkParty | undefined): Party {
    if (!party) {
      return { name: 'Unknown' }
    }

    let name: string
    if (party.organization_name) {
      name = party.organization_name
    } else if (party.individual_name) {
      const parts = [
        party.individual_name.first_name,
        party.individual_name.middle_name,
        party.individual_name.last_name,
        party.individual_name.suffix
      ].filter(Boolean)
      name = parts.join(' ')
    } else {
      name = 'Unknown'
    }

    return {
      name,
      organizationType: party.organization_name ? 'organization' : 'individual',
      address: party.mailing_address ? {
        street: [party.mailing_address.address_line_1, party.mailing_address.address_line_2]
          .filter(Boolean)
          .join(' '),
        city: party.mailing_address.city,
        state: party.mailing_address.state,
        zipCode: party.mailing_address.postal_code,
        country: party.mailing_address.country || 'US'
      } : undefined
    }
  }

  /**
   * Transform amendment data
   */
  private transformAmendment(amendment: TXBulkAmendment): Amendment {
    return {
      filingNumber: amendment.document_number,
      filingDate: amendment.filing_date,
      amendmentType: this.normalizeAmendmentType(amendment.amendment_type),
      description: amendment.description
    }
  }

  /**
   * Normalize filing type to standard format
   */
  private normalizeFilingType(type: string): string {
    const normalized = type.toUpperCase().replace(/\s+/g, '')
    if (normalized.includes('UCC1') || normalized.includes('UCC-1') || normalized.includes('INITIAL')) return 'UCC-1'
    if (normalized.includes('UCC3') || normalized.includes('UCC-3') || normalized.includes('AMENDMENT')) return 'UCC-3'
    if (normalized.includes('UCC5') || normalized.includes('UCC-5') || normalized.includes('CORRECTION')) return 'UCC-5'
    return type
  }

  /**
   * Normalize status to standard format
   */
  private normalizeStatus(status: string): 'active' | 'lapsed' | 'terminated' | 'amended' {
    const normalized = status.toLowerCase()
    if (normalized.includes('active') || normalized.includes('effect')) return 'active'
    if (normalized.includes('laps') || normalized.includes('expir')) return 'lapsed'
    if (normalized.includes('termin') || normalized.includes('releas')) return 'terminated'
    if (normalized.includes('amend')) return 'amended'
    return 'active'
  }

  /**
   * Normalize amendment type
   */
  private normalizeAmendmentType(type: string): Amendment['amendmentType'] {
    const normalized = type.toLowerCase()
    if (normalized.includes('continu')) return 'continuation'
    if (normalized.includes('assign')) return 'assignment'
    if (normalized.includes('termin') || normalized.includes('releas')) return 'termination'
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
 * Create TX Bulk collector with environment variables
 */
export function createTXBulkCollector(): TXBulkCollector | null {
  const apiKey = process.env.TX_SOSDIRECT_API_KEY
  const accountId = process.env.TX_SOSDIRECT_ACCOUNT_ID

  if (!apiKey || !accountId) {
    console.warn('TX_SOSDIRECT_API_KEY or TX_SOSDIRECT_ACCOUNT_ID not set, TX Bulk collector unavailable')
    return null
  }

  return new TXBulkCollector({
    apiKey,
    accountId
  })
}
