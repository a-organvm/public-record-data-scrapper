import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Check if bullmq is available
let bullmqAvailable = false
try {
  require.resolve('bullmq')
  bullmqAvailable = true
} catch {
  bullmqAvailable = false
}

// Skip all tests if bullmq is not installed
const describeConditional = bullmqAvailable ? describe : describe.skip

// Create hoisted mocks
const mocks = vi.hoisted(() => {
  const mockQueueClose = vi.fn().mockResolvedValue(undefined)
  const mockQueueAdd = vi.fn().mockResolvedValue({ id: 'test-job-id' })
  const instances: Array<{ name: string; opts: Record<string, unknown> }> = []

  class MockQueue {
    name: string
    opts: Record<string, unknown>
    close = mockQueueClose
    add = mockQueueAdd

    constructor(name: string, opts: Record<string, unknown>) {
      this.name = name
      this.opts = opts
      instances.push(this)
    }
  }

  const mockClient = { isReady: true }

  return {
    MockQueue,
    mockQueueClose,
    mockQueueAdd,
    instances,
    mockClient,
    resetInstances: () => {
      instances.length = 0
    }
  }
})

vi.mock('bullmq', () => ({
  Queue: mocks.MockQueue
}))

vi.mock('../../queue/connection', () => ({
  redisConnection: {
    connect: vi.fn().mockReturnValue({ client: mocks.mockClient, subscriber: {} })
  }
}))

describeConditional('Queue Initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resetInstances()
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
  })

  describe('initializeQueues', () => {
    it('should create three queues with correct names', async () => {
      const { initializeQueues } = await import('../../queue/queues')

      const queues = initializeQueues()

      expect(mocks.instances.length).toBe(3)
      expect(queues.ingestionQueue.name).toBe('ucc-ingestion')
      expect(queues.enrichmentQueue.name).toBe('data-enrichment')
      expect(queues.healthScoreQueue.name).toBe('health-scores')
    })

    it('should configure queues with default job options', async () => {
      const { initializeQueues } = await import('../../queue/queues')

      const queues = initializeQueues()

      const expectedOptions = {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        },
        removeOnComplete: {
          count: 100,
          age: 7 * 24 * 60 * 60
        },
        removeOnFail: {
          count: 500,
          age: 30 * 24 * 60 * 60
        }
      }

      expect(queues.ingestionQueue.opts).toMatchObject({
        defaultJobOptions: expectedOptions
      })
    })

    it('should connect to Redis when initializing queues', async () => {
      const { redisConnection } = await import('../../queue/connection')
      const { initializeQueues } = await import('../../queue/queues')

      initializeQueues()

      expect(redisConnection.connect).toHaveBeenCalled()
    })

    it('should use the same connection for all queues', async () => {
      const { initializeQueues } = await import('../../queue/queues')

      const queues = initializeQueues()

      expect(queues.ingestionQueue.opts.connection).toBe(mocks.mockClient)
      expect(queues.enrichmentQueue.opts.connection).toBe(mocks.mockClient)
      expect(queues.healthScoreQueue.opts.connection).toBe(mocks.mockClient)
    })
  })

  describe('getIngestionQueue', () => {
    it('should return ingestion queue when initialized', async () => {
      const { initializeQueues, getIngestionQueue } = await import('../../queue/queues')

      initializeQueues()
      const queue = getIngestionQueue()

      expect(queue.name).toBe('ucc-ingestion')
    })

    it('should throw error when queue not initialized', async () => {
      const { getIngestionQueue } = await import('../../queue/queues')

      expect(() => getIngestionQueue()).toThrow(
        'Ingestion queue not initialized. Call initializeQueues() first.'
      )
    })
  })

  describe('getEnrichmentQueue', () => {
    it('should return enrichment queue when initialized', async () => {
      const { initializeQueues, getEnrichmentQueue } = await import('../../queue/queues')

      initializeQueues()
      const queue = getEnrichmentQueue()

      expect(queue.name).toBe('data-enrichment')
    })

    it('should throw error when queue not initialized', async () => {
      const { getEnrichmentQueue } = await import('../../queue/queues')

      expect(() => getEnrichmentQueue()).toThrow(
        'Enrichment queue not initialized. Call initializeQueues() first.'
      )
    })
  })

  describe('getHealthScoreQueue', () => {
    it('should return health score queue when initialized', async () => {
      const { initializeQueues, getHealthScoreQueue } = await import('../../queue/queues')

      initializeQueues()
      const queue = getHealthScoreQueue()

      expect(queue.name).toBe('health-scores')
    })

    it('should throw error when queue not initialized', async () => {
      const { getHealthScoreQueue } = await import('../../queue/queues')

      expect(() => getHealthScoreQueue()).toThrow(
        'Health score queue not initialized. Call initializeQueues() first.'
      )
    })
  })

  describe('closeQueues', () => {
    it('should close all queues', async () => {
      const { initializeQueues, closeQueues } = await import('../../queue/queues')

      initializeQueues()
      await closeQueues()

      expect(mocks.mockQueueClose).toHaveBeenCalledTimes(3)
    })

    it('should handle closing uninitialized queues gracefully', async () => {
      const { closeQueues } = await import('../../queue/queues')

      await expect(closeQueues()).resolves.not.toThrow()
    })

    it('should log success message after closing', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const { initializeQueues, closeQueues } = await import('../../queue/queues')

      initializeQueues()
      await closeQueues()

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Job queues closed'))
      consoleSpy.mockRestore()
    })
  })

  describe('Job Data Interfaces', () => {
    it('should accept IngestionJobData with required state field', async () => {
      const { initializeQueues, getIngestionQueue } = await import('../../queue/queues')

      initializeQueues()
      const queue = getIngestionQueue()

      await queue.add('test-job', {
        state: 'NY',
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        batchSize: 100
      })

      expect(mocks.mockQueueAdd).toHaveBeenCalledWith('test-job', {
        state: 'NY',
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        batchSize: 100
      })
    })

    it('should accept EnrichmentJobData with prospectIds array', async () => {
      const { initializeQueues, getEnrichmentQueue } = await import('../../queue/queues')

      initializeQueues()
      const queue = getEnrichmentQueue()

      await queue.add('test-job', {
        prospectIds: ['id-1', 'id-2', 'id-3'],
        force: true
      })

      expect(mocks.mockQueueAdd).toHaveBeenCalledWith('test-job', {
        prospectIds: ['id-1', 'id-2', 'id-3'],
        force: true
      })
    })

    it('should accept HealthScoreJobData with optional fields', async () => {
      const { initializeQueues, getHealthScoreQueue } = await import('../../queue/queues')

      initializeQueues()
      const queue = getHealthScoreQueue()

      await queue.add('test-job', {
        portfolioCompanyId: 'company-123',
        batchSize: 50
      })

      expect(mocks.mockQueueAdd).toHaveBeenCalledWith('test-job', {
        portfolioCompanyId: 'company-123',
        batchSize: 50
      })
    })
  })
})

