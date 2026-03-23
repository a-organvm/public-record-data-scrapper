/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi, MockInstance } from 'vitest'

// Check if bullmq is available
let bullmqAvailable = false
try {
  require.resolve('bullmq')
  bullmqAvailable = true
} catch {
  bullmqAvailable = false
}

const describeConditional = bullmqAvailable ? describe : describe.skip

// Hoisted mocks
const mocks = vi.hoisted(() => {
  const mockQueueAdd = vi.fn().mockResolvedValue({ id: 'test-job-id' })

  return {
    mockQueueAdd,
    mockIngestionQueue: { add: mockQueueAdd, name: 'ucc-ingestion' },
    mockEnrichmentQueue: { add: mockQueueAdd, name: 'data-enrichment' },
    mockHealthScoreQueue: { add: mockQueueAdd, name: 'health-scores' },
    mockPortalProbeQueue: { add: mockQueueAdd, name: 'portal-health-probes' },
    mockDigestQueue: { add: mockQueueAdd, name: 'coverage-digest' },
    mockDatabaseQuery: vi.fn(),
    mockRecordIngestionQueued: vi.fn(),
    mockGetIngestionCircuitGate: vi.fn(() => ({
      allowed: true,
      circuitState: 'closed',
      backoffUntil: null,
      reason: null
    })),
    mockResolvePrimaryIngestionStrategy: vi.fn((state: string) => {
      if (state === 'CA') return 'api'
      if (state === 'TX') return 'bulk'
      if (state === 'FL') return 'vendor'
      return null
    }),
    mockResolveStateIngestionStrategyChain: vi.fn((state: string) => {
      if (state === 'CA') return ['api']
      if (state === 'TX') return ['bulk']
      if (state === 'FL') return ['vendor']
      return []
    })
  }
})

vi.mock('../../queue/queues', () => ({
  getIngestionQueue: vi.fn(() => mocks.mockIngestionQueue),
  getEnrichmentQueue: vi.fn(() => mocks.mockEnrichmentQueue),
  getHealthScoreQueue: vi.fn(() => mocks.mockHealthScoreQueue),
  getPortalProbeQueue: vi.fn(() => mocks.mockPortalProbeQueue),
  getDigestQueue: vi.fn(() => mocks.mockDigestQueue),
  getIngestionCircuitGate: mocks.mockGetIngestionCircuitGate,
  recordIngestionQueued: mocks.mockRecordIngestionQueued,
  resolvePrimaryIngestionStrategy: mocks.mockResolvePrimaryIngestionStrategy,
  resolveStateIngestionStrategyChain: mocks.mockResolveStateIngestionStrategyChain
}))

vi.mock('../../database/connection', () => ({
  database: {
    query: mocks.mockDatabaseQuery
  }
}))

