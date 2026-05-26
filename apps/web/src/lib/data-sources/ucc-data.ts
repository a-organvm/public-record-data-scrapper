/**
 * UCC Data Sources
 *
 * Implementation of UCC filing data sources:
 * - State Secretary of State APIs
 * - Commercial UCC data providers
 * - UCC filing verification services
 */

import { BaseDataSource, DataSourceResponse } from './base-source'

/**
 * California Secretary of State UCC API
 * Free tier with rate limits
 */
export class CaliforniaUCCSource extends BaseDataSource {
  constructor() {
    super({
      name: 'ca-ucc',
      tier: 'free',
      cost: 0,
      timeout: 15000,
      retryAttempts: 3,
      retryDelay: 2000
    })
  }

  async fetchData(query: Record<string, unknown>): Promise<DataSourceResponse> {
    return this.executeFetch(async () => {
      const { debtorName, fileNumber } = query

      // California UCC search endpoint
      // Note: California SOS has a search portal but limited API access
      const searchUrl = 'https://bizfileonline.sos.ca.gov/api/Filing/Search'

      const response = await fetch(searchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'UCC-MCA-Intelligence Platform'
        },
        body: JSON.stringify({
          searchType: 'ucc',
          debtorName: debtorName || '',
          fileNumber: fileNumber || '',
          includeInactive: false
        })
      })

      if (!response.ok) {
        // Fallback to manual search URL
        const manualUrl = `https://businesssearch.sos.ca.gov/UCC/Search?query=${encodeURIComponent(String(debtorName || fileNumber || ''))}`
        return {
          available: false,
          manualSearchUrl: manualUrl,
          state: 'CA',
          note: 'California UCC API may require authentication. Use manual search URL.',
          debtorName,
          fileNumber
        }
      }

      const data = await response.json()

      const filings = data.results || []

      return {
        available: true,
        state: 'CA',
        totalFilings: filings.length,
        filings: filings.map((filing: Record<string, unknown>) => ({
          fileNumber: filing.fileNumber,
          filingDate: filing.filingDate,
          debtorName: filing.debtorName,
          securedParty: filing.securedPartyName,
          collateral: filing.collateralDescription,
          status: filing.status,
          lapseDate: filing.lapseDate
        })),
        debtorName,
        fileNumber
      }
    }, query)
  }

  protected validateQuery(query: Record<string, unknown>): boolean {
    return Boolean(query.debtorName || query.fileNumber)
  }
}

/**
 * Texas Secretary of State UCC API
 */
export class TexasUCCSource extends BaseDataSource {
  constructor() {
    super({
      name: 'tx-ucc',
      tier: 'free',
      cost: 0,
      timeout: 15000,
      retryAttempts: 3,
      retryDelay: 2000
    })
  }

  async fetchData(query: Record<string, unknown>): Promise<DataSourceResponse> {
    return this.executeFetch(async () => {
      const { debtorName, fileNumber } = query

      // Texas SOS UCC search
      const manualUrl = `https://direct.sos.state.tx.us/help/help-ucc.asp`

      // Texas doesn't have a public API - would need web scraping
      return {
        available: false,
        state: 'TX',
        manualSearchUrl: manualUrl,
        note: 'Texas UCC search requires web scraping or subscription service',
        debtorName,
        fileNumber,
        alternativeMethod: 'Contact Texas SOS or use commercial UCC search service'
      }
    }, query)
  }

  protected validateQuery(query: Record<string, unknown>): boolean {
    return Boolean(query.debtorName || query.fileNumber)
  }
}

/**
 * New York Secretary of State UCC API
 */
export class NewYorkUCCSource extends BaseDataSource {
  constructor() {
    super({
      name: 'ny-ucc',
      tier: 'free',
      cost: 0,
      timeout: 15000,
      retryAttempts: 3,
      retryDelay: 2000
    })
  }

  async fetchData(query: Record<string, unknown>): Promise<DataSourceResponse> {
    return this.executeFetch(async () => {
      const { debtorName, fileNumber } = query

      // NY UCC search portal
      const searchUrl = 'https://appext20.dos.ny.gov/pls/ucc_public/web_search.main_frame'

      // Note: NY UCC portal requires session management and may use CAPTCHA
      return {
        available: false,
        state: 'NY',
        portalUrl: searchUrl,
        note: 'New York UCC search requires interactive session or scraper',
        debtorName,
        fileNumber,
        recommendation: 'Use NYUCCPortalScraper for automated searches'
      }
    }, query)
  }

  protected validateQuery(query: Record<string, unknown>): boolean {
    return Boolean(query.debtorName || query.fileNumber)
  }
}

/**
 * Florida Secretary of State UCC API
 */
export class FloridaUCCSource extends BaseDataSource {
  constructor() {
    super({
      name: 'fl-ucc',
      tier: 'free',
      cost: 0,
      timeout: 15000,
      retryAttempts: 3,
      retryDelay: 2000
    })
  }

