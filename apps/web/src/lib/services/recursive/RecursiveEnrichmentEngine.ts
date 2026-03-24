/**
 * Recursive Enrichment Engine - Multi-level cascading data enrichment
 * Each enrichment discovers new enrichment opportunities in a self-expanding process
 */

import type {
  RecursiveEnrichmentConfig,
  EnrichmentNode,
  EnrichmentResult,
  EnrichmentOpportunity,
  EnrichmentTree,
  EnrichmentStrategy
} from '@/types/recursive'

type EnrichmentData = {
  confidence?: number
  emails?: string[]
  linkedinProfiles?: string[]
  subsidiaries?: string[]
  estimatedRevenue?: number
  profitMargin?: number
  [key: string]: unknown
}

export class RecursiveEnrichmentEngine {
  private trees: Map<string, EnrichmentTree> = new Map()
  private strategies: Map<EnrichmentStrategy, StrategyHandler> = new Map()
  private learningData: Map<EnrichmentStrategy, StrategyPerformance> = new Map()

  constructor() {
    this.initializeStrategies()
  }

  /**
   * Start recursive enrichment for a prospect
   */
  async enrichProspect(
    prospectId: string,
    config: RecursiveEnrichmentConfig
  ): Promise<EnrichmentTree> {
    const treeId = `tree_${prospectId}_${Date.now()}`

    // Create root node
    const rootNode: EnrichmentNode = {
      id: `node_${Date.now()}_0`,
      prospectId,
      enrichmentType: 'root',
      depth: 0,
      data: { prospectId },
      confidence: 1.0,
      valueScore: 0,
      cost: 0,
      childNodes: [],
      discoveredAt: new Date(),
      source: 'initial',
      metadata: {
        dataQuality: 1.0,
        freshness: new Date(),
        reliability: 1.0,
        verificationStatus: 'unverified'
      }
    }

    // Create tree
    const tree: EnrichmentTree = {
      prospectId,
      rootNode,
      totalNodes: 1,
      maxDepth: 0,
      totalCost: 0,
      totalValue: 0,
      startedAt: new Date(),
      status: 'running'
    }

    this.trees.set(treeId, tree)

    // Start recursive expansion
    await this.expandNodeRecursively(tree, rootNode, config)

    tree.status = 'completed'
    tree.completedAt = new Date()

    return tree
  }

  /**
   * Recursively expand a node
   */
  private async expandNodeRecursively(
    tree: EnrichmentTree,
    node: EnrichmentNode,
    config: RecursiveEnrichmentConfig
  ): Promise<void> {
    // Check depth limit
    if (node.depth >= config.maxDepth) {
      return
    }

    // Check cost limit
    if (tree.totalCost >= config.costLimit) {
      console.warn('Cost limit reached, stopping enrichment')
      return
    }

    // Check time limit (if needed, implement timeout logic)

    // Evaluate enrichment opportunities
    const opportunities = await this.evaluateOpportunities(node, config)

    // Filter by confidence threshold
    const viable = opportunities.filter(
      (opp) => opp.estimatedConfidence >= config.confidenceThreshold
    )

    // Sort by priority
    viable.sort((a, b) => b.priority - a.priority)

    // Expand nodes in parallel up to parallelization limit
    const toExpand = viable.slice(0, config.parallelization)

    await Promise.all(
      toExpand.map(async (opportunity) => {
        try {
          const result = await this.expandNode(node, opportunity.strategy)

          if (result.success) {
            // Create child node
            const childNode: EnrichmentNode = {
              id: result.nodeId,
              prospectId: tree.prospectId,
              enrichmentType: opportunity.strategy,
              depth: node.depth + 1,
              parentNodeId: node.id,
              data: result.dataDiscovered,
              confidence: result.confidence,
              valueScore: 0, // Will be learned over time
              cost: result.cost,
              childNodes: [],
              discoveredAt: new Date(),
              source: `strategy_${opportunity.strategy}`,
              metadata: {
                dataQuality: result.confidence,
                freshness: new Date(),
                reliability: result.confidence,
                verificationStatus: 'unverified'
              }
            }

            node.childNodes.push(childNode)
            tree.totalNodes++
            tree.totalCost += result.cost
            tree.maxDepth = Math.max(tree.maxDepth, childNode.depth)

            // Recursively expand child node
            if (config.learningEnabled) {
              await this.expandNodeRecursively(tree, childNode, config)
            }
          }
        } catch (error) {
          console.error(`Failed to expand node with strategy ${opportunity.strategy}:`, error)
        }
      })
    )
  }

