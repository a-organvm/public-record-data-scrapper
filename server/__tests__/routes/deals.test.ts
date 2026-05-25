import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { createTestApp, createAuthHeader } from '../helpers/testApp'
import type { Express } from 'express'
import { NotFoundError } from '../../errors'

// Use vi.hoisted to ensure mocks are available when vi.mock runs
const {
  mockList,
  mockGetById,
  mockCreate,
  mockUpdate,
  mockDelete,
  mockMoveToStage,
  mockGetPipelineView,
  mockGetStages,
  mockUploadDocument,
  mockGetDocuments,
  mockGetDocumentChecklist,
  mockVerifyDocument,
  mockDeleteDocument,
  mockGetStats
} = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockGetById: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockMoveToStage: vi.fn(),
  mockGetPipelineView: vi.fn(),
  mockGetStages: vi.fn(),
  mockUploadDocument: vi.fn(),
  mockGetDocuments: vi.fn(),
  mockGetDocumentChecklist: vi.fn(),
  mockVerifyDocument: vi.fn(),
  mockDeleteDocument: vi.fn(),
  mockGetStats: vi.fn()
}))

// Mock the DealsService
vi.mock('../../services/DealsService', () => ({
  DealsService: class MockDealsService {
    list = mockList
    getById = mockGetById
    create = mockCreate
    update = mockUpdate
    delete = mockDelete
    moveToStage = mockMoveToStage
    getPipelineView = mockGetPipelineView
    getStages = mockGetStages
    uploadDocument = mockUploadDocument
    getDocuments = mockGetDocuments
    // GET /api/deals/:id builds a document checklist; without this the route
    // threw "getDocumentChecklist is not a function" and returned 500.
    getDocumentChecklist = mockGetDocumentChecklist
    verifyDocument = mockVerifyDocument
    deleteDocument = mockDeleteDocument
    getStats = mockGetStats
  }
}))

