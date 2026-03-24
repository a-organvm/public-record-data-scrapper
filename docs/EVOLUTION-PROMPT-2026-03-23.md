# Evolution Prompt: Beyond UCC Scraping — Next-Generation MCA Intelligence

**Date:** 2026-03-23
**Context:** Inbound client (Alternative Funding Group, Tony Carbone — Managing Partner) asked two critical questions during a 40-minute discovery call:

1. "Does your system work with all 50 states? Will it continue to work?"
2. UCC scraping is only one signal — what are the next-level methods?

**Goal:** Evolve this platform from a UCC filing aggregator into a comprehensive MCA prospect intelligence system. UCC filings become one input among many. The system should answer: "Which businesses need capital RIGHT NOW, can repay, and aren't being aggressively competed for?"

---

## Phase 1: Reliability Hardening (Answer: "Will it continue to work?")

The current 50-state agent architecture uses fallback strategies (API → bulk download → vendor feed → scrape). Harden this:

### 1.1 Anti-Fragile Scraping Infrastructure

- [ ] Implement proxy rotation pool (residential proxies for state portals with IP-based rate limits)
- [ ] Add CAPTCHA solving integration (2Captcha/hCaptcha solver as a service, not headless browser hacks)
- [ ] Build state portal health monitor — daily automated checks against each of the 50 SOS portals:
  - Response time, schema changes, new anti-bot measures, downtime patterns
  - Alert pipeline when a state agent starts failing (don't wait for full failure)
- [ ] Implement agent self-healing: when a state agent fails, automatically try the next fallback strategy and log the transition
- [ ] Add data quality assertions per state: expected record volume ranges, field completeness thresholds, deduplication rates

### 1.2 Continuous Operation Guarantees

- [ ] Build a "coverage dashboard" showing real-time status of all 50 state agents:
  - Last successful pull, records collected (24h/7d/30d), error rate, current strategy in use
- [ ] Implement circuit breakers with exponential backoff PER STATE (already in architecture — verify implementation)
- [ ] Add vendor feed fallback for high-value states (CA, TX, FL, NY) — commercial UCC data providers as insurance
- [ ] Create quarterly "state portal audit" automation: re-validate all 50 agents against live portals, report degradation

### 1.3 Tony-Specific Deliverable

- [ ] Build a simple status page Tony can check: "All 50 states green/yellow/red" with last-pull timestamps
- [ ] Weekly email digest: records collected, new filings by state, system health score

---

## Phase 2: Beyond UCC — Next-Level Data Signals

UCC filings tell you "this business has existing financing." That's table stakes. The competitive advantage is combining UCC data with signals that tell you:

- **Timing**: When is a business most likely to need MORE capital?
- **Ability**: Can they actually handle another advance?
- **Competition**: Who else is already chasing this merchant?

### 2.1 Bank Statement Intelligence (Tony's Primary Interest)

The Plaid integration already exists in `server/integrations/plaid/`. Extend it:

- [ ] Build bank statement pattern analyzer:
  - Daily balance trends (declining = may need capital, but also risk signal)
  - Revenue consistency (regular deposits vs. lumpy)
  - Existing MCA payment patterns (daily/weekly fixed debits = active advances)
  - Seasonal patterns (restaurants spike summer, retail spikes Q4)
  - NSF/overdraft frequency (risk signal)
- [ ] Create "stacking detection": identify merchants with multiple concurrent advances by spotting multiple fixed daily debits to different entities
- [ ] Build "capacity calculator": given current revenue and existing obligations, estimate max new advance amount
- [ ] **Public records angle** (what Tony specifically asked about):
  - Court records scraping for judgments, defaults, confessions of judgment (COJ)
  - State UCC-3 amendment tracking (terminations = freed-up capacity, amendments = restructuring)
  - Business entity status changes via SOS (new formations = growth, dissolutions = risk)
  - Tax lien filings (IRS, state) from county recorder offices

### 2.2 Business Health Signals (Enrichment Layer v2)

Current enrichment pulls from SEC EDGAR, OSHA, USPTO, Census, SAM.gov. Add:

- [ ] **Google Business Profile signals**: review velocity, rating trends, response rate, photo freshness (active business proxy)
- [ ] **Hiring signals**: Indeed/LinkedIn job postings (hiring = growth = may need capital for expansion)
- [ ] **Technology stack changes**: BuiltWith/Wappalyzer (upgrading tech = investing in business)
- [ ] **Web traffic trends**: SimilarWeb API or Semrush (traffic growth/decline as health proxy)
- [ ] **Social media activity**: posting frequency, engagement trends (active marketing = active business)
- [ ] **Domain age + SSL cert monitoring**: new domains = new business, expired SSL = neglect
- [ ] **Yelp/TripAdvisor for hospitality vertical**: review velocity as revenue proxy
- [ ] **Equipment lease filings**: UCC-1 filings specifically for equipment (signals capital expenditure patterns)
- [ ] **SBA loan data**: businesses that received SBA loans may need bridge financing

### 2.3 Competitive Intelligence Layer

This is what no current MCA lead provider offers:

- [ ] **Funder identification from UCC filings**: map secured party names to known MCA funders/brokers
  - Build a funder database: company name → known DBA names → filing patterns
  - Detect when a merchant has filings from aggressive stackers vs. conservative funders
- [ ] **Filing velocity tracking**: a merchant getting a new UCC filing every 60 days is a serial stacker (high risk but also high demand signal)
- [ ] **Competitive heat map**: which funders are most active in which states/industries?
- [ ] **"Fresh filing" alerts**: real-time notification when a UCC filing is terminated (= merchant just paid off an advance, has fresh capacity)

### 2.4 Predictive Scoring Engine (ML v2)

Current scoring engine assigns 0-100 priority score. Upgrade:

- [ ] Train on outcome data: which leads actually converted? Which defaulted? (Requires Tony's historical data)
- [ ] Multi-signal fusion: combine UCC age + bank patterns + health signals + competitive position into a composite "readiness score"
- [ ] Time-decay weighting: recent signals matter more than stale data
- [ ] Segment-specific models: restaurant MCA prospects behave differently from trucking companies
- [ ] "Optimal timing" predictor: when in the advance lifecycle is a merchant most likely to re-up?

---

## Phase 3: Delivery & Automation (Tony's Sales Team)

### 3.1 Sales Team Automation

Tony's team currently does manual outreach. Automate:

- [ ] Smart dialer queue: prioritize calls by readiness score, time zone, and best-contact-time model
- [ ] Pre-call briefing auto-generation: one-page summary of the merchant (filings, estimated revenue, existing obligations, talking points)
- [ ] Automated email/SMS sequences triggered by events:
  - New UCC filing = "We noticed you recently secured financing..."
  - UCC termination = "Congratulations on paying off your advance. Ready for growth capital?"
  - Business growth signal = "We see [business name] is expanding..."
- [ ] CRM integration: push scored leads directly into their pipeline tool
- [ ] Compliance auto-check before outreach: TCPA consent, DNC list, state-specific disclosure requirements

### 3.2 Rehab/Healthcare Vertical (Flyland.com)

Tony also runs healthcare SaaS. The same intelligence platform pattern applies:

- [ ] Map healthcare-specific public records: state licensing boards, CMS provider enrollment, NPPES (NPI registry)
- [ ] Rehab facility signals: licensing changes, capacity changes, ownership transfers
- [ ] Ad campaign intelligence: monitor competitor ad spend via Meta Ad Library, Google Ads Transparency
- [ ] Patient volume proxies: Google Trends for facility-specific search terms, review volume changes

---

## Implementation Priority (for Tony)

| Priority | Item                                      | Why                                             | Effort    |
| -------- | ----------------------------------------- | ----------------------------------------------- | --------- |
| P0       | Coverage dashboard + status page          | Answers "will it continue to work?" immediately | 1-2 days  |
| P0       | State agent health monitoring             | Proactive reliability                           | 2-3 days  |
| P1       | Bank statement pattern analyzer           | Tony's primary interest from the call           | 1-2 weeks |
| P1       | Funder identification from UCC filings    | Unique competitive advantage                    | 1 week    |
| P1       | UCC termination alerts ("fresh capacity") | Highest-conversion trigger in MCA               | 3-5 days  |
| P2       | Pre-call briefing auto-gen                | Sales team immediate productivity gain          | 1 week    |
| P2       | Business health signal enrichment         | Scoring accuracy improvement                    | 2-3 weeks |
| P3       | Predictive scoring v2                     | Requires outcome data from Tony                 | 3-4 weeks |
| P3       | Healthcare vertical adaptation            | Flyland.com expansion                           | 2-3 weeks |

---

## Technical Notes

- Current stack: TypeScript, Express, PostgreSQL (RDS), Redis (ElastiCache), BullMQ workers, React 19, Vercel, Terraform + AWS
- Existing integrations: Plaid, Twilio, SendGrid, Stripe, ACH
- 2,055 tests, 100% coverage — maintain this discipline
- Agent orchestrator pattern in `server/queue/workers/` — new data source agents follow the same pattern
- Public records scraping must respect robots.txt and rate limits — we're building a sustainable data business, not a one-time scrape
