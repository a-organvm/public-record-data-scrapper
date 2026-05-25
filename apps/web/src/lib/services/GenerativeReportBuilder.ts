/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
// Experimental generative AI features - disabled strict linting
import type {
  Prospect,
  GenerativeReport,
  ReportSection,
  GenerativeInsight,
  CompetitorData,
  CompanyGraph,
  Visualization,
  IndustryType
} from '@public-records/core'
import { GenerativeNarrativeEngine } from './GenerativeNarrativeEngine'

/**
 * GenerativeReportBuilder - AI-powered report generation
 * Creates comprehensive, customizable reports with insights and visualizations
 */
export class GenerativeReportBuilder {
  private prospects: Prospect[]
  private narrativeEngine: GenerativeNarrativeEngine
  private competitorData?: CompetitorData[]
  private relationshipGraphs?: Map<string, CompanyGraph>

  constructor(
    prospects: Prospect[],
    narrativeEngine: GenerativeNarrativeEngine,
    competitorData?: CompetitorData[],
    relationshipGraphs?: Map<string, CompanyGraph>
  ) {
    this.prospects = prospects
    this.narrativeEngine = narrativeEngine
    this.competitorData = competitorData
    this.relationshipGraphs = relationshipGraphs
  }

  /**
   * Generate a comprehensive portfolio report
   */
  async generatePortfolioReport(
    dateRange: { start: string; end: string },
    userId: string
  ): Promise<GenerativeReport> {
    const sections: ReportSection[] = []

    // Executive Summary
    sections.push(await this.generateExecutiveSummary())

    // Portfolio Overview
    sections.push(await this.generatePortfolioOverview())

    // Performance Analysis
    sections.push(await this.generatePerformanceAnalysis())

    // Risk Assessment
    sections.push(await this.generateRiskAssessment())

    // Growth Opportunities
    sections.push(await this.generateGrowthOpportunities())

    // Industry Breakdown
    sections.push(await this.generateIndustryBreakdown())

    // Recommendations
    sections.push(await this.generateRecommendations())

    // Generate insights
    const insights = await this.narrativeEngine.generateInsights(
      this.prospects,
      this.competitorData,
      this.relationshipGraphs
    )

    // Compile report
    const content = this.compileMarkdown(sections)

    return {
      id: `report-portfolio-${Date.now()}`,
      title: 'Portfolio Performance Report',
      type: 'portfolio',
      sections,
      insights: insights.slice(0, 10),
      recommendations: this.extractRecommendations(sections),
      metadata: {
        generatedAt: new Date().toISOString(),
        generatedBy: userId,
        dataRange: dateRange,
        prospectCount: this.prospects.length,
        sources: ['UCC Filings', 'Growth Signals', 'Health Scores', 'Market Data']
      },
      format: 'markdown',
      content
    }
  }

  /**
   * Generate a market analysis report
   */
  async generateMarketReport(
    industry?: IndustryType,
    userId: string = 'system'
  ): Promise<GenerativeReport> {
    const sections: ReportSection[] = []

    // Market Overview
    sections.push(await this.generateMarketOverview(industry))

    // Competitive Landscape
    sections.push(await this.generateCompetitiveLandscape())

    // Market Trends
    sections.push(await this.generateMarketTrends(industry))

    // Opportunity Analysis
    sections.push(await this.generateOpportunityAnalysis(industry))

    // Market Share Analysis
    sections.push(await this.generateMarketShareAnalysis())

    // Strategic Recommendations
    sections.push(await this.generateStrategicRecommendations(industry))

    const content = this.compileMarkdown(sections)
    const insights = await this.narrativeEngine.generateInsights(
      this.prospects.filter((p) => !industry || p.industry === industry)
    )

    return {
      id: `report-market-${Date.now()}`,
      title: industry
        ? `${industry.charAt(0).toUpperCase() + industry.slice(1)} Market Analysis`
        : 'Market Analysis Report',
      type: 'market',
      sections,
      insights: insights.slice(0, 10),
      recommendations: this.extractRecommendations(sections),
      metadata: {
        generatedAt: new Date().toISOString(),
        generatedBy: userId,
        dataRange: { start: '', end: '' },
        prospectCount: industry
          ? this.prospects.filter((p) => p.industry === industry).length
          : this.prospects.length,
        sources: ['Market Data', 'Competitor Analysis', 'Industry Trends']
      },
      format: 'markdown',
      content
    }
  }

