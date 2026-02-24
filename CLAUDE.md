# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

UCC-MCA Intelligence Platform - An AI-powered lead generation system for Merchant Cash Advance providers that analyzes Uniform Commercial Code (UCC) filings to identify businesses with active financing and predict MCA likelihood.

## Commands

```bash
# Development
npm run dev                    # Start Vite dev server (port 5000)
npm run kill                   # Kill process on port 5000

# Building
npm run build                  # TypeScript check + Vite build

# Testing
npm test                       # Run all tests (watch mode)
npm test -- AgenticEngine      # Run focused test
npm run test:ui                # Vitest UI dashboard
npm run test:coverage          # Generate coverage report

# Scraper Testing
npm run test:scrapers          # Test all state scrapers
npm run test:scrapers:ca       # Test CA scraper only
npm run test:scrapers:headed   # Test with visible browser

# Database
npm run db:migrate             # Run database migrations
npm run db:test                # Test database connection

# CLI Scraper
npm run scrape -- scrape-ucc -c "Company Name" -s CA -o results.json

# Linting
npm run lint                   # Run ESLint
```

## Architecture

### Frontend (`src/`)

**Entry point**: `src/App.tsx` orchestrates dashboard tabs, wires `StatsOverview`, `AdvancedFilters`, and `AgenticDashboard`. View state persists via `useKV` (keep KV keys stable).

**Agentic System** (`src/lib/agentic/`):

- `AgenticEngine.ts` - Autonomous loop with safety gates (`autonomousExecutionEnabled`, category-based review)
- `AgenticCouncil.ts` - Sequences agents: DataAnalyzer → Optimizer → Security → UXEnhancer
- `BaseAgent.ts` - Base class for new agents (extend and push suggestions into handoff)
- React bridge: `src/hooks/use-agentic-engine.ts` - Caches engine, persists improvements via `useKV`

**Data Flow**:

- Mock data: `src/lib/mockData.ts` (shapes match `src/lib/types.ts`)
- Type definitions: `src/lib/types.ts` (canonical source - update before UI changes)
- Filtering: `filteredAndSortedProspects` memo in `App.tsx`
- User events: Route through `trackAction()` for agentic analytics

**UI Components** (`src/components/ui/`):

- ShadCN pattern with Tailwind; reuse these wrappers instead of raw Radix
- Theme: CSS variables in `styles/theme.css` and `theme.json`
- Icons: `@phosphor-icons/react` (proxied via Vite plugin)
- Theme switching: `ThemeToggle` + `ThemeProvider` (next-themes)

### Backend (`server/`)

Express.js REST API with:

- **Routes**: `prospects.ts`, `competitors.ts`, `portfolio.ts`, `enrichment.ts`, `jobs.ts`, `health.ts`
- **Services**: Business logic layer (ProspectsService, CompetitorsService, etc.)
- **Queue**: BullMQ + Redis job system with workers for ingestion, enrichment, health scoring
- **Middleware**: Error handling, request logging, rate limiting, Zod validation

API server: `server/index.ts` | Worker process: `server/worker.ts`

### Data Collection (`src/lib/collectors/`)

- `StateCollectorFactory.ts` - Factory for state-specific collectors
- `state-collectors/` - Individual state implementations
- `RateLimiter.ts` - Rate limiting for external APIs

### Scrapers (`src/lib/scrapers/`)

- Puppeteer-based scrapers for state UCC portals (CA, TX, FL, NY)
- Test with `npm run test:scrapers`

## Key Files

| File                        | Purpose                                    |
| --------------------------- | ------------------------------------------ |
| `src/lib/types.ts`          | Canonical type definitions - update first  |
| `src/lib/mlScoring.ts`      | ML scoring helpers - keep pure for testing |
| `src/lib/exportUtils.ts`    | JSON/CSV exports with `escapeCsvValue`     |
| `src/lib/utils/sanitize.ts` | XSS prevention with DOMPurify              |
| `database/schema.sql`       | PostgreSQL schema                          |
| `terraform/`                | AWS infrastructure (VPC, RDS, ElastiCache) |

## Testing Notes

- 526 tests total, Vitest with jsdom environment
- Setup file: `src/test/setup.ts` (add DOM helpers here)
- Agentic tests: `src/lib/agentic/AgenticEngine.test.ts` - assert safety thresholds and feedback loops

## Git Workflow

- Merge sibling branches before opening PRs
- Stage only files you touched
- Build skips diagnostics (`tsc -b --noCheck`), rely on IDE type checking

<!-- ORGANVM:AUTO:START -->

## System Context (auto-generated — do not edit)

**Organ:** ORGAN-III (Commerce) | **Tier:** flagship | **Status:** PUBLIC_PROCESS
**Org:** `unknown` | **Repo:** `public-record-data-scrapper`

### Edges

- **Produces** → `unknown`: unknown

### Siblings in Commerce

`classroom-rpg-aetheria`, `gamified-coach-interface`, `trade-perpetual-future`, `fetch-familiar-friends`, `sovereign-ecosystem--real-estate-luxury`, `search-local--happy-hour`, `multi-camera--livestream--framework`, `universal-mail--automation`, `mirror-mirror`, `the-invisible-ledger`, `enterprise-plugin`, `virgil-training-overlay`, `tab-bookmark-manager`, `a-i-chat--exporter`, `.github` ... and 11 more

### Governance

- Strictly unidirectional flow: I→II→III. No dependencies on Theory (I).

_Last synced: 2026-02-24T12:41:28Z_

<!-- ORGANVM:AUTO:END -->
