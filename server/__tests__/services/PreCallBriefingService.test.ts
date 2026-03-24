import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PreCallBriefingService, type PreCallBriefing } from '../../services/PreCallBriefingService'

const mockComputeForProspect = vi.fn().mockResolvedValue({
  score: 75,
  input: {
    terminatedFilings: 2,
    activeFilings: 1,
    daysSinceRecentTermination: 15,
    recentTerminationAmount: null,
    avgActiveAmount: null
  }
})

vi.mock('@/services/FreshCapacityService', () => {
  return {
    FreshCapacityService: class {
      computeForProspect = mockComputeForProspect
    }
  }
})

const makeProspect = (overrides = {}) => ({
  id: 'p-1',
  company_name: 'Acme Corp',
  state: 'CA',
  industry: 'Retail',
  priority_score: 80,
  ...overrides
})

describe('PreCallBriefingService', () => {
  let mockDb: { query: ReturnType<typeof vi.fn> }
  let service: PreCallBriefingService

  beforeEach(() => {
    mockDb = { query: vi.fn() }
    service = new PreCallBriefingService(mockDb)
    // Reset capacity mock to default between tests
    mockComputeForProspect.mockResolvedValue({
      score: 75,
      input: {
        terminatedFilings: 2,
        activeFilings: 1,
        daysSinceRecentTermination: 15,
        recentTerminationAmount: null,
        avgActiveAmount: null
      }
    })
  })

  const setupDefaultMocks = (
    overrides: {
      prospect?: object | null
      filingStats?: { status: string; count: string }[]
      competitors?: { secured_party_name: string }[]
      velocity?: { window_days: number; filings_in_window: number; trend: string }[]
    } = {}
  ) => {
    // 1. Prospect query
    if (overrides.prospect === null) {
      mockDb.query.mockResolvedValueOnce([])
    } else {
      mockDb.query.mockResolvedValueOnce([overrides.prospect ?? makeProspect()])
    }
    // 2. Filing stats
    mockDb.query.mockResolvedValueOnce(
      overrides.filingStats ?? [
        { status: 'active', count: '1' },
        { status: 'terminated', count: '2' }
      ]
    )
    // 3. Competitors
    mockDb.query.mockResolvedValueOnce(
      overrides.competitors ?? [{ secured_party_name: 'Bank of Commerce' }]
    )
    // Note: FreshCapacityService is mocked at module level and uses mockComputeForProspect
    // 4. Velocity
    mockDb.query.mockResolvedValueOnce(
      overrides.velocity ?? [
        { window_days: 30, filings_in_window: 3, trend: 'stable' },
        { window_days: 90, filings_in_window: 8, trend: 'stable' }
      ]
    )
    // 5. Cache INSERT
    mockDb.query.mockResolvedValueOnce([])
  }

  describe('generateBriefing', () => {
    it('returns complete briefing structure', async () => {
      setupDefaultMocks()

      const briefing = await service.generateBriefing('p-1')

      expect(briefing.prospectId).toBe('p-1')
      expect(briefing.companyName).toBe('Acme Corp')
      expect(briefing.state).toBe('CA')
      expect(briefing.industry).toBe('Retail')
      expect(briefing.priorityScore).toBe(80)
      expect(typeof briefing.generatedAt).toBe('string')

      expect(briefing.stackAnalysis.activeFilings).toBe(1)
      expect(briefing.stackAnalysis.terminatedFilings).toBe(2)
      expect(briefing.stackAnalysis.totalFilings).toBe(3)
      expect(briefing.stackAnalysis.knownCompetitors).toEqual(['Bank of Commerce'])

      expect(briefing.freshCapacity.score).toBe(75)
      expect(briefing.freshCapacity.recentTerminations).toBe(2)
      expect(briefing.freshCapacity.daysSinceLastTermination).toBe(15)

      expect(briefing.velocity.trend30d).toBe('stable')
      expect(briefing.velocity.filings30d).toBe(3)
      expect(briefing.velocity.trend90d).toBe('stable')

      expect(Array.isArray(briefing.talkingPoints)).toBe(true)
      expect(Array.isArray(briefing.riskFactors)).toBe(true)
    })

    it('throws when prospect is not found', async () => {
      mockDb.query.mockResolvedValueOnce([]) // empty result

      await expect(service.generateBriefing('non-existent')).rejects.toThrow(
        'Prospect not found: non-existent'
      )
    })

    it('includes "Fresh capacity available" talking point when score >= 50', async () => {
      // Default mock score=75 (>= 50)
      setupDefaultMocks()

      const briefing = await service.generateBriefing('p-1')

      expect(briefing.talkingPoints).toContain(
        'Fresh capacity available — recently paid off financing'
      )
    })

    it('includes "Clean UCC history" talking point when 0 active filings', async () => {
      setupDefaultMocks({
        filingStats: [{ status: 'terminated', count: '2' }] // no active row → 0 active
      })

      const briefing = await service.generateBriefing('p-1')

      expect(briefing.talkingPoints).toContain('Clean UCC history — prime 1st position candidate')
    })

    it('includes consolidation talking point when 3+ active filings', async () => {
      setupDefaultMocks({
        filingStats: [
          { status: 'active', count: '4' },
          { status: 'terminated', count: '1' }
        ]
      })

      const briefing = await service.generateBriefing('p-1')

      expect(briefing.talkingPoints.some((p) => p.includes('active positions'))).toBe(true)
    })

    it('includes "over-stacking" risk factor when 4+ active filings', async () => {
      setupDefaultMocks({
        filingStats: [
          { status: 'active', count: '4' },
          { status: 'terminated', count: '1' }
        ]
      })

      const briefing = await service.generateBriefing('p-1')

      expect(briefing.riskFactors).toContain('Potential over-stacking risk')
    })

    it('does not add over-stacking risk when fewer than 4 active filings', async () => {
      setupDefaultMocks({
        filingStats: [
          { status: 'active', count: '3' },
          { status: 'terminated', count: '1' }
        ]
      })

      const briefing = await service.generateBriefing('p-1')

      expect(briefing.riskFactors).not.toContain('Potential over-stacking risk')
    })

    it('caches briefing to pre_call_briefings table', async () => {
      setupDefaultMocks()

      const briefing = await service.generateBriefing('p-1')

      const cacheCall = mockDb.query.mock.calls.find(([sql]: [string]) =>
        sql.includes('INSERT INTO pre_call_briefings')
      )
      expect(cacheCall).toBeDefined()
      const [sql, params] = cacheCall!
      expect(sql).toMatch(/ON CONFLICT \(prospect_id\) DO UPDATE/)
      expect(params[0]).toBe('p-1')
      const cached = JSON.parse(params[1] as string) as PreCallBriefing
      expect(cached.prospectId).toBe(briefing.prospectId)
      expect(cached.companyName).toBe(briefing.companyName)
    })

    it('sets daysSinceLastTermination to null when sentinel value 999', async () => {
      mockComputeForProspect.mockResolvedValueOnce({
        score: 0,
        input: {
          terminatedFilings: 0,
          activeFilings: 2,
          daysSinceRecentTermination: 999,
          recentTerminationAmount: null,
          avgActiveAmount: null
        }
      })

      setupDefaultMocks({
        filingStats: [{ status: 'active', count: '2' }]
      })

      const briefing = await service.generateBriefing('p-1')

      expect(briefing.freshCapacity.daysSinceLastTermination).toBeNull()
    })

    it('uses fallback talking point when no signals match', async () => {
      // Score=10 (below 50), 2 active filings (not 0, not >=3), no acceleration
      mockComputeForProspect.mockResolvedValueOnce({
        score: 10,
        input: {
          terminatedFilings: 1,
          activeFilings: 2,
          daysSinceRecentTermination: 999,
          recentTerminationAmount: null,
          avgActiveAmount: null
        }
      })

      setupDefaultMocks({
        filingStats: [
          { status: 'active', count: '2' },
          { status: 'terminated', count: '1' }
        ],
        velocity: [{ window_days: 30, filings_in_window: 1, trend: 'stable' }]
      })

      const briefing = await service.generateBriefing('p-1')

      expect(briefing.talkingPoints).toContain(
        'Standard outreach — review filing history before call'
      )
    })
  })

  describe('getCachedBriefing', () => {
    it('returns cached briefing when not expired', async () => {
      const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString()
      const cachedData: Partial<PreCallBriefing> = {
        prospectId: 'p-1',
        companyName: 'Acme Corp',
        state: 'CA'
      }
      mockDb.query.mockResolvedValueOnce([
        { content: JSON.stringify(cachedData), expires_at: futureDate }
      ])

      const result = await service.getCachedBriefing('p-1')

      expect(result).not.toBeNull()
      expect(result!.prospectId).toBe('p-1')
      expect(result!.companyName).toBe('Acme Corp')
    })

    it('returns null when briefing is expired', async () => {
      const pastDate = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      mockDb.query.mockResolvedValueOnce([
        { content: JSON.stringify({ prospectId: 'p-1' }), expires_at: pastDate }
      ])

      const result = await service.getCachedBriefing('p-1')

      expect(result).toBeNull()
    })

    it('returns null when no cached briefing exists', async () => {
      mockDb.query.mockResolvedValueOnce([])

      const result = await service.getCachedBriefing('p-no-cache')

      expect(result).toBeNull()
    })
  })
})