  /**
   * Generate a prospect-specific report
   */
  async generateProspectReport(prospectId: string, userId: string): Promise<GenerativeReport> {
    const prospect = this.prospects.find((p) => p.id === prospectId)
    if (!prospect) {
      throw new Error(`Prospect ${prospectId} not found`)
    }

    const sections: ReportSection[] = []

    // Company Profile
    sections.push(this.generateCompanyProfile(prospect))

    // Financial Overview
    sections.push(this.generateFinancialOverview(prospect))

    // Growth Signal Analysis
    sections.push(this.generateGrowthSignalAnalysis(prospect))

    // Health Assessment
    sections.push(this.generateHealthAssessment(prospect))

    // Network Analysis
    if (this.relationshipGraphs?.has(prospectId)) {
      sections.push(await this.generateNetworkAnalysis(prospect))
    }

    // Competitive Position
    sections.push(await this.generateCompetitivePosition(prospect))

    // Risk Factors
    sections.push(this.generateRiskFactors(prospect))

    // Opportunity Assessment
    sections.push(this.generateOpportunityAssessment(prospect))

    // Generate narrative
    const narrative = await this.narrativeEngine.generateNarrative({
      prospect,
      marketData: this.competitorData,
      relationships: this.relationshipGraphs?.get(prospectId)
    })

    const content = this.compileMarkdown(sections)

    return {
      id: `report-prospect-${prospectId}-${Date.now()}`,
      title: `Prospect Analysis: ${prospect.companyName}`,
      type: 'prospect',
      sections,
      insights: [
        {
          id: `insight-${Date.now()}`,
          type: 'opportunity',
          title: 'AI-Generated Analysis',
          description: narrative.summary,
          confidence: narrative.keyInsights[0]?.confidence ?? 0,
          impact: 'high',
          relatedProspects: [prospectId],
          generatedAt: new Date().toISOString(),
          evidence: narrative.keyInsights[0]?.sources ?? []
        }
      ],
      recommendations: narrative.recommendedActions,
      metadata: {
        generatedAt: new Date().toISOString(),
        generatedBy: userId,
        dataRange: { start: '', end: '' },
        prospectCount: 1,
        sources: narrative.keyInsights[0]?.sources ?? []
      },
      format: 'markdown',
      content
    }
  }

  /**
   * Generate competitive intelligence report
   */
  async generateCompetitiveReport(userId: string): Promise<GenerativeReport> {
    const sections: ReportSection[] = []

    // Competitor Overview
    sections.push(this.generateCompetitorOverview())

    // Market Position
    sections.push(this.generateMarketPosition())

    // Deal Flow Analysis
    sections.push(this.generateDealFlowAnalysis())

    // Industry Focus
    sections.push(this.generateIndustryFocusAnalysis())

    // Competitive Threats
    sections.push(this.generateCompetitiveThreats())

    // Strategic Opportunities
    sections.push(this.generateStrategicOpportunities())

    const content = this.compileMarkdown(sections)

    return {
      id: `report-competitive-${Date.now()}`,
      title: 'Competitive Intelligence Report',
      type: 'competitive',
      sections,
      insights: [],
      recommendations: this.extractRecommendations(sections),
      metadata: {
        generatedAt: new Date().toISOString(),
        generatedBy: userId,
        dataRange: { start: '', end: '' },
        prospectCount: this.prospects.length,
        sources: ['Competitor Data', 'Market Share Analysis', 'Deal Flow Data']
      },
      format: 'markdown',
      content
    }
  }

