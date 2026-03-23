# SP1: Coverage Dashboard + Health Monitoring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a 50-state coverage dashboard with persistent telemetry, proactive portal probes, data quality assertions, alerts, and weekly digest — answering Tony's "will it continue to work?"

**Architecture:** PostgreSQL-backed telemetry persistence wraps the existing in-memory circuit breaker system. New BullMQ workers handle portal probes and digest emails. A standalone `/status` HTML page provides a bookmarkable view. The React dashboard gets promoted to its own tab with 30s auto-refresh polling.

**Tech Stack:** TypeScript, Express 5, PostgreSQL (pg), BullMQ, Redis, React 19, Vitest, SendGrid

**Spec:** `docs/superpowers/specs/2026-03-23-sp1-coverage-dashboard-health-monitoring-design.md`

---

## File Structure

### New Files

| File                                                            | Responsibility                         |
| --------------------------------------------------------------- | -------------------------------------- |
| `database/migrations/010_ingestion_telemetry.sql`               | Telemetry, probe, DQ, alert tables     |
| `database/migrations/010_down.sql`                              | Rollback for above                     |
| `server/services/TelemetryPersistenceService.ts`                | Persist/hydrate telemetry to/from PG   |
| `server/services/DataQualityService.ts`                         | Post-ingestion data quality validation |
| `server/services/CoverageAlertService.ts`                       | Alert on state transitions + email     |
| `server/config/dataQuality.ts`                                  | Volume expectations per state          |
| `server/queue/workers/portalProbeWorker.ts`                     | Lightweight portal availability checks |
| `server/queue/workers/digestWorker.ts`                          | Weekly coverage digest email           |
| `server/routes/status.ts`                                       | Standalone HTML status page            |
| `apps/web/src/hooks/useCoverageDashboard.ts`                    | Auto-refresh polling hook              |
| `apps/web/src/features/coverage/CoverageTab.tsx`                | Top-level tab wrapper                  |
| `server/__tests__/services/TelemetryPersistenceService.test.ts` | Tests                                  |
| `server/__tests__/services/DataQualityService.test.ts`          | Tests                                  |
| `server/__tests__/services/CoverageAlertService.test.ts`        | Tests                                  |
| `server/__tests__/queue/workers/portalProbeWorker.test.ts`      | Tests                                  |
| `server/__tests__/queue/workers/digestWorker.test.ts`           | Tests                                  |
| `server/__tests__/routes/status.test.ts`                        | Tests                                  |
| `apps/web/src/hooks/__tests__/useCoverageDashboard.test.ts`     | Tests                                  |
| `apps/web/src/features/coverage/__tests__/CoverageTab.test.tsx` | Tests                                  |

### Modified Files

| File                                      | Change                                              |
| ----------------------------------------- | --------------------------------------------------- |
| `database/schema.sql`                     | Append new tables for reference                     |
| `server/queue/queues.ts`                  | Add persistence hooks + new queue definitions       |
| `server/queue/scheduler.ts`               | Add probe (1:30 AM) + digest (Mon 9 AM) schedules   |
| `server/queue/workers/ingestionWorker.ts` | Add DQ validation after persist                     |
| `server/routes/health.ts`                 | DB fallback on cold start                           |
| `server/index.ts`                         | Mount `/status` route, hydrate telemetry on startup |
| `apps/web/src/App.tsx`                    | Add Coverage tab                                    |
| `server/__tests__/setup.ts`               | Add new tables to truncate list                     |

---

## Task 1: Database Migration — Telemetry Tables

**Files:**

- Create: `database/migrations/010_ingestion_telemetry.sql`
- Create: `database/migrations/010_down.sql`
- Modify: `database/schema.sql` (append for reference)

- [ ] **Step 1: Write the migration SQL**

