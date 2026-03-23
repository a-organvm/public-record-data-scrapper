import { FilingVelocityService } from '../../services/FilingVelocityService'

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
