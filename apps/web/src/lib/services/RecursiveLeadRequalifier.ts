/* eslint-disable @typescript-eslint/no-unused-vars */
// Experimental lead requalification features
import type {
  Prospect,
  RequalificationLead,
  NetworkRequalification,
  NetworkRecommendation,
  CompanyGraph,
  GrowthSignal
} from '@public-records/core'
import { RecursiveRelationshipMapper } from './RecursiveRelationshipMapper'

/**
 * RecursiveLeadRequalifier - Network-aware lead re-qualification
 * Recursively requalifies leads and their network connections
 */
export class RecursiveLeadRequalifier {
  private prospects: Prospect[]
  private relationshipMapper: RecursiveRelationshipMapper

  constructor(prospects: Prospect[], relationshipMapper: RecursiveRelationshipMapper) {
    this.prospects = prospects
    this.relationshipMapper = relationshipMapper
  }

  /**
   * Requalify a lead and its network recursively
   */
  async requalifyWithNetwork(
    leadId: string,
    maxDepth: number = 2
  ): Promise<NetworkRequalification> {
    const startTime = Date.now()
    const rootLead = this.prospects.find((p) => p.id === leadId)

    if (!rootLead) {
      throw new Error(`Lead ${leadId} not found`)
    }

    // Build relationship graph
    const networkGraph = await this.relationshipMapper.buildRelationshipGraph(leadId, {
      maxDepth,
      relationshipTypes: ['parent', 'subsidiary', 'affiliate', 'common_secured_party'],
      includeProspectData: true,
      stopConditions: {
        maxNodes: 50
      }
    })

    // Requalify root lead
    const requalifiedLeads: RequalificationLead[] = []
    const rootRequalification = await this.requalifyLead(rootLead)
    requalifiedLeads.push(rootRequalification)

    // Recursively requalify connected leads
    await this.requalifyNetworkRecursively(networkGraph, requalifiedLeads, 0, maxDepth)

    // Generate network recommendations
    const recommendations = this.generateNetworkRecommendations(requalifiedLeads, networkGraph)

    // Calculate total opportunity value
    const totalOpportunityValue = requalifiedLeads
      .filter((l) => l.recommendation === 'revive')
      .reduce((sum, l) => sum + (l.originalProspect.estimatedRevenue || 0), 0)

    return {
      rootLeadId: leadId,
      requalifiedLeads,
      networkGraph,
      totalOpportunityValue,
      recommendations,
      executionDepth: maxDepth,
      completedAt: new Date().toISOString()
    }
  }

  /**
   * Recursively requalify network connections
   */
  private async requalifyNetworkRecursively(
    graph: CompanyGraph,
    requalifiedLeads: RequalificationLead[],
    currentDepth: number,
    maxDepth: number
  ): Promise<void> {
    if (currentDepth >= maxDepth) return

    const processedIds = new Set(requalifiedLeads.map((l) => l.id))

    for (const node of graph.nodes.values()) {
      if (!processedIds.has(node.id) && node.prospect) {
        const requalification = await this.requalifyLead(node.prospect)

        requalifiedLeads.push(requalification)
        processedIds.add(node.id)

        // If lead should be revived, check its connections too
        if (requalification.recommendation === 'revive' && currentDepth + 1 < maxDepth) {
          // Get related prospects
          const relatedNodes = this.relationshipMapper.getRelatedCompanies(node.id, graph, [
            'parent',
            'subsidiary',
            'affiliate'
          ])

          for (const relatedNode of relatedNodes) {
            if (!processedIds.has(relatedNode.id) && relatedNode.prospect) {
              const relatedRequalification = await this.requalifyLead(relatedNode.prospect)
              requalifiedLeads.push(relatedRequalification)
              processedIds.add(relatedNode.id)
            }
          }
        }
      }
    }
  }

  /**
   * Requalify a single lead
   */
  private async requalifyLead(prospect: Prospect): Promise<RequalificationLead> {
    // Check if already qualified
    if (prospect.status === 'qualified') {
      return {
        id: `requalification-${prospect.id}-${Date.now()}`,
        originalProspect: prospect,
        newSignals: [],
        netScore: prospect.priorityScore,
        recommendation: 'dismiss',
        reasoning: 'Already qualified'
      }
    }

    // Detect newly sourced signals if live enrichment is wired.
    const newSignals = await this.detectNewSignals(prospect)

    // Calculate net score
    const netScore = this.calculateNetScore(prospect, newSignals)

    // Determine recommendation
    const shouldRevive = this.shouldRevive(prospect, newSignals, netScore)

    const reasoning = this.generateReasoning(prospect, newSignals, netScore, shouldRevive)

    return {
      id: `requalification-${prospect.id}-${Date.now()}`,
      originalProspect: prospect,
      newSignals,
      netScore,
      recommendation: shouldRevive ? 'revive' : 'dismiss',
      reasoning
    }
  }

  /**
   * Detect new signals for a prospect
   */
  private async detectNewSignals(prospect: Prospect): Promise<GrowthSignal[]> {
    void prospect
    return []
  }

