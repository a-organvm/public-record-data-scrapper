# SP2: Funder Identification + Competitive Intelligence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect filing terminations, track velocity, map competitive positions, and surface fresh capacity signals — enabling timing-based outreach (the highest-leverage sales motion).

**Architecture:** Extend the existing ingestion pipeline with amendment persistence, add nightly BullMQ workers for termination detection and velocity analysis, build a CompetitiveHeatMapService for aggregate market views, and integrate fresh capacity scoring into the prospect score.

**Tech Stack:** TypeScript, Express 5, PostgreSQL (pg), BullMQ, React 19, Vitest

**Spec:** `docs/superpowers/specs/2026-03-23-sp2-funder-identification-competitive-intelligence-design.md`

---

## File Structure

### New Files

| File                                                                | Responsibility                                           |
| ------------------------------------------------------------------- | -------------------------------------------------------- |
| `database/migrations/011_competitive_intelligence.sql`              | Amendments, velocity, events, competitor position tables |
| `database/migrations/011_down.sql`                                  | Rollback                                                 |
| `server/services/FilingVelocityService.ts`                          | Windowed velocity metrics + acceleration detection       |
| `server/services/FreshCapacityService.ts`                           | Fresh capacity scoring from termination events           |
| `server/services/CompetitiveHeatMapService.ts`                      | Geographic + industry + saturation heat maps             |
| `server/queue/workers/terminationDetectionWorker.ts`                | Detect active→terminated transitions, create events      |
| `server/queue/workers/velocityAnalysisWorker.ts`                    | Nightly velocity computation for all prospects           |
| `server/routes/competitive.ts`                                      | API endpoints for heat maps and funder profiles          |
| `server/__tests__/services/FilingVelocityService.test.ts`           | Tests                                                    |
| `server/__tests__/services/FreshCapacityService.test.ts`            | Tests                                                    |
| `server/__tests__/services/CompetitiveHeatMapService.test.ts`       | Tests                                                    |
| `server/__tests__/queue/workers/terminationDetectionWorker.test.ts` | Tests                                                    |
| `server/__tests__/queue/workers/velocityAnalysisWorker.test.ts`     | Tests                                                    |
| `server/__tests__/routes/competitive.test.ts`                       | Tests                                                    |

### Modified Files

| File                                      | Change                                                 |
| ----------------------------------------- | ------------------------------------------------------ |
| `database/schema.sql`                     | Append new tables                                      |
| `server/queue/queues.ts`                  | Add termination-detection and velocity-analysis queues |
| `server/queue/scheduler.ts`               | Schedule nightly termination + velocity jobs           |
| `server/queue/workers/ingestionWorker.ts` | Persist amendments + expiration_date                   |
| `server/services/ScoringService.ts`       | Add freshCapacityScore + velocityTrend to scoring      |
| `server/index.ts`                         | Mount /api/competitive routes                          |
| `server/__tests__/setup.ts`               | Add new tables to truncation                           |

---

## Task 1: Database Migration — Competitive Intelligence Tables

**Files:**

