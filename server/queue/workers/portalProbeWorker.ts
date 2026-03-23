export interface PortalProbeResult {
  stateCode: string
  probeTimestamp: string
  reachable: boolean
  responseTimeMs: number
  httpStatus: number | null
  schemaValid: boolean
  antiBot: boolean
  error: string | null
}

export interface PortalProbeJobData {
  states: string[]
  triggeredBy: 'scheduler' | 'manual'
}

// Probe endpoint registry — only states with known portal URLs
const PROBE_ENDPOINTS: Record<
  string,
  {
    url: string
    method: 'GET' | 'HEAD'
    expectedMarkers?: string[]
  }
> = {
  CA: { url: 'https://bizfileonline.sos.ca.gov', method: 'HEAD' },
  TX: { url: 'https://direct.sos.state.tx.us', method: 'HEAD' },
  FL: { url: 'https://www.sunbiz.org', method: 'HEAD' },
  NY: {
    url: 'https://appext20.dos.ny.gov/pls/ucc_public/web_search.main_frame',
    method: 'GET',
    expectedMarkers: ['ucc_public', 'web_search']
  }
}

const CAPTCHA_MARKERS = [
  'captcha',
  'recaptcha',
  'hcaptcha',
  'challenge-platform',
  'cf-browser-verification'
]
const PROBE_TIMEOUT_MS = 10000

export async function probeState(stateCode: string): Promise<PortalProbeResult> {
  const endpoint = PROBE_ENDPOINTS[stateCode.toUpperCase()]
  const timestamp = new Date().toISOString()

  if (!endpoint) {
    return {
      stateCode: stateCode.toUpperCase(),
      probeTimestamp: timestamp,
      reachable: false,
      responseTimeMs: 0,
      httpStatus: null,
      schemaValid: false,
      antiBot: false,
      error: `No probe endpoint configured for ${stateCode}`
    }
  }

  const startMs = Date.now()

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)

    const response = await fetch(endpoint.url, {
      method: endpoint.method,
      signal: controller.signal,
      headers: { 'User-Agent': 'UCC-MCA-HealthProbe/1.0' }
    })

    clearTimeout(timeoutId)
    const responseTimeMs = Date.now() - startMs

    // Check for anti-bot
    let antiBot = false
    let schemaValid = true

    if (endpoint.method === 'GET') {
      const body = await response.text()
      antiBot = CAPTCHA_MARKERS.some((marker) => body.toLowerCase().includes(marker))

      if (endpoint.expectedMarkers && endpoint.expectedMarkers.length > 0) {
        schemaValid = endpoint.expectedMarkers.every((marker) =>
          body.toLowerCase().includes(marker)
        )
      }
    }

    return {
      stateCode: stateCode.toUpperCase(),
      probeTimestamp: timestamp,
      reachable: response.ok,
      responseTimeMs,
      httpStatus: response.status,
      schemaValid,
      antiBot,
      error: response.ok ? null : `HTTP ${response.status}`
    }
  } catch (err) {
    return {
      stateCode: stateCode.toUpperCase(),
      probeTimestamp: timestamp,
      reachable: false,
      responseTimeMs: Date.now() - startMs,
      httpStatus: null,
      schemaValid: false,
      antiBot: false,
      error: (err as Error).message
    }
  }
}

export async function persistProbeResult(
  db: { query: <T>(sql: string, params?: unknown[]) => Promise<T[]> },
  result: PortalProbeResult
): Promise<void> {
  await db.query(
    `INSERT INTO portal_probe_results (state_code, probe_timestamp, reachable, response_time_ms, http_status, schema_valid, anti_bot_detected, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      result.stateCode,
      result.probeTimestamp,
      result.reachable,
      result.responseTimeMs,
      result.httpStatus,
      result.schemaValid,
      result.antiBot,
      result.error
    ]
  )
}

export async function processProbeJob(
  states: string[],
  db: { query: <T>(sql: string, params?: unknown[]) => Promise<T[]> },
  alertService: {
    handleAlert: (trigger: { type: string; stateCode: string; error?: string }) => Promise<unknown>
  }
): Promise<PortalProbeResult[]> {
  const results: PortalProbeResult[] = []

  for (const state of states) {
    const result = await probeState(state)
    results.push(result)

    // Persist result
    await persistProbeResult(db, result).catch((err) =>
      console.error(`[probe] Failed to persist result for ${state}:`, (err as Error).message)
    )

    // Alert on failures
    if (!result.reachable) {
      await alertService
        .handleAlert({
          type: 'probe_failed',
          stateCode: result.stateCode,
          error: result.error ?? 'Portal unreachable'
        })
        .catch((err) =>
          console.error(`[probe] Failed to send alert for ${state}:`, (err as Error).message)
        )
    }

    // Alert on schema changes (anti-bot or missing markers)
    if (result.reachable && (!result.schemaValid || result.antiBot)) {
      await alertService
        .handleAlert({
          type: 'schema_change_detected',
          stateCode: result.stateCode
        })
        .catch((err) =>
          console.error(`[probe] Failed to send schema alert for ${state}:`, (err as Error).message)
        )
    }
  }

  return results
}

// Export for testing
export { PROBE_ENDPOINTS, CAPTCHA_MARKERS }
