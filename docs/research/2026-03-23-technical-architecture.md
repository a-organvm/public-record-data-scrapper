# UCC-MCA Intelligence Platform -- Technical Architecture

**Generated:** 2026-03-23
**Scope:** Post-SP3 system architecture as built
**Repository:** `public-record-data-scrapper`

---

## 1. System Overview

The UCC-MCA Intelligence Platform is an AI-powered lead generation system for Merchant Cash Advance (MCA) providers. It ingests Uniform Commercial Code (UCC) filings from state Secretary of State portals across all 50 US states plus DC, identifies businesses with active or recently terminated financing, scores them for MCA likelihood, and orchestrates multi-channel outreach sequences. The platform combines scheduled data ingestion with circuit-breaker resilience, competitive intelligence via filing velocity and market position analysis, and an agentic AI system that autonomously suggests operational improvements.

### High-Level Architecture

```
                                    +-------------------+
                                    |   Netlify (CDN)   |
                                    |   Static SPA      |
                                    +--------+----------+
                                             |
                                     HTTPS / REST API
                                             |
+----------------+              +------------+------------+
|                |              |                         |
|  State SOS     |  Collectors  |     Express.js API      |
|  Portals       +------------->|     (Render.com)        |
|  (CA,TX,FL,NY) |              |                         |
|                |              |  Middleware Pipeline:    |
+----------------+              |  HTTPS -> Helmet ->     |
                                |  CORS -> Raw Body ->    |
                                |  JSON -> Compression -> |
+----------------+              |  Logger -> DataTier ->  |
|  Webhook       |   Inbound    |  RateLimiter -> Audit   |
|  Sources       +------------->|                         |
|  (Twilio,SG,   |              +---+--------+------+-----+
|   Plaid)       |                  |        |      |
+----------------+                  |        |      |
                                    v        v      v
                            +-------+--+ +---+--+ ++---------+
                            |PostgreSQL| |Redis | |BullMQ    |
                            |  (RDS)   | |(EC)  | |Queues    |
                            +----------+ +------+ +----+-----+
                                                       |
                                              +--------+--------+
                                              |  Worker Process  |
                                              |  (Render.com)    |
                                              |                  |
                                              |  8 Workers:      |
                                              |  - Ingestion     |
                                              |  - Enrichment    |
                                              |  - Health Score  |
                                              |  - Portal Probe  |
                                              |  - Digest        |
                                              |  - Termination   |
                                              |  - Velocity      |
                                              |  - Outreach      |
                                              +---------+--------+
                                                        |
                                              +---------+---------+
                                              |   Integrations    |
                                              |   Twilio (SMS/    |
                                              |     Voice)        |
                                              |   SendGrid        |
                                              |     (Email)       |
                                              |   Plaid (Banking) |
                                              |   ACH (Payments)  |
                                              |   AWS S3 (Docs)   |
                                              |   Stripe          |
                                              |     (Billing)     |
                                              +-------------------+
```

### Technology Stack

| Layer                   | Technology                       | Version                  |
| ----------------------- | -------------------------------- | ------------------------ |
| **Frontend**            | React + Vite + TypeScript        | React 19, Vite 7, TS 5.9 |
| **UI Framework**        | Tailwind CSS + Radix UI + ShadCN | Tailwind 4               |
| **Charting**            | Recharts + D3                    | Recharts 3               |
| **API Server**          | Express.js                       | Express 5                |
| **Job Queue**           | BullMQ                           | 5.67                     |
| **Database**            | PostgreSQL                       | 14+ (RDS)                |
| **Cache/Queue Backend** | Redis                            | 7 (ElastiCache)          |
| **Scraping**            | Puppeteer                        | 24                       |
| **Validation**          | Zod                              | 4                        |
| **Auth**                | JWT (jsonwebtoken)               | 9                        |
| **IaC**                 | Terraform (AWS)                  | HCL                      |
| **Testing**             | Vitest + Playwright + Supertest  | Vitest 4                 |
| **Monorepo**            | npm workspaces                   | -                        |

---

## 2. Data Model

### 2.1 Core UCC Domain

#### `ucc_filings`

Primary table storing UCC filing records collected from state portals. Each record represents a UCC-1 or UCC-3 filing.

| Column                                       | Type                | Purpose                                                           |
| -------------------------------------------- | ------------------- | ----------------------------------------------------------------- |
| `id`                                         | UUID (PK)           | Internal identifier                                               |
| `external_id`                                | VARCHAR(255) UNIQUE | Original filing ID from source (format: `{STATE}:{filingNumber}`) |
| `filing_date`                                | DATE                | Date the filing was recorded                                      |
| `debtor_name` / `debtor_name_normalized`     | VARCHAR(500)        | Business name (raw + lowercased/trimmed via trigger)              |
| `secured_party` / `secured_party_normalized` | VARCHAR(500)        | Lender name (raw + normalized via trigger)                        |
| `state`                                      | CHAR(2)             | Two-letter state code                                             |
| `lien_amount`                                | DECIMAL(15,2)       | Dollar amount of the lien                                         |
| `status`                                     | VARCHAR(20)         | `active`, `terminated`, or `lapsed`                               |
| `filing_type`                                | VARCHAR(10)         | `UCC-1` (original) or `UCC-3` (amendment)                         |
| `source`                                     | VARCHAR(100)        | Ingestion source identifier (e.g., `ucc_ca_api`)                  |
| `raw_data`                                   | JSONB               | Complete original filing data preserved for audit                 |
| `expiration_date`                            | DATE                | Filing expiration (added in migration 011)                        |
| `termination_date`                           | DATE                | Date terminated (added in migration 011)                          |
| `amendment_count`                            | INTEGER             | Count of UCC-3 amendments                                         |
| `last_amendment_date`                        | DATE                | Most recent amendment                                             |
| `search_vector`                              | tsvector            | Full-text search on debtor/secured party names                    |

**Indexes:** Trigram GIN on `debtor_name_normalized` and `secured_party_normalized` for fuzzy search. B-tree on `filing_date DESC`, `state`, `status`. Partial index on `status = 'lapsed'`. GIN on `search_vector`. Partial indexes on `expiration_date` and `termination_date` where not null.

**Triggers:**