```sql
-- 010_ingestion_telemetry.sql
-- Persistent telemetry for ingestion coverage monitoring

CREATE TABLE IF NOT EXISTS ingestion_telemetry (
  state_code VARCHAR(2) PRIMARY KEY,
  current_status VARCHAR(20) NOT NULL DEFAULT 'idle',
  last_job_id VARCHAR(100),
  last_queued_at TIMESTAMPTZ,
  last_started_at TIMESTAMPTZ,
  last_successful_pull TIMESTAMPTZ,
  last_failed_at TIMESTAMPTZ,
  last_error TEXT,
  last_records_processed INTEGER,
  data_tier VARCHAR(20),
  ucc_provider VARCHAR(50),
  queued_by VARCHAR(20),
  current_strategy VARCHAR(20),
  circuit_state VARCHAR(20) NOT NULL DEFAULT 'closed',
  circuit_opened_at TIMESTAMPTZ,
  circuit_backoff_until TIMESTAMPTZ,
  circuit_trip_count INTEGER NOT NULL DEFAULT 0,
  escalation_count INTEGER NOT NULL DEFAULT 0,
  last_escalated_at TIMESTAMPTZ,
  last_escalation_reason TEXT,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingestion_successes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code VARCHAR(2) NOT NULL REFERENCES ingestion_telemetry(state_code),
  completed_at TIMESTAMPTZ NOT NULL,
  records_processed INTEGER NOT NULL,
  strategy VARCHAR(20),
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingestion_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code VARCHAR(2) NOT NULL REFERENCES ingestion_telemetry(state_code),
  failed_at TIMESTAMPTZ NOT NULL,
  error TEXT NOT NULL,
  strategy VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingestion_fallbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code VARCHAR(2) NOT NULL REFERENCES ingestion_telemetry(state_code),
  escalated_at TIMESTAMPTZ NOT NULL,
  from_strategy VARCHAR(20) NOT NULL,
  to_strategy VARCHAR(20),
  reason TEXT NOT NULL,
  delay_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portal_probe_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code VARCHAR(2) NOT NULL,
  probe_timestamp TIMESTAMPTZ NOT NULL,
  reachable BOOLEAN NOT NULL,
  response_time_ms INTEGER,
  http_status INTEGER,
  schema_valid BOOLEAN NOT NULL DEFAULT true,
  anti_bot_detected BOOLEAN NOT NULL DEFAULT false,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS data_quality_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code VARCHAR(2) NOT NULL,
  job_id VARCHAR(100) NOT NULL,
  records_ingested INTEGER NOT NULL,
  volume_in_range BOOLEAN NOT NULL,
  field_completeness NUMERIC(5,2) NOT NULL,
  deduplication_rate NUMERIC(5,2) NOT NULL,
  filing_date_recency BOOLEAN NOT NULL,
  party_name_present NUMERIC(5,2) NOT NULL,
  passed BOOLEAN NOT NULL,
  warnings TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coverage_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type VARCHAR(50) NOT NULL,
  state_code VARCHAR(2),
  severity VARCHAR(20) NOT NULL DEFAULT 'medium',
  message TEXT NOT NULL,
  details JSONB,
  emailed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_successes_state_date ON ingestion_successes(state_code, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_failures_state_date ON ingestion_failures(state_code, failed_at DESC);
CREATE INDEX IF NOT EXISTS idx_fallbacks_state_date ON ingestion_fallbacks(state_code, escalated_at DESC);
CREATE INDEX IF NOT EXISTS idx_probes_state_date ON portal_probe_results(state_code, probe_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_dq_state_date ON data_quality_reports(state_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_type_date ON coverage_alerts(alert_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_state ON coverage_alerts(state_code, created_at DESC);

-- Seed all 50 states + DC into ingestion_telemetry
INSERT INTO ingestion_telemetry (state_code) VALUES
  ('AL'),('AK'),('AZ'),('AR'),('CA'),('CO'),('CT'),('DE'),('FL'),('GA'),
  ('HI'),('ID'),('IL'),('IN'),('IA'),('KS'),('KY'),('LA'),('ME'),('MD'),
  ('MA'),('MI'),('MN'),('MS'),('MO'),('MT'),('NE'),('NV'),('NH'),('NJ'),
  ('NM'),('NY'),('NC'),('ND'),('OH'),('OK'),('OR'),('PA'),('RI'),('SC'),
  ('SD'),('TN'),('TX'),('UT'),('VT'),('VA'),('WA'),('WV'),('WI'),('WY'),
  ('DC')
ON CONFLICT (state_code) DO NOTHING;
```

- [ ] **Step 2: Write the rollback**

```sql
-- 010_down.sql
DROP TABLE IF EXISTS coverage_alerts;
DROP TABLE IF EXISTS data_quality_reports;
DROP TABLE IF EXISTS portal_probe_results;
DROP TABLE IF EXISTS ingestion_fallbacks;
DROP TABLE IF EXISTS ingestion_failures;
DROP TABLE IF EXISTS ingestion_successes;
DROP TABLE IF EXISTS ingestion_telemetry;
```

- [ ] **Step 3: Append to schema.sql for reference**

Append the same SQL from step 1 to the end of `database/schema.sql` wrapped in a comment block noting it's migration 010.

- [ ] **Step 4: Run migration locally**

```bash
npm run db:migrate
```

Expected: Migration 010 applies successfully. Verify with `npm run db:test`.

- [ ] **Step 5: Commit**

```bash
git add database/migrations/010_ingestion_telemetry.sql database/migrations/010_down.sql database/schema.sql
git commit -m "feat(db): add telemetry persistence tables (migration 010)"
```

---

## Task 2: TelemetryPersistenceService

**Files:**

