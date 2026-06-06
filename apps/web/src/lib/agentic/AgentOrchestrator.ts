/**
 * Agent Orchestrator
 * Coordinates state and entry point agents for distributed data collection
 */

import { StateAgentFactory, type StateAgentRegistry } from './agents/state-agents/StateAgentFactory'
import {
  EntryPointAgentFactory,
  type EntryPointAgent
} from './agents/entry-point-agents/EntryPointAgent'
import type { SystemContext, AgentAnalysis } from './types'

export interface OrchestrationConfig {
  enableStateAgents: boolean
  enableEntryPointAgents: boolean
  states?: string[] // If undefined, all states
  maxConcurrentCollections: number
  collectionInterval: number // milliseconds
  prioritizeStates?: string[] // High-priority states to collect first
}

export interface CollectionResult {
  agentId: string
  success: boolean
  recordsCollected: number
  duration: number
  errors?: string[]
  /**
   * True when recordsCollected was produced by a simulation rather than a real
   * collector. Consumers/dashboards MUST NOT report simulated results as real
   * ingestion. Absent/false means the numbers came from an actual collection.
   */
  simulated?: boolean
}

export interface OrchestrationStatus {
  activeAgents: number
  totalAgents: number
  collectionsInProgress: number
  totalCollections: number
  successfulCollections: number
  failedCollections: number
  lastCollectionTime: string
}

export class AgentOrchestrator {
  private stateFactory: StateAgentFactory
  private entryPointFactory: EntryPointAgentFactory
  private config: OrchestrationConfig
  private status: OrchestrationStatus
  private collectionQueue: string[] = []
  private activeCollections: Set<string> = new Set()

  constructor(config: OrchestrationConfig) {
    this.stateFactory = new StateAgentFactory()
    this.entryPointFactory = new EntryPointAgentFactory()
    this.config = config
    this.status = {
      activeAgents: 0,
      totalAgents: 0,
      collectionsInProgress: 0,
      totalCollections: 0,
      successfulCollections: 0,
      failedCollections: 0,
      lastCollectionTime: new Date().toISOString()
    }

    this.initialize()
  }

  private initialize(): void {
    // Initialize state agents
    if (this.config.enableStateAgents) {
      if (this.config.states && this.config.states.length > 0) {
        this.stateFactory.createStateAgents(this.config.states)
      } else {
        this.stateFactory.createAllStateAgents()
      }
    }

    // Initialize entry point agents
    if (this.config.enableEntryPointAgents) {
      this.entryPointFactory.createAllEntryPointAgents()
    }

    // Update status
    this.updateAgentCounts()
  }

  private updateAgentCounts(): void {
    const stateAgents = this.stateFactory.getAgentCount()
    const entryPointAgents = this.entryPointFactory.getAllAgents().size
    this.status.totalAgents = stateAgents + entryPointAgents
    this.status.activeAgents = stateAgents + entryPointAgents
  }

  /**
   * Analyze all agents and collect insights
   */
  async analyzeAllAgents(context: SystemContext): Promise<AgentAnalysis[]> {
    const analyses: AgentAnalysis[] = []

    // Analyze state agents
    if (this.config.enableStateAgents) {
      const stateAgents = this.stateFactory.getAllAgents()
      for (const [stateCode, agent] of Object.entries(stateAgents)) {
        try {
          const analysis = await agent.analyze(context)
          analyses.push(analysis)
        } catch (error) {
          console.error(`[Orchestrator] Error analyzing state agent ${stateCode}:`, error)
        }
      }
    }

    // Analyze entry point agents
    if (this.config.enableEntryPointAgents) {
      const entryPointAgents = this.entryPointFactory.getAllAgents()
      for (const [id, agent] of entryPointAgents.entries()) {
        try {
          const analysis = await agent.analyze(context)
          analyses.push(analysis)
        } catch (error) {
          console.error(`[Orchestrator] Error analyzing entry point agent ${id}:`, error)
        }
      }
    }

    return analyses
  }

