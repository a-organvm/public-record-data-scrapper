import { describe, it, expect, vi, beforeEach } from 'vitest'
import express, { Express } from 'express'
import request from 'supertest'

// Mock before importing the router so the mock is in place when the module loads
vi.mock('@/queue/queues', () => ({
  getIngestionCoverageTelemetry: vi.fn()
}))

import { getIngestionCoverageTelemetry } from '@/queue/queues'
import statusRouter from '@/routes/status'

const mockGetIngestionCoverageTelemetry = vi.mocked(getIngestionCoverageTelemetry)

function buildTelemetry(
  state: string,
  overrides: Partial<ReturnType<typeof getIngestionCoverageTelemetry>[number]> = {}
): ReturnType<typeof getIngestionCoverageTelemetry>[number] {
  return {
    state,
    currentStatus: 'idle',
    lastJobId: null,
    lastQueuedAt: null,
    lastStartedAt: null,
    lastSuccessfulPull: null,
    lastFailedAt: null,
    lastError: null,
    lastRecordsProcessed: null,
    dataTier: null,
    uccProvider: null,
    queuedBy: null,
    currentStrategy: null,
    availableStrategies: [],
    circuitState: 'closed',
    circuitOpenedAt: null,
    circuitBackoffUntil: null,
    circuitTripCount: 0,
    escalationCount: 0,
    lastEscalatedAt: null,
    lastEscalationReason: null,
    successCount: 0,
    failureCount: 0,
    consecutiveFailures: 0,
    successes: [],
    failures: [],
    fallbacks: [],
    ...overrides
  }
}

describe('Status Route', () => {
  let app: Express

  beforeEach(() => {
    app = express()
    app.use(statusRouter)
    vi.clearAllMocks()
    mockGetIngestionCoverageTelemetry.mockReturnValue([])
  })

  describe('GET /status', () => {
    it('returns 200 with Content-Type text/html', async () => {
      const response = await request(app).get('/status')

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toMatch(/text\/html/)
    })

    it('includes auto-refresh meta tag', async () => {
      const response = await request(app).get('/status')

      expect(response.text).toContain('<meta http-equiv="refresh" content="60">')
    })

    it('includes the page title', async () => {
      const response = await request(app).get('/status')

      expect(response.text).toContain('UCC-MCA Coverage Status')
    })

    it('includes all high-value state codes', async () => {
      const response = await request(app).get('/status')

      expect(response.text).toContain('>CA<')
      expect(response.text).toContain('>TX<')
      expect(response.text).toContain('>FL<')
      expect(response.text).toContain('>NY<')
    })

    it('includes state grid for other states', async () => {
      const response = await request(app).get('/status')

      // Some states that are NOT high-value should appear
      expect(response.text).toContain('>AL<')
      expect(response.text).toContain('>WY<')
      expect(response.text).toContain('>DC<')
      // The grid container should be present
      expect(response.text).toContain('class="state-grid"')
    })

    it('shows green class for state with success and closed circuit', async () => {
      mockGetIngestionCoverageTelemetry.mockReturnValue([
        buildTelemetry('CA', {
          currentStatus: 'success',
          circuitState: 'closed',
          successCount: 5,
          consecutiveFailures: 0,
          lastSuccessfulPull: new Date(Date.now() - 3600000).toISOString()
        })
      ])

      const response = await request(app).get('/status')

      expect(response.text).toContain('status-green')
    })

    it('shows red class for state with consecutive failures >= 2', async () => {
      mockGetIngestionCoverageTelemetry.mockReturnValue([
        buildTelemetry('TX', {
          currentStatus: 'failed',
          circuitState: 'open',
          consecutiveFailures: 3,
          failureCount: 3,
          successCount: 0
        })
      ])

      const response = await request(app).get('/status')

      expect(response.text).toContain('status-red')
    })

    it('shows yellow class for state with success but non-closed circuit', async () => {
      mockGetIngestionCoverageTelemetry.mockReturnValue([
        buildTelemetry('FL', {
          currentStatus: 'success',
          circuitState: 'half-open',
          successCount: 2,
          failureCount: 1,
          consecutiveFailures: 0,
          lastSuccessfulPull: new Date(Date.now() - 7200000).toISOString()
        })
      ])

      const response = await request(app).get('/status')

      expect(response.text).toContain('status-yellow')
    })

    it('shows summary bar with green/yellow/red counts', async () => {
      const response = await request(app).get('/status')

      expect(response.text).toContain('summary-bar')
      expect(response.text).toContain('chip-green')
      expect(response.text).toContain('chip-yellow')
      expect(response.text).toContain('chip-red')
    })

    it('shows gray for states with no telemetry data', async () => {
      // No telemetry returned — all cards should have status-gray class
      mockGetIngestionCoverageTelemetry.mockReturnValue([])

      const response = await request(app).get('/status')

      // All cards should be gray
      expect(response.text).toContain('class="state-card card-small status-gray"')
      // No card should have status-green or status-red class
      expect(response.text).not.toContain('class="state-card card-small status-green"')
      expect(response.text).not.toContain('class="state-card card-small status-red"')
      expect(response.text).not.toContain('class="state-card card-large status-green"')
      expect(response.text).not.toContain('class="state-card card-large status-red"')
    })

    it('shows relative time for last pull timestamp', async () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()

      mockGetIngestionCoverageTelemetry.mockReturnValue([
        buildTelemetry('NY', {
          currentStatus: 'success',
          circuitState: 'closed',
          successCount: 1,
          lastSuccessfulPull: twoHoursAgo
        })
      ])

      const response = await request(app).get('/status')

      expect(response.text).toContain('h ago')
    })

    it('shows "Never" for states with no last pull', async () => {
      mockGetIngestionCoverageTelemetry.mockReturnValue([
        buildTelemetry('CA', {
          currentStatus: 'idle',
          lastSuccessfulPull: null
        })
      ])

      const response = await request(app).get('/status')

      expect(response.text).toContain('Never')
    })

    it('includes the high-value states section heading', async () => {
      const response = await request(app).get('/status')

      expect(response.text).toContain('High-Value States')
    })

    it('renders valid HTML with a doctype', async () => {
      const response = await request(app).get('/status')

      expect(response.text.trimStart()).toMatch(/^<!DOCTYPE html>/i)
    })
  })
})
