import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FilingVelocityService, type VelocityMetric } from '../../services/FilingVelocityService'

describe('FilingVelocityService', () => {
  let mockDb: { query: ReturnType<typeof vi.fn> }
  let service: FilingVelocityService

  beforeEach(() => {
    mockDb = { query: vi.fn() }
    service = new FilingVelocityService(mockDb)
  })

  describe('computeVelocity', () => {
    it('returns metrics for 30/90/365 day windows', async () => {
      // Each window makes 2 queries (current + prior), 3 windows = 6 calls
      mockDb.query
        .mockResolvedValueOnce([{ count: '3' }]) // 30d current
        .mockResolvedValueOnce([{ count: '2' }]) // 30d prior
        .mockResolvedValueOnce([{ count: '8' }]) // 90d current
        .mockResolvedValueOnce([{ count: '5' }]) // 90d prior
        .mockResolvedValueOnce([{ count: '20' }]) // 365d current
        .mockResolvedValueOnce([{ count: '15' }]) // 365d prior

      const metrics = await service.computeVelocity('prospect-1')

      expect(metrics).toHaveLength(3)
      expect(metrics[0].windowDays).toBe(30)
      expect(metrics[1].windowDays).toBe(90)
      expect(metrics[2].windowDays).toBe(365)
    })

    it('returns accelerating when current > prior', async () => {
      // 30d window: current=5, prior=2 → accelerating
      mockDb.query
        .mockResolvedValueOnce([{ count: '5' }])
        .mockResolvedValueOnce([{ count: '2' }])
        .mockResolvedValueOnce([{ count: '5' }])
        .mockResolvedValueOnce([{ count: '2' }])
        .mockResolvedValueOnce([{ count: '5' }])
        .mockResolvedValueOnce([{ count: '2' }])

      const metrics = await service.computeVelocity('prospect-acc')

      expect(metrics[0].trend).toBe('accelerating')
    })

    it('returns decelerating when current < prior/2', async () => {
      // 30d window: current=1, prior=10 → 1 < 10/2=5 → decelerating
      mockDb.query
        .mockResolvedValueOnce([{ count: '1' }])
        .mockResolvedValueOnce([{ count: '10' }])
        .mockResolvedValueOnce([{ count: '1' }])
        .mockResolvedValueOnce([{ count: '10' }])
        .mockResolvedValueOnce([{ count: '1' }])
        .mockResolvedValueOnce([{ count: '10' }])

      const metrics = await service.computeVelocity('prospect-dec')

      expect(metrics[0].trend).toBe('decelerating')
    })

    it('returns stable when counts are similar', async () => {
      // 30d window: current=3, prior=3 → stable (not current > prior, not current < prior/2)
      mockDb.query
        .mockResolvedValueOnce([{ count: '3' }])
        .mockResolvedValueOnce([{ count: '3' }])
        .mockResolvedValueOnce([{ count: '3' }])
        .mockResolvedValueOnce([{ count: '3' }])
        .mockResolvedValueOnce([{ count: '3' }])
        .mockResolvedValueOnce([{ count: '3' }])

      const metrics = await service.computeVelocity('prospect-stable')

      expect(metrics[0].trend).toBe('stable')
    })

    it('handles prospect with no filings (all zeros, stable)', async () => {
      mockDb.query
        .mockResolvedValueOnce([{ count: '0' }])
        .mockResolvedValueOnce([{ count: '0' }])
        .mockResolvedValueOnce([{ count: '0' }])
        .mockResolvedValueOnce([{ count: '0' }])
        .mockResolvedValueOnce([{ count: '0' }])
        .mockResolvedValueOnce([{ count: '0' }])

      const metrics = await service.computeVelocity('prospect-empty')

      expect(metrics).toHaveLength(3)
      metrics.forEach((m) => {
        expect(m.filingsInWindow).toBe(0)
        expect(m.avgFilingsPerMonth).toBe(0)
        expect(m.trend).toBe('stable')
      })
    })

    it('computes avgFilingsPerMonth correctly', async () => {
      // 30d window with 3 filings: (3/30)*30 = 3.00
      mockDb.query
        .mockResolvedValueOnce([{ count: '3' }])
        .mockResolvedValueOnce([{ count: '0' }])
        .mockResolvedValueOnce([{ count: '9' }])
        .mockResolvedValueOnce([{ count: '0' }])
        .mockResolvedValueOnce([{ count: '36' }])
        .mockResolvedValueOnce([{ count: '0' }])

      const metrics = await service.computeVelocity('prospect-avg')

      expect(metrics[0].avgFilingsPerMonth).toBe(3.0)
      expect(metrics[1].avgFilingsPerMonth).toBe(3.0) // (9/90)*30 = 3.00
      expect(metrics[2].avgFilingsPerMonth).toBe(2.96) // (36/365)*30 ≈ 2.96
    })
  })

  describe('persistMetrics', () => {
    it('calls INSERT ON CONFLICT with correct params for each metric', async () => {
      mockDb.query.mockResolvedValue([])

      const metrics: VelocityMetric[] = [
        { windowDays: 30, filingsInWindow: 3, avgFilingsPerMonth: 3.0, trend: 'accelerating' },
        { windowDays: 90, filingsInWindow: 8, avgFilingsPerMonth: 2.67, trend: 'stable' }
      ]

      await service.persistMetrics('prospect-persist', metrics)

      expect(mockDb.query).toHaveBeenCalledTimes(2)

      const firstCall = mockDb.query.mock.calls[0]
      expect(firstCall[0]).toMatch(/INSERT INTO filing_velocity_metrics/)
      expect(firstCall[0]).toMatch(/ON CONFLICT/)
      expect(firstCall[1]).toEqual(['prospect-persist', 30, 3, 3.0, 'accelerating'])

      const secondCall = mockDb.query.mock.calls[1]
      expect(secondCall[1]).toEqual(['prospect-persist', 90, 8, 2.67, 'stable'])
    })
  })

  describe('detectAccelerating', () => {
    it('filters by accelerating trend and minimum 2 filings', async () => {
      const expected = [
        { prospectId: 'p1', trend30d: 'accelerating', filings30d: 5 },
        { prospectId: 'p2', trend30d: 'accelerating', filings30d: 3 }
      ]
      mockDb.query.mockResolvedValueOnce(expected)

      const results = await service.detectAccelerating()

      expect(mockDb.query).toHaveBeenCalledTimes(1)
      const [sql, params] = mockDb.query.mock.calls[0]
      expect(sql).toMatch(/fvm.trend = 'accelerating'/)
      expect(sql).toMatch(/fvm.filings_in_window >= 2/)
      expect(params).toEqual([])
      expect(results).toEqual(expected)
    })

    it('joins prospects table and filters by state when state is provided', async () => {
      mockDb.query.mockResolvedValueOnce([])

      await service.detectAccelerating('CA')

      const [sql, params] = mockDb.query.mock.calls[0]
      expect(sql).toMatch(/JOIN prospects p/)
      expect(sql).toMatch(/p\.state = \$1/)
      expect(params).toEqual(['CA'])
    })

    it('does not join prospects table when no state is provided', async () => {
      mockDb.query.mockResolvedValueOnce([])

      await service.detectAccelerating()

      const [sql] = mockDb.query.mock.calls[0]
      expect(sql).not.toMatch(/JOIN prospects p/)
    })
  })
})