  /**
   * Collect data from all configured sources
   */
  async collectFromAllSources(options?: {
    statesOnly?: boolean
    entryPointsOnly?: boolean
    limit?: number
  }): Promise<CollectionResult[]> {
    const results: CollectionResult[] = []

    // Prioritize states if configured
    let statesToCollect: string[] = []
    if (!options?.entryPointsOnly && this.config.enableStateAgents) {
      const allStates = Object.keys(this.stateFactory.getAllAgents())

      if (this.config.prioritizeStates) {
        statesToCollect = [
          ...this.config.prioritizeStates.filter((s) => allStates.includes(s)),
          ...allStates.filter((s) => !this.config.prioritizeStates!.includes(s))
        ]
      } else {
        statesToCollect = allStates
      }

      if (options?.limit) {
        statesToCollect = statesToCollect.slice(0, options.limit)
      }
    }

    // Collect from states with concurrency control
    for (let i = 0; i < statesToCollect.length; i += this.config.maxConcurrentCollections) {
      const batch = statesToCollect.slice(i, i + this.config.maxConcurrentCollections)
      const batchPromises = batch.map((stateCode) => this.collectFromState(stateCode))
      const batchResults = await Promise.allSettled(batchPromises)

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value)
        } else {
          this.status.failedCollections++
        }
      }
    }

    // Collect from entry points
    if (!options?.statesOnly && this.config.enableEntryPointAgents) {
      const entryPoints = Array.from(this.entryPointFactory.getAllAgents().keys())

      for (const epId of entryPoints) {
        try {
          const result = await this.collectFromEntryPoint(epId)
          results.push(result)
        } catch (error) {
          console.error(`[Orchestrator] Error collecting from entry point ${epId}:`, error)
          this.status.failedCollections++
        }
      }
    }

    this.status.lastCollectionTime = new Date().toISOString()
    return results
  }

  /**
   * Collect data from specific state
   */
  async collectFromState(stateCode: string): Promise<CollectionResult> {
    const startTime = Date.now()
    this.activeCollections.add(stateCode)
    this.status.collectionsInProgress++

    try {
      const agent = this.stateFactory.getAgent(stateCode)
      if (!agent) {
        throw new Error(`Agent not found for state ${stateCode}`)
      }

      // Fail closed: no real collector is wired here. The previous code
      // returned Math.random() filings and fed them into agent.updateMetrics,
      // polluting dashboards with fabricated ingestion volume. We refuse to do
      // that: updateMetrics is NOT called (metrics only reflect real
      // collections), recordsCollected stays 0, and a named reason is returned.
      // Real ingestion runs via the server ingestion jobs.
      const reason = 'live collection not wired — use server ingestion jobs'
      console.warn(`[Orchestrator] State ${stateCode}: ${reason}. No metrics updated.`)

      this.status.failedCollections++
      this.status.totalCollections++

      return {
        agentId: agent.getCustomId(),
        success: false,
        recordsCollected: 0,
        duration: Date.now() - startTime,
        simulated: false,
        errors: [reason]
      }
    } catch (error) {
      this.status.failedCollections++
      this.status.totalCollections++

      return {
        agentId: `state-agent-${stateCode}`,
        success: false,
        recordsCollected: 0,
        duration: Date.now() - startTime,
        simulated: false,
        errors: [error instanceof Error ? error.message : 'Unknown error']
      }
    } finally {
      this.activeCollections.delete(stateCode)
      this.status.collectionsInProgress--
    }
  }

  /**
   * Collect data from specific entry point
   */
  async collectFromEntryPoint(entryPointId: string): Promise<CollectionResult> {
    const startTime = Date.now()
    this.activeCollections.add(entryPointId)
    this.status.collectionsInProgress++

    try {
      const agent = this.entryPointFactory.getAgent(entryPointId)
      if (!agent) {
        throw new Error(`Entry point agent not found: ${entryPointId}`)
      }

      // Fail closed: no real entry-point collector is wired. Same rationale as
      // collectFromState — we never fabricate a record count or report it as
      // real ingestion. Returns an explicit failed result with a named reason.
      const reason = 'live collection not wired — use server ingestion jobs'
      console.warn(`[Orchestrator] Entry point ${entryPointId}: ${reason}. No metrics updated.`)

      this.status.failedCollections++
      this.status.totalCollections++

      return {
        agentId: entryPointId,
        success: false,
        recordsCollected: 0,
        duration: Date.now() - startTime,
        simulated: false,
        errors: [reason]
      }
    } catch (error) {
      this.status.failedCollections++
      this.status.totalCollections++

      return {
        agentId: entryPointId,
        success: false,
        recordsCollected: 0,
        duration: Date.now() - startTime,
        simulated: false,
        errors: [error instanceof Error ? error.message : 'Unknown error']
      }
    } finally {
      this.activeCollections.delete(entryPointId)
      this.status.collectionsInProgress--
    }
  }

  /**
   * Get orchestration status
   */
  getStatus(): OrchestrationStatus {
    return { ...this.status }
  }

  /**
   * Get specific state agent
   */
  getStateAgent(stateCode: string) {
    return this.stateFactory.getAgent(stateCode)
  }

  /**
   * Get specific entry point agent
   */
  getEntryPointAgent(id: string) {
    return this.entryPointFactory.getAgent(id)
  }

  /**
   * Get all state agents
   */
  getAllStateAgents(): StateAgentRegistry {
    return this.stateFactory.getAllAgents()
  }

  /**
   * Get all entry point agents
   */
  getAllEntryPointAgents(): Map<string, EntryPointAgent> {
    return this.entryPointFactory.getAllAgents()
  }

  /**
   * Schedule periodic collections
   */
  startPeriodicCollection(): NodeJS.Timeout {
    return setInterval(async () => {
      console.log('[Orchestrator] Starting periodic collection...')
      const results = await this.collectFromAllSources()
      const successful = results.filter((r) => r.success).length
      console.log(`[Orchestrator] Collection complete: ${successful}/${results.length} successful`)
    }, this.config.collectionInterval)
  }

  /**
   * Stop periodic collections
   */
  stopPeriodicCollection(timerId: NodeJS.Timeout): void {
    clearInterval(timerId)
    console.log('[Orchestrator] Periodic collection stopped')
  }
}

// Default configuration
export const DEFAULT_ORCHESTRATION_CONFIG: OrchestrationConfig = {
  enableStateAgents: true,
  enableEntryPointAgents: true,
  maxConcurrentCollections: 5,
  collectionInterval: 24 * 60 * 60 * 1000, // 24 hours
  prioritizeStates: ['NY', 'CA', 'TX', 'FL', 'IL'] // Largest states first
}