- `normalize_debtor_name()` -- strips special characters, collapses whitespace, lowercases
- `normalize_secured_party()` -- same normalization for lender names
- `update_updated_at()` -- auto-updates `updated_at` on any row modification

#### `ucc_amendments`

Tracks individual amendments (continuations, assignments, terminations) linked to a parent filing.

| Column           | Type                   | Purpose                                                  |
| ---------------- | ---------------------- | -------------------------------------------------------- |
| `filing_id`      | UUID FK -> ucc_filings | Parent filing                                            |
| `amendment_type` | VARCHAR(20)            | `continuation`, `assignment`, `termination`, `amendment` |
| `amendment_date` | DATE                   | When the amendment was filed                             |
| `raw_data`       | JSONB                  | Original amendment data                                  |

### 2.2 Prospects Domain

#### `prospects`

Businesses identified as potential MCA leads from UCC filing analysis.

| Column                                     | Type          | Purpose                                                                                                           |
| ------------------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `id`                                       | UUID (PK)     | Internal identifier                                                                                               |
| `company_name` / `company_name_normalized` | VARCHAR(500)  | Business name (normalized strips LLC/Inc/Corp suffixes via trigger)                                               |
| `industry`                                 | VARCHAR(50)   | Constrained: restaurant, retail, construction, healthcare, manufacturing, services, technology                    |
| `state`                                    | CHAR(2)       | Business state                                                                                                    |
| `status`                                   | VARCHAR(20)   | Pipeline stage: `new` -> `claimed` -> `contacted` -> `qualified` -> `closed-won`/`closed-lost`/`dead`/`unclaimed` |
| `priority_score`                           | INTEGER 0-100 | Composite scoring from ML model                                                                                   |
| `default_date`                             | DATE          | Date of default event                                                                                             |
| `time_since_default`                       | INTEGER       | Days since default (auto-calculated via trigger)                                                                  |
| `narrative`                                | TEXT          | AI-generated narrative summary                                                                                    |
| `estimated_revenue`                        | DECIMAL(15,2) | Estimated annual revenue                                                                                          |
| `enrichment_confidence`                    | DECIMAL(3,2)  | 0.00-1.00 confidence in enrichment data                                                                           |
| `search_vector`                            | tsvector      | FTS on company_name + narrative                                                                                   |

**Triggers:**

- `calculate_time_since_default()` -- auto-computes `time_since_default` from `default_date`
- `normalize_company_name()` -- strips legal suffixes, collapses whitespace
- `prospects_search_vector_update()` -- maintains FTS vector

#### `prospect_ucc_filings` (junction)

Many-to-many linking prospects to their UCC filings. Composite PK of `(prospect_id, ucc_filing_id)`.

#### `growth_signals`

Detected growth indicators for prospects (hiring, permits, contracts, expansions, equipment purchases).

#### `health_scores`

Historical health score snapshots per prospect. Grades A-F, sentiment trends, violation counts. Unique constraint on `(prospect_id, recorded_date)`.

### 2.3 Competitive Intelligence

#### `competitors`

Aggregated competitor (lender) data with filing counts, market share, and industry breakdowns. Uses `VARCHAR(50)[]` array for industries served.

#### `competitor_market_positions`

Per-state, per-date snapshots of lender market positions. Unique on `(funder_normalized, state, snapshot_date)`. Tracks active filing counts, unique debtors, and market share percentages.

#### `filing_events`

Lifecycle events for prospects: `termination`, `new_filing`, `expiration_approaching`, `amendment`, `status_change`. Has a `processed` boolean flag with a partial index on unprocessed events.

#### `filing_velocity_metrics`

Pre-computed filing velocity per prospect per time window. Trends classified as `accelerating`, `stable`, or `decelerating`. Unique on `(prospect_id, window_days)`.

### 2.4 Telemetry Domain

#### `ingestion_telemetry`

One row per US state (51 rows seeded for 50 states + DC). Tracks per-state ingestion status, circuit breaker state, strategy, success/failure counts. Keyed by `state_code` (VARCHAR(2) PK).

#### `ingestion_successes` / `ingestion_failures` / `ingestion_fallbacks`

Time-series event tables for ingestion outcomes, each referencing `ingestion_telemetry.state_code`. Used for digest reports and circuit breaker history.

#### `portal_probe_results`

Results of automated portal health probes: reachability, response time, HTTP status, schema validity, anti-bot detection.

#### `data_quality_reports`

Per-ingestion-batch quality assessments: volume validation, field completeness, deduplication rate, filing date recency, party name presence. Boolean `passed` flag.

#### `coverage_alerts`

Alert log for circuit breaker events, probe failures, and schema changes. Has `emailed` flag for tracking notification status.

### 2.5 Outreach Domain

#### `outreach_sequences`

Multi-step outreach campaigns linked to prospects and optionally to filing events. Status: `pending` -> `active` -> `completed`/`cancelled`/`failed`.

#### `outreach_steps`

Individual steps within a sequence. Channels: `email`, `sms`, `call`, `briefing`. Status lifecycle: `pending` -> `scheduled` -> `sent`/`delivered`/`failed`/`skipped`. Partial index on `scheduled_for WHERE status = 'scheduled'` for efficient polling.

#### `pre_call_briefings`

Cached briefing documents for sales calls. JSONB content with 24-hour TTL. Unique on `prospect_id`.

### 2.6 Portfolio Domain

#### `portfolio_companies`

Funded companies being monitored. Status: `performing`, `watch`, `at-risk`, `default`. Partial index on at-risk/default for alert queries.

#### `portfolio_health_scores` (junction)

Links portfolio companies to health score snapshots.

### 2.7 Logging Tables

- `ingestion_logs` -- Per-run ingestion audit trail with source, status, record counts, processing time, and JSONB metadata
- `enrichment_logs` -- Per-prospect enrichment audit trail with enriched fields array, confidence scores

### 2.8 Views

| View                      | Purpose                                             |
| ------------------------- | --------------------------------------------------- |
| `latest_health_scores`    | Most recent health score per prospect (DISTINCT ON) |
| `prospects_with_health`   | Prospects LEFT JOIN latest health score             |
| `high_priority_prospects` | Score >= 70, status in (new, claimed)               |
| `stale_prospects`         | Enrichment > 7 days old or null                     |

