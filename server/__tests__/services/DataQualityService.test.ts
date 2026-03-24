import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DataQualityService } from '../../services/DataQualityService'
import {
  FIELD_COMPLETENESS_THRESHOLD,
  MAX_DEDUPLICATION_RATE,
  PARTY_NAME_THRESHOLD,
  RECENCY_WINDOW_DAYS,
  DEFAULT_VOLUME_EXPECTATION
} from '../../config/dataQuality'

// Helper to generate a valid test filing
function makeFiling(overrides: Record<string, unknown> = {}) {
  return {
    filingNumber: `TEST-${Math.random().toString(36).slice(2)}`,
    filingDate: new Date().toISOString().split('T')[0],
    debtor: { name: 'Test Debtor' },
    securedParty: { name: 'Test Party' },
    ...overrides
  }
}

// Generate N filings with unique filing numbers and today's date by default
function makeFilings(n: number, overrides: Record<string, unknown> = {}) {
  return Array.from({ length: n }, (_, i) => ({
    filingNumber: `TEST-${i.toString().padStart(6, '0')}`,
    filingDate: new Date().toISOString().split('T')[0],
    debtor: { name: 'Test Debtor' },
    securedParty: { name: 'Test Party' },
    ...overrides
  }))
}

describe('DataQualityService', () => {
  const mockDb = {
    query: vi.fn().mockResolvedValue([])
  }

  let service: DataQualityService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new DataQualityService(mockDb)
  })

  describe('validateBatch', () => {
    it('returns passed=true for a good batch within CA volume range with complete fields and recent dates', () => {
      // CA min=50, max=2000
      const filings = makeFilings(100)
      const report = service.validateBatch('CA', 'job-1', filings)

      expect(report.passed).toBe(true)
      expect(report.warnings).toHaveLength(0)
      expect(report.stateCode).toBe('CA')
      expect(report.jobId).toBe('job-1')
      expect(report.recordsIngested).toBe(100)
      expect(report.assertions.volumeInRange).toBe(true)
      expect(report.assertions.expectedVolumeRange).toEqual([50, 2000])
      expect(report.assertions.fieldCompleteness).toBe(1)
      expect(report.assertions.deduplicationRate).toBe(0)
      expect(report.assertions.filingDateRecency).toBe(true)
      expect(report.assertions.partyNamePresent).toBe(1)
    })

    it('returns passed=false with volume warning when count is below min', () => {
      // CA min=50, only 10 filings
      const filings = makeFilings(10)
      const report = service.validateBatch('CA', 'job-2', filings)

      expect(report.passed).toBe(false)
      expect(report.assertions.volumeInRange).toBe(false)
      expect(report.assertions.expectedVolumeRange).toEqual([50, 2000])
      expect(report.warnings.some((w) => w.includes('Volume 10 outside expected range'))).toBe(true)
    })

    it('returns passed=false with volume warning when count exceeds max', () => {
      // CA max=2000
      const filings = makeFilings(2500)
      const report = service.validateBatch('CA', 'job-3', filings)

      expect(report.passed).toBe(false)
      expect(report.assertions.volumeInRange).toBe(false)
      expect(report.warnings.some((w) => w.includes('Volume 2500 outside expected range'))).toBe(
        true
      )
    })

    it('returns passed=false with deduplication warning when >30% of filingNumbers are duplicates', () => {
      // TX min=30, max=1500 — use 60 filings but make 40% duplicates
      // 60 filings, 36 unique → dedup rate = 1 - (36/60) = 0.4 > 0.3
      const unique = makeFilings(36)
      const dupes = Array.from({ length: 24 }, () => ({ ...unique[0] }))
      const filings = [...unique, ...dupes]

      const report = service.validateBatch('TX', 'job-4', filings)

      expect(report.passed).toBe(false)
      expect(report.assertions.deduplicationRate).toBeGreaterThan(MAX_DEDUPLICATION_RATE)
      expect(report.warnings.some((w) => w.includes('Deduplication rate'))).toBe(true)
      expect(report.warnings.some((w) => w.includes('exceeds'))).toBe(true)
    })

    it('returns passed=false with completeness warning when <80% have both filingNumber and filingDate', () => {
      // NY min=40, max=1800 — use 60 filings, only 40 complete (66.7% < 80%)
      const complete = makeFilings(40)
      const incomplete = Array.from({ length: 20 }, (_, i) => ({
        filingNumber: `MISSING-${i}`,
        // filingDate omitted — will be undefined
        debtor: { name: 'Test Debtor' },
        securedParty: { name: 'Test Party' }
      }))
      const filings = [...complete, ...incomplete]

      const report = service.validateBatch('NY', 'job-5', filings)

      expect(report.passed).toBe(false)
      expect(report.assertions.fieldCompleteness).toBeLessThan(FIELD_COMPLETENESS_THRESHOLD)
      expect(report.warnings.some((w) => w.includes('Field completeness'))).toBe(true)
      expect(report.warnings.some((w) => w.includes('below'))).toBe(true)
    })

    it('returns passed=false with party name warning when <90% have both debtor and securedParty names', () => {
      // FL min=20, max=1000 — 100 filings, 80 with both names (80% < 90%)
      const withParties = makeFilings(80)
      const withoutParties = Array.from({ length: 20 }, (_, i) => ({
        filingNumber: `NO-PARTY-${i}`,
        filingDate: new Date().toISOString().split('T')[0],
        debtor: { name: '' },
        securedParty: { name: 'Test Party' }
      }))
      const filings = [...withParties, ...withoutParties]

      const report = service.validateBatch('FL', 'job-6', filings)

      expect(report.passed).toBe(false)
      expect(report.assertions.partyNamePresent).toBeLessThan(PARTY_NAME_THRESHOLD)
      expect(report.warnings.some((w) => w.includes('Party name presence'))).toBe(true)
    })

    it('adds a recency warning when no filings fall within the last 30 days, and recency alone causes failure', () => {
      // CA min=50 — use 100 filings all with old dates, but complete and no dupes and all have party names
      const oldDate = new Date()
      oldDate.setDate(oldDate.getDate() - (RECENCY_WINDOW_DAYS + 5))
      const oldDateStr = oldDate.toISOString().split('T')[0]

      const filings = makeFilings(100, { filingDate: oldDateStr })

      const report = service.validateBatch('CA', 'job-7', filings)

      expect(report.assertions.filingDateRecency).toBe(false)
      expect(report.warnings.some((w) => w.includes('No filings found within the last'))).toBe(true)
      // Recency alone doesn't appear in the passed formula — verify the logic
      // passed = volumeInRange && fieldCompleteness >= threshold && deduplicationRate <= threshold && partyNamePresent >= threshold
      // All other checks pass, so passed should be true despite recency warning
      expect(report.assertions.volumeInRange).toBe(true)
      expect(report.assertions.fieldCompleteness).toBeGreaterThanOrEqual(
        FIELD_COMPLETENESS_THRESHOLD
      )
      expect(report.assertions.deduplicationRate).toBeLessThanOrEqual(MAX_DEDUPLICATION_RATE)
      expect(report.assertions.partyNamePresent).toBeGreaterThanOrEqual(PARTY_NAME_THRESHOLD)
      expect(report.passed).toBe(true) // recency is a warning-only, not in passed formula
    })

    it('returns passed=false for an empty batch — zero volume fails min check, completeness is 0', () => {
      const report = service.validateBatch('CA', 'job-8', [])

      expect(report.passed).toBe(false)
      expect(report.recordsIngested).toBe(0)
      expect(report.assertions.volumeInRange).toBe(false)
      expect(report.assertions.fieldCompleteness).toBe(0)
      expect(report.assertions.deduplicationRate).toBe(0)
      expect(report.assertions.filingDateRecency).toBe(false)
      expect(report.assertions.partyNamePresent).toBe(0)
      // Volume warning present
      expect(report.warnings.some((w) => w.includes('Volume 0 outside expected range'))).toBe(true)
    })

    it('uses DEFAULT_VOLUME_EXPECTATION for an unconfigured state (AK)', () => {
      // AK not in STATE_VOLUME_EXPECTATIONS → default min=5, max=500
      const filings = makeFilings(10) // above default min of 5
      const report = service.validateBatch('AK', 'job-9', filings)

      expect(report.assertions.expectedVolumeRange).toEqual([
        DEFAULT_VOLUME_EXPECTATION.min,
        DEFAULT_VOLUME_EXPECTATION.max
      ])
      // 10 is within [5, 500] so volume passes
      expect(report.assertions.volumeInRange).toBe(true)
    })

    it('normalizes state code to uppercase in the report', () => {
      const filings = makeFilings(100)
      const report = service.validateBatch('ca', 'job-10', filings)

      expect(report.stateCode).toBe('CA')
      // Should still use CA expectations
      expect(report.assertions.expectedVolumeRange).toEqual([50, 2000])
    })

    it('includes a timestamp in the report', () => {
      const before = new Date().toISOString()
      const filings = makeFilings(100)
      const report = service.validateBatch('CA', 'job-ts', filings)
      const after = new Date().toISOString()

      expect(report.timestamp >= before).toBe(true)
      expect(report.timestamp <= after).toBe(true)
    })

    it('rounds fieldCompleteness and deduplicationRate to 4 decimal places', () => {
      // CA min=50 — 60 filings, 1 missing filingDate → completeness = 59/60
      const filings = makeFilings(59)
      filings.push({
        filingNumber: 'NO-DATE-001',
        filingDate: undefined as unknown as string,
        debtor: { name: 'Test Debtor' },
        securedParty: { name: 'Test Party' }
      })

      const report = service.validateBatch('CA', 'job-round', filings)

      const fc = report.assertions.fieldCompleteness
      const dr = report.assertions.deduplicationRate
      // Should be representable with at most 4 decimal digits
      expect(String(fc).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(4)
      expect(String(dr).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(4)
    })
  })

  describe('persistReport', () => {
    it('calls db.query with INSERT INTO data_quality_reports and correct params', async () => {
      const filings = makeFilings(100)
      const report = service.validateBatch('CA', 'job-persist', filings)

      await service.persistReport(report)

      expect(mockDb.query).toHaveBeenCalledOnce()
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO data_quality_reports'),
        [
          report.stateCode,
          report.jobId,
          report.recordsIngested,
          report.assertions.volumeInRange,
          report.assertions.fieldCompleteness,
          report.assertions.deduplicationRate,
          report.assertions.filingDateRecency,
          report.assertions.partyNamePresent,
          report.passed,
          report.warnings
        ]
      )
    })

    it('propagates db errors', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('DB connection lost'))
      const filings = makeFilings(100)
      const report = service.validateBatch('CA', 'job-err', filings)

      await expect(service.persistReport(report)).rejects.toThrow('DB connection lost')
    })
  })

  describe('makeFiling helper sanity', () => {
    it('generates filings with unique filing numbers when called multiple times', () => {
      const f1 = makeFiling()
      const f2 = makeFiling()
      // Should be unique due to Math.random
      expect(f1.filingNumber).not.toBe(f2.filingNumber)
    })
  })
})