  /**
   * Calculate net score for requalification
   */
  private calculateNetScore(prospect: Prospect, newSignals: GrowthSignal[]): number {
    let score = prospect.priorityScore

    // Add points for new signals
    score += newSignals.reduce((sum, s) => sum + s.score * s.confidence, 0)

    // Adjust for time since default
    if (prospect.timeSinceDefault > 730) {
      score -= 20 // Penalize very old defaults
    } else if (prospect.timeSinceDefault < 90) {
      score += 10 // Boost recent defaults
    }

    // Adjust for health trend
    if (prospect.healthScore.sentimentTrend === 'improving') {
      score += 15
    } else if (prospect.healthScore.sentimentTrend === 'declining') {
      score -= 15
    }

    return Math.max(0, Math.min(100, score))
  }

  /**
   * Determine if lead should be revived
   */
  private shouldRevive(prospect: Prospect, newSignals: GrowthSignal[], netScore: number): boolean {
    // Must have at least one new signal
    if (newSignals.length === 0) return false

    // Net score must be above threshold
    if (netScore < 60) return false

    // Don't revive if status is already good
    if (prospect.status === 'qualified' || prospect.status === 'contacted') return false

    // Don't revive if health is very poor
    if (prospect.healthScore.grade === 'F') return false

    return true
  }

  /**
   * Generate reasoning for recommendation
   */
  private generateReasoning(
    prospect: Prospect,
    newSignals: GrowthSignal[],
    netScore: number,
    shouldRevive: boolean
  ): string {
    if (shouldRevive) {
      const reasons: string[] = []

      if (newSignals.length > 0) {
        reasons.push(`${newSignals.length} new growth signal(s) detected`)
      }

      if (prospect.healthScore.sentimentTrend === 'improving') {
        reasons.push('Improving health trend')
      }

      if (netScore >= 75) {
        reasons.push(`Strong net score of ${netScore}`)
      }

      return `REVIVE: ${reasons.join('; ')}`
    } else {
      const reasons: string[] = []

      if (newSignals.length === 0) {
        reasons.push('No new signals detected')
      }

      if (netScore < 60) {
        reasons.push(`Low net score of ${netScore}`)
      }

      if (prospect.healthScore.grade === 'F') {
        reasons.push('Poor health grade')
      }

      if (prospect.timeSinceDefault > 730) {
        reasons.push('Very old default (>2 years)')
      }

      return `DISMISS: ${reasons.join('; ')}`
    }
  }

  /**
   * Generate network-based recommendations
   */
  private generateNetworkRecommendations(
    requalifiedLeads: RequalificationLead[],
    graph: CompanyGraph
  ): NetworkRecommendation[] {
    const recommendations: NetworkRecommendation[] = []

    // Find clusters of revivable leads
    const revivableLeads = requalifiedLeads.filter((l) => l.recommendation === 'revive')

    if (revivableLeads.length >= 2) {
      // Check if they're connected
      const clusters = this.relationshipMapper.identifyClusters(graph)

      for (const [clusterId, nodeIds] of clusters.entries()) {
        const clusterRevivable = revivableLeads.filter((l) => nodeIds.has(l.originalProspect.id))

        if (clusterRevivable.length >= 2) {
          recommendations.push({
            type: 'cluster_approach',
            targetCompanies: clusterRevivable.map((l) => l.originalProspect.id),
            reasoning: `Cluster of ${clusterRevivable.length} related revivable companies`,
            estimatedValue: clusterRevivable.reduce(
              (sum, l) => sum + (l.originalProspect.estimatedRevenue || 0),
              0
            ),
            confidence: 0.8,
            priority: 1
          })
        }
      }
    }

    // Find cross-sell opportunities
    for (const lead of revivableLeads) {
      const related = this.relationshipMapper.getRelatedCompanies(lead.originalProspect.id, graph, [
        'parent',
        'subsidiary',
        'affiliate'
      ])

      const relatedRevivable = related.filter((node) =>
        revivableLeads.some((l) => l.originalProspect.id === node.id)
      )

      if (relatedRevivable.length > 0) {
        recommendations.push({
          type: 'cross_sell',
          targetCompanies: [lead.originalProspect.id, ...relatedRevivable.map((n) => n.id)],
          reasoning: `Lead has ${relatedRevivable.length} related revivable companies`,
          estimatedValue:
            (lead.originalProspect.estimatedRevenue || 0) +
            relatedRevivable.reduce((sum, n) => sum + (n.prospect?.estimatedRevenue || 0), 0),
          confidence: 0.75,
          priority: 2
        })
      }
    }

    // Sort by priority and confidence
    return recommendations.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority
      return b.confidence - a.confidence
    })
  }

  /**
   * Batch requalify multiple leads
   */
  async batchRequalify(
    leadIds: string[],
    includeNetwork: boolean = false
  ): Promise<RequalificationLead[]> {
    const results: RequalificationLead[] = []

    for (const leadId of leadIds) {
      if (includeNetwork) {
        const networkResult = await this.requalifyWithNetwork(leadId, 1)
        results.push(...networkResult.requalifiedLeads)
      } else {
        const lead = this.prospects.find((p) => p.id === leadId)
        if (lead) {
          const result = await this.requalifyLead(lead)
          results.push(result)
        }
      }
    }

    return results
  }
}