### 2.9 JSONB Usage Patterns

JSONB is used consistently for:

- **Audit preservation**: `raw_data` on filings, amendments, growth signals, health scores stores the complete original data
- **Flexible metadata**: `metadata` on ingestion/enrichment logs, filing events, outreach sequences
- **Error arrays**: `errors` on ingestion/enrichment logs
- **Structured content**: `content` on pre-call briefings

### 2.10 Index Strategy

The schema employs four index types:

1. **GIN trigram** (`gin_trgm_ops`) on normalized name columns for fuzzy/similarity search (`%` operator)
2. **GIN** on `tsvector` columns for full-text search
3. **B-tree DESC** on date columns for reverse chronological queries
4. **Partial indexes** for status-based filtering (lapsed filings, unprocessed events, at-risk portfolio, scheduled outreach steps)

Extensions enabled: `uuid-ossp` (UUID generation), `pg_trgm` (trigram similarity), `btree_gin` (composite GIN indexes).

---

## 3. Backend Architecture

### 3.1 Express Middleware Pipeline

The middleware stack in `server/index.ts` executes in strict order. Order matters for security and parsing correctness.

```
Request
  |
  v
1. httpsRedirect          -- Redirects HTTP to HTTPS in production
  |
  v
2. helmet()               -- Sets security headers (CSP, X-Frame-Options, etc.)
  |
  v
3. cors()                 -- CORS with configurable origin and credentials
  |
  v
4. express.raw()          -- RAW BODY for /api/webhooks only (preserves buffer
  |                          for signature verification; must precede JSON parser)
  v
5. express.urlencoded()   -- Form-encoded parsing for /api/webhooks (Twilio)
  |
  v
6. express.json()         -- JSON body parsing for all other routes (10MB limit)
  |
  v
7. express.urlencoded()   -- Form-encoded parsing for non-webhook routes
  |
  v
8. compression()          -- gzip/brotli response compression
  |
  v
9. requestLogger          -- Structured request logging
  |
  v
10. dataTierRouter        -- Reads X-Data-Tier header, resolves to free-tier or
  |                          starter-tier, attaches to req.dataTier, sets response
  |                          header x-data-tier-resolved
  v
11. createRateLimiter()   -- Redis-backed rate limiting (in-memory in dev)
  |
  v
12. auditMiddleware       -- Compliance audit logging
  |
  v
[Route Handlers]
  |
  v
13. notFoundHandler       -- 404 for unmatched routes
  |
  v
14. errorHandler          -- Global error handler (catches thrown errors)
```

### 3.2 Route Organization and Auth Boundaries

Routes are mounted in `setupRoutes()` with explicit auth boundaries:

| Route              | Auth                                | Purpose                                                               |
| ------------------ | ----------------------------------- | --------------------------------------------------------------------- |
| `/status`          | **Public** (no auth, bookmarkable)  | Server-rendered HTML status page with auto-refresh                    |
| `/api/health`      | **Public**                          | Health checks, readiness/liveness probes, 50-state coverage dashboard |
| `/api/webhooks`    | **Signature verification** (no JWT) | Twilio SMS/voice, SendGrid events, Plaid transactions/items           |
| `/api/docs`        | **Public**                          | Swagger UI + OpenAPI spec (YAML/JSON)                                 |
| `/api/prospects`   | **JWT required**                    | CRUD for prospects, filtering, batch operations                       |
| `/api/competitors` | **JWT required**                    | Competitor market data                                                |
| `/api/portfolio`   | **JWT required**                    | Portfolio company management                                          |
| `/api/enrichment`  | **JWT required**                    | Trigger enrichment for prospects                                      |
| `/api/jobs`        | **JWT required**                    | View/manage BullMQ jobs                                               |
| `/api/contacts`    | **JWT required**                    | Contact management                                                    |
| `/api/deals`       | **JWT required**                    | Deal pipeline management                                              |
| `/api/competitive` | **JWT required**                    | Competitive heat maps and analysis                                    |
| `/api/outreach`    | **JWT required**                    | Outreach sequences, briefings, manual triggers                        |

### 3.3 Service Layer

The service layer (`server/services/`) provides business logic decoupled from route handlers. Each service is instantiated per-request or as a singleton:

| Service                                      | Responsibility                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `ProspectsService`                           | Prospect CRUD, filtering, batch claim/unclaim                            |
| `CompetitorsService`                         | Competitor data aggregation from UCC filings                             |
| `PortfolioService`                           | Portfolio company lifecycle management                                   |
| `EnrichmentService`                          | Multi-source prospect enrichment (D&B, Google Places, Clearbit, NewsAPI) |
| `ScoringService`                             | ML-based priority scoring                                                |
| `QualificationService`                       | Lead qualification workflows                                             |
| `ContactsService`                            | Contact record management                                                |
| `DealsService`                               | Deal pipeline management                                                 |
| `CommunicationsService`                      | Multi-channel communications (email, SMS, voice) and webhook handling    |
| `OutreachSequenceService`                    | Multi-step outreach orchestration with eligibility checks                |
| `PreCallBriefingService`                     | Generate and cache pre-call briefing documents                           |
| `FreshCapacityService`                       | Calculate fresh lending capacity from terminated filings                 |
| `FilingVelocityService`                      | Compute filing velocity metrics per prospect                             |
| `CompetitiveHeatMapService`                  | Market position analysis and heat maps                                   |
| `AlertService`                               | Coverage alerts and notification dispatch                                |
| `CoverageAlertService`                       | Coverage-specific alert handling                                         |
| `DataQualityService`                         | Batch validation (volume, completeness, deduplication, recency)          |
| `NarrativeService`                           | AI-generated prospect narratives                                         |
| `StackAnalysisService`                       | Technology stack analysis                                                |
| `SuppressionService`                         | Contact suppression lists and compliance                                 |
| `ConsentService`                             | TCPA/CAN-SPAM consent tracking                                           |
| `DisclosureService` / `DisclosureCalculator` | MCA disclosure document generation                                       |
| `ComplianceReportService`                    | Compliance reporting                                                     |
| `UnderwritingService`                        | Underwriting analysis                                                    |
| `AuditService`                               | Audit trail management                                                   |
| `TelemetryPersistenceService`                | Persist in-memory telemetry to PostgreSQL                                |

