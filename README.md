# Public Record Data Scraper

**Extract, enrich, and score UCC filings from all 50 US state Secretary of State portals.** Turns raw public records into prioritized, outreach-ready leads for the Merchant Cash Advance industry.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tests: 2,055](https://img.shields.io/badge/tests-2%2C055%20passing-brightgreen)](https://github.com/organvm-iii-ergon/public-record-data-scrapper)
[![Deploy: Vercel](https://img.shields.io/badge/deploy-Vercel-black?logo=vercel)](https://public-record-data-scrapper.vercel.app)

---

## What It Does

1. **Collects** UCC-1 filing data from 50 state portals via 60+ autonomous agents (handles CAPTCHAs, rate limits, session management, and fallback strategies per state)
2. **Enriches** each filing with data from SEC EDGAR, OSHA, USPTO, Census Bureau, SAM.gov, and optional commercial sources (D&B, Clearbit, ZoomInfo)
3. **Scores** every prospect 0--100 on financing likelihood, assigns a health grade (A--F), and flags growth signals (hiring, permits, equipment purchases, expansion)
4. **Delivers** results through a React web dashboard, REST API, or CLI tool

### Example Output

```json
{
  "company": "Pacific Coast Distributors LLC",
  "state": "CA",
  "ucc_filings": [
    {
      "filing_number": "2024-0847291",
      "secured_party": "National Funding Inc",
      "filing_date": "2024-03-15",
      "type": "UCC-1"
    }
  ],
  "enrichment": {
    "revenue_estimate": "$2.4M",
    "employee_count": 34,
    "growth_signals": ["hiring_detected", "new_permits", "equipment_purchase"],
    "health_grade": "B+",
    "priority_score": 82,
    "industry": "Wholesale Distribution"
  },
  "recommendation": "HIGH PRIORITY - Active financing, strong growth signals, clean compliance record"
}
```

---

## Quick Start

```bash
git clone https://github.com/organvm-iii-ergon/public-record-data-scrapper.git
cd public-record-data-scrapper
npm install --legacy-peer-deps
```

### Run with Docker (recommended)

```bash
docker-compose up -d db redis          # Start PostgreSQL + Redis
npm run db:migrate && npm run seed     # Initialize database
npm run dev:full                       # Start frontend + API + worker
```

Frontend: `http://localhost:5000` | API: `http://localhost:3000`

### CLI Only (no database required)

```bash
# Scrape UCC filings for a company
npm run scrape -- scrape-ucc -c "Company Name" -s CA -o results.json

# Enrich from public sources
npm run scrape -- enrich -c "Company Name" -s CA -o enriched.json

# Batch process from CSV
npm run scrape -- batch -i companies.csv -o ./results

# List all 50 state agents
npm run scrape -- list-states
```

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  React 19 + Vite (Vercel CDN)                       │
│  Dashboard · Deal Pipeline · Compliance · Inbox     │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  Express API + BullMQ Workers                       │
│  27 domain services · OpenAPI 3.0 · JWT auth        │
└───────┬──────────────┬──────────────────────────────┘
        │              │
┌───────▼──────┐ ┌─────▼───────┐ ┌────────────────────┐
│ PostgreSQL   │ │   Redis 7   │ │ Agent Orchestrator  │
│ 9 migrations │ │ cache/queue │ │ 60+ collectors      │
│ multitenancy │ │             │ │ circuit breakers     │
└──────────────┘ └─────────────┘ └─────┬──────────────┘
                                       │
                    ┌──────────────────▼────────────────┐
                    │  50 State SOS Agents               │
                    │  CA · TX · NY · FL · IL · ...      │
                    │  + SEC · OSHA · USPTO · Census     │
                    └────────────────────────────────────┘
```

### Monorepo Layout

```
public-record-data-scrapper/
├── apps/
│   ├── web/               # React 19 dashboard (Radix UI, Tailwind)
│   ├── desktop/           # Tauri desktop app
│   └── mobile/            # Mobile app target
├── server/
│   ├── services/          # 27 domain services (scoring, enrichment, compliance, ...)
│   ├── integrations/      # Twilio, SendGrid, Plaid, ACH, AWS S3
│   ├── routes/            # Express route handlers
│   └── openapi.yaml       # API specification
├── packages/
│   ├── core/              # Shared types, DB client, utilities
│   └── ui/                # Shared component library
├── database/
│   ├── schema.sql         # Full PostgreSQL schema
│   └── migrations/        # 9 versioned migrations with rollbacks
├── terraform/             # AWS infrastructure (VPC, RDS, ElastiCache, S3)
├── k8s/                   # Kubernetes manifests
├── monitoring/            # Prometheus + CloudWatch alert rules
└── tests/                 # Integration + E2E (Playwright)
```

---

## API

The Express server exposes a RESTful API documented at `/api/docs` when running.

| Method  | Endpoint                   | Description                                  |
| ------- | -------------------------- | -------------------------------------------- |
| `GET`   | `/api/prospects`           | List prospects with filtering and pagination |
| `GET`   | `/api/prospects/:id`       | Prospect detail with enrichment data         |
| `POST`  | `/api/prospects/:id/claim` | Claim a prospect for outreach                |
| `POST`  | `/api/prospects/:id/score` | Trigger re-scoring                           |
| `GET`   | `/api/deals`               | List deals with pipeline stage filter        |
| `PATCH` | `/api/deals/:id/stage`     | Move deal to next pipeline stage             |
| `POST`  | `/api/communications/send` | Send email or SMS                            |
| `GET`   | `/api/compliance/report`   | Generate compliance report                   |

Full endpoint list: [server/openapi.yaml](server/openapi.yaml)

### Data Tiers

| Tier           | Sources                                                     | Cost         |
| -------------- | ----------------------------------------------------------- | ------------ |
| **Free / OSS** | SEC EDGAR, OSHA, USPTO, Census, SAM.gov                     | $0           |
| **Paid**       | + D&B, Clearbit, Experian, ZoomInfo, Google Places, NewsAPI | Subscription |

### Pricing & Billing

- `Free` — $0/month, light-volume preview access and exported results delivered by email
- `Starter` — $49/month, 1,000 monthly lookups across 5 states
- `Pro` — $149/month, 15,000 monthly lookups across all 50 states plus API/batch access
- Public signup flow: `POST /api/billing/signup`
- Stripe checkout is activated by setting `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_STARTER`, and `STRIPE_PRICE_ID_PRO`

---

## Key Features

- **50-state UCC collection** -- autonomous agents for every Secretary of State portal, with per-state fallback strategies (API, bulk download, vendor feed, scrape)
- **ML-based lead scoring** -- priority score (0--100), health grade, growth signal detection, revenue estimation, competitive position analysis
- **Compliance built in** -- CA SB 1235 and NY CFDL disclosure calculators, TCPA consent tracking, suppression list management, immutable audit trail
- **Full broker workflow** -- prospect dashboard, deal pipeline (Kanban), contact CRM, unified communications inbox (email/SMS/voice), bank statement underwriting (Plaid)
- **Production infrastructure** -- Terraform-provisioned AWS (VPC, RDS, ElastiCache, S3), Vercel frontend deployment, Docker Compose for local dev, Kubernetes manifests for container orchestration

---

## Testing

2,055 tests across 91 files. Zero failures.

```bash
npm test                       # Full suite
npm run test:coverage          # V8 coverage report
npm run test:server            # Server-side only
npm run test:e2e               # Playwright end-to-end
```

| Category            | Tests | Scope                                              |
| ------------------- | ----- | -------------------------------------------------- |
| Frontend components | ~500  | React dashboard, pipeline, inbox, forms            |
| Server services     | ~400  | All 27 domain services                             |
| State agents        | ~250  | 50 state-specific collectors + fallback strategies |
| Agentic system      | ~200  | Agent engine, orchestration, council               |
| Data pipeline       | ~150  | Quality checks, enrichment, stale data detection   |
| Server routes       | ~150  | API endpoints, webhook verification                |
| Integration + E2E   | ~100  | Cross-service workflows                            |
| Security            | ~55   | XSS prevention, input sanitization                 |

---

## Infrastructure

### Local Development

```bash
docker-compose --profile development up -d    # Full stack
docker-compose ps                             # Verify health
```

### Production (AWS via Terraform)

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars  # Configure
terraform init && terraform plan              # Review
terraform apply                               # Deploy
```

Provisions: VPC with multi-AZ subnets, RDS PostgreSQL (encrypted, Multi-AZ), ElastiCache Redis (encrypted), S3 with lifecycle policies, CloudWatch + SNS alerting, IAM with least-privilege policies.

---

## Contributing

1. Fork and create a feature branch: `git checkout -b feature/your-feature`
2. Install: `npm install --legacy-peer-deps`
3. Develop: `npm run dev:full`
4. Test: `npm test` (all 2,055 tests must pass)
5. Lint: `npm run lint`
6. Commit: `git commit -m "feat: description"` ([Conventional Commits](https://www.conventionalcommits.org/))
7. Open a Pull Request

### Priority Contribution Areas

- **State agent implementations** -- live implementations needed for NY, IL, OH, GA, PA
- **Enrichment sources** -- state business registries, county assessor records
- **Compliance expansion** -- additional state disclosure requirements
- **Performance** -- query optimization for large prospect datasets (10K+)

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide. Report security issues via [SECURITY.md](SECURITY.md).

---

## Tech Stack

| Layer          | Technology                                             |
| -------------- | ------------------------------------------------------ |
| Frontend       | React 19, TypeScript 5.9, Vite, Radix UI, Tailwind CSS |
| Backend        | Express, Node.js, BullMQ, Zod                          |
| Database       | PostgreSQL 15, Redis 7                                 |
| Scraping       | Puppeteer (headless browser automation)                |
| Integrations   | Twilio, SendGrid, Plaid, ACH, AWS S3                   |
| Testing        | Vitest, Testing Library, Playwright                    |
| Infrastructure | Terraform (AWS), Docker Compose, Kubernetes            |
| CI/CD          | GitHub Actions                                         |
| Deployment     | Vercel (frontend), AWS (backend)                       |

---

## License

[MIT](LICENSE) -- [@4444J99](https://github.com/4444J99)
