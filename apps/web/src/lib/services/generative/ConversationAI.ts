/**
 * Conversation AI - Natural language interface for querying and analyzing data
 * Enables users to interact with the system using natural language
 */

import type {
  Message,
  DetectedIntent,
  ExtractedEntity,
  ActionResult,
  ConversationContext,
  ConversationSession,
  AICapability
} from '@/types/generative'
import type LLMService from '../integration/LLMService'

export class ConversationAI {
  private llmService: LLMService
  private sessions: Map<string, ConversationSession> = new Map()
  private capabilities: AICapability[]

  constructor(llmService: LLMService) {
    this.llmService = llmService
    this.capabilities = this.initializeCapabilities()
  }

  /**
   * Send message and get AI response
   */
  async sendMessage(sessionId: string, userMessage: string): Promise<Message> {
    const session = this.getOrCreateSession(sessionId)

    // Create user message
    const userMsg: Message = {
      messageId: `msg_${Date.now()}_user`,
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    }

    session.messages.push(userMsg)
    session.lastActiveAt = new Date()

    // Detect intent
    const intent = await this.detectIntent(userMessage)
    userMsg.intent = intent

    // Extract entities
    const entities = await this.extractEntities(userMessage)
    userMsg.entities = entities

    // Execute action if needed
    let actionResult: ActionResult | undefined
    if (intent.primary === 'action' || intent.primary === 'query') {
      actionResult = await this.executeAction(intent, session.context)
    }

    // Generate AI response
    const aiResponse = await this.generateResponse(session, intent, entities, actionResult)

    // Create assistant message
    const assistantMsg: Message = {
      messageId: `msg_${Date.now()}_assistant`,
      role: 'assistant',
      content: aiResponse,
      timestamp: new Date(),
      intent,
      entities,
      actionTaken: actionResult,
      results: actionResult?.result,
      confidence: intent.confidence
    }

    session.messages.push(assistantMsg)

    return assistantMsg
  }

  /**
   * Detect intent from message
   */
  async detectIntent(message: string): Promise<DetectedIntent> {
    const prompt = `Analyze this user message and detect the intent:

"${message}"

Classify the primary intent as one of: query, analysis, recommendation, export, action, clarification, feedback

Also identify the specific intent (e.g., "find_prospects", "analyze_competitor", "generate_report") and extract key parameters.

Respond in JSON format:
{
  "primary": "query",
  "specific": "find_prospects",
  "confidence": 0.95,
  "parameters": { "industry": "construction", "state": "NY" }
}`

    const response = await this.llmService.complete({
      prompt,
      systemPrompt: 'You are an intent classification system. Always respond with valid JSON.',
      temperature: 0.3,
      maxTokens: 300
    })

    try {
      const parsed = JSON.parse(response.text)
      return {
        primary: parsed.primary || 'query',
        specific: parsed.specific || 'unknown',
        confidence: parsed.confidence || 0.5,
        parameters: parsed.parameters || {}
      }
    } catch {
      // Fallback to rule-based intent detection
      return this.ruleBasedIntentDetection(message)
    }
  }

  /**
   * Extract entities from message
   */
  async extractEntities(message: string): Promise<ExtractedEntity[]> {
    const prompt = `Extract key entities from this message:

"${message}"

Identify entities like: company names, industries, locations, dates, metrics, numbers, etc.

Respond in JSON array format:
[
  { "type": "industry", "value": "construction", "confidence": 0.95 },
  { "type": "location", "value": "New York", "confidence": 0.9 }
]`

    const response = await this.llmService.complete({
      prompt,
      systemPrompt: 'You are an entity extraction system. Always respond with valid JSON array.',
      temperature: 0.2,
      maxTokens: 500
    })

    try {
      const parsed = JSON.parse(response.text)
      return parsed.map((entity: { type: string; value: string; confidence?: number }) => ({
        type: entity.type,
        value: entity.value,
        normalizedValue: this.normalizeEntity(entity.type, entity.value),
        confidence: entity.confidence || 0.7
      }))
    } catch {
      return []
    }
  }