### 3.4 Database Access Patterns

Database access follows a consistent pattern:

1. **Singleton `database` object** (`server/database/connection.ts`) wraps `DatabaseClient` from `@public-records/core`
2. **Parameterized SQL** via `database.query<T>(sql, params)` -- all queries use positional `$1`, `$2` parameters (no string interpolation)
3. **UPSERT pattern** for idempotent ingestion: `INSERT ... ON CONFLICT (external_id) DO UPDATE SET ...`
4. **Type-safe results**: Queries are generic `query<T>` with explicit row types
5. **Pool client access**: `database.getPoolClient()` for transaction-scoped operations
6. **Connection lifecycle**: Connect on server start, disconnect on graceful shutdown

---

## 4. Queue System

### 4.1 Queue Definitions

Eight BullMQ queues are initialized in `server/queue/queues.ts`:

| Queue Name              | Job Data Interface            | Purpose                                           |
| ----------------------- | ----------------------------- | ------------------------------------------------- |
| `ucc-ingestion`         | `IngestionJobData`            | UCC filing collection from state portals          |
| `data-enrichment`       | `EnrichmentJobData`           | Multi-source prospect data enrichment             |
| `health-scores`         | `HealthScoreJobData`          | Portfolio company health scoring                  |
| `portal-health-probes`  | `PortalProbeJobData`          | Automated portal reachability testing             |
| `coverage-digest`       | `DigestJobData`               | Weekly coverage summary email generation          |
| `termination-detection` | `TerminationDetectionJobData` | Detect newly terminated filings and create events |
| `velocity-analysis`     | `VelocityAnalysisJobData`     | Compute filing velocity metrics per prospect      |
| `outreach`              | `OutreachJobData`             | Multi-channel outreach sequence execution         |

**Default Job Options** (all queues):

- Attempts: 3 with exponential backoff (base 2000ms)
- Completed job retention: 100 jobs or 7 days
- Failed job retention: 500 jobs or 30 days

### 4.2 Schedule Table

| Job                   | Trigger            | Timing               | Details                                                                                                            |
| --------------------- | ------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| UCC Ingestion         | `scheduleDaily`    | **2:00 AM** daily    | Queues one job per state (10 states: NY, CA, TX, FL, IL, PA, OH, GA, NC, MI). Checks circuit gate before queueing. |
| Portal Probes         | `scheduleDaily`    | **1:30 AM** daily    | 30 minutes before ingestion. Probes all 10 scheduled states.                                                       |
| Termination Detection | `scheduleDaily`    | **2:30 AM** daily    | Runs after ingestion completes. Scans terminated filings from last 7 days without matching events.                 |
| Velocity Analysis     | `scheduleDaily`    | **3:00 AM** daily    | Runs after termination detection. Recomputes velocity for up to 1000 prospects with filings.                       |
| Enrichment Refresh    | `scheduleInterval` | **Every 6 hours**    | Finds up to 500 prospects with null or stale (>7 days) enrichment. Batches of 50.                                  |
| Health Score Updates  | `scheduleInterval` | **Every 12 hours**   | Finds portfolio companies with null or stale (>12 hours) health scores. Batches of 50.                             |
| Outreach Processor    | `scheduleInterval` | **Every 15 minutes** | Queries `outreach_steps` with `status = 'scheduled'` and `scheduled_for <= NOW()`. Queues up to 50 jobs.           |
| Coverage Digest       | `scheduleWeekly`   | **Monday 9:00 AM**   | Compiles weekly digest and emails to configured recipients.                                                        |

### 4.3 Circuit Breaker Implementation

The circuit breaker is implemented per-state for ingestion jobs in `server/queue/queues.ts`:

**State Machine:**

```
CLOSED  --[failure]--> count consecutive failures
  |                        |
  |               [failures >= threshold]
  |                        |
  |                        v
  |                      OPEN --[backoff expired]--> HALF-OPEN
  |                        ^                            |
  |                        |                     [probe fails]
  |                        +----------------------------+
  |
  |                   HALF-OPEN --[probe succeeds]--> CLOSED
  v
[success] --> reset consecutive failures, close circuit
```

**Backoff Calculation:**

```typescript
baseDelay = 2 minutes
multiplier = 2^(consecutiveFailures - 1)
backoff = min(baseDelay * multiplier, 30 minutes)
```

So: 2min, 4min, 8min, 16min, 30min cap.

**Gate Check:** Before enqueueing any ingestion job, the scheduler calls `getIngestionCircuitGate(state)`. If the circuit is `open` and backoff hasn't expired, the job is skipped with a log message.

**Recovery Actions** (evaluated on failure):

1. **Fallback**: If the current strategy has a next strategy in the chain, schedule a delayed job with the next strategy
2. **Retry**: If this is the first failure and no fallback exists, retry the same strategy after backoff
3. **Open Circuit**: If all strategies exhausted and consecutive failures > 1, open the circuit

**Strategy Chains:**
| State | Strategy Chain |
|-------|---------------|
| CA | `['api']` |
| TX | `['bulk']` |
| FL | `['vendor']` |
| All others | `[]` (no production strategy configured) |

### 4.4 Telemetry Persistence

Telemetry operates in two layers:

1. **In-memory** (`Map<string, IngestionCoverageTelemetry>`): Real-time state updated on every queue/start/complete/fail/fallback event. Holds 30-day rolling windows of successes, failures, and fallbacks (pruned on every write).

2. **PostgreSQL** (`TelemetryPersistenceService`): Fire-and-forget persistence on completion, failure, and fallback events. Writes to `ingestion_telemetry` (state summary) and `ingestion_successes`/`ingestion_failures`/`ingestion_fallbacks` (event log).

**Hydration:** On server startup, `hydrateTelemetryFromDatabase()` loads persisted telemetry into the in-memory map so circuit breaker state survives restarts.

### 4.5 Worker Error Handling and Self-Heal

The ingestion worker (`server/queue/workers/ingestionWorker.ts`) implements a self-healing pattern:

1. On failure, the worker logs the failure to `data_ingestion_logs` and records telemetry
2. `NonRetryableIngestionError` bypasses self-heal (e.g., missing credentials, unimplemented collector)
3. For retryable errors, `evaluateIngestionRecoveryAction()` determines the next step
4. If a fallback or retry is warranted, a new job is enqueued with a delay, `queuedBy: 'self-heal'`, and incremented `fallbackDepth`
5. The recovery job records a `recordIngestionFallbackEscalated` event for telemetry

**Worker Concurrency Settings:**

| Worker       | Concurrency | Rate Limit     |
| ------------ | ----------- | -------------- |
| Ingestion    | 2           | 10 jobs/minute |
| Enrichment   | 5           | 50 jobs/minute |
| Health Score | 3           | 30 jobs/minute |

---

## 5. Integration Layer

### 5.1 Twilio (SMS + Voice)

**Client:** `server/integrations/twilio/client.ts` -- `TwilioClient` class with singleton `twilioClient` export.

**Configuration:**

- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- `TWILIO_WEBHOOK_BASE_URL` for callback URLs

**Capabilities:**

- Send SMS via `sms.ts` (outreach sequences)
- Initiate voice calls via `voice.ts` (outbound dialing)
- Phone number validation (US format normalization to E.164)
- Auto-generate webhook callback URLs

**Fail-Closed Behavior:** `isConfigured()` returns false if any credential is missing. All API calls return `{ success: false, error: { code: 401 } }` when unconfigured. No exceptions thrown.

**Webhook Endpoints:**

- `POST /api/webhooks/twilio/sms/status` -- SMS delivery status updates
- `POST /api/webhooks/twilio/sms/inbound` -- Inbound SMS messages (creates communication record, returns TwiML)
- `POST /api/webhooks/twilio/voice/status` -- Voice call status updates

All webhooks verify Twilio request signatures via `verifyTwilioSignature` middleware before processing.

### 5.2 SendGrid (Email)

**Client:** `server/integrations/sendgrid/client.ts` -- `SendGridClient` class with singleton `sendgridClient`.

**Configuration:**

- `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME`
- Sandbox mode auto-enabled in non-production environments

**Capabilities:**

- Transactional email via `send.ts` (outreach steps, digest reports)
- Email validation
- Event webhook URL generation

**Fail-Closed:** Returns `{ success: false }` when API key is missing. Sandbox mode prevents actual delivery in development.

**Webhook Endpoint:**

- `POST /api/webhooks/sendgrid/events` -- Batch event processing (processed, delivered, bounced, opened, clicked, spam, unsubscribe). Validates via `verifySendGridSignature`.

### 5.3 Plaid (Bank Account Verification)

**Client:** `server/integrations/plaid/client.ts` -- `PlaidClient` class with singleton `plaidClient`.

**Configuration:**

- `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` (sandbox/development/production)
- Versioned API: `Plaid-Version: 2020-09-14`

**Capabilities:**

- Link token creation for client-side Plaid Link
- Transaction sync via `transactions.ts`
- Access token exchange via `link.ts`

**Fail-Closed:** Throws `PlaidError` with `MISSING_CREDENTIALS` if client ID or secret is empty.

**Webhook Endpoints:**

- `POST /api/webhooks/plaid/transactions` -- Transaction updates (initial, historical, default, sync). Records webhook event and queues transaction sync for DEFAULT_UPDATE.
- `POST /api/webhooks/plaid/item` -- Item status changes (error, expiration, permission revoked). Updates item status in database. Validates via `verifyPlaidSignature`.

### 5.4 ACH (Payment Processing)

**Client:** `server/integrations/ach/client.ts` -- `ACHClient` class with singleton `achClient`.

**Status:** Adapter shell only. All operations (`initiateDebit`, `initiateCredit`, `checkStatus`, `cancelTransaction`) throw `Error` with message indicating no live provider is wired. Local ABA routing number checksum validation is implemented.

**Fail-Closed:** `assertConfigured()` throws if credentials are missing. `throwUnsupported()` throws for all business operations.

### 5.5 AWS S3 (Document Storage)

**Client:** `server/integrations/aws/s3.ts` -- `S3Client` class with singleton `s3Client`.

**Status:** Adapter shell. All upload/download/delete/list operations throw `Error` indicating no AWS SDK is wired. Document key generation, filename sanitization, MIME-to-extension mapping, and S3 URL construction are implemented.

**Key Structure:** `prospects/{prospectId}/{category?}/{uuid}-{sanitized-filename}`

### 5.6 Stripe (Billing)

**Client:** `server/integrations/stripe/index.ts` -- lazy-initialized via `getStripe()`.

**Configuration:**

- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`
- API version: `2025-04-30.basil`

**Capabilities:**

- Create checkout sessions (subscription mode)
- Construct webhook events with signature verification

**Fail-Closed:** `getStripe()` throws if `STRIPE_SECRET_KEY` is not set. `constructWebhookEvent()` throws if `STRIPE_WEBHOOK_SECRET` is not set.

### 5.7 Tiered Integration Configuration

**File:** `server/config/tieredIntegrations.ts`

Integrations are configured per data tier (`free-tier` vs `starter-tier`). Environment variables are looked up with tier-specific prefixes (e.g., `FREE_TIER_DNB_API_KEY`, `STARTER_TIER_DNB_API_KEY`) with fallback to unprefixed names.

**Configured enrichment providers:**

- D&B (Dun & Bradstreet)
- Google Places
- Clearbit
- NewsAPI
- UCC providers: CSC, CT Corporation, LexisNexis

**UCC Provider Resolution:** `resolveUccProvider()` checks credentials in priority order: CSC -> CT Corp -> LexisNexis -> `'unconfigured'`.

---

## 6. Frontend Architecture

### 6.1 Monorepo Workspace Structure

```
/
+-- apps/
|   +-- web/            npm workspace: Vite + React SPA (primary)
|   +-- desktop/        npm workspace: desktop app shell
|   +-- mobile/         npm workspace: mobile app shell
+-- packages/
|   +-- core/           npm workspace: shared types, database client, identity
|   +-- ui/             npm workspace: ShadCN component library (50+ components)
+-- server/             Express API (not a workspace; uses packages via path imports)
```

**Package imports:**

- `@public-records/core` -- Exports `Prospect`, `UCCFiling`, `CompetitorData`, `PortfolioCompany`, and other core types
- `@public-records/ui` -- Exports 50+ ShadCN/Radix components (accordion through tooltip)

### 6.2 Tab Structure

The frontend (`apps/web/src/App.tsx`) organizes the dashboard into seven tabs via Radix UI `<Tabs>`:

| Tab               | Component            | Purpose                                                      |
| ----------------- | -------------------- | ------------------------------------------------------------ |
| `prospects`       | `ProspectsTab`       | Lead table with filtering, sorting, batch operations, export |
| `portfolio`       | `PortfolioTab`       | Funded company monitoring dashboard                          |
| `intelligence`    | `IntelligenceTab`    | Competitor market analysis                                   |
| `analytics`       | `AnalyticsTab`       | Charts, statistics, data pipeline metrics                    |
| `requalification` | `RequalificationTab` | Re-scoring and requalification workflows                     |
| `coverage`        | `CoverageTab`        | 50-state coverage map and ingestion status                   |
| `agentic`         | `AgenticTab`         | Agentic AI system dashboard and suggestions                  |

### 6.3 State Management

**`useKV` (Spark KV):** Persistent key-value storage for user preferences (export format, tour state). Wraps the Spark SDK's `useKV` hook with safe fallbacks.

**Custom Hooks:**
| Hook | Purpose |
|------|---------|
| `useDataFetching` | Fetches prospects, competitors, portfolio data from API or generates mock data |
| `useProspectFilters` | Search, industry/state/score filtering with derived `filteredProspects` |
| `useProspectSorting` | Sort direction and field with derived `sortedProspects` |
| `useProspectSelection` | Checkbox selection state for batch operations |
| `useProspectActions` | Claim, unclaim, export, delete operations |
| `useNotesAndReminders` | Per-prospect notes and reminder management |
| `useAgenticEngine` | Connects to the agentic AI engine for autonomous suggestions |
| `useSystemContext` | Aggregates data for agentic analysis |
| `useDataTier` | Reads resolved data tier from API responses |

**Data Flow:**

1. `useDataFetching` loads data (API or mock based on `VITE_USE_MOCK_DATA`)
2. `useProspectFilters` computes filtered subset
3. `useProspectSorting` sorts the filtered subset
4. `generateDashboardStats()` computes aggregate statistics
5. User actions flow through `trackAction()` which persists to the agentic analytics system

### 6.4 API Client Layer

The frontend communicates with the backend via:

- `@tanstack/react-query` for data fetching with caching
- `logUserAction()` from `src/lib/api/userActions.ts` for action tracking
- Direct `fetch()` calls to `/api/*` endpoints with Bearer token auth
- `X-Data-Tier` header attached to all API requests

---

## 7. Deployment Architecture

### 7.1 Docker Compose Topology (Local Development)

```
docker-compose.yml defines four services:

+------------------------------+
|          app (API)           |
| Port 3000                   |
| Express + Scheduler         |
| Depends: db, redis          |
+------------------------------+
             |
+------------------------------+
|        worker                |
| BullMQ workers               |
| (ingestion, enrichment,     |
|  health score)               |
| Depends: db, redis          |
+------------------------------+
             |
     +-------+-------+
     |               |
+---------+   +----------+
|   db    |   |  redis   |
| PG 15   |   | Redis 7  |
| :5432   |   | :6379    |
| alpine  |   | alpine   |
+---------+   +----------+

Optional (profile: development):
+------------------------------+
|        frontend              |
| Vite dev server              |
| Port 5000                   |
+------------------------------+
```

- PostgreSQL uses `schema.sql` as init script
- Redis runs with `appendonly yes`, 256MB max, `allkeys-lru` eviction
- Health checks on both database and Redis before app/worker start
- Source volumes mounted read-only for hot reload

### 7.2 Terraform AWS Infrastructure

Defined in `terraform/main.tf`:

**Networking:**

- VPC with public, private, and database subnets across multiple AZs
- NAT gateways for private subnet internet access
- Separate security groups for app (port 3000), RDS (port 5432), and Redis (port 6379)

**Database:**

- RDS PostgreSQL (configurable version and instance class)
- gp3 storage, encrypted at rest
- Multi-AZ optional
- Automated backups with configurable retention
- Enhanced monitoring with dedicated IAM role
- CloudWatch log exports (postgresql, upgrade)
- Performance Insights optional

**Cache:**

- ElastiCache Redis replication group
- At-rest and in-transit encryption with auth token
- Optional automatic failover and Multi-AZ
- Slow-log and engine-log to CloudWatch

**Storage:**

- S3 bucket for data exports (versioned, AES256 encryption, lifecycle expiration)
- S3 bucket for backups (versioned, Glacier transition at 30 days, Deep Archive at 90)

**Monitoring:**

- CloudWatch alarms: RDS CPU > 80%, RDS storage < 10GB, Redis CPU > 75%, Redis memory > 80%
- SNS topic for alert delivery (email subscription)
- Application log group with configurable retention

### 7.3 Netlify + Render Deployment

**Frontend (Netlify):**

- Static SPA build from `apps/web/`
- URL: `https://public-record-data-scrapper.netlify.app`
- `npm run build` produces the Vite bundle

**Backend API (Render):**

- Express server as web service
- URL: `https://ucc-mca-api.onrender.com`
- Service ID: `srv-d6hh48fkijhs73fgk00g`
- Separate worker process for BullMQ workers

### 7.4 Environment Variable Configuration

**Server Core:**

- `NODE_ENV` -- development/production
- `PORT` / `HOST` -- Server binding
- `DATABASE_URL` -- PostgreSQL connection string
- `REDIS_URL` or `REDIS_HOST`/`REDIS_PORT` -- Redis connection
- `JWT_SECRET` -- JWT signing key
- `CORS_ORIGIN` -- Allowed origins (comma-separated)
- `LOG_LEVEL` -- Logging verbosity

**State Collector Credentials:**

- `CA_SOS_API_KEY` -- California API access
- `TX_SOSDIRECT_API_KEY`, `TX_SOSDIRECT_ACCOUNT_ID` -- Texas bulk access
- `FL_VENDOR_API_KEY`, `FL_VENDOR_API_SECRET`, `FL_VENDOR_CONTRACT_ACTIVE` -- Florida vendor feed

**Integration Credentials:**

- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME`
- `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`
- `ACH_API_KEY`, `ACH_MERCHANT_ID`, `ACH_ENVIRONMENT`
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET_NAME`

**Tiered Enrichment (prefix with `FREE_TIER_` or `STARTER_TIER_`):**

- `DNB_API_KEY`, `GOOGLE_PLACES_API_KEY`, `CLEARBIT_API_KEY`, `NEWS_API_KEY`
- `CSC_UCC_API_KEY`, `CSC_UCC_USERNAME`, `CTCORP_API_KEY`
- `LEXISNEXIS_API_KEY`, `LEXISNEXIS_CUSTOMER_ID`

**Other:**

- `DIGEST_RECIPIENT_EMAIL` -- Weekly digest recipient
- `VITE_USE_MOCK_DATA` -- Frontend: use demo data (1/true/yes)
- `VITE_API_BASE_URL` -- Frontend: API base URL

---

## 8. Testing Strategy

### 8.1 Test Pyramid

**Unit Tests (Vitest):**

- Frontend: `apps/web/` with jsdom environment, setup in `src/test/setup.ts`
- Server: Dedicated config at `vitest.config.server.ts` with node environment
- Run via `npm test` (frontend, watch mode) or `npm run test:server`
- 526+ tests total

**Integration Tests (Supertest):**

- Server tests in `server/__tests__/` test routes, queues, and workers
- Use `supertest` for HTTP-level testing of Express routes
- Setup file: `server/__tests__/setup.ts`

**E2E Tests (Playwright):**

- `npm run test:e2e` / `npm run test:e2e:ui` / `npm run test:e2e:headed`
- Tests full user flows through the browser

**Scraper Tests:**

- Dedicated scraper testing: `npm run test:scrapers` (all states)
- Per-state: `npm run test:scrapers:ca`, `:tx`, `:fl`, `:ny`
- Headed mode: `npm run test:scrapers:headed` for debugging

### 8.2 Coverage Configuration

Server coverage is configured in `vitest.config.server.ts`:

**Provider:** V8
**Reporters:** text, json, html, lcov
**Included:** `server/**/*.ts`
**Excluded:** Tests, type files, entry points (`index.ts`, `worker.ts`), queue workers (tested via integration)

**Thresholds** (enforced in CI or when `ENFORCE_COVERAGE=true`):

- Lines: 80%
- Functions: 80%
- Branches: 75%
- Statements: 80%

### 8.3 Test Setup Patterns

- **Server tests** run in a single fork (`pool: 'forks'`, `singleFork: true`) to avoid port conflicts
- **Timeouts:** 10s for both tests and hooks
- **Path aliases:** `@` -> `./server`, `@public-records/core` -> `./packages/core/src/index.ts`
- **Lint-staged:** ESLint + Prettier run on staged `.ts`/`.tsx` files via Husky pre-commit hooks

---

## 9. Security Considerations

### 9.1 Authentication

**JWT Authentication** (`server/middleware/authMiddleware.ts`):

- Bearer token from `Authorization` header
- Token verified against `config.jwt.secret`
- Decoded payload provides `user.id`, `user.email`, `user.role`
- Explicit error messages for missing header, malformed format, expired token, invalid token
- **Optional auth middleware** available for routes that accept but don't require auth
- **Role-based authorization** via `requireRole(...allowedRoles)` middleware

### 9.2 Request Security

- **Helmet:** Full suite of security headers (CSP, X-Frame-Options, X-Content-Type-Options, etc.)
- **CORS:** Configured origin whitelist with credentials support
- **HTTPS Redirect:** Production requests redirected from HTTP to HTTPS
- **Rate Limiting:** Redis-backed rate limiter (in-memory fallback in development)
- **Body Size Limits:** 10MB for JSON/form, 1MB for webhooks
- **Compression:** gzip/brotli via `compression` middleware

### 9.3 Input Validation

- **Zod schemas** on all webhook endpoints (Twilio SMS/voice, SendGrid events, Plaid transactions/items)
- **`validateRequest` middleware** for schema validation before handler execution
- **Database parameterization:** All SQL queries use `$1`, `$2` positional parameters -- no string interpolation
- **Company name normalization:** Triggers strip special characters and legal suffixes before storage

### 9.4 Webhook Signature Verification

Three dedicated signature verification middlewares in `server/middleware/webhookAuth.ts`:

| Middleware                | Service  | Mechanism                                          |
| ------------------------- | -------- | -------------------------------------------------- |
| `verifyTwilioSignature`   | Twilio   | HMAC-SHA1 signature validation against auth token  |
| `verifySendGridSignature` | SendGrid | Signature verification against webhook signing key |
| `verifyPlaidSignature`    | Plaid    | JWT verification of `Plaid-Verification` header    |

Webhook routes mount raw body parsing (`express.raw`) **before** the JSON parser so the original bytes are available for signature computation.

### 9.5 Fail-Closed Integration Pattern

Every external integration client implements a consistent fail-closed pattern:

1. **`isConfigured()` check** returns `false` if any required credential is missing
2. **No-op on unconfigured:** API calls return `{ success: false }` or throw descriptive errors
3. **No silent failures:** Missing credentials are logged as warnings at startup
4. **Adapter shells for unimplemented providers** (ACH, S3) throw explicit "not wired to a live provider" errors rather than returning default values

### 9.6 Audit Trail

- `auditMiddleware` logs all requests for compliance tracking
- `ingestion_logs` and `enrichment_logs` tables maintain full audit trails with timestamps, statuses, and error details
- `plaid_webhook_events` records all incoming Plaid webhooks

---

## 10. Operational Runbook

### 10.1 Start the System Locally

```bash
# Option A: Docker Compose (full stack)
docker-compose up -d                    # Start db, redis, app, worker
docker-compose --profile development up -d  # Also start frontend dev server

