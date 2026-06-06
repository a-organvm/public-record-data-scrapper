/**
 * Data Enrichment Service
 *
 * Enriches prospect data with:
 * - Growth signals (hiring, permits, contracts, expansion, equipment)
 * - Health scores (sentiment analysis, violations, reviews)
 * - Revenue estimates
 * - Industry classification
 */

import {
  Prospect,
  GrowthSignal,
  HealthScore,
  HealthGrade,
  IndustryType,
  UCCFiling
} from '@public-records/core'

export interface EnrichmentSource {
  id: string
  name: string
  type: 'web-scraping' | 'api' | 'ml-inference'
  capabilities: (
    | 'growth-signals'
    | 'health-score'
    | 'revenue-estimate'
    | 'industry-classification'
  )[]
  endpoint?: string
  apiKey?: string
}

export interface EnrichmentResult {
  prospectId: string
  success: boolean
  enrichedFields: string[]
  errors: string[]
  confidence: number
  timestamp: string
}

/**
 * Thrown when an enrichment capability is requested but no live provider is
 * wired up for it. Fail-closed: we never fabricate revenue, health, or growth
 * data. Mirrors the honest-gate pattern in
 * server/services/EnrichmentService.ts ("not wired to live providers yet").
 *
 * Consumers should catch this and surface "enrichment unavailable" rather than
 * crash or invent numbers.
 */
export class EnrichmentNotConfiguredError extends Error {
  readonly capability: string

  constructor(capability: string, missing: string) {
    super(
      `Enrichment capability "${capability}" is not wired to a live provider yet. ` +
        `Missing: ${missing}. No fabricated value will be returned.`
    )
    this.name = 'EnrichmentNotConfiguredError'
    this.capability = capability
  }
}

export class DataEnrichmentService {
  private sources: EnrichmentSource[]

  constructor(sources: EnrichmentSource[]) {
    this.sources = sources
  }