  // Section generators

  private async generateExecutiveSummary(): Promise<ReportSection> {
    const totalProspects = this.prospects.length
    const avgScore = this.prospects.reduce((sum, p) => sum + p.priorityScore, 0) / totalProspects
    const highValue = this.prospects.filter((p) => p.priorityScore >= 75).length
    const claimed = this.prospects.filter((p) => p.claimedBy).length

    const content = `
This report provides a comprehensive analysis of ${totalProspects} prospects in the portfolio.

**Key Highlights:**
- Average Priority Score: ${avgScore.toFixed(1)}/100
- High-Value Prospects (≥75): ${highValue} (${((highValue / totalProspects) * 100).toFixed(1)}%)
- Claimed Prospects: ${claimed} (${((claimed / totalProspects) * 100).toFixed(1)}%)
- Total Growth Signals Detected: ${this.prospects.reduce((sum, p) => sum + p.growthSignals.length, 0)}
- Average Health Grade: ${this.calculateAvgHealthGrade()}

The portfolio shows ${avgScore >= 70 ? 'strong' : avgScore >= 60 ? 'moderate' : 'developing'} overall potential with significant opportunities for value capture.
`

    return {
      id: 'executive-summary',
      title: 'Executive Summary',
      content: content.trim()
    }
  }

  private async generatePortfolioOverview(): Promise<ReportSection> {
    const byIndustry = this.groupByIndustry()
    const byState = this.groupByState()
    const byHealth = this.groupByHealthGrade()

    const content = `
**Industry Distribution:**
${Array.from(byIndustry.entries())
  .sort((a, b) => b[1] - a[1])
  .map(
    ([industry, count]) =>
      `- ${industry}: ${count} prospects (${((count / this.prospects.length) * 100).toFixed(1)}%)`
  )
  .join('\n')}

**Geographic Distribution:**
${Array.from(byState.entries())
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .map(([state, count]) => `- ${state}: ${count} prospects`)
  .join('\n')}

**Health Distribution:**
${Array.from(byHealth.entries())
  .sort((a, b) => {
    const gradeOrder = { A: 5, B: 4, C: 3, D: 2, F: 1 }
    return gradeOrder[b[0] as keyof typeof gradeOrder] - gradeOrder[a[0] as keyof typeof gradeOrder]
  })
  .map(
    ([grade, count]) =>
      `- Grade ${grade}: ${count} prospects (${((count / this.prospects.length) * 100).toFixed(1)}%)`
  )
  .join('\n')}
`

    return {
      id: 'portfolio-overview',
      title: 'Portfolio Overview',
      content: content.trim(),
      visualizations: [
        {
          type: 'chart',
          config: { chartType: 'pie', title: 'Industry Distribution' },
          data: Array.from(byIndustry.entries()).map(([industry, count]) => ({
            label: industry,
            value: count
          }))
        }
      ]
    }
  }

  private async generatePerformanceAnalysis(): Promise<ReportSection> {
    const qualified = this.prospects.filter((p) => p.status === 'qualified').length
    const contacted = this.prospects.filter((p) => p.status === 'contacted').length
    const dead = this.prospects.filter((p) => p.status === 'dead').length

    const content = `
**Pipeline Status:**
- Qualified: ${qualified} prospects
- Contacted: ${contacted} prospects
- Dead: ${dead} prospects
- Conversion Rate: ${this.prospects.length > 0 ? ((qualified / this.prospects.length) * 100).toFixed(1) : 0}%

**Performance Trends:**
- Prospects with growth signals: ${this.prospects.filter((p) => p.growthSignals.length > 0).length}
- Multi-signal prospects: ${this.prospects.filter((p) => p.growthSignals.length >= 3).length}
- Improving health trend: ${this.prospects.filter((p) => p.healthScore.sentimentTrend === 'improving').length}
- Declining health trend: ${this.prospects.filter((p) => p.healthScore.sentimentTrend === 'declining').length}
`

    return {
      id: 'performance-analysis',
      title: 'Performance Analysis',
      content: content.trim()
    }
  }

