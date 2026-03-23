export interface GeographicHeatMapEntry {
  state: string
  filingCount: number
  activeFilingCount: number
  uniqueDebtors: number
  marketSharePct: number | null
}

export interface SaturationEntry {
  funder: string
  filingCount: number
  uniqueDebtors: number
  rank: number
  marketSharePct: number
}

export interface SaturationAnalysis {
  state: string
  industry: string | null
  competitors: SaturationEntry[]
  hhi: number
  concentrationLevel: 'high' | 'moderate' | 'competitive'
}

export class CompetitiveHeatMapService {
  constructor(private db: { query: <T>(sql: string, params?: unknown[]) => Promise<T[]> }) {}

  // Where does a specific funder operate?
  async getGeographicHeatMap(funderNormalized: string): Promise<GeographicHeatMapEntry[]> {
    return this.db.query(
      `
      SELECT
        state,
        COUNT(*)::integer as "filingCount",
        COUNT(*) FILTER (WHERE status = 'active')::integer as "activeFilingCount",
        COUNT(DISTINCT debtor_name)::integer as "uniqueDebtors",
        NULL::numeric as "marketSharePct"
      FROM ucc_filings
      WHERE LOWER(TRIM(secured_party_name)) = LOWER(TRIM($1))
      GROUP BY state
      ORDER BY COUNT(*) DESC
    `,
      [funderNormalized]
    )
  }

  // Who dominates a given state? Compute HHI.
  async getCompetitiveSaturation(state: string, industry?: string): Promise<SaturationAnalysis> {
    const query = `
      SELECT
        secured_party_name as funder,
        COUNT(*)::integer as "filingCount",
        COUNT(DISTINCT debtor_name)::integer as "uniqueDebtors"
      FROM ucc_filings
      WHERE state = $1
      GROUP BY secured_party_name
      ORDER BY COUNT(*) DESC
    `
    const competitors = await this.db.query<{
      funder: string
      filingCount: number
      uniqueDebtors: number
    }>(query, [state.toUpperCase()])

    // Calculate market shares and HHI
    const totalFilings = competitors.reduce((sum, c) => sum + c.filingCount, 0)

    const ranked: SaturationEntry[] = competitors.map((c, i) => {
      const share = totalFilings > 0 ? (c.filingCount / totalFilings) * 100 : 0
      return {
        funder: c.funder,
        filingCount: c.filingCount,
        uniqueDebtors: c.uniqueDebtors,
        rank: i + 1,
        marketSharePct: Number(share.toFixed(2))
      }
    })

    // HHI = sum of squared market shares
    const hhi = ranked.reduce((sum, c) => sum + Math.pow(c.marketSharePct, 2), 0)

    return {
      state: state.toUpperCase(),
      industry: industry ?? null,
      competitors: ranked,
      hhi: Number(hhi.toFixed(2)),
      concentrationLevel: hhi > 2500 ? 'high' : hhi > 1500 ? 'moderate' : 'competitive'
    }
  }

  // Persist a market position snapshot for a state
  async computeMarketPositions(state: string): Promise<number> {
    const saturation = await this.getCompetitiveSaturation(state)
    let persisted = 0

    for (const entry of saturation.competitors) {
      await this.db.query(
        `INSERT INTO competitor_market_positions
         (funder_name, funder_normalized, state, snapshot_date, filing_count, active_filing_count, unique_debtors, market_share_pct)
         VALUES ($1, $2, $3, CURRENT_DATE, $4, 0, $5, $6)
         ON CONFLICT (funder_normalized, state, snapshot_date) DO UPDATE SET
           filing_count = EXCLUDED.filing_count,
           unique_debtors = EXCLUDED.unique_debtors,
           market_share_pct = EXCLUDED.market_share_pct`,
        [
          entry.funder,
          entry.funder.toLowerCase().trim(),
          state.toUpperCase(),
          entry.filingCount,
          entry.uniqueDebtors,
          entry.marketSharePct
        ]
      )
      persisted++
    }

    return persisted
  }
}
