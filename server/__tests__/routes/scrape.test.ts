import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import express, { Express } from 'express'
import scrapeRouter from '../../routes/scrape'

// vi.hoisted ensures these are available when vi.mock factory functions run
const {
  mockSearch,
  mockGetStateReadiness,
  mockEnqueue,
  mockGet,
  mockMarkProcessing,
  mockMarkCompleted,
  mockMarkFailed
} = vi.hoisted(() => ({
  mockSearch: vi.fn(),
  mockGetStateReadiness: vi.fn(),
  mockEnqueue: vi.fn(),
  mockGet: vi.fn(),
  mockMarkProcessing: vi.fn(),
  mockMarkCompleted: vi.fn(),
  mockMarkFailed: vi.fn()
}))

// Use class syntax (Vitest 4 requires 'function' or 'class' for constructor mocks)
vi.mock('../../services/UCCSearchService', () => ({
  UCCSearchService: class MockUCCSearchService {
    search = mockSearch
    getStateReadiness = mockGetStateReadiness
  }
}))

vi.mock('../../services/ScrapeJobService', () => ({
  ScrapeJobService: class MockScrapeJobService {
    enqueue = mockEnqueue
    get = mockGet
    markProcessing = mockMarkProcessing
    markCompleted = mockMarkCompleted
    markFailed = mockMarkFailed
  }
}))

// A valid UUID v4 for job polling tests (Zod v4 requires proper version + variant bits)
const TEST_JOB_ID = '550e8400-e29b-41d4-a716-446655440000'

