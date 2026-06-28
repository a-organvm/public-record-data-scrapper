import { describe, it, expect, vi, beforeEach } from 'vitest'
import express, { Express } from 'express'
import request from 'supertest'

const mocks = vi.hoisted(() => {
  const mockGetCachedBriefing = vi.fn()
  const mockGenerateBriefing = vi.fn()
  const mockIsEligible = vi.fn()
  const mockCreateSequence = vi.fn()
  const mockGetActiveSequences = vi.fn()
  const mockCancelSequence = vi.fn()

  class MockPreCallBriefingService {
    getCachedBriefing = mockGetCachedBriefing
    generateBriefing = mockGenerateBriefing
  }

  class MockOutreachSequenceService {
    isEligible = mockIsEligible
    createSequence = mockCreateSequence
    getActiveSequences = mockGetActiveSequences
    cancelSequence = mockCancelSequence
  }

  return {
    MockPreCallBriefingService,
    MockOutreachSequenceService,
    mockGetCachedBriefing,
    mockGenerateBriefing,
    mockIsEligible,
    mockCreateSequence,
    mockGetActiveSequences,
    mockCancelSequence
  }
})

vi.mock('../../services/PreCallBriefingService', () => ({
  PreCallBriefingService: mocks.MockPreCallBriefingService
}))

vi.mock('../../services/OutreachSequenceService', () => ({
  OutreachSequenceService: mocks.MockOutreachSequenceService
}))

vi.mock('../../database/connection', () => ({
  database: { query: vi.fn() }
}))

import { errorHandler } from '../../middleware/errorHandler'
import outreachRouter from '../../routes/outreach'

const PROSPECT_UUID = 'a1b2c3d4-e5f6-4890-a123-ef1234567890'
const PROSPECT_UUID_2 = '11111111-1111-4111-8111-111111111111'
const SEQUENCE_UUID = '22222222-2222-4222-8222-222222222222'

const sampleBriefing = {
  prospectId: 'a1b2c3d4-e5f6-4890-a123-ef1234567890',
  generatedAt: '2026-03-23T00:00:00.000Z',
  companyName: 'Acme Corp',
  state: 'CA',
  industry: 'Retail',
  priorityScore: 85,
  stackAnalysis: { activeFilings: 2, terminatedFilings: 1, totalFilings: 3, knownCompetitors: [] },
  freshCapacity: { score: 70, recentTerminations: 1, daysSinceLastTermination: 14 },
  velocity: { trend30d: 'stable', filings30d: 2, trend90d: null },
  talkingPoints: ['Fresh capacity available'],
  riskFactors: []
}

