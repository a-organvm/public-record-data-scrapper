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
  mockLinkToProspect,
  mockUnlinkFromProspect,
  mockLogActivity,
  mockGetActivities,
  mockGetActivityTimeline
} = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockGetById: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockLinkToProspect: vi.fn(),
  mockUnlinkFromProspect: vi.fn(),
  mockLogActivity: vi.fn(),
  mockGetActivities: vi.fn(),
  mockGetActivityTimeline: vi.fn()
}))

// Mock the ContactsService
vi.mock('../../services/ContactsService', () => ({
  ContactsService: class MockContactsService {
    list = mockList
    getById = mockGetById
    create = mockCreate
    update = mockUpdate
    delete = mockDelete
    linkToProspect = mockLinkToProspect
    unlinkFromProspect = mockUnlinkFromProspect
    logActivity = mockLogActivity
    getActivities = mockGetActivities
    // The routes call getActivityTimeline (timeline view); the older mock only
    // exposed getActivities, leaving this undefined and throwing at runtime.
    getActivityTimeline = mockGetActivityTimeline
  }
}))

describe('Contacts API', () => {
  let app: Express
  let authHeader: string

  const mockOrgId = '550e8400-e29b-41d4-a716-446655440000'
  const mockContactId = '550e8400-e29b-41d4-a716-446655440001'
  const mockProspectId = '550e8400-e29b-41d4-a716-446655440002'

  beforeEach(() => {
    vi.clearAllMocks()
    app = createTestApp()
    // Mint a token bound to the test org so multi-tenant isolation passes.
    authHeader = createAuthHeader('test-user-123', { orgId: mockOrgId })
  })

  describe('GET /api/contacts', () => {
    it('should return paginated list of contacts', async () => {
      const mockContacts = [
        { id: mockContactId, first_name: 'John', last_name: 'Doe', email: 'john@example.com' },
        { id: '2', first_name: 'Jane', last_name: 'Smith', email: 'jane@example.com' }
      ]

      mockList.mockResolvedValueOnce({
        contacts: mockContacts,
        page: 1,
        limit: 20,
        total: 2
      })

      const response = await request(app)
        .get(`/api/contacts?org_id=${mockOrgId}`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('contacts')
      expect(response.body).toHaveProperty('pagination')
      expect(response.body.contacts).toBeInstanceOf(Array)
      expect(response.body.contacts.length).toBe(2)
      expect(response.body.pagination.total).toBe(2)
    })

    it('should derive org from the token when no org_id query param is given', async () => {
      mockList.mockResolvedValueOnce({ contacts: [], page: 1, limit: 20, total: 0 })

      const response = await request(app).get('/api/contacts').set('Authorization', authHeader)

      expect(response.status).toBe(200)
      expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ orgId: mockOrgId }))
    })

    it('should fail closed (403) when the token has no org', async () => {
      const noOrgHeader = createAuthHeader('test-user-123', { orgId: null })

      const response = await request(app)
        .get('/api/contacts')
        .set('Authorization', noOrgHeader)

      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('FORBIDDEN')
    })

    it('should reject a mismatched org_id query param (403)', async () => {
      const otherOrg = '550e8400-e29b-41d4-a716-4466554409ff'

      const response = await request(app)
        .get(`/api/contacts?org_id=${otherOrg}`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('FORBIDDEN')
    })

    it('should filter by role', async () => {
      mockList.mockResolvedValueOnce({
        contacts: [{ id: mockContactId, first_name: 'John', role: 'owner' }],
        page: 1,
        limit: 20,
        total: 1
      })

      const response = await request(app)
        .get(`/api/contacts?org_id=${mockOrgId}&role=owner`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)
      expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ role: 'owner' }))
    })

    it('should filter by search term', async () => {
      mockList.mockResolvedValueOnce({
        contacts: [{ id: mockContactId, first_name: 'John', last_name: 'Doe' }],
        page: 1,
        limit: 20,
        total: 1
      })

      const response = await request(app)
        .get(`/api/contacts?org_id=${mockOrgId}&search=John`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)
      expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ search: 'John' }))
    })

    it('should handle pagination parameters', async () => {
      mockList.mockResolvedValueOnce({
        contacts: Array(10).fill({ id: '1', first_name: 'Test' }),
        page: 2,
        limit: 10,
        total: 25
      })

      const response = await request(app)
        .get(`/api/contacts?org_id=${mockOrgId}&page=2&limit=10`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)
      expect(response.body.pagination.page).toBe(2)
      expect(response.body.pagination.limit).toBe(10)
      expect(response.body.pagination.total).toBe(25)
    })

    it('should support sorting', async () => {
      mockList.mockResolvedValueOnce({
        contacts: [],
        page: 1,
        limit: 20,
        total: 0
      })

      const response = await request(app)
        .get(`/api/contacts?org_id=${mockOrgId}&sort_by=first_name&sort_order=asc`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)
      // The route maps query params to camelCase service args.
      expect(mockList).toHaveBeenCalledWith(
        expect.objectContaining({
          sortBy: 'first_name',
          sortOrder: 'asc'
        })
      )
    })

    it('should require authentication', async () => {
      const response = await request(app).get(`/api/contacts?org_id=${mockOrgId}`)

      expect(response.status).toBe(401)
    })
  })

  describe('GET /api/contacts/:id', () => {
    it('should return contact by id', async () => {
      const mockContact = {
        id: mockContactId,
        first_name: 'John',
        last_name: 'Doe',
        email: 'john@example.com',
        role: 'owner'
      }

      mockGetById.mockResolvedValueOnce(mockContact)

      const response = await request(app)
        .get(`/api/contacts/${mockContactId}`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)
      expect(response.body.id).toBe(mockContactId)
      expect(response.body.first_name).toBe('John')
      expect(response.body.last_name).toBe('Doe')
    })

    it('should return 404 for non-existent contact', async () => {
      mockGetById.mockResolvedValueOnce(null)

      const response = await request(app)
        .get(`/api/contacts/${mockContactId}`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(404)
      expect(response.body.error).toBeDefined()
    })

    it('should validate UUID format', async () => {
      const response = await request(app)
        .get('/api/contacts/invalid-uuid')
        .set('Authorization', authHeader)

      expect(response.status).toBe(400)
      expect(response.body.error).toBeDefined()
    })
  })

  describe('POST /api/contacts', () => {
    it('should create a new contact', async () => {
      const contactData = {
        org_id: mockOrgId,
        first_name: 'John',
        last_name: 'Doe',
        email: 'john@example.com',
        role: 'owner'
      }

      const mockCreated = {
        id: mockContactId,
        ...contactData,
        is_active: true,
        created_at: new Date().toISOString()
      }

      mockCreate.mockResolvedValueOnce(mockCreated)

      const response = await request(app)
        .post('/api/contacts')
        .set('Authorization', authHeader)
        .send(contactData)

      expect(response.status).toBe(201)
      expect(response.body.id).toBeDefined()
      expect(response.body.first_name).toBe('John')
      expect(response.body.last_name).toBe('Doe')
    })

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/contacts')
        .set('Authorization', authHeader)
        .send({
          org_id: mockOrgId,
          first_name: 'John'
          // missing last_name
        })

      expect(response.status).toBe(400)
      expect(response.body.error).toBeDefined()
    })

    it('should validate email format', async () => {
      const response = await request(app)
        .post('/api/contacts')
        .set('Authorization', authHeader)
        .send({
          org_id: mockOrgId,
          first_name: 'John',
          last_name: 'Doe',
          email: 'invalid-email'
        })

      expect(response.status).toBe(400)
    })

    it('should validate role enum', async () => {
      const response = await request(app)
        .post('/api/contacts')
        .set('Authorization', authHeader)
        .send({
          org_id: mockOrgId,
          first_name: 'John',
          last_name: 'Doe',
          role: 'invalid_role'
        })

      expect(response.status).toBe(400)
    })
  })

  // The route exposes updates via PUT /api/contacts/:id (not PATCH).
  describe('PUT /api/contacts/:id', () => {
    it('should update contact fields', async () => {
      const mockUpdated = {
        id: mockContactId,
        first_name: 'Johnny',
        last_name: 'Doe',
        email: 'johnny@example.com'
      }

      mockUpdate.mockResolvedValueOnce(mockUpdated)

      const response = await request(app)
        .put(`/api/contacts/${mockContactId}`)
        .set('Authorization', authHeader)
        .send({
          first_name: 'Johnny'
        })

      expect(response.status).toBe(200)
      expect(response.body.first_name).toBe('Johnny')
    })

    it('should return 404 for non-existent contact', async () => {
      mockUpdate.mockRejectedValueOnce(new NotFoundError('Contact', mockContactId))

      const response = await request(app)
        .put(`/api/contacts/${mockContactId}`)
        .set('Authorization', authHeader)
        .send({
          first_name: 'Test'
        })

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('NOT_FOUND')
    })

    it('should allow partial updates', async () => {
      const mockUpdated = {
        id: mockContactId,
        first_name: 'John',
        last_name: 'Doe',
        title: 'CEO'
      }

      mockUpdate.mockResolvedValueOnce(mockUpdated)

      const response = await request(app)
        .put(`/api/contacts/${mockContactId}`)
        .set('Authorization', authHeader)
        .send({
          title: 'CEO'
        })

      expect(response.status).toBe(200)
      expect(response.body.title).toBe('CEO')
    })
  })

  // NOTE: There is intentionally no DELETE /api/contacts/:id endpoint — contacts
  // are deactivated via PUT (is_active: false) rather than hard-deleted, so the
  // previously-present hard-delete tests targeting a non-existent route were removed.

  // The route links/unlinks via POST|DELETE /api/contacts/:id/link/:prospectId.
  describe('POST /api/contacts/:id/link/:prospectId', () => {
    it('should link contact to prospect', async () => {
      const mockLink = {
        contact_id: mockContactId,
        prospect_id: mockProspectId,
        is_primary: true,
        relationship: 'owner'
      }

      mockLinkToProspect.mockResolvedValueOnce(mockLink)

      const response = await request(app)
        .post(`/api/contacts/${mockContactId}/link/${mockProspectId}`)
        .set('Authorization', authHeader)
        .send({
          is_primary: true,
          relationship: 'owner'
        })

      expect(response.status).toBe(201)
      expect(response.body.contact_id).toBe(mockContactId)
      expect(response.body.prospect_id).toBe(mockProspectId)
    })

    it('should validate relationship enum', async () => {
      const response = await request(app)
        .post(`/api/contacts/${mockContactId}/link/${mockProspectId}`)
        .set('Authorization', authHeader)
        .send({
          relationship: 'invalid_relationship'
        })

      expect(response.status).toBe(400)
    })
  })

  describe('DELETE /api/contacts/:id/link/:prospectId', () => {
    it('should unlink contact from prospect', async () => {
      mockUnlinkFromProspect.mockResolvedValueOnce(true)

      const response = await request(app)
        .delete(`/api/contacts/${mockContactId}/link/${mockProspectId}`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(204)
    })

    it('should return 404 if link not found', async () => {
      // The route returns 404 when unlinkFromProspect resolves falsy.
      mockUnlinkFromProspect.mockResolvedValueOnce(false)

      const response = await request(app)
        .delete(`/api/contacts/${mockContactId}/link/${mockProspectId}`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(404)
    })
  })

  describe('POST /api/contacts/:id/activities', () => {
    it('should log activity for contact', async () => {
      const activityData = {
        activity_type: 'call_outbound',
        subject: 'Follow-up call',
        description: 'Discussed funding options',
        duration_seconds: 300
      }

      const mockActivity = {
        id: '550e8400-e29b-41d4-a716-446655440003',
        contact_id: mockContactId,
        ...activityData,
        created_at: new Date().toISOString()
      }

      mockLogActivity.mockResolvedValueOnce(mockActivity)

      const response = await request(app)
        .post(`/api/contacts/${mockContactId}/activities`)
        .set('Authorization', authHeader)
        .send(activityData)

      expect(response.status).toBe(201)
      expect(response.body.activity_type).toBe('call_outbound')
      expect(response.body.contact_id).toBe(mockContactId)
    })

    it('should validate activity_type enum', async () => {
      const response = await request(app)
        .post(`/api/contacts/${mockContactId}/activities`)
        .set('Authorization', authHeader)
        .send({
          activity_type: 'invalid_type'
        })

      expect(response.status).toBe(400)
    })
  })

  describe('GET /api/contacts/:id/activities', () => {
    it('should return contact activities', async () => {
      const mockActivities = [
        { id: '1', activity_type: 'call_outbound', subject: 'Call 1' },
        { id: '2', activity_type: 'email_sent', subject: 'Email 1' }
      ]

      mockGetActivityTimeline.mockResolvedValueOnce(mockActivities)

      const response = await request(app)
        .get(`/api/contacts/${mockContactId}/activities`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)
      expect(response.body.activities).toBeInstanceOf(Array)
      expect(response.body.activities.length).toBe(2)
    })

    it('should ignore an unsupported activity_type filter and still return the timeline', async () => {
      // The route does not implement an activity_type filter; it serves the full
      // timeline via getActivityTimeline(id, { limit, before }). An unknown query
      // param is harmless and the activities are returned unfiltered.
      mockGetActivityTimeline.mockResolvedValueOnce([{ id: '1', activity_type: 'call_outbound' }])

      const response = await request(app)
        .get(`/api/contacts/${mockContactId}/activities?activity_type=call_outbound`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)
      expect(mockGetActivityTimeline).toHaveBeenCalledWith(
        mockContactId,
        expect.objectContaining({ limit: 50 })
      )
      expect(response.body.activities).toBeInstanceOf(Array)
    })
  })
})
