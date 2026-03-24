# Evolution Prompt: Beyond UCC Scraping — Next-Generation MCA Intelligence

**Date:** 2026-03-23
**Context:** Inbound client (Alternative Funding Group, Tony Carbone — Managing Partner) asked two critical questions during a 40-minute discovery call:

1. "Does your system work with all 50 states? Will it continue to work?"
2. UCC scraping is only one signal — what are the next-level methods?

**Goal:** Evolve this platform from a UCC filing aggregator into a comprehensive MCA prospect intelligence system. UCC filings become one input among many. The system should answer: "Which businesses need capital RIGHT NOW, can repay, and aren't being aggressively competed for?"

---

## Phase 1: Reliability Hardening (Answer: "Will it continue to work?")

The current 50-state agent architecture uses fallback strategies (API -> bulk download -> vendor feed -> scrape). Harden this:

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

### 1.3 Client-Facing Deliverable

- [ ] Build a simple status page: "All 50 states green/yellow/red" with last-pull timestamps
- [ ] Weekly email digest: records collected, new filings by state, system health score

---

## Phase 2: Beyond UCC — Next-Level Data Signals

UCC filings tell you "this business has existing financing." That's table stakes. The competitive advantage is combining UCC data with signals that tell you:

- **Timing**: When is a business most likely to need MORE capital?
- **Ability**: Can they actually handle another advance?
- **Competition**: Who else is already chasing this merchant?

### 2.1 Bank Statement Intelligence

The Plaid integration already exists in `server/integrations/plaid/`. Extend it:

- [ ] Build bank statement pattern analyzer:
  - Daily balance trends (declining = may need capital, but also risk signal)
  - Revenue consistency (regular deposits vs. lumpy)
  - Existing MCA payment patterns (daily/weekly fixed debits = active advances)
  - Seasonal patterns (restaurants spike summer, retail spikes Q4)
  - NSF/overdraft frequency (risk signal)
- [ ] Create "stacking detection": identify merchants with multiple concurrent advances by spotting multiple fixed daily debits to different entities
- [ ] Build "capacity calculator": given current revenue and existing obligations, estimate max new advance amount
- [ ] **Public records expansion:**
  - Court records scraping for judgments, defaults, confessions of judgment (COJ)
  - State UCC-3 amendment tracking (terminations = freed-up capacity, amendments = restructuring)
  - Business entity status changes via SOS (new formations = growth, dissolutions = risk)
  - Tax lien filings (IRS, state) from county recorder offices

### 2.2 Business Health Signals (Enrichment Layer v2)

Current enrichment pulls from SEC EDGAR, OSHA, USPTO, Census, SAM.gov. Add:

- [ ] **Google Business Profile signals**: review velocity, rating trends, response rate, photo freshness
- [ ] **Hiring signals**: Indeed/LinkedIn job postings (hiring = growth = may need capital)
- [ ] **Technology stack changes**: BuiltWith/Wappalyzer (upgrading tech = investing in business)
- [ ] **Web traffic trends**: SimilarWeb API or Semrush (traffic growth/decline)
- [ ] **Social media activity**: posting frequency, engagement trends
- [ ] **Domain age + SSL cert monitoring**: new domains = new business, expired SSL = neglect
- [ ] **Yelp/TripAdvisor for hospitality vertical**: review velocity as revenue proxy
- [ ] **Equipment lease filings**: UCC-1 filings specifically for equipment
- [ ] **SBA loan data**: businesses that received SBA loans may need bridge financing

### 2.3 Competitive Intelligence Layer

This is what no current MCA lead provider offers:

- [ ] **Funder identification from UCC filings**: map secured party names to known MCA funders/brokers
  - Build a funder database: company name -> known DBA names -> filing patterns
  - Detect when a merchant has filings from aggressive stackers vs. conservative funders
- [ ] **Filing velocity tracking**: a merchant getting a new UCC filing every 60 days is a serial stacker
- [ ] **Competitive heat map**: which funders are most active in which states/industries?
- [ ] **"Fresh filing" alerts**: real-time notification when a UCC filing is terminated (= merchant paid off, has fresh capacity)

### 2.4 Predictive Scoring Engine (ML v2)

- [ ] Train on outcome data: which leads converted? Which defaulted? (Requires client historical data)
- [ ] Multi-signal fusion: UCC age + bank patterns + health signals + competitive position -> composite "readiness score"
- [ ] Time-decay weighting: recent signals > stale data
- [ ] Segment-specific models: restaurants behave differently from trucking companies
- [ ] "Optimal timing" predictor: when in the advance lifecycle is a merchant most likely to re-up?

---

## Phase 3: Sales Team Automation

### 3.1 Outreach Automation

- [ ] Smart dialer queue: prioritize calls by readiness score, time zone, best-contact-time model
- [ ] Pre-call briefing auto-generation: one-page merchant summary (filings, revenue estimate, obligations, talking points)
- [ ] Automated email/SMS sequences triggered by events:
  - New UCC filing = "We noticed you recently secured financing..."
  - UCC termination = "Ready for growth capital?"
  - Business growth signal = "We see [business] is expanding..."
- [ ] CRM integration: push scored leads directly into pipeline tool
- [ ] Compliance auto-check: TCPA consent, DNC list, state-specific disclosures

### 3.2 Healthcare Vertical (Flyland.com)

Same intelligence platform pattern for healthcare:

- [ ] State licensing boards, CMS provider enrollment, NPPES (NPI registry)
- [ ] Rehab facility signals: licensing changes, capacity, ownership transfers
- [ ] Ad campaign intelligence: Meta Ad Library, Google Ads Transparency
- [ ] Patient volume proxies: Google Trends, review volume changes

---

## Implementation Priority

| Priority | Item                                      | Why                                             | Effort    |
| -------- | ----------------------------------------- | ----------------------------------------------- | --------- |
| P0       | Coverage dashboard + status page          | Answers "will it continue to work?" immediately | 1-2 days  |
| P0       | State agent health monitoring             | Proactive reliability                           | 2-3 days  |
| P1       | Bank statement pattern analyzer           | Primary interest from the call                  | 1-2 weeks |
| P1       | Funder identification from UCC filings    | Unique competitive advantage                    | 1 week    |
| P1       | UCC termination alerts ("fresh capacity") | Highest-conversion trigger in MCA               | 3-5 days  |
| P2       | Pre-call briefing auto-gen                | Sales team immediate productivity gain          | 1 week    |
| P2       | Business health signal enrichment         | Scoring accuracy                                | 2-3 weeks |
| P3       | Predictive scoring v2                     | Requires client outcome data                    | 3-4 weeks |
| P3       | Healthcare vertical adaptation            | Flyland.com expansion                           | 2-3 weeks |

---

## Technical Notes

- Stack: TypeScript, Express, PostgreSQL (RDS), Redis (ElastiCache), BullMQ workers, React 19, Vercel, Terraform + AWS
- Existing integrations: Plaid, Twilio, SendGrid, Stripe, ACH
- 2,055 tests, 100% coverage — maintain this discipline
- Agent orchestrator pattern in `server/queue/workers/` — new agents follow the same pattern
- Respect robots.txt and rate limits — sustainable data business, not one-time scrape
