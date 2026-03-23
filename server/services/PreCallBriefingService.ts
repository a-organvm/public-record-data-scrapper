import { FreshCapacityService } from './FreshCapacityService'

export interface PreCallBriefing {
  prospectId: string
  generatedAt: string
  companyName: string
  state: string
  industry: string | null
  priorityScore: number | null
  stackAnalysis: {
    activeFilings: number
    terminatedFilings: number
    totalFilings: number
    knownCompetitors: string[]
  }
  freshCapacity: {
    score: number
    recentTerminations: number
    daysSinceLastTermination: number | null
  }
  velocity: {
    trend30d: string | null
    filings30d: number
    trend90d: string | null
  }
  talkingPoints: string[]
  riskFactors: string[]
}

export class PreCallBriefingService {
  constructor(private db: { query: <T>(sql: string, params?: unknown[]) => Promise<T[]> }) {}

  async generateBriefing(prospectId: string): Promise<PreCallBriefing> {
    // 1. Get prospect data
    const prospects = await this.db.query<{
      id: string
      company_name: string
      state: string
      industry: string | null
      priority_score: number | null
    }>(`SELECT id, company_name, state, industry, priority_score FROM prospects WHERE id = $1`, [
      prospectId
    ])
    if (prospects.length === 0) throw new Error(`Prospect not found: ${prospectId}`)
    const prospect = prospects[0]

    // 2. Get filing stats
    const filingStats = await this.db.query<{ status: string; count: string }>(
      `SELECT uf.status, COUNT(*)::text as count
       FROM ucc_filings uf JOIN prospect_ucc_filings puf ON uf.id = puf.ucc_filing_id
       WHERE puf.prospect_id = $1 GROUP BY uf.status`,
      [prospectId]
    )
    const activeFilings = parseInt(filingStats.find((r) => r.status === 'active')?.count ?? '0', 10)
    const terminatedFilings = parseInt(
      filingStats.find((r) => r.status === 'terminated')?.count ?? '0',
      10
    )
    const totalFilings = filingStats.reduce((sum, r) => sum + parseInt(r.count, 10), 0)

    // 3. Get known competitors
    const competitors = await this.db.query<{ secured_party_name: string }>(
      `SELECT DISTINCT uf.secured_party_name FROM ucc_filings uf
       JOIN prospect_ucc_filings puf ON uf.id = puf.ucc_filing_id
       WHERE puf.prospect_id = $1 AND uf.status = 'active'`,
      [prospectId]
    )

    // 4. Get fresh capacity
    const capacityService = new FreshCapacityService(this.db)
    const capacity = await capacityService.computeForProspect(prospectId)

    // 5. Get velocity
    const velocityRows = await this.db.query<{
      window_days: number
      filings_in_window: number
      trend: string
    }>(
      `SELECT window_days, filings_in_window, trend FROM filing_velocity_metrics WHERE prospect_id = $1`,
      [prospectId]
    )
    const v30 = velocityRows.find((r) => r.window_days === 30)
    const v90 = velocityRows.find((r) => r.window_days === 90)

    // 6. Generate talking points
    const talkingPoints: string[] = []
    if (capacity.score >= 50)
      talkingPoints.push('Fresh capacity available — recently paid off financing')
    if (activeFilings === 0) talkingPoints.push('Clean UCC history — prime 1st position candidate')
    if (activeFilings >= 3)
      talkingPoints.push(`${activeFilings} active positions — discuss consolidation`)
    if (v30?.trend === 'accelerating')
      talkingPoints.push('Filing activity accelerating — business may be expanding')
    if (talkingPoints.length === 0)
      talkingPoints.push('Standard outreach — review filing history before call')

    // 7. Risk factors
    const riskFactors: string[] = []
    if (activeFilings >= 4) riskFactors.push('Potential over-stacking risk')
    if (v30?.trend === 'accelerating' && activeFilings >= 3)
      riskFactors.push('Rapid stacking pattern — verify capacity')
    if (terminatedFilings === 0 && activeFilings >= 2)
      riskFactors.push('No payoff history — untested repayment')

    const briefing: PreCallBriefing = {
      prospectId,
      generatedAt: new Date().toISOString(),
      companyName: prospect.company_name,
      state: prospect.state,
      industry: prospect.industry,
      priorityScore: prospect.priority_score,
      stackAnalysis: {
        activeFilings,
        terminatedFilings,
        totalFilings,
        knownCompetitors: competitors.map((c) => c.secured_party_name)
      },
      freshCapacity: {
        score: capacity.score,
        recentTerminations: capacity.input.terminatedFilings,
        daysSinceLastTermination:
          capacity.input.daysSinceRecentTermination < 999
            ? capacity.input.daysSinceRecentTermination
            : null
      },
      velocity: {
        trend30d: v30?.trend ?? null,
        filings30d: v30?.filings_in_window ?? 0,
        trend90d: v90?.trend ?? null
      },
      talkingPoints,
      riskFactors
    }

    // Cache briefing
    await this.db.query(
      `INSERT INTO pre_call_briefings (prospect_id, content, generated_at, expires_at)
       VALUES ($1, $2, NOW(), NOW() + INTERVAL '24 hours')
       ON CONFLICT (prospect_id) DO UPDATE SET content = $2, generated_at = NOW(), expires_at = NOW() + INTERVAL '24 hours'`,
      [prospectId, JSON.stringify(briefing)]
    )

    return briefing
  }

  async getCachedBriefing(prospectId: string): Promise<PreCallBriefing | null> {
    const rows = await this.db.query<{ content: string; expires_at: string }>(
      `SELECT content, expires_at FROM pre_call_briefings WHERE prospect_id = $1`,
      [prospectId]
    )
    if (rows.length === 0) return null
    if (new Date(rows[0].expires_at) < new Date()) return null
    return JSON.parse(rows[0].content) as PreCallBriefing
  }
}