  private async generateRiskAssessment(): Promise<ReportSection> {
    const lowHealth = this.prospects.filter(
      (p) => p.healthScore.grade === 'D' || p.healthScore.grade === 'F'
    )
    const declining = this.prospects.filter((p) => p.healthScore.sentimentTrend === 'declining')
    const longDefault = this.prospects.filter((p) => p.timeSinceDefault > 365)

    const content = `
**Risk Indicators:**
- Low Health (D/F grade): ${lowHealth.length} prospects (${((lowHealth.length / this.prospects.length) * 100).toFixed(1)}%)
- Declining Health Trend: ${declining.length} prospects
- Extended Default (>1 year): ${longDefault.length} prospects

**Risk Concentration:**
${this.calculateRiskConcentration()}

**Recommended Actions:**
- Immediate review of ${lowHealth.length} low-health prospects
- Monitor ${declining.length} prospects with declining trends
- Re-evaluate ${longDefault.length} extended default cases
`

    return {
      id: 'risk-assessment',
      title: 'Risk Assessment',
      content: content.trim()
    }
  }

  private async generateGrowthOpportunities(): Promise<ReportSection> {
    const withSignals = this.prospects.filter((p) => p.growthSignals.length > 0)
    const multiSignal = this.prospects.filter((p) => p.growthSignals.length >= 3)
    const improving = this.prospects.filter((p) => p.healthScore.sentimentTrend === 'improving')

    const content = `
**Growth Signal Analysis:**
- Prospects with signals: ${withSignals.length} (${((withSignals.length / this.prospects.length) * 100).toFixed(1)}%)
- Multi-signal prospects: ${multiSignal.length}
- Improving health: ${improving.length} prospects

**Top Opportunities:**
${this.prospects
  .filter((p) => p.growthSignals.length >= 2)
  .sort((a, b) => b.priorityScore - a.priorityScore)
  .slice(0, 5)
  .map(
    (p, i) =>
      `${i + 1}. ${p.companyName} - Score: ${p.priorityScore}, Signals: ${p.growthSignals.length}`
  )
  .join('\n')}
`

    return {
      id: 'growth-opportunities',
      title: 'Growth Opportunities',
      content: content.trim()
    }
  }

  private async generateIndustryBreakdown(): Promise<ReportSection> {
    const byIndustry = this.groupByIndustry()
    const avgScoreByIndustry = this.calculateAvgScoreByIndustry()

    const content = `
**Industry Performance:**
${Array.from(byIndustry.entries())
  .sort((a, b) => b[1] - a[1])
  .map(([industry, count]) => {
    const avg = avgScoreByIndustry.get(industry) || 0
    return `- ${industry}: ${count} prospects, avg score: ${avg.toFixed(1)}`
  })
  .join('\n')}
`

    return {
      id: 'industry-breakdown',
      title: 'Industry Breakdown',
      content: content.trim()
    }
  }

  private async generateRecommendations(): Promise<ReportSection> {
    const content = `
Based on the portfolio analysis, we recommend:

1. **Prioritize High-Signal Prospects**: Focus on the ${this.prospects.filter((p) => p.growthSignals.length >= 3).length} prospects with multiple growth signals for immediate outreach.

2. **Address Declining Health**: Implement proactive monitoring for the ${this.prospects.filter((p) => p.healthScore.sentimentTrend === 'declining').length} prospects showing health deterioration.

3. **Industry Focus**: Concentrate efforts on top-performing industries: ${Array.from(
      this.calculateAvgScoreByIndustry().entries()
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([ind]) => ind)
      .join(', ')}.

4. **Re-qualification**: Review ${this.prospects.filter((p) => p.status === 'dead').length} dead leads for potential re-qualification opportunities.

5. **Network Mapping**: Leverage relationship graphs to identify cross-selling opportunities in connected company networks.
`

    return {
      id: 'recommendations',
      title: 'Strategic Recommendations',
      content: content.trim()
    }
  }

