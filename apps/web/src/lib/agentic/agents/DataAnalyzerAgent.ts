/**
 * Data Analyzer Agent
 *
 * Analyzes data quality, identifies patterns, and suggests improvements
 * to data collection and processing.
 */

import { BaseAgent } from '../BaseAgent'
import { AgentAnalysis, SystemContext, Finding, ImprovementSuggestion } from '../types'
import type { Prospect } from '@public-records/core'

export class DataAnalyzerAgent extends BaseAgent {
  constructor() {
    super('data-analyzer', 'Data Analyzer', [
      'Data quality assessment',
      'Pattern detection',
      'Data freshness monitoring',
      'Missing data identification',
      'Anomaly detection'
    ])
  }

  async analyze(context: SystemContext): Promise<AgentAnalysis> {
    const findings: Finding[] = []
    const improvements: ImprovementSuggestion[] = []

    // Check data freshness
    const staleDataCheck = this.checkDataFreshness(context)
    if (staleDataCheck) findings.push(staleDataCheck)

    // Check for data quality issues
    const qualityIssues = this.assessDataQuality(context)
    findings.push(...qualityIssues)

    // Analyze data completeness
    const completenessCheck = this.checkDataCompleteness(context)
    if (completenessCheck) findings.push(completenessCheck)

    // Generate improvement suggestions
    if (findings.some((f) => f.category === 'data-quality')) {
      improvements.push(this.suggestDataQualityImprovement(findings))
    }

    // Suggest automated data refresh
    if (findings.some((f) => f.description.includes('stale'))) {
      improvements.push(this.suggestAutomatedRefresh())
    }

    return this.createAnalysis(findings, improvements)
  }

  private checkDataFreshness(context: SystemContext): Finding | null {
    // Nothing to analyze (and avoids division by zero below).
    if (context.prospects.length === 0) {
      return null
    }

    const now = new Date()
    let staleCount = 0

    ;(context.prospects as Prospect[]).forEach((p) => {
      if (p.healthScore?.lastUpdated) {
        const lastUpdate = new Date(p.healthScore.lastUpdated)
        const daysSinceUpdate = (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24)
        if (daysSinceUpdate > 7) staleCount++
      }
    })

    if (staleCount > 0) {
      return this.createFinding(
        'data-quality',
        staleCount > context.prospects.length * 0.3 ? 'critical' : 'warning',
        `Found ${staleCount} prospects with stale health scores (>7 days old)`,
        {
          staleCount,
          totalProspects: context.prospects.length,
          percentage: ((staleCount / context.prospects.length) * 100).toFixed(1)
        }
      )
    }
    return null
  }

  private assessDataQuality(context: SystemContext): Finding[] {
    const findings: Finding[] = []
    let incompleteCount = 0
    let missingSignalsCount = 0

    ;(context.prospects as Prospect[]).forEach((p) => {
      if (!p.estimatedRevenue) incompleteCount++
      if (!p.growthSignals || p.growthSignals.length === 0) missingSignalsCount++
    })

    if (incompleteCount > 0) {
      findings.push(
        this.createFinding(
          'data-quality',
          'info',
          `${incompleteCount} prospects missing revenue estimates`,
          { incompleteCount, field: 'estimatedRevenue' }
        )
      )
    }

    if (missingSignalsCount > 0) {
      findings.push(
        this.createFinding(
          'data-quality',
          'warning',
          `${missingSignalsCount} prospects have no growth signals`,
          { missingSignalsCount }
        )
      )
    }

    return findings
  }

  private checkDataCompleteness(context: SystemContext): Finding | null {
    // No prospects means no completeness to measure; returning early avoids a
    // NaN result from dividing by zero.
    if (context.prospects.length === 0) {
      return null
    }

    const totalFields = 10 // Expected fields per prospect
    let totalCompleteness = 0

    ;(context.prospects as Prospect[]).forEach((p) => {
      let filledFields = 0
      if (p.companyName) filledFields++
      if (p.industry) filledFields++
      if (p.state) filledFields++
      if (p.priorityScore) filledFields++
      if (p.defaultDate) filledFields++
      if (p.estimatedRevenue) filledFields++
      if (p.narrative) filledFields++
      if (p.healthScore) filledFields++
      if (p.uccFilings && p.uccFilings.length > 0) filledFields++
      if (p.growthSignals && p.growthSignals.length > 0) filledFields++

      totalCompleteness += filledFields / totalFields
    })

    const avgCompleteness = (totalCompleteness / context.prospects.length) * 100

    if (avgCompleteness < 80) {
      return this.createFinding(
        'data-quality',
        avgCompleteness < 60 ? 'critical' : 'warning',
        `Average data completeness is ${avgCompleteness.toFixed(1)}%`,
        { avgCompleteness, threshold: 80 }
      )
    }

    return null
  }

  private suggestDataQualityImprovement(findings: Finding[]): ImprovementSuggestion {
    return this.createImprovement(
      'data-quality',
      'high',
      'Implement automated data enrichment pipeline',
      'Create a background process to automatically fill missing data fields using external sources and ML inference',
      `Multiple data quality issues detected: ${findings.map((f) => f.description).join('; ')}`,
      'Improve data completeness from current state to >90%, enabling better decision-making',
      true,
      75,
      {
        steps: [
          'Create data enrichment service',
          'Integrate external data sources',
          'Implement ML-based inference for missing fields',
          'Schedule periodic enrichment jobs'
        ],
        risks: [
          'External API rate limits',
          'Data accuracy from third-party sources',
          'Increased processing time'
        ],
        rollbackPlan: [
          'Disable enrichment service',
          'Revert to manual data entry',
          'Clear enriched data flags'
        ],
        validationCriteria: [
          'Data completeness >90%',
          'No data quality regressions',
          'Enrichment accuracy >85%'
        ]
      }
    )
  }

  private suggestAutomatedRefresh(): ImprovementSuggestion {
    return this.createImprovement(
      'data-quality',
      'medium',
      'Enable automatic health score refresh',
      'Implement a scheduled job to automatically refresh stale health scores',
      'Detected stale health scores affecting decision quality',
      'Ensure all data is fresh within 7 days, improving accuracy of prospect prioritization',
      true,
      90,
      {
        steps: [
          'Create refresh scheduler',
          'Implement health score recalculation logic',
          'Add refresh status tracking',
          'Set up monitoring for refresh jobs'
        ],
        risks: ['Increased system load', 'API rate limits from external sources'],
        rollbackPlan: ['Disable scheduler', 'Revert to manual refresh'],
        validationCriteria: [
          'All health scores <7 days old',
          'Refresh job success rate >95%',
          'No performance degradation'
        ]
      }
    )
  }
}