describeConditional('JobScheduler', () => {
  let consoleSpy: MockInstance
  let consoleErrorSpy: MockInstance

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.resetModules()
    mocks.mockDatabaseQuery.mockReset()
    mocks.mockQueueAdd.mockReset().mockResolvedValue({ id: 'test-job-id' })
    mocks.mockRecordIngestionQueued.mockReset()
    mocks.mockGetIngestionCircuitGate.mockReset().mockReturnValue({
      allowed: true,
      circuitState: 'closed',
      backoffUntil: null,
      reason: null
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    consoleSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    vi.resetModules()
  })

  describe('start', () => {
    it('should log startup message', async () => {
      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await scheduler.start()
      scheduler.stop()

      expect(consoleSpy).toHaveBeenCalledWith('Starting job scheduler...')
      expect(consoleSpy).toHaveBeenCalledWith('✓ Job scheduler started')
    })

    it('should schedule UCC ingestion daily at 2:00 AM', async () => {
      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await scheduler.start()

      // Should log the scheduled time for ucc-ingestion
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/Scheduled ucc-ingestion for/))

      scheduler.stop()
    })

    it('should schedule enrichment refresh every 6 hours', async () => {
      mocks.mockDatabaseQuery.mockResolvedValue([])

      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await scheduler.start()

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Scheduled enrichment-refresh to run every 360 minutes/)
      )

      scheduler.stop()
    })

    it('should schedule health score updates every 12 hours', async () => {
      mocks.mockDatabaseQuery.mockResolvedValue([{ count: '0' }])

      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await scheduler.start()

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Scheduled health-scores to run every 720 minutes/)
      )

      scheduler.stop()
    })

    it('should run interval jobs immediately on start', async () => {
      mocks.mockDatabaseQuery.mockResolvedValue([])

      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await scheduler.start()

      // Enrichment refresh runs immediately
      expect(mocks.mockDatabaseQuery).toHaveBeenCalled()

      scheduler.stop()
    })
  })

  describe('stop', () => {
    it('should clear all scheduled jobs', async () => {
      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await scheduler.start()
      scheduler.stop()

      expect(consoleSpy).toHaveBeenCalledWith('Stopping job scheduler...')
      expect(consoleSpy).toHaveBeenCalledWith('✓ Job scheduler stopped')
    })

    it('should log each stopped job', async () => {
      mocks.mockDatabaseQuery.mockResolvedValue([])

      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await scheduler.start()
      scheduler.stop()

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/Stopped ucc-ingestion/))
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/Stopped enrichment-refresh/))
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/Stopped health-scores/))
    })
  })

  describe('scheduleUCCIngestion', () => {
    it('should queue ingestion jobs only for supported states', async () => {
      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      // Access private method via type casting for testing
      await (scheduler as any).scheduleUCCIngestion()

      expect(mocks.mockQueueAdd).toHaveBeenCalledTimes(3)
    })

    it('should queue jobs with correct supported state codes', async () => {
      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await (scheduler as any).scheduleUCCIngestion()

      const expectedStates = ['CA', 'TX', 'FL']

      expectedStates.forEach((state) => {
        expect(mocks.mockQueueAdd).toHaveBeenCalledWith(
          `ingest-${state}`,
          expect.objectContaining({ state, batchSize: 1000 }),
          expect.objectContaining({ priority: 1, attempts: 1, removeOnComplete: true })
        )
      })
    })

    it('should set priority 1 for ingestion jobs', async () => {
      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await (scheduler as any).scheduleUCCIngestion()

      expect(mocks.mockQueueAdd).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ priority: 1 })
      )
    })

    it('should log the number of states being queued', async () => {
      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await (scheduler as any).scheduleUCCIngestion()

      expect(consoleSpy).toHaveBeenCalledWith('[Scheduler] Queueing UCC ingestion for 10 states')
      expect(consoleSpy).toHaveBeenCalledWith('[Scheduler] Queued 3 ingestion jobs')
    })

    it('records telemetry when jobs are queued', async () => {
      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await (scheduler as any).scheduleUCCIngestion()

      expect(mocks.mockRecordIngestionQueued).toHaveBeenCalledTimes(3)
      expect(mocks.mockRecordIngestionQueued).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'CA',
          jobId: 'test-job-id',
          strategy: 'api',
          queuedBy: 'scheduler'
        })
      )
    })

    it('logs skipped states that do not have a production strategy', async () => {
      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await (scheduler as any).scheduleUCCIngestion()

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Scheduler] Skipping NY because no production ingestion strategy is configured'
      )
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Scheduler] Skipping IL because no production ingestion strategy is configured'
      )
    })

    it('skips states with an open circuit', async () => {
      mocks.mockGetIngestionCircuitGate.mockImplementation((state: string) =>
        state === 'TX'
          ? {
              allowed: false,
              circuitState: 'open',
              backoffUntil: '2026-03-23T16:00:00.000Z',
              reason: 'Escalating from bulk to scrape after timeout'
            }
          : {
              allowed: true,
              circuitState: 'closed',
              backoffUntil: null,
              reason: null
            }
      )

      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await (scheduler as any).scheduleUCCIngestion()

      expect(mocks.mockQueueAdd).toHaveBeenCalledTimes(2)
      expect(mocks.mockQueueAdd).not.toHaveBeenCalledWith(
        'ingest-TX',
        expect.anything(),
        expect.anything()
      )
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Scheduler] Skipping TX because circuit is open until 2026-03-23T16:00:00.000Z'
      )
    })
  })

  describe('scheduleEnrichmentRefresh', () => {
    it('should skip if no prospects need enrichment', async () => {
      mocks.mockDatabaseQuery.mockResolvedValue([])

      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await (scheduler as any).scheduleEnrichmentRefresh()

      expect(consoleSpy).toHaveBeenCalledWith('[Scheduler] No prospects need enrichment')
      expect(mocks.mockQueueAdd).not.toHaveBeenCalled()
    })

    it('should query for prospects with null or stale enrichment', async () => {
      mocks.mockDatabaseQuery.mockResolvedValue([])

      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await (scheduler as any).scheduleEnrichmentRefresh()

      expect(mocks.mockDatabaseQuery).toHaveBeenCalledWith(
        expect.stringContaining('last_enriched_at IS NULL')
      )
      expect(mocks.mockDatabaseQuery).toHaveBeenCalledWith(
        expect.stringContaining("INTERVAL '7 days'")
      )
    })

    it('should batch prospects into groups of 50', async () => {
      // 120 prospects should create 3 batches (50, 50, 20)
      const mockProspects = Array.from({ length: 120 }, (_, i) => ({ id: `id-${i}` }))
      mocks.mockDatabaseQuery.mockResolvedValue(mockProspects)

      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await (scheduler as any).scheduleEnrichmentRefresh()

      expect(mocks.mockQueueAdd).toHaveBeenCalledTimes(3)
    })

    it('should include correct prospect IDs in each batch', async () => {
      const mockProspects = Array.from({ length: 55 }, (_, i) => ({ id: `id-${i}` }))
      mocks.mockDatabaseQuery.mockResolvedValue(mockProspects)

      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await (scheduler as any).scheduleEnrichmentRefresh()

      // First batch should have 50 IDs
      expect(mocks.mockQueueAdd).toHaveBeenCalledWith(
        'enrich-batch-0',
        expect.objectContaining({
          prospectIds: expect.arrayContaining(['id-0', 'id-49'])
        }),
        expect.any(Object)
      )

      // Second batch should have 5 IDs
      expect(mocks.mockQueueAdd).toHaveBeenCalledWith(
        'enrich-batch-1',
        expect.objectContaining({
          prospectIds: expect.arrayContaining(['id-50', 'id-54'])
        }),
        expect.any(Object)
      )
    })

    it('should set force: false for enrichment jobs', async () => {
      mocks.mockDatabaseQuery.mockResolvedValue([{ id: 'test-id' }])

      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await (scheduler as any).scheduleEnrichmentRefresh()

      expect(mocks.mockQueueAdd).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ force: false }),
        expect.any(Object)
      )
    })

    it('should set priority 2 for enrichment jobs', async () => {
      mocks.mockDatabaseQuery.mockResolvedValue([{ id: 'test-id' }])

      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await (scheduler as any).scheduleEnrichmentRefresh()

      expect(mocks.mockQueueAdd).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ priority: 2 })
      )
    })
  })

  describe('scheduleHealthScoreUpdates', () => {
    it('should skip if no companies need updates', async () => {
      mocks.mockDatabaseQuery.mockResolvedValue([{ count: '0' }])

      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await (scheduler as any).scheduleHealthScoreUpdates()

      expect(consoleSpy).toHaveBeenCalledWith('[Scheduler] No companies need health score updates')
      expect(mocks.mockQueueAdd).not.toHaveBeenCalled()
    })

    it('should query for stale or null health scores', async () => {
      mocks.mockDatabaseQuery.mockResolvedValue([{ count: '0' }])

      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await (scheduler as any).scheduleHealthScoreUpdates()

      expect(mocks.mockDatabaseQuery).toHaveBeenCalledWith(
        expect.stringContaining("INTERVAL '12 hours'")
      )
      expect(mocks.mockDatabaseQuery).toHaveBeenCalledWith(
        expect.stringContaining('current_health_score IS NULL')
      )
    })

    it('should create batches of 50 companies', async () => {
      // 125 companies should create 3 batches
      mocks.mockDatabaseQuery.mockResolvedValue([{ count: '125' }])

      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await (scheduler as any).scheduleHealthScoreUpdates()

      expect(mocks.mockQueueAdd).toHaveBeenCalledTimes(3)
    })

    it('should set priority 3 for health score jobs', async () => {
      mocks.mockDatabaseQuery.mockResolvedValue([{ count: '10' }])

      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await (scheduler as any).scheduleHealthScoreUpdates()

      expect(mocks.mockQueueAdd).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ priority: 3 })
      )
    })

    it('should handle missing count result', async () => {
      mocks.mockDatabaseQuery.mockResolvedValue([])

      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await (scheduler as any).scheduleHealthScoreUpdates()

      expect(consoleSpy).toHaveBeenCalledWith('[Scheduler] No companies need health score updates')
    })
  })

  describe('scheduleDaily', () => {
    it('should calculate time until next scheduled time', async () => {
      // Set current time to 1:00 AM (before 2:00 AM)
      vi.setSystemTime(new Date('2024-01-15T01:00:00'))

      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await scheduler.start()

      // Should be scheduled for today at 2:00 AM (1 hour = 60 minutes)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Scheduled ucc-ingestion.*in 60 minutes/)
      )

      scheduler.stop()
    })

    it('should schedule for next day if time has passed', async () => {
      // Set current time to 3:00 AM (after 2:00 AM)
      vi.setSystemTime(new Date('2024-01-15T03:00:00'))

      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await scheduler.start()

      // Should be scheduled for tomorrow at 2:00 AM (23 hours)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Scheduled ucc-ingestion.*in \d+ minutes/)
      )

      scheduler.stop()
    })

    it('should reschedule after job completes', async () => {
      vi.setSystemTime(new Date('2024-01-15T01:59:59'))

      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await scheduler.start()

      // Fast-forward 1 second to trigger the job
      await vi.advanceTimersByTimeAsync(1000)

      // Should have been called and rescheduled
      expect(mocks.mockQueueAdd).toHaveBeenCalled()

      scheduler.stop()
    })

    it('should handle callback errors without stopping scheduler', async () => {
      mocks.mockQueueAdd.mockRejectedValueOnce(new Error('Queue error'))

      vi.setSystemTime(new Date('2024-01-15T01:59:59'))

      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await scheduler.start()

      // Fast-forward to trigger job
      await vi.advanceTimersByTimeAsync(1000)

      // Error should be logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Scheduler] Error in ucc-ingestion:',
        expect.any(Error)
      )

      scheduler.stop()
    })
  })

  describe('scheduleInterval', () => {
    it('should run callback immediately', async () => {
      mocks.mockDatabaseQuery.mockResolvedValue([])

      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await scheduler.start()

      // Should have queried database immediately for enrichment
      expect(mocks.mockDatabaseQuery).toHaveBeenCalled()

      scheduler.stop()
    })

    it('should run callback again after interval', async () => {
      mocks.mockDatabaseQuery.mockResolvedValue([])

      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      await scheduler.start()

      const initialCallCount = mocks.mockDatabaseQuery.mock.calls.length

      // Fast-forward 6 hours
      await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000)

      expect(mocks.mockDatabaseQuery.mock.calls.length).toBeGreaterThan(initialCallCount)

      scheduler.stop()
    })

    it('should handle immediate callback errors', async () => {
      mocks.mockDatabaseQuery.mockRejectedValue(new Error('DB error'))

      const { JobScheduler } = await import('../../queue/scheduler')
      const scheduler = new JobScheduler()

      // Start the scheduler (this triggers immediate callbacks)
      await scheduler.start()

      // The immediate callback is async - let the microtask queue flush
      await vi.advanceTimersByTimeAsync(1)

      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Scheduler] Error in enrichment-refresh:',
        expect.any(Error)
      )

      scheduler.stop()
    })
  })

  describe('singleton instance', () => {
    it('should export jobScheduler singleton', async () => {
      const { jobScheduler } = await import('../../queue/scheduler')

      expect(jobScheduler).toBeDefined()
      expect(typeof jobScheduler.start).toBe('function')
      expect(typeof jobScheduler.stop).toBe('function')
    })
  })
})

// Dependency check test
describe('Scheduler Tests - Dependency Check', () => {
  it.skipIf(!bullmqAvailable)('should run when bullmq is installed', () => {
    expect(true).toBe(true)
  })

  it.skipIf(bullmqAvailable)('skips tests because bullmq is not installed', () => {
    console.log('Scheduler tests skipped: bullmq package not installed')
    expect(true).toBe(true)
  })
})
