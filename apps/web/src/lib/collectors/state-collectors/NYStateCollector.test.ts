/**
 * Tests for NYStateCollector (legacy compatibility shim)
 *
 * The NY portal scraper is not wired to a production-grade collector yet.
 * This shim fails closed instead of fabricating filings.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { NYStateCollector } from './NYStateCollector'
import { CollectionError } from '../types'
import type { UCCFiling } from '../types'

describe('NYStateCollector', () => {
  let collector: NYStateCollector

  beforeEach(() => {
    collector = new NYStateCollector()
  })

  describe('initialization', () => {
    it('should create collector with default configuration', () => {
      expect(collector).toBeDefined()
    })

    it('should accept custom configuration', () => {
      const customCollector = new NYStateCollector({
        timeout: 60000,
        retryAttempts: 5
      })

      expect(customCollector).toBeDefined()
    })

    it('should report unhealthy status (shim is disabled)', () => {
      const status = collector.getStatus()
      expect(status.isHealthy).toBe(false)
    })
  })

  describe('fail-closed behavior', () => {
    it('should throw CollectionError on searchByBusinessName', async () => {
      await expect(collector.searchByBusinessName('Example Corp')).rejects.toThrow(CollectionError)
    })

    it('should throw CollectionError on searchByFilingNumber', async () => {
      await expect(collector.searchByFilingNumber('NY-2024-001234')).rejects.toThrow(
        CollectionError
      )
    })

    it('should throw CollectionError on getFilingDetails', async () => {
      await expect(collector.getFilingDetails('NY-2024-001234')).rejects.toThrow(CollectionError)
    })

    it('should throw CollectionError on collectNewFilings', async () => {
      await expect(collector.collectNewFilings({ limit: 10 })).rejects.toThrow(CollectionError)
    })

    it('should include operation name in error message', async () => {
      await expect(collector.searchByBusinessName('Test')).rejects.toThrow(/searchByBusinessName/)
    })

    it('should indicate the collector is disabled', async () => {
      await expect(collector.searchByBusinessName('Test')).rejects.toThrow(/disabled/)
    })

    it('should track error statistics on each failed call', async () => {
      try {
        await collector.searchByBusinessName('Test')
      } catch {
        /* expected */
      }
      try {
        await collector.searchByFilingNumber('NY-001')
      } catch {
        /* expected */
      }

      const status = collector.getStatus()
      expect(status.errorRate).toBe(1) // 100% error rate — all calls fail
      expect(status.totalCollected).toBe(0)
    })
  })

  describe('validateFiling()', () => {
    let validFiling: UCCFiling

    beforeEach(() => {
      validFiling = {
        filingNumber: 'NY-2024-001234',
        filingType: 'UCC-1',
        filingDate: '2024-01-15',
        status: 'active',
        state: 'NY',
        securedParty: {
          name: 'Example Bank NA'
        },
        debtor: {
          name: 'Example Business LLC'
        },
        collateral: 'All assets'
      }
    })

    it('should validate correct filing', () => {
      const result = collector.validateFiling(validFiling)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should detect missing filing number', () => {
      const filing = { ...validFiling, filingNumber: '' }
      const result = collector.validateFiling(filing)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Missing filing number')
    })

    it('should detect missing filing date', () => {
      const filing = { ...validFiling, filingDate: '' }
      const result = collector.validateFiling(filing)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Missing filing date')
    })

    it('should detect missing debtor name', () => {
      const filing = { ...validFiling, debtor: { name: '' } }
      const result = collector.validateFiling(filing)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Missing debtor name')
    })

    it('should detect missing secured party name', () => {
      const filing = { ...validFiling, securedParty: { name: '' } }
      const result = collector.validateFiling(filing)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Missing secured party name')
    })

    it('should detect invalid state', () => {
      const filing = { ...validFiling, state: 'CA' }
      const result = collector.validateFiling(filing)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Invalid state: CA, expected NY')
    })

    it('should warn about missing collateral', () => {
      const filing = { ...validFiling, collateral: '' }
      const result = collector.validateFiling(filing)

      expect(result.warnings).toBeDefined()
      expect(result.warnings).toContain('Missing collateral description')
    })
  })

  describe('getStatus()', () => {
    it('should return collector status', () => {
      const status = collector.getStatus()

      expect(status).toHaveProperty('isHealthy')
      expect(status).toHaveProperty('totalCollected')
      expect(status).toHaveProperty('errorRate')
      expect(status).toHaveProperty('averageLatency')
    })

    it('should include rate limit stats', () => {
      const status = collector.getStatus()

      expect(status.rateLimitStats).toBeDefined()
      expect(status.rateLimitStats?.perMinute).toBeDefined()
      expect(status.rateLimitStats?.perHour).toBeDefined()
      expect(status.rateLimitStats?.perDay).toBeDefined()
    })
  })

  describe('rate limiting configuration', () => {
    it('should respect NY rate limits (30/min)', () => {
      const status = collector.getStatus()

      expect(status.rateLimitStats?.perMinute.limit).toBe(30)
    })

    it('should respect NY rate limits (500/hour)', () => {
      const status = collector.getStatus()

      expect(status.rateLimitStats?.perHour.limit).toBe(500)
    })

    it('should respect NY rate limits (5000/day)', () => {
      const status = collector.getStatus()

      expect(status.rateLimitStats?.perDay.limit).toBe(5000)
    })
  })
})