  /**
   * Execute action based on intent
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async executeAction(intent: DetectedIntent, context: ConversationContext): Promise<ActionResult> {
    const startTime = Date.now()

    try {
      let result: Record<string, unknown>

      switch (intent.specific) {
        case 'find_prospects':
          result = await this.findProspects(intent.parameters)
          break

        case 'analyze_competitor':
          result = await this.analyzeCompetitor(intent.parameters)
          break

        case 'generate_report':
          result = await this.generateReport(intent.parameters)
          break

        case 'export_data':
          result = await this.exportData(intent.parameters)
          break

        case 'get_statistics':
          result = await this.getStatistics(intent.parameters)
          break

        case 'analyze_data':
          result = await this.analyzeData(intent.parameters)
          break

        case 'general_query':
          result = await this.handleGeneralQuery(intent.parameters)
          break

        default:
          result = await this.handleGeneralQuery(intent.parameters)
      }

      return {
        actionType: intent.specific,
        status: 'success',
        result,
        executionTimeMs: Date.now() - startTime
      }
    } catch (error) {
      return {
        actionType: intent.specific,
        status: 'failure',
        result: null,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        executionTimeMs: Date.now() - startTime
      }
    }
  }

  /**
   * Generate AI response
   */
  private async generateResponse(
    session: ConversationSession,
    intent: DetectedIntent,
    entities: ExtractedEntity[],
    actionResult?: ActionResult
  ): Promise<string> {
    // Build conversation history
    const history = session.messages
      .slice(-5) // Last 5 messages for context
      .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n\n')

    const entitiesStr = entities.map((e) => `${e.type}: ${e.value}`).join(', ')

    const actionResultStr = actionResult
      ? `Action executed: ${actionResult.actionType}\nStatus: ${actionResult.status}\nResult: ${JSON.stringify(actionResult.result, null, 2)}`
      : 'No action executed'

    const prompt = `Based on this conversation context:

${history}

Current intent: ${intent.primary} - ${intent.specific}
Extracted entities: ${entitiesStr}

${actionResultStr}

Generate a helpful, concise response that:
1. Directly answers the user's question or acknowledges their request
2. Presents data/results clearly if available
3. Offers relevant follow-up suggestions
4. Maintains professional but friendly tone

Keep response under 200 words unless more detail is clearly needed.`

    const response = await this.llmService.complete({
      prompt,
      systemPrompt: `You are a helpful AI assistant for a UCC intelligence platform. You help users find prospects, analyze data, and make informed decisions. Be concise, accurate, and actionable.`,
      temperature: 0.7,
      maxTokens: 500
    })

    return response.text
  }

  /**
   * Get conversation session
   */
  getSessionHistory(sessionId: string): Message[] {
    const session = this.sessions.get(sessionId)
    return session?.messages || []
  }

  /**
   * Get suggested queries based on context
   */
  async getSuggestions(context: ConversationContext): Promise<string[]> {
    const suggestions: string[] = [
      'Show me prospects in construction industry',
      'Which competitors are most active this month?',
      'Find prospects with hiring signals',
      "What's my conversion rate this quarter?",
      'Generate an executive summary report'
    ]

    // Personalize based on context
    if (context.currentView === 'prospects') {
      suggestions.unshift(
        'Filter prospects by health grade A or B',
        'Show prospects with 3+ growth signals'
      )
    } else if (context.currentView === 'intelligence') {
      suggestions.unshift(
        'Analyze competitor market share trends',
        'Identify white space opportunities'
      )
    }

    return suggestions.slice(0, 5)
  }

  /**
   * Explain reasoning behind response
   */
  async explainResponse(messageId: string): Promise<string> {
    // Find message
    let message: Message | undefined
    for (const session of this.sessions.values()) {
      message = session.messages.find((m) => m.messageId === messageId)
      if (message) break
    }

    if (!message) {
      return 'Message not found'
    }

    const prompt = `Explain the reasoning behind this AI response:

User input: "${message.content}"
Intent: ${message.intent?.specific}
Confidence: ${message.confidence}
Entities extracted: ${message.entities?.map((e) => `${e.type}: ${e.value}`).join(', ')}
Action taken: ${message.actionTaken?.actionType}

Provide a clear explanation of:
1. How the intent was detected
2. What entities were found and why they matter
3. What action was taken and why
4. How the response was formulated`

    const response = await this.llmService.complete({
      prompt,
      systemPrompt: 'You explain AI decision-making in clear, understandable terms.',
      temperature: 0.5,
      maxTokens: 400
    })

    return response.text
  }

  // ==================== PRIVATE METHODS ====================

  /**
   * Get or create conversation session
   */
  private getOrCreateSession(sessionId: string): ConversationSession {
    let session = this.sessions.get(sessionId)

    if (!session) {
      session = {
        sessionId,
        userId: 'unknown', // Set by caller
        startedAt: new Date(),
        lastActiveAt: new Date(),
        messages: [],
        context: {
          userId: 'unknown',
          recentActions: [],
          userGoals: [],
          sessionMetadata: {}
        },
        persistent: true
      }

      this.sessions.set(sessionId, session)
    }

    return session
  }

