import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ProspectsService } from '../../services/ProspectsService'
import { NotFoundError, ValidationError, DatabaseError } from '../../errors'

// Mock the database module
vi.mock('../../database/connection', () => ({
  database: {
    query: vi.fn()
  }
}))

// Import the mocked database
import { database } from '../../database/connection'

const mockQuery = vi.mocked(database.query)

describe('ProspectsService', () => {
  let service: ProspectsService

  beforeEach(() => {
    vi.resetAllMocks()
    vi.clearAllMocks()
    mockQuery.mockReset()
    service = new ProspectsService()
  })

  describe('list', () => {
    it('should return paginated list of prospects', async () => {
      const mockProspects = [
        { id: '1', company_name: 'Test Company 1', state: 'NY', priority_score: 80 },
        { id: '2', company_name: 'Test Company 2', state: 'NY', priority_score: 75 },
        { id: '3', company_name: 'Test Company 3', state: 'NY', priority_score: 70 }
      ]

      mockQuery
        .mockResolvedValueOnce(mockProspects) // Main query
        .mockResolvedValueOnce([{ count: '3' }]) // Count query

      const result = await service.list({
        page: 1,
        limit: 10,
        sort_by: 'priority_score',
        sort_order: 'desc'
      })

      expect(result).toBeDefined()
      expect(result.prospects).toBeInstanceOf(Array)
      expect(result.prospects.length).toBe(3)
      expect(result.page).toBe(1)
      expect(result.limit).toBe(10)
      expect(result.total).toBe(3)
    })

    it('should filter prospects by state', async () => {
      const mockProspects = [
        { id: '1', company_name: 'Test Company 1', state: 'NY', priority_score: 80 },
        { id: '2', company_name: 'Test Company 2', state: 'NY', priority_score: 75 }
      ]

      mockQuery.mockResolvedValueOnce(mockProspects).mockResolvedValueOnce([{ count: '2' }])

      const result = await service.list({
        page: 1,
        limit: 10,
        state: 'NY',
        sort_by: 'priority_score',
        sort_order: 'desc'
      })

      expect(result.prospects.length).toBe(2)
      expect(result.total).toBe(2)

      // Verify state filter was applied in query
      const queryCall = mockQuery.mock.calls[0]
      expect(queryCall[0]).toContain('WHERE')
      expect(queryCall[0]).toContain('state = $1')
      expect(queryCall[1]).toContain('NY')
    })

    it('should filter prospects by industry', async () => {
      const mockProspects = [
        { id: '1', company_name: 'Tech Corp', state: 'CA', industry: 'Technology' }
      ]

      mockQuery.mockResolvedValueOnce(mockProspects).mockResolvedValueOnce([{ count: '1' }])

      const result = await service.list({
        page: 1,
        limit: 10,
        industry: 'Technology',
        sort_by: 'priority_score',
        sort_order: 'desc'
      })

      expect(result.prospects.length).toBe(1)
      expect(result.prospects[0].industry).toBe('Technology')

      const queryCall = mockQuery.mock.calls[0]
      expect(queryCall[0]).toContain('industry = $1')
    })

    it('should filter prospects by score range', async () => {
      const mockProspects = [{ id: '1', company_name: 'Mid Score', priority_score: 75 }]

      mockQuery.mockResolvedValueOnce(mockProspects).mockResolvedValueOnce([{ count: '1' }])

      const result = await service.list({
        page: 1,
        limit: 10,
        min_score: 60,
        max_score: 85,
        sort_by: 'priority_score',
        sort_order: 'desc'
      })

      expect(result.prospects.length).toBe(1)

      const queryCall = mockQuery.mock.calls[0]
      expect(queryCall[0]).toContain('priority_score >= $1')
      expect(queryCall[0]).toContain('priority_score <= $2')
    })

    it('should filter prospects by status', async () => {
      const mockProspects = [{ id: '1', company_name: 'Active Corp', status: 'claimed' }]

      mockQuery.mockResolvedValueOnce(mockProspects).mockResolvedValueOnce([{ count: '1' }])

      const result = await service.list({
        page: 1,
        limit: 10,
        status: 'claimed',
        sort_by: 'priority_score',
        sort_order: 'desc'
      })

      expect(result.prospects.length).toBe(1)

      const queryCall = mockQuery.mock.calls[0]
      expect(queryCall[0]).toContain('status = $1')
    })

    it('should handle pagination correctly', async () => {
      const page1Prospects = Array.from({ length: 10 }, (_, i) => ({
        id: `${i + 1}`,
        company_name: `Company ${i + 1}`,
        priority_score: 90 - i
      }))

      mockQuery.mockResolvedValueOnce(page1Prospects).mockResolvedValueOnce([{ count: '25' }])

      const result = await service.list({
        page: 1,
        limit: 10,
        sort_by: 'priority_score',
        sort_order: 'desc'
      })

      expect(result.prospects.length).toBe(10)
      expect(result.total).toBe(25)
      expect(result.page).toBe(1)

      // Verify OFFSET for page 1
      const queryCall = mockQuery.mock.calls[0]
      expect(queryCall[0]).toContain('LIMIT $1 OFFSET $2')
      expect(queryCall[1]).toContain(10) // limit
      expect(queryCall[1]).toContain(0) // offset for page 1
    })

    it('should calculate correct offset for page 2', async () => {
      mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: '25' }])

      await service.list({
        page: 2,
        limit: 10,
        sort_by: 'priority_score',
        sort_order: 'desc'
      })

      const queryCall = mockQuery.mock.calls[0]
      // offset for page 2 with limit 10 = (2-1) * 10 = 10
      expect(queryCall[1]).toContain(10) // offset
    })

    it('should use safe default for invalid sort column', async () => {
      mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: '0' }])

      await service.list({
        page: 1,
        limit: 10,
        sort_by: 'malicious; DROP TABLE prospects;--',
        sort_order: 'desc'
      })

      const queryCall = mockQuery.mock.calls[0]
      // Should default to priority_score
      expect(queryCall[0]).toContain('ORDER BY priority_score')
      expect(queryCall[0]).not.toContain('malicious')
    })

    it('should handle database errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Connection failed'))

      await expect(
        service.list({
          page: 1,
          limit: 10,
          sort_by: 'priority_score',
          sort_order: 'desc'
        })
      ).rejects.toThrow(DatabaseError)
    })
  })

  describe('getById', () => {
    it('should return prospect by id', async () => {
      const mockProspect = {
        id: 'test-id-123',
        company_name: 'Test Company',
        state: 'NY',
        priority_score: 85
      }

      mockQuery.mockResolvedValueOnce([mockProspect])

      const result = await service.getById('test-id-123')

      expect(result).toBeDefined()
      expect(result?.id).toBe('test-id-123')
      expect(result?.company_name).toBe('Test Company')
      expect(result?.state).toBe('NY')
    })

    it('should return null for non-existent id', async () => {
      mockQuery.mockResolvedValueOnce([])

      const result = await service.getById('00000000-0000-0000-0000-000000000000')

      expect(result).toBeNull()
    })

    it('should handle database errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Query failed'))

      await expect(service.getById('test-id')).rejects.toThrow(DatabaseError)
    })
  })

  describe('getByIdOrThrow', () => {
    it('should return prospect when found', async () => {
      const mockProspect = { id: 'test-id', company_name: 'Test Co' }
      mockQuery.mockResolvedValueOnce([mockProspect])

      const result = await service.getByIdOrThrow('test-id')

      expect(result).toBeDefined()
      expect(result.id).toBe('test-id')
    })

    it('should throw NotFoundError when prospect does not exist', async () => {
      mockQuery.mockResolvedValueOnce([])

      await expect(service.getByIdOrThrow('non-existent')).rejects.toThrow(NotFoundError)
    })
  })

  describe('create', () => {
    it('should create a new prospect', async () => {
      const mockCreated = {
        id: 'new-id',
        company_name: 'New Test Company',
        state: 'CA',
        industry: 'Technology',
        lien_amount: 750000,
        status: 'unclaimed'
      }

      mockQuery.mockResolvedValueOnce([mockCreated])

      const result = await service.create({
        companyName: 'New Test Company',
        state: 'CA',
        industry: 'Technology',
        lienAmount: 750000
      })

      expect(result).toBeDefined()
      expect(result.id).toBe('new-id')
      expect(result.company_name).toBe('New Test Company')
      expect(result.state).toBe('CA')
    })

    it('should throw ValidationError when company_name is missing', async () => {
      await expect(service.create({ state: 'CA' })).rejects.toThrow(ValidationError)
    })

    it('should set default status to new', async () => {
      const mockCreated = {
        id: 'new-id',
        companyName: 'Test',
        status: 'new'
      }

      mockQuery.mockResolvedValueOnce([mockCreated])

      await service.create({ companyName: 'Test' })

      // Verify status was set to 'new' in the query
      const queryCall = mockQuery.mock.calls[0]
      expect(queryCall[1]).toContain('new')
    })

    it('should handle database errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Insert failed'))

      await expect(service.create({ companyName: 'Test' })).rejects.toThrow(DatabaseError)
    })
  })

  describe('update', () => {
    it('should update prospect fields', async () => {
      const mockUpdated = {
        id: 'test-id',
        company_name: 'Updated Name',
        state: 'NY',
        priority_score: 85
      }

      mockQuery.mockResolvedValueOnce([mockUpdated])

      const result = await service.update('test-id', {
        company_name: 'Updated Name',
        priority_score: 85
      } as Partial<import('@public-records/core').Prospect>)

      expect(result).toBeDefined()
      expect(result.company_name).toBe('Updated Name')
    })

    it('should throw NotFoundError for non-existent id', async () => {
      mockQuery.mockResolvedValueOnce([])

      await expect(
        service.update('non-existent', { companyName: 'Test' } as Partial<
          import('@public-records/core').Prospect
        >)
      ).rejects.toThrow(NotFoundError)
    })

    it('should return current prospect when no fields to update', async () => {
      const mockProspect = { id: 'test-id', companyName: 'Test' }
      mockQuery.mockResolvedValueOnce([mockProspect])

      const result = await service.update('test-id', {})

      expect(result).toBeDefined()
      expect(result.id).toBe('test-id')
    })

    it('should handle database errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Update failed'))

      await expect(
        service.update('test-id', { companyName: 'Test' } as Partial<
          import('@public-records/core').Prospect
        >)
      ).rejects.toThrow(DatabaseError)
    })
  })

  describe('delete', () => {
    it('should delete a prospect', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 } as unknown as [])

      const result = await service.delete('test-id')

      expect(result).toBe(true)
    })

    it('should throw NotFoundError for non-existent id', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 } as unknown as [])

      await expect(service.delete('non-existent')).rejects.toThrow(NotFoundError)
    })

    it('should handle database errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Delete failed'))

      await expect(service.delete('test-id')).rejects.toThrow(DatabaseError)
    })
  })

  describe('claim', () => {
    it('should claim a prospect for a user', async () => {
      const mockClaimed = {
        id: 'test-id',
        company_name: 'Test Corp',
        status: 'claimed',
        claimed_by: 'user-123',
        claimed_at: new Date().toISOString()
      }

      mockQuery.mockResolvedValueOnce([mockClaimed])

      const result = await service.claim('test-id', 'user-123')

      expect(result).toBeDefined()
      expect(result.status).toBe('claimed')
      expect(result.claimed_by).toBe('user-123')
    })

    it('should throw NotFoundError if prospect does not exist', async () => {
      // claim() does a conditional UPDATE (no match -> empty), then a
      // disambiguation SELECT: empty -> the prospect truly does not exist.
      mockQuery
        .mockResolvedValueOnce([]) // UPDATE matched nothing
        .mockResolvedValueOnce([]) // existence check: not found

      await expect(service.claim('non-existent', 'user-123')).rejects.toThrow(NotFoundError)
    })

    it('should throw ConflictError if prospect is already claimed', async () => {
      mockQuery
        .mockResolvedValueOnce([]) // UPDATE matched nothing (precondition failed)
        .mockResolvedValueOnce([{ claimed_by: 'someone-else' }]) // exists -> already claimed

      await expect(service.claim('test-id', 'user-123')).rejects.toThrow(ConflictError)
    })

    it('should handle database errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Claim failed'))

      await expect(service.claim('test-id', 'user-123')).rejects.toThrow(DatabaseError)
    })
  })

  describe('batchClaim', () => {
    it('should claim multiple prospects', async () => {
      mockQuery
        .mockResolvedValueOnce([{ id: '1', status: 'claimed' }])
        .mockResolvedValueOnce([{ id: '2', status: 'claimed' }])
        .mockResolvedValueOnce([{ id: '3', status: 'claimed' }])

      const result = await service.batchClaim(['1', '2', '3'], 'user-123')

      expect(result.success).toBe(3)
      expect(result.failed).toBe(0)
      expect(result.errors).toHaveLength(0)
    })

    it('should handle partial failures', async () => {
      mockQuery
        .mockResolvedValueOnce([{ id: '1', status: 'claimed' }]) // #1 UPDATE ok
        .mockResolvedValueOnce([]) // #2 UPDATE matched nothing
        .mockResolvedValueOnce([]) // #2 existence check: not found -> failure
        .mockResolvedValueOnce([{ id: '3', status: 'claimed' }]) // #3 UPDATE ok

      const result = await service.batchClaim(['1', '2', '3'], 'user-123')

      expect(result.success).toBe(2)
      expect(result.failed).toBe(1)
      expect(result.errors).toHaveLength(1)
    })

    it('should throw ValidationError when batch size exceeds 100', async () => {
      const largeIds = Array.from({ length: 101 }, (_, i) => `id-${i}`)

      await expect(service.batchClaim(largeIds, 'user-123')).rejects.toThrow(ValidationError)
    })

    it('should return success counts on all failures', async () => {
      mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([])

      const result = await service.batchClaim(['1', '2'], 'user-123')

      expect(result.success).toBe(0)
      expect(result.failed).toBe(2)
      expect(result.errors).toHaveLength(2)
    })
  })
})
