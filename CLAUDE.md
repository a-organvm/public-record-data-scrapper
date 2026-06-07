# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

UCC-MCA Intelligence Platform — AI-powered lead generation for Merchant Cash Advance providers. Analyzes Uniform Commercial Code (UCC) filings to identify businesses with active financing and predict MCA likelihood. Features an autonomous agentic system for self-improving analytics.

## Commands

```bash
# Development
npm run dev                    # Frontend only (Vite on port 5173)
npm run dev:server             # API server only (Express on port 3000)
npm run dev:worker             # BullMQ worker process only
npm run dev:full               # All three concurrently (web + api + worker)

# Building
npm run build                  # TypeScript check + Vite build → dist/
npm run build:render           # Frontend build + bundled API server for Render/production
npm start                      # Run bundled production API server (dist/server.cjs)

# Testing — Frontend (Vitest + jsdom)
npm test                       # All frontend tests (watch mode)
npm test -- AgenticEngine      # Run focused test by name
npm run test:ui                # Vitest UI dashboard
npm run test:coverage          # Coverage report

# Testing — Server (Vitest + Node)
npm run test:server            # Server tests (single fork, 10s timeout)
npm run test:server:strict     # Enforce 80% coverage thresholds
npm run test:server:coverage   # Server coverage report

# Testing — E2E (Playwright)
npm run test:e2e               # Headless (5 browsers: Chrome, Firefox, Safari, Mobile Chrome/Safari)
npm run test:e2e:headed        # Visible browser
npm run test:e2e:ui            # Interactive Playwright UI
npm run test:e2e:debug         # Playwright debugger

# Testing — Scrapers (Puppeteer)
npm run test:scrapers          # All state scrapers
npm run test:scrapers:ca       # Single state (also :tx, :fl, :ny)
npm run test:scrapers:headed   # Visible browser

# Database
npm run db:migrate             # Run migrations
npm run db:test                # Test connection
npm run db:test:start          # Start test Postgres container
npm run db:test:stop           # Stop test Postgres container
npm run seed                   # Seed database

# CLI Scraper
npm run scrape -- scrape-ucc -c "Company Name" -s CA -o results.json

# Docker (local full-stack)
docker-compose up -d           # App (3000) + Postgres (5432) + Redis (6379) + Worker
docker-compose --profile development up -d  # Above + Vite frontend (5000)

# Linting
npm run lint                   # ESLint (ts-eslint + react-hooks + react-refresh)
```

## Architecture

### Monorepo Structure (npm workspaces)

```
apps/
  web/       → React 19 + Vite 7 SPA (primary dashboard)
  desktop/   → Tauri + React 19 native desktop client
  mobile/    → Expo + React Native
packages/
  core/      → @public-records/core — canonical database client, identity, types
  ui/        → @public-records/ui — 60+ ShadCN/Radix component exports
server/      → Express.js REST API + BullMQ queue workers
database/    → PostgreSQL schema (uuid-ossp, pg_trgm, btree_gin extensions)
terraform/   → AWS infrastructure (VPC, RDS, ElastiCache)
```

**Path alias trap**: `@` resolves to different roots depending on context:

- Frontend (vite.config.ts): `@` → `apps/web/src/`
- Server tests (vitest.config.server.ts): `@` → `server/`
- tsconfig.json also maps `@public-records/core` and `@public-records/ui` to `packages/`

### Frontend (`apps/web/src/`)

**Entry point**: `App.tsx` orchestrates dashboard tabs (Prospects, Portfolio, Intelligence, Analytics, Requalification, Agentic). View state persists via `useKV` — keep KV keys stable.

**Agentic System** (`lib/agentic/`):

- `AgenticEngine.ts` — Autonomous loop with safety gates: `autonomousExecutionEnabled` defaults to `false`, `safetyThreshold: 80`, categories like `security` and `data-quality` always require manual review
- `AgenticCouncil.ts` — Sequences agents: DataAnalyzer → Optimizer → Security → UXEnhancer
- `BaseAgent.ts` — Extend this and push suggestions into the handoff to add new agents
- React bridge: `hooks/use-agentic-engine.ts` — Caches engine, persists improvements via `useKV`. Always call `setImprovements(engine.getImprovements())` after mutating engine state

**Data Flow**:

- Types: `lib/types.ts` is canonical — update before UI changes
- Mock data: `lib/mockData.ts` (shapes match types.ts, toggle via `VITE_USE_MOCK_DATA`)
- Filtering: `filteredAndSortedProspects` memo in `App.tsx`
- User events: Route through `trackAction()` for agentic analytics
- Batch ops: `selectedProspectIds` syncs with `BatchOperations` + checkbox overlay in `ProspectCard`

**UI**:

