import { database } from './database/connection'
import { initializeQueues, closeQueues } from './queue/queues'
import { createIngestionWorker } from './queue/workers/ingestionWorker'
import { createEnrichmentWorker } from './queue/workers/enrichmentWorker'
import { createHealthWorker } from './queue/workers/healthWorker'
import { redisConnection } from './queue/connection'
import { config } from './config'

type ClosableWorker = {
  close: () => Promise<unknown>
}

class WorkerProcess {
  private workers: ClosableWorker[] = []
  private shuttingDown = false

  async start() {
    console.log('')
    console.log('🔧 Starting Worker Process')
    console.log('─────────────────────────────────────')
    console.log(`  Environment: ${config.server.env}`)
    console.log(`  Redis:       ${config.redis.host}:${config.redis.port}`)
    console.log('─────────────────────────────────────')
    console.log('')

    try {
      // Connect to database
      await database.connect()

      // Initialize queues
      initializeQueues()

      // Start workers
      console.log('Starting workers...')
      this.workers.push(createIngestionWorker())
      this.workers.push(createEnrichmentWorker())
      this.workers.push(createHealthWorker())

      console.log('')
      console.log('✓ Worker process started successfully')
      console.log('  Workers are now processing jobs from the queues')
      console.log('  Press Ctrl+C to stop')
      console.log('')
    } catch (error) {
      console.error('Failed to start worker process:', error)
      process.exit(1)
    }
  }

  async shutdown(signal?: string) {
    // Guard against duplicate SIGTERM/SIGINT triggering concurrent shutdowns.
    if (this.shuttingDown) {
      console.log('Shutdown already in progress, ignoring duplicate signal')
      return
    }
    this.shuttingDown = true

    console.log('')
    console.log(`Shutting down worker process${signal ? ` (${signal})` : ''}...`)

    // Force exit if graceful shutdown hangs (e.g. a job won't drain in time).
    const forceExitTimer = setTimeout(() => {
      console.error('✗ Worker graceful shutdown timed out after 30s — forcing exit')
      process.exit(1)
    }, 30_000)
    forceExitTimer.unref()

    try {
      // Close workers (drains in-flight jobs)
      console.log('Closing workers...')
      await Promise.all(this.workers.map((worker) => worker.close()))

      // Close queues
      await closeQueues()

      // Disconnect from Redis
      await redisConnection.disconnect()

      // Disconnect from database
      await database.disconnect()

      console.log('✓ Worker process shutdown complete')
      clearTimeout(forceExitTimer)
      process.exit(0)
    } catch (error) {
      console.error('✗ Error during worker shutdown:', error)
      clearTimeout(forceExitTimer)
      process.exit(1)
    }
  }
}

// Start worker process
const worker = new WorkerProcess()
worker.start().catch((error) => {
  console.error('Fatal error during worker startup:', error)
  process.exit(1)
})

// Graceful shutdown on termination signals
process.on('SIGTERM', () => {
  void worker.shutdown('SIGTERM')
})
process.on('SIGINT', () => {
  void worker.shutdown('SIGINT')
})

// Process-level safety nets
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled promise rejection:', reason)
  void worker.shutdown('unhandledRejection')
})
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught exception:', error)
  void worker.shutdown('uncaughtException')
})
