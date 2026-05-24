/**
 * Agentic Council
 *
 * Orchestrates multiple agents working together with handoff mechanism.
 * Implements the "AI Council" pattern where each agent reviews and hands off
 * to the next agent in sequence.
 */

import {
  Agent,
  AgentAnalysis,
  SystemContext,
  ImprovementStatus,
  AgentRole,
  CouncilReview,
  Finding
} from './types'
import { DataAnalyzerAgent } from './agents/DataAnalyzerAgent'
import { OptimizerAgent } from './agents/OptimizerAgent'
import { SecurityAgent } from './agents/SecurityAgent'
import { UXEnhancerAgent } from './agents/UXEnhancerAgent'
import { CompetitorAgent } from './agents/CompetitorAgent'
import { v4 as uuidv4 } from 'uuid'

export class AgenticCouncil {
  private agents: Agent[]
  private currentReview: CouncilReview | null = null

  constructor() {
    this.agents = [
      new DataAnalyzerAgent(),
      new OptimizerAgent(),
      new SecurityAgent(),
      new UXEnhancerAgent(),
      new CompetitorAgent()
    ]
  }

  /**
   * Initiates a council review with agent handoff mechanism
   * Each agent analyzes the system and hands off to the next agent
   */
  async conductReview(context: SystemContext): Promise<CouncilReview> {
    const reviewId = uuidv4()

    this.currentReview = {
      id: reviewId,
      startedAt: new Date().toISOString(),
      agents: this.agents,
      analyses: [],
      improvements: [],
      status: 'in-progress'
    }

    console.log(`🤖 Agentic Council Review #${reviewId} initiated`)
    console.log(`📋 Agents participating: ${this.agents.map((a) => a.name).join(' → ')}`)

    try {
      // Sequential handoff: each agent completes before next begins
      for (const agent of this.agents) {
        console.log(`\n🔄 Handing off to ${agent.name} (${agent.role})...`)

        const analysis = await this.performAgentAnalysis(agent, context)
        this.currentReview.analyses.push(analysis)

        // Convert suggestions to improvements
        const improvements = analysis.improvements.map((suggestion) => ({
          id: uuidv4(),
          suggestion,
          status: 'detected' as ImprovementStatus,
          detectedAt: new Date().toISOString(),
          reviewedBy: [agent.role]
        }))

        this.currentReview.improvements.push(...improvements)

        console.log(`✅ ${agent.name} completed analysis:`)
        console.log(`   - Findings: ${analysis.findings.length}`)
        console.log(`   - Improvements: ${analysis.improvements.length}`)
        console.log(`   - Handoff complete`)
      }

      this.currentReview.status = 'completed'
      this.currentReview.completedAt = new Date().toISOString()

      console.log(`\n✨ Council Review completed successfully`)
      console.log(
        `📊 Total findings: ${this.currentReview.analyses.reduce((sum, a) => sum + a.findings.length, 0)}`
      )
      console.log(`💡 Total improvements: ${this.currentReview.improvements.length}`)

      return this.currentReview
    } catch (error) {
      console.error(`❌ Council Review failed:`, error)
      this.currentReview.status = 'failed'
      this.currentReview.completedAt = new Date().toISOString()
      throw error
    }
  }

  /**
   * Performs analysis by a single agent with error handling.
   *
   * On failure we do NOT return a silent "all clear" empty analysis (which
   * previously made e.g. a crashing SecurityAgent look like it found no
   * problems). Instead we surface the failure as a CRITICAL finding so it is
   * visible to downstream consumers and dashboards, while still allowing the
   * remaining agents in the sequence to run.
   */
  private async performAgentAnalysis(agent: Agent, context: SystemContext): Promise<AgentAnalysis> {
    try {
      return await agent.analyze(context)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`⚠️ ${agent.name} encountered error during analysis:`, error)

      const failureFinding: Finding = {
        id: uuidv4(),
        // 'data-quality' is in reviewRequired, so a failure marker can never be
        // mistaken for an auto-executable improvement.
        category: 'data-quality',
        severity: 'critical',
        description: `Agent "${agent.name}" (${agent.role}) failed during analysis: ${errorMessage}. Its findings are UNKNOWN, not clear.`,
        evidence: {
          agentId: agent.id,
          agentRole: agent.role,
          error: errorMessage
        }
      }

      return {
        agentId: agent.id,
        agentRole: agent.role,
        findings: [failureFinding],
        improvements: [],
        timestamp: new Date().toISOString(),
        // Mark the analysis as errored so consumers can distinguish "ran clean"
        // from "crashed". This is an additive optional field.
        error: errorMessage
      }
    }
  }

  /**
   * Gets the current or last review
   */
  getCurrentReview(): CouncilReview | null {
    return this.currentReview
  }

  /**
   * Gets all agents in the council
   */
  getAgents(): Agent[] {
    return this.agents
  }

  /**
   * Adds a new agent to the council
   */
  addAgent(agent: Agent): void {
    this.agents.push(agent)
    console.log(`➕ Added ${agent.name} to the council`)
  }

  /**
   * Removes an agent from the council
   */
  removeAgent(agentRole: AgentRole): void {
    const index = this.agents.findIndex((a) => a.role === agentRole)
    if (index !== -1) {
      const removed = this.agents.splice(index, 1)[0]
      console.log(`➖ Removed ${removed.name} from the council`)
    }
  }

  /**
   * Gets summary of improvements by category and priority
   */
  getImprovementSummary(): {
    byCategory: Record<string, number>
    byPriority: Record<string, number>
    total: number
  } {
    if (!this.currentReview) {
      return { byCategory: {}, byPriority: {}, total: 0 }
    }

    const byCategory: Record<string, number> = {}
    const byPriority: Record<string, number> = {}

    this.currentReview.improvements.forEach((imp) => {
      byCategory[imp.suggestion.category] = (byCategory[imp.suggestion.category] || 0) + 1
      byPriority[imp.suggestion.priority] = (byPriority[imp.suggestion.priority] || 0) + 1
    })

    return {
      byCategory,
      byPriority,
      total: this.currentReview.improvements.length
    }
  }
}
