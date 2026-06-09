/**
 * Type definitions for Personalization features
 * Supports: User profiles, Behavioral tracking, Recommendation engine, Adaptive learning
 */

import type { OutreachChannel, Tonality } from './generative'

// ==================== USER PROFILES ====================

export type UserRole =
  | 'sales_rep'
  | 'sales_manager'
  | 'analyst'
  | 'executive'
  | 'underwriter'
  | 'admin'

export type RiskTolerance = 'conservative' | 'moderate' | 'aggressive'
export type DashboardLayout = 'compact' | 'detailed' | 'visual' | 'custom'
export type CommunicationStyle = 'formal' | 'casual' | 'consultative'

export interface UserProfile {
  userId: string
  role: UserRole
  createdAt: Date
  lastActiveAt: Date
  preferences: UserPreferences
  behavior: UserBehavior
  performance: UserPerformance
  learningModel: PersonalizationModel
  achievements: Achievement[]
  goals: UserGoal[]
  // Aggregate feedback stats, populated by the engine as interactions accrue
  feedback?: UserFeedbackSummary
}

export interface UserFeedbackSummary {
  totalInteractions: number
}

export interface UserPreferences {
  // Explicit preferences set by user
  preferredIndustries: string[]
  preferredStates: string[]
  dealSizeRange: [number, number]
  riskTolerance: RiskTolerance

  // Learned preferences, populated by the personalization engine over time
  preferredDealSizes?: number[]
  preferredChannels?: OutreachChannel[]

  // UI preferences
  dashboardLayout: DashboardLayout
  defaultSortField: string
  defaultFilters: Record<string, unknown>
  theme: 'light' | 'dark' | 'auto'
  density: 'comfortable' | 'compact'
  notificationPreferences: NotificationPreferences

  // Communication preferences
  preferredOutreachChannel: OutreachChannel
  communicationStyle: CommunicationStyle
  followUpCadence: number // days
  autoFollowUp: boolean

  // Generation preferences
  preferredLLM?: 'gpt-4' | 'gpt-3.5-turbo' | 'claude-3-opus' | 'claude-3-sonnet'
  templateTonality: Tonality
  reportDetailLevel: 'summary' | 'standard' | 'comprehensive'

  // Workflow preferences
  quickActions: string[] // Favorite/pinned actions
  keyboardShortcuts: Record<string, string>
  savedSearches: SavedSearch[]
  customViews: CustomView[]
}

export interface NotificationPreferences {
  channels: {
    email: boolean
    sms: boolean
    push: boolean
    inApp: boolean
  }
  frequency: 'realtime' | 'hourly' | 'daily' | 'weekly'
  quietHours: { start: string; end: string } // e.g., "22:00" to "08:00"
  types: {
    newProspects: boolean
    healthAlerts: boolean
    dealUpdates: boolean
    systemAlerts: boolean
    insights: boolean
    recommendations: boolean
  }
  minimumPriority: 'low' | 'medium' | 'high' | 'urgent'
}

export interface SavedSearch {
  searchId: string
  name: string
  filters: Record<string, unknown>
  sortBy: string
  createdAt: Date
  usageCount: number
  lastUsedAt?: Date
}

export interface CustomView {
  viewId: string
  name: string
  layout: Record<string, unknown> // Dashboard layout configuration
  widgets: Widget[]
  filters: Record<string, unknown>
  createdAt: Date
}

export interface Widget {
  widgetId: string
  type: string
  position: { x: number; y: number; width: number; height: number }
  configuration: Record<string, unknown>
}

// ==================== USER BEHAVIOR ====================

export interface UserBehavior {
  // Tracked implicitly through user interactions
  prospectViewPatterns: ProspectViewPattern[]
  filterUsageFrequency: Record<string, number>
  timeOfDayPatterns: TimePattern[]
  conversionPatterns: ConversionPattern[]
  successfulDealCharacteristics: DealCharacteristics[]
  searchPatterns: SearchPattern[]

  // Interaction patterns
  averageTimePerProspect: number // seconds
  clickPatterns: ClickPattern[]
  navigationPatterns: NavigationPattern[]
  exportFrequency: number // per week
  featureUsage: Record<string, number> // feature -> usage count

  // Learning patterns
  learningVelocity: number // How fast user is improving
  skillProgression: SkillProgression[]
  weaknessAreas: string[]
}

