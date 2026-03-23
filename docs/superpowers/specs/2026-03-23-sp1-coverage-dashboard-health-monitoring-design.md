# SP1: Coverage Dashboard + Health Monitoring — Design Spec

**Date:** 2026-03-23
**Status:** Draft
**Priority:** P0
**Effort:** Full Phase 1 (approach B from evolution prompt)

---

## Goal

Deliver the exact thing promised to Tony: "health monitoring per state, auto-failover, and a simple dashboard you could check anytime to see coverage status (green/yellow/red per state with last-pull timestamps)." Plus proactive monitoring, alerts, data quality assertions, and weekly digest.

## What Already Exists

| Component                                                  | Location                                             | Status                          |
| ---------------------------------------------------------- | ---------------------------------------------------- | ------------------------------- |
| Circuit breakers (per-state, exponential backoff)          | `server/queue/queues.ts`                             | Wired                           |
| Self-heal with fallback escalation                         | `server/queue/workers/ingestionWorker.ts`            | Wired                           |
| Ingestion telemetry (queued/started/completed/failed)      | `server/queue/queues.ts`                             | In-memory only                  |
| 50-state coverage API (`/api/health/coverage`)             | `server/routes/health.ts`                            | Wired                           |
| Per-state coverage API (`/api/health/coverage/:stateCode`) | `server/routes/health.ts`                            | Wired                           |
| CoverageDashboard frontend component                       | `apps/web/src/components/CoverageDashboard.tsx`      | Wired (buried in Analytics tab) |
| API client (`fetchCoverageDashboard`)                      | `apps/web/src/lib/api/health.ts`                     | Wired                           |
| Preview snapshot generator                                 | `apps/web/src/lib/api/health.ts`                     | Wired                           |
| Server health tests (19 cases)                             | `server/__tests__/routes/health.test.ts`             | Passing                         |
| Frontend coverage tests (2 cases)                          | `apps/web/src/components/CoverageDashboard.test.tsx` | Passing                         |
| KNOWN_FUNDERS database (30+ entries)                       | `server/services/StackAnalysisService.ts`            | Wired                           |
| Scheduler with circuit gate checks                         | `server/queue/scheduler.ts`                          | Wired                           |

## What's Missing (This Spec)

### 1. Telemetry Persistence

**Problem:** All telemetry lives in a `Map<string, IngestionCoverageTelemetry>` in `queues.ts`. Process restart = total loss.

**Solution:** PostgreSQL table `ingestion_telemetry` that stores per-state telemetry with history.

**Schema:**

```sql
-- Core telemetry state per state (one row per state)
CREATE TABLE ingestion_telemetry (
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

-- History tables for time-series data (30-day retention)
CREATE TABLE ingestion_successes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code VARCHAR(2) NOT NULL REFERENCES ingestion_telemetry(state_code),
  completed_at TIMESTAMPTZ NOT NULL,
  records_processed INTEGER NOT NULL,
  strategy VARCHAR(20),
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ingestion_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code VARCHAR(2) NOT NULL REFERENCES ingestion_telemetry(state_code),
  failed_at TIMESTAMPTZ NOT NULL,
  error TEXT NOT NULL,
  strategy VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ingestion_fallbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code VARCHAR(2) NOT NULL REFERENCES ingestion_telemetry(state_code),
  escalated_at TIMESTAMPTZ NOT NULL,
  from_strategy VARCHAR(20) NOT NULL,
  to_strategy VARCHAR(20),
  reason TEXT NOT NULL,
  delay_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_successes_state_date ON ingestion_successes(state_code, completed_at DESC);
CREATE INDEX idx_failures_state_date ON ingestion_failures(state_code, failed_at DESC);
CREATE INDEX idx_fallbacks_state_date ON ingestion_fallbacks(state_code, escalated_at DESC);

-- 30-day retention cleanup (run daily)
-- DELETE FROM ingestion_successes WHERE created_at < NOW() - INTERVAL '30 days';
-- DELETE FROM ingestion_failures WHERE created_at < NOW() - INTERVAL '30 days';
-- DELETE FROM ingestion_fallbacks WHERE created_at < NOW() - INTERVAL '30 days';
```