  /**
   * Expand a single node with a strategy
   */
  async expandNode(node: EnrichmentNode, strategy: EnrichmentStrategy): Promise<EnrichmentResult> {
    const handler = this.strategies.get(strategy)

    if (!handler) {
      throw new Error(`No handler for strategy: ${strategy}`)
    }

    const startTime = Date.now()

    try {
      const data = await handler.execute(node)
      const timeMs = Date.now() - startTime
      const cost = this.calculateCost(strategy, timeMs)

      // Evaluate child opportunities
      const childOpportunities = await this.evaluateChildOpportunities(data, strategy)

      return {
        nodeId: `node_${Date.now()}_${node.depth + 1}`,
        success: true,
        dataDiscovered: data,
        confidence: data.confidence || 0.7,
        childOpportunities,
        cost,
        timeMs
      }
    } catch (error) {
      console.error(`Strategy ${strategy} failed:`, error)
      return {
        nodeId: `node_${Date.now()}_${node.depth + 1}`,
        success: false,
        dataDiscovered: {},
        confidence: 0,
        childOpportunities: [],
        cost: 0,
        timeMs: Date.now() - startTime
      }
    }
  }

  /**
   * Evaluate enrichment opportunities for a node
   */
  async evaluateOpportunities(
    node: EnrichmentNode,
    config: RecursiveEnrichmentConfig
  ): Promise<EnrichmentOpportunity[]> {
    const opportunities: EnrichmentOpportunity[] = []

    for (const strategy of config.expansionStrategies) {
      const performance = this.learningData.get(strategy)

      // Estimate value based on historical performance
      const estimatedValue = performance ? performance.averageValue * performance.successRate : 0.5

      const estimatedCost = performance ? performance.averageCost : 10
      const estimatedConfidence = performance ? performance.averageConfidence : 0.6

      opportunities.push({
        strategy,
        estimatedValue,
        estimatedCost,
        estimatedConfidence,
        priority: estimatedValue / Math.max(estimatedCost, 1), // Value/cost ratio
        reasoning: this.generateReasoning(strategy, node, performance)
      })
    }

    return opportunities
  }

  /**
   * Learn from enrichment outcomes
   */
  async learnFromOutcome(
    treeId: string,
    outcome: 'success' | 'failure',
    value: number
  ): Promise<void> {
    const tree = this.trees.get(treeId)
    if (!tree) return

    // Update value scores throughout the tree
    this.updateValueScores(tree.rootNode, outcome === 'success' ? value : 0)

    // Update strategy performance
    this.updateStrategyPerformance(tree.rootNode)
  }

  /**
   * Get enrichment tree status
   */
  getTreeStatus(treeId: string): EnrichmentTree | undefined {
    return this.trees.get(treeId)
  }

  /**
   * Pause enrichment
   */
  pauseEnrichment(treeId: string): void {
    const tree = this.trees.get(treeId)
    if (tree) {
      tree.status = 'paused'
    }
  }