- Create: `database/migrations/011_competitive_intelligence.sql`
- Create: `database/migrations/011_down.sql`
- Modify: `database/schema.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 011_competitive_intelligence.sql

-- Extend ucc_filings with termination/expiration tracking
ALTER TABLE ucc_filings ADD COLUMN IF NOT EXISTS expiration_date DATE;
ALTER TABLE ucc_filings ADD COLUMN IF NOT EXISTS termination_date DATE;
ALTER TABLE ucc_filings ADD COLUMN IF NOT EXISTS amendment_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ucc_filings ADD COLUMN IF NOT EXISTS last_amendment_date DATE;

CREATE INDEX IF NOT EXISTS idx_ucc_expiration ON ucc_filings(expiration_date) WHERE expiration_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ucc_termination ON ucc_filings(termination_date) WHERE termination_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ucc_status_updated ON ucc_filings(status, updated_at DESC);

-- Amendment history
CREATE TABLE IF NOT EXISTS ucc_amendments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id UUID NOT NULL REFERENCES ucc_filings(id) ON DELETE CASCADE,
  external_id VARCHAR(200) UNIQUE,
  amendment_type VARCHAR(20) NOT NULL CHECK (amendment_type IN ('continuation', 'assignment', 'termination', 'amendment')),
  amendment_date DATE NOT NULL,
  description TEXT,
  raw_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_amendments_filing ON ucc_amendments(filing_id, amendment_date DESC);

-- Filing events (terminations, new filings, expirations)
CREATE TABLE IF NOT EXISTS filing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  event_type VARCHAR(30) NOT NULL CHECK (event_type IN ('termination', 'new_filing', 'expiration_approaching', 'amendment', 'status_change')),
  filing_id UUID REFERENCES ucc_filings(id) ON DELETE SET NULL,
  event_date DATE NOT NULL,
  metadata JSONB,
  processed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_prospect ON filing_events(prospect_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_events_type_date ON filing_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_unprocessed ON filing_events(processed) WHERE processed = false;

-- Filing velocity metrics (pre-computed per prospect per window)
CREATE TABLE IF NOT EXISTS filing_velocity_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  window_days INTEGER NOT NULL,
  filings_in_window INTEGER NOT NULL DEFAULT 0,
  avg_filings_per_month NUMERIC(8,2) NOT NULL DEFAULT 0,
  trend VARCHAR(20) NOT NULL CHECK (trend IN ('accelerating', 'stable', 'decelerating')) DEFAULT 'stable',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(prospect_id, window_days)
);
CREATE INDEX IF NOT EXISTS idx_velocity_trend ON filing_velocity_metrics(trend, computed_at DESC);

-- Competitor market position snapshots (aggregated periodically)
CREATE TABLE IF NOT EXISTS competitor_market_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  funder_name VARCHAR(500) NOT NULL,
  funder_normalized VARCHAR(500) NOT NULL,
  funder_type VARCHAR(20),
  funder_tier VARCHAR(2),
  state VARCHAR(2) NOT NULL,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  filing_count INTEGER NOT NULL DEFAULT 0,
  active_filing_count INTEGER NOT NULL DEFAULT 0,
  unique_debtors INTEGER NOT NULL DEFAULT 0,
  market_share_pct NUMERIC(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(funder_normalized, state, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_competitor_state ON competitor_market_positions(state, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_competitor_funder ON competitor_market_positions(funder_normalized, snapshot_date DESC);
```

- [ ] **Step 2: Write rollback**

```sql
-- 011_down.sql
DROP TABLE IF EXISTS competitor_market_positions;
DROP TABLE IF EXISTS filing_velocity_metrics;
DROP TABLE IF EXISTS filing_events;
DROP TABLE IF EXISTS ucc_amendments;
ALTER TABLE ucc_filings DROP COLUMN IF EXISTS expiration_date;
ALTER TABLE ucc_filings DROP COLUMN IF EXISTS termination_date;
ALTER TABLE ucc_filings DROP COLUMN IF EXISTS amendment_count;
ALTER TABLE ucc_filings DROP COLUMN IF EXISTS last_amendment_date;
```

- [ ] **Step 3: Append to schema.sql, commit**

```bash
git add database/migrations/011_competitive_intelligence.sql database/migrations/011_down.sql database/schema.sql
git commit -m "feat(db): add competitive intelligence tables (migration 011)"
```

---

## Task 2: Extend Ingestion Worker — Amendment Persistence

**Files:**

- Modify: `server/queue/workers/ingestionWorker.ts`

- [ ] **Step 1: Read the existing `persistCollectedFilings` function**

Understand the current upsert pattern. Then extend it to:

1. Include `expiration_date`, `termination_date`, `amendment_count`, `last_amendment_date` in the INSERT/UPSERT
2. After persisting the main filing, iterate over `filing.amendments[]` (if present) and INSERT each into `ucc_amendments`
3. If `filing.status === 'terminated'` and the upserted row's previous status was 'active', set `termination_date = NOW()`

The filing type from collectors has optional `expirationDate` and `amendments[]` fields. Check `apps/web/src/lib/collectors/types.ts` for the exact shape.

- [ ] **Step 2: Run existing ingestion worker tests to verify no regression**