export interface ProspectViewPattern {
  prospectCharacteristics: Record<string, unknown>
  viewCount: number
  averageTimeSpent: number // seconds
  actionTaken?: 'claimed' | 'exported' | 'dismissed' | 'no_action'
  outcome?: 'converted' | 'lost' | 'pending'
}

export interface TimePattern {
  hourOfDay: number // 0-23
  dayOfWeek: number // 0-6 (0 = Sunday)
  activityLevel: number // 0-1
  conversionRate: number // 0-1
  averageResponseTime: number // seconds
}

export interface ConversionPattern {
  prospectCharacteristics: Record<string, unknown>
  timeToConversion: number // days
  dealSize: number
  successFactors: string[]
  touchpoints: number // Number of interactions before conversion
}

export interface DealCharacteristics {
  industry: string
  state: string
  dealSize: number
  healthGrade: string
  signalCount: number
  defaultAge: number // days
  outcome: 'success' | 'failure'
  marginAchieved: number
}

export interface SearchPattern {
  keywords: string[]
  filters: Record<string, unknown>
  frequency: number
  resultsQuality: number // 0-1, how useful results were
  leadToAction: boolean
}

export interface ClickPattern {
  elementType: string
  elementId?: string
  context: string // Where in the app
  frequency: number
  averageTime: number // Time from load to click
}

export interface NavigationPattern {
  fromPage: string
  toPage: string
  frequency: number
  averageTime: number // Time spent before navigation
}

export interface SkillProgression {
  skill: string
  level: number // 0-100
  improvementRate: number // points per week
  milestones: Milestone[]
}

export interface Milestone {
  name: string
  achievedAt: Date
  description: string
}

// ==================== USER PERFORMANCE ====================

export interface UserPerformance {
  // Key metrics
  conversionRate: number // 0-1
  averageDealSize: number
  averageTimeToClose: number // days
  portfolioHealthScore: number // 0-100
  prospectQuality: number // 0-1, how good are their selections
  activityLevel: number // 0-100

  // Trend data
  trends: PerformanceTrend[]
  benchmarks: PerformanceBenchmark[]

  // Insights
  strengths: string[] // AI-identified strengths
  improvementAreas: string[] // AI-identified areas for growth
  competitiveRanking?: number // Rank among peers
  percentile?: number // Performance percentile

  // Detailed metrics
  metricsHistory: MetricSnapshot[]
}

export interface PerformanceTrend {
  metric: string
  direction: 'up' | 'down' | 'stable'
  changePercentage: number
  timeframe: string // e.g., 'last_30_days'
}

export interface PerformanceBenchmark {
  metric: string
  userValue: number
  teamAverage: number
  companyAverage: number
  topPerformer: number
  percentile: number // Where user ranks (0-100)
}

export interface MetricSnapshot {
  timestamp: Date
  metrics: Record<string, number>
  context: Record<string, unknown> // Market conditions, etc.
}

// ==================== PERSONALIZATION MODEL ====================

export interface PersonalizationModel {
  modelId: string
  userId: string
  version: number
  lastUpdated: Date

  // Learned preferences (implicit)
  learnedPreferences: LearnedPreference[]

  // Predictive models
  conversionPredictorWeights: Record<string, number> // Feature -> weight
  timingPredictor: TimingModel
  channelPredictor: ChannelModel

  // Segmentation
  userSegment: UserSegment
  similarUsers: string[] // IDs of similar users

  // Confidence scores
  modelConfidence: number // 0-1
  dataQuality: number // 0-1
}

export interface LearnedPreference {
  feature: string
  preferredValue: unknown
  confidence: number // 0-1
  learnedFrom: number // Number of observations
  lastObserved: Date
}

export interface TimingModel {
  optimalContactTime: {
    hourOfDay: number
    dayOfWeek: number
    confidence: number
  }
  optimalFollowUpInterval: number // days
  responsePatterns: ResponsePattern[]
}

export interface ResponsePattern {
  timeOfDay: number
  responseRate: number
  averageResponseTime: number // minutes
  sampleSize: number
}

export interface ChannelModel {
  channelPreferences: Record<OutreachChannel, number> // 0-1 preference score
  channelEffectiveness: Record<OutreachChannel, ChannelMetrics>
  contextualPreferences: ContextualChannelPreference[]
}

