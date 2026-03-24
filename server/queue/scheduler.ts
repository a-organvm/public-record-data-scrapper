import {
  getIngestionQueue,
  getEnrichmentQueue,
  getHealthScoreQueue,
  getPortalProbeQueue,
  getDigestQueue,
  getTerminationDetectionQueue,
  getVelocityAnalysisQueue,
  getOutreachQueue,
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

    // Portal probes: daily at 1:30 AM (30 min before ingestion)
    this.scheduleDaily('portal-probes', 1, 30, async () => {
      try {
        const queue = getPortalProbeQueue()
        await queue.add('probe-all', {
          states: ['NY', 'CA', 'TX', 'FL', 'IL', 'PA', 'OH', 'GA', 'NC', 'MI'],
          triggeredBy: 'scheduler'
        })
        console.log('[scheduler] Portal probe job queued')
      } catch (err) {
        console.error('[scheduler] Failed to queue portal probes:', (err as Error).message)
      }
    })

    // Coverage digest: weekly Monday at 9:00 AM
    this.scheduleWeekly('coverage-digest', 1, 9, 0, async () => {
      try {
        const queue = getDigestQueue()
        await queue.add('weekly-digest', {
          periodDays: 7,
          recipients: [process.env.DIGEST_RECIPIENT_EMAIL || '']
        })
        console.log('[scheduler] Coverage digest job queued')
      } catch (err) {
        console.error('[scheduler] Failed to queue coverage digest:', (err as Error).message)
      }
    })

    // Termination detection: daily at 2:30 AM (after ingestion at 2:00 AM)
    this.scheduleDaily('termination-detection', 2, 30, async () => {
      try {
        const queue = getTerminationDetectionQueue()
        await queue.add('detect-terminations', { triggeredBy: 'scheduler' })
        console.log('[scheduler] Termination detection job queued')
      } catch (err) {
        console.error('[scheduler] Failed to queue termination detection:', (err as Error).message)
      }
    })

    // Velocity analysis: daily at 3:00 AM (after termination detection)
    this.scheduleDaily('velocity-analysis', 3, 0, async () => {
      try {
        const queue = getVelocityAnalysisQueue()
        await queue.add('compute-velocity', { triggeredBy: 'scheduler' })
        console.log('[scheduler] Velocity analysis job queued')
      } catch (err) {
        console.error('[scheduler] Failed to queue velocity analysis:', (err as Error).message)
      }
    })

    // Process scheduled outreach steps every 15 minutes
    this.scheduleInterval('outreach-processor', 15 * 60 * 1000, async () => {
      try {
        const queue = getOutreachQueue()
        // Find sequences with scheduled steps that are due
        const dueSteps = await database.query<{ sequence_id: string; prospect_id: string }>(
          `SELECT DISTINCT os.sequence_id, oq.prospect_id
           FROM outreach_steps os
           JOIN outreach_sequences oq ON os.sequence_id = oq.id
           WHERE os.status = 'scheduled' AND os.scheduled_for <= NOW()
           LIMIT 50`
        )
        for (const step of dueSteps) {
          await queue.add('process-scheduled', {
            prospectId: step.prospect_id,
            triggerType: 'scheduled_step',
            triggeredBy: 'event'
          })
        }
        if (dueSteps.length > 0) {
          console.log(`[scheduler] Queued ${dueSteps.length} outreach jobs for due steps`)
        }
      } catch (err) {
        console.error('[scheduler] Outreach processor error:', (err as Error).message)
      }
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

  private scheduleWeekly(
    name: string,
    dayOfWeek: number,
    hour: number,
    minute: number,
    callback: () => void
  ): void {
    const schedule = () => {
      const now = new Date()
      const target = new Date(now)
      target.setDate(target.getDate() + ((dayOfWeek + 7 - target.getDay()) % 7 || 7))
      target.setHours(hour, minute, 0, 0)
      if (target <= now) {
        target.setDate(target.getDate() + 7)
      }
      const delay = target.getTime() - now.getTime()
      const timeout = setTimeout(() => {
        callback()
        schedule()
      }, delay)
      this.scheduledJobs.set(name, timeout)
    }
    schedule()
    console.log(
      `[scheduler] Registered weekly job: ${name} (${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayOfWeek]} ${hour}:${String(minute).padStart(2, '0')})`
    )
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