  private generateCompanyProfile(prospect: Prospect): ReportSection {
    const content = `
**Company Information:**
- Name: ${prospect.companyName}
- Industry: ${prospect.industry}
- State: ${prospect.state}
- Status: ${prospect.status}
${prospect.claimedBy ? `- Claimed by: ${prospect.claimedBy}` : '- Unclaimed'}

**Key Metrics:**
- Priority Score: ${prospect.priorityScore}/100
- Health Grade: ${prospect.healthScore.grade} (${prospect.healthScore.score}/100)
- Estimated Revenue: $${prospect.estimatedRevenue?.toLocaleString() || 'Unknown'}
- Time Since Default: ${prospect.timeSinceDefault} days
- Growth Signals: ${prospect.growthSignals.length} detected
`

    return {
      id: 'company-profile',
      title: 'Company Profile',
      content: content.trim()
    }
  }

  private generateFinancialOverview(prospect: Prospect): ReportSection {
    const totalLiens = prospect.uccFilings.reduce((sum, f) => sum + (f.lienAmount || 0), 0)

    const content = `
**UCC Filing Summary:**
- Total Filings: ${prospect.uccFilings.length}
- Total Lien Amount: $${totalLiens.toLocaleString()}
- Active Filings: ${prospect.uccFilings.filter((f) => f.status === 'active').length}
- Lapsed Filings: ${prospect.uccFilings.filter((f) => f.status === 'lapsed').length}

**Estimated Financials:**
- Estimated Revenue: $${prospect.estimatedRevenue?.toLocaleString() || 'Unknown'}
- Revenue Confidence: ${prospect.estimatedRevenue ? 'Medium' : 'Low'}

**Recent Filings:**
${prospect.uccFilings
  .slice(0, 5)
  .map(
    (f) => `- ${f.filingDate}: ${f.securedParty} - $${f.lienAmount?.toLocaleString() || 'Unknown'}`
  )
  .join('\n')}
`

    return {
      id: 'financial-overview',
      title: 'Financial Overview',
      content: content.trim()
    }
  }

  private generateGrowthSignalAnalysis(prospect: Prospect): ReportSection {
    const content = `
**Detected Signals (${prospect.growthSignals.length}):**
${prospect.growthSignals.length > 0 ? prospect.growthSignals.map((s) => `- **${s.type}**: ${s.description} (confidence: ${s.confidence})`).join('\n') : 'No growth signals detected'}

**Signal Strength:**
${prospect.growthSignals.length >= 3 ? 'Strong - Multiple concurrent signals indicate high growth activity' : prospect.growthSignals.length >= 1 ? 'Moderate - Some growth activity detected' : 'Weak - No growth signals detected'}
`

    return {
      id: 'growth-signal-analysis',
      title: 'Growth Signal Analysis',
      content: content.trim()
    }
  }

  private generateHealthAssessment(prospect: Prospect): ReportSection {
    const content = `
**Health Metrics:**
- Overall Grade: ${prospect.healthScore.grade}
- Health Score: ${prospect.healthScore.score}/100
- Sentiment Trend: ${prospect.healthScore.sentimentTrend}
- Review Count: ${prospect.healthScore.reviewCount}
- Average Sentiment: ${prospect.healthScore.avgSentiment}
- Violation Count: ${prospect.healthScore.violationCount}

**Assessment:**
${prospect.healthScore.score >= 80 ? 'Strong operational health with positive indicators' : prospect.healthScore.score >= 60 ? 'Moderate health with some concerns' : 'Weak health requiring careful evaluation'}
`

    return {
      id: 'health-assessment',
      title: 'Health Assessment',
      content: content.trim()
    }
  }

