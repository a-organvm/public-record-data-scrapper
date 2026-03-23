import { Worker, Job } from 'bullmq'
import { redisConnection } from '../connection'
import { HealthScoreJobData } from '../queues'
import { database } from '../../database/connection'
import { listEnabledIntegrations } from '../../config/tieredIntegrations'

async function processHealthScore(job: Job<HealthScoreJobData>): Promise<void> {
  const { portfolioCompanyId, batchSize = 50, dataTier } = job.data
  const resolvedTier = dataTier ?? 'free-tier'
  const enabledIntegrations = listEnabledIntegrations(resolvedTier)

  await job.updateProgress(0)

  console.log(`[Health Score Worker] Starting health score calculation (${resolvedTier})`)
  console.log(
    `[Health Score Worker] Tier integrations: ${enabledIntegrations.length > 0 ? enabledIntegrations.join(', ') : 'none'}`
  )

  try {
    // Get companies to process
    let companies
    if (portfolioCompanyId) {
      // Single company
      companies = await database.query(
        'SELECT id, company_name FROM portfolio_companies WHERE id = $1',
        [portfolioCompanyId]
      )
    } else {
      // Batch processing - companies that need health score updates
      companies = await database.query(
        `SELECT id, company_name
         FROM portfolio_companies
         WHERE updated_at < NOW() - INTERVAL '12 hours'
            OR current_health_score IS NULL
         LIMIT $1`,
        [batchSize]
      )
    }

    if (companies.length === 0) {
      console.log('[Health Score Worker] No companies need health score updates')
      return
    }

    const total = companies.length
    let completed = 0

    for (const company of companies) {
      try {
        // Calculate health score based on various factors
        const healthData = await calculateHealthScore(company.id)

        // Update portfolio company with latest health score
        await database.query(
          `UPDATE portfolio_companies
           SET current_health_score = $2,
               health_grade = $3,
               health_trend = $4,
               updated_at = NOW()
           WHERE id = $1`,
          [company.id, healthData.score, healthData.grade, healthData.trend]
        )

        // Store historical health score
        await database.query(
          `INSERT INTO health_scores (portfolio_company_id, score, grade, trend, violations_count, sentiment_score, recorded_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [
            company.id,
            healthData.score,
            healthData.grade,
            healthData.trend,
            healthData.violations,
            healthData.sentiment
          ]
        )

        completed++
        const progress = Math.floor((completed / total) * 100)
        await job.updateProgress(progress)

        console.log(
          `[Health Score Worker] Updated ${company.company_name}: ${healthData.score} (${healthData.grade}) - ${completed}/${total}`
        )
      } catch (error) {
        console.error(`[Health Score Worker] Failed to process ${company.company_name}:`, error)
        completed++
      }
    }

    console.log(`[Health Score Worker] Completed ${completed} health score calculations`)
  } catch (error) {
    console.error('[Health Score Worker] Error processing health scores:', error)
    throw error
  }
}

type GrowthSignalRow = { count: string; type: string }
type ViolationsRow = { count: string }
type HealthScoreRow = { score: number | string }

async function calculateHealthScore(companyId: string) {
  // Get growth signals
  const growthSignals = await database.query<GrowthSignalRow>(
    `SELECT COUNT(*) as count, type
     FROM growth_signals
     WHERE portfolio_company_id = $1
       AND detected_date > NOW() - INTERVAL '90 days'
     GROUP BY type`,
    [companyId]
  )

  // Get recent violations
  const violations = await database.query<ViolationsRow>(
    `SELECT COUNT(*) as count
     FROM health_scores
     WHERE portfolio_company_id = $1
       AND recorded_at > NOW() - INTERVAL '90 days'
       AND violations_count > 0`,
    [companyId]
  )

  // Calculate score based on signals
  let score = 70 // Base score
  const signalsCount = growthSignals.reduce((sum, s) => sum + Number.parseInt(s.count, 10), 0)
  const violationsCount = Number(violations[0]?.count ?? 0)

  // Add points for growth signals
  score += Math.min(signalsCount * 2, 20)

  // Deduct points for violations
  score -= Math.min(violationsCount * 5, 30)

  // Ensure score is between 0-100
  score = Math.max(0, Math.min(100, score))

  // Calculate grade
  let grade = 'F'
  if (score >= 90) grade = 'A'
  else if (score >= 80) grade = 'B'
  else if (score >= 70) grade = 'C'
  else if (score >= 60) grade = 'D'

  // Determine trend (compare to previous scores)
  const previousScores = await database.query<HealthScoreRow>(
    `SELECT score
     FROM health_scores
     WHERE portfolio_company_id = $1
     ORDER BY recorded_at DESC
     LIMIT 3`,
    [companyId]
  )

  let trend = 'stable'
  if (previousScores.length >= 2) {
    const avgPrevious =
      previousScores.reduce((sum, s) => sum + Number(s.score), 0) / previousScores.length
    if (score > avgPrevious + 5) trend = 'improving'
    else if (score < avgPrevious - 5) trend = 'declining'
  }

  // Use a deterministic proxy until review- and feedback-based sentiment is wired.
  const sentiment = Math.max(0, Math.min(1, score / 100 - violationsCount * 0.05))

  return {
    score,
    grade,
    trend,
    violations: violationsCount,
    sentiment
  }
}

export function createHealthWorker() {
  const { client } = redisConnection.connect()

  const worker = new Worker<HealthScoreJobData>('health-scores', processHealthScore, {
    connection: client,
    concurrency: 3, // Process 3 batches concurrently
    limiter: {
      max: 30, // Max 30 jobs
      duration: 60000 // per minute
    }
  })

  worker.on('completed', (job) => {
    console.log(`[Health Score Worker] Job ${job.id} completed successfully`)
  })

  worker.on('failed', (job, err) => {
    console.error(`[Health Score Worker] Job ${job?.id} failed:`, err.message)
  })

  worker.on('error', (err) => {
    console.error('[Health Score Worker] Worker error:', err)
  })

  console.log('✓ Health score worker started')

  return worker
}