  /**
   * Enrich a prospect with additional data
   */
  async enrichProspect(
    filing: UCCFiling,
    existingData?: Partial<Prospect>
  ): Promise<{ prospect: Prospect; result: EnrichmentResult }> {
    const enrichedFields: string[] = []
    const errors: string[] = []
    let totalConfidence = 0
    let confidenceCount = 0

    // Generate base prospect from UCC filing
    const prospect: Prospect = {
      id: existingData?.id || `prospect-${Date.now()}`,
      companyName: filing.debtorName,
      industry: existingData?.industry || (await this.inferIndustry(filing.debtorName)),
      state: filing.state,
      status: existingData?.status || 'new',
      priorityScore: 0, // Will be calculated later
      defaultDate: filing.filingDate,
      timeSinceDefault: this.calculateDaysSince(filing.filingDate),
      uccFilings: [filing],
      growthSignals: existingData?.growthSignals || [],
      healthScore: existingData?.healthScore || this.generateDefaultHealthScore(),
      narrative: '',
      estimatedRevenue: existingData?.estimatedRevenue
    }

    // Enrich growth signals
    try {
      const signals = await this.detectGrowthSignals(prospect.companyName, prospect.state)
      if (signals.length > 0) {
        prospect.growthSignals = signals
        enrichedFields.push('growthSignals')
        totalConfidence += signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length
        confidenceCount++
      }
    } catch (error) {
      errors.push(`Growth signals: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }

    // Enrich health score
    try {
      const healthScore = await this.calculateHealthScore(prospect.companyName, prospect.state)
      prospect.healthScore = healthScore
      enrichedFields.push('healthScore')
      totalConfidence += 0.8 // Health score confidence
      confidenceCount++
    } catch (error) {
      errors.push(`Health score: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }

    // Estimate revenue
    if (!prospect.estimatedRevenue) {
      try {
        const revenue = await this.estimateRevenue(
          prospect.companyName,
          prospect.industry,
          prospect.state,
          filing.lienAmount
        )
        prospect.estimatedRevenue = revenue
        enrichedFields.push('estimatedRevenue')
        totalConfidence += 0.7 // Revenue estimate confidence
        confidenceCount++
      } catch (error) {
        errors.push(`Revenue estimate: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    // Calculate priority score
    prospect.priorityScore = this.calculatePriorityScore(prospect)
    enrichedFields.push('priorityScore')

    // Generate narrative
    prospect.narrative = this.generateNarrative(prospect)
    enrichedFields.push('narrative')

    const avgConfidence = confidenceCount > 0 ? totalConfidence / confidenceCount : 0

    return {
      prospect,
      result: {
        prospectId: prospect.id,
        success: errors.length === 0,
        enrichedFields,
        errors,
        confidence: avgConfidence,
        timestamp: new Date().toISOString()
      }
    }
  }

  /**
   * Detect growth signals for a company
   */
  private async detectGrowthSignals(companyName: string, state: string): Promise<GrowthSignal[]> {
    const signals: GrowthSignal[] = []

    // Check hiring signals (job postings)
    const hiringSignals = await this.detectHiringSignals(companyName)
    signals.push(...hiringSignals)

    // Check permit signals (building permits, business licenses)
    const permitSignals = await this.detectPermitSignals(companyName, state)
    signals.push(...permitSignals)

    // Check contract signals (government contracts, RFPs)
    const contractSignals = await this.detectContractSignals(companyName)
    signals.push(...contractSignals)

    // Check expansion signals (news, press releases)
    const expansionSignals = await this.detectExpansionSignals(companyName)
    signals.push(...expansionSignals)

    // Check equipment signals (equipment financing, leases)
    const equipmentSignals = await this.detectEquipmentSignals(companyName)
    signals.push(...equipmentSignals)

    return signals.sort(
      (a, b) => new Date(b.detectedDate).getTime() - new Date(a.detectedDate).getTime()
    )
  }

  private async detectHiringSignals(companyName: string): Promise<GrowthSignal[]> {
    // Fail closed: a real implementation would scrape job boards (Indeed,
    // LinkedIn, etc.). No live provider is wired, so we refuse rather than
    // fabricate signals.
    void companyName
    throw new EnrichmentNotConfiguredError(
      'growth-signals:hiring',
      'job-board scraping provider (Indeed/LinkedIn)'
    )
  }

  private async detectPermitSignals(companyName: string, state: string): Promise<GrowthSignal[]> {
    // Fail closed: a real implementation would scrape municipal permit
    // databases.
    void companyName
    void state
    throw new EnrichmentNotConfiguredError(
      'growth-signals:permits',
      'municipal permit database provider'
    )
  }

  private async detectContractSignals(companyName: string): Promise<GrowthSignal[]> {
    // Fail closed: a real implementation would check government contract
    // databases (USASpending.gov, etc.).
    void companyName
    throw new EnrichmentNotConfiguredError(
      'growth-signals:contracts',
      'government contract database provider (USASpending)'
    )
  }

  private async detectExpansionSignals(companyName: string): Promise<GrowthSignal[]> {
    // Fail closed: a real implementation would scrape news, press releases,
    // business journals.
    void companyName
    throw new EnrichmentNotConfiguredError(
      'growth-signals:expansion',
      'news / press-release provider'
    )
  }

  private async detectEquipmentSignals(companyName: string): Promise<GrowthSignal[]> {
    // Fail closed: a real implementation would check equipment financing
    // databases.
    void companyName
    throw new EnrichmentNotConfiguredError(
      'growth-signals:equipment',
      'equipment financing database provider'
    )
  }

  /**
   * Calculate health score for a company.
   *
   * Fail closed: a real implementation would scrape reviews (Google/Yelp/BBB),
   * check violation databases, and analyze sentiment. None of that is wired, so
   * we throw rather than return a fabricated grade.
   */
  private async calculateHealthScore(companyName: string, state: string): Promise<HealthScore> {
    void companyName
    void state
    throw new EnrichmentNotConfiguredError(
      'health-score',
      'review/sentiment + violation-database providers'
    )
  }

  /**
   * Estimate company revenue.
   *
   * Fail closed: a real implementation would use an ML model or a commercial
   * data provider. Deriving revenue from a random multiple of the lien amount
   * (or a random point inside an industry band) is fabrication, so we throw.
   */
  private async estimateRevenue(
    companyName: string,
    industry: IndustryType,
    state: string,
    lienAmount?: number
  ): Promise<number> {
    void companyName
    void industry
    void state
    void lienAmount
    throw new EnrichmentNotConfiguredError(
      'revenue-estimate',
      'ML revenue model or commercial revenue-data provider'
    )
  }

  /**
   * Infer industry from company name
   */
  private async inferIndustry(companyName: string): Promise<IndustryType> {
    const nameLower = companyName.toLowerCase()

    // Simple keyword-based classification
    if (
      nameLower.includes('restaurant') ||
      nameLower.includes('cafe') ||
      nameLower.includes('food')
    ) {
      return 'restaurant'
    }
    if (nameLower.includes('retail') || nameLower.includes('store') || nameLower.includes('shop')) {
      return 'retail'
    }
    if (
      nameLower.includes('construction') ||
      nameLower.includes('builder') ||
      nameLower.includes('contractor')
    ) {
      return 'construction'
    }
    if (
      nameLower.includes('health') ||
      nameLower.includes('medical') ||
      nameLower.includes('care')
    ) {
      return 'healthcare'
    }
    if (
      nameLower.includes('manufacturing') ||
      nameLower.includes('factory') ||
      nameLower.includes('industrial')
    ) {
      return 'manufacturing'
    }
    if (
      nameLower.includes('tech') ||
      nameLower.includes('software') ||
      nameLower.includes('digital')
    ) {
      return 'technology'
    }

    // Default to services
    return 'services'
  }

  /**
   * Return an explicit "health unavailable" placeholder.
   *
   * Fail closed: this is NOT a fabricated grade. It is a typed sentinel meaning
   * "no health data has been collected yet" — score 0, grade 'F' (worst, so it
   * never inflates priority), zero reviews/violations, and a sentinel
   * lastUpdated of '' so consumers can distinguish "never enriched" from a real
   * timestamp. Real values only arrive once calculateHealthScore is wired to a
   * live provider.
   */
  static readonly UNAVAILABLE_HEALTH_SCORE: HealthScore = {
    grade: 'F' as HealthGrade,
    score: 0,
    sentimentTrend: 'stable',
    reviewCount: 0,
    avgSentiment: 0,
    violationCount: 0,
    lastUpdated: ''
  }

  private generateDefaultHealthScore(): HealthScore {
    return { ...DataEnrichmentService.UNAVAILABLE_HEALTH_SCORE }
  }

  /**
   * Calculate priority score
   */
  private calculatePriorityScore(prospect: Prospect): number {
    const timeSinceDefault = prospect.timeSinceDefault
    const signalScore = prospect.growthSignals.reduce((sum, s) => sum + s.score, 0)
    const healthScore = prospect.healthScore.score

    // Priority formula:
    // - Time since default (older = higher priority, max at 4 years)
    // - Growth signals (more signals = higher priority)
    // - Health score (healthier = higher priority)

    const defaultScore = Math.min(50, timeSinceDefault / 14) // Max 50 points
    const growthScore = Math.min(30, signalScore) // Max 30 points
    const healthPoints = healthScore * 0.2 // Max 20 points

    return Math.min(100, Math.round(defaultScore + growthScore + healthPoints))
  }

  /**
   * Generate narrative for prospect
   */
  private generateNarrative(prospect: Prospect): string {
    const parts: string[] = []

    // Default info
    const years = Math.floor(prospect.timeSinceDefault / 365)
    if (years > 0) {
      parts.push(
        `Defaulted ${years} year${years > 1 ? 's' : ''} ago on ${prospect.uccFilings[0].filingType} filing`
      )
    }

    // Growth signals
    if (prospect.growthSignals.length > 0) {
      const topSignals = prospect.growthSignals
        .slice(0, 2)
        .map((s) => s.type)
        .join(', ')
      parts.push(
        `showing ${prospect.growthSignals.length} growth signal${prospect.growthSignals.length > 1 ? 's' : ''} (${topSignals})`
      )
    }

    // Health grade
    parts.push(`Current health grade: ${prospect.healthScore.grade}`)

    // Sentiment
    if (prospect.healthScore.sentimentTrend === 'improving') {
      parts.push('sentiment improving')
    } else if (prospect.healthScore.sentimentTrend === 'declining') {
      parts.push('sentiment declining')
    }

    return parts.join(', ')
  }

  /**
   * Calculate days since a date
   */
  private calculateDaysSince(dateString: string): number {
    const date = new Date(dateString)
    const now = new Date()
    return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
  }

  /**
   * Batch enrich multiple prospects
   */
  async enrichProspects(
    filings: UCCFiling[],
    concurrency: number = 5
  ): Promise<{ prospects: Prospect[]; results: EnrichmentResult[] }> {
    const prospects: Prospect[] = []
    const results: EnrichmentResult[] = []

    // Process in batches to avoid overwhelming external services
    for (let i = 0; i < filings.length; i += concurrency) {
      const batch = filings.slice(i, i + concurrency)
      const batchPromises = batch.map((filing) => this.enrichProspect(filing))

      const batchResults = await Promise.all(batchPromises)

      batchResults.forEach(({ prospect, result }) => {
        prospects.push(prospect)
        results.push(result)
      })

      // Small delay between batches
      if (i + concurrency < filings.length) {
        await this.delay(1000)
      }
    }

    return { prospects, results }
  }

  /**
   * Refresh stale data for existing prospects
   */
  async refreshProspectData(
    prospect: Prospect,
    fields?: ('growthSignals' | 'healthScore' | 'estimatedRevenue')[]
  ): Promise<{ prospect: Prospect; result: EnrichmentResult }> {
    const refreshFields = fields || ['growthSignals', 'healthScore']
    const enrichedFields: string[] = []
    const errors: string[] = []

    const updatedProspect = { ...prospect }

    if (refreshFields.includes('growthSignals')) {
      try {
        const signals = await this.detectGrowthSignals(prospect.companyName, prospect.state)
        updatedProspect.growthSignals = signals
        enrichedFields.push('growthSignals')
      } catch (error) {
        errors.push(
          `Growth signals refresh: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      }
    }

    if (refreshFields.includes('healthScore')) {
      try {
        const healthScore = await this.calculateHealthScore(prospect.companyName, prospect.state)
        updatedProspect.healthScore = healthScore
        enrichedFields.push('healthScore')
      } catch (error) {
        errors.push(
          `Health score refresh: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      }
    }

    if (refreshFields.includes('estimatedRevenue')) {
      try {
        const revenue = await this.estimateRevenue(
          prospect.companyName,
          prospect.industry,
          prospect.state,
          prospect.uccFilings[0]?.lienAmount
        )
        updatedProspect.estimatedRevenue = revenue
        enrichedFields.push('estimatedRevenue')
      } catch (error) {
        errors.push(`Revenue refresh: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    // Recalculate priority and narrative
    updatedProspect.priorityScore = this.calculatePriorityScore(updatedProspect)
    updatedProspect.narrative = this.generateNarrative(updatedProspect)

    return {
      prospect: updatedProspect,
      result: {
        prospectId: prospect.id,
        success: errors.length === 0,
        enrichedFields,
        errors,
        confidence: 0.85,
        timestamp: new Date().toISOString()
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

/**
 * Default enrichment sources
 */
export const defaultEnrichmentSources: EnrichmentSource[] = [
  {
    id: 'web-scraper',
    name: 'Web Scraper',
    type: 'web-scraping',
    capabilities: ['growth-signals', 'health-score']
  },
  {
    id: 'ml-inference',
    name: 'ML Inference Engine',
    type: 'ml-inference',
    capabilities: ['revenue-estimate', 'industry-classification']
  }
]
