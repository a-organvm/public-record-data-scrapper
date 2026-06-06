import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { createTestApp, createAuthHeader } from '../helpers/testApp'
import type { Express } from 'express'
import { NotFoundError, ConflictError } from '../../errors'

// Use vi.hoisted so the mock fns exist when vi.mock's factory runs (the factory
// is hoisted above imports). Mirrors the pattern in prospects.test.ts.
const { mockClaim, mockUnclaim, mockBatchClaimReturning, mockBatchDelete } = vi.hoisted(() => ({
  mockClaim: vi.fn(),
  mockUnclaim: vi.fn(),
  mockBatchClaimReturning: vi.fn(),
  mockBatchDelete: vi.fn()
}))

// Mock ProspectsService. Only the methods exercised here are defined; the
// claim/unclaim/batch routes never touch list/getById/etc.
vi.mock('../../services/ProspectsService', () => ({
  ProspectsService: class MockProspectsService {
    claim = mockClaim
    unclaim = mockUnclaim
    batchClaimReturning = mockBatchClaimReturning
    batchDelete = mockBatchDelete
  }
}))

const PROSPECT_A = '550e8400-e29b-41d4-a716-446655440000'
const PROSPECT_B = '550e8400-e29b-41d4-a716-446655440001'
const MISSING = '00000000-0000-0000-0000-000000000000'

