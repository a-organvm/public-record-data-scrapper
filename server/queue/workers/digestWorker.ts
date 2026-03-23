export interface CoverageDigest {
  generatedAt: string
  period: { from: string; to: string }
  overall: { green: number; yellow: number; red: number }
  totalRecordsCollected: number
  recordsByState: Record<string, number>
  circuitEvents: number
  dqWarnings: number
  probeFailures: number
  topPerformers: string[]
  degraded: string[]
}

export interface DigestJobData {
  periodDays: number
  recipients: string[]
}

export async function compileDigest(
  db: { query: <T>(sql: string, params?: unknown[]) => Promise<T[]> },
  periodDays: number = 7
): Promise<CoverageDigest> {
  const now = new Date()
  const from = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000)

  // Query records collected per state
  const successRows = await db.query<{ state_code: string; total: string }>(
    `SELECT state_code, SUM(records_processed)::text as total
     FROM ingestion_successes WHERE completed_at >= $1 GROUP BY state_code ORDER BY SUM(records_processed) DESC`,
    [from.toISOString()]
  )

  const recordsByState: Record<string, number> = {}
  let totalRecordsCollected = 0
  for (const row of successRows) {
    const count = parseInt(row.total, 10) || 0
    recordsByState[row.state_code] = count
    totalRecordsCollected += count
  }

  // Count circuit events (failures that indicate circuit activity)
  const circuitRows = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM coverage_alerts WHERE alert_type = 'circuit_opened' AND created_at >= $1`,
    [from.toISOString()]
  )
  const circuitEvents = parseInt(circuitRows[0]?.count ?? '0', 10)

  // Count DQ warnings
  const dqRows = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM data_quality_reports WHERE passed = false AND created_at >= $1`,
    [from.toISOString()]
  )
  const dqWarnings = parseInt(dqRows[0]?.count ?? '0', 10)

  // Count probe failures
  const probeRows = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM portal_probe_results WHERE reachable = false AND created_at >= $1`,
    [from.toISOString()]
  )
  const probeFailures = parseInt(probeRows[0]?.count ?? '0', 10)

  // Determine overall status (states with records = green, with failures = yellow/red, else gray)
  const statesWithRecords = Object.keys(recordsByState)
  const failureStates = await db.query<{ state_code: string }>(
    `SELECT DISTINCT state_code FROM ingestion_failures WHERE failed_at >= $1`,
    [from.toISOString()]
  )
  const failedSet = new Set(failureStates.map((r) => r.state_code))

  let green = 0,
    yellow = 0,
    red = 0
  for (const state of statesWithRecords) {
    if (failedSet.has(state)) yellow++
    else green++
  }
  red = 51 - green - yellow // Remaining states

  const topPerformers = successRows.slice(0, 5).map((r) => r.state_code)
  const degraded = Array.from(failedSet).slice(0, 5)

  return {
    generatedAt: now.toISOString(),
    period: { from: from.toISOString(), to: now.toISOString() },
    overall: { green, yellow, red },
    totalRecordsCollected,
    recordsByState,
    circuitEvents,
    dqWarnings,
    probeFailures,
    topPerformers,
    degraded
  }
}

export function renderDigestHtml(digest: CoverageDigest): string {
  const stateRows = Object.entries(digest.recordsByState)
    .sort(([, a], [, b]) => b - a)
    .map(([state, count]) => `<tr><td>${state}</td><td>${count.toLocaleString()}</td></tr>`)
    .join('')

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Weekly Coverage Digest</title></head>
<body style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="color: #1a1a2e;">Weekly Coverage Digest</h1>
  <p style="color: #666;">Period: ${new Date(digest.period.from).toLocaleDateString()} — ${new Date(digest.period.to).toLocaleDateString()}</p>

  <div style="display: flex; gap: 12px; margin: 20px 0;">
    <div style="padding: 12px 20px; border-radius: 8px; background: #22c55e; color: white;">${digest.overall.green} Green</div>
    <div style="padding: 12px 20px; border-radius: 8px; background: #eab308; color: white;">${digest.overall.yellow} Yellow</div>
    <div style="padding: 12px 20px; border-radius: 8px; background: #ef4444; color: white;">${digest.overall.red} Red</div>
  </div>

  <h2>Summary</h2>
  <ul>
    <li><strong>${digest.totalRecordsCollected.toLocaleString()}</strong> records collected</li>
    <li><strong>${digest.circuitEvents}</strong> circuit breaker events</li>
    <li><strong>${digest.dqWarnings}</strong> data quality warnings</li>
    <li><strong>${digest.probeFailures}</strong> probe failures</li>
  </ul>

  ${digest.topPerformers.length > 0 ? `<h2>Top Performers</h2><p>${digest.topPerformers.join(', ')}</p>` : ''}
  ${digest.degraded.length > 0 ? `<h2>Degraded States</h2><p style="color: #ef4444;">${digest.degraded.join(', ')}</p>` : ''}

  ${stateRows ? `<h2>Records by State</h2><table style="width:100%; border-collapse:collapse;"><tr><th style="text-align:left; border-bottom:1px solid #ddd; padding:8px;">State</th><th style="text-align:left; border-bottom:1px solid #ddd; padding:8px;">Records</th></tr>${stateRows}</table>` : ''}

  <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;">
  <p style="color: #999; font-size: 12px;">UCC-MCA Intelligence Platform — Coverage Monitoring</p>
</body>
</html>`
}

export async function processDigestJob(
  db: { query: <T>(sql: string, params?: unknown[]) => Promise<T[]> },
  emailSender: {
    sendTransactional: (opts: {
      to: { email: string }[]
      from: { email: string; name?: string }
      subject: string
      html: string
      text?: string
    }) => Promise<{ success: boolean }>
  } | null,
  recipients: string[]
): Promise<CoverageDigest> {
  const digest = await compileDigest(db)
  const html = renderDigestHtml(digest)

  const validRecipients = recipients.filter((r) => r && r.includes('@'))

  if (validRecipients.length > 0 && emailSender) {
    try {
      await emailSender.sendTransactional({
        to: validRecipients.map((email) => ({ email })),
        from: { email: 'digest@ucc-mca.com', name: 'UCC-MCA Coverage Digest' },
        subject: `Weekly Coverage Report — ${digest.overall.green}G/${digest.overall.yellow}Y/${digest.overall.red}R — ${digest.totalRecordsCollected.toLocaleString()} records`,
        html
      })
    } catch (err) {
      console.error('[digest] Failed to send email:', (err as Error).message)
    }
  }

  return digest
}
