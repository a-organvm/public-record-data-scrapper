import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EnrichmentService } from '../../services/EnrichmentService'

// Mock the database module
vi.mock('../../database/connection', () => ({
  database: {
    query: vi.fn()
  }
}))

import { database } from '../../database/connection'

const mockQuery = database.query as ReturnType<typeof vi.fn>

describe('EnrichmentService', () => {
  let service: EnrichmentService

  beforeEach(() => {
    mockQuery.mockReset()
    service = new EnrichmentService()
  })

  describe('enrichProspect', () => {
    // Live enrichment is intentionally fail-closed: the service refuses to
    // fabricate growth-signal / health-score data and throws a descriptive
    // error until real providers are wired. These tests assert that contract
    // (replacing the obsolete tests that expected fabricated enrichment).
    it('throws a clear "not wired to live providers" error once the prospect exists', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'prospect-1', company_name: 'Test Corp', lien_amount: 500000, industry: 'Technology' }
      ])

      await expect(service.enrichProspect('prospect-1')).rejects.toThrow(
        /not wired to live providers/i
      )
    })

    it('does not write enrichment data while unwired (no growth_signals/health_scores/UPDATE)', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'prospect-1', lien_amount: 500000, industry: 'Technology' }
      ])

      await expect(service.enrichProspect('prospect-1')).rejects.toThrow()

      const wrote = mockQuery.mock.calls.some((call) =>
        /INSERT INTO (growth_signals|health_scores)|UPDATE prospects/.test(String(call[0]))
      )
      expect(wrote).toBe(false)
    })

    it('should throw error for non-existent prospect', async () => {
      mockQuery.mockResolvedValueOnce([])

      await expect(service.enrichProspect('non-existent')).rejects.toThrow('Prospect')
    })
  })

  describe('enrichBatch', () => {
    it('reports every prospect as failed while enrichment is unwired (no fabricated successes)', async () => {
      mockQuery.mockImplementation((query: string) => {
        if (query.includes('SELECT * FROM prospects')) {
          return Promise.resolve([{ id: 'test', lien_amount: 500000, industry: 'Tech' }])
        }
        return Promise.resolve([])
      })

      const results = await service.enrichBatch(['prospect-1', 'prospect-2'])

      expect(results).toBeInstanceOf(Array)
      expect(results.length).toBe(2)
      expect(results[0].success).toBe(false)
      expect(results[1].success).toBe(false)
      expect(results[0].error).toMatch(/not wired to live providers/i)
    })

    it('records a per-prospect error for each failure without stopping the batch', async () => {
      let callCount = 0
      mockQuery.mockImplementation((query: string) => {
        if (query.includes('SELECT * FROM prospects')) {
          callCount++
          // First exists (then fails unwired), second is not found.
          if (callCount === 1) {
            return Promise.resolve([{ id: 'test', lien_amount: 500000 }])
          }
          return Promise.resolve([])
        }
        return Promise.resolve([])
      })

      const results = await service.enrichBatch(['prospect-1', 'non-existent'])

      expect(results.length).toBe(2)
      expect(results[0].success).toBe(false)
      expect(results[1].success).toBe(false)
      expect(results[0].error).toBeDefined()
      expect(results[1].error).toBeDefined()
    })

    it('should return empty array for empty input', async () => {
      const results = await service.enrichBatch([])

      expect(results).toBeInstanceOf(Array)
      expect(results.length).toBe(0)
    })
  })

  describe('triggerRefresh', () => {
    it('should query for unenriched prospects', async () => {
      mockQuery.mockResolvedValue([])

      await service.triggerRefresh(false)

      // Verify query was called with correct WHERE clause
      const firstCall = mockQuery.mock.calls[0]
      expect(firstCall[0]).toContain('SELECT id FROM prospects')
      expect(firstCall[0]).toContain('LIMIT 100')
    })

    it('should query all prospects when force=true', async () => {
      mockQuery.mockResolvedValue([])

      await service.triggerRefresh(true)

      // Verify force query doesn't have WHERE clause
      const firstCall = mockQuery.mock.calls[0]
      expect(firstCall[0]).toContain('SELECT id FROM prospects')
      expect(firstCall[0]).not.toContain('WHERE')
    })

    it('should return zero counts when no prospects need refresh', async () => {
      mockQuery.mockResolvedValueOnce([])

      const result = await service.triggerRefresh(false)

      expect(result.queued).toBe(0)
      expect(result.successful).toBe(0)
      expect(result.failed).toBe(0)
    })
  })

  describe('getStatus', () => {
    it('should return enrichment pipeline status', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          total_prospects: 8,
          enriched_count: 3,
          unenriched_count: 5,
          stale_count: 1,
          avg_confidence: 0.85
        }
      ])

      const status = await service.getStatus()

      expect(status).toBeDefined()
      expect(status.total_prospects).toBe(8)
      expect(status.enriched_count).toBe(3)
      expect(status.unenriched_count).toBe(5)
    })

    it('should return defaults when query returns empty', async () => {
      mockQuery.mockResolvedValueOnce([])

      const status = await service.getStatus()

      expect(status.total_prospects).toBe(0)
      expect(status.enriched_count).toBe(0)
      expect(status.avg_confidence).toBe(0)
    })
  })

  describe('getQueueStatus', () => {
    it('should return queue status', async () => {
      const status = await service.getQueueStatus()

      expect(status).toBeDefined()
      expect(status.waiting).toBeDefined()
      expect(status.active).toBeDefined()
      expect(status.completed).toBeDefined()
      expect(status.failed).toBeDefined()
      expect(status.delayed).toBeDefined()
    })

    it('reports the queue as not wired yet', async () => {
      const status = await service.getQueueStatus()

      expect(status.supported).toBe(false)
      expect(status.reason).toMatch(/not wired/i)
      expect(status.waiting).toBeNull()
      expect(status.active).toBeNull()
    })
  })
})
