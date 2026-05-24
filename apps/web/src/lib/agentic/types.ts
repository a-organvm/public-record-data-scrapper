/**
 * Agentic Forces - Type Definitions
 *
 * This module defines the core types for the agentic system that enables
 * autonomous decision-making, continuous improvement, and self-directed actions.
 */

export type AgentRole =
  | 'data-analyzer'
  | 'optimizer'
  | 'security'
  | 'ux-enhancer'
  | 'quality-assurance'
  | 'competitor-agent'
  | 'state-collector'
  | 'entry-point-collector'
  | 'data-acquisition'
  | 'scraper'
  | 'data-normalization'
  | 'monitoring'
  | 'enrichment-orchestrator'

export type ImprovementCategory =
  | 'performance'
  | 'security'
  | 'usability'
  | 'data-quality'
  | 'feature-enhancement'
  | 'competitor-analysis'
  | 'threat-analysis'
  | 'opportunity-analysis'
  | 'strategic-recommendation'
  | 'strategic'
  | 'competitor-intelligence'

export type ImprovementPriority = 'critical' | 'high' | 'medium' | 'low'

export type ImprovementStatus =
  | 'detected'
  | 'analyzing'
  | 'approved'
  | 'implementing'
  | 'testing'
  | 'completed'
  | 'rejected'

export interface Agent {
  id: string
  role: AgentRole
  name: string
  capabilities: string[]
  analyze: (context: SystemContext) => Promise<AgentAnalysis>
}

export interface SystemContext {
  prospects: unknown[]
  competitors: unknown[]
  portfolio: unknown[]
  userActions: UserAction[]
  performanceMetrics: PerformanceMetrics
  timestamp: string
}

export interface UserAction {
  type: string
  timestamp: string
  details: Record<string, unknown>
}

export interface PerformanceMetrics {
  avgResponseTime: number
  errorRate: number
  userSatisfactionScore: number
  dataFreshnessScore: number
}

export interface AgentAnalysis {
  agentId: string
  agentRole: AgentRole
  findings: Finding[]
  improvements: ImprovementSuggestion[]
  timestamp: string
  /**
   * Populated when the agent crashed during analysis. When set, the findings
   * represent a failure marker rather than a clean "no issues" result, so this
   * MUST be checked before treating an empty findings list as "all clear".
   */
  error?: string
}

export interface Finding {
  id: string
  category: ImprovementCategory
  severity: 'info' | 'warning' | 'critical'
  description: string
  evidence: unknown
}

export interface ImprovementSuggestion {
  id: string
  category: ImprovementCategory
  priority: ImprovementPriority
  title: string
  description: string
  reasoning: string
  estimatedImpact: string
  automatable: boolean
  safetyScore: number // 0-100, higher is safer
  implementation?: ImplementationPlan
}

export interface ImplementationPlan {
  steps: string[]
  risks: string[]
  rollbackPlan: string[]
  validationCriteria: string[]
}

export interface Improvement {
  id: string
  suggestion: ImprovementSuggestion
  status: ImprovementStatus
  detectedAt: string
  approvedAt?: string
  implementedAt?: string
  completedAt?: string
  result?: ImprovementResult
  reviewedBy?: AgentRole[]
}

export interface ImprovementResult {
  success: boolean
  changes: string[]
  metrics: {
    before: Record<string, unknown>
    after: Record<string, unknown>
  }
  feedback: string
}

export interface FeedbackLoop {
  id: string
  type: 'user-feedback' | 'system-metrics' | 'agent-review'
  data: unknown
  timestamp: string
  processedBy: string[]
}

export interface AgenticConfig {
  enabled: boolean
  autonomousExecutionEnabled: boolean
  safetyThreshold: number // Minimum safety score to execute automatically
  maxDailyImprovements: number
  reviewRequired: ImprovementCategory[]
  enabledAgents: AgentRole[]
}

// New types for data enrichment pipeline
export type SubscriptionTier = 'free' | 'starter' | 'professional' | 'enterprise'

export interface AgentTask {
  type: string
  payload: Record<string, unknown>
}

export interface AgentTaskResult {
  success: boolean
  data?: unknown
  error?: string
  timestamp: string
}

export interface DataSource {
  name: string
  tier: SubscriptionTier
  cost: number
  rateLimit: number
  timeout: number
}

export interface EnrichmentRequest {
  companyName: string
  state: string
  tier: SubscriptionTier
  userId?: string
}

export interface EnrichmentResult {
  success: boolean
  data?: unknown
  errors?: string[]
  sources: string[]
  cost: number
  timestamp: string
}
