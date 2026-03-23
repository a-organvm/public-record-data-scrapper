import { Router } from 'express'
import { getIngestionCoverageTelemetry, type IngestionCoverageTelemetry } from '../queue/queues'

const router = Router()

const HIGH_VALUE_STATES = ['CA', 'TX', 'FL', 'NY']

const ALL_STATES = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
  'DC'
]

type StatusColor = 'green' | 'yellow' | 'red' | 'gray'

function resolveStatusColor(telemetry: IngestionCoverageTelemetry | undefined): StatusColor {
  if (!telemetry || telemetry.currentStatus === 'idle') {
    return 'gray'
  }

  // RED: failed + circuit open, or consecutive failures >= 2
  if (
    (telemetry.currentStatus === 'failed' && telemetry.circuitState === 'open') ||
    telemetry.consecutiveFailures >= 2
  ) {
    return 'red'
  }

  // GREEN: success + circuit closed
  if (telemetry.currentStatus === 'success' && telemetry.circuitState === 'closed') {
    return 'green'
  }

  // YELLOW: success but circuit not closed, OR has both successes and failures
  if (
    (telemetry.currentStatus === 'success' && telemetry.circuitState !== 'closed') ||
    (telemetry.failureCount > 0 && telemetry.successCount > 0)
  ) {
    return 'yellow'
  }

  return 'gray'
}