- Create: `server/services/TelemetryPersistenceService.ts`
- Create: `server/__tests__/services/TelemetryPersistenceService.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:

1. `persistTelemetryState` — upserts a row into `ingestion_telemetry`
2. `hydrateFromDatabase` — reads all rows, returns `Map<string, IngestionCoverageTelemetry>`
3. `recordSuccess` — inserts into `ingestion_successes` and updates telemetry row
4. `recordFailure` — inserts into `ingestion_failures` and updates telemetry row
5. `recordFallback` — inserts into `ingestion_fallbacks` and updates telemetry row
6. `pruneHistory` — deletes records older than 30 days
7. `hydrateFromDatabase` returns empty map when table is empty (after seed truncation)

Mock the database module (`server/database/connection.ts`) with `vi.mock`. Each test should verify the SQL query structure and parameters.

```bash
npm run test:server -- --run server/__tests__/services/TelemetryPersistenceService.test.ts
```

Expected: All tests FAIL (module not found).

- [ ] **Step 2: Implement TelemetryPersistenceService**

The service wraps the database client with methods that map between the `IngestionCoverageTelemetry` interface (from `queues.ts`) and the PostgreSQL `ingestion_telemetry` table.

Key methods:

```typescript
export class TelemetryPersistenceService {
  constructor(private db: DatabaseClient) {}

  async persistState(state: string, telemetry: IngestionCoverageTelemetry): Promise<void>
  // INSERT ... ON CONFLICT (state_code) DO UPDATE

  async hydrateAll(): Promise<Map<string, IngestionCoverageTelemetry>>
  // SELECT from ingestion_telemetry + LEFT JOIN recent successes/failures/fallbacks

  async recordSuccess(
    state: string,
    completedAt: string,
    recordsProcessed: number,
    strategy?: string,
    durationMs?: number
  ): Promise<void>
  // INSERT into ingestion_successes

  async recordFailure(
    state: string,
    failedAt: string,
    error: string,
    strategy?: string
  ): Promise<void>
  // INSERT into ingestion_failures

  async recordFallback(
    state: string,
    escalatedAt: string,
    fromStrategy: string,
    toStrategy: string | null,
    reason: string,
    delayMs?: number
  ): Promise<void>
  // INSERT into ingestion_fallbacks

  async pruneHistory(retentionDays: number = 30): Promise<{ deleted: number }>
  // DELETE FROM ingestion_successes/failures/fallbacks WHERE created_at < NOW() - interval
}
```

Import `DatabaseClient` from `server/database/connection.ts`. Use parameterized queries (`$1`, `$2`, ...) for all SQL. The `persistState` method maps camelCase JS fields to snake_case SQL columns.

- [ ] **Step 3: Run tests**

```bash
npm run test:server -- --run server/__tests__/services/TelemetryPersistenceService.test.ts
```

Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add server/services/TelemetryPersistenceService.ts server/__tests__/services/TelemetryPersistenceService.test.ts
git commit -m "feat: add TelemetryPersistenceService for DB-backed telemetry"
```

---

## Task 3: Wire Persistence Hooks into queues.ts

**Files:**

- Modify: `server/queue/queues.ts`
- Modify: `server/routes/health.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Add persistence hook to queues.ts**

After each `recordIngestion*` function updates the in-memory map, add a fire-and-forget call to the persistence service:

```typescript
// At top of queues.ts
import { TelemetryPersistenceService } from '../services/TelemetryPersistenceService'
import { database } from '../database/connection'

let persistenceService: TelemetryPersistenceService | null = null

export function initTelemetryPersistence(): void {
  persistenceService = new TelemetryPersistenceService(database)
}

export async function hydrateTelemetryFromDatabase(): Promise<void> {
  if (!persistenceService) return
  const persisted = await persistenceService.hydrateAll()
  // Merge persisted data into the in-memory map (only for states not already populated)
  for (const [state, telemetry] of persisted) {
    if (!ingestionCoverageTelemetry.has(state)) {
      ingestionCoverageTelemetry.set(state, telemetry)
    }
  }
}
```

In each `recordIngestionCompleted`, `recordIngestionFailed`, `recordIngestionFallbackEscalated`:

```typescript
// After updating in-memory state, persist async (don't await — fire and forget)
const t = ingestionCoverageTelemetry.get(state)
if (persistenceService && t) {
  persistenceService
    .persistState(state, t)
    .catch((err) => console.error(`[telemetry] Failed to persist ${state}:`, err.message))
}
```

For `recordIngestionCompleted`, also call:

```typescript
persistenceService
  ?.recordSuccess(state, timestamp, recordsProcessed, strategy, durationMs)
  .catch((err) => console.error(`[telemetry] Failed to record success:`, err.message))
```

Similarly for failures and fallbacks.

- [ ] **Step 2: Add hydration to server/index.ts startup**

In the server's `start()` method (or equivalent initialization), after database connect:

```typescript
import { initTelemetryPersistence, hydrateTelemetryFromDatabase } from './queue/queues'