# Option B: Manual (requires local PostgreSQL + Redis)
npm install
npm run dev:full                        # Starts web (5000), API (3000), worker concurrently

# Option C: Individual processes
npm run dev                             # Vite dev server only (port 5000)
npm run dev:server                      # API server only (tsx --watch)
npm run dev:worker                      # Worker process only (tsx --watch)
```

### 10.2 Run Migrations

```bash
npm run db:migrate                      # Run database migrations
# or
npm run migrate                         # Alias

# Test database connection
npm run db:test

# Test database lifecycle (Docker-based)
npm run db:test:start                   # Start test PostgreSQL container
npm run db:test:status                  # Check container status
npm run db:test:reset                   # Reset test database
npm run db:test:stop                    # Stop container
```

### 10.3 Add a New State Collector

1. Create a new collector in `apps/web/src/lib/collectors/state-collectors/` implementing the `StateCollector` interface
2. Register it in `StateCollectorFactory.ts`
3. Add the state's strategy profile to `STATE_STRATEGY_PROFILES` in `server/queue/queues.ts`:
   ```typescript
   const STATE_STRATEGY_PROFILES = {
     CA: ['api'],
     TX: ['bulk'],
     FL: ['vendor'],
     // Add new state:
     IL: ['api', 'scrape'] // primary strategy first, fallback second
   }
   ```
4. Add a case to `resolveCollectorForJob()` in `server/queue/workers/ingestionWorker.ts`
5. Add the state to the scheduler's `states` array in `scheduleUCCIngestion()` (already includes IL)
6. Add environment variables for any credentials the collector needs
7. Add the state's implementation blueprint to `getImplementationBlueprint()` in `server/routes/health.ts`
8. Add probe endpoint to `PROBE_ENDPOINTS` in `server/queue/workers/portalProbeWorker.ts` if the state has a known portal URL

### 10.4 Add a New Outreach Template

1. Define the template key in your outreach service
2. Create template content with variable placeholders
3. Add the template to the `OutreachSequenceService.createSequence()` step definitions
4. Set the `channel` field on each step (`email`, `sms`, `call`, `briefing`)
5. For email templates, the `sendTransactional()` method in the SendGrid integration handles HTML rendering

### 10.5 Check System Health

```bash
# Basic health check
curl http://localhost:3000/api/health

