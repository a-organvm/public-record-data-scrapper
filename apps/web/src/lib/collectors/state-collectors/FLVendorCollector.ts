/**
 * Florida Image API Vendor Collector
 *
 * Vendor-gated implementation shell for Florida UCC filing data.
 *
 * IMPORTANT: Florida's UCC system is privatized. The state contracted with
 * Image API, LLC (now part of a larger data services company) to manage
 * UCC filings. Access to this data requires a commercial data agreement.
 *
 * Vendor Information:
 * - Provider: Image API, LLC / ImageAPIonline.com
 * - Contact: sales@imageapionline.com
 * - Phone: (850) 878-2776
 *
 * Data Agreement Requirements:
 * - Commercial license agreement
 * - Minimum annual commitment (~$5,000-15,000/year)
 * - Background check for data access
 * - Compliance with FL data usage restrictions
 * - Quarterly reporting requirements
 *
 * API Features (once contracted):
 * - Real-time search API
 * - Bulk download service
 * - Document image retrieval
 * - Amendment tracking
 * - Webhook notifications for new filings
 *
 * Data Coverage:
 * - All Florida UCC-1, UCC-3, UCC-5 filings
 * - Historical data back to 1999
 * - 24-hour data freshness
 *
 * @see docs/vendor-agreements/FL-ImageAPI.md for contract details
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
  CollectionErrorType
} from '../types'

// FL vendor API types based on common commercial data contracts.
interface FLVendorFilingResponse {
  filing_id: string
  doc_number: string
  filing_type: string
  filed_date: string
  effective_date?: string
  lapse_date?: string
  status: string
  debtors: FLVendorParty[]
  secured_parties: FLVendorParty[]
  collateral_text?: string
  document_pages?: number
  amendments?: FLVendorAmendment[]
  image_url?: string
}

interface FLVendorParty {
  party_id: string
  party_type: string
  name: string
  name_type: 'ORGANIZATION' | 'INDIVIDUAL'
  address?: {
    line1?: string
    line2?: string
    city?: string
    state?: string
    zip?: string
    country?: string
  }
}

interface FLVendorAmendment {
  amendment_id: string
  amendment_type: string
  filed_date: string
  notes?: string
}

interface FLVendorConfig {
  apiKey?: string
  apiSecret?: string
  accountId?: string
  baseUrl?: string
  timeout?: number
  contractActive?: boolean
}

/**
 * Vendor Agreement Status
 */
export interface VendorAgreementStatus {
  hasContract: boolean
  contractStartDate?: string
  contractEndDate?: string
  accessLevel: 'none' | 'search-only' | 'search-and-images' | 'bulk-download' | 'full'
  dataUsageRestrictions: string[]
  complianceRequirements: string[]
  annualCost?: number
  pendingActions: string[]
}

/**
 * Collection error specific to vendor issues
 */
class VendorCollectionError extends Error {
  constructor(
    public state: string,
    public errorType: CollectionErrorType,
    public recoverable: boolean,
    message: string,
    public originalError?: Error
  ) {
    super(message)
    this.name = 'VendorCollectionError'
  }
}

export class FLVendorCollector implements StateCollector {
  private config: FLVendorConfig
  private rateLimiter: RateLimiter
  private contractActive: boolean = false
  private stats: {
    totalCollected: number
    totalErrors: number
    totalRequests: number
    lastCollectionTime?: string
    latencies: number[]
  }

  constructor(config: FLVendorConfig = {}) {
    this.config = {
      apiKey: config.apiKey,
      apiSecret: config.apiSecret,
      accountId: config.accountId,
      baseUrl: config.baseUrl || 'https://api.imageapionline.com/v3',
      timeout: config.timeout || 30000,
      contractActive: config.contractActive || false
    }

    this.contractActive = !!(config.apiKey && config.apiSecret && config.contractActive)

    // Rate limits based on typical vendor agreements
    this.rateLimiter = new RateLimiter({
      requestsPerMinute: 30, // Conservative
      requestsPerHour: 500,
      requestsPerDay: 5000
    })

    this.stats = {
      totalCollected: 0,
      totalErrors: 0,
      totalRequests: 0,
      latencies: []
    }
  }

  /**
   * Get vendor agreement status
   */
  getVendorAgreementStatus(): VendorAgreementStatus {
    if (!this.contractActive) {
      return {
        hasContract: false,
        accessLevel: 'none',
        dataUsageRestrictions: [
          'No data access - vendor agreement required',
          'Contact Image API, LLC for commercial license'
        ],
        complianceRequirements: [
          'Execute Data License Agreement',
          'Complete background verification',
          'Submit initial payment'
        ],
        pendingActions: [
          'Review vendor agreement terms at docs/vendor-agreements/FL-ImageAPI.md',
          'Contact sales@imageapionline.com for pricing',
          'Prepare compliance documentation'
        ]
      }
    }

    return {
      hasContract: true,
      contractStartDate: process.env.FL_VENDOR_CONTRACT_START,
      contractEndDate: process.env.FL_VENDOR_CONTRACT_END,
      accessLevel: this.determineAccessLevel(),
      dataUsageRestrictions: [
        'Data must not be resold without sublicense',
        'Attribution required in derived products',
        'PII must be handled per FL privacy laws',
        'No bulk redistribution without approval'
      ],
      complianceRequirements: [
        'Quarterly usage reports',
        'Annual compliance audit',
        'Data security certification'
      ],
      annualCost: parseFloat(process.env.FL_VENDOR_ANNUAL_COST || '0'),
      pendingActions: []
    }
  }