export interface ChannelMetrics {
  responseRate: number
  conversionRate: number
  averageResponseTime: number
  userSatisfaction: number // 0-1
  sampleSize: number
}

export interface ContextualChannelPreference {
  context: string // e.g., 'urgent', 'follow_up', 'new_prospect'
  preferredChannel: OutreachChannel
  confidence: number
}

export type UserSegment =
  | 'high_performer'
  | 'growing'
  | 'struggling'
  | 'specialist' // Focus on specific niche
  | 'generalist'
  | 'new_user'

// ==================== RECOMMENDATIONS ====================

export type RecommendationType =
  | 'prospect'
  | 'action'
  | 'strategy'
  | 'timing'
  | 'pricing'
  | 'learning'
  | 'workflow'

export interface PersonalizedRecommendation {
  recommendationId: string
  userId: string
  type: RecommendationType
  title: string
  description: string
  confidence: number // 0-1
  expectedValue: number // Estimated impact
  priority: 'low' | 'medium' | 'high' | 'urgent'
  reasoning: string[]
  data: unknown
  personalizationFactors: PersonalizationFactor[]
  expiresAt?: Date
  dismissed?: boolean
  actionTaken?: boolean
  feedback?: RecommendationFeedback
}

export interface PersonalizationFactor {
  factor: string
  value: unknown
  weight: number // How much this influenced the recommendation
  description: string
}

export interface RecommendationFeedback {
  helpful: boolean
  rating?: number // 1-5
  comment?: string
  outcomeAchieved: boolean
  providedAt: Date
}

export interface RecommendationContext {
  userId: string
  timeOfDay: Date
  userActivity: string // What user is currently doing
  recentActions: UserAction[]
  currentGoals: UserGoal[]
  constraints: UserConstraint[]
  currentView: string
  selectedProspects?: string[]
}

export interface UserAction {
  actionType: string
  timestamp: Date
  prospectId?: string
  outcome?: string
  data: unknown
}

export interface UserGoal {
  goalId: string
  type: 'revenue' | 'volume' | 'conversion_rate' | 'skill_development' | 'efficiency'
  target: number
  current: number
  deadline?: Date
  progress: number // 0-1
  onTrack: boolean
}

export interface UserConstraint {
  type: string
  value: unknown
  description: string
}

// ==================== ACHIEVEMENTS ====================

export interface Achievement {
  achievementId: string
  name: string
  description: string
  category: 'performance' | 'learning' | 'milestone' | 'social'
  tier: 'bronze' | 'silver' | 'gold' | 'platinum'
  earnedAt: Date
  progress: number // 0-1 for multi-level achievements
  nextLevel?: Achievement
  rewards?: AchievementReward[]
}

export interface AchievementReward {
  rewardType: 'badge' | 'feature_unlock' | 'recognition'
  description: string
  value: unknown
}

// ==================== PERSONALIZATION ENGINE INTERFACES ====================

export interface PersonalizationEngine {
  // Profile management
  getUserProfile(userId: string): Promise<UserProfile>
  updatePreferences(userId: string, preferences: Partial<UserPreferences>): Promise<UserProfile>

  // Behavior tracking
  trackUserAction(userId: string, action: UserAction): Promise<void>
  trackProspectView(userId: string, prospectId: string, duration: number): Promise<void>
  trackSearch(
    userId: string,
    query: string,
    filters: Record<string, unknown>,
    resultsCount: number
  ): Promise<void>

  // Learning
  updatePersonalizationModel(userId: string): Promise<PersonalizationModel>
  learnFromOutcome(
    userId: string,
    prospectId: string,
    outcome: 'success' | 'failure',
    details: Record<string, unknown>
  ): Promise<void>

  // Personalized content
  personalizeProspects(userId: string, prospects: unknown[]): Promise<PersonalizedProspect[]>

  getPersonalizedDashboard(userId: string): Promise<PersonalizedDashboard>

  getPersonalizedInsights(userId: string): Promise<PersonalizedInsight[]>
}

export interface PersonalizedProspect {
  prospectId: string
  personalizedScore: number // 0-100, personalized ranking
  matchReasons: string[] // Why this prospect matches user's patterns
  recommendedApproach: string // Suggested strategy based on user's successes
  predictedConversionProbability: number // 0-1
  predictedDealSize: number
  predictedTimeToClose: number // days
  similarSuccessfulDeals: string[] // IDs of user's similar successful deals
  warnings?: string[] // If prospect differs from user's typical successes
}