  /**
   * Initialize AI capabilities
   */
  private initializeCapabilities(): AICapability[] {
    return [
      {
        name: 'Prospect Search',
        description: 'Find prospects using natural language queries',
        examples: [
          'Show me construction companies in Texas',
          'Find prospects with hiring signals and health grade A',
          'Companies that defaulted in the last 30 days'
        ],
        category: 'query',
        enabled: true
      },
      {
        name: 'Competitor Analysis',
        description: 'Analyze competitor activity and market position',
        examples: [
          'Who are my top competitors?',
          'Analyze competitor market share trends',
          'Which competitors are active in healthcare?'
        ],
        category: 'analysis',
        enabled: true
      },
      {
        name: 'Report Generation',
        description: 'Generate custom reports and insights',
        examples: [
          'Create an executive summary',
          'Generate performance report for last month',
          'Market analysis for construction industry'
        ],
        category: 'generation',
        enabled: true
      },
      {
        name: 'Data Export',
        description: 'Export filtered data in various formats',
        examples: [
          'Export top 50 prospects to CSV',
          'Download all prospects with growth signals',
          'Export competitor data as JSON'
        ],
        category: 'action',
        enabled: true
      }
    ]
  }

  /**
   * Rule-based intent detection (fallback)
   */
  private ruleBasedIntentDetection(message: string): DetectedIntent {
    const lower = message.toLowerCase()

    // Query patterns
    if (
      lower.includes('show') ||
      lower.includes('find') ||
      lower.includes('search') ||
      lower.includes('get')
    ) {
      if (lower.includes('prospect')) {
        return {
          primary: 'query',
          specific: 'find_prospects',
          confidence: 0.8,
          parameters: {}
        }
      }
      if (lower.includes('competitor')) {
        return {
          primary: 'query',
          specific: 'analyze_competitor',
          confidence: 0.8,
          parameters: {}
        }
      }
    }

    // Analysis patterns
    if (lower.includes('analyze') || lower.includes('compare') || lower.includes('trend')) {
      return {
        primary: 'analysis',
        specific: 'analyze_data',
        confidence: 0.7,
        parameters: {}
      }
    }

    // Export patterns
    if (lower.includes('export') || lower.includes('download')) {
      return {
        primary: 'export',
        specific: 'export_data',
        confidence: 0.9,
        parameters: {}
      }
    }

    // Report generation
    if (lower.includes('report') || lower.includes('summary')) {
      return {
        primary: 'analysis',
        specific: 'generate_report',
        confidence: 0.8,
        parameters: {}
      }
    }

    // Default
    return {
      primary: 'query',
      specific: 'general_query',
      confidence: 0.5,
      parameters: {}
    }
  }

  /**
   * Normalize entity values
   */
  private normalizeEntity(type: string, value: string): string | number | Date {
    switch (type) {
      case 'date':
      case 'date_range':
        // Parse date strings
        return new Date(value)

      case 'number':
      case 'metric':
        return parseFloat(value.replace(/[^0-9.-]/g, ''))

      case 'location':
      case 'state': {
        // Normalize state names to abbreviations
        const stateMap: Record<string, string> = {
          'new york': 'NY',
          california: 'CA',
          texas: 'TX'
          // ... etc
        }
        return stateMap[value.toLowerCase()] || value
      }

      default:
        return value
    }
  }

  /**
   * Find prospects.
   */
  private async findProspects(
    _parameters: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    void _parameters
    throw new Error('ConversationAI prospect search is not wired to a live query service')
  }

  /**
   * Analyze competitor.
   */
  private async analyzeCompetitor(
    _parameters: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    void _parameters
    throw new Error('ConversationAI competitor analysis is not wired to live intelligence data')
  }

  /**
   * Generate report.
   */
  private async generateReport(
    _parameters: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    void _parameters
    throw new Error('ConversationAI report generation is not wired to a report backend')
  }

  /**
   * Export data.
   */
  private async exportData(_parameters: Record<string, unknown>): Promise<Record<string, unknown>> {
    void _parameters
    throw new Error('ConversationAI export is not wired to a file export service')
  }

  /**
   * Get statistics.
   */
  private async getStatistics(
    _parameters: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    void _parameters
    throw new Error('ConversationAI statistics are not wired to live analytics')
  }

  /**
   * Analyze data.
   */
  private async analyzeData(
    _parameters: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    void _parameters
    throw new Error('ConversationAI data analysis is not wired to a live analytics engine')
  }

  /**
   * Handle general query.
   */
  private async handleGeneralQuery(
    _parameters: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    void _parameters
    throw new Error('ConversationAI general-query handling requires a wired backend action layer')
  }
}

export default ConversationAI