```bash
npm run test:server -- --run server/__tests__/queue/workers/ingestionWorker.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add -f server/queue/workers/ingestionWorker.ts
git commit -m "feat: extend ingestion worker to persist amendments and expiration dates"
```

---

## Task 3: Termination Detection Worker

**Files:**

- Create: `server/queue/workers/terminationDetectionWorker.ts`
- Create: `server/__tests__/queue/workers/terminationDetectionWorker.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:

1. Detects filings with status='terminated' and updated_at in last 7 days
2. Creates filing_event with type='termination' for each detected termination
3. Links event to correct prospect via debtor name matching
4. Marks prospect for enrichment refresh (sets enriched_at = NULL)
5. Skips filings that already have filing_events for the same termination
6. Handles prospects with no matching filing gracefully

- [ ] **Step 2: Implement terminationDetectionWorker**

```typescript
export async function processTerminationDetection(db: {
  query: <T>(sql: string, params?: unknown[]) => Promise<T[]>
}): Promise<{ detected: number; eventsCreated: number }> {
  // 1. Find recently terminated filings without a matching filing_event
  const terminated = await db.query(`
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
    // 2. Find linked prospect
    const prospects = await db.query(
      `SELECT p.id FROM prospects p
       JOIN prospect_ucc_filings puf ON p.id = puf.prospect_id
       WHERE puf.ucc_filing_id = $1 LIMIT 1`,
      [filing.id]
    )

    if (prospects.length === 0) continue

    // 3. Create filing event
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

    // 4. Mark prospect for re-enrichment
    await db.query(`UPDATE prospects SET updated_at = NOW() WHERE id = $1`, [prospects[0].id])

    eventsCreated++
  }

  return { detected: terminated.length, eventsCreated }
}
```

- [ ] **Step 3: Run tests, commit**

```bash
npm run test:server -- --run server/__tests__/queue/workers/terminationDetectionWorker.test.ts
git add -f server/queue/workers/terminationDetectionWorker.ts server/__tests__/queue/workers/terminationDetectionWorker.test.ts
git commit -m "feat: add termination detection worker for fresh capacity signals"
```

---

## Task 4: Filing Velocity Service

**Files:**

- Create: `server/services/FilingVelocityService.ts`
- Create: `server/__tests__/services/FilingVelocityService.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:

1. `computeVelocity` returns metrics for 30/90/365 day windows
2. `computeVelocity` detects 'accelerating' when current > prior window
3. `computeVelocity` detects 'decelerating' when current < prior/2
4. `computeVelocity` returns 'stable' for similar counts
5. `computeVelocity` handles prospect with no filings (all zeros)
6. `persistMetrics` upserts to filing_velocity_metrics
7. `detectAccelerating` returns prospects with accelerating 30-day trend

- [ ] **Step 2: Implement FilingVelocityService**

Key methods:

- `computeVelocity(prospectId)` — queries ucc_filings for each window, compares with prior window
- `persistMetrics(prospectId, metrics)` — upsert to filing_velocity_metrics
- `detectAccelerating(state?)` — query for prospects with trend='accelerating'

- [ ] **Step 3: Run tests, commit**

```bash
npm run test:server -- --run server/__tests__/services/FilingVelocityService.test.ts
git add -f server/services/FilingVelocityService.ts server/__tests__/services/FilingVelocityService.test.ts
git commit -m "feat: add FilingVelocityService with windowed acceleration detection"
```

---

## Task 5: Fresh Capacity Scoring Service

**Files:**

- Create: `server/services/FreshCapacityService.ts`
- Create: `server/__tests__/services/FreshCapacityService.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:

1. Recent termination (≤30 days) → high score (30+ points)
2. Older termination (90-180 days) → medium score (10 points)
3. No terminations → score 0
4. Multiple active filings → penalty (-5 per active)
5. Large payoff amount → bonus (+15 points)
6. Multiple recent terminations → bonus (+10)
7. Score clamped to 0-100 range
8. `computeForProspect` queries DB and returns scored result

- [ ] **Step 2: Implement FreshCapacityService**

```typescript
export interface FreshCapacityInput {
  terminatedFilings: number
  activeFilings: number
  daysSinceRecentTermination: number
  recentTerminationAmount: number | null
  avgActiveAmount: number | null
}

export function calculateFreshCapacityScore(input: FreshCapacityInput): number {
  let score = 0

  // Recency bonus
  if (input.daysSinceRecentTermination <= 30) score += 30
  else if (input.daysSinceRecentTermination <= 90) score += 20
  else if (input.daysSinceRecentTermination <= 180) score += 10

  // Large payoff bonus
  if (
    input.recentTerminationAmount &&
    input.avgActiveAmount &&
    input.recentTerminationAmount > input.avgActiveAmount * 1.5
  ) {
    score += 15
  }

  // Active filing penalty
  score -= input.activeFilings * 5

  // Multiple terminations bonus
  if (input.terminatedFilings >= 2) score += 10

  return Math.max(0, Math.min(100, score))
}

export class FreshCapacityService {
  constructor(private db: DatabaseLike) {}

  async computeForProspect(
    prospectId: string
  ): Promise<{ score: number; input: FreshCapacityInput }>
  // Query filing_events + ucc_filings for termination data, compute score
}
```

- [ ] **Step 3: Run tests, commit**

```bash
npm run test:server -- --run server/__tests__/services/FreshCapacityService.test.ts
git add -f server/services/FreshCapacityService.ts server/__tests__/services/FreshCapacityService.test.ts
git commit -m "feat: add FreshCapacityService for termination-based scoring"
```

---

## Task 6: Competitive Heat Map Service

**Files:**

- Create: `server/services/CompetitiveHeatMapService.ts`
- Create: `server/__tests__/services/CompetitiveHeatMapService.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:

1. `getGeographicHeatMap(funder)` returns per-state filing counts
2. `getCompetitiveSaturation(state)` returns ranked funders with market share
3. `getCompetitiveSaturation` calculates HHI correctly (e.g., 3 equal funders → HHI ~3333)
4. HHI >2500 → 'high' concentration, <1500 → 'competitive'
5. `computeMarketPositions(state)` aggregates and persists snapshots
6. Empty state (no filings) → empty results, not error

- [ ] **Step 2: Implement CompetitiveHeatMapService**

Key methods:

- `getGeographicHeatMap(funderNormalized)` — aggregate ucc_filings by state for a funder
- `getCompetitiveSaturation(state, industry?)` — rank funders by filing count, compute HHI
- `computeMarketPositions(state)` — aggregate + persist to competitor_market_positions

- [ ] **Step 3: Run tests, commit**

```bash
npm run test:server -- --run server/__tests__/services/CompetitiveHeatMapService.test.ts
git add -f server/services/CompetitiveHeatMapService.ts server/__tests__/services/CompetitiveHeatMapService.test.ts
git commit -m "feat: add CompetitiveHeatMapService with HHI saturation analysis"
```

---

## Task 7: Competitive Intelligence API Routes

**Files:**

- Create: `server/routes/competitive.ts`
- Create: `server/__tests__/routes/competitive.test.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Write failing tests**

Test cases (use supertest):

1. `GET /api/competitive/saturation/:state` returns 200 with competitors + HHI
2. `GET /api/competitive/funder/:name` returns geographic heat map
3. `GET /api/competitive/events/recent` returns recent filing events
4. `GET /api/competitive/velocity/:prospectId` returns velocity metrics
5. Unknown funder → empty results (not 404)
6. Invalid state → 400

- [ ] **Step 2: Implement routes**

```typescript
const router = Router()

router.get('/saturation/:state', async (req, res) => { ... })
router.get('/funder/:name', async (req, res) => { ... })
router.get('/events/recent', async (req, res) => { ... })
router.get('/velocity/:prospectId', async (req, res) => { ... })

export default router
```

- [ ] **Step 3: Mount in server/index.ts** behind auth middleware at `/api/competitive`

- [ ] **Step 4: Run tests, commit**

```bash
npm run test:server -- --run server/__tests__/routes/competitive.test.ts
git add -f server/routes/competitive.ts server/__tests__/routes/competitive.test.ts server/index.ts
git commit -m "feat: add competitive intelligence API routes"
```

---

## Task 8: Velocity Analysis Worker

**Files:**

- Create: `server/queue/workers/velocityAnalysisWorker.ts`
- Create: `server/__tests__/queue/workers/velocityAnalysisWorker.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:

1. Worker processes all prospects with UCC filings
2. Calls FilingVelocityService.computeVelocity for each
3. Persists results to filing_velocity_metrics
4. Handles DB errors gracefully (logs, continues)
5. Reports processed count on completion

- [ ] **Step 2: Implement velocityAnalysisWorker**

```typescript
export async function processVelocityAnalysis(
  db: DatabaseLike,
  velocityService: FilingVelocityService
): Promise<{ processed: number }> {
  const prospects = await db.query(
    `SELECT DISTINCT p.id FROM prospects p
     JOIN prospect_ucc_filings puf ON p.id = puf.prospect_id
     LIMIT 1000`
  )

  let processed = 0
  for (const { id } of prospects) {
    try {
      const metrics = await velocityService.computeVelocity(id)
      await velocityService.persistMetrics(id, metrics)
      processed++
    } catch (err) {
      console.error(`[velocity] Failed for ${id}:`, (err as Error).message)
    }
  }

  return { processed }
}
```

- [ ] **Step 3: Run tests, commit**

```bash
npm run test:server -- --run server/__tests__/queue/workers/velocityAnalysisWorker.test.ts
git add -f server/queue/workers/velocityAnalysisWorker.ts server/__tests__/queue/workers/velocityAnalysisWorker.test.ts
git commit -m "feat: add nightly velocity analysis worker"
```

---

## Task 9: Wire Queues + Schedules

**Files:**

- Modify: `server/queue/queues.ts`
- Modify: `server/queue/scheduler.ts`
- Modify: `server/__tests__/setup.ts`

- [ ] **Step 1: Add new queue definitions to queues.ts**

Add `termination-detection` and `velocity-analysis` queues following the existing pattern.

- [ ] **Step 2: Add schedules to scheduler.ts**

```typescript
// Termination detection: daily at 2:30 AM (after ingestion at 2:00 AM)
this.scheduleDaily('termination-detection', 2, 30, async () => { ... })

// Velocity analysis: daily at 3:00 AM (after termination detection)
this.scheduleDaily('velocity-analysis', 3, 0, async () => { ... })
```

- [ ] **Step 3: Add new tables to test setup truncation**

In `server/__tests__/setup.ts`, add: `competitor_market_positions, filing_velocity_metrics, filing_events, ucc_amendments`

- [ ] **Step 4: Run regression tests, commit**

```bash
npm run test:server -- --run server/__tests__/queue/queues.test.ts server/__tests__/queue/scheduler.test.ts
git add -f server/queue/queues.ts server/queue/scheduler.ts server/__tests__/setup.ts
git commit -m "feat: wire termination detection and velocity analysis into scheduler"
```

---

## Task 10: Final Verification

- [ ] **Step 1: Run all server tests**

```bash
npm run test:server -- --run
```

- [ ] **Step 2: ESLint all new files**

```bash
npx eslint server/services/FilingVelocityService.ts server/services/FreshCapacityService.ts server/services/CompetitiveHeatMapService.ts server/queue/workers/terminationDetectionWorker.ts server/queue/workers/velocityAnalysisWorker.ts server/routes/competitive.ts
```

- [ ] **Step 3: Final commit if needed**

```bash
git commit -m "feat: SP2 funder identification + competitive intelligence — complete"
```

---

## Summary

| Task      | Description                               | New Tests         |
| --------- | ----------------------------------------- | ----------------- |
| 1         | Database migration (5 tables, 4 columns)  | —                 |
| 2         | Amendment persistence in ingestion worker | 0 (regression)    |
| 3         | Termination detection worker              | ~6                |
| 4         | Filing velocity service                   | ~7                |
| 5         | Fresh capacity scoring                    | ~8                |
| 6         | Competitive heat map service              | ~6                |
| 7         | Competitive intelligence API routes       | ~6                |
| 8         | Velocity analysis worker                  | ~5                |
| 9         | Wire queues + schedules                   | 0 (regression)    |
| 10        | Final verification                        | 0                 |
| **Total** | **10 tasks**                              | **~38 new tests** |
