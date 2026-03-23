export interface FreshCapacityInput {
  terminatedFilings: number
  activeFilings: number
  daysSinceRecentTermination: number
  recentTerminationAmount: number | null
  avgActiveAmount: number | null
}

export function calculateFreshCapacityScore(input: FreshCapacityInput): number {
  let score = 0

  // Recency bonus
  if (input.daysSinceRecentTermination <= 30) score += 30
  else if (input.daysSinceRecentTermination <= 90) score += 20
  else if (input.daysSinceRecentTermination <= 180) score += 10

  // Large payoff bonus
  if (
    input.recentTerminationAmount &&
    input.avgActiveAmount &&
    input.recentTerminationAmount > input.avgActiveAmount * 1.5
  ) {
    score += 15
  }

  // Active filing penalty
  score -= input.activeFilings * 5

  // Multiple terminations bonus
  if (input.terminatedFilings >= 2) score += 10

  return Math.max(0, Math.min(100, score))
}

export class FreshCapacityService {
  constructor(private db: { query: <T>(sql: string, params?: unknown[]) => Promise<T[]> }) {}

  async computeForProspect(
    prospectId: string
  ): Promise<{ score: number; input: FreshCapacityInput }> {
    const rows = await this.db.query<{
      terminated_count: string
      active_count: string
      recent_termination_date: string | null
      recent_termination_amount: string | null
      total_active_amount: string | null
    }>(
      `
      SELECT
        COUNT(*) FILTER (WHERE uf.status = 'terminated')::text as terminated_count,
        COUNT(*) FILTER (WHERE uf.status = 'active')::text as active_count,
        MAX(CASE WHEN uf.status = 'terminated' THEN uf.updated_at ELSE NULL END)::text as recent_termination_date,
        MAX(CASE WHEN uf.status = 'terminated' THEN uf.lien_amount ELSE NULL END)::text as recent_termination_amount,
        AVG(CASE WHEN uf.status = 'active' THEN uf.lien_amount ELSE NULL END)::text as total_active_amount
      FROM ucc_filings uf
      JOIN prospect_ucc_filings puf ON uf.id = puf.ucc_filing_id
      WHERE puf.prospect_id = $1
    `,
      [prospectId]
    )

    const row = rows[0]
    const terminatedFilings = parseInt(row?.terminated_count ?? '0', 10)
    const activeFilings = parseInt(row?.active_count ?? '0', 10)

    const recentTermDate = row?.recent_termination_date
    const daysSinceRecentTermination = recentTermDate
      ? Math.floor((Date.now() - new Date(recentTermDate).getTime()) / (1000 * 60 * 60 * 24))
      : 999

    const input: FreshCapacityInput = {
      terminatedFilings,
      activeFilings,
      daysSinceRecentTermination,
      recentTerminationAmount: row?.recent_termination_amount
        ? parseFloat(row.recent_termination_amount)
        : null,
      avgActiveAmount: row?.total_active_amount ? parseFloat(row.total_active_amount) : null
    }

    return { score: calculateFreshCapacityScore(input), input }
  }
}