- ShadCN wrappers in `components/ui/` — reuse these, don't import raw Radix
- Theme: CSS variables in `styles/theme.css` + `theme.json`, dark mode via `next-themes` (`data-appearance` selector)
- Icons: `@phosphor-icons/react` proxied via `createIconImportProxy` in vite.config.ts — **do not remove that plugin or the Spark plugin**

### Backend (`server/`)

Express.js REST API (port 3000) with Swagger at `/api/docs`.

**Routes** (18 files): health, status, prospects, competitors, competitive, portfolio, enrichment, jobs, contacts, deals, billing, webhooks, outreach, communications, compliance, discovery, agentic, metrics. All require JWT auth except health, webhooks (signature-verified), and metrics (JWT **or** `METRICS_TOKEN`).

**Services** (30 files): ProspectsService, CompetitorsService, PortfolioService, EnrichmentService, ScoringService, StackAnalysisService, SuppressionService (TCPA/DNC), UnderwritingService, ComplianceReportService, AlertService, ContactsService, DealsService, CommunicationsService, QualificationService, NarrativeService, ConsentService, DisclosureService, AuditService, DisclosureCalculator, ReplyHandlingService, LeadDiscoveryService (+ discovery-channels: SEC EDGAR, Socrata permits, SBA loans), ImprovementExecutor, OutreachSequenceService, and supporting modules under `server/services/`.

**Integrations** (7): ACH payments, AWS (S3/SQS/CloudWatch), Plaid (bank linking), SendGrid (email), Stripe (payments + webhooks), Twilio (SMS/voice).

**Queue** (BullMQ + Redis): 3 queues — `ucc-ingestion` (daily 2AM, concurrency 2), `data-enrichment` (every 6h, concurrency 5), `health-scores` (every 12h, concurrency 3). Worker runs as separate process (`server/worker.ts`) with graceful 30s shutdown.

**Startup telemetry hydration**: Production startup hydrates persisted ingestion telemetry before queue boot. Use `INGESTION_TELEMETRY_SKIP_HYDRATION=true` to bypass it in constrained environments, or `INGESTION_TELEMETRY_HISTORY_LIMIT=<n>` to cap per-state history loaded at boot (default `50`).

### Data Collection (`apps/web/src/lib/collectors/`)

- `StateCollectorFactory.ts` — Factory pattern, selects by state code
- Collectors: CA (state portal), NY (state portal), TX (bulk download), FL (CSC/CT Corp vendor)
- `RateLimiter.ts` — Rate limiting for external APIs

### Database (`database/schema.sql`)

PostgreSQL 14+ with extensions: `uuid-ossp`, `pg_trgm` (fuzzy text search), `btree_gin`.

Core tables: `ucc_filings` (UUID PK, filing data, debtor/secured party, JSONB raw_data), `prospects` (priority_score 0-100, status enum, enrichment_confidence 0-1), `prospect_ucc_filings` (junction), `growth_signals`.

## Testing Notes

- Frontend: 526 tests, Vitest + jsdom, setup in `apps/web/src/test/setup.ts`
- Server: Vitest + Node, setup in `server/__tests__/setup.ts`, 80% coverage thresholds in CI
- E2E: Playwright, 5 browser projects, base URL `http://127.0.0.1:5173`
- Agentic tests: `apps/web/src/lib/agentic/AgenticEngine.test.ts` — assert safety thresholds and feedback loops

## Git Workflow

- Build skips diagnostics (`tsc -b --noCheck`); rely on IDE type checking
- Merge sibling branches before opening PRs
- Stage only files you touched
- Husky + lint-staged runs ESLint fix + Prettier on staged `.{js,jsx,ts,tsx}` files

## ⚡ Conductor OS Integration

This repository is a managed component of the ORGANVM meta-workspace.

- **Orchestration:** Use `conductor patch` for system status and work queue.
- **Lifecycle:** Follow the `FRAME -> SHAPE -> BUILD -> PROVE` workflow.
- **Governance:** Promotions are managed via `conductor wip promote`.
- **Intelligence:** Conductor MCP tools are available for routing and mission synthesis.

<!-- ORGANVM:AUTO:START -->
## System Context (auto-generated — do not edit)

**Organ:** ORGAN-III (Commerce) | **Tier:** flagship | **Status:** GRADUATED
**Org:** `organvm-iii-ergon` | **Repo:** `public-record-data-scrapper`

### Edges
- **Produces** → `organvm-v-logos/public-process`: dependency

### Siblings in Commerce
`classroom-rpg-aetheria`, `gamified-coach-interface`, `trade-perpetual-future`, `fetch-familiar-friends`, `sovereign-ecosystem--real-estate-luxury`, `search-local--happy-hour`, `multi-camera--livestream--framework`, `universal-mail--automation`, `mirror-mirror`, `the-invisible-ledger`, `enterprise-plugin`, `virgil-training-overlay`, `tab-bookmark-manager`, `a-i-chat--exporter`, `.github` ... and 16 more