  /**
   * Resume enrichment
   */
  async resumeEnrichment(treeId: string, config: RecursiveEnrichmentConfig): Promise<void> {
    const tree = this.trees.get(treeId)
    if (!tree || tree.status !== 'paused') return

    tree.status = 'running'

    // Find leaf nodes and continue expansion
    const leafNodes = this.findLeafNodes(tree.rootNode)

    for (const leaf of leafNodes) {
      if (leaf.depth < config.maxDepth && tree.totalCost < config.costLimit) {
        await this.expandNodeRecursively(tree, leaf, config)
      }
    }

    tree.status = 'completed'
    tree.completedAt = new Date()
  }

  // ==================== PRIVATE METHODS ====================

  /**
   * Initialize enrichment strategies
   */
  private initializeStrategies(): void {
    // Contact Discovery Chain
    this.strategies.set('contact_discovery', {
      execute: async (node) => {
        void node
        throw new Error('Recursive contact discovery is not wired to live providers')
      }
    })

    // Network Expansion
    this.strategies.set('network_expansion', {
      execute: async (node) => {
        void node
        throw new Error('Recursive network expansion is not wired to live providers')
      }
    })

    // Signal Amplification
    this.strategies.set('signal_amplification', {
      execute: async (node) => {
        void node
        throw new Error('Recursive signal amplification is not wired to live providers')
      }
    })

    // Relationship Mapping
    this.strategies.set('relationship_mapping', {
      execute: async (node) => {
        void node
        throw new Error('Recursive relationship mapping is not wired to live providers')
      }
    })

    // Historical Analysis
    this.strategies.set('historical_analysis', {
      execute: async (node) => {
        void node
        throw new Error('Recursive historical analysis is not wired to live providers')
      }
    })

    // Social Graph
    this.strategies.set('social_graph', {
      execute: async (node) => {
        void node
        throw new Error('Recursive social graph enrichment is not wired to live providers')
      }
    })

    // Financial Deep Dive
    this.strategies.set('financial_deep_dive', {
      execute: async (node) => {
        void node
        throw new Error('Recursive financial analysis is not wired to live providers')
      }
    })

    // Regulatory Research
    this.strategies.set('regulatory_research', {
      execute: async (node) => {
        void node
        throw new Error('Recursive regulatory research is not wired to live providers')
      }
    })
  }

  /**
   * Evaluate child opportunities based on discovered data
   */
  private async evaluateChildOpportunities(
    data: EnrichmentData,
    parentStrategy: EnrichmentStrategy
  ): Promise<EnrichmentOpportunity[]> {
    void parentStrategy
    const opportunities: EnrichmentOpportunity[] = []

    // If we found contacts, we can do social graph analysis
    if (data.emails || data.linkedinProfiles) {
      opportunities.push({
        strategy: 'social_graph',
        estimatedValue: 0.6,
        estimatedCost: 5,
        estimatedConfidence: 0.7,
        priority: 0.12,
        reasoning: 'Contact information discovered, enabling social network analysis'
      })
    }

    // If we found subsidiaries, we can expand network
    if (data.subsidiaries && data.subsidiaries.length > 0) {
      opportunities.push({
        strategy: 'network_expansion',
        estimatedValue: 0.7,
        estimatedCost: 8,
        estimatedConfidence: 0.75,
        priority: 0.0875,
        reasoning: 'Subsidiaries discovered, enabling network expansion'
      })
    }

    // If we found financial data, we can do historical analysis
    if (data.estimatedRevenue || data.profitMargin) {
      opportunities.push({
        strategy: 'historical_analysis',
        estimatedValue: 0.8,
        estimatedCost: 10,
        estimatedConfidence: 0.8,
        priority: 0.08,
        reasoning: 'Financial data discovered, enabling historical trend analysis'
      })
    }

    return opportunities
  }

