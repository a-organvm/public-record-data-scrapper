/* eslint-disable no-case-declarations */
// Experimental recursive enrichment features
import type {
  Prospect,
  EnrichmentPlan,
  EnrichmentStep,
  RecursiveEnrichmentResult,
  GrowthSignal,
  HealthScore
} from '@public-records/core'

/**
 * RecursiveEnrichmentEngine - Adaptive data enrichment with recursive strategies
 * Dynamically plans and executes enrichment based on data quality and availability
 */
export class RecursiveEnrichmentEngine {
  private prospects: Prospect[]
  private enrichmentHistory: Map<string, EnrichmentPlan[]> = new Map()

  constructor(prospects: Prospect[]) {
    this.prospects = prospects
  }

  /**
   * Enrich a prospect recursively with adaptive strategy
   */
  async enrichProspectRecursively(
    prospectId: string,
    maxDepth: number = 3
  ): Promise<RecursiveEnrichmentResult> {
    const startTime = Date.now()
    const prospect = this.prospects.find((p) => p.id === prospectId)

    if (!prospect) {
      throw new Error(`Prospect ${prospectId} not found`)
    }

    const originalProspect = { ...prospect }

    // Create initial enrichment plan
    const plan = await this.createEnrichmentPlan(prospect, maxDepth)

    // Execute plan recursively
    const enrichedProspect = await this.executeEnrichmentPlanRecursively(
      prospect,
      plan,
      0,
      maxDepth
    )

    // Calculate improvements
    const improvements = this.calculateImprovements(originalProspect, enrichedProspect)

    // Store history
    this.storeEnrichmentHistory(prospectId, plan)

    const duration = Date.now() - startTime

    return {
      prospectId,
      originalProspect,
      enrichedProspect,
      executedSteps: plan.steps.filter((s) => plan.completedSteps.includes(s.id)),
      improvements,
      totalDepth: plan.currentDepth,
      duration
    }
  }

  /**
   * Create an adaptive enrichment plan based on prospect data quality
   */
  private async createEnrichmentPlan(
    prospect: Prospect,
    maxDepth: number
  ): Promise<EnrichmentPlan> {
    const steps: EnrichmentStep[] = []
    let stepId = 0

    // Analyze data completeness
    const dataGaps = this.analyzeDataGaps(prospect)

    // Revenue enrichment
    if (!prospect.estimatedRevenue || dataGaps.revenue) {
      steps.push({
        id: `step-${stepId++}`,
        name: 'Revenue Estimation',
        type: 'revenue',
        priority: 1,
        dependencies: [],
        estimatedDuration: 2000
      })
    }

    // Industry refinement
    if (dataGaps.industry) {
      steps.push({
        id: `step-${stepId++}`,
        name: 'Industry Classification',
        type: 'industry',
        priority: 2,
        dependencies: [],
        estimatedDuration: 1500
      })
    }

    // Growth signal detection
    if (prospect.growthSignals.length === 0 || dataGaps.signals) {
      steps.push({
        id: `step-${stepId++}`,
        name: 'Growth Signal Detection',
        type: 'signals',
        priority: 3,
        dependencies: ['step-0'], // May depend on revenue
        estimatedDuration: 3000
      })
    }

    // Health score calculation
    if (dataGaps.health) {
      steps.push({
        id: `step-${stepId++}`,
        name: 'Health Score Update',
        type: 'health',
        priority: 4,
        dependencies: [],
        estimatedDuration: 2500
      })
    }

    // Relationship mapping
    if (dataGaps.relationships) {
      steps.push({
        id: `step-${stepId++}`,
        name: 'Relationship Mapping',
        type: 'relationships',
        priority: 5,
        dependencies: ['step-0', 'step-1'], // May need revenue and industry
        estimatedDuration: 4000
      })
    }

    // Market positioning
    steps.push({
      id: `step-${stepId++}`,
      name: 'Market Positioning',
      type: 'market',
      priority: 6,
      dependencies: ['step-1', 'step-2'], // Needs industry and signals
      estimatedDuration: 2000
    })

    // Sort by priority
    steps.sort((a, b) => a.priority - b.priority)

    return {
      prospectId: prospect.id,
      steps,
      currentDepth: 0,
      maxDepth,
      adaptiveStrategy: true,
      completedSteps: [],
      createdAt: new Date().toISOString()
    }
  }