describe('Deals API', () => {
  let app: Express
  let authHeader: string

  const mockOrgId = '550e8400-e29b-41d4-a716-446655440000'
  const mockDealId = '550e8400-e29b-41d4-a716-446655440001'
  const mockStageId = '550e8400-e29b-41d4-a716-446655440002'
  const mockDocumentId = '550e8400-e29b-41d4-a716-446655440003'

  beforeEach(() => {
    vi.clearAllMocks()
    app = createTestApp()
    // Mint a token bound to the test org so multi-tenant isolation passes.
    authHeader = createAuthHeader('test-user-123', { orgId: mockOrgId })
  })

  describe('GET /api/deals', () => {
    it('should return paginated list of deals', async () => {
      const mockDeals = [
        { id: mockDealId, deal_number: 'DEAL-001', amount_requested: 50000 },
        { id: '2', deal_number: 'DEAL-002', amount_requested: 75000 }
      ]

      mockList.mockResolvedValueOnce({
        deals: mockDeals,
        page: 1,
        limit: 20,
        total: 2
      })

      const response = await request(app)
        .get(`/api/deals?org_id=${mockOrgId}`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('deals')
      expect(response.body).toHaveProperty('pagination')
      expect(response.body.deals).toBeInstanceOf(Array)
      expect(response.body.deals.length).toBe(2)
      expect(response.body.pagination.total).toBe(2)
    })

    it('should derive org from the token when no org_id query param is given', async () => {
      mockList.mockResolvedValueOnce({ deals: [], page: 1, limit: 20, total: 0 })

      const response = await request(app).get('/api/deals').set('Authorization', authHeader)

      expect(response.status).toBe(200)
      expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ orgId: mockOrgId }))
    })

    it('should fail closed (403) when the token has no org', async () => {
      const noOrgHeader = createAuthHeader('test-user-123', { orgId: null })

      const response = await request(app)
        .get('/api/deals')
        .set('Authorization', noOrgHeader)

      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('FORBIDDEN')
    })

    it('should reject a mismatched org_id query param (403)', async () => {
      const otherOrg = '550e8400-e29b-41d4-a716-4466554409ff'

      const response = await request(app)
        .get(`/api/deals?org_id=${otherOrg}`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('FORBIDDEN')
    })

    it('should filter by stage_id', async () => {
      mockList.mockResolvedValueOnce({
        deals: [{ id: mockDealId, stage_id: mockStageId }],
        page: 1,
        limit: 20,
        total: 1
      })

      const response = await request(app)
        .get(`/api/deals?org_id=${mockOrgId}&stage_id=${mockStageId}`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)
      // The route maps the stage_id query param to the camelCase service arg.
      expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ stageId: mockStageId }))
    })

    it('should filter by priority', async () => {
      mockList.mockResolvedValueOnce({
        deals: [{ id: mockDealId, priority: 'urgent' }],
        page: 1,
        limit: 20,
        total: 1
      })

      const response = await request(app)
        .get(`/api/deals?org_id=${mockOrgId}&priority=urgent`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)
      expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ priority: 'urgent' }))
    })

    it('should handle pagination parameters', async () => {
      mockList.mockResolvedValueOnce({
        deals: Array(10).fill({ id: '1', deal_number: 'DEAL-001' }),
        page: 2,
        limit: 10,
        total: 25
      })

      const response = await request(app)
        .get(`/api/deals?org_id=${mockOrgId}&page=2&limit=10`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)
      expect(response.body.pagination.page).toBe(2)
      expect(response.body.pagination.limit).toBe(10)
      expect(response.body.pagination.total).toBe(25)
    })

    it('should support sorting', async () => {
      mockList.mockResolvedValueOnce({
        deals: [],
        page: 1,
        limit: 20,
        total: 0
      })

      const response = await request(app)
        .get(`/api/deals?org_id=${mockOrgId}&sort_by=amount_requested&sort_order=desc`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)
      // The route maps query params to camelCase service args.
      expect(mockList).toHaveBeenCalledWith(
        expect.objectContaining({
          sortBy: 'amount_requested',
          sortOrder: 'desc'
        })
      )
    })

    it('should require authentication', async () => {
      const response = await request(app).get(`/api/deals?org_id=${mockOrgId}`)

      expect(response.status).toBe(401)
    })
  })

  describe('GET /api/deals/pipeline', () => {
    it('should return pipeline view with stages and deals', async () => {
      const mockPipeline = {
        stages: [
          { id: mockStageId, name: 'Lead', deals: [], total_value: 0 },
          { id: '2', name: 'Qualified', deals: [], total_value: 50000 }
        ],
        total_deals: 5,
        total_value: 250000
      }

      mockGetPipelineView.mockResolvedValueOnce(mockPipeline)

      const response = await request(app)
        .get(`/api/deals/pipeline?org_id=${mockOrgId}`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('stages')
      expect(response.body.stages).toBeInstanceOf(Array)
    })
  })

  describe('GET /api/deals/stages', () => {
    it('should return deal stages', async () => {
      const mockStages = [
        { id: mockStageId, name: 'Lead', order: 1 },
        { id: '2', name: 'Qualified', order: 2 }
      ]

      mockGetStages.mockResolvedValueOnce(mockStages)

      const response = await request(app)
        .get(`/api/deals/stages?org_id=${mockOrgId}`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)
      // The route wraps the stages array in a { stages } envelope.
      expect(response.body.stages).toBeInstanceOf(Array)
      expect(response.body.stages.length).toBe(2)
    })
  })

  describe('GET /api/deals/stats', () => {
    it('should return deal statistics', async () => {
      const mockStatsData = {
        total_deals: 100,
        total_value: 5000000,
        avg_deal_size: 50000,
        conversion_rate: 0.25
      }

      mockGetStats.mockResolvedValueOnce(mockStatsData)

      const response = await request(app)
        .get(`/api/deals/stats?org_id=${mockOrgId}`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('total_deals')
      expect(response.body).toHaveProperty('total_value')
    })
  })

  describe('GET /api/deals/:id', () => {
    it('should return deal by id', async () => {
      const mockDeal = {
        id: mockDealId,
        deal_number: 'DEAL-001',
        amount_requested: 50000,
        priority: 'normal'
      }

      mockGetById.mockResolvedValueOnce(mockDeal)
      // The route also hydrates documents + checklist on the detail view.
      mockGetDocuments.mockResolvedValueOnce([])
      mockGetDocumentChecklist.mockResolvedValueOnce([])

      const response = await request(app)
        .get(`/api/deals/${mockDealId}`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)
      expect(response.body.id).toBe(mockDealId)
      expect(response.body.deal_number).toBe('DEAL-001')
    })

    it('should return 404 for non-existent deal', async () => {
      mockGetById.mockResolvedValueOnce(null)

      const response = await request(app)
        .get(`/api/deals/${mockDealId}`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(404)
      expect(response.body.error).toBeDefined()
    })

    it('should validate UUID format', async () => {
      const response = await request(app)
        .get('/api/deals/invalid-uuid')
        .set('Authorization', authHeader)

      expect(response.status).toBe(400)
      expect(response.body.error).toBeDefined()
    })
  })

  describe('POST /api/deals', () => {
    it('should create a new deal', async () => {
      const dealData = {
        org_id: mockOrgId,
        amount_requested: 50000,
        term_months: 12,
        use_of_funds: 'working_capital',
        priority: 'normal'
      }

      const mockCreated = {
        id: mockDealId,
        deal_number: 'DEAL-001',
        ...dealData,
        created_at: new Date().toISOString()
      }

      mockCreate.mockResolvedValueOnce(mockCreated)

      const response = await request(app)
        .post('/api/deals')
        .set('Authorization', authHeader)
        .send(dealData)

      expect(response.status).toBe(201)
      expect(response.body.id).toBeDefined()
      expect(response.body.amount_requested).toBe(50000)
    })

    it('should derive org from token (no org_id required in body)', async () => {
      mockCreate.mockResolvedValueOnce({ id: mockDealId, amount_requested: 50000 })

      const response = await request(app).post('/api/deals').set('Authorization', authHeader).send({
        amount_requested: 50000
      })

      expect(response.status).toBe(201)
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ orgId: mockOrgId }))
    })

    it('should reject a body org_id that does not match the token (403)', async () => {
      const response = await request(app).post('/api/deals').set('Authorization', authHeader).send({
        org_id: '550e8400-e29b-41d4-a716-4466554409ff',
        amount_requested: 50000
      })

      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('FORBIDDEN')
    })

    it('should validate priority enum', async () => {
      const response = await request(app).post('/api/deals').set('Authorization', authHeader).send({
        org_id: mockOrgId,
        priority: 'invalid_priority'
      })

      expect(response.status).toBe(400)
    })

    it('should validate use_of_funds enum', async () => {
      const response = await request(app).post('/api/deals').set('Authorization', authHeader).send({
        org_id: mockOrgId,
        use_of_funds: 'invalid_use'
      })

      expect(response.status).toBe(400)
    })
  })

  // The route exposes updates via PUT /api/deals/:id (not PATCH).
  describe('PUT /api/deals/:id', () => {
    it('should update deal fields', async () => {
      const mockUpdated = {
        id: mockDealId,
        deal_number: 'DEAL-001',
        amount_requested: 75000,
        priority: 'high'
      }

      mockUpdate.mockResolvedValueOnce(mockUpdated)

      const response = await request(app)
        .put(`/api/deals/${mockDealId}`)
        .set('Authorization', authHeader)
        .send({
          amount_requested: 75000,
          priority: 'high'
        })

      expect(response.status).toBe(200)
      expect(response.body.amount_requested).toBe(75000)
      expect(response.body.priority).toBe('high')
    })

    it('should return 404 for non-existent deal', async () => {
      mockUpdate.mockRejectedValueOnce(new NotFoundError('Deal', mockDealId))

      const response = await request(app)
        .put(`/api/deals/${mockDealId}`)
        .set('Authorization', authHeader)
        .send({
          amount_requested: 50000
        })

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('NOT_FOUND')
    })

    it('should allow partial updates', async () => {
      const mockUpdated = {
        id: mockDealId,
        factor_rate: 1.35
      }

      mockUpdate.mockResolvedValueOnce(mockUpdated)

      const response = await request(app)
        .put(`/api/deals/${mockDealId}`)
        .set('Authorization', authHeader)
        .send({
          factor_rate: 1.35
        })

      expect(response.status).toBe(200)
      expect(response.body.factor_rate).toBe(1.35)
    })
  })

  // NOTE: There is intentionally no DELETE /api/deals/:id endpoint — DealsService
  // exposes no hard-delete for deals (only deleteDocument), so the previously
  // present hard-delete tests targeting a non-existent route were removed.

  // The route moves a deal between stages via PATCH /api/deals/:id/stage.
  describe('PATCH /api/deals/:id/stage', () => {
    it('should move deal to new stage', async () => {
      const mockMoved = {
        id: mockDealId,
        stage_id: mockStageId,
        stage_name: 'Qualified'
      }

      mockMoveToStage.mockResolvedValueOnce(mockMoved)

      const response = await request(app)
        .patch(`/api/deals/${mockDealId}/stage`)
        .set('Authorization', authHeader)
        .send({
          stage_id: mockStageId,
          notes: 'Qualified based on revenue'
        })

      expect(response.status).toBe(200)
      expect(response.body.stage_id).toBe(mockStageId)
    })

    it('should validate stage_id is required', async () => {
      const response = await request(app)
        .patch(`/api/deals/${mockDealId}/stage`)
        .set('Authorization', authHeader)
        .send({
          notes: 'Missing stage_id'
        })

      expect(response.status).toBe(400)
    })

    it('should return 404 for non-existent deal', async () => {
      mockMoveToStage.mockRejectedValueOnce(new NotFoundError('Deal', mockDealId))

      const response = await request(app)
        .patch(`/api/deals/${mockDealId}/stage`)
        .set('Authorization', authHeader)
        .send({
          stage_id: mockStageId
        })

      expect(response.status).toBe(404)
    })
  })

  describe('POST /api/deals/:id/documents', () => {
    it('should upload document for deal', async () => {
      const documentData = {
        document_type: 'bank_statement',
        file_name: 'statement.pdf',
        file_path: '/uploads/statement.pdf',
        file_size: 1024000
      }

      const mockDocument = {
        id: mockDocumentId,
        deal_id: mockDealId,
        ...documentData,
        created_at: new Date().toISOString()
      }

      // Deal must be owned by the caller's org before a document can be attached.
      mockGetById.mockResolvedValueOnce({ id: mockDealId, org_id: mockOrgId })
      mockUploadDocument.mockResolvedValueOnce(mockDocument)

      const response = await request(app)
        .post(`/api/deals/${mockDealId}/documents`)
        .set('Authorization', authHeader)
        .send(documentData)

      expect(response.status).toBe(201)
      expect(response.body.document_type).toBe('bank_statement')
      expect(response.body.deal_id).toBe(mockDealId)
    })

    it('should validate document_type enum', async () => {
      const response = await request(app)
        .post(`/api/deals/${mockDealId}/documents`)
        .set('Authorization', authHeader)
        .send({
          document_type: 'invalid_type',
          file_name: 'test.pdf',
          file_path: '/uploads/test.pdf'
        })

      expect(response.status).toBe(400)
    })

    it('should validate required fields', async () => {
      const response = await request(app)
        .post(`/api/deals/${mockDealId}/documents`)
        .set('Authorization', authHeader)
        .send({
          document_type: 'bank_statement'
          // missing file_name and file_path
        })

      expect(response.status).toBe(400)
    })
  })

  describe('GET /api/deals/:id/documents', () => {
    it('should return deal documents', async () => {
      const mockDocuments = [
        { id: mockDocumentId, document_type: 'bank_statement', file_name: 'statement.pdf' },
        { id: '2', document_type: 'application', file_name: 'application.pdf' }
      ]

      mockGetById.mockResolvedValueOnce({ id: mockDealId, org_id: mockOrgId })
      mockGetDocuments.mockResolvedValueOnce(mockDocuments)

      const response = await request(app)
        .get(`/api/deals/${mockDealId}/documents`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('documents')
      expect(response.body.documents).toBeInstanceOf(Array)
      expect(response.body.documents.length).toBe(2)
    })
  })

  describe('PATCH /api/deals/:id/documents/:documentId/verify', () => {
    it('should verify document', async () => {
      const mockVerified = {
        id: mockDocumentId,
        verified: true,
        verified_at: new Date().toISOString()
      }

      // Ownership: deal belongs to org, document belongs to deal.
      mockGetById.mockResolvedValueOnce({ id: mockDealId, org_id: mockOrgId })
      mockGetDocuments.mockResolvedValueOnce([{ id: mockDocumentId, dealId: mockDealId }])
      mockVerifyDocument.mockResolvedValueOnce(mockVerified)

      const response = await request(app)
        .patch(`/api/deals/${mockDealId}/documents/${mockDocumentId}/verify`)
        .set('Authorization', authHeader)
        .send({ verified_by: '550e8400-e29b-41d4-a716-446655440099' })

      expect(response.status).toBe(200)
      expect(response.body.verified).toBe(true)
    })

    it('should reject a document that does not belong to the org deal (404)', async () => {
      // Deal not found for this org -> ownership check fails before mutating.
      mockGetById.mockResolvedValueOnce(null)

      const response = await request(app)
        .patch(`/api/deals/${mockDealId}/documents/${mockDocumentId}/verify`)
        .set('Authorization', authHeader)
        .send({ verified_by: '550e8400-e29b-41d4-a716-446655440099' })

      expect(response.status).toBe(404)
      expect(mockVerifyDocument).not.toHaveBeenCalled()
    })

    it('should reject a non-UUID documentId (400)', async () => {
      const response = await request(app)
        .patch(`/api/deals/${mockDealId}/documents/not-a-uuid/verify`)
        .set('Authorization', authHeader)
        .send({ verified_by: '550e8400-e29b-41d4-a716-446655440099' })

      expect(response.status).toBe(400)
    })
  })

  describe('DELETE /api/deals/:id/documents/:documentId', () => {
    it('should delete document', async () => {
      mockGetById.mockResolvedValueOnce({ id: mockDealId, org_id: mockOrgId })
      mockGetDocuments.mockResolvedValueOnce([{ id: mockDocumentId, dealId: mockDealId }])
      mockDeleteDocument.mockResolvedValueOnce(true)

      const response = await request(app)
        .delete(`/api/deals/${mockDealId}/documents/${mockDocumentId}`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(204)
    })

    it('should reject a document that does not belong to the org deal (404)', async () => {
      mockGetById.mockResolvedValueOnce({ id: mockDealId, org_id: mockOrgId })
      // Deal owned, but document not among the deal's documents.
      mockGetDocuments.mockResolvedValueOnce([{ id: 'other-doc', dealId: mockDealId }])

      const response = await request(app)
        .delete(`/api/deals/${mockDealId}/documents/${mockDocumentId}`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(404)
      expect(mockDeleteDocument).not.toHaveBeenCalled()
    })
  })
})