  private async generateNetworkAnalysis(prospect: Prospect): Promise<ReportSection> {
    const graph = this.relationshipGraphs?.get(prospect.id)

    const content = graph
      ? `
**Network Statistics:**
- Connected Companies: ${graph.totalNodes}
- Total Relationships: ${graph.totalEdges}
- Network Health: ${graph.metadata.networkHealth || 'Unknown'}
- Risk Concentration: ${graph.metadata.riskConcentration?.toFixed(2) || 'Unknown'}
- Total Network Exposure: $${graph.metadata.totalExposure?.toLocaleString() || 'Unknown'}

**Key Relationships:**
${Array.from(graph.nodes.values())
  .filter((n) => n.id !== prospect.id)
  .slice(0, 5)
  .map((n) => `- ${n.companyName} (depth: ${n.depth})`)
  .join('\n')}
`
      : 'No network data available'

    return {
      id: 'network-analysis',
      title: 'Network Analysis',
      content: content.trim()
    }
  }

  private async generateCompetitivePosition(prospect: Prospect): Promise<ReportSection> {
    const content = `
**Market Position:**
- Industry: ${prospect.industry}
- Priority Ranking: Top ${this.calculatePercentileRank(prospect)}%

**Competitive Factors:**
- Growth signals vs. industry average: ${this.compareToIndustryAverage(prospect, 'signals')}
- Health score vs. industry average: ${this.compareToIndustryAverage(prospect, 'health')}
`

    return {
      id: 'competitive-position',
      title: 'Competitive Position',
      content: content.trim()
    }
  }

  private generateRiskFactors(prospect: Prospect): ReportSection {
    const risks: string[] = []

    if (prospect.timeSinceDefault > 365) {
      risks.push('Extended time in default (>1 year)')
    }
    if (prospect.healthScore.grade === 'D' || prospect.healthScore.grade === 'F') {
      risks.push('Low health grade indicates operational challenges')
    }
    if (prospect.healthScore.sentimentTrend === 'declining') {
      risks.push('Declining health trend requires monitoring')
    }
    if (prospect.growthSignals.length === 0) {
      risks.push('No growth signals detected')
    }
    if (prospect.healthScore.violationCount > 0) {
      risks.push(`${prospect.healthScore.violationCount} violations on record`)
    }

    const content = `
**Identified Risk Factors:**
${risks.length > 0 ? risks.map((r, i) => `${i + 1}. ${r}`).join('\n') : 'No significant risk factors identified'}

**Risk Level:** ${risks.length >= 3 ? 'High' : risks.length >= 1 ? 'Moderate' : 'Low'}
`

    return {
      id: 'risk-factors',
      title: 'Risk Factors',
      content: content.trim()
    }
  }

  private generateOpportunityAssessment(prospect: Prospect): ReportSection {
    const opportunities: string[] = []

    if (prospect.growthSignals.length >= 3) {
      opportunities.push('Multiple growth signals indicate strong expansion')
    }
    if (prospect.healthScore.sentimentTrend === 'improving') {
      opportunities.push('Improving health trend shows positive momentum')
    }
    if (prospect.priorityScore >= 75) {
      opportunities.push('High priority score indicates strong potential')
    }
    if (!prospect.claimedBy) {
      opportunities.push('Unclaimed prospect available for immediate action')
    }

    const content = `
**Opportunity Factors:**
${opportunities.length > 0 ? opportunities.map((o, i) => `${i + 1}. ${o}`).join('\n') : 'Limited opportunity indicators'}

**Opportunity Rating:** ${opportunities.length >= 3 ? 'High' : opportunities.length >= 1 ? 'Moderate' : 'Low'}

**Recommended Next Steps:**
${this.generateNextSteps(prospect)
  .map((s, i) => `${i + 1}. ${s}`)
  .join('\n')}
`

    return {
      id: 'opportunity-assessment',
      title: 'Opportunity Assessment',
      content: content.trim()
    }
  }