  /**
   * Execute enrichment plan recursively
   */
  private async executeEnrichmentPlanRecursively(
    prospect: Prospect,
    plan: EnrichmentPlan,
    currentDepth: number,
    maxDepth: number
  ): Promise<Prospect> {
    if (currentDepth >= maxDepth) {
      return prospect
    }

    let enrichedProspect = { ...prospect }

    // Execute each step in order
    for (const step of plan.steps) {
      // Check dependencies
      const dependenciesMet = step.dependencies.every((depId) =>
        plan.completedSteps.includes(depId)
      )

      if (!dependenciesMet) {
        continue
      }

      // Execute step
      enrichedProspect = await this.executeEnrichmentStep(enrichedProspect, step)
      plan.completedSteps.push(step.id)
      plan.currentDepth = currentDepth + 1

      // Adaptive strategy: Re-plan if new opportunities discovered
      if (plan.adaptiveStrategy) {
        const newGaps = this.analyzeDataGaps(enrichedProspect)
        const hasNewOpportunities = this.hasNewEnrichmentOpportunities(
          prospect,
          enrichedProspect,
          newGaps
        )

        if (hasNewOpportunities && currentDepth + 1 < maxDepth) {
          // Create sub-plan for new opportunities
          const subPlan = await this.createEnrichmentPlan(enrichedProspect, maxDepth)
          const newSteps = subPlan.steps.filter(
            (s) => !plan.steps.some((existingStep) => existingStep.name === s.name)
          )

          if (newSteps.length > 0) {
            // Recursively enrich with new steps
            enrichedProspect = await this.executeEnrichmentPlanRecursively(
              enrichedProspect,
              { ...plan, steps: newSteps },
              currentDepth + 1,
              maxDepth
            )
          }
        }
      }
    }

    return enrichedProspect
  }

  /**
   * Execute a single enrichment step
   */
  private async executeEnrichmentStep(prospect: Prospect, step: EnrichmentStep): Promise<Prospect> {
    const enriched = { ...prospect }

    switch (step.type) {
      case 'revenue':
        enriched.estimatedRevenue = await this.estimateRevenue(prospect)
        break

      case 'industry':
        // Industry is already set, but could refine
        break

      case 'signals':
        const newSignals = await this.detectGrowthSignals(prospect)
        enriched.growthSignals = [...prospect.growthSignals, ...newSignals]
        break

      case 'health':
        enriched.healthScore = await this.calculateHealthScore(prospect)
        break

      case 'relationships':
        // Would integrate with RecursiveRelationshipMapper
        break

      case 'market':
        // Would integrate with market data services
        break
    }

    return enriched
  }

  /**
   * Analyze data gaps in a prospect
   */
  private analyzeDataGaps(prospect: Prospect): {
    revenue: boolean
    industry: boolean
    signals: boolean
    health: boolean
    relationships: boolean
  } {
    return {
      revenue: !prospect.estimatedRevenue || prospect.estimatedRevenue === 0,
      industry: !prospect.industry || prospect.industry === 'services', // Generic fallback
      signals: prospect.growthSignals.length < 2, // Could use more signals
      health:
        prospect.healthScore.score === 0 ||
        prospect.healthScore.reviewCount === 0 ||
        !prospect.healthScore.lastUpdated ||
        this.isStale(prospect.healthScore.lastUpdated),
      relationships: false // Would check relationship data
    }
  }

