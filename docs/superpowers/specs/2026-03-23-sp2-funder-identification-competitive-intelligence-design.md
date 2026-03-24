# SP2: Funder Identification + Competitive Intelligence — Design Spec

**Date:** 2026-03-23
**Status:** Draft
**Priority:** P1
**Depends on:** SP1 (coverage dashboard + telemetry — done)

---

## Goal

Transform the platform from prospect discovery to prospect dynamics — detect filing terminations ("fresh capacity"), track filing velocity (acceleration = distress or expansion), map competitive positions (which funders are active where), and surface these signals in scoring and outreach narratives.

## What Already Exists

| Component                                          | Location                                  | Status |
| -------------------------------------------------- | ----------------------------------------- | ------ |
| KNOWN_FUNDERS (36+ entries, tiered)                | `server/services/StackAnalysisService.ts` | Wired  |
| `identifyFunder()` — name matching                 | `server/services/StackAnalysisService.ts` | Wired  |
| `detectCompetitors()` — position analysis          | `server/services/StackAnalysisService.ts` | Wired  |
| `analyzeStack()` — full stack analysis             | `server/services/StackAnalysisService.ts` | Wired  |
| MCA_COLLATERAL_PATTERNS (10 patterns)              | `server/services/StackAnalysisService.ts` | Wired  |
| IntentScore + PositionScore + trend detection      | `server/services/ScoringService.ts`       | Wired  |
| ucc_filings.status (active/terminated/lapsed)      | `database/schema.sql`                     | Wired  |
| NarrativeService (whale detection, talking points) | `server/services/NarrativeService.ts`     | Wired  |

## What's Missing

### 1. Amendment Persistence

ucc_filings stores raw_data JSONB but amendments aren't extracted into a queryable table. Need:

- `ucc_amendments` table tracking continuation, assignment, termination, amendment events
- `ucc_filings` extended with `expiration_date`, `termination_date`, `amendment_count`

### 2. Termination Detection Worker

No mechanism to detect when a filing changes from active→terminated between ingestion runs. Need:

- BullMQ worker that scans for recently terminated filings
- Triggers enrichment refresh on affected prospects
- Creates `filing_events` records for downstream alerting
- Feeds into "fresh capacity" scoring

### 3. Filing Velocity Analysis

ScoringService has basic recency decay and trend (increasing/stable/decreasing) but no windowed velocity metrics. Need:

- Per-prospect velocity across 30/90/365 day windows
- Acceleration detection (current window vs prior window)
- `filing_velocity_metrics` table for pre-computed metrics

### 4. Competitive Heat Maps

StackAnalysis detects competitors per-prospect but has no aggregate market view. Need:

- Geographic heat map: which funders dominate which states
- Industry heat map: which funders target which industries
- Market saturation (HHI index) per state/industry
- API endpoints for heat map queries

### 5. Fresh Capacity Scoring

No scoring component for "this merchant just paid off an advance." Need:

- FreshCapacityScore component in ScoringService
- Recent termination bonus, active filing penalty, termination velocity bonus
- Integration into the composite prospect score

---

## Architecture

```
Ingestion Worker (existing)
  │
  ├── persists amendments → ucc_amendments table (NEW)
  ├── persists expiration_date → ucc_filings (EXTENDED)
  │
  ▼
Termination Detection Worker (NEW, nightly)
  │
  ├── scans for active→terminated transitions
  ├── creates filing_events
  ├── triggers enrichment refresh
  │
  ▼
Filing Velocity Service (NEW, nightly)
  │
  ├── computes 30/90/365 day velocity per prospect
  ├── detects acceleration
  ├── persists to filing_velocity_metrics
  │
  ▼
Scoring Service (EXTENDED)
  │
  ├── adds freshCapacityScore component
  ├── adds velocityTrend factor
  │
  ▼
Competitive Heat Map Service (NEW)
  │
  ├── geographic aggregation
  ├── industry aggregation
  ├── HHI saturation index
  │
  ▼
API Routes (NEW)
  │
  ├── GET /api/competitive/heatmap/:state
  ├── GET /api/competitive/saturation/:state
  ├── GET /api/competitive/funder/:funderId
  │
  ▼
Dashboard (EXTENDED)
  ├── velocity trend badges
  ├── fresh capacity indicators
  └── competitive position cards
```

## Success Criteria

1. Termination events detected within 24 hours of filing status change
2. Velocity metrics computed nightly for all prospects with filings
3. Fresh capacity score integrated into composite prospect score
4. Heat map API responds in <500ms for any state
5. All new code has tests, ESLint clean