function formatRelativeTime(isoTimestamp: string | null): string {
  if (!isoTimestamp) return 'Never'

  const diffMs = Date.now() - new Date(isoTimestamp).getTime()
  const diffSeconds = Math.floor(diffMs / 1000)

  if (diffSeconds < 60) return `${diffSeconds}s ago`
  const diffMinutes = Math.floor(diffSeconds / 60)
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

function colorDot(color: StatusColor): string {
  const cssColor =
    color === 'green'
      ? '#22c55e'
      : color === 'yellow'
        ? '#eab308'
        : color === 'red'
          ? '#ef4444'
          : '#6b7280'

  return `<span class="dot dot-${color}" style="background:${cssColor}" aria-label="${color}"></span>`
}

function renderStateCard(
  stateCode: string,
  telemetry: IngestionCoverageTelemetry | undefined,
  large = false
): string {
  const color = resolveStatusColor(telemetry)
  const lastPull = formatRelativeTime(telemetry?.lastSuccessfulPull ?? null)
  const sizeClass = large ? 'card-large' : 'card-small'

  return `
    <div class="state-card ${sizeClass} status-${color}">
      ${colorDot(color)}
      <span class="state-code">${stateCode}</span>
      <span class="last-pull">${lastPull}</span>
    </div>`
}

function renderStatusPage(allTelemetry: IngestionCoverageTelemetry[]): string {
  const telemetryMap = new Map(allTelemetry.map((t) => [t.state, t]))

  // Compute summary counts across all 51 states (50 + DC)
  let green = 0
  let yellow = 0
  let red = 0
  let gray = 0

  for (const stateCode of ALL_STATES) {
    const color = resolveStatusColor(telemetryMap.get(stateCode))
    if (color === 'green') green++
    else if (color === 'yellow') yellow++
    else if (color === 'red') red++
    else gray++
  }

  const highValueCards = HIGH_VALUE_STATES.map((s) =>
    renderStateCard(s, telemetryMap.get(s), true)
  ).join('')

  const otherStates = ALL_STATES.filter((s) => !HIGH_VALUE_STATES.includes(s))
  const otherCards = otherStates.map((s) => renderStateCard(s, telemetryMap.get(s))).join('')

  const now = new Date().toUTCString()

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="60">
  <title>UCC-MCA Coverage Status</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f0f1a;
      color: #e2e8f0;
      min-height: 100vh;
      padding: 2rem 1rem;
    }

    .container { max-width: 960px; margin: 0 auto; }

    h1 {
      font-size: 1.5rem;
      font-weight: 700;
      letter-spacing: 0.02em;
      color: #f1f5f9;
      margin-bottom: 0.25rem;
    }

    .subtitle {
      font-size: 0.8rem;
      color: #64748b;
      margin-bottom: 1.5rem;
    }

    /* Summary bar */
    .summary-bar {
      display: flex;
      gap: 1rem;
      margin-bottom: 2rem;
      flex-wrap: wrap;
    }

    .summary-chip {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: #1a1a2e;
      border: 1px solid #2d2d4e;
      border-radius: 999px;
      padding: 0.4rem 0.9rem;
      font-size: 0.85rem;
      font-weight: 600;
    }

    .chip-count { font-size: 1rem; }
    .chip-green .chip-count { color: #22c55e; }
    .chip-yellow .chip-count { color: #eab308; }
    .chip-red .chip-count { color: #ef4444; }
    .chip-gray .chip-count { color: #6b7280; }

    /* Section headings */
    .section-title {
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #64748b;
      margin-bottom: 0.75rem;
    }

    /* High-value section */
    .hv-grid {
      display: flex;
      gap: 1rem;
      margin-bottom: 2.5rem;
      flex-wrap: wrap;
    }

    /* State grid */
    .state-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
      gap: 0.6rem;
      margin-bottom: 2rem;
    }

    /* Cards */
    .state-card {
      background: #1a1a2e;
      border: 1px solid #2d2d4e;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.3rem;
      padding: 0.6rem 0.4rem;
      transition: border-color 0.15s;
    }

    .card-large {
      min-width: 120px;
      padding: 1rem;
    }

    .card-large .state-code { font-size: 1.2rem; }

    .state-card.status-green { border-color: rgba(34,197,94,0.3); }
    .state-card.status-yellow { border-color: rgba(234,179,8,0.3); }
    .state-card.status-red { border-color: rgba(239,68,68,0.3); }

    .dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .card-large .dot { width: 14px; height: 14px; }

    .state-code {
      font-size: 0.85rem;
      font-weight: 700;
      color: #f1f5f9;
    }

    .last-pull {
      font-size: 0.65rem;
      color: #64748b;
    }

    .card-large .last-pull { font-size: 0.75rem; }

    /* Footer */
    .footer {
      font-size: 0.7rem;
      color: #475569;
      text-align: center;
      padding-top: 1rem;
      border-top: 1px solid #1e1e3a;
    }

    /* Legend */
    .legend {
      display: flex;
      gap: 1.2rem;
      margin-bottom: 1rem;
      flex-wrap: wrap;
      font-size: 0.72rem;
      color: #64748b;
      align-items: center;
    }

    .legend-item { display: flex; align-items: center; gap: 0.35rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>UCC-MCA Coverage Status</h1>
    <div class="subtitle">Auto-refreshes every 60 seconds &bull; Generated: ${now}</div>

    <div class="summary-bar">
      <div class="summary-chip chip-green">
        <span class="dot" style="background:#22c55e"></span>
        <span class="chip-count">${green}</span> green
      </div>
      <div class="summary-chip chip-yellow">
        <span class="dot" style="background:#eab308"></span>
        <span class="chip-count">${yellow}</span> yellow
      </div>
      <div class="summary-chip chip-red">
        <span class="dot" style="background:#ef4444"></span>
        <span class="chip-count">${red}</span> red
      </div>
      <div class="summary-chip chip-gray">
        <span class="dot" style="background:#6b7280"></span>
        <span class="chip-count">${gray}</span> no data
      </div>
    </div>

    <div class="section-title">High-Value States</div>
    <div class="hv-grid">
      ${highValueCards}
    </div>

    <div class="section-title">All Other States</div>
    <div class="legend">
      <span class="legend-item"><span class="dot" style="background:#22c55e;width:8px;height:8px;border-radius:50%;display:inline-block"></span> Green — success, circuit closed</span>
      <span class="legend-item"><span class="dot" style="background:#eab308;width:8px;height:8px;border-radius:50%;display:inline-block"></span> Yellow — partial / recovering</span>
      <span class="legend-item"><span class="dot" style="background:#ef4444;width:8px;height:8px;border-radius:50%;display:inline-block"></span> Red — failed / circuit open</span>
      <span class="legend-item"><span class="dot" style="background:#6b7280;width:8px;height:8px;border-radius:50%;display:inline-block"></span> Gray — no data</span>
    </div>
    <div class="state-grid">
      ${otherCards}
    </div>

    <div class="footer">UCC-MCA Intelligence Platform &bull; <a href="/api/health/coverage" style="color:#475569">/api/health/coverage</a> for JSON</div>
  </div>
</body>
</html>`
}

router.get('/status', (_req, res) => {
  const allTelemetry = getIngestionCoverageTelemetry()
  const html = renderStatusPage(allTelemetry)
  res.type('html').send(html)
})

export default router
export { renderStatusPage, resolveStatusColor, formatRelativeTime }