describe('Prospects claim/unclaim/batch API', () => {
  let app: Express
  let authHeader: string
  // A second org's auth header. Prospects are not org-scoped at the table level
  // (no org_id column), so cross-org isolation is enforced at the row-ownership
  // level: the service's claim is atomic and a foreign org claiming an
  // already-claimed prospect gets a 409, never the row.
  let otherOrgAuthHeader: string

  beforeEach(() => {
    vi.clearAllMocks()
    app = createTestApp()
    authHeader = createAuthHeader('user-org-a', { orgId: 'org-a' })
    otherOrgAuthHeader = createAuthHeader('user-org-b', { orgId: 'org-b' })
  })

  describe('POST /api/prospects/:id/claim', () => {
    it('claims a prospect (happy path) and returns the claimed row', async () => {
      const claimed = {
        id: PROSPECT_A,
        company_name: 'Acme Co',
        status: 'claimed',
        claimed_by: 'Current User',
        claimed_date: '2026-06-06'
      }
      mockClaim.mockResolvedValueOnce(claimed)

      const response = await request(app)
        .post(`/api/prospects/${PROSPECT_A}/claim`)
        .set('Authorization', authHeader)
        .send({ user: 'Current User' })

      expect(response.status).toBe(200)
      expect(response.body.id).toBe(PROSPECT_A)
      expect(response.body.status).toBe('claimed')
      expect(response.body.claimed_by).toBe('Current User')
      expect(mockClaim).toHaveBeenCalledWith(PROSPECT_A, 'Current User')
    })

    it('requires a user in the body', async () => {
      const response = await request(app)
        .post(`/api/prospects/${PROSPECT_A}/claim`)
        .set('Authorization', authHeader)
        .send({})

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('VALIDATION_ERROR')
      expect(mockClaim).not.toHaveBeenCalled()
    })

    it('validates the id is a UUID', async () => {
      const response = await request(app)
        .post('/api/prospects/not-a-uuid/claim')
        .set('Authorization', authHeader)
        .send({ user: 'Current User' })

      expect(response.status).toBe(400)
      expect(mockClaim).not.toHaveBeenCalled()
    })

    it('returns 404 when the prospect does not exist', async () => {
      mockClaim.mockRejectedValueOnce(new NotFoundError('Prospect', MISSING))

      const response = await request(app)
        .post(`/api/prospects/${MISSING}/claim`)
        .set('Authorization', authHeader)
        .send({ user: 'Current User' })

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('NOT_FOUND')
    })

    it('rejects cross-org claim of an already-claimed prospect with 409', async () => {
      // org-a holds PROSPECT_A. org-b attempts to claim it; the atomic
      // conditional update matches no row and the service surfaces a conflict.
      mockClaim.mockRejectedValueOnce(
        new ConflictError(`Prospect ${PROSPECT_A} is already claimed`, 'prospect')
      )

      const response = await request(app)
        .post(`/api/prospects/${PROSPECT_A}/claim`)
        .set('Authorization', otherOrgAuthHeader)
        .send({ user: 'Other Org User' })

      expect(response.status).toBe(409)
      expect(response.body.error.message).toContain('already claimed')
    })

    it('requires authentication', async () => {
      const response = await request(app)
        .post(`/api/prospects/${PROSPECT_A}/claim`)
        .send({ user: 'Current User' })

      expect(response.status).toBe(401)
    })
  })

  describe('POST /api/prospects/:id/unclaim', () => {
    it('unclaims a prospect and returns the updated row', async () => {
      const unclaimed = {
        id: PROSPECT_A,
        company_name: 'Acme Co',
        status: 'new',
        claimed_by: null,
        claimed_date: null
      }
      mockUnclaim.mockResolvedValueOnce(unclaimed)

      const response = await request(app)
        .post(`/api/prospects/${PROSPECT_A}/unclaim`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)
      expect(response.body.id).toBe(PROSPECT_A)
      expect(response.body.status).toBe('new')
      expect(response.body.claimed_by).toBeNull()
      expect(mockUnclaim).toHaveBeenCalledWith(PROSPECT_A)
    })

    it('returns 404 when the prospect does not exist', async () => {
      mockUnclaim.mockRejectedValueOnce(new NotFoundError('Prospect', MISSING))

      const response = await request(app)
        .post(`/api/prospects/${MISSING}/unclaim`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('NOT_FOUND')
    })

    it('validates the id is a UUID', async () => {
      const response = await request(app)
        .post('/api/prospects/not-a-uuid/unclaim')
        .set('Authorization', authHeader)

      expect(response.status).toBe(400)
      expect(mockUnclaim).not.toHaveBeenCalled()
    })
  })

  describe('POST /api/prospects/batch/claim', () => {
    it('claims multiple prospects and returns the claimed rows', async () => {
      const claimed = [
        { id: PROSPECT_A, status: 'claimed', claimed_by: 'Current User' },
        { id: PROSPECT_B, status: 'claimed', claimed_by: 'Current User' }
      ]
      mockBatchClaimReturning.mockResolvedValueOnce(claimed)

      const response = await request(app)
        .post('/api/prospects/batch/claim')
        .set('Authorization', authHeader)
        .send({ ids: [PROSPECT_A, PROSPECT_B], user: 'Current User' })

      expect(response.status).toBe(200)
      expect(response.body).toBeInstanceOf(Array)
      expect(response.body.length).toBe(2)
      expect(response.body[0].id).toBe(PROSPECT_A)
      expect(mockBatchClaimReturning).toHaveBeenCalledWith([PROSPECT_A, PROSPECT_B], 'Current User')
    })

    it('returns only the rows that were successfully claimed (partial)', async () => {
      // PROSPECT_B already claimed by another org -> skipped by the service.
      mockBatchClaimReturning.mockResolvedValueOnce([
        { id: PROSPECT_A, status: 'claimed', claimed_by: 'Current User' }
      ])

      const response = await request(app)
        .post('/api/prospects/batch/claim')
        .set('Authorization', authHeader)
        .send({ ids: [PROSPECT_A, PROSPECT_B], user: 'Current User' })

      expect(response.status).toBe(200)
      expect(response.body.length).toBe(1)
      expect(response.body[0].id).toBe(PROSPECT_A)
    })

    it('rejects a non-uuid id in the batch', async () => {
      const response = await request(app)
        .post('/api/prospects/batch/claim')
        .set('Authorization', authHeader)
        .send({ ids: [PROSPECT_A, 'not-a-uuid'], user: 'Current User' })

      expect(response.status).toBe(400)
      expect(mockBatchClaimReturning).not.toHaveBeenCalled()
    })

    it('rejects an empty ids array', async () => {
      const response = await request(app)
        .post('/api/prospects/batch/claim')
        .set('Authorization', authHeader)
        .send({ ids: [], user: 'Current User' })

      expect(response.status).toBe(400)
      expect(mockBatchClaimReturning).not.toHaveBeenCalled()
    })

    it('requires authentication', async () => {
      const response = await request(app)
        .post('/api/prospects/batch/claim')
        .send({ ids: [PROSPECT_A], user: 'Current User' })

      expect(response.status).toBe(401)
    })
  })

  describe('DELETE /api/prospects/batch', () => {
    it('deletes multiple prospects and returns 204', async () => {
      mockBatchDelete.mockResolvedValueOnce({ deleted: 2 })

      const response = await request(app)
        .delete('/api/prospects/batch')
        .set('Authorization', authHeader)
        .send({ ids: [PROSPECT_A, PROSPECT_B] })

      expect(response.status).toBe(204)
      expect(mockBatchDelete).toHaveBeenCalledWith([PROSPECT_A, PROSPECT_B])
    })

    it('rejects a non-uuid id in the batch', async () => {
      const response = await request(app)
        .delete('/api/prospects/batch')
        .set('Authorization', authHeader)
        .send({ ids: ['not-a-uuid'] })

      expect(response.status).toBe(400)
      expect(mockBatchDelete).not.toHaveBeenCalled()
    })

    it('rejects an empty ids array', async () => {
      const response = await request(app)
        .delete('/api/prospects/batch')
        .set('Authorization', authHeader)
        .send({ ids: [] })

      expect(response.status).toBe(400)
      expect(mockBatchDelete).not.toHaveBeenCalled()
    })

    it('requires authentication', async () => {
      const response = await request(app)
        .delete('/api/prospects/batch')
        .send({ ids: [PROSPECT_A] })

      expect(response.status).toBe(401)
    })
  })
})