**Integration pattern:**

- New service: `server/services/TelemetryPersistenceService.ts`
- Wraps existing in-memory telemetry functions — writes to both memory AND database
- On process startup: hydrate in-memory map from database (ensures continuity)
- Existing `recordIngestion*` functions in `queues.ts` get a persistence hook — they call the service after updating in-memory state
- The `/api/health/coverage` route continues reading from in-memory (fast path) with DB as fallback if memory is empty (cold start)

### 2. Proactive Portal Health Probes

**Problem:** Currently, we only learn a state portal is down when a full ingestion job fails. By then we've already wasted time and hit rate limits.

**Solution:** Lightweight "probe" jobs that run daily before ingestion, testing each portal's availability without performing full collection.

**New queue:** `portal-health-probes`

**Probe behavior per state:**

- CA (API): `HEAD` request to `https://bizfileonline.sos.ca.gov/api/v1/health` or equivalent
- TX (Bulk): Check that the SOSDirect bulk endpoint responds
- FL (Vendor): Check CSC/CT Corp API availability
- NY (Scrape): Lightweight HTTP GET to the portal's main frame URL, check for expected DOM markers

**Probe result:**

```typescript
interface PortalProbeResult {
  stateCode: string
  probeTimestamp: string
  reachable: boolean
  responseTimeMs: number
  httpStatus: number | null
  schemaValid: boolean // Did the response match expected structure?
  antiBot: boolean // Was a CAPTCHA or block page returned?
  error: string | null
}
```

**Probe schedule:** Daily at 1:30 AM (30 min before ingestion at 2:00 AM)

**Probe worker:** `server/queue/workers/portalProbeWorker.ts`

- Per-state probe functions registered in a map (same pattern as collectors)
- Results stored in new `portal_probe_results` table
- If probe fails: open circuit for that state BEFORE ingestion runs, log alert
- If probe detects schema change (e.g., different HTML structure for scrape targets): log `STRUCTURE_CHANGE` alert

**Schema:**

```sql
CREATE TABLE portal_probe_results (
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

CREATE INDEX idx_probes_state_date ON portal_probe_results(state_code, probe_timestamp DESC);
```

### 3. Data Quality Assertions

**Problem:** Even if ingestion succeeds, the data could be garbage (empty filings, missing fields, duplicate records, unexpectedly low volume).

**Solution:** Post-ingestion validation step in the ingestion worker.

**Assertions per batch:**

```typescript
interface DataQualityReport {
  stateCode: string
  jobId: string
  timestamp: string
  recordsIngested: number
  assertions: {
    volumeInRange: boolean // Records within expected range for this state
    expectedVolumeRange: [number, number]
    fieldCompleteness: number // % of records with all required fields
    deduplicationRate: number // % of records that were duplicates
    filingDateRecency: boolean // At least some filings from recent period
    partyNamePresent: number // % with debtor + secured party
  }
  passed: boolean
  warnings: string[]
}
```

**Volume expectations per state** (configurable in `server/config/dataQuality.ts`):

```typescript
const STATE_VOLUME_EXPECTATIONS: Record<
  string,
  { min: number; max: number; period: 'daily' | 'weekly' }
> = {
  CA: { min: 50, max: 2000, period: 'daily' },
  TX: { min: 30, max: 1500, period: 'daily' },
  FL: { min: 20, max: 1000, period: 'daily' },
  NY: { min: 40, max: 1800, period: 'daily' }
  // ... other states with defaults
}
```

**Integration:** After `persistCollectedFilings()` in the ingestion worker, run `validateDataQuality()`. If assertions fail, log warnings but don't fail the job — this is observability, not a gate.

**Storage:** `data_quality_reports` table for historical tracking.

