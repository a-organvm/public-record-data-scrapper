import { Worker } from 'bullmq'
import { redisConnection } from '../connection'
import { database } from '../../database/connection'
import { FilingVelocityService } from '../../services/FilingVelocityService'
import type { VelocityAnalysisJobData } from '../queues'

export interface VelocityAnalysisResult {
  processed: number
  errors: number
}

export async function processVelocityAnalysis(db: {
  query: <T>(sql: string, params?: unknown[]) => Promise<T[]>
}): Promise<VelocityAnalysisResult> {
  const velocityService = new FilingVelocityService(db)

  // Get all prospects that have UCC filings
  const prospects = await db.query<{ id: string }>(
    `SELECT DISTINCT p.id FROM prospects p
     JOIN prospect_ucc_filings puf ON p.id = puf.prospect_id
     LIMIT 1000`
  )

  let processed = 0
  let errors = 0

  for (const { id } of prospects) {
    try {
      const metrics = await velocityService.computeVelocity(id)
      await velocityService.persistMetrics(id, metrics)
      processed++
    } catch (err) {
      console.error(`[velocity] Failed for prospect ${id}:`, (err as Error).message)
      errors++
    }
  }

  console.log(`[velocity] Processed ${processed} prospects, ${errors} errors`)
  return { processed, errors }
}

export function createVelocityAnalysisWorker() {
  const { client } = redisConnection.connect()

  const worker = new Worker<VelocityAnalysisJobData, VelocityAnalysisResult>(
    'velocity-analysis',
    () => processVelocityAnalysis(database),
    {
      connection: client,
      concurrency: 1
    }
  )

  worker.on('completed', (job, returnvalue) => {
    console.log(`[Velocity Analysis Worker] Job ${job.id} completed:`, returnvalue)
  })

  worker.on('failed', (job, err) => {
    console.error(`[Velocity Analysis Worker] Job ${job?.id} failed:`, err.message)
  })

  worker.on('error', (err) => {
    console.error('[Velocity Analysis Worker] Worker error:', err)
  })

  console.log('✓ Velocity analysis worker started')

  return worker
}
