import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ScrapeJobService } from '../../services/ScrapeJobService'
import type { UCCSearchResponse } from '../../services/UCCSearchService'

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }))

vi.mock('../../database/connection', () => ({
  database: { query: mockQuery }
}))

const TEST_JOB_ID = '550e8400-e29b-41d4-a716-446655440000'

const baseRow = {
  id: TEST_JOB_ID,
  org_id: 'org-1',
  api_key_id: 'key-1',
  company_name: 'Acme Corp',
  state: 'CA',
  search_limit: 100,
  status: 'queued' as const,
  result: null,
  error: null,
  queued_at: '2026-06-26T00:00:00Z',
  started_at: null,
  completed_at: null,
  expires_at: '2026-07-03T00:00:00Z'
}

describe('ScrapeJobService', () => {
  let service: ScrapeJobService

  beforeEach(() => {
    mockQuery.mockReset()
    service = new ScrapeJobService()
  })

  describe('enqueue', () => {
    it('inserts a job row and returns mapped job', async () => {
      mockQuery.mockResolvedValue([baseRow])

      const job = await service.enqueue({
        orgId: 'org-1',
        apiKeyId: 'key-1',
        companyName: 'Acme Corp',
        state: 'CA',
        limit: 100
      })

      expect(job.id).toBe(TEST_JOB_ID)
      expect(job.status).toBe('queued')
      expect(job.companyName).toBe('Acme Corp')
      expect(job.apiKeyId).toBe('key-1')
      expect(mockQuery).toHaveBeenCalledOnce()
    })

    it('throws if the insert returns no row', async () => {
      mockQuery.mockResolvedValue([])
      await expect(
        service.enqueue({ orgId: 'o', apiKeyId: null, companyName: 'X', state: 'TX', limit: 10 })
      ).rejects.toThrow('Failed to create scrape job')
    })

    it('accepts null apiKeyId for JWT-authenticated callers', async () => {
      mockQuery.mockResolvedValue([{ ...baseRow, api_key_id: null }])
      const job = await service.enqueue({
        orgId: 'org-1',
        apiKeyId: null,
        companyName: 'Acme Corp',
        state: 'CA',
        limit: 100
      })
      expect(job.apiKeyId).toBeNull()
    })
  })

  describe('get', () => {
    it('returns the job when org matches', async () => {
      mockQuery.mockResolvedValue([baseRow])
      const job = await service.get(TEST_JOB_ID, 'org-1')
      expect(job).not.toBeNull()
      expect(job!.id).toBe(TEST_JOB_ID)
    })

    it('returns null when not found', async () => {
      mockQuery.mockResolvedValue([])
      const job = await service.get('missing', 'org-1')
      expect(job).toBeNull()
    })
  })

  describe('list', () => {
    it('returns all jobs for the org', async () => {
      mockQuery.mockResolvedValue([baseRow, { ...baseRow, id: 'job-uuid-2' }])
      const jobs = await service.list('org-1')
      expect(jobs).toHaveLength(2)
    })

    it('returns empty array when org has no jobs', async () => {
      mockQuery.mockResolvedValue([])
      const jobs = await service.list('org-x')
      expect(jobs).toHaveLength(0)
    })
  })

  describe('markProcessing', () => {
    it('issues the correct UPDATE', async () => {
      mockQuery.mockResolvedValue([])
      await service.markProcessing(TEST_JOB_ID)
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'processing'"),
        [TEST_JOB_ID]
      )
    })
  })

  describe('markCompleted', () => {
    it('stores the result JSON', async () => {
      mockQuery.mockResolvedValue([])
      const result: UCCSearchResponse = {
        filings: [],
        total: 0,
        state: 'CA',
        companyName: 'Acme Corp',
        timestamp: '2026-06-26T00:00:00Z'
      }
      await service.markCompleted(TEST_JOB_ID, result)
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'completed'"),
        [TEST_JOB_ID, JSON.stringify(result)]
      )
    })
  })

  describe('markFailed', () => {
    it('stores the error message', async () => {
      mockQuery.mockResolvedValue([])
      await service.markFailed(TEST_JOB_ID, 'Collector timeout')
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'failed'"),
        [TEST_JOB_ID, 'Collector timeout']
      )
    })
  })

  describe('cleanup', () => {
    it('returns count of deleted rows', async () => {
      mockQuery.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
      const count = await service.cleanup()
      expect(count).toBe(2)
    })
  })
})