  /**
   * Check if timestamp is stale (>30 days old)
   */
  private isStale(timestamp: string): boolean {
    const date = new Date(timestamp)
    const now = new Date()
    const daysDiff = (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
    return daysDiff > 30
  }

  /**
   * Check if new enrichment opportunities exist
   */
  private hasNewEnrichmentOpportunities(
    originalProspect: Prospect,
    enrichedProspect: Prospect,
    gaps: ReturnType<typeof this.analyzeDataGaps>
  ): boolean {
    // New signals might enable relationship mapping
    if (
      enrichedProspect.growthSignals.length > originalProspect.growthSignals.length &&
      gaps.relationships
    ) {
      return true
    }

    // New revenue estimate might enable better industry classification
    if (enrichedProspect.estimatedRevenue && !originalProspect.estimatedRevenue && gaps.industry) {
      return true
    }

    return false
  }

  /**
   * Calculate improvements between original and enriched prospect
   */
  private calculateImprovements(
    original: Prospect,
    enriched: Prospect
  ): RecursiveEnrichmentResult['improvements'] {
    const originalFields = this.countNonEmptyFields(original)
    const enrichedFields = this.countNonEmptyFields(enriched)

    const dataCompleteness = ((enrichedFields - originalFields) / originalFields) * 100

    // Calculate confidence increase
    let confidenceIncrease = 0
    if (enriched.estimatedRevenue && !original.estimatedRevenue) {
      confidenceIncrease += 15
    }
    if (enriched.growthSignals.length > original.growthSignals.length) {
      confidenceIncrease += (enriched.growthSignals.length - original.growthSignals.length) * 5
    }
    if (enriched.healthScore.score > original.healthScore.score) {
      confidenceIncrease += 10
    }

    // Identify new fields
    const newFieldsAdded: string[] = []
    if (enriched.estimatedRevenue && !original.estimatedRevenue) {
      newFieldsAdded.push('estimatedRevenue')
    }
    if (enriched.growthSignals.length > original.growthSignals.length) {
      newFieldsAdded.push(
        ...enriched.growthSignals
          .slice(original.growthSignals.length)
          .map((s) => `growthSignal:${s.type}`)
      )
    }

    return {
      dataCompleteness,
      confidenceIncrease,
      newFieldsAdded
    }
  }

  /**
   * Count non-empty fields in a prospect
   */
  private countNonEmptyFields(prospect: Prospect): number {
    let count = 0

    if (prospect.estimatedRevenue) count++
    if (prospect.industry) count++
    if (prospect.growthSignals.length > 0) count += prospect.growthSignals.length
    if (prospect.healthScore.score > 0) count++
    if (prospect.healthScore.reviewCount > 0) count++
    if (prospect.uccFilings.length > 0) count++
    if (prospect.narrative) count++

    return count
  }

  /**
   * Store enrichment history
   */
  private storeEnrichmentHistory(prospectId: string, plan: EnrichmentPlan): void {
    const history = this.enrichmentHistory.get(prospectId) || []
    history.push(plan)
    this.enrichmentHistory.set(prospectId, history)
  }

  /**
   * Estimate revenue (implementation)
   */
  private async estimateRevenue(prospect: Prospect): Promise<number> {
    // Simple heuristic: 4-6x total lien amount
    const totalLiens = prospect.uccFilings.reduce((sum, f) => sum + (f.lienAmount || 0), 0)

    if (totalLiens === 0) {
      // Fallback to industry averages
      const industryAverages: Record<string, number> = {
        restaurant: 1500000,
        retail: 2000000,
        construction: 3000000,
        healthcare: 4000000,
        manufacturing: 5000000,
        services: 1800000,
        technology: 3500000
      }

      return industryAverages[prospect.industry] || 2000000
    }

    // Use 5x as middle ground
    const multiplier = 5
    return totalLiens * multiplier
  }

  /**
   * Detect growth signals (implementation)
   */
  private async detectGrowthSignals(prospect: Prospect): Promise<GrowthSignal[]> {
    void prospect
    return []
  }

  /**
   * Calculate health score (implementation)
   */
  private async calculateHealthScore(prospect: Prospect): Promise<HealthScore> {
    // Enhanced health score calculation
    let score = prospect.healthScore.score

    // Boost for growth signals
    if (prospect.growthSignals.length > 0) {
      score += prospect.growthSignals.length * 5
    }

    // Penalize for long default period
    if (prospect.timeSinceDefault > 365) {
      score -= 10
    }

    score = Math.max(0, Math.min(100, score))

    // Determine grade
    let grade: 'A' | 'B' | 'C' | 'D' | 'F'
    if (score >= 90) grade = 'A'
    else if (score >= 80) grade = 'B'
    else if (score >= 70) grade = 'C'
    else if (score >= 60) grade = 'D'
    else grade = 'F'

    return {
      ...prospect.healthScore,
      score,
      grade,
      lastUpdated: new Date().toISOString()
    }
  }

  /**
   * Batch enrich multiple prospects
   */
  async batchEnrich(
    prospectIds: string[],
    maxDepth: number = 2,
    concurrency: number = 5
  ): Promise<RecursiveEnrichmentResult[]> {
    const results: RecursiveEnrichmentResult[] = []

    // Process in batches
    for (let i = 0; i < prospectIds.length; i += concurrency) {
      const batch = prospectIds.slice(i, i + concurrency)
      const batchResults = await Promise.all(
        batch.map((id) => this.enrichProspectRecursively(id, maxDepth))
      )
      results.push(...batchResults)
    }

    return results
  }

  /**
   * Get enrichment statistics
   */
  getEnrichmentStatistics(): {
    totalEnriched: number
    avgImprovementRate: number
    avgDepth: number
    totalStepsExecuted: number
  } {
    let totalEnriched = 0
    let totalDepth = 0
    let totalSteps = 0

    for (const history of this.enrichmentHistory.values()) {
      totalEnriched += history.length
      for (const plan of history) {
        totalDepth += plan.currentDepth
        totalSteps += plan.completedSteps.length
      }
    }

    return {
      totalEnriched,
      avgImprovementRate: 0, // Would calculate from improvement data
      avgDepth: totalEnriched > 0 ? totalDepth / totalEnriched : 0,
      totalStepsExecuted: totalSteps
    }
  }
}
