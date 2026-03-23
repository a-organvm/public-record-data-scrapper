import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  CompetitiveHeatMapService,
  type GeographicHeatMapEntry,
  type SaturationAnalysis
} from '../../services/CompetitiveHeatMapService'

describe('CompetitiveHeatMapService', () => {
  let mockQuery: ReturnType<typeof vi.fn>
  let mockDb: { query: ReturnType<typeof vi.fn> }
  let service: CompetitiveHeatMapService

  beforeEach(() => {
    mockQuery = vi.fn()
    mockDb = { query: mockQuery }
    service = new CompetitiveHeatMapService(mockDb)
  })

  describe('getGeographicHeatMap', () => {
    it('returns per-state entries for a known funder', async () => {
      const rows: GeographicHeatMapEntry[] = [
        {
          state: 'CA',
          filingCount: 120,
          activeFilingCount: 90,
          uniqueDebtors: 80,
          marketSharePct: null
        },
        {
          state: 'TX',
          filingCount: 60,
          activeFilingCount: 40,
          uniqueDebtors: 50,
          marketSharePct: null
        }
      ]
      mockQuery.mockResolvedValueOnce(rows)

      const result = await service.getGeographicHeatMap('acme funding')

      expect(result).toHaveLength(2)
      expect(result[0].state).toBe('CA')
      expect(result[0].filingCount).toBe(120)
      expect(result[0].activeFilingCount).toBe(90)
      expect(result[0].uniqueDebtors).toBe(80)
      expect(result[0].marketSharePct).toBeNull()
      expect(result[1].state).toBe('TX')

      expect(mockQuery).toHaveBeenCalledTimes(1)
      const [sql, params] = mockQuery.mock.calls[0]
      expect(sql).toMatch(/FROM ucc_filings/)
      expect(sql).toMatch(/LOWER\(TRIM\(secured_party_name\)\) = LOWER\(TRIM\(\$1\)\)/)
      expect(params).toEqual(['acme funding'])
    })

    it('returns empty array for an unknown funder', async () => {
      mockQuery.mockResolvedValueOnce([])

      const result = await service.getGeographicHeatMap('totally unknown funder xyz')

      expect(result).toEqual([])
      expect(mockQuery).toHaveBeenCalledTimes(1)
    })
  })

  describe('getCompetitiveSaturation', () => {
    it('returns ranked competitors with correct market shares', async () => {
      mockQuery.mockResolvedValueOnce([
        { funder: 'Big Funder', filingCount: 200, uniqueDebtors: 100 },
        { funder: 'Mid Funder', filingCount: 100, uniqueDebtors: 60 },
        { funder: 'Small Funder', filingCount: 50, uniqueDebtors: 30 }
      ])

      const result: SaturationAnalysis = await service.getCompetitiveSaturation('CA')

      expect(result.state).toBe('CA')
      expect(result.industry).toBeNull()
      expect(result.competitors).toHaveLength(3)

      // Total = 350; Big=57.14%, Mid=28.57%, Small=14.29%
      expect(result.competitors[0].funder).toBe('Big Funder')
      expect(result.competitors[0].rank).toBe(1)
      expect(result.competitors[0].marketSharePct).toBe(57.14)
      expect(result.competitors[1].rank).toBe(2)
      expect(result.competitors[1].marketSharePct).toBe(28.57)
      expect(result.competitors[2].rank).toBe(3)
      expect(result.competitors[2].marketSharePct).toBe(14.29)
    })

    it('calculates HHI correctly for 3 equal competitors → concentrationLevel high', async () => {
      // 3 equal competitors: each 33.33% share → HHI ≈ 3333 → 'high'
      mockQuery.mockResolvedValueOnce([
        { funder: 'Funder A', filingCount: 100, uniqueDebtors: 50 },
        { funder: 'Funder B', filingCount: 100, uniqueDebtors: 40 },
        { funder: 'Funder C', filingCount: 100, uniqueDebtors: 30 }
      ])

      const result = await service.getCompetitiveSaturation('NY')

      // Each has share = 33.33, HHI = 33.33^2 * 3 ≈ 3333.33
      expect(result.hhi).toBeGreaterThan(3000)
      expect(result.concentrationLevel).toBe('high')
    })

    it('returns concentrationLevel high when HHI > 2500', async () => {
      // Single dominant funder with ~100% share → HHI ≈ 10000
      mockQuery.mockResolvedValueOnce([
        { funder: 'Dominant Funder', filingCount: 1000, uniqueDebtors: 500 },
        { funder: 'Minor Funder', filingCount: 1, uniqueDebtors: 1 }
      ])

      const result = await service.getCompetitiveSaturation('TX')

      expect(result.hhi).toBeGreaterThan(2500)
      expect(result.concentrationLevel).toBe('high')
    })

    it('returns concentrationLevel moderate when HHI between 1500 and 2500', async () => {
      // Two main funders splitting ~70/30 → HHI ≈ 70^2 + 30^2 = 4900+900 = 5800 — let's use a scenario
      // 4 equal competitors: 25% each → HHI = 25^2 * 4 = 2500, not > 2500 → moderate? Let's use 3 at 25%+45%+30%
      // 45^2 + 30^2 + 25^2 = 2025 + 900 + 625 = 3550 > 2500 → high
      // Need HHI in [1501, 2500]: try 5 equal → 20^2 * 5 = 2000 → moderate
      mockQuery.mockResolvedValueOnce([
        { funder: 'A', filingCount: 20, uniqueDebtors: 10 },
        { funder: 'B', filingCount: 20, uniqueDebtors: 10 },
        { funder: 'C', filingCount: 20, uniqueDebtors: 10 },
        { funder: 'D', filingCount: 20, uniqueDebtors: 10 },
        { funder: 'E', filingCount: 20, uniqueDebtors: 10 }
      ])

      const result = await service.getCompetitiveSaturation('FL')

      // 5 equal competitors: 20% each → HHI = 20^2 * 5 = 2000
      expect(result.hhi).toBeGreaterThan(1500)
      expect(result.hhi).toBeLessThanOrEqual(2500)
      expect(result.concentrationLevel).toBe('moderate')
    })

    it('returns concentrationLevel competitive when HHI <= 1500', async () => {
      // 10 equal competitors: 10% each → HHI = 10^2 * 10 = 1000 → competitive
      const rows = Array.from({ length: 10 }, (_, i) => ({
        funder: `Funder ${i + 1}`,
        filingCount: 10,
        uniqueDebtors: 5
      }))
      mockQuery.mockResolvedValueOnce(rows)

      const result = await service.getCompetitiveSaturation('WA')

      // HHI = 10^2 * 10 = 1000
      expect(result.hhi).toBeLessThanOrEqual(1500)
      expect(result.concentrationLevel).toBe('competitive')
    })

    it('returns empty competitors, HHI 0, and competitive when no filings exist', async () => {
      mockQuery.mockResolvedValueOnce([])

      const result = await service.getCompetitiveSaturation('AK')

      expect(result.state).toBe('AK')
      expect(result.industry).toBeNull()
      expect(result.competitors).toEqual([])
      expect(result.hhi).toBe(0)
      expect(result.concentrationLevel).toBe('competitive')
    })

    it('forwards optional industry parameter and upcases state', async () => {
      mockQuery.mockResolvedValueOnce([])

      const result = await service.getCompetitiveSaturation('ca', 'retail')

      expect(result.state).toBe('CA')
      expect(result.industry).toBe('retail')
      const [, params] = mockQuery.mock.calls[0]
      expect(params).toEqual(['CA'])
    })
  })

  describe('computeMarketPositions', () => {
    it('persists one row per competitor and returns count', async () => {
      // First call: getCompetitiveSaturation's internal db.query
      mockQuery.mockResolvedValueOnce([
        { funder: 'Funder X', filingCount: 60, uniqueDebtors: 30 },
        { funder: 'Funder Y', filingCount: 40, uniqueDebtors: 20 }
      ])
      // Two subsequent INSERT calls
      mockQuery.mockResolvedValue([])

      const count = await service.computeMarketPositions('NY')

      expect(count).toBe(2)
      // Total calls: 1 SELECT + 2 INSERT = 3
      expect(mockQuery).toHaveBeenCalledTimes(3)

      const insertCall = mockQuery.mock.calls[1]
      expect(insertCall[0]).toMatch(/INSERT INTO competitor_market_positions/)
      expect(insertCall[0]).toMatch(/ON CONFLICT/)
      // params: funder_name, funder_normalized, state, filing_count, unique_debtors, market_share_pct
      expect(insertCall[1][0]).toBe('Funder X')
      expect(insertCall[1][1]).toBe('funder x')
      expect(insertCall[1][2]).toBe('NY')
    })

    it('returns 0 when no competitors exist for the state', async () => {
      mockQuery.mockResolvedValueOnce([])

      const count = await service.computeMarketPositions('GU')

      expect(count).toBe(0)
      // Only the SELECT was called; no INSERTs
      expect(mockQuery).toHaveBeenCalledTimes(1)
    })
  })
})