  private generateCompetitorOverview(): ReportSection {
    const content = this.competitorData
      ? `
**Top Competitors (by filing count):**
${this.competitorData
  .sort((a, b) => b.filingCount - a.filingCount)
  .slice(0, 10)
  .map(
    (c, i) =>
      `${i + 1}. ${c.lenderName} - ${c.filingCount} filings, $${c.avgDealSize.toLocaleString()} avg deal size`
  )
  .join('\n')}
`
      : 'No competitor data available'

    return {
      id: 'competitor-overview',
      title: 'Competitor Overview',
      content: content.trim()
    }
  }

  private generateMarketPosition(): ReportSection {
    return {
      id: 'market-position',
      title: 'Market Position',
      content: 'Market position analysis would go here'
    }
  }

  private generateDealFlowAnalysis(): ReportSection {
    return {
      id: 'deal-flow',
      title: 'Deal Flow Analysis',
      content: 'Deal flow analysis would go here'
    }
  }

  private generateIndustryFocusAnalysis(): ReportSection {
    return {
      id: 'industry-focus',
      title: 'Industry Focus',
      content: 'Industry focus analysis would go here'
    }
  }

  private generateCompetitiveThreats(): ReportSection {
    return {
      id: 'competitive-threats',
      title: 'Competitive Threats',
      content: 'Competitive threats analysis would go here'
    }
  }

  private generateStrategicOpportunities(): ReportSection {
    return {
      id: 'strategic-opportunities',
      title: 'Strategic Opportunities',
      content: 'Strategic opportunities would go here'
    }
  }

  private async generateMarketOverview(industry?: IndustryType): Promise<ReportSection> {
    return {
      id: 'market-overview',
      title: 'Market Overview',
      content: `Market overview for ${industry || 'all industries'}`
    }
  }

  private async generateCompetitiveLandscape(): Promise<ReportSection> {
    return {
      id: 'competitive-landscape',
      title: 'Competitive Landscape',
      content: 'Competitive landscape analysis'
    }
  }

  private async generateMarketTrends(industry?: IndustryType): Promise<ReportSection> {
    return {
      id: 'market-trends',
      title: 'Market Trends',
      content: `Market trends for ${industry || 'all industries'}`
    }
  }

  private async generateOpportunityAnalysis(industry?: IndustryType): Promise<ReportSection> {
    return {
      id: 'opportunity-analysis',
      title: 'Opportunity Analysis',
      content: 'Opportunity analysis'
    }
  }

  private async generateMarketShareAnalysis(): Promise<ReportSection> {
    return {
      id: 'market-share',
      title: 'Market Share Analysis',
      content: 'Market share analysis'
    }
  }

  private async generateStrategicRecommendations(industry?: IndustryType): Promise<ReportSection> {
    return {
      id: 'strategic-recommendations',
      title: 'Strategic Recommendations',
      content: 'Strategic recommendations'
    }
  }

  // Helper methods

  private compileMarkdown(sections: ReportSection[]): string {
    return sections
      .map((section) => {
        let md = `# ${section.title}\n\n${section.content}\n\n`
        if (section.subsections) {
          md += section.subsections.map((sub) => `## ${sub.title}\n\n${sub.content}\n\n`).join('')
        }
        return md
      })
      .join('')
  }

  private extractRecommendations(sections: ReportSection[]): string[] {
    const recSection = sections.find((s) => s.id.includes('recommendation'))
    if (!recSection) return []

    const lines = recSection.content.split('\n')
    return lines.filter((line) => line.match(/^\d+\./)).map((line) => line.replace(/^\d+\.\s*/, ''))
  }