// After database.connect()
initTelemetryPersistence()
await hydrateTelemetryFromDatabase()
console.log('[telemetry] Hydrated from database')
```

- [ ] **Step 3: Add DB fallback to health.ts**

In the `/api/health/coverage` handler, if the in-memory telemetry for a state is empty (no successes, no failures), check if the telemetry was hydrated. This is already handled by step 2, but add a defensive note:

```typescript
// The telemetry map is hydrated from DB on startup.
// If a state has no in-memory telemetry, it genuinely has no history.
```

- [ ] **Step 4: Run existing health route tests**

```bash
npm run test:server -- --run server/__tests__/routes/health.test.ts
```

Expected: All 19 existing tests still PASS (persistence is fire-and-forget, doesn't change route behavior).

- [ ] **Step 5: Commit**

```bash
git add server/queue/queues.ts server/index.ts server/routes/health.ts
git commit -m "feat: wire telemetry persistence hooks into queue system"
```

---

## Task 4: Data Quality Service + Config

**Files:**

- Create: `server/config/dataQuality.ts`
- Create: `server/services/DataQualityService.ts`
- Create: `server/__tests__/services/DataQualityService.test.ts`

- [ ] **Step 1: Write dataQuality config**

```typescript
// server/config/dataQuality.ts
export interface StateVolumeExpectation {
  min: number
  max: number
  period: 'daily' | 'weekly'
}

export const STATE_VOLUME_EXPECTATIONS: Record<string, StateVolumeExpectation> = {
  CA: { min: 50, max: 2000, period: 'daily' },
  TX: { min: 30, max: 1500, period: 'daily' },
  FL: { min: 20, max: 1000, period: 'daily' },
  NY: { min: 40, max: 1800, period: 'daily' },
  IL: { min: 20, max: 1200, period: 'daily' },
  PA: { min: 15, max: 1000, period: 'daily' },
  OH: { min: 15, max: 800, period: 'daily' },
  GA: { min: 10, max: 600, period: 'daily' },
  NC: { min: 10, max: 500, period: 'daily' },
  MI: { min: 10, max: 500, period: 'daily' }
}

export const DEFAULT_VOLUME_EXPECTATION: StateVolumeExpectation = {
  min: 5,
  max: 500,
  period: 'daily'
}

export const FIELD_COMPLETENESS_THRESHOLD = 0.8 // 80% of records must have all required fields
export const PARTY_NAME_THRESHOLD = 0.9 // 90% must have debtor + secured party
export const MAX_DEDUPLICATION_RATE = 0.3 // If >30% are dupes, something is wrong
export const RECENCY_WINDOW_DAYS = 30 // At least some filings in last 30 days
```

- [ ] **Step 2: Write failing tests for DataQualityService**

Test cases:

1. `validateBatch` returns passing report for good data
2. `validateBatch` flags low volume (below min)
3. `validateBatch` flags high deduplication rate
4. `validateBatch` flags low field completeness
5. `validateBatch` flags missing party names
6. `validateBatch` flags no recent filings
7. `validateBatch` uses default expectations for unconfigured states
8. `persistReport` stores to database

```bash
npm run test:server -- --run server/__tests__/services/DataQualityService.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement DataQualityService**

```typescript
export class DataQualityService {
  constructor(private db: DatabaseClient) {}

  validateBatch(stateCode: string, jobId: string, filings: UCCFiling[]): DataQualityReport
  // Pure function — checks volume, completeness, dedup, recency, party names
  // Returns { passed, assertions, warnings }

  async persistReport(report: DataQualityReport): Promise<void>
  // INSERT into data_quality_reports
}
```

The `validateBatch` method:

- Looks up `STATE_VOLUME_EXPECTATIONS[stateCode]` or falls back to default
- Checks `filings.length` against min/max range
- Counts filings with `filingNumber && filingDate && debtor?.name && securedParty?.name`
- Counts duplicates by `filingNumber`
- Checks if any filing has `filingDate` within the last `RECENCY_WINDOW_DAYS`
- Computes `passed = volumeInRange && fieldCompleteness >= threshold && deduplicationRate <= max && partyNamePresent >= threshold`

- [ ] **Step 4: Run tests**

```bash
npm run test:server -- --run server/__tests__/services/DataQualityService.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add server/config/dataQuality.ts server/services/DataQualityService.ts server/__tests__/services/DataQualityService.test.ts
git commit -m "feat: add DataQualityService with post-ingestion validation"
```

---

## Task 5: Wire DQ into Ingestion Worker

**Files:**

- Modify: `server/queue/workers/ingestionWorker.ts`

- [ ] **Step 1: Add DQ validation after persistCollectedFilings**

