import {
  getIngestionQueue,
  getEnrichmentQueue,
  getHealthScoreQueue,
  getIngestionCircuitGate,
  recordIngestionQueued,
  resolvePrimaryIngestionStrategy,
  resolveStateIngestionStrategyChain
} from './queues'
import { database } from '../database/connection'
import { resolveUccProvider } from '../config/tieredIntegrations'

export class JobScheduler {
  private scheduledJobs: Map<string, NodeJS.Timeout> = new Map()

  async start() {
    console.log('Starting job scheduler...')

    // Schedule UCC ingestion - Daily at 2:00 AM
    this.scheduleDaily('ucc-ingestion', 2, 0, async () => {
      await this.scheduleUCCIngestion()
    })

    // Schedule enrichment refresh - Every 6 hours
    this.scheduleInterval('enrichment-refresh', 6 * 60 * 60 * 1000, async () => {
      await this.scheduleEnrichmentRefresh()
    })

    // Schedule health score updates - Every 12 hours
    this.scheduleInterval('health-scores', 12 * 60 * 60 * 1000, async () => {
      await this.scheduleHealthScoreUpdates()
    })

    console.log('✓ Job scheduler started')
  }

  stop() {
    console.log('Stopping job scheduler...')
    this.scheduledJobs.forEach((timeout, name) => {
      clearTimeout(timeout)
      console.log(`  ✓ Stopped ${name}`)
    })
    this.scheduledJobs.clear()
    console.log('✓ Job scheduler stopped')
  }

  private scheduleDaily(name: string, hour: number, minute: number, callback: () => Promise<void>) {
    const schedule = () => {
      const now = new Date()
      const scheduledTime = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        hour,
        minute,
        0
      )

      // If scheduled time has passed today, schedule for tomorrow
      if (scheduledTime < now) {
        scheduledTime.setDate(scheduledTime.getDate() + 1)
      }

      const msUntilScheduled = scheduledTime.getTime() - now.getTime()

      const timeout = setTimeout(async () => {
        console.log(`[Scheduler] Running scheduled job: ${name}`)
        try {
          await callback()
        } catch (error) {
          console.error(`[Scheduler] Error in ${name}:`, error)
        }
        // Reschedule for next day
        schedule()
      }, msUntilScheduled)

      this.scheduledJobs.set(name, timeout)

      console.log(
        `  ✓ Scheduled ${name} for ${scheduledTime.toLocaleString()} (in ${Math.round(msUntilScheduled / 1000 / 60)} minutes)`
      )
    }

    schedule()
  }

  private scheduleInterval(name: string, intervalMs: number, callback: () => Promise<void>) {
    // Run immediately on start
    callback().catch((error) => {
      console.error(`[Scheduler] Error in ${name}:`, error)
    })

    // Then schedule recurring
    const timeout: NodeJS.Timeout = setInterval(async () => {
      console.log(`[Scheduler] Running scheduled job: ${name}`)
      try {
        await callback()
      } catch (error) {
        console.error(`[Scheduler] Error in ${name}:`, error)
      }
    }, intervalMs)

    this.scheduledJobs.set(name, timeout)

    console.log(`  ✓ Scheduled ${name} to run every ${Math.round(intervalMs / 1000 / 60)} minutes`)
  }

  private async scheduleUCCIngestion() {
    const ingestionQueue = getIngestionQueue()

    // Get list of states to scrape (from config or database)
    const states = ['NY', 'CA', 'TX', 'FL', 'IL', 'PA', 'OH', 'GA', 'NC', 'MI']
    const dataTier = 'free-tier'
    const uccProvider = resolveUccProvider(dataTier)
    let queuedStates = 0

    console.log(`[Scheduler] Queueing UCC ingestion for ${states.length} states`)

    for (const state of states) {
      const gate = getIngestionCircuitGate(state)

      if (!gate.allowed) {
        console.log(
          `[Scheduler] Skipping ${state} because circuit is open until ${gate.backoffUntil}`
        )
        continue
      }

      const strategy = resolvePrimaryIngestionStrategy(state)
      const availableStrategies = resolveStateIngestionStrategyChain(state)

      if (!strategy) {
        console.log(
          `[Scheduler] Skipping ${state} because no production ingestion strategy is configured`
        )
        continue
      }

      const job = await ingestionQueue.add(
        `ingest-${state}`,
        {
          state,
          batchSize: 1000,
          dataTier,
          uccProvider,
          strategy,
          fallbackDepth: 0
        },
        {
          priority: 1,
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: false
        }
      )
      queuedStates += 1

      recordIngestionQueued({
        state,
        jobId: job.id?.toString() ?? null,
        dataTier,
        uccProvider,
        strategy,
        availableStrategies,
        queuedBy: 'scheduler'
      })
    }

    console.log(`[Scheduler] Queued ${queuedStates} ingestion jobs`)
  }

  private async scheduleEnrichmentRefresh() {
    const enrichmentQueue = getEnrichmentQueue()

    // Get prospects that need enrichment (not enriched or stale)
    const prospects = await database.query<{ id: string }>(
      `SELECT id
       FROM prospects
       WHERE last_enriched_at IS NULL
          OR last_enriched_at < NOW() - INTERVAL '7 days'
       LIMIT 500`
    )

    if (prospects.length === 0) {
      console.log('[Scheduler] No prospects need enrichment')
      return
    }

    // Split into batches of 50
    const batchSize = 50
    const batches = []
    for (let i = 0; i < prospects.length; i += batchSize) {
      batches.push(prospects.slice(i, i + batchSize).map((p) => p.id))
    }

    console.log(
      `[Scheduler] Queueing enrichment for ${prospects.length} prospects in ${batches.length} batches`
    )

    for (let i = 0; i < batches.length; i++) {
      await enrichmentQueue.add(
        `enrich-batch-${i}`,
        {
          prospectIds: batches[i],
          force: false
        },
        {
          priority: 2,
          removeOnComplete: true,
          removeOnFail: false
        }
      )
    }

    console.log(`[Scheduler] Queued ${batches.length} enrichment batches`)
  }

  private async scheduleHealthScoreUpdates() {
    const healthScoreQueue = getHealthScoreQueue()

    // Get count of companies needing updates
    const result = await database.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM portfolio_companies
       WHERE updated_at < NOW() - INTERVAL '12 hours'
          OR current_health_score IS NULL`
    )

    const count = parseInt(result[0]?.count || '0')

    if (count === 0) {
      console.log('[Scheduler] No companies need health score updates')
      return
    }

    console.log(`[Scheduler] Queueing health score updates for ${count} companies`)

    // Create batches of 50 companies each
    const batchSize = 50
    const numBatches = Math.ceil(count / batchSize)

    for (let i = 0; i < numBatches; i++) {
      await healthScoreQueue.add(
        `health-batch-${i}`,
        {
          batchSize
        },
        {
          priority: 3,
          removeOnComplete: true,
          removeOnFail: false
        }
      )
    }

    console.log(`[Scheduler] Queued ${numBatches} health score batches`)
  }
}

export const jobScheduler = new JobScheduler()