export interface PersonalizedDashboard {
  userId: string
  layout: DashboardLayout
  widgets: PersonalizedWidget[]
  insights: PersonalizedInsight[]
  recommendations: PersonalizedRecommendation[]
  quickActions: QuickAction[]
  recentActivity: ActivityItem[]
}

export interface PersonalizedWidget {
  widgetId: string
  type: string
  title: string
  priority: number // For ordering
  data: unknown
  configuration: Record<string, unknown>
  personalizationReasons: string[]
}

export interface PersonalizedInsight {
  insightId: string
  type: 'performance' | 'opportunity' | 'risk' | 'learning' | 'benchmark'
  title: string
  description: string
  relevanceScore: number // 0-1, how relevant to this specific user
  actionable: boolean
  suggestedActions?: string[]
  impact: 'low' | 'medium' | 'high'
  timeframe?: string // When to act on this
}

export interface QuickAction {
  actionId: string
  label: string
  description: string
  icon?: string
  handler: string // Function to call
  usageCount: number // How often user uses this
  lastUsed?: Date
}

export interface ActivityItem {
  activityId: string
  type: string
  description: string
  timestamp: Date
  prospectId?: string
  outcome?: string
  metadata: Record<string, unknown>
}

// ==================== RECOMMENDATION ENGINE ====================

export interface RecommendationEngine {
  generateRecommendations(
    userId: string,
    context: RecommendationContext
  ): Promise<PersonalizedRecommendation[]>

  explainRecommendation(recommendationId: string): Promise<RecommendationExplanation>

  recordFeedback(recommendationId: string, feedback: RecommendationFeedback): Promise<void>

  getDailyRecommendations(userId: string): Promise<PersonalizedRecommendation[]>

  getProspectRecommendations(userId: string, limit: number): Promise<PersonalizedProspect[]>

  getTimingRecommendations(userId: string, prospectId: string): Promise<TimingRecommendation>

  getStrategyRecommendations(userId: string, prospectId: string): Promise<StrategyRecommendation>
}

export interface RecommendationExplanation {
  recommendationId: string
  factors: ExplanationFactor[]
  similarCases: CaseExample[]
  confidenceBreakdown: Record<string, number>
  alternatives: PersonalizedRecommendation[]
  reasoning: string
}

export interface ExplanationFactor {
  factor: string
  value: unknown
  contribution: number // -1 to 1
  importance: number // 0-1
  description: string
}

export interface CaseExample {
  caseId: string
  description: string
  similarity: number // 0-1
  outcome: 'success' | 'failure'
  keyDifferences?: string[]
}

export interface TimingRecommendation {
  prospectId: string
  optimalContactTime: Date
  optimalFollowUpInterval: number // days
  reasoning: string
  confidence: number
  alternatives: Date[]
}

export interface StrategyRecommendation {
  prospectId: string
  recommendedApproach: string
  keyMessages: string[]
  anticipatedObjections: string[]
  responseStrategies: Record<string, string>
  successProbability: number
  basedOnCases: CaseExample[]
}

// ==================== BEHAVIORAL LEARNING ====================

export interface BehavioralTracker {
  trackPageView(userId: string, page: string, duration: number): Promise<void>

  trackClick(
    userId: string,
    elementType: string,
    elementId: string,
    context: Record<string, unknown>
  ): Promise<void>

  trackFilter(userId: string, filterType: string, filterValue: unknown): Promise<void>

  trackSort(userId: string, sortField: string, direction: string): Promise<void>

  trackExport(userId: string, exportType: string, recordCount: number): Promise<void>

  trackProspectAction(
    userId: string,
    prospectId: string,
    action: string,
    outcome?: string
  ): Promise<void>

  getBehaviorSummary(userId: string): Promise<BehaviorSummary>

  identifyPatterns(userId: string): Promise<BehaviorPattern[]>
}

export interface BehaviorSummary {
  userId: string
  periodStart: Date
  periodEnd: Date
  totalActions: number
  topActions: Array<{ action: string; count: number }>
  topPages: Array<{ page: string; timeSpent: number }>
  topFilters: Array<{ filter: string; count: number }>
  peakActivityTimes: TimePattern[]
  efficiency: number // 0-1
  engagement: number // 0-1
}