```sql
CREATE TABLE data_quality_reports (
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

CREATE INDEX idx_dq_state_date ON data_quality_reports(state_code, created_at DESC);
```

### 4. Dashboard Promotion + Auto-Refresh

**Problem:** CoverageDashboard is buried inside the Analytics tab as a sub-component. Tony can't "check anytime" — he has to navigate to Analytics → scroll down.

**Solution:**

**4a. New top-level "Coverage" tab in `App.tsx`:**

- Add `CoverageTab` to the main tab bar (between Analytics and Agentic)
- CoverageTab renders CoverageDashboard with `usePreviewData={false}` by default (uses real API)
- Falls back to preview mode with banner if API is unreachable

**4b. Auto-refresh via polling:**

- `useCoverageDashboard` hook that calls `fetchCoverageDashboard()` every 30 seconds
- Shows "Last refreshed X seconds ago" indicator
- Pauses polling when tab is not active (visibility API)
- Manual refresh button

**4c. Standalone status page at `/status`:**

- Minimal HTML page served by Express (not the React SPA)
- No auth required — Tony can bookmark it
- Server-rendered green/yellow/red grid with last-pull timestamps
- Auto-refreshes every 60 seconds via `<meta http-equiv="refresh">`
- Route: `server/routes/status.ts` → `GET /status`

### 5. Alert Pipeline

**Problem:** When a state goes red or a probe fails, nobody knows until they check the dashboard.

**Solution:** Alert on state transitions (green→yellow, yellow→red, probe failure, circuit open).

**Alert channels (using existing integrations):**

- SendGrid email (already wired, fail-closed) — for weekly digest and critical alerts
- Console logging (always available) — for all transitions

**Alert triggers:**

```typescript
type AlertTrigger =
  | { type: 'circuit_opened'; stateCode: string; reason: string }
  | { type: 'probe_failed'; stateCode: string; error: string }
  | { type: 'schema_change_detected'; stateCode: string }
  | { type: 'data_quality_failed'; stateCode: string; warnings: string[] }
  | { type: 'state_status_changed'; stateCode: string; from: CoverageStatus; to: CoverageStatus }
```

**Implementation:** `server/services/CoverageAlertService.ts`

- Subscribes to telemetry events
- Debounces repeated alerts for same state (1 hour cooldown)
- Logs all alerts to `coverage_alerts` table
- Sends email for `circuit_opened`, `probe_failed`, `schema_change_detected` (critical only)

### 6. Weekly Email Digest

**Problem:** Tony wants a regular summary without checking the dashboard.

**Solution:** Scheduled BullMQ job (weekly, Monday 9 AM) that compiles a coverage report and sends via SendGrid.

**Digest content:**

- Overall status (X green, Y yellow, Z red)
- Records collected per state (7-day total)
- Circuit breaker events this week
- Data quality warnings
- Probe failures
- Top-performing vs. degraded states

**New queue:** `coverage-digest` with weekly cron schedule

**Template:** HTML email rendered server-side (no external template service needed — use tagged template literals).

---

## Architecture Summary

```
                    ┌─────────────────────┐
                    │   React Dashboard    │
                    │  (Coverage Tab +     │
                    │   auto-refresh)      │
                    └────────┬────────────┘
                             │ GET /api/health/coverage (30s poll)
                             ▼
                    ┌─────────────────────┐         ┌──────────────┐
                    │  Express Routes     │         │  /status     │
                    │  health.ts          │────────▶│  (standalone │
                    │  status.ts (new)    │         │   HTML page) │
                    └────────┬────────────┘         └──────────────┘
                             │ reads from
                             ▼
                    ┌─────────────────────┐
                    │  In-Memory          │◀───── hydrate on startup
                    │  Telemetry Map      │
                    └────────┬────────────┘
                             │ writes to both
                             ▼
              ┌──────────────────────────────┐
              │  PostgreSQL                   │
              │  ingestion_telemetry          │
              │  ingestion_successes          │
              │  ingestion_failures           │
              │  ingestion_fallbacks          │
              │  portal_probe_results         │
              │  data_quality_reports         │
              │  coverage_alerts              │
              └──────────────────────────────┘
                             ▲
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │ Ingestion  │  │ Portal     │  │ Digest     │
     │ Worker     │  │ Probe      │  │ Worker     │
     │ (existing) │  │ Worker     │  │ (new)      │
     │ + DQ check │  │ (new)      │  │ weekly     │
     └────────────┘  └────────────┘  └────────────┘
              │              │              │
              ▼              ▼              ▼
     ┌─────────────────────────────────────────┐
     │  CoverageAlertService                    │
     │  (logs + email on critical transitions)  │
     └─────────────────────────────────────────┘
```

