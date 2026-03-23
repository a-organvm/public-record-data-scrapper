export interface VelocityMetric {
  windowDays: number
  filingsInWindow: number
  avgFilingsPerMonth: number
  trend: 'accelerating' | 'stable' | 'decelerating'
}

export class FilingVelocityService {
  constructor(private db: { query: <T>(sql: string, params?: unknown[]) => Promise<T[]> }) {}

  async computeVelocity(prospectId: string): Promise<VelocityMetric[]> {
    const windows = [30, 90, 365]
    const metrics: VelocityMetric[] = []

    for (const windowDays of windows) {
      // Count filings in current window
      const currentRows = await this.db.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM ucc_filings uf
         JOIN prospect_ucc_filings puf ON uf.id = puf.ucc_filing_id
         WHERE puf.prospect_id = $1
           AND uf.filing_date >= CURRENT_DATE - $2::integer * INTERVAL '1 day'`,
        [prospectId, windowDays]
      )
      const currentCount = parseInt(currentRows[0]?.count ?? '0', 10)

      // Count filings in prior window (same length, shifted back)
      const priorRows = await this.db.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM ucc_filings uf
         JOIN prospect_ucc_filings puf ON uf.id = puf.ucc_filing_id
         WHERE puf.prospect_id = $1
           AND uf.filing_date >= CURRENT_DATE - $2::integer * INTERVAL '1 day' * 2
           AND uf.filing_date < CURRENT_DATE - $2::integer * INTERVAL '1 day'`,
        [prospectId, windowDays]
      )
      const priorCount = parseInt(priorRows[0]?.count ?? '0', 10)

      // Determine trend
      let trend: VelocityMetric['trend'] = 'stable'
      if (currentCount > priorCount && currentCount > 0) {
        trend = 'accelerating'
      } else if (priorCount > 0 && currentCount < priorCount / 2) {
        trend = 'decelerating'
      }

      const avgFilingsPerMonth = windowDays > 0 ? (currentCount / windowDays) * 30 : 0

      metrics.push({
        windowDays,
        filingsInWindow: currentCount,
        avgFilingsPerMonth: Number(avgFilingsPerMonth.toFixed(2)),
        trend
      })
    }

    return metrics
  }

  async persistMetrics(prospectId: string, metrics: VelocityMetric[]): Promise<void> {
    for (const metric of metrics) {
      await this.db.query(
        `INSERT INTO filing_velocity_metrics (prospect_id, window_days, filings_in_window, avg_filings_per_month, trend)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (prospect_id, window_days) DO UPDATE SET
           filings_in_window = EXCLUDED.filings_in_window,
           avg_filings_per_month = EXCLUDED.avg_filings_per_month,
           trend = EXCLUDED.trend,
           computed_at = NOW()`,
        [
          prospectId,
          metric.windowDays,
          metric.filingsInWindow,
          metric.avgFilingsPerMonth,
          metric.trend
        ]
      )
    }
  }

  async detectAccelerating(
    state?: string
  ): Promise<{ prospectId: string; trend30d: string; filings30d: number }[]> {
    const baseQuery = `
      SELECT fvm.prospect_id as "prospectId", fvm.trend as "trend30d", fvm.filings_in_window as "filings30d"
      FROM filing_velocity_metrics fvm
      ${state ? 'JOIN prospects p ON p.id = fvm.prospect_id' : ''}
      WHERE fvm.window_days = 30 AND fvm.trend = 'accelerating' AND fvm.filings_in_window >= 2
      ${state ? 'AND p.state = $1' : ''}
      ORDER BY fvm.filings_in_window DESC
    `
    return this.db.query(baseQuery, state ? [state] : [])
  }
}