describe('Ingestion coverage telemetry', () => {
  beforeEach(async () => {
    vi.resetModules()
    const { resetIngestionCoverageTelemetry } = await import('../../queue/queues')
    resetIngestionCoverageTelemetry()
  })

  it('records queue, start, success, and failure lifecycle events', async () => {
    const {
      recordIngestionQueued,
      recordIngestionStarted,
      recordIngestionCompleted,
      recordIngestionFailed,
      getIngestionCoverageTelemetry
    } = await import('../../queue/queues')

    recordIngestionQueued({
      state: 'ca',
      jobId: 'job-1',
      dataTier: 'free-tier',
      uccProvider: 'unconfigured',
      queuedBy: 'scheduler',
      timestamp: '2026-03-23T12:00:00.000Z'
    })
    recordIngestionStarted({
      state: 'CA',
      jobId: 'job-1',
      dataTier: 'free-tier',
      uccProvider: 'unconfigured',
      timestamp: '2026-03-23T12:01:00.000Z'
    })
    recordIngestionCompleted({
      state: 'CA',
      jobId: 'job-1',
      dataTier: 'free-tier',
      uccProvider: 'unconfigured',
      recordsProcessed: 88,
      timestamp: '2026-03-23T12:02:00.000Z'
    })
    recordIngestionFailed({
      state: 'CA',
      jobId: 'job-2',
      dataTier: 'free-tier',
      uccProvider: 'unconfigured',
      error: 'Timeout',
      timestamp: '2026-03-23T12:03:00.000Z'
    })

    const [telemetry] = getIngestionCoverageTelemetry('CA')

    expect(telemetry).toMatchObject({
      state: 'CA',
      currentStatus: 'failed',
      lastJobId: 'job-2',
      lastQueuedAt: '2026-03-23T12:00:00.000Z',
      lastStartedAt: '2026-03-23T12:01:00.000Z',
      lastSuccessfulPull: '2026-03-23T12:02:00.000Z',
      lastFailedAt: '2026-03-23T12:03:00.000Z',
      lastError: 'Timeout',
      lastRecordsProcessed: 88,
      successCount: 1,
      failureCount: 1,
      consecutiveFailures: 1,
      queuedBy: 'scheduler'
    })
    expect(telemetry.successes).toEqual([
      {
        completedAt: '2026-03-23T12:02:00.000Z',
        recordsProcessed: 88
      }
    ])
    expect(telemetry.failures).toEqual([
      {
        failedAt: '2026-03-23T12:03:00.000Z',
        error: 'Timeout'
      }
    ])
  })

  it('resets consecutive failures after a successful run', async () => {
    const { recordIngestionFailed, recordIngestionCompleted, getIngestionCoverageTelemetry } =
      await import('../../queue/queues')

    recordIngestionFailed({
      state: 'TX',
      error: 'Proxy exhausted',
      timestamp: '2026-03-23T13:00:00.000Z'
    })
    recordIngestionFailed({
      state: 'TX',
      error: 'Proxy exhausted again',
      timestamp: '2026-03-23T13:05:00.000Z'
    })
    recordIngestionCompleted({
      state: 'TX',
      recordsProcessed: 120,
      timestamp: '2026-03-23T13:10:00.000Z'
    })

    const [telemetry] = getIngestionCoverageTelemetry('TX')

    expect(telemetry.currentStatus).toBe('success')
    expect(telemetry.consecutiveFailures).toBe(0)
    expect(telemetry.successCount).toBe(1)
    expect(telemetry.failureCount).toBe(2)
  })

  it('opens a circuit and plans a retry when no alternate strategy is wired', async () => {
    const { recordIngestionFailed, evaluateIngestionRecoveryAction, getIngestionCircuitGate } =
      await import('../../queue/queues')

    recordIngestionFailed({
      state: 'CA',
      strategy: 'api',
      error: 'Portal timeout',
      timestamp: '2026-03-23T14:00:00.000Z'
    })

    const recovery = evaluateIngestionRecoveryAction({
      state: 'CA',
      currentStrategy: 'api',
      error: 'Portal timeout',
      timestamp: '2026-03-23T14:00:00.000Z'
    })

    expect(recovery).toMatchObject({
      action: 'retry',
      nextStrategy: 'api',
      reason: 'Retrying api after Portal timeout'
    })

    const gate = getIngestionCircuitGate('CA', '2026-03-23T14:01:00.000Z')

    expect(gate.allowed).toBe(false)
    expect(gate.circuitState).toBe('open')
  })

  it('allows half-open probes after circuit backoff expires', async () => {
    const { recordIngestionFailed, evaluateIngestionRecoveryAction, getIngestionCircuitGate } =
      await import('../../queue/queues')

    recordIngestionFailed({
      state: 'TX',
      strategy: 'bulk',
      error: 'CAPTCHA challenge',
      timestamp: '2026-03-23T15:00:00.000Z'
    })

    const recovery = evaluateIngestionRecoveryAction({
      state: 'TX',
      currentStrategy: 'bulk',
      error: 'CAPTCHA challenge',
      timestamp: '2026-03-23T15:00:00.000Z'
    })

    expect(recovery.action).toBe('retry')

    const blockedGate = getIngestionCircuitGate('TX', '2026-03-23T15:01:00.000Z')
    const allowedGate = getIngestionCircuitGate(
      'TX',
      recovery.backoffUntil ?? '2026-03-23T15:02:00.000Z'
    )

    expect(blockedGate.allowed).toBe(false)
    expect(allowedGate.allowed).toBe(true)
    expect(allowedGate.circuitState).toBe('half-open')
  })
})

// Add a single test that always runs to indicate the skip reason
describe('Queue Tests - Dependency Check', () => {
  it.skipIf(!bullmqAvailable)('should skip queue tests when bullmq is not installed', () => {
    expect(true).toBe(true)
  })

  it.skipIf(bullmqAvailable)('skips tests because bullmq is not installed', () => {
    console.log('Queue tests skipped: bullmq package not installed')
    expect(true).toBe(true)
  })
})
