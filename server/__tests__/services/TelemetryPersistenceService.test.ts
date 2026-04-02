import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TelemetryPersistenceService } from '../../services/TelemetryPersistenceService'
import type { IngestionCoverageTelemetry } from '../../queue/queues'

// Provide a minimal in-module mock for the database connection so imports
// that transitively touch the singleton do not attempt a real connection.
vi.mock('../../database/connection', () => ({
  database: {
    query: vi.fn()
  }
}))

// Build a standalone mock DB that we inject directly into the service.
// This keeps the tests fully isolated from the module-level singleton.
const mockQuery = vi.fn()
const mockDb = { query: mockQuery }

function makeTelemetry(
  overrides: Partial<IngestionCoverageTelemetry> = {}
): IngestionCoverageTelemetry {
  return {
    state: 'CA',
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
    currentStrategy: 'api',
    availableStrategies: ['api'],
    circuitState: 'closed',
    circuitOpenedAt: null,
    circuitBackoffUntil: null,
    circuitTripCount: 0,
    escalationCount: 0,
    lastEscalatedAt: null,
    lastEscalationReason: null,
    successCount: 3,
    failureCount: 1,
    consecutiveFailures: 0,
    successes: [],
    failures: [],
    fallbacks: [],
    ...overrides
  }
}

