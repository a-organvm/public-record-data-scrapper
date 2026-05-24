import { Router } from 'express'
import { z } from 'zod'
import { validateRequest } from '../middleware/validateRequest'
import { asyncHandler } from '../middleware/errorHandler'
import { requireRole } from '../middleware/authMiddleware'
import { getResolvedDataTier } from '../middleware/dataTier'
import {
  getIngestionCircuitGate,
  getIngestionQueue,
  getEnrichmentQueue,
  getHealthScoreQueue,
  recordIngestionQueued,
  resolvePrimaryIngestionStrategy,
  resolveStateIngestionStrategyChain
} from '../queue/queues'
import { resolveUccProvider } from '../config/tieredIntegrations'

const router = Router()

// Validation schemas (`.strict()` to reject unknown keys — prevents
// mass-assignment of arbitrary fields into the queued job payload).
const triggerIngestionSchema = z.object({
  state: z.string().length(2).toUpperCase(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  batchSize: z.number().min(100).max(10000).default(1000),
  force: z.boolean().optional().default(false)
}).strict()

const triggerEnrichmentSchema = z.object({
  prospectIds: z.array(z.string().uuid()).min(1).max(100),
  force: z.boolean().default(false)
}).strict()

const triggerHealthScoreSchema = z.object({
  portfolioCompanyId: z.string().uuid().optional(),
  batchSize: z.number().min(10).max(200).default(50)
}).strict()

const jobIdSchema = z.object({
  jobId: z.string().min(1).max(256)
})

const queueNameSchema = z.object({
  queueName: z.enum(['ucc-ingestion', 'data-enrichment', 'health-scores'])
})

const queueListQuerySchema = z.object({
  status: z
    .enum(['waiting', 'active', 'completed', 'failed', 'delayed'])
    .default('waiting'),
  limit: z.coerce.number().int().positive().max(200).default(20)
})

// POST /api/jobs/ingestion - Trigger UCC ingestion job
router.post(
  '/ingestion',
  requireRole('user', 'admin'),
  validateRequest({ body: triggerIngestionSchema }),
  asyncHandler(async (req, res) => {
    const ingestionQueue = getIngestionQueue()
    const dataTier = getResolvedDataTier(req)
    const uccProvider = resolveUccProvider(dataTier)
    const { force, ...jobPayload } = req.body
    const strategy = resolvePrimaryIngestionStrategy(req.body.state)
    const availableStrategies = resolveStateIngestionStrategyChain(req.body.state)
    const gate = getIngestionCircuitGate(req.body.state)

    if (!strategy) {
      res.status(409).json({
        error: {
          code: 'INGESTION_NOT_IMPLEMENTED',
          message: `No production ingestion strategy is configured for ${req.body.state}`,
          availableStrategies
        }
      })
      return
    }

    if (!force && !gate.allowed) {
      res.status(409).json({
        error: {
          code: 'INGESTION_CIRCUIT_OPEN',
          message: `Ingestion circuit is open for ${req.body.state}`,
          backoffUntil: gate.backoffUntil,
          reason: gate.reason
        }
      })
      return
    }

    const job = await ingestionQueue.add(
      `ingest-${req.body.state}`,
      {
        ...jobPayload,
        dataTier,
        uccProvider,
        strategy,
        fallbackDepth: 0,
        manualOverride: force
      },
      {
        attempts: 1
      }
    )

    recordIngestionQueued({
      state: req.body.state,
      jobId: job.id?.toString() ?? null,
      dataTier,
      uccProvider,
      strategy,
      availableStrategies,
      queuedBy: 'manual'
    })

    res.status(201).json({
      jobId: job.id,
      queueName: 'ucc-ingestion',
      data: job.data,
      status: 'queued'
    })
  })
)

// POST /api/jobs/enrichment - Trigger enrichment job
router.post(
  '/enrichment',
  requireRole('user', 'admin'),
  validateRequest({ body: triggerEnrichmentSchema }),
  asyncHandler(async (req, res) => {
    const enrichmentQueue = getEnrichmentQueue()
    const dataTier = getResolvedDataTier(req)
    // req.body is validated + stripped by the strict schema above, so the
    // spread cannot smuggle arbitrary fields into the job payload.
    const job = await enrichmentQueue.add('enrich-batch', { ...req.body, dataTier })

    res.status(201).json({
      jobId: job.id,
      queueName: 'data-enrichment',
      data: job.data,
      status: 'queued'
    })
  })
)

// POST /api/jobs/health-scores - Trigger health score calculation
router.post(
  '/health-scores',
  requireRole('user', 'admin'),
  validateRequest({ body: triggerHealthScoreSchema }),
  asyncHandler(async (req, res) => {
    const healthScoreQueue = getHealthScoreQueue()
    const dataTier = getResolvedDataTier(req)
    // req.body is validated + stripped by the strict schema above.
    const job = await healthScoreQueue.add('health-batch', { ...req.body, dataTier })

    res.status(201).json({
      jobId: job.id,
      queueName: 'health-scores',
      data: job.data,
      status: 'queued'
    })
  })
)

// GET /api/jobs/:jobId - Get job status
// Jobs are not tenant-scoped (BullMQ payloads carry no org binding), so reading
// an arbitrary job by id would leak cross-tenant data. Restrict to admins.
// TODO(security): when jobs are tagged with an owning org/user, scope reads to
// the caller instead of requiring the admin role.
router.get(
  '/:jobId',
  requireRole('admin'),
  validateRequest({ params: jobIdSchema }),
  asyncHandler(async (req, res) => {
    const { jobId } = req.params

    // Try to find the job in each queue
    const queues = [
      { name: 'ucc-ingestion', queue: getIngestionQueue() },
      { name: 'data-enrichment', queue: getEnrichmentQueue() },
      { name: 'health-scores', queue: getHealthScoreQueue() }
    ]

    for (const { name, queue } of queues) {
      const job = await queue.getJob(jobId)
      if (job) {
        const state = await job.getState()
        const progress = job.progress

        return res.json({
          jobId: job.id,
          queueName: name,
          status: state,
          progress,
          data: job.data,
          uccProvider: job.data?.uccProvider ?? null,
          returnvalue: job.returnvalue,
          failedReason: job.failedReason,
          processedOn: job.processedOn,
          finishedOn: job.finishedOn
        })
      }
    }

    res.status(404).json({
      error: {
        message: 'Job not found',
        code: 'JOB_NOT_FOUND'
      }
    })
  })
)

// GET /api/jobs/queues/stats - Get queue statistics (admin-only operational view)
router.get(
  '/queues/stats',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const queues = [
      { name: 'ucc-ingestion', queue: getIngestionQueue() },
      { name: 'data-enrichment', queue: getEnrichmentQueue() },
      { name: 'health-scores', queue: getHealthScoreQueue() }
    ]

    const stats = await Promise.all(
      queues.map(async ({ name, queue }) => {
        const [waiting, active, completed, failed, delayed] = await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
          queue.getCompletedCount(),
          queue.getFailedCount(),
          queue.getDelayedCount()
        ])

        return {
          queue: name,
          waiting,
          active,
          completed,
          failed,
          delayed,
          total: waiting + active + completed + failed + delayed
        }
      })
    )

    res.json({ queues: stats })
  })
)