  async fetchData(query: Record<string, unknown>): Promise<DataSourceResponse> {
    return this.executeFetch(async () => {
      const { debtorName, fileNumber } = query

      // Florida UCC search
      const searchUrl = 'https://dos.myflorida.com/sunbiz/search/'

      return {
        available: false,
        state: 'FL',
        portalUrl: searchUrl,
        note: 'Florida UCC search available through Sunbiz portal',
        debtorName,
        fileNumber,
        recommendation: 'Use Florida state scraper for automated searches'
      }
    }, query)
  }

  protected validateQuery(query: Record<string, unknown>): boolean {
    return Boolean(query.debtorName || query.fileNumber)
  }
}

/**
 * Commercial UCC Data Provider - CSC UCC
 * Requires subscription
 */
export class CSCUCCSource extends BaseDataSource {
  private apiKey: string
  private username: string

  constructor() {
    super({
      name: 'csc-ucc',
      tier: 'professional',
      cost: 2.5,
      timeout: 20000,
      retryAttempts: 2,
      retryDelay: 3000
    })

    this.apiKey = process.env.CSC_UCC_API_KEY || ''
    this.username = process.env.CSC_USERNAME || ''
  }

  async fetchData(query: Record<string, unknown>): Promise<DataSourceResponse> {
    if (!this.apiKey || !this.username) {
      return {
        success: false,
        error: 'CSC UCC API credentials not configured',
        source: this.config.name,
        timestamp: new Date().toISOString(),
        responseTime: 0
      }
    }

    return this.executeFetch(async () => {
      const { debtorName, state, fileNumber } = query

      // CSC UCC Search API (example endpoint)
      const searchUrl = 'https://api.cscglobal.com/ucc/v1/search'

      const response = await fetch(searchUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'X-CSC-Username': this.username,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          jurisdiction: state,
          debtorName: debtorName || '',
          fileNumber: fileNumber || '',
          searchType: 'exact',
          includeImages: false
        })
      })

      if (!response.ok) {
        throw new Error(`CSC UCC API error: ${response.statusText}`)
      }

      const data = await response.json()

      const filings = data.filings || []

      return {
        provider: 'CSC',
        state,
        totalFilings: data.totalResults || filings.length,
        filings: filings.map((filing: Record<string, unknown>) => ({
          fileNumber: filing.filingNumber,
          filingDate: filing.filingDate,
          filingType: filing.filingType,
          debtorName: (filing.debtor as Record<string, unknown> | undefined)?.name,
          debtorAddress: (filing.debtor as Record<string, unknown> | undefined)?.address,
          securedParty: (filing.securedParty as Record<string, unknown> | undefined)?.name,
          securedPartyAddress: (filing.securedParty as Record<string, unknown> | undefined)
            ?.address,
          collateral: (filing.collateral as Record<string, unknown> | undefined)?.description,
          status: filing.status,
          lapseDate: filing.lapseDate,
          amount: filing.amount
        })),
        debtorName,
        fileNumber
      }
    }, query)
  }

  protected validateQuery(query: Record<string, unknown>): boolean {
    return Boolean((query.debtorName || query.fileNumber) && query.state)
  }
}

/**
 * CT Corporation UCC Data Service
 * Commercial UCC search provider
 */
export class CTCorpUCCSource extends BaseDataSource {
  private apiKey: string

  constructor() {
    super({
      name: 'ctcorp-ucc',
      tier: 'professional',
      cost: 3.0,
      timeout: 20000,
      retryAttempts: 2,
      retryDelay: 3000
    })

    this.apiKey = process.env.CTCORP_API_KEY || ''
  }

  async fetchData(query: Record<string, unknown>): Promise<DataSourceResponse> {
    if (!this.apiKey) {
      return {
        success: false,
        error: 'CT Corporation API key not configured',
        source: this.config.name,
        timestamp: new Date().toISOString(),
        responseTime: 0
      }
    }

    return this.executeFetch(async () => {
      const { debtorName, state, fileNumber } = query

      // CT Corporation UCC API (example endpoint)
      const searchUrl = 'https://api.ctcorporation.com/ucc/search'

      const response = await fetch(searchUrl, {
        method: 'POST',
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          state,
          debtorName: debtorName || '',
          filingNumber: fileNumber || '',
          searchOptions: {
            includeInactive: false,
            includeImages: true
          }
        })
      })

      if (!response.ok) {
        throw new Error(`CT Corporation API error: ${response.statusText}`)
      }

      const data = await response.json()

      return {
        provider: 'CT Corporation',
        state,
        totalResults: data.totalResults || 0,
        filings: data.results || [],
        debtorName,
        fileNumber
      }
    }, query)
  }

  protected validateQuery(query: Record<string, unknown>): boolean {
    return Boolean((query.debtorName || query.fileNumber) && query.state)
  }
}

/**
 * LexisNexis UCC Search
 * Premium commercial UCC data provider
 */
export class LexisNexisUCCSource extends BaseDataSource {
  private apiKey: string
  private customerId: string

  constructor() {
    super({
      name: 'lexisnexis-ucc',
      tier: 'enterprise',
      cost: 5.0,
      timeout: 25000,
      retryAttempts: 2,
      retryDelay: 3000
    })

    this.apiKey = process.env.LEXISNEXIS_API_KEY || ''
    this.customerId = process.env.LEXISNEXIS_CUSTOMER_ID || ''
  }