### Governance
- Strictly unidirectional flow: I→II→III. No dependencies on Theory (I).

*Last synced: 2026-06-06T01:01:09Z*

## Active Handoff Protocol

If `.conductor/active-handoff.md` exists, **READ IT FIRST** before doing any work.
It contains constraints, locked files, conventions, and completed work from the
originating agent. You MUST honor all constraints listed there.

If the handoff says "CROSS-VERIFICATION REQUIRED", your self-assessment will
NOT be trusted. A different agent will verify your output against these constraints.

## Session Review Protocol

At the end of each session that produces or modifies files:
1. Run `organvm session review --latest` to get a session summary
2. Check for unimplemented plans: `organvm session plans --project .`
3. Export significant sessions: `organvm session export <id> --slug <slug>`
4. Run `organvm prompts distill --dry-run` to detect uncovered operational patterns

Transcripts are on-demand (never committed):
- `organvm session transcript <id>` — conversation summary
- `organvm session transcript <id> --unabridged` — full audit trail
- `organvm session prompts <id>` — human prompts only


## System Library

Plans: 269 indexed | Chains: 5 available | SOPs: 18 active
Discover: `organvm plans search <query>` | `organvm chains list` | `organvm sop lifecycle`
Library: `/Users/4jp/Code/organvm/praxis-perpetua/library`


## Active Directives

| Scope | Phase | Name | Description |
|-------|-------|------|-------------|
| system | any | atomic-clock | The Atomic Clock |
| system | any | execution-sequence | Execution Sequence |
| system | any | multi-agent-dispatch | Multi-Agent Dispatch |
| system | any | session-handoff-avalanche | Session Handoff Avalanche |
| system | any | system-loops | System Loops |
| system | any | prompting-standards | Prompting Standards |
| system | any | prompting-standards | Prompting Standards |
| system | any | prompting-standards | Prompting Standards |
| system | any | background-task-resilience | background-task-resilience |
| system | any | context-window-conservation | context-window-conservation |
| system | any | session-self-critique | session-self-critique |
| system | any | the-descent-protocol | the-descent-protocol |
| system | any | the-membrane-protocol | the-membrane-protocol |
| system | any | theory-to-concrete-gate | theory-to-concrete-gate |
| system | any | triangulation-protocol | triangulation-protocol |

Linked skills: SOP-TRIADIC-REVIEW-PROTOCOL, cicd-resilience-and-recovery, continuous-learning-agent, evaluation-to-growth, genesis-dna, multi-agent-workforce-planner, promotion-and-state-transitions, quality-gate-baseline-calibration, repo-onboarding-and-habitat-creation, session-self-critique, structural-integrity-audit, the-membrane-protocol, triple-reference


**Prompting (Anthropic)**: context 200K tokens, format: XML tags, thinking: extended thinking (budget_tokens)


## Atomization Pipeline

Run `organvm atoms pipeline --write && organvm atoms fanout --write` to generate task queue.


## System Density (auto-generated)

AMMOI: 25% | Edges: 0 | Tensions: 0 | Clusters: 0 | Adv: 27 | Events(24h): 38774
Structure: 8 organs / 149 repos / 1654 components (depth 17) | Inference: 0% | Organs: META-ORGANVM:63%, ORGAN-I:53%, ORGAN-II:48%, ORGAN-III:55% +5 more
Last pulse: 2026-06-06T01:01:02 | Δ24h: n/a | Δ7d: n/a


## Dialect Identity (Trivium)

**Dialect:** EXECUTABLE_ALGORITHM | **Classical Parallel:** Arithmetic | **Translation Role:** The Engineering — proves that proofs compute

Strongest translations: I (formal), II (structural), VII (structural)

Scan: `organvm trivium scan III <OTHER>` | Matrix: `organvm trivium matrix` | Synthesize: `organvm trivium synthesize`


## Logos Documentation Layer

**Status:** MISSING | **Symmetry:** 0.0 (VACUUM)

Nature demands a documentation counterpart. This formation maintains its narrative record in `docs/logos/`.

### The Tetradic Counterpart
- **[Telos (Idealized Form)](../docs/logos/telos.md)** — The dream and theoretical grounding.
- **[Pragma (Concrete State)](../docs/logos/pragma.md)** — The honest account of what exists.
- **[Praxis (Remediation Plan)](../docs/logos/praxis.md)** — The attack vectors for evolution.
- **[Receptio (Reception)](../docs/logos/receptio.md)** — The account of the constructed polis.

### Alchemical I/O
- **[Source & Transmutation](../docs/logos/alchemical-io.md)** — Narrative of inputs, process, and returns.

- **[Public Essay](https://organvm-v-logos.github.io/public-process/)** — System-wide narrative entry.

*Compliance: Formation is currently void.*

<!-- ORGANVM:AUTO:END -->