## New Files

| File                                              | Purpose                                      |
| ------------------------------------------------- | -------------------------------------------- |
| `database/migrations/003_ingestion_telemetry.sql` | Telemetry + probe + DQ + alert tables        |
| `server/services/TelemetryPersistenceService.ts`  | Persist + hydrate telemetry to/from PG       |
| `server/services/CoverageAlertService.ts`         | Alert on state transitions, debounce, email  |
| `server/services/DataQualityService.ts`           | Post-ingestion data quality assertions       |
| `server/config/dataQuality.ts`                    | Volume expectations, completeness thresholds |
| `server/queue/workers/portalProbeWorker.ts`       | Lightweight portal availability checks       |
| `server/queue/workers/digestWorker.ts`            | Weekly email digest compilation + send       |
| `server/routes/status.ts`                         | Standalone HTML status page (no auth)        |
| `apps/web/src/hooks/useCoverageDashboard.ts`      | Auto-refresh hook with polling + visibility  |
| `apps/web/src/features/coverage/CoverageTab.tsx`  | Top-level tab wrapper                        |

## Modified Files

| File                                      | Change                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `server/queue/queues.ts`                  | Add persistence hooks to all `recordIngestion*` functions, add new queues |
| `server/queue/scheduler.ts`               | Add portal probe schedule (1:30 AM), digest schedule (Mon 9 AM)           |
| `server/queue/workers/ingestionWorker.ts` | Add DQ validation after persist step                                      |
| `server/routes/health.ts`                 | Read from DB on cold start if memory is empty                             |
| `server/index.ts`                         | Mount `/status` route, hydrate telemetry on startup                       |
| `apps/web/src/App.tsx`                    | Add Coverage tab to main tab bar                                          |
| `database/schema.sql`                     | Append new tables                                                         |

## Testing Strategy

| Test File                                                       | What                                       |
| --------------------------------------------------------------- | ------------------------------------------ |
| `server/__tests__/services/TelemetryPersistenceService.test.ts` | Persist, hydrate, prune (mock DB)          |
| `server/__tests__/services/DataQualityService.test.ts`          | Assertion logic, volume ranges, edge cases |
| `server/__tests__/services/CoverageAlertService.test.ts`        | Trigger matching, debounce, cooldown       |
| `server/__tests__/queue/workers/portalProbeWorker.test.ts`      | Probe behavior, circuit integration        |
| `server/__tests__/queue/workers/digestWorker.test.ts`           | Report compilation, email template         |
| `server/__tests__/routes/status.test.ts`                        | HTML response, state grid rendering        |
| `apps/web/src/hooks/__tests__/useCoverageDashboard.test.ts`     | Polling, visibility pause, error handling  |
| `apps/web/src/features/coverage/__tests__/CoverageTab.test.tsx` | Tab rendering, preview fallback            |

## Success Criteria

1. Tony can open a bookmarkable URL and see 50 states green/yellow/red with timestamps
2. Telemetry survives process restarts
3. Probes detect portal issues 30 minutes before ingestion attempts
4. Data quality warnings surface in the dashboard
5. Critical alerts (circuit open, probe failure) trigger email
6. Weekly digest arrives Monday morning with 7-day summary
7. All new code has tests, ESLint clean, no regressions