  private calculateAvgHealthGrade(): string {
    const gradeValues = { A: 4, B: 3, C: 2, D: 1, F: 0 }
    const sum = this.prospects.reduce((s, p) => s + gradeValues[p.healthScore.grade], 0)
    const avg = sum / this.prospects.length
    if (avg >= 3.5) return 'A'
    if (avg >= 2.5) return 'B'
    if (avg >= 1.5) return 'C'
    if (avg >= 0.5) return 'D'
    return 'F'
  }

  private groupByIndustry(): Map<string, number> {
    const map = new Map<string, number>()
    for (const p of this.prospects) {
      map.set(p.industry, (map.get(p.industry) || 0) + 1)
    }
    return map
  }

  private groupByState(): Map<string, number> {
    const map = new Map<string, number>()
    for (const p of this.prospects) {
      map.set(p.state, (map.get(p.state) || 0) + 1)
    }
    return map
  }

  private groupByHealthGrade(): Map<string, number> {
    const map = new Map<string, number>()
    for (const p of this.prospects) {
      map.set(p.healthScore.grade, (map.get(p.healthScore.grade) || 0) + 1)
    }
    return map
  }

  private calculateAvgScoreByIndustry(): Map<string, number> {
    const sumMap = new Map<string, number>()
    const countMap = new Map<string, number>()

    for (const p of this.prospects) {
      sumMap.set(p.industry, (sumMap.get(p.industry) || 0) + p.priorityScore)
      countMap.set(p.industry, (countMap.get(p.industry) || 0) + 1)
    }

    const avgMap = new Map<string, number>()
    for (const [industry, sum] of sumMap.entries()) {
      avgMap.set(industry, sum / (countMap.get(industry) || 1))
    }

    return avgMap
  }

  private calculateRiskConcentration(): string {
    const byIndustry = this.groupByIndustry()
    const total = this.prospects.length
    const topThree = Array.from(byIndustry.values())
      .sort((a, b) => b - a)
      .slice(0, 3)
      .reduce((sum, count) => sum + count, 0)

    const concentration = (topThree / total) * 100

    return concentration > 60
      ? `High concentration: Top 3 industries represent ${concentration.toFixed(1)}% of portfolio`
      : `Moderate concentration: Top 3 industries represent ${concentration.toFixed(1)}% of portfolio`
  }

  private calculatePercentileRank(prospect: Prospect): number {
    const sorted = [...this.prospects].sort((a, b) => b.priorityScore - a.priorityScore)
    const rank = sorted.findIndex((p) => p.id === prospect.id)
    return ((rank / sorted.length) * 100).toFixed(0) as any
  }

  private compareToIndustryAverage(prospect: Prospect, metric: 'signals' | 'health'): string {
    const sameIndustry = this.prospects.filter((p) => p.industry === prospect.industry)

    if (metric === 'signals') {
      const avg =
        sameIndustry.reduce((sum, p) => sum + p.growthSignals.length, 0) / sameIndustry.length
      const diff = prospect.growthSignals.length - avg
      return diff > 0
        ? `${diff.toFixed(1)} above average`
        : diff < 0
          ? `${Math.abs(diff).toFixed(1)} below average`
          : 'Average'
    } else {
      const avg =
        sameIndustry.reduce((sum, p) => sum + p.healthScore.score, 0) / sameIndustry.length
      const diff = prospect.healthScore.score - avg
      return diff > 0
        ? `${diff.toFixed(1)} points above average`
        : diff < 0
          ? `${Math.abs(diff).toFixed(1)} points below average`
          : 'Average'
    }
  }

  private generateNextSteps(prospect: Prospect): string[] {
    const steps: string[] = []

    if (!prospect.claimedBy) {
      steps.push('Claim prospect for further evaluation')
    }

    if (prospect.growthSignals.length > 0) {
      steps.push('Verify growth signals through direct contact')
    }

    if (prospect.healthScore.grade === 'D' || prospect.healthScore.grade === 'F') {
      steps.push('Conduct detailed health assessment')
    }

    steps.push('Request updated financial statements')
    steps.push('Schedule site visit or call')

    return steps
  }
}