// GET /api/jobs/queues/:queueName - Get jobs in a specific queue (admin-only)
router.get(
  '/queues/:queueName',
  requireRole('admin'),
  validateRequest({ params: queueNameSchema, query: queueListQuerySchema }),
  asyncHandler(async (req, res) => {
    const { queueName } = req.params
    const { status, limit } = req.query as z.infer<typeof queueListQuerySchema>

    const queues = {
      'ucc-ingestion': getIngestionQueue(),
      'data-enrichment': getEnrichmentQueue(),
      'health-scores': getHealthScoreQueue()
    }

    const queue = queues[queueName as keyof typeof queues]
    if (!queue) {
      return res.status(404).json({
        error: {
          message: 'Queue not found',
          code: 'QUEUE_NOT_FOUND'
        }
      })
    }

    let jobs
    switch (status) {
      case 'waiting':
        jobs = await queue.getWaiting(0, limit - 1)
        break
      case 'active':
        jobs = await queue.getActive(0, limit - 1)
        break
      case 'completed':
        jobs = await queue.getCompleted(0, limit - 1)
        break
      case 'failed':
        jobs = await queue.getFailed(0, limit - 1)
        break
      case 'delayed':
        jobs = await queue.getDelayed(0, limit - 1)
        break
      default:
        jobs = await queue.getWaiting(0, limit - 1)
    }

    const jobData = await Promise.all(
      jobs.map(async (job) => ({
        jobId: job.id,
        status: await job.getState(),
        progress: job.progress,
        data: job.data,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
        failedReason: job.failedReason
      }))
    )

    res.json({
      queue: queueName,
      status,
      count: jobData.length,
      jobs: jobData
    })
  })
)

// DELETE /api/jobs/:jobId - Remove a job (admin-only; jobs are not tenant-scoped)
// TODO(security): scope deletion to the owning org/user once jobs carry that
// metadata, instead of requiring the admin role.
router.delete(
  '/:jobId',
  requireRole('admin'),
  validateRequest({ params: jobIdSchema }),
  asyncHandler(async (req, res) => {
    const { jobId } = req.params

    const queues = [
      { name: 'ucc-ingestion', queue: getIngestionQueue() },
      { name: 'data-enrichment', queue: getEnrichmentQueue() },
      { name: 'health-scores', queue: getHealthScoreQueue() }
    ]

    for (const { name, queue } of queues) {
      const job = await queue.getJob(jobId)
      if (job) {
        await job.remove()
        return res.json({
          message: 'Job removed successfully',
          jobId,
          queueName: name
        })
      }
    }

    res.status(404).json({
      error: {
        message: 'Job not found',
        code: 'JOB_NOT_FOUND'
      }
    })
  })
)

export default router
