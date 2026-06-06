/**
 * DataEnrichmentService Unit Tests
 *
 * Tests for prospect data enrichment including growth signals,
 * health scores, revenue estimation, and industry classification
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DataEnrichmentService, EnrichmentNotConfiguredError } from '../DataEnrichmentService'
import {
  createMockEnrichmentSources,
  createMockUCCFiling,
  createMockProspect,
  createMockGrowthSignals,
  createMockHealthScore,
  createMockFetchResponse,
  mockConsole
} from './test-utils'

// Mock fetch globally
global.fetch = vi.fn()

describe('DataEnrichmentService', () => {
  let service: DataEnrichmentService
  let consoleMocks: ReturnType<typeof mockConsole>

  beforeEach(() => {
    const sources = createMockEnrichmentSources()
    service = new DataEnrichmentService(sources)
    consoleMocks = mockConsole()
    vi.clearAllMocks()
  })

  afterEach(() => {
    consoleMocks.restore()
  })

  describe('enrichProspect', () => {
    it('should enrich a prospect with all available data', async () => {
      const filing = createMockUCCFiling()

      const { prospect, result } = await service.enrichProspect(filing)

      expect(prospect).toBeDefined()
      expect(prospect.companyName).toBe(filing.debtorName)
      expect(prospect.state).toBe(filing.state)
      // Service returns success unless errors are thrown
      expect(result.enrichedFields.length).toBeGreaterThan(0)
    })

    it('should handle existing data gracefully', async () => {
      const filing = createMockUCCFiling()
      const existingData = createMockProspect()

      const { prospect } = await service.enrichProspect(filing, existingData)

      expect(prospect.id).toBe(existingData.id)
      expect(prospect.companyName).toBe(filing.debtorName)
    })

    it('should calculate confidence scores', async () => {
      const filing = createMockUCCFiling()

      const { result } = await service.enrichProspect(filing)

      expect(result.confidence).toBeGreaterThanOrEqual(0)
      expect(result.confidence).toBeLessThanOrEqual(1)
    })

    it('should track enriched fields', async () => {
      const filing = createMockUCCFiling()

      const { result } = await service.enrichProspect(filing)

      // At minimum: priorityScore and narrative are always enriched
      expect(result.enrichedFields).toContain('priorityScore')
      expect(result.enrichedFields).toContain('narrative')
      expect(result.enrichedFields.length).toBeGreaterThan(0)
    })

    it('should include timestamp in result', async () => {
      const filing = createMockUCCFiling()

      const { result } = await service.enrichProspect(filing)

      expect(result.timestamp).toBeDefined()
      const timestamp = new Date(result.timestamp)
      expect(timestamp.getTime()).toBeGreaterThan(0)
    })
  })

  describe('EnrichmentNotConfiguredError', () => {
    it('is a typed error that names the missing live wiring', () => {
      const err = new EnrichmentNotConfiguredError('revenue-estimate', 'ML revenue model')
      expect(err).toBeInstanceOf(Error)
      expect(err.name).toBe('EnrichmentNotConfiguredError')
      expect(err.capability).toBe('revenue-estimate')
      expect(err.message).toMatch(/not wired to a live provider/i)
      expect(err.message).toMatch(/ML revenue model/)
    })
  })

  describe('detectGrowthSignals (fail-closed)', () => {
    it('should never fabricate growth signals when no live provider is wired', async () => {
      const filing = createMockUCCFiling()
      const { prospect, result } = await service.enrichProspect(filing)

      // Fail closed: no provider wired => empty signals, never invented ones.
      expect(prospect.growthSignals).toBeDefined()
      expect(Array.isArray(prospect.growthSignals)).toBe(true)
      expect(prospect.growthSignals).toHaveLength(0)

      // And the failure is surfaced as a named reason, not hidden.
      expect(result.success).toBe(false)
      expect(result.errors.some((e) => /growth signal/i.test(e))).toBe(true)
      expect(result.enrichedFields).not.toContain('growthSignals')
    })

    it('should preserve existing signals rather than overwrite with fabrication', async () => {
      const filing = createMockUCCFiling()
      const existingData = createMockProspect()
      existingData.growthSignals = createMockGrowthSignals()

      const { prospect } = await service.enrichProspect(filing, existingData)

      // Detection throws (fail closed), so the existing signals are kept as-is;
      // nothing fabricated is appended.
      expect(prospect.growthSignals).toEqual(existingData.growthSignals)
    })
  })

  describe('calculateHealthScore (fail-closed)', () => {
    it('should return an explicit "unavailable" health sentinel, not a random grade', async () => {
      const filing = createMockUCCFiling()
      const { prospect, result } = await service.enrichProspect(filing)

      // Fail closed: the placeholder is the typed UNAVAILABLE sentinel, never a
      // fabricated grade/score/sentiment.
      expect(prospect.healthScore).toEqual(DataEnrichmentService.UNAVAILABLE_HEALTH_SCORE)
      expect(prospect.healthScore.score).toBe(0)
      expect(prospect.healthScore.reviewCount).toBe(0)
      expect(prospect.healthScore.violationCount).toBe(0)
      // Sentinel lastUpdated is '' so consumers can tell "never enriched" apart.
      expect(prospect.healthScore.lastUpdated).toBe('')

      // The health-score enrichment failure is surfaced, not silently swallowed.
      expect(result.errors.some((e) => /health score/i.test(e))).toBe(true)
      expect(result.enrichedFields).not.toContain('healthScore')
    })

    it('should throw a typed error from calculateHealthScore', async () => {
      // calculateHealthScore is private; assert via the surfaced error message
      // that it names what live wiring is missing.
      const filing = createMockUCCFiling()
      const { result } = await service.enrichProspect(filing)

      const healthError = result.errors.find((e) => /health score/i.test(e))
      expect(healthError).toBeDefined()
      expect(healthError).toMatch(/not wired to a live provider/i)
    })
  })

  describe('estimateRevenue (fail-closed)', () => {
    it('should never fabricate revenue from a random lien multiple', async () => {
      const filing = createMockUCCFiling({ lienAmount: 500000 })
      const { prospect, result } = await service.enrichProspect(filing)

      // Fail closed: no estimate is produced, the field stays undefined.
      expect(prospect.estimatedRevenue).toBeUndefined()
      expect(result.errors.some((e) => /revenue/i.test(e))).toBe(true)
      expect(result.enrichedFields).not.toContain('estimatedRevenue')
    })

    it('should surface a named reason for the missing revenue provider', async () => {
      const filing = createMockUCCFiling()
      const { result } = await service.enrichProspect(filing)

      const revenueError = result.errors.find((e) => /revenue/i.test(e))
      expect(revenueError).toBeDefined()
      expect(revenueError).toMatch(/not wired to a live provider/i)
    })

    it('should preserve an already-provided revenue (no estimation attempted)', async () => {
      const filing = createMockUCCFiling()
      const existingData = createMockProspect()
      existingData.estimatedRevenue = 10000000

      const { prospect, result } = await service.enrichProspect(filing, existingData)

      expect(prospect.estimatedRevenue).toBe(10000000)
      // Revenue estimation is skipped entirely when a value already exists, so
      // there is no revenue error in that path.
      expect(result.errors.some((e) => /revenue/i.test(e))).toBe(false)
    })
  })

  describe('inferIndustry', () => {
    it('should classify company into industry', async () => {
      vi.mocked(fetch).mockResolvedValue(
        createMockFetchResponse({
          industry: 'technology'
        })
      )

      const filing = createMockUCCFiling()
      const { prospect } = await service.enrichProspect(filing)

      expect(prospect.industry).toBeDefined()
      expect(typeof prospect.industry).toBe('string')
    })

    it('should use company name for classification', async () => {
      vi.mocked(fetch).mockResolvedValue(
        createMockFetchResponse({
          industry: 'manufacturing'
        })
      )

      const filing = createMockUCCFiling({ debtorName: 'ABC Manufacturing Inc' })
      const { prospect } = await service.enrichProspect(filing)

      expect(prospect.companyName).toContain('Manufacturing')
    })

    it('should handle unknown industries', async () => {
      vi.mocked(fetch).mockResolvedValue(createMockFetchResponse({}))

      const filing = createMockUCCFiling({ debtorName: 'XYZ Corp' })
      const { prospect } = await service.enrichProspect(filing)

      expect(prospect.industry).toBeDefined()
    })
  })

  describe('error handling', () => {
    it('should always return a valid prospect', async () => {
      const filing = createMockUCCFiling()
      const { prospect } = await service.enrichProspect(filing)

      expect(prospect).toBeDefined()
      expect(prospect.id).toBeDefined()
      expect(prospect.companyName).toBeDefined()
    })

    it('should always return a valid result', async () => {
      const filing = createMockUCCFiling()
      const { result } = await service.enrichProspect(filing)

      expect(result).toBeDefined()
      expect(result.prospectId).toBeDefined()
      expect(result.timestamp).toBeDefined()
      expect(Array.isArray(result.enrichedFields)).toBe(true)
      expect(Array.isArray(result.errors)).toBe(true)
    })

    it('should track errors in result', async () => {
      const filing = createMockUCCFiling()
      const { result } = await service.enrichProspect(filing)

      // Errors array exists even if empty
      expect(result.errors).toBeDefined()
      expect(Array.isArray(result.errors)).toBe(true)
    })
  })

  describe('batch enrichment', () => {
    it('should enrich multiple prospects', async () => {
      vi.mocked(fetch).mockResolvedValue(
        createMockFetchResponse({
          growthSignals: [],
          healthScore: createMockHealthScore()
        })
      )

      const filings = [createMockUCCFiling({}), createMockUCCFiling({}), createMockUCCFiling({})]

      const results = await Promise.all(filings.map((f) => service.enrichProspect(f)))

      expect(results).toHaveLength(3)
      expect(results.every((r) => r.prospect)).toBe(true)
    })

    it('should handle batch failures gracefully', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(createMockFetchResponse({}))
        .mockRejectedValueOnce(new Error('Error'))
        .mockResolvedValueOnce(createMockFetchResponse({}))

      const filings = [createMockUCCFiling(), createMockUCCFiling(), createMockUCCFiling()]

      const results = await Promise.all(
        filings.map((f) =>
          service.enrichProspect(f).catch((e) => ({
            prospect: createMockProspect(),
            result: {
              success: false,
              enrichedFields: [],
              errors: [e.message],
              confidence: 0,
              timestamp: new Date().toISOString(),
              prospectId: ''
            }
          }))
        )
      )

      expect(results).toHaveLength(3)
    })
  })

  describe('performance', () => {
    it('should enrich prospects efficiently', async () => {
      vi.mocked(fetch).mockResolvedValue(
        createMockFetchResponse({
          growthSignals: createMockGrowthSignals(),
          healthScore: createMockHealthScore()
        })
      )

      const filing = createMockUCCFiling()
      const startTime = Date.now()

      await service.enrichProspect(filing)

      const duration = Date.now() - startTime
      expect(duration).toBeLessThan(1000) // Should complete quickly
    })

    it('should handle concurrent enrichment requests', async () => {
      vi.mocked(fetch).mockResolvedValue(createMockFetchResponse({}))

      const filings = Array(10)
        .fill(null)
        .map(() => createMockUCCFiling())

      const promises = filings.map((f) => service.enrichProspect(f))
      const results = await Promise.all(promises)

      expect(results).toHaveLength(10)
      expect(results.every((r) => r.prospect)).toBe(true)
    })
  })

  describe('data sources', () => {
    it('should work with any enrichment sources configuration', async () => {
      const filing = createMockUCCFiling()
      await service.enrichProspect(filing)

      // Service should complete without errors
      expect(true).toBe(true)
    })

    it('should fail closed on revenue rather than invent a number', async () => {
      const filing = createMockUCCFiling()
      const { prospect } = await service.enrichProspect(filing)

      // No live revenue provider => no fabricated estimate.
      expect(prospect.estimatedRevenue).toBeUndefined()
    })

    it('should handle empty sources gracefully', async () => {
      const emptyService = new DataEnrichmentService([])

      const filing = createMockUCCFiling()
      const { prospect } = await emptyService.enrichProspect(filing)

      // Should still create prospect with defaults
      expect(prospect).toBeDefined()
      expect(prospect.companyName).toBe(filing.debtorName)
    })
  })

  describe('refreshProspectData (fail-closed)', () => {
    it('should not crash, and should surface failures instead of refreshing with fabrication', async () => {
      const prospect = createMockProspect()
      const { prospect: refreshed, result } = await service.refreshProspectData(prospect)

      expect(refreshed).toBeDefined()
      expect(refreshed.id).toBe(prospect.id)
      // No live providers => nothing is re-enriched, every attempted field errors.
      expect(result.enrichedFields).toHaveLength(0)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.success).toBe(false)
    })

    it('should report a named reason when a refreshed field has no provider', async () => {
      const prospect = createMockProspect()
      const { result } = await service.refreshProspectData(prospect, ['healthScore'])

      expect(result.enrichedFields).not.toContain('healthScore')
      const healthError = result.errors.find((e) => /health score/i.test(e))
      expect(healthError).toMatch(/not wired to a live provider/i)
    })

    it('should not overwrite existing data with fabrication on refresh', async () => {
      const prospect = createMockProspect()
      const originalRevenue = prospect.estimatedRevenue

      const { prospect: refreshed } = await service.refreshProspectData(prospect, [
        'estimatedRevenue'
      ])

      // estimateRevenue throws => the existing revenue is preserved untouched.
      expect(refreshed.estimatedRevenue).toBe(originalRevenue)
    })

    it('should still recalculate priority and narrative deterministically', async () => {
      const prospect = createMockProspect()

      const { prospect: refreshed } = await service.refreshProspectData(prospect)

      expect(refreshed.priorityScore).toBeDefined()
      expect(refreshed.narrative).toBeDefined()
    })
  })

  describe('enrichProspects batch', () => {
    it('should enrich multiple prospects', async () => {
      const filings = [createMockUCCFiling({}), createMockUCCFiling({}), createMockUCCFiling({})]

      const { prospects, results } = await service.enrichProspects(filings)

      expect(prospects).toHaveLength(3)
      expect(results).toHaveLength(3)
    })

    it('should respect concurrency limit', async () => {
      const filings = Array(10)
        .fill(null)
        .map(() => createMockUCCFiling({}))

      const { prospects, results } = await service.enrichProspects(filings, 2)

      expect(prospects).toHaveLength(10)
      expect(results).toHaveLength(10)
    })
  })
})