describe('TelemetryPersistenceService', () => {
  let service: TelemetryPersistenceService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new TelemetryPersistenceService(mockDb)
  })

  // ─── persistState ─────────────────────────────────────────────────────────

  describe('persistState', () => {
    it('executes INSERT ... ON CONFLICT targeting ingestion_telemetry', async () => {
      mockQuery.mockResolvedValueOnce([])

      await service.persistState('CA', makeTelemetry())

      expect(mockQuery).toHaveBeenCalledOnce()
      const [sql] = mockQuery.mock.calls[0] as [string, unknown[]]

      expect(sql).toContain('ingestion_telemetry')
      expect(sql).toContain('ON CONFLICT')
      expect(sql).toContain('DO UPDATE SET')
    })

    it('passes stateCode as first parameter', async () => {
      mockQuery.mockResolvedValueOnce([])

      await service.persistState('TX', makeTelemetry({ state: 'TX' }))

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]]
      expect(params[0]).toBe('TX')
    })

    it('passes currentStatus as second parameter', async () => {
      mockQuery.mockResolvedValueOnce([])

      await service.persistState('CA', makeTelemetry({ currentStatus: 'running' }))

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]]
      expect(params[1]).toBe('running')
    })

    it('passes availableStrategies as JSON string', async () => {
      mockQuery.mockResolvedValueOnce([])
      const strategies = ['api', 'bulk'] as const

      await service.persistState('CA', makeTelemetry({ availableStrategies: [...strategies] }))

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]]
      const strategiesParam = params.find((p) => {
        try {
          return Array.isArray(JSON.parse(p as string))
        } catch {
          return false
        }
      })
      expect(strategiesParam).toBeDefined()
      expect(JSON.parse(strategiesParam as string)).toEqual(strategies)
    })

    it('passes successCount, failureCount, consecutiveFailures', async () => {
      mockQuery.mockResolvedValueOnce([])
      const telemetry = makeTelemetry({ successCount: 7, failureCount: 2, consecutiveFailures: 1 })

      await service.persistState('CA', telemetry)

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]]
      expect(params).toContain(7)
      expect(params).toContain(2)
      expect(params).toContain(1)
    })
  })

  // ─── hydrateAll ───────────────────────────────────────────────────────────

  describe('hydrateAll', () => {
    it('returns empty map when no rows exist', async () => {
      mockQuery.mockResolvedValueOnce([]) // ingestion_telemetry SELECT

      const result = await service.hydrateAll()

      expect(result).toBeInstanceOf(Map)
      expect(result.size).toBe(0)
      // Only one query should have been made (the top-level SELECT)
      expect(mockQuery).toHaveBeenCalledOnce()
    })

    it('returns a Map with one entry per state row', async () => {
      const telemetryRow = {
        state_code: 'CA',
        current_status: 'success',
        last_job_id: 'job-1',
        last_queued_at: null,
        last_started_at: null,
        last_successful_pull: '2024-01-01T00:00:00Z',
        last_failed_at: null,
        last_error: null,
        last_records_processed: 100,
        data_tier: null,
        ucc_provider: null,
        queued_by: null,
        current_strategy: 'api',
        available_strategies: JSON.stringify(['api']),
        circuit_state: 'closed',
        circuit_opened_at: null,
        circuit_backoff_until: null,
        circuit_trip_count: 0,
        escalation_count: 0,
        last_escalated_at: null,
        last_escalation_reason: null,
        success_count: 5,
        failure_count: 0,
        consecutive_failures: 0
      }

      // First call: main telemetry SELECT
      mockQuery.mockResolvedValueOnce([telemetryRow])
      // Three history queries per state: successes, failures, fallbacks
      mockQuery.mockResolvedValueOnce([
        { completed_at: '2024-01-01T00:00:00Z', records_processed: 42 }
      ])
      mockQuery.mockResolvedValueOnce([])
      mockQuery.mockResolvedValueOnce([])

      const result = await service.hydrateAll()

      expect(result.size).toBe(1)
      expect(result.has('CA')).toBe(true)

      const ca = result.get('CA')!
      expect(ca.state).toBe('CA')
      expect(ca.currentStatus).toBe('success')
      expect(ca.lastSuccessfulPull).toBe('2024-01-01T00:00:00Z')
      expect(ca.successCount).toBe(5)
      expect(ca.availableStrategies).toEqual(['api'])
    })

    it('populates successes, failures, and fallbacks arrays from history queries', async () => {
      const telemetryRow = {
        state_code: 'FL',
        current_status: 'failed',
        last_job_id: null,
        last_queued_at: null,
        last_started_at: null,
        last_successful_pull: null,
        last_failed_at: '2024-02-01T00:00:00Z',
        last_error: 'timeout',
        last_records_processed: null,
        data_tier: null,
        ucc_provider: null,
        queued_by: null,
        current_strategy: 'vendor',
        available_strategies: ['vendor'],
        circuit_state: 'open',
        circuit_opened_at: '2024-02-01T00:00:00Z',
        circuit_backoff_until: '2024-02-01T00:10:00Z',
        circuit_trip_count: 1,
        escalation_count: 1,
        last_escalated_at: '2024-02-01T00:00:00Z',
        last_escalation_reason: 'timeout',
        success_count: 0,
        failure_count: 2,
        consecutive_failures: 2
      }

      mockQuery.mockResolvedValueOnce([telemetryRow])
      // successes
      mockQuery.mockResolvedValueOnce([])
      // failures
      mockQuery.mockResolvedValueOnce([
        { failed_at: '2024-02-01T00:00:00Z', error: 'timeout' },
        { failed_at: '2024-01-31T00:00:00Z', error: 'connection refused' }
      ])
      // fallbacks
      mockQuery.mockResolvedValueOnce([
        {
          escalated_at: '2024-02-01T00:00:00Z',
          from_strategy: 'api',
          to_strategy: 'vendor',
          reason: 'timeout',
          delay_ms: 2000
        }
      ])

      const result = await service.hydrateAll()
      const fl = result.get('FL')!

      expect(fl.successes).toHaveLength(0)
      expect(fl.failures).toHaveLength(2)
      expect(fl.failures[0].failedAt).toBe('2024-02-01T00:00:00Z')
      expect(fl.failures[0].error).toBe('timeout')
      expect(fl.fallbacks).toHaveLength(1)
      expect(fl.fallbacks[0].fromStrategy).toBe('api')
      expect(fl.fallbacks[0].toStrategy).toBe('vendor')
    })

    it('queries successes, failures, and fallbacks tables for each state', async () => {
      const telemetryRow = {
        state_code: 'NY',
        current_status: 'idle',
        last_job_id: null,
        last_queued_at: null,
        last_started_at: null,
        last_successful_pull: null,
        last_failed_at: null,
        last_error: null,
        last_records_processed: null,
        data_tier: null,
        ucc_provider: null,
        queued_by: null,
        current_strategy: null,
        available_strategies: null,
        circuit_state: 'closed',
        circuit_opened_at: null,
        circuit_backoff_until: null,
        circuit_trip_count: 0,
        escalation_count: 0,
        last_escalated_at: null,
        last_escalation_reason: null,
        success_count: 0,
        failure_count: 0,
        consecutive_failures: 0
      }

      mockQuery.mockResolvedValue([])
      mockQuery.mockResolvedValueOnce([telemetryRow]) // main SELECT

      await service.hydrateAll()

      // Should have made 4 queries: 1 main + 3 history
      expect(mockQuery).toHaveBeenCalledTimes(4)

      const allSqls = mockQuery.mock.calls.map(([sql]) => sql as string)
      expect(allSqls.some((s) => s.includes('ingestion_successes'))).toBe(true)
      expect(allSqls.some((s) => s.includes('ingestion_failures'))).toBe(true)
      expect(allSqls.some((s) => s.includes('ingestion_fallbacks'))).toBe(true)
    })

    it('passes the configured history limit into batched history queries', async () => {
      const telemetryRow = {
        state_code: 'CA',
        current_status: 'idle',
        last_job_id: null,
        last_queued_at: null,
        last_started_at: null,
        last_successful_pull: null,
        last_failed_at: null,
        last_error: null,
        last_records_processed: null,
        data_tier: null,
        ucc_provider: null,
        queued_by: null,
        current_strategy: null,
        available_strategies: null,
        circuit_state: 'closed',
        circuit_opened_at: null,
        circuit_backoff_until: null,
        circuit_trip_count: 0,
        escalation_count: 0,
        last_escalated_at: null,
        last_escalation_reason: null,
        success_count: 0,
        failure_count: 0,
        consecutive_failures: 0
      }

      mockQuery.mockResolvedValueOnce([telemetryRow])
      mockQuery.mockResolvedValueOnce([])
      mockQuery.mockResolvedValueOnce([])
      mockQuery.mockResolvedValueOnce([])

      await service.hydrateAll({ historyLimitPerState: 7 })

      const historyParams = mockQuery.mock.calls.slice(1).map(([, params]) => params as unknown[])
      expect(historyParams).toHaveLength(3)
      expect(historyParams.every((params) => params[1] === 7)).toBe(true)
    })
  })

  // ─── recordSuccess ────────────────────────────────────────────────────────

  describe('recordSuccess', () => {
    it('inserts into ingestion_successes', async () => {
      mockQuery.mockResolvedValueOnce([])

      await service.recordSuccess('CA', '2024-01-01T00:00:00Z', 50, 'api', 1200)

      expect(mockQuery).toHaveBeenCalledOnce()
      const [sql] = mockQuery.mock.calls[0] as [string, unknown[]]

      expect(sql).toContain('ingestion_successes')
      expect(sql).toContain('INSERT')
    })

    it('passes stateCode, completedAt, recordsProcessed in order', async () => {
      mockQuery.mockResolvedValueOnce([])

      await service.recordSuccess('TX', '2024-03-01T12:00:00Z', 99, 'bulk', 800)

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]]
      expect(params[0]).toBe('TX')
      expect(params[1]).toBe('2024-03-01T12:00:00Z')
      expect(params[2]).toBe(99)
    })

    it('passes strategy and durationMs', async () => {
      mockQuery.mockResolvedValueOnce([])

      await service.recordSuccess('CA', '2024-01-01T00:00:00Z', 10, 'scrape', 3000)

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]]
      expect(params).toContain('scrape')
      expect(params).toContain(3000)
    })

    it('uses null for optional params when omitted', async () => {
      mockQuery.mockResolvedValueOnce([])

      await service.recordSuccess('CA', '2024-01-01T00:00:00Z', 5)

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]]
      // strategy and durationMs should be null
      expect(params[3]).toBeNull()
      expect(params[4]).toBeNull()
    })
  })

  // ─── recordFailure ────────────────────────────────────────────────────────

  describe('recordFailure', () => {
    it('inserts into ingestion_failures', async () => {
      mockQuery.mockResolvedValueOnce([])

      await service.recordFailure('FL', '2024-01-01T00:00:00Z', 'connection timeout', 'vendor')

      expect(mockQuery).toHaveBeenCalledOnce()
      const [sql] = mockQuery.mock.calls[0] as [string, unknown[]]

      expect(sql).toContain('ingestion_failures')
      expect(sql).toContain('INSERT')
    })

    it('passes stateCode, failedAt, error in order', async () => {
      mockQuery.mockResolvedValueOnce([])

      await service.recordFailure('NY', '2024-06-15T09:00:00Z', 'rate limit exceeded')

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]]
      expect(params[0]).toBe('NY')
      expect(params[1]).toBe('2024-06-15T09:00:00Z')
      expect(params[2]).toBe('rate limit exceeded')
    })

    it('uses null for strategy when omitted', async () => {
      mockQuery.mockResolvedValueOnce([])

      await service.recordFailure('CA', '2024-01-01T00:00:00Z', 'error')

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]]
      expect(params[3]).toBeNull()
    })
  })

  // ─── recordFallback ───────────────────────────────────────────────────────

  describe('recordFallback', () => {
    it('inserts into ingestion_fallbacks', async () => {
      mockQuery.mockResolvedValueOnce([])

      await service.recordFallback('CA', '2024-01-01T00:00:00Z', 'api', 'bulk', 'api timeout', 4000)

      expect(mockQuery).toHaveBeenCalledOnce()
      const [sql] = mockQuery.mock.calls[0] as [string, unknown[]]

      expect(sql).toContain('ingestion_fallbacks')
      expect(sql).toContain('INSERT')
    })

    it('passes stateCode, escalatedAt, fromStrategy, toStrategy, reason in order', async () => {
      mockQuery.mockResolvedValueOnce([])

      await service.recordFallback(
        'TX',
        '2024-05-01T08:00:00Z',
        'bulk',
        'scrape',
        'bulk unavailable'
      )

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]]
      expect(params[0]).toBe('TX')
      expect(params[1]).toBe('2024-05-01T08:00:00Z')
      expect(params[2]).toBe('bulk')
      expect(params[3]).toBe('scrape')
      expect(params[4]).toBe('bulk unavailable')
    })

    it('accepts null fromStrategy', async () => {
      mockQuery.mockResolvedValueOnce([])

      await service.recordFallback('CA', '2024-01-01T00:00:00Z', null, 'api', 'cold start')

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]]
      expect(params[2]).toBeNull()
    })

    it('defaults delayMs to 0 when omitted', async () => {
      mockQuery.mockResolvedValueOnce([])

      await service.recordFallback('CA', '2024-01-01T00:00:00Z', 'api', 'bulk', 'reason')

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]]
      expect(params[5]).toBe(0)
    })
  })

  // ─── pruneHistory ─────────────────────────────────────────────────────────

  describe('pruneHistory', () => {
    it('executes DELETE against all three history tables', async () => {
      mockQuery.mockResolvedValue([{ deleted: 0 }])

      await service.pruneHistory()

      expect(mockQuery).toHaveBeenCalledTimes(3)
      const sqls = mockQuery.mock.calls.map(([sql]) => sql as string)

      expect(sqls.some((s) => s.includes('ingestion_successes'))).toBe(true)
      expect(sqls.some((s) => s.includes('ingestion_failures'))).toBe(true)
      expect(sqls.some((s) => s.includes('ingestion_fallbacks'))).toBe(true)
    })

    it('returns total deleted count summed across all three tables', async () => {
      mockQuery
        .mockResolvedValueOnce([{ deleted: 5 }]) // successes
        .mockResolvedValueOnce([{ deleted: 3 }]) // failures
        .mockResolvedValueOnce([{ deleted: 2 }]) // fallbacks

      const result = await service.pruneHistory()

      expect(result.deleted).toBe(10)
    })

    it('uses default 30-day retention when called without args', async () => {
      mockQuery.mockResolvedValue([{ deleted: 0 }])

      await service.pruneHistory()

      const params = mockQuery.mock.calls.map(([, p]) => p as unknown[])
      // Each call should pass '30 days' interval
      for (const p of params) {
        expect(p[0]).toBe('30 days')
      }
    })

    it('uses custom retention period when provided', async () => {
      mockQuery.mockResolvedValue([{ deleted: 0 }])

      await service.pruneHistory(7)

      const params = mockQuery.mock.calls.map(([, p]) => p as unknown[])
      for (const p of params) {
        expect(p[0]).toBe('7 days')
      }
    })

    it('returns 0 when no rows are deleted', async () => {
      mockQuery.mockResolvedValue([{ deleted: 0 }])

      const result = await service.pruneHistory()

      expect(result.deleted).toBe(0)
    })
  })
})