  /**
   * Generate reasoning for strategy selection
   */
  private generateReasoning(
    strategy: EnrichmentStrategy,
    node: EnrichmentNode,
    performance?: StrategyPerformance
  ): string {
    const reasons: string[] = []

    if (performance) {
      reasons.push(`Historical success rate: ${(performance.successRate * 100).toFixed(0)}%`)
      reasons.push(`Average value: ${performance.averageValue.toFixed(2)}`)
    }

    switch (strategy) {
      case 'contact_discovery':
        reasons.push('Essential for outreach and communication')
        break
      case 'network_expansion':
        reasons.push('Reveals business relationships and structure')
        break
      case 'signal_amplification':
        reasons.push('Deepens understanding of growth signals')
        break
      case 'relationship_mapping':
        reasons.push('Maps ecosystem and market position')
        break
      case 'historical_analysis':
        reasons.push('Predicts future behavior from past patterns')
        break
    }

    return reasons.join('. ')
  }

  /**
   * Calculate cost of enrichment
   */
  private calculateCost(strategy: EnrichmentStrategy, timeMs: number): number {
    // Base cost by strategy
    const baseCosts: Record<EnrichmentStrategy, number> = {
      contact_discovery: 5,
      network_expansion: 8,
      signal_amplification: 6,
      relationship_mapping: 10,
      historical_analysis: 12,
      social_graph: 7,
      financial_deep_dive: 15,
      regulatory_research: 10
    }

    const baseCost = baseCosts[strategy] || 5

    // Add time-based cost (longer = more expensive)
    const timeCost = timeMs / 1000 // $1 per second

    return baseCost + timeCost
  }

  /**
   * Update value scores in tree
   */
  private updateValueScores(node: EnrichmentNode, totalValue: number): void {
    // Distribute value across the tree based on depth (deeper nodes get less)
    const depthFactor = 1 / (node.depth + 1)
    node.valueScore = totalValue * depthFactor

    // Recursively update children
    for (const child of node.childNodes) {
      this.updateValueScores(child, totalValue)
    }
  }

  /**
   * Update strategy performance based on tree results
   */
  private updateStrategyPerformance(node: EnrichmentNode): void {
    if (node.enrichmentType === 'root') {
      // Skip root
      for (const child of node.childNodes) {
        this.updateStrategyPerformance(child)
      }
      return
    }

    const strategy = node.enrichmentType as EnrichmentStrategy
    const existing = this.learningData.get(strategy) || {
      totalExecutions: 0,
      successfulExecutions: 0,
      totalValue: 0,
      totalCost: 0,
      totalConfidence: 0,
      successRate: 0,
      averageValue: 0,
      averageCost: 0,
      averageConfidence: 0
    }

    existing.totalExecutions++
    existing.successfulExecutions += node.confidence > 0.5 ? 1 : 0
    existing.totalValue += node.valueScore
    existing.totalCost += node.cost
    existing.totalConfidence += node.confidence

    existing.successRate = existing.successfulExecutions / existing.totalExecutions
    existing.averageValue = existing.totalValue / existing.totalExecutions
    existing.averageCost = existing.totalCost / existing.totalExecutions
    existing.averageConfidence = existing.totalConfidence / existing.totalExecutions

    this.learningData.set(strategy, existing)

    // Recursively update children
    for (const child of node.childNodes) {
      this.updateStrategyPerformance(child)
    }
  }

  /**
   * Find leaf nodes in tree
   */
  private findLeafNodes(node: EnrichmentNode): EnrichmentNode[] {
    if (node.childNodes.length === 0) {
      return [node]
    }

    const leaves: EnrichmentNode[] = []
    for (const child of node.childNodes) {
      leaves.push(...this.findLeafNodes(child))
    }

    return leaves
  }
}

// ==================== TYPES ====================

interface StrategyHandler {
  execute: (node: EnrichmentNode) => Promise<EnrichmentData>
}

interface StrategyPerformance {
  totalExecutions: number
  successfulExecutions: number
  totalValue: number
  totalCost: number
  totalConfidence: number
  successRate: number
  averageValue: number
  averageCost: number
  averageConfidence: number
}

export default RecursiveEnrichmentEngine