  /**
   * Determine access level based on environment config
   */
  private determineAccessLevel(): VendorAgreementStatus['accessLevel'] {
    const level = process.env.FL_VENDOR_ACCESS_LEVEL
    if (level === 'full') return 'full'
    if (level === 'bulk') return 'bulk-download'
    if (level === 'images') return 'search-and-images'
    if (level === 'search') return 'search-only'
    return 'none'
  }

  /**
   * Check if the collector is ready for use
   */
  isReady(): boolean {
    return this.contractActive
  }

  /**
   * Guard method that throws if contract is not active
   */
  private requireContract(): void {
    if (!this.contractActive) {
      throw new VendorCollectionError(
        'FL',
        'AUTH',
        false,
        'Florida UCC data requires a vendor agreement with Image API, LLC. ' +
          'Contact sales@imageapionline.com for access. ' +
          'See docs/vendor-agreements/FL-ImageAPI.md for details.'
      )
    }
  }

  /**
   * Make authenticated API request.
   */
  private async request<T>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST'
      params?: Record<string, string>
      body?: unknown
    } = {}
  ): Promise<T> {
    this.requireContract()
    await this.rateLimiter.acquire()

    const url = new URL(`${this.config.baseUrl}${endpoint}`)
    if (options.params) {
      Object.entries(options.params).forEach(([key, value]) => {
        url.searchParams.append(key, value)
      })
    }

    const headers: Record<string, string> = {
      'X-API-Key': this.config.apiKey!,
      'X-API-Secret': this.config.apiSecret!,
      'X-Account-ID': this.config.accountId!,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }

    const startTime = Date.now()
    this.stats.totalRequests++

    try {
      const response = await fetch(url.toString(), {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(this.config.timeout!)
      })

      const latency = Date.now() - startTime
      this.recordLatency(latency)

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new VendorCollectionError(
            'FL',
            'AUTH',
            false,
            'FL Vendor authentication failed. Check API credentials.'
          )
        }
        if (response.status === 429) {
          throw new VendorCollectionError(
            'FL',
            'RATE_LIMIT',
            true,
            'FL Vendor rate limit exceeded. Try again later.'
          )
        }
        const errorText = await response.text()
        throw new Error(`FL Vendor API error ${response.status}: ${errorText}`)
      }

      return (await response.json()) as T
    } catch (error) {
      this.stats.totalErrors++
      throw error
    }
  }

  /**
   * Search for filings by business name
   */
  async searchByBusinessName(name: string): Promise<SearchResult> {
    this.requireContract()

    const response = await this.request<{
      results: FLVendorFilingResponse[]
      total: number
      has_more: boolean
      next_page?: string
    }>('/ucc/search', {
      params: {
        debtor_name: name,
        match_type: 'contains',
        include_inactive: 'false',
        page_size: '50'
      }
    })

    const filings = response.results.map(this.transformFiling.bind(this))
    this.stats.totalCollected += filings.length
    this.stats.lastCollectionTime = new Date().toISOString()

    return {
      filings,
      total: response.total,
      hasMore: response.has_more,
      nextOffset: response.next_page ? parseInt(response.next_page) : undefined
    }
  }

  /**
   * Search for a specific filing by number
   */
  async searchByFilingNumber(filingNumber: string): Promise<UCCFiling | null> {
    this.requireContract()

    try {
      const response = await this.request<FLVendorFilingResponse>(`/ucc/filing/${filingNumber}`)
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
    this.requireContract()

    const response = await this.request<FLVendorFilingResponse>(`/ucc/filing/${filingNumber}`, {
      params: { include_amendments: 'true', include_images: 'false' }
    })

    return this.transformFiling(response)
  }

  /**
   * Collect new filings since a given date
   */
  async collectNewFilings(options: CollectionOptions): Promise<UCCFiling[]> {
    this.requireContract()

    const allFilings: UCCFiling[] = []
    let page = 1
    const pageSize = 100
    let hasMore = true

    const params: Record<string, string> = {
      page_size: pageSize.toString(),
      sort_by: 'filed_date',
      sort_order: 'desc'
    }

    if (options.since) {
      params.filed_date_from = options.since.toISOString().split('T')[0]
    }

    if (options.filingTypes?.length) {
      params.filing_type = options.filingTypes.join(',')
    }

    if (!options.includeInactive) {
      params.status = 'active'
    }

    while (hasMore && (!options.limit || allFilings.length < options.limit)) {
      params.page = page.toString()

      const response = await this.request<{
        results: FLVendorFilingResponse[]
        total: number
        has_more: boolean
      }>('/ucc/filings', { params })

      const filings = response.results.map(this.transformFiling.bind(this))
      allFilings.push(...filings)

      hasMore = response.has_more
      page++

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
    if (filing.state !== 'FL') {
      errors.push(`Invalid state: ${filing.state}, expected FL`)
    }

    // FL filing number format validation
    if (filing.filingNumber && !/^[0-9]{7,}$/.test(filing.filingNumber.replace(/\D/g, ''))) {
      warnings.push('Filing number format may be invalid for FL')
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
      isHealthy:
        this.contractActive &&
        (this.stats.totalRequests > 0
          ? this.stats.totalErrors / this.stats.totalRequests < 0.1
          : true),
      lastCollectionTime: this.stats.lastCollectionTime,
      totalCollected: this.stats.totalCollected,
      errorRate:
        this.stats.totalRequests > 0 ? this.stats.totalErrors / this.stats.totalRequests : 0,
      averageLatency:
        this.stats.latencies.length > 0
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
   * Transform FL vendor response to standard format
   */
  private transformFiling(response: FLVendorFilingResponse): UCCFiling {
    return {
      filingNumber: response.doc_number,
      filingType: this.normalizeFilingType(response.filing_type),
      filingDate: response.filed_date,
      expirationDate: response.lapse_date,
      status: this.normalizeStatus(response.status),
      state: 'FL',
      securedParty: this.transformParty(response.secured_parties[0]),
      debtor: this.transformParty(response.debtors[0]),
      collateral: response.collateral_text || '',
      pages: response.document_pages,
      amendments: response.amendments?.map(this.transformAmendment.bind(this)),
      rawData: response as unknown as Record<string, unknown>
    }
  }

  /**
   * Transform party data
   */
  private transformParty(party: FLVendorParty | undefined): Party {
    if (!party) {
      return { name: 'Unknown' }
    }

    return {
      name: party.name,
      organizationType: party.name_type === 'INDIVIDUAL' ? 'individual' : 'organization',
      address: party.address
        ? {
            street: [party.address.line1, party.address.line2].filter(Boolean).join(' '),
            city: party.address.city,
            state: party.address.state,
            zipCode: party.address.zip,
            country: party.address.country || 'US'
          }
        : undefined
    }
  }

  /**
   * Transform amendment data
   */
  private transformAmendment(amendment: FLVendorAmendment): {
    filingNumber: string
    filingDate: string
    amendmentType: 'continuation' | 'assignment' | 'termination' | 'amendment'
    description?: string
  } {
    return {
      filingNumber: amendment.amendment_id,
      filingDate: amendment.filed_date,
      amendmentType: this.normalizeAmendmentType(amendment.amendment_type),
      description: amendment.notes
    }
  }

  /**
   * Normalize filing type
   */
  private normalizeFilingType(type: string): string {
    const normalized = type.toUpperCase().replace(/\s+/g, '')
    if (normalized.includes('UCC1') || normalized.includes('UCC-1')) return 'UCC-1'
    if (normalized.includes('UCC3') || normalized.includes('UCC-3')) return 'UCC-3'
    if (normalized.includes('UCC5') || normalized.includes('UCC-5')) return 'UCC-5'
    return type
  }

  /**
   * Normalize status
   */
  private normalizeStatus(status: string): 'active' | 'lapsed' | 'terminated' | 'amended' {
    const normalized = status.toLowerCase()
    if (normalized.includes('active')) return 'active'
    if (normalized.includes('laps')) return 'lapsed'
    if (normalized.includes('termin')) return 'terminated'
    if (normalized.includes('amend')) return 'amended'
    return 'active'
  }

  /**
   * Normalize amendment type
   */
  private normalizeAmendmentType(
    type: string
  ): 'continuation' | 'assignment' | 'termination' | 'amendment' {
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
}

/**
 * Create FL Vendor collector with environment variables
 */
export function createFLVendorCollector(): FLVendorCollector | null {
  const apiKey = process.env.FL_VENDOR_API_KEY
  const apiSecret = process.env.FL_VENDOR_API_SECRET
  const accountId = process.env.FL_VENDOR_ACCOUNT_ID
  const contractActive = process.env.FL_VENDOR_CONTRACT_ACTIVE === 'true'

  if (!apiKey || !apiSecret || !contractActive) {
    console.warn(
      'FL Vendor collector not configured. Florida UCC data requires a vendor agreement. ' +
        'See docs/vendor-agreements/FL-ImageAPI.md for setup instructions.'
    )
    return new FLVendorCollector() // Return inactive collector
  }

  return new FLVendorCollector({
    apiKey,
    apiSecret,
    accountId,
    contractActive: true
  })
}

/**
 * Get vendor contact information for establishing agreement
 */
export function getVendorContactInfo(): {
  vendor: string
  website: string
  email: string
  phone: string
  address: string
} {
  return {
    vendor: 'Image API, LLC',
    website: 'https://imageapionline.com',
    email: 'sales@imageapionline.com',
    phone: '(850) 878-2776',
    address: '2600 Blair Stone Road, Suite B, Tallahassee, FL 32301'
  }
}