  async fetchData(query: Record<string, unknown>): Promise<DataSourceResponse> {
    if (!this.apiKey || !this.customerId) {
      return {
        success: false,
        error: 'LexisNexis API credentials not configured',
        source: this.config.name,
        timestamp: new Date().toISOString(),
        responseTime: 0
      }
    }

    return this.executeFetch(async () => {
      const { debtorName, state, fileNumber, nationwide } = query

      // LexisNexis UCC API
      const searchUrl = 'https://services.lexisnexis.com/ucc/v1/search'

      const response = await fetch(searchUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'X-Customer-ID': this.customerId,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          searchCriteria: {
            debtorName: debtorName || '',
            fileNumber: fileNumber || '',
            jurisdiction: nationwide ? 'ALL' : state
          },
          options: {
            includeImages: true,
            includeLapsed: false,
            sortBy: 'filingDate',
            sortOrder: 'desc',
            maxResults: 100
          }
        })
      })

      if (!response.ok) {
        throw new Error(`LexisNexis API error: ${response.statusText}`)
      }

      const data = await response.json()

      return {
        provider: 'LexisNexis',
        searchType: nationwide ? 'nationwide' : 'state',
        state,
        totalResults: data.totalRecords || 0,
        filings: data.filings || [],
        debtorName,
        fileNumber,
        coverage: data.jurisdictionsCovered || []
      }
    }, query)
  }

  protected validateQuery(query: Record<string, unknown>): boolean {
    return Boolean(query.debtorName || query.fileNumber)
  }
}

/**
 * UCC Data Aggregator - Combines multiple UCC sources
 */
export class UCCAggregatorSource extends BaseDataSource {
  private sources: BaseDataSource[]

  constructor() {
    super({
      name: 'ucc-aggregator',
      tier: 'professional',
      cost: 0, // Cost is sum of individual sources
      timeout: 30000,
      retryAttempts: 1,
      retryDelay: 1000
    })

    // Initialize all available UCC sources
    this.sources = [
      new CaliforniaUCCSource(),
      new TexasUCCSource(),
      new NewYorkUCCSource(),
      new FloridaUCCSource()
    ]

    // Add commercial sources if credentials are available
    if (process.env.CSC_UCC_API_KEY) {
      this.sources.push(new CSCUCCSource())
    }
    if (process.env.CTCORP_API_KEY) {
      this.sources.push(new CTCorpUCCSource())
    }
    if (process.env.LEXISNEXIS_API_KEY) {
      this.sources.push(new LexisNexisUCCSource())
    }
  }

  async fetchData(query: Record<string, unknown>): Promise<DataSourceResponse> {
    return this.executeFetch(async () => {
      const { debtorName, state, nationwide } = query
      const stateStr = typeof state === 'string' ? state : undefined

      const results: Array<{ source: string; data: Record<string, unknown> }> = []
      const errors: Array<{ source: string; error: string }> = []

      // If nationwide, query all sources
      // If state-specific, query only relevant sources
      const sourcesToQuery = nationwide
        ? this.sources
        : this.sources.filter((s) => {
            const name = s.getConfig().name
            return !stateStr || name.includes('aggregator') || name.includes(stateStr.toLowerCase())
          })

      // Query all sources in parallel
      const promises = sourcesToQuery.map(async (source) => {
        try {
          const result = await source.fetchData(query)
          if (result.success && result.data) {
            results.push({
              source: source.getConfig().name,
              data: result.data as Record<string, unknown>
            })
          }
        } catch (error) {
          errors.push({
            source: source.getConfig().name,
            error: error instanceof Error ? error.message : 'Unknown error'
          })
        }
      })

      await Promise.all(promises)

      // Aggregate and deduplicate filings
      const allFilings: Array<Record<string, unknown>> = []
      const filingSet = new Set<string>()

      results.forEach((r) => {
        const filings = (r.data.filings || []) as Array<Record<string, unknown>>
        filings.forEach((filing) => {
          const key = `${filing.fileNumber}-${filing.state || stateStr}`
          if (!filingSet.has(key)) {
            filingSet.add(key)
            allFilings.push({
              ...filing,
              source: r.source
            })
          }
        })
      })

      // Sort by filing date (most recent first)
      allFilings.sort(
        (a, b) =>
          new Date((b.filingDate as string | number) || 0).getTime() -
          new Date((a.filingDate as string | number) || 0).getTime()
      )

      return {
        searchType: nationwide ? 'nationwide' : 'state',
        state: stateStr,
        sourcesQueried: sourcesToQuery.length,
        sourcesSucceeded: results.length,
        sourcesFailed: errors.length,
        totalFilings: allFilings.length,
        filings: allFilings,
        errors: errors.length > 0 ? errors : undefined,
        debtorName
      }
    }, query)
  }

  protected validateQuery(query: Record<string, unknown>): boolean {
    return Boolean(query.debtorName)
  }
}
