import { getOutreachQueue } from '../queues'

export interface TerminationDetectionResult {
  detected: number
  eventsCreated: number
}

export async function processTerminationDetection(db: {
  query: <T>(sql: string, params?: unknown[]) => Promise<T[]>
}): Promise<TerminationDetectionResult> {
  // 1. Find recently terminated filings without a matching filing_event
  const terminated = await db.query<{
    id: string
    external_id: string
    filing_date: string
    status: string
    secured_party_name: string
    lien_amount: number | null
    state: string
    termination_detected_at: string
  }>(`
    SELECT uf.id, uf.external_id, uf.filing_date, uf.status,
           uf.secured_party_name, uf.lien_amount, uf.state,
           uf.updated_at as termination_detected_at
    FROM ucc_filings uf
    LEFT JOIN filing_events fe ON fe.filing_id = uf.id AND fe.event_type = 'termination'
    WHERE uf.status = 'terminated'
      AND uf.updated_at >= NOW() - INTERVAL '7 days'
      AND fe.id IS NULL
  `)

  let eventsCreated = 0

  for (const filing of terminated) {
    // Find linked prospect
    const prospects = await db.query<{ id: string }>(
      `SELECT p.id FROM prospects p
       JOIN prospect_ucc_filings puf ON p.id = puf.prospect_id
       WHERE puf.ucc_filing_id = $1 LIMIT 1`,
      [filing.id]
    )

    if (prospects.length === 0) continue

    // Create filing event
    await db.query(
      `INSERT INTO filing_events (prospect_id, event_type, filing_id, event_date, metadata)
       VALUES ($1, 'termination', $2, $3, $4)`,
      [
        prospects[0].id,
        filing.id,
        filing.termination_detected_at,
        JSON.stringify({
          secured_party: filing.secured_party_name,
          lien_amount: filing.lien_amount,
          state: filing.state,
          filing_date: filing.filing_date
        })
      ]
    )

    // Mark prospect for re-enrichment
    await db.query(`UPDATE prospects SET updated_at = NOW() WHERE id = $1`, [prospects[0].id])

    eventsCreated++

    // Queue outreach job for this termination
    try {
      const outreachQueue = getOutreachQueue()
      await outreachQueue.add('termination-outreach', {
        filingEventId: filing.id,
        prospectId: prospects[0].id,
        triggerType: 'termination',
        triggeredBy: 'event'
      })
    } catch (err) {
      console.error(
        `[termination] Failed to queue outreach for ${prospects[0].id}:`,
        (err as Error).message
      )
    }
  }

  return { detected: terminated.length, eventsCreated }
}