export interface BehaviorPattern {
  patternId: string
  description: string
  frequency: number
  significance: number // 0-1
  recommendation?: string
  examples: unknown[]
}

// ==================== ROLE-BASED PERSONALIZATION ====================

export interface RoleProfile {
  role: UserRole
  defaultDashboard: DashboardLayout
  keyMetrics: string[]
  primaryTasks: string[]
  recommendedFeatures: string[]
  restrictions?: string[]
  permissions: Permission[]
}

export interface Permission {
  resource: string
  actions: ('read' | 'write' | 'delete' | 'admin')[]
}

export const ROLE_PROFILES: Record<UserRole, RoleProfile> = {
  sales_rep: {
    role: 'sales_rep',
    defaultDashboard: 'compact',
    keyMetrics: ['conversion_rate', 'pipeline_value', 'activity_level'],
    primaryTasks: ['prospect_outreach', 'deal_closing', 'follow_up'],
    recommendedFeatures: ['outreach_templates', 'deal_proposals', 'quick_actions'],
    permissions: [
      { resource: 'prospects', actions: ['read', 'write'] },
      { resource: 'deals', actions: ['read', 'write'] },
      { resource: 'templates', actions: ['read'] }
    ]
  },
  sales_manager: {
    role: 'sales_manager',
    defaultDashboard: 'detailed',
    keyMetrics: ['team_conversion_rate', 'team_revenue', 'pipeline_health'],
    primaryTasks: ['team_management', 'performance_review', 'strategy'],
    recommendedFeatures: ['team_dashboard', 'performance_reports', 'coaching_insights'],
    permissions: [
      { resource: 'prospects', actions: ['read', 'write', 'delete'] },
      { resource: 'deals', actions: ['read', 'write', 'delete'] },
      { resource: 'team', actions: ['read', 'write'] },
      { resource: 'reports', actions: ['read'] }
    ]
  },
  analyst: {
    role: 'analyst',
    defaultDashboard: 'visual',
    keyMetrics: ['data_quality', 'market_trends', 'competitor_activity'],
    primaryTasks: ['data_analysis', 'reporting', 'market_research'],
    recommendedFeatures: ['advanced_filters', 'data_export', 'visualization_tools'],
    permissions: [
      { resource: 'prospects', actions: ['read'] },
      { resource: 'deals', actions: ['read'] },
      { resource: 'analytics', actions: ['read', 'write'] },
      { resource: 'reports', actions: ['read', 'write'] }
    ]
  },
  executive: {
    role: 'executive',
    defaultDashboard: 'visual',
    keyMetrics: ['revenue', 'growth_rate', 'market_share'],
    primaryTasks: ['strategic_planning', 'performance_review', 'decision_making'],
    recommendedFeatures: ['executive_dashboard', 'strategic_insights', 'board_reports'],
    permissions: [
      { resource: 'prospects', actions: ['read'] },
      { resource: 'deals', actions: ['read'] },
      { resource: 'analytics', actions: ['read'] },
      { resource: 'reports', actions: ['read'] },
      { resource: 'strategy', actions: ['read', 'write'] }
    ]
  },
  underwriter: {
    role: 'underwriter',
    defaultDashboard: 'detailed',
    keyMetrics: ['approval_rate', 'default_rate', 'portfolio_risk'],
    primaryTasks: ['risk_assessment', 'deal_approval', 'portfolio_monitoring'],
    recommendedFeatures: ['risk_tools', 'deal_analysis', 'compliance_checks'],
    permissions: [
      { resource: 'prospects', actions: ['read'] },
      { resource: 'deals', actions: ['read', 'write'] },
      { resource: 'risk_assessment', actions: ['read', 'write'] }
    ]
  },
  admin: {
    role: 'admin',
    defaultDashboard: 'custom',
    keyMetrics: ['system_health', 'user_activity', 'data_quality'],
    primaryTasks: ['system_management', 'user_management', 'configuration'],
    recommendedFeatures: ['admin_panel', 'user_management', 'system_config'],
    permissions: [{ resource: '*', actions: ['read', 'write', 'delete', 'admin'] }]
  }
}

export default {}