# Detailed health check (includes database, memory, CPU status in dev)
curl http://localhost:3000/api/health/detailed

# Kubernetes probes
curl http://localhost:3000/api/health/ready     # Readiness (checks DB)
curl http://localhost:3000/api/health/live       # Liveness (always 200)

# 50-state coverage dashboard (JSON)
curl http://localhost:3000/api/health/coverage

# Single state coverage
curl http://localhost:3000/api/health/coverage/CA

# HTML status page (auto-refreshes every 60s)
open http://localhost:3000/status
```

### 10.6 Manually Trigger Jobs

```bash
# Trigger UCC ingestion for a state
curl -X POST http://localhost:3000/api/jobs/ingestion \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"state": "CA", "strategy": "api"}'

# Trigger enrichment for specific prospects
curl -X POST http://localhost:3000/api/enrichment \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prospectIds": ["uuid-1", "uuid-2"]}'

# Trigger outreach for a prospect
curl -X POST http://localhost:3000/api/outreach/trigger/{prospectId} \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"triggerType": "termination"}'

# Get pre-call briefing
curl http://localhost:3000/api/outreach/briefing/{prospectId} \
  -H "Authorization: Bearer $TOKEN"

# View job queue status
curl http://localhost:3000/api/jobs \
  -H "Authorization: Bearer $TOKEN"
```

### 10.7 Running Tests

```bash
# Frontend tests (watch mode)
npm test

# Frontend coverage
npm run test:coverage

# Server tests
npm run test:server

# Server tests with enforced coverage thresholds
npm run test:server:strict

# E2E tests
npm run test:e2e
npm run test:e2e:ui        # With Playwright UI
npm run test:e2e:headed    # With visible browser

# Scraper tests
npm run test:scrapers      # All states
npm run test:scrapers:ca   # California only
npm run test:scrapers:headed  # With visible browser
```

### 10.8 API Documentation

Swagger UI is available at `/api/docs` when the OpenAPI spec file (`server/openapi.yaml`) is present. Raw specs available at `/api/docs/openapi.json` and `/api/docs/openapi.yaml`.

---

## Appendix A: Process Architecture

The system runs as two processes plus infrastructure:

```
Process 1: API Server (server/index.ts)
  - Express middleware pipeline
  - All route handlers
  - Job scheduler (NodeJS setTimeout/setInterval)
  - Queue producers (enqueue jobs)
  - Telemetry persistence + hydration
  - Swagger UI

Process 2: Worker Process (server/worker.ts)
  - Ingestion worker (concurrency: 2)
  - Enrichment worker (concurrency: 5)
  - Health score worker (concurrency: 3)
  - (Portal probe, digest, termination, velocity, outreach
     workers are defined but not started in worker.ts --
     their job processing functions are called directly
     from the scheduler or route handlers)

Infrastructure:
  - PostgreSQL 15+ (RDS or Docker)
  - Redis 7+ (ElastiCache or Docker)
```

## Appendix B: Data Tier System

The platform supports two tiers that control enrichment depth and integration access:

| Tier | Header Value                                          | Resolution     | Enrichment Sources                                              |
| ---- | ----------------------------------------------------- | -------------- | --------------------------------------------------------------- |
| Free | `oss`, `open`, `free`, `community`, `base`, or absent | `free-tier`    | Basic UCC data only                                             |
| Paid | `paid`, `starter`, `pro`, `premium`                   | `starter-tier` | D&B, Google Places, Clearbit, NewsAPI, commercial UCC providers |

Tier is determined per-request via the `X-Data-Tier` HTTP header. The `dataTierRouter` middleware resolves the tier and attaches it to the request object. The resolved tier propagates to all queue jobs via the `dataTier` field in job data.

## Appendix C: Graceful Shutdown Sequence

Both server and worker processes handle `SIGTERM` and `SIGINT`:

**API Server:**

1. Stop job scheduler (clear all timeouts/intervals)
2. Close all BullMQ queues
3. Close rate limiter Redis connection
4. Disconnect from Redis
5. Disconnect from PostgreSQL

**Worker Process:**

1. Close all BullMQ workers (waits for in-progress jobs)
2. Close all BullMQ queues
3. Disconnect from Redis
4. Disconnect from PostgreSQL