In the ingestion worker's success path, after `persistCollectedFilings()`:

```typescript
import { DataQualityService } from '../../services/DataQualityService'

// After: const persisted = await persistCollectedFilings(filings, job.id)
const dqService = new DataQualityService(database)
const dqReport = dqService.validateBatch(job.data.state, job.id, filings)

if (!dqReport.passed) {
  console.warn(`[ingestion] Data quality warnings for ${job.data.state}:`, dqReport.warnings)
}

// Persist report async (don't block job completion)
dqService
  .persistReport(dqReport)
  .catch((err) => console.error(`[ingestion] Failed to persist DQ report:`, err.message))
```

- [ ] **Step 2: Run existing ingestion worker tests**

```bash
npm run test:server -- --run server/__tests__/queue/workers/ingestionWorker.test.ts
```

Expected: All existing tests PASS (DQ is additive, doesn't change success/failure flow).

- [ ] **Step 3: Commit**

```bash
git add server/queue/workers/ingestionWorker.ts
git commit -m "feat: add data quality validation to ingestion worker"
```

---

## Task 6: Coverage Alert Service

**Files:**

- Create: `server/services/CoverageAlertService.ts`
- Create: `server/__tests__/services/CoverageAlertService.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:

1. `handleAlert` with `circuit_opened` logs to database
2. `handleAlert` with `probe_failed` logs and sends email
3. `handleAlert` debounces duplicate alerts within 1-hour cooldown
4. `handleAlert` allows same alert type after cooldown expires
5. `handleAlert` with `state_status_changed` (green→red) sends email
6. `handleAlert` with `data_quality_failed` logs warning only (no email)
7. `getRecentAlerts` returns alerts from last N hours

- [ ] **Step 2: Implement CoverageAlertService**

```typescript
export type AlertTrigger =
  | { type: 'circuit_opened'; stateCode: string; reason: string }
  | { type: 'probe_failed'; stateCode: string; error: string }
  | { type: 'schema_change_detected'; stateCode: string }
  | { type: 'data_quality_failed'; stateCode: string; warnings: string[] }
  | { type: 'state_status_changed'; stateCode: string; from: CoverageStatus; to: CoverageStatus }

export class CoverageAlertService {
  private cooldowns: Map<string, number> = new Map() // key → timestamp
  private readonly COOLDOWN_MS = 60 * 60 * 1000 // 1 hour

  constructor(private db: DatabaseClient) {}

  async handleAlert(trigger: AlertTrigger): Promise<void>
  // 1. Check cooldown (key = `${trigger.type}:${trigger.stateCode}`)
  // 2. Log to coverage_alerts table
  // 3. If critical (circuit_opened, probe_failed, schema_change, status→red): send email
  // 4. Set cooldown

  async getRecentAlerts(hours: number = 24): Promise<CoverageAlert[]>
  // SELECT from coverage_alerts WHERE created_at > NOW() - interval

  private shouldEmail(trigger: AlertTrigger): boolean
  // Returns true for circuit_opened, probe_failed, schema_change_detected,
  // and state_status_changed where to === 'red'

  private async sendAlertEmail(trigger: AlertTrigger): Promise<void>
  // Uses SendGridClient if configured, otherwise logs "email not configured"
}
```

- [ ] **Step 3: Run tests**

```bash
npm run test:server -- --run server/__tests__/services/CoverageAlertService.test.ts
```

Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add server/services/CoverageAlertService.ts server/__tests__/services/CoverageAlertService.test.ts
git commit -m "feat: add CoverageAlertService with debounced email notifications"
```

---

## Task 7: Portal Probe Worker

**Files:**

- Create: `server/queue/workers/portalProbeWorker.ts`
- Create: `server/__tests__/queue/workers/portalProbeWorker.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:

1. `probeState('CA')` makes HTTP request to CA SOS API health endpoint
2. `probeState` returns `PortalProbeResult` with reachable=true on 200
3. `probeState` returns reachable=false on timeout/network error
4. `probeState` detects anti-bot (CAPTCHA markers in response)
5. `processProbeJob` probes all scheduled states
6. `processProbeJob` opens circuit for states with failed probes
7. `processProbeJob` persists results to `portal_probe_results`
8. `processProbeJob` triggers alert on probe failure

Mock `fetch` globally. Mock `database` and `CoverageAlertService`.

- [ ] **Step 2: Implement portalProbeWorker**

```typescript
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

// Probe endpoint registry
const PROBE_ENDPOINTS: Record<string, { url: string; method: 'GET' | 'HEAD'; markers?: string[] }> =
  {
    CA: { url: 'https://bizfileonline.sos.ca.gov', method: 'HEAD' },
    TX: { url: 'https://direct.sos.state.tx.us', method: 'HEAD' },
    FL: { url: 'https://www.sunbiz.org', method: 'HEAD' },
    NY: {
      url: 'https://appext20.dos.ny.gov/pls/ucc_public/web_search.main_frame',
      method: 'GET',
      markers: ['ucc_public']
    }
  }

const CAPTCHA_MARKERS = [
  'captcha',
  'recaptcha',
  'hcaptcha',
  'challenge-platform',
  'cf-browser-verification'
]

export async function probeState(stateCode: string): Promise<PortalProbeResult>
// 1. Look up endpoint, 2. Fetch with 10s timeout, 3. Check for CAPTCHA markers, 4. Return result

export async function processProbeJob(job: Job): Promise<void>
// 1. Get SCHEDULED_STATES, 2. Probe each, 3. Persist results, 4. Open circuits for failures, 5. Alert
```

- [ ] **Step 3: Run tests**

```bash
npm run test:server -- --run server/__tests__/queue/workers/portalProbeWorker.test.ts
```

Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add server/queue/workers/portalProbeWorker.ts server/__tests__/queue/workers/portalProbeWorker.test.ts
git commit -m "feat: add portal probe worker for proactive health monitoring"
```

---

## Task 8: Weekly Digest Worker

**Files:**

- Create: `server/queue/workers/digestWorker.ts`
- Create: `server/__tests__/queue/workers/digestWorker.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:

1. `compileDigest` returns coverage summary with 7-day metrics
2. `compileDigest` includes circuit breaker events
3. `compileDigest` includes data quality warnings
4. `compileDigest` includes probe failures
5. `renderDigestHtml` produces valid HTML with status grid
6. `processDigestJob` compiles + sends email via SendGrid

- [ ] **Step 2: Implement digestWorker**

```typescript
export interface CoverageDigest {
  generatedAt: string
  period: { from: string; to: string }
  overall: { green: number; yellow: number; red: number }
  totalRecordsCollected: number
  recordsByState: Record<string, number>
  circuitEvents: { state: string; event: string; timestamp: string }[]
  dqWarnings: { state: string; warnings: string[]; timestamp: string }[]
  probeFailures: { state: string; error: string; timestamp: string }[]
  topPerformers: string[] // States with most records
  degraded: string[] // States that went yellow/red this week
}

export async function compileDigest(db: DatabaseClient): Promise<CoverageDigest>
// Query ingestion_successes, ingestion_failures, coverage_alerts, data_quality_reports, portal_probe_results
// All WHERE created_at > NOW() - INTERVAL '7 days'

export function renderDigestHtml(digest: CoverageDigest): string
// Tagged template literal producing a clean HTML email

export async function processDigestJob(job: Job): Promise<void>
// 1. compileDigest(), 2. renderDigestHtml(), 3. Send via SendGrid (fail-closed if not configured)
```

- [ ] **Step 3: Run tests**

```bash
npm run test:server -- --run server/__tests__/queue/workers/digestWorker.test.ts
```

Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add server/queue/workers/digestWorker.ts server/__tests__/queue/workers/digestWorker.test.ts
git commit -m "feat: add weekly coverage digest email worker"
```

---

## Task 9: Wire New Queues + Schedules

**Files:**

- Modify: `server/queue/queues.ts`
- Modify: `server/queue/scheduler.ts`

- [ ] **Step 1: Add new queue definitions to queues.ts**

```typescript
// New job data interfaces
export interface PortalProbeJobData {
  states: string[]
  triggeredBy: 'scheduler' | 'manual'
}

export interface DigestJobData {
  periodDays: number
  recipients: string[]
}

// New queue getters (same pattern as existing)
let portalProbeQueue: Queue<PortalProbeJobData> | null = null
let digestQueue: Queue<DigestJobData> | null = null

export function getPortalProbeQueue(): Queue<PortalProbeJobData> { ... }
export function getDigestQueue(): Queue<DigestJobData> { ... }
```

- [ ] **Step 2: Add schedules to scheduler.ts**

```typescript
// Portal probes: daily at 1:30 AM (30 min before ingestion)
this.scheduleDaily('portal-probes', 1, 30, async () => {
  const queue = getPortalProbeQueue()
  await queue.add('probe-all', {
    states: SCHEDULED_STATES,
    triggeredBy: 'scheduler'
  })
})

// Coverage digest: weekly Monday at 9:00 AM
this.scheduleWeekly('coverage-digest', 1, 9, 0, async () => {
  const queue = getDigestQueue()
  await queue.add('weekly-digest', {
    periodDays: 7,
    recipients: [process.env.DIGEST_RECIPIENT_EMAIL || '']
  })
})
```

Note: `scheduleWeekly` doesn't exist yet — add it to the scheduler following the same pattern as `scheduleDaily`.

- [ ] **Step 3: Run existing scheduler tests**

```bash
npm run test:server -- --run server/__tests__/queue/scheduler.test.ts
```

Expected: All existing tests PASS.

- [ ] **Step 4: Commit**

```bash
git add server/queue/queues.ts server/queue/scheduler.ts
git commit -m "feat: wire portal probe and digest queues into scheduler"
```

---

## Task 10: Standalone Status Page

**Files:**

- Create: `server/routes/status.ts`
- Create: `server/__tests__/routes/status.test.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Write failing tests**

Test cases:

1. `GET /status` returns 200 with `Content-Type: text/html`
2. Response contains all 50 state codes
3. Response contains `<meta http-equiv="refresh" content="60">`
4. Green/yellow/red CSS classes present
5. High-value states (CA, TX, FL, NY) appear in their own section
6. Response includes last-pull timestamps when available

- [ ] **Step 2: Implement status.ts**

```typescript
import { Router } from 'express'
import { getIngestionCoverageTelemetry } from '../queue/queues'

const router = Router()

router.get('/status', (_req, res) => {
  const telemetry = getIngestionCoverageTelemetry()
  const html = renderStatusPage(telemetry)
  res.type('html').send(html)
})

function renderStatusPage(telemetry: IngestionCoverageTelemetry[]): string {
  // Server-rendered HTML with:
  // - <meta http-equiv="refresh" content="60">
  // - Inline CSS (no external deps)
  // - 50-state grid with colored dots (green/yellow/red/gray)
  // - High-value section (CA, TX, FL, NY)
  // - Last-pull timestamps per state
  // - Overall summary bar
  // - "Powered by UCC-MCA Intelligence Platform" footer
}
```

- [ ] **Step 3: Mount in server/index.ts**

```typescript
import statusRouter from './routes/status'

// In setupRoutes(), BEFORE auth middleware:
this.app.use(statusRouter) // No /api prefix, no auth
```

- [ ] **Step 4: Run tests**

```bash
npm run test:server -- --run server/__tests__/routes/status.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/status.ts server/__tests__/routes/status.test.ts server/index.ts
git commit -m "feat: add standalone /status page for bookmarkable coverage view"
```

---

## Task 11: Frontend — useCoverageDashboard Hook

**Files:**

- Create: `apps/web/src/hooks/useCoverageDashboard.ts`
- Create: `apps/web/src/hooks/__tests__/useCoverageDashboard.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:

1. Hook returns `snapshot`, `loading`, `error`, `lastRefreshed`, `refresh`
2. Initial load triggers fetch
3. Polling fires every 30 seconds
4. Polling pauses when document is hidden (visibility API)
5. Polling resumes when document becomes visible
6. Manual `refresh()` triggers immediate fetch
7. Error state set when fetch fails
8. Falls back to preview data when API unreachable and `fallbackToPreview=true`

Mock `fetchCoverageDashboard` and `document.visibilityState`.

- [ ] **Step 2: Implement useCoverageDashboard**

```typescript
export interface UseCoverageDashboardOptions {
  pollIntervalMs?: number // default 30000
  fallbackToPreview?: boolean // default false
  enabled?: boolean // default true
}

export function useCoverageDashboard(options?: UseCoverageDashboardOptions) {
  // useState for snapshot, loading, error, lastRefreshed
  // useEffect for initial fetch
  // useEffect for polling interval (clears on unmount)
  // useEffect for visibility change listener (pause/resume)
  // useCallback for manual refresh
}
```

- [ ] **Step 3: Run tests**

```bash
npx vitest --config apps/web/vitest.config.ts --run src/hooks/__tests__/useCoverageDashboard.test.ts
```

Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/hooks/useCoverageDashboard.ts apps/web/src/hooks/__tests__/useCoverageDashboard.test.ts
git commit -m "feat: add useCoverageDashboard hook with polling and visibility pause"
```

---

## Task 12: Frontend — CoverageTab + App Integration

**Files:**

- Create: `apps/web/src/features/coverage/CoverageTab.tsx`
- Create: `apps/web/src/features/coverage/__tests__/CoverageTab.test.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Write failing tests for CoverageTab**

Test cases:

1. Renders CoverageDashboard component
2. Shows "Last refreshed X seconds ago" indicator
3. Shows manual refresh button
4. Passes `usePreviewData={false}` by default
5. Falls back to preview mode with banner when API unavailable

- [ ] **Step 2: Implement CoverageTab**

```typescript
import { CoverageDashboard } from '@/components/CoverageDashboard'
import { useCoverageDashboard } from '@/hooks/useCoverageDashboard'

export function CoverageTab() {
  const { snapshot, loading, error, lastRefreshed, refresh } = useCoverageDashboard({
    pollIntervalMs: 30000,
    fallbackToPreview: true
  })

  return (
    <div className="space-y-4">
      {/* Refresh indicator bar */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {lastRefreshed ? `Last refreshed ${formatRelativeTime(lastRefreshed)}` : 'Loading...'}
        </span>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <ArrowsClockwise className={loading ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      <CoverageDashboard snapshot={snapshot} />
    </div>
  )
}
```

Note: This requires updating `CoverageDashboard` to accept an optional `snapshot` prop directly instead of fetching internally. If the component already has that capability via `usePreviewData`, use the existing pattern. If not, add a `snapshot` prop that bypasses the internal fetch.

- [ ] **Step 3: Add Coverage tab to App.tsx**

In the tab bar section of `App.tsx`, add between Analytics and Agentic:

```typescript
import { CoverageTab } from '@/features/coverage/CoverageTab'

// In the tabs array or JSX:
<TabsTrigger value="coverage">Coverage</TabsTrigger>

// In the tab content:
<TabsContent value="coverage">
  <CoverageTab />
</TabsContent>
```

- [ ] **Step 4: Run tests**

```bash
npx vitest --config apps/web/vitest.config.ts --run src/features/coverage/__tests__/CoverageTab.test.tsx
```

Expected: All PASS.

- [ ] **Step 5: Run full frontend test suite (targeted)**

```bash
npx vitest --config apps/web/vitest.config.ts --run src/features/coverage src/hooks/__tests__/useCoverageDashboard.test.ts src/components/CoverageDashboard.test.tsx
```

Expected: All PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/coverage/ apps/web/src/App.tsx
git commit -m "feat: add Coverage tab with auto-refresh polling"
```

---

## Task 13: Update Test Setup + Final Integration

**Files:**

- Modify: `server/__tests__/setup.ts`

- [ ] **Step 1: Add new tables to truncate list**

In `server/__tests__/setup.ts`, add to the truncation query:

```typescript
;(coverage_alerts,
  data_quality_reports,
  portal_probe_results,
  ingestion_fallbacks,
  ingestion_failures,
  ingestion_successes,
  ingestion_telemetry)
```

Note: `ingestion_telemetry` must be last (others have FK references to it), or use `CASCADE`.

- [ ] **Step 2: Run full server test suite**

```bash
npm run test:server -- --run
```

Expected: All tests PASS (existing + new).

- [ ] **Step 3: Run ESLint on all new/modified files**

```bash
npx eslint server/services/TelemetryPersistenceService.ts server/services/DataQualityService.ts server/services/CoverageAlertService.ts server/config/dataQuality.ts server/queue/workers/portalProbeWorker.ts server/queue/workers/digestWorker.ts server/routes/status.ts server/queue/queues.ts server/queue/scheduler.ts server/queue/workers/ingestionWorker.ts server/index.ts
```

Expected: Clean (0 errors, 0 warnings).

- [ ] **Step 4: Commit**

```bash
git add server/__tests__/setup.ts
git commit -m "chore: add telemetry tables to test truncation setup"
```

---

## Task 14: Final Verification + Integration Commit

- [ ] **Step 1: Run all frontend tests (targeted)**

```bash
npx vitest --config apps/web/vitest.config.ts --run src/features/coverage src/hooks/__tests__/useCoverageDashboard.test.ts src/components/CoverageDashboard.test.tsx src/components/__tests__/AnalyticsDashboard.test.tsx
```

Expected: All PASS.

- [ ] **Step 2: Run all server tests**

```bash
npm run test:server -- --run
```

Expected: All PASS.

- [ ] **Step 3: Verify /status page renders**

```bash
npm run dev:server &
sleep 3
curl -s http://localhost:3000/status | head -20
kill %1
```

Expected: HTML response with state grid.

- [ ] **Step 4: Final commit if any integration fixes needed**

```bash
git add -A
git commit -m "feat: SP1 coverage dashboard + health monitoring — complete"
```

---

## Summary

| Task      | Description                   | New Tests           |
| --------- | ----------------------------- | ------------------- |
| 1         | Database migration            | —                   |
| 2         | TelemetryPersistenceService   | 7                   |
| 3         | Wire persistence hooks        | 0 (regression only) |
| 4         | DataQualityService + config   | 8                   |
| 5         | Wire DQ into ingestion worker | 0 (regression only) |
| 6         | CoverageAlertService          | 7                   |
| 7         | Portal Probe Worker           | 8                   |
| 8         | Weekly Digest Worker          | 6                   |
| 9         | Wire queues + schedules       | 0 (regression only) |
| 10        | Standalone /status page       | 6                   |
| 11        | useCoverageDashboard hook     | 8                   |
| 12        | CoverageTab + App integration | 5                   |
| 13        | Test setup + integration      | 0 (cleanup)         |
| 14        | Final verification            | 0 (verification)    |
| **Total** | **14 tasks**                  | **~55 new tests**   |
