/**
 * Tests for CAStateCollector (legacy compatibility shim)
 *
 * The production CA path is CAApiCollector. This shim fails closed
 * for all data operations and only provides validation and status.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { CAStateCollector } from './CAStateCollector'
import { CollectionError } from '../types'
import type { UCCFiling } from '../types'

describe('CAStateCollector', () => {
  let collector: CAStateCollector

  beforeEach(() => {
    collector = new CAStateCollector()
  })

  describe('initialization', () => {
    it('should create collector with default configuration', () => {
      expect(collector).toBeDefined()
    })

    it('should accept custom configuration', () => {
      const customCollector = new CAStateCollector({
        timeout: 60000,
        apiKey: 'test-key',
        costPerRequest: 0.02
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
      await expect(collector.searchByBusinessName('Tech Corp')).rejects.toThrow(CollectionError)
    })

    it('should throw CollectionError on searchByFilingNumber', async () => {
      await expect(collector.searchByFilingNumber('CA-2024-001234')).rejects.toThrow(
        CollectionError
      )
    })

    it('should throw CollectionError on getFilingDetails', async () => {
      await expect(collector.getFilingDetails('CA-2024-001234')).rejects.toThrow(CollectionError)
    })

    it('should throw CollectionError on collectNewFilings', async () => {
      await expect(collector.collectNewFilings({ limit: 10 })).rejects.toThrow(CollectionError)
    })

    it('should include operation name in error message', async () => {
      await expect(collector.searchByBusinessName('Test')).rejects.toThrow(/searchByBusinessName/)
    })

    it('should direct developers to CAApiCollector', async () => {
      await expect(collector.searchByBusinessName('Test')).rejects.toThrow(/CAApiCollector/)
    })

    it('should track error statistics on each failed call', async () => {
      try {
        await collector.searchByBusinessName('Test')
      } catch {
        /* expected */
      }
      try {
        await collector.searchByFilingNumber('CA-001')
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
        filingNumber: 'CA-2024-001234',
        filingType: 'UCC-1',
        filingDate: '2024-01-15',
        status: 'active',
        state: 'CA',
        securedParty: {
          name: 'California Bank & Trust'
        },
        debtor: {
          name: 'Example Business Inc'
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
      const filing = { ...validFiling, state: 'NY' }
      const result = collector.validateFiling(filing)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Invalid state: NY, expected CA')
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
    it('should respect CA rate limits (60/min)', () => {
      const status = collector.getStatus()

      expect(status.rateLimitStats?.perMinute.limit).toBe(60)
    })

    it('should respect CA rate limits (1200/hour)', () => {
      const status = collector.getStatus()

      expect(status.rateLimitStats?.perHour.limit).toBe(1200)
    })

    it('should respect CA rate limits (12000/day)', () => {
      const status = collector.getStatus()

      expect(status.rateLimitStats?.perDay.limit).toBe(12000)
    })
  })
})