describe('POST /api/scrape/ucc', () => {
  let app: Express

  const buildTestApp = () => {
    const testApp = express()
    testApp.use(express.json())

    testApp.use((req, _res, next) => {
      ;(req as { user: { orgId: string; role: string } }).user = {
        orgId: 'test-org',
        role: 'user'
      }
      next()
    })

    testApp.use('/api/scrape', scrapeRouter)
    return testApp
  }

  beforeEach(() => {
    mockSearch.mockReset()
    mockGetStateReadiness.mockReset()
    mockGetStateReadiness.mockReturnValue({
      state: 'CA',
      canSearch: true,
      reason: 'Collector ready for state: CA'
    })
    app = buildTestApp()
  })

  it('returns 400 for missing required body fields', async () => {
    const response = await request(app).post('/api/scrape/ucc').send({ state: 'CA' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns an explicit unavailable-state error before searching', async () => {
    mockGetStateReadiness.mockReturnValue({
      state: 'XX',
      canSearch: false,
      reason: 'No UCC data available for state: XX'
    })

    const response = await request(app).post('/api/scrape/ucc').send({
      company_name: 'Test Corp',
      state: 'XX'
    })

    expect(response.status).toBe(400)
    expect(response.body.success).toBe(false)
    expect(response.body.error.code).toBe('UCC_STATE_UNAVAILABLE')
    expect(response.body.error.details).toMatchObject({ state: 'XX' })
    expect(response.body.error.details.readinessEndpoint).toBe('/api/scrape/readiness/XX')
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it('returns success for supported state requests', async () => {
    mockSearch.mockResolvedValue({
      filings: [],
      total: 0,
      state: 'CA',
      companyName: 'Test Corp',
      timestamp: '2026-06-24T00:00:00.000Z'
    })

    const response = await request(app).post('/api/scrape/ucc').send({
      company_name: 'Test Corp',
      state: 'ca',
      limit: 50
    })

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
    expect(response.body.data.state).toBe('CA')
    expect(mockSearch).toHaveBeenCalledWith({
      companyName: 'Test Corp',
      state: 'CA',
      limit: 50
    })
  })

  it('enforces state normalization before calling service methods', async () => {
    mockSearch.mockResolvedValue({
      filings: [],
      total: 0,
      state: 'CA',
      companyName: 'Test Corp',
      timestamp: '2026-06-24T00:00:00.000Z'
    })

    await request(app).post('/api/scrape/ucc').send({
      company_name: 'Test Corp',
      state: 'ca'
    })

    expect(mockGetStateReadiness).toHaveBeenCalledWith('CA')
    expect(mockSearch).toHaveBeenCalledWith({
      companyName: 'Test Corp',
      state: 'CA',
      limit: 100
    })
  })

  it('returns 401 when auth is missing', async () => {
    const noAuthApp = express()
    noAuthApp.use(express.json())
    noAuthApp.use('/api/scrape', scrapeRouter)

    const response = await request(noAuthApp).post('/api/scrape/ucc').send({
      company_name: 'Test Corp',
      state: 'CA'
    })

    expect(response.status).toBe(401)
    expect(response.body.error).toBe('Unauthorized')
    expect(mockGetStateReadiness).not.toHaveBeenCalled()
    expect(mockSearch).not.toHaveBeenCalled()
  })
})

describe('GET /api/scrape/readiness/:stateCode', () => {
  let app: Express

  const buildTestApp = () => {
    const testApp = express()
    testApp.use(express.json())

    testApp.use((req, _res, next) => {
      ;(req as { user: { orgId: string; role: string } }).user = {
        orgId: 'test-org',
        role: 'user'
      }
      next()
    })

    testApp.use('/api/scrape', scrapeRouter)
    return testApp
  }

  beforeEach(() => {
    mockGetStateReadiness.mockReset()
    mockGetStateReadiness.mockReturnValue({
      state: 'CA',
      canSearch: true,
      reason: 'Collector ready for state: CA'
    })
    app = buildTestApp()
  })

  it('returns availability for a supported state', async () => {
    const response = await request(app).get('/api/scrape/readiness/ca')

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
    expect(response.body.data).toMatchObject({
      state: 'CA',
      canSearch: true,
      reason: 'Collector ready for state: CA'
    })
    expect(mockGetStateReadiness).toHaveBeenCalledWith('CA')
  })

  it('returns blocked status for unavailable states', async () => {
    mockGetStateReadiness.mockReturnValue({
      state: 'XX',
      canSearch: false,
      reason: 'No UCC data available for state: XX'
    })

    const response = await request(app).get('/api/scrape/readiness/xx')

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
    expect(response.body.data).toMatchObject({
      state: 'XX',
      canSearch: false,
      reason: 'No UCC data available for state: XX'
    })
    expect(mockGetStateReadiness).toHaveBeenCalledWith('XX')
  })

  it('returns 400 for invalid state payload', async () => {
    const response = await request(app).get('/api/scrape/readiness/ABC')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns 401 when auth is missing', async () => {
    const noAuthApp = express()
    noAuthApp.use(express.json())
    noAuthApp.use('/api/scrape', scrapeRouter)

    const response = await request(noAuthApp).get('/api/scrape/readiness/ca')

    expect(response.status).toBe(401)
    expect(response.body.error).toBe('Unauthorized')
    expect(mockGetStateReadiness).not.toHaveBeenCalled()
  })
})

describe('POST /api/scrape/jobs', () => {
  let app: Express

  const buildTestApp = (userId = 'jwt-user') => {
    const testApp = express()
    testApp.use(express.json())
    testApp.use((req, _res, next) => {
      ;(req as { user: { id: string; orgId: string; role: string } }).user = {
        id: userId,
        orgId: 'test-org',
        role: 'user'
      }
      next()
    })
    testApp.use('/api/scrape', scrapeRouter)
    return testApp
  }

  const baseJob = {
    id: TEST_JOB_ID,
    orgId: 'test-org',
    apiKeyId: null,
    companyName: 'Acme Corp',
    state: 'CA',
    limit: 100,
    status: 'queued',
    result: null,
    error: null,
    queuedAt: '2026-06-26T00:00:00Z',
    startedAt: null,
    completedAt: null,
    expiresAt: '2026-07-03T00:00:00Z'
  }

  beforeEach(() => {
    mockGetStateReadiness.mockReset()
    mockEnqueue.mockReset()
    mockMarkProcessing.mockReset()
    mockMarkCompleted.mockReset()
    mockMarkFailed.mockReset()
    mockSearch.mockReset()

    mockGetStateReadiness.mockReturnValue({ state: 'CA', canSearch: true, reason: 'ok' })
    mockEnqueue.mockResolvedValue(baseJob)
    mockMarkProcessing.mockResolvedValue(undefined)
    mockMarkCompleted.mockResolvedValue(undefined)
    mockMarkFailed.mockResolvedValue(undefined)
    mockSearch.mockResolvedValue({
      filings: [],
      total: 0,
      state: 'CA',
      companyName: 'Acme Corp',
      timestamp: '2026-06-26T00:00:00Z'
    })

    app = buildTestApp()
  })

  it('returns 202 with jobId and pollUrl', async () => {
    const response = await request(app)
      .post('/api/scrape/jobs')
      .send({ company_name: 'Acme Corp', state: 'CA' })

    expect(response.status).toBe(202)
    expect(response.body.success).toBe(true)
    expect(response.body.data.jobId).toBe(TEST_JOB_ID)
    expect(response.body.data.status).toBe('queued')
    expect(response.body.data.pollUrl).toBe(`/api/scrape/jobs/${TEST_JOB_ID}`)
  })

  it('enqueues with null apiKeyId for JWT callers', async () => {
    await request(app)
      .post('/api/scrape/jobs')
      .send({ company_name: 'Acme Corp', state: 'CA' })

    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: null, orgId: 'test-org' })
    )
  })

  it('extracts apiKeyId from apikey: prefixed user id', async () => {
    app = buildTestApp('apikey:key-uuid-99')
    await request(app)
      .post('/api/scrape/jobs')
      .send({ company_name: 'Acme Corp', state: 'CA' })

    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'key-uuid-99' })
    )
  })

  it('returns 400 for an unavailable state before enqueueing', async () => {
    mockGetStateReadiness.mockReturnValue({ state: 'XX', canSearch: false, reason: 'no data' })

    const response = await request(app)
      .post('/api/scrape/jobs')
      .send({ company_name: 'Acme Corp', state: 'XX' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('UCC_STATE_UNAVAILABLE')
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('returns 400 for missing required fields', async () => {
    const response = await request(app)
      .post('/api/scrape/jobs')
      .send({ state: 'CA' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns 401 when auth is missing', async () => {
    const noAuthApp = express()
    noAuthApp.use(express.json())
    noAuthApp.use('/api/scrape', scrapeRouter)

    const response = await request(noAuthApp)
      .post('/api/scrape/jobs')
      .send({ company_name: 'Acme Corp', state: 'CA' })

    expect(response.status).toBe(401)
  })
})

describe('GET /api/scrape/jobs/:jobId', () => {
  let app: Express

  const buildTestApp = () => {
    const testApp = express()
    testApp.use(express.json())
    testApp.use((req, _res, next) => {
      ;(req as { user: { id: string; orgId: string; role: string } }).user = {
        id: 'jwt-user',
        orgId: 'test-org',
        role: 'user'
      }
      next()
    })
    testApp.use('/api/scrape', scrapeRouter)
    return testApp
  }

  beforeEach(() => {
    mockGet.mockReset()
    app = buildTestApp()
  })

  it('returns job status when found', async () => {
    mockGet.mockResolvedValue({
      id: TEST_JOB_ID,
      orgId: 'test-org',
      companyName: 'Acme Corp',
      state: 'CA',
      status: 'completed',
      result: { filings: [], total: 0, state: 'CA', companyName: 'Acme Corp', timestamp: '' },
      error: null,
      queuedAt: '2026-06-26T00:00:00Z',
      startedAt: '2026-06-26T00:00:01Z',
      completedAt: '2026-06-26T00:00:05Z'
    })

    const response = await request(app).get(`/api/scrape/jobs/${TEST_JOB_ID}`)

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
    expect(response.body.data.jobId).toBe(TEST_JOB_ID)
    expect(response.body.data.status).toBe('completed')
    expect(response.body.data.result).toBeDefined()
    expect(mockGet).toHaveBeenCalledWith(TEST_JOB_ID, 'test-org')
  })

  it('returns 404 when job not found or belongs to another org', async () => {
    mockGet.mockResolvedValue(null)

    const response = await request(app).get(`/api/scrape/jobs/${TEST_JOB_ID}`)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('JOB_NOT_FOUND')
  })

  it('returns 400 for a non-UUID jobId', async () => {
    const response = await request(app).get('/api/scrape/jobs/not-a-uuid')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns 401 when auth is missing', async () => {
    const noAuthApp = express()
    noAuthApp.use(express.json())
    noAuthApp.use('/api/scrape', scrapeRouter)

    const response = await request(noAuthApp).get(`/api/scrape/jobs/${TEST_JOB_ID}`)

    expect(response.status).toBe(401)
  })
})