describe('Outreach Routes', () => {
  let app: Express

  beforeEach(() => {
    vi.clearAllMocks()
    app = express()
    app.use(express.json())
    app.use('/api/outreach', outreachRouter)
    app.use(errorHandler)
  })

  describe('GET /api/outreach/briefing/:prospectId', () => {
    it('returns 200 with cached briefing when cache is warm', async () => {
      mocks.mockGetCachedBriefing.mockResolvedValue(sampleBriefing)

      const response = await request(app).get(`/api/outreach/briefing/${PROSPECT_UUID}`)

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        prospectId: PROSPECT_UUID,
        companyName: 'Acme Corp'
      })
      expect(mocks.mockGenerateBriefing).not.toHaveBeenCalled()
    })

    it('generates fresh briefing when cache is empty', async () => {
      mocks.mockGetCachedBriefing.mockResolvedValue(null)
      mocks.mockGenerateBriefing.mockResolvedValue(sampleBriefing)

      const response = await request(app).get(`/api/outreach/briefing/${PROSPECT_UUID}`)

      expect(response.status).toBe(200)
      expect(mocks.mockGenerateBriefing).toHaveBeenCalledWith(PROSPECT_UUID)
      expect(response.body.companyName).toBe('Acme Corp')
    })

    it('returns 404 when prospect is not found', async () => {
      mocks.mockGetCachedBriefing.mockResolvedValue(null)
      mocks.mockGenerateBriefing.mockRejectedValue(
        new Error(`Prospect not found: ${PROSPECT_UUID_2}`)
      )

      const response = await request(app).get(`/api/outreach/briefing/${PROSPECT_UUID_2}`)

      expect(response.status).toBe(404)
    })

    it('returns 500 on unexpected error', async () => {
      mocks.mockGetCachedBriefing.mockRejectedValue(new Error('DB connection lost'))

      const response = await request(app).get(`/api/outreach/briefing/${PROSPECT_UUID}`)

      expect(response.status).toBe(500)
      expect(response.body.error).toBeTruthy()
    })

    it('returns 400 for non-UUID prospectId', async () => {
      const response = await request(app).get('/api/outreach/briefing/not-a-uuid')

      expect(response.status).toBe(400)
    })
  })

  describe('POST /api/outreach/trigger/:prospectId', () => {
    it('returns 201 with sequenceId when eligible', async () => {
      mocks.mockIsEligible.mockResolvedValue({ eligible: true })
      mocks.mockCreateSequence.mockResolvedValue(SEQUENCE_UUID)

      const response = await request(app)
        .post(`/api/outreach/trigger/${PROSPECT_UUID}`)
        .send({ triggerType: 'termination', capacityScore: 80 })

      expect(response.status).toBe(201)
      expect(response.body).toMatchObject({ sequenceId: SEQUENCE_UUID, status: 'created' })
    })

    it('returns 409 when prospect is not eligible', async () => {
      mocks.mockIsEligible.mockResolvedValue({
        eligible: false,
        reason: 'Active or recent sequence exists (cooldown 30 days)'
      })

      const response = await request(app)
        .post(`/api/outreach/trigger/${PROSPECT_UUID}`)
        .send({ triggerType: 'termination' })

      expect(response.status).toBe(409)
      expect(response.body).toMatchObject({
        error: 'Not eligible',
        reason: 'Active or recent sequence exists (cooldown 30 days)'
      })
      expect(mocks.mockCreateSequence).not.toHaveBeenCalled()
    })

    it('uses termination as default triggerType when not provided', async () => {
      mocks.mockIsEligible.mockResolvedValue({ eligible: true })
      mocks.mockCreateSequence.mockResolvedValue(SEQUENCE_UUID)

      await request(app).post(`/api/outreach/trigger/${PROSPECT_UUID}`).send({})

      expect(mocks.mockIsEligible).toHaveBeenCalledWith(PROSPECT_UUID, 'termination', undefined)
    })

    it('returns 400 for invalid triggerType', async () => {
      const response = await request(app)
        .post(`/api/outreach/trigger/${PROSPECT_UUID}`)
        .send({ triggerType: 'unknown_type' })

      expect(response.status).toBe(400)
    })

    it('returns 400 for non-UUID prospectId', async () => {
      const response = await request(app)
        .post('/api/outreach/trigger/not-a-uuid')
        .send({ triggerType: 'termination' })

      expect(response.status).toBe(400)
    })

    it('returns 500 on unexpected error', async () => {
      mocks.mockIsEligible.mockRejectedValue(new Error('DB error'))

      const response = await request(app)
        .post(`/api/outreach/trigger/${PROSPECT_UUID}`)
        .send({ triggerType: 'termination' })

      expect(response.status).toBe(500)
      expect(response.body.error).toBeTruthy()
    })
  })

  describe('GET /api/outreach/sequences/:prospectId', () => {
    it('returns 200 with sequences array', async () => {
      const sequences = [
        {
          id: 'seq-1',
          triggerType: 'termination',
          status: 'active',
          currentStep: 1,
          totalSteps: 3,
          createdAt: '2026-03-23T00:00:00.000Z'
        },
        {
          id: 'seq-2',
          triggerType: 'termination',
          status: 'pending',
          currentStep: 0,
          totalSteps: 3,
          createdAt: '2026-03-22T00:00:00.000Z'
        }
      ]
      mocks.mockGetActiveSequences.mockResolvedValue(sequences)

      const response = await request(app).get(`/api/outreach/sequences/${PROSPECT_UUID}`)

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ count: 2 })
      expect(response.body.sequences).toHaveLength(2)
    })

    it('returns empty array when no active sequences', async () => {
      mocks.mockGetActiveSequences.mockResolvedValue([])

      const response = await request(app).get(`/api/outreach/sequences/${PROSPECT_UUID}`)

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ count: 0, sequences: [] })
    })

    it('returns 500 on error', async () => {
      mocks.mockGetActiveSequences.mockRejectedValue(new Error('DB error'))

      const response = await request(app).get(`/api/outreach/sequences/${PROSPECT_UUID}`)

      expect(response.status).toBe(500)
      expect(response.body.error).toBeTruthy()
    })

    it('returns 400 for non-UUID prospectId', async () => {
      const response = await request(app).get('/api/outreach/sequences/not-a-uuid')

      expect(response.status).toBe(400)
    })
  })

  describe('POST /api/outreach/sequences/:id/cancel', () => {
    it('returns 200 with cancelled status', async () => {
      mocks.mockCancelSequence.mockResolvedValue(undefined)

      const response = await request(app).post(`/api/outreach/sequences/${SEQUENCE_UUID}/cancel`)

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ status: 'cancelled' })
      expect(mocks.mockCancelSequence).toHaveBeenCalledWith(SEQUENCE_UUID)
    })

    it('returns 500 on service error', async () => {
      mocks.mockCancelSequence.mockRejectedValue(new Error('Not found'))

      const response = await request(app).post(`/api/outreach/sequences/${SEQUENCE_UUID}/cancel`)

      expect(response.status).toBe(500)
      expect(response.body.error).toBeTruthy()
    })

    it('returns 400 for non-UUID sequence id', async () => {
      const response = await request(app).post('/api/outreach/sequences/not-a-uuid/cancel')

      expect(response.status).toBe(400)
    })
  })
})
