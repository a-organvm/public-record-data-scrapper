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

import outreachRouter from '../../routes/outreach'

const sampleBriefing = {
  prospectId: 'prospect-abc',
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
  })

  describe('GET /api/outreach/briefing/:prospectId', () => {
    it('returns 200 with cached briefing when cache is warm', async () => {
      mocks.mockGetCachedBriefing.mockResolvedValue(sampleBriefing)

      const response = await request(app).get('/api/outreach/briefing/prospect-abc')

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        prospectId: 'prospect-abc',
        companyName: 'Acme Corp'
      })
      expect(mocks.mockGenerateBriefing).not.toHaveBeenCalled()
    })

    it('generates fresh briefing when cache is empty', async () => {
      mocks.mockGetCachedBriefing.mockResolvedValue(null)
      mocks.mockGenerateBriefing.mockResolvedValue(sampleBriefing)

      const response = await request(app).get('/api/outreach/briefing/prospect-abc')

      expect(response.status).toBe(200)
      expect(mocks.mockGenerateBriefing).toHaveBeenCalledWith('prospect-abc')
      expect(response.body.companyName).toBe('Acme Corp')
    })

    it('returns 404 when prospect is not found', async () => {
      mocks.mockGetCachedBriefing.mockResolvedValue(null)
      mocks.mockGenerateBriefing.mockRejectedValue(new Error('Prospect not found: prospect-xyz'))

      const response = await request(app).get('/api/outreach/briefing/prospect-xyz')

      expect(response.status).toBe(404)
      expect(response.body).toMatchObject({ error: 'Prospect not found: prospect-xyz' })
    })

    it('returns 500 on unexpected error', async () => {
      mocks.mockGetCachedBriefing.mockRejectedValue(new Error('DB connection lost'))

      const response = await request(app).get('/api/outreach/briefing/prospect-abc')

      expect(response.status).toBe(500)
      expect(response.body).toMatchObject({ error: 'Failed to generate briefing' })
    })
  })

  describe('POST /api/outreach/trigger/:prospectId', () => {
    it('returns 201 with sequenceId when eligible', async () => {
      mocks.mockIsEligible.mockResolvedValue({ eligible: true })
      mocks.mockCreateSequence.mockResolvedValue('seq-new-123')

      const response = await request(app)
        .post('/api/outreach/trigger/prospect-abc')
        .send({ triggerType: 'termination', capacityScore: 80 })

      expect(response.status).toBe(201)
      expect(response.body).toMatchObject({ sequenceId: 'seq-new-123', status: 'created' })
    })

    it('returns 409 when prospect is not eligible', async () => {
      mocks.mockIsEligible.mockResolvedValue({
        eligible: false,
        reason: 'Active or recent sequence exists (cooldown 30 days)'
      })

      const response = await request(app)
        .post('/api/outreach/trigger/prospect-abc')
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
      mocks.mockCreateSequence.mockResolvedValue('seq-default')

      await request(app).post('/api/outreach/trigger/prospect-abc').send({})

      expect(mocks.mockIsEligible).toHaveBeenCalledWith('prospect-abc', 'termination', undefined)
    })

    it('returns 500 on unexpected error', async () => {
      mocks.mockIsEligible.mockRejectedValue(new Error('DB error'))

      const response = await request(app)
        .post('/api/outreach/trigger/prospect-abc')
        .send({ triggerType: 'termination' })

      expect(response.status).toBe(500)
      expect(response.body).toMatchObject({ error: 'Failed to trigger outreach' })
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

      const response = await request(app).get('/api/outreach/sequences/prospect-abc')

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ count: 2 })
      expect(response.body.sequences).toHaveLength(2)
    })

    it('returns empty array when no active sequences', async () => {
      mocks.mockGetActiveSequences.mockResolvedValue([])

      const response = await request(app).get('/api/outreach/sequences/prospect-abc')

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ count: 0, sequences: [] })
    })

    it('returns 500 on error', async () => {
      mocks.mockGetActiveSequences.mockRejectedValue(new Error('DB error'))

      const response = await request(app).get('/api/outreach/sequences/prospect-abc')

      expect(response.status).toBe(500)
      expect(response.body).toMatchObject({ error: 'Failed to get sequences' })
    })
  })

  describe('POST /api/outreach/sequences/:id/cancel', () => {
    it('returns 200 with cancelled status', async () => {
      mocks.mockCancelSequence.mockResolvedValue(undefined)

      const response = await request(app).post('/api/outreach/sequences/seq-123/cancel')

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ status: 'cancelled' })
      expect(mocks.mockCancelSequence).toHaveBeenCalledWith('seq-123')
    })

    it('returns 500 on error', async () => {
      mocks.mockCancelSequence.mockRejectedValue(new Error('Not found'))

      const response = await request(app).post('/api/outreach/sequences/seq-bad/cancel')

      expect(response.status).toBe(500)
      expect(response.body).toMatchObject({ error: 'Failed to cancel sequence' })
    })
  })
})
