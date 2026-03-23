# Open Source Landscape: Contribution & Integration Targets

**Date:** 2026-03-23
**Project:** public-record-data-scrapper (UCC-MCA Intelligence Platform)
**Scope:** Repos to contribute to, integrate with, or study for competitive advantage

---

## Current Stack Reference

Before evaluating opportunities, note what the project already depends on:

- **Scraping:** Puppeteer 24.x
- **Queue:** BullMQ 5.x + ioredis 5.x
- **Backend:** Express 5.x + Zod 4.x
- **Database:** PostgreSQL (pg 8.x)
- **Frontend:** React 19 + Vite + Tailwind v4 + Radix UI
- **Validation:** Zod, DOMPurify
- **Testing:** Vitest, Playwright (E2E)

---

## Tier 1 -- Direct Competitors or Adjacent Tools

These are projects operating in the same problem space (UCC filings, public records extraction, MCA/alternative lending). Contributing here builds domain credibility and signals expertise.

### 1. tuna-danny/merchant-cash-advance-registry

- **Repo:** https://github.com/tuna-danny/merchant-cash-advance-registry
- **Stars:** 0 | **Last updated:** 2026-02-21
- **Relevance:** Directly adjacent -- an MCA registry concept. Near-zero community, early stage.
- **Contribution opportunity:** This is essentially greenfield. Could contribute data models, UCC filing integration logic, or scoring algorithms. Opening issues with architectural proposals would position us as domain experts.
- **Integration opportunity:** Study their data model choices for registry patterns.
- **Strategic value:** HIGH. Being the primary contributor to a public MCA registry project gives first-mover credibility in an underserved OSS niche.

### 2. tdiorio2323/mca-crm

- **Repo:** https://github.com/tdiorio2323/mca-crm
- **Stars:** 0 | **Last updated:** 2025-11-07
- **Description:** MCA CRM built with Next.js, TypeScript, and Supabase.
- **Relevance:** Downstream consumer of the kind of data our platform produces. Represents the CRM layer that MCA brokers use after lead qualification.
- **Contribution opportunity:** Contribute UCC data integration modules, lead scoring algorithms, or data enrichment pipelines. Could propose a connector/API specification for UCC data ingestion.
- **Integration opportunity:** Study their CRM data model to ensure our export formats are compatible.
- **Strategic value:** MEDIUM. Shows cross-project thinking. CRM is where MCA leads go after our platform qualifies them.

### 3. jaicedev/ai-call-trainer

- **Repo:** https://github.com/jaicedev/ai-call-trainer
- **Stars:** 0 | **Last updated:** 2026-02-04
- **Description:** Gemini Live API-powered AI call trainer for MCA brokers.
- **Relevance:** Adjacent tooling -- MCA broker training. Our platform feeds leads to the sales process this tool trains for.
- **Contribution opportunity:** Could contribute call script templates informed by UCC filing data (e.g., "This business has 3 active UCC filings suggesting..."). Provide sample lead data structures.
- **Integration opportunity:** Potential partner for a full MCA sales pipeline demo.
- **Strategic value:** LOW-MEDIUM. Niche, but demonstrates ecosystem thinking.

### 4. crodriguezmer/parafin-analysis

- **Repo:** https://github.com/crodriguezmer/parafin-analysis
- **Stars:** 0 | **Last updated:** 2026-03-13
- **Description:** Parafin MCA exploratory analysis.
- **Relevance:** Data analysis on MCA economics. Understanding how MCA repayment and risk models work informs our scoring algorithms.
- **Contribution opportunity:** Contribute analysis notebooks on UCC filing patterns correlated with MCA performance. Could add UCC-derived features to their analysis.
- **Integration opportunity:** Study their financial models for ML scoring feature ideas.
- **Strategic value:** MEDIUM. Shows domain depth in the analytics layer.

### 5. JatinFulra/MCA_Platform

- **Repo:** https://github.com/JatinFulra/MCA_Platform
- **Stars:** 0 | **Last updated:** 2026-01-04
- **Description:** Merchant Cash Advance platform.
- **Relevance:** Direct MCA platform. Study for feature parity analysis.
- **Contribution opportunity:** If it has a public records or UCC module, contributing improvements would be high-value. Otherwise, propose one.
- **Integration opportunity:** Evaluate their data flow for competitive analysis.
- **Strategic value:** MEDIUM. Direct competitor study.

### 6. amirbnprogramming/Alabama-Secretary-of-State-Scraper

- **Repo:** https://github.com/amirbnprogramming/Alabama-Secretary-of-State-Scraper
- **Stars:** 0 | **Last updated:** 2025-02-05
- **Description:** Python scraper for Alabama Secretary of State business entities.
- **Relevance:** Directly relevant -- scrapes the same type of government portals our state collectors target.
- **Contribution opportunity:** Contribute anti-detection patterns, rate limiting strategies, data normalization utilities. Could port patterns from our StateCollectorFactory.
- **Integration opportunity:** Study their approach to Alabama's portal for expanding our state coverage.
- **Strategic value:** MEDIUM. Demonstrates public records scraping expertise.

### 7. happykrim/north-carolina-court-records-scraper

- **Repo:** https://github.com/happykrim/north-carolina-court-records-scraper
- **Stars:** 0 | **Last updated:** 2026-03-09
- **Description:** Automated court records extraction from NC Judicial Branch portal.
- **Relevance:** Adjacent public records scraping with responsible scraping practices documented.
- **Contribution opportunity:** Share rate limiting, circuit breaker, and session management patterns. Contribute a standardized output format for public records data.
- **Integration opportunity:** Their "responsible scraping" patterns may inform our compliance approach.
- **Strategic value:** LOW-MEDIUM. Court records are adjacent but not core.

### 8. cseanstephens-jpg/public-records-scraper

- **Repo:** https://github.com/cseanstephens-jpg/public-records-scraper
- **Stars:** 0 | **Last updated:** 2026-02-26
- **Description:** Public records scraper for binders and discovery assembly.
- **Relevance:** General public records scraping tool with discovery/assembly concepts.
- **Contribution opportunity:** Propose and contribute a shared public records data schema. Add web portal scraping patterns.
- **Integration opportunity:** Study their discovery assembly workflow.
- **Strategic value:** LOW. Different use case but shared infrastructure problems.

---

## Tier 2 -- Infrastructure We Use or Could Use

Libraries and frameworks that power our stack. Contributing here improves the tools we depend on and builds engineering credibility.

### 9. apify/crawlee

- **Repo:** https://github.com/apify/crawlee
- **Stars:** 22,475 | **Last updated:** 2026-03-23 (active daily)
- **Description:** Web scraping and browser automation library for Node.js. Supports Puppeteer, Playwright, Cheerio. TypeScript-first.
- **Relevance:** CRITICAL. The most mature TypeScript web scraping framework. Directly addresses our scraper infrastructure needs with built-in request queuing, proxy rotation, session management, and error handling.
- **Contribution opportunity:**
  - Contribute government portal scraping patterns/examples (many Crawlee examples are e-commerce focused).
  - Add UCC filing portal integration examples to their docs/examples.
  - Report and fix issues related to anti-bot detection on government sites.
  - Contribute CAPTCHA handling patterns for state government portals.
- **Integration opportunity:** Could replace or augment our custom Puppeteer scrapers with Crawlee's `PuppeteerCrawler`. Would gain built-in request queuing, automatic retries, session rotation, and proxy management for free. Reduces custom code in `StateCollectorFactory`.
- **Strategic value:** VERY HIGH. 22K+ stars. PRs here are visible to the entire scraping community. Government portal patterns are underrepresented in their examples.

### 10. berstend/puppeteer-extra

- **Repo:** https://github.com/berstend/puppeteer-extra
- **Stars:** 7,280 | **Last updated:** 2026-03-23
- **Description:** Plugin framework for Puppeteer. Includes stealth plugin for anti-detection.
- **Relevance:** HIGH. The stealth plugin is essential for scraping government portals that employ bot detection. We already use Puppeteer; puppeteer-extra is the standard way to add stealth capabilities.
- **Contribution opportunity:**
  - Report government-specific detection issues.
  - Contribute fingerprint evasion patterns specific to .gov and state portal frameworks.
  - Improve TypeScript type definitions (historically weak in the plugin ecosystem).
- **Integration opportunity:** Direct integration via `puppeteer-extra` + `puppeteer-extra-plugin-stealth` for all state collector instances. Reduces detection failures.
- **Strategic value:** HIGH. 7K+ stars. Highly visible contributions.

### 11. apify/fingerprint-suite

- **Repo:** https://github.com/apify/fingerprint-suite
- **Stars:** 2,035 | **Last updated:** 2026-03-23
- **Description:** Browser fingerprinting tools for anonymizing scrapers. By Apify.
- **Relevance:** Directly applicable to our government portal scraping where consistent fingerprinting causes blocks.
- **Contribution opportunity:** Report and contribute fixes for fingerprint generation edge cases. Add government portal-specific fingerprint profiles.
- **Integration opportunity:** Use alongside puppeteer-extra for comprehensive anti-detection.
- **Strategic value:** MEDIUM-HIGH. Apify ecosystem visibility.

### 12. thomasdondorf/puppeteer-cluster

- **Repo:** https://github.com/thomasdondorf/puppeteer-cluster
- **Stars:** 3,512 | **Last updated:** 2026-03-18
- **Description:** Run a cluster of Puppeteer instances in parallel.
- **Relevance:** HIGH. Our state collectors run sequential scraping. Puppeteer-cluster would enable parallel scraping across multiple states with managed concurrency, error handling, and retry logic.
- **Contribution opportunity:**
  - Contribute rate-limiting-aware clustering patterns (government portals need respectful request rates).
  - Add examples for heterogeneous task queues (different scraper logic per cluster task).
  - Fix open issues related to memory management in long-running scrape sessions.
- **Integration opportunity:** Replace our manual browser management with cluster-managed instances. Integrate with BullMQ for job-to-cluster task routing.
- **Strategic value:** HIGH. 3.5K stars, actively maintained.

### 13. taskforcesh/bullmq

- **Repo:** https://github.com/taskforcesh/bullmq
- **Stars:** 8,602 | **Last updated:** 2026-03-23 (daily activity)
- **Description:** Message queue and batch processing for Node.js based on Redis.
- **Relevance:** CRITICAL. Already in our dependency tree (bullmq ^5.67.1). We use it for ingestion, enrichment, and health scoring workers.
- **Contribution opportunity:**
  - Contribute documentation on complex queue patterns (multi-stage pipelines, dependent jobs, circuit breaker integration).
  - Report and fix edge cases in scheduler behavior.
  - Add TypeScript examples for common patterns we have implemented (rate-limited workers, dead letter handling).
  - Our queue patterns (ingestion -> enrichment -> scoring pipeline) could become official examples.
- **Integration opportunity:** Already integrated. Stay current with new features (flow producers, bulk operations, sandboxed processors).
- **Strategic value:** VERY HIGH. 8.6K stars. Our queue patterns are production-proven and would be valuable contributions.

### 14. felixmosh/bull-board

- **Repo:** https://github.com/felixmosh/bull-board
- **Stars:** 3,251 | **Last updated:** 2026-03-23
- **Description:** Queue background jobs inspector/dashboard for Bull and BullMQ.
- **Relevance:** HIGH. Essential monitoring tool for our BullMQ queues. Provides visual inspection of job status, failed jobs, and queue health.
- **Contribution opportunity:**
  - Contribute custom metric visualizations relevant to data pipeline monitoring.
  - Add filtering/search for large job histories.
  - Improve the TypeScript types for the Express adapter.
- **Integration opportunity:** Direct integration for queue monitoring dashboard. Could embed in our admin UI.
- **Strategic value:** MEDIUM-HIGH. Widely used, practical contributions valued.

### 15. nodeshift/opossum

- **Repo:** https://github.com/nodeshift/opossum
- **Stars:** 1,622 | **Last updated:** 2026-03-23
- **Description:** Node.js circuit breaker -- fails fast.
- **Relevance:** HIGH. Our platform needs circuit breakers for external API calls (state portals, enrichment services, SendGrid, Twilio). Opossum is the de facto Node.js circuit breaker.
- **Contribution opportunity:**
  - Contribute BullMQ integration examples (wrapping queue processors with circuit breakers).
  - Add patterns for cascading circuit breakers in multi-service architectures.
  - Improve TypeScript generic types.
  - Contribute Prometheus/metrics export patterns.
- **Integration opportunity:** Wrap all external service calls (state portal scrapers, enrichment APIs, SendGrid, Twilio) in opossum circuit breakers. Replace any ad-hoc retry logic.
- **Strategic value:** HIGH. Red Hat/Nodeshift project. Enterprise credibility.

### 16. connor4312/cockatiel

- **Repo:** https://github.com/connor4312/cockatiel
- **Stars:** 1,763 | **Last updated:** 2026-03-17
- **Description:** Resilience and fault-handling library. Supports backoffs, retries, circuit breakers, timeouts, bulkhead isolation, and fallbacks.
- **Relevance:** HIGH. Alternative to opossum with a broader feature set (bulkhead isolation, composable policies). TypeScript-first design.
- **Contribution opportunity:**
  - Contribute integration examples with queue systems (BullMQ).
  - Add patterns for scraping-specific resilience (adaptive rate limiting, exponential backoff with jitter for government portals).
  - Improve documentation for composing multiple policies.
- **Integration opportunity:** Could use instead of or alongside opossum. Bulkhead isolation pattern is particularly useful for isolating failures across different state scrapers.
- **Strategic value:** HIGH. 1.7K stars, TypeScript-native. Contributions demonstrate resilience engineering expertise.

### 17. animir/node-rate-limiter-flexible

- **Repo:** https://github.com/animir/node-rate-limiter-flexible
- **Stars:** 3,505 | **Last updated:** 2026-03-23
- **Description:** Atomic and non-atomic counters and rate limiting tools. Limit resource access at any scale. Supports Redis, MongoDB, and in-memory backends.
- **Relevance:** HIGH. Our `RateLimiter.ts` is custom-built. This library provides production-hardened rate limiting with Redis backend (we already use Redis for BullMQ).
- **Contribution opportunity:**
  - Contribute patterns for per-domain rate limiting (different rates for different state portals).
  - Add examples for distributed rate limiting across worker processes.
  - Improve TypeScript types and add Express middleware examples.
- **Integration opportunity:** Replace custom `RateLimiter.ts` with this battle-tested library. Use Redis backend for distributed rate limiting across worker processes.
- **Strategic value:** MEDIUM-HIGH. 3.5K stars. Practical contributions.

### 18. cheeriojs/cheerio

- **Repo:** https://github.com/cheeriojs/cheerio
- **Stars:** 30,227 | **Last updated:** 2026-03-23
- **Description:** Fast, flexible, and elegant library for parsing and manipulating HTML and XML.
- **Relevance:** MEDIUM-HIGH. For state portals that return HTML (vs. JS-rendered content), Cheerio is dramatically faster than full Puppeteer rendering. Could reduce resource usage for simple HTML parsing tasks.
- **Contribution opportunity:**
  - Contribute government HTML parsing examples.
  - Report and fix edge cases in table parsing (UCC filing tables have non-standard HTML).
  - Improve TypeScript definitions.
- **Integration opportunity:** Use for initial HTML parsing before falling back to Puppeteer for JS-rendered portals. Reduces browser instance count.
- **Strategic value:** MEDIUM. 30K stars, but very mature -- contributions need to be substantive.

### 19. sindresorhus/p-queue

- **Repo:** https://github.com/sindresorhus/p-queue
- **Stars:** 4,152 | **Last updated:** 2026-03-23
- **Description:** Promise queue with concurrency control.
- **Relevance:** MEDIUM-HIGH. Useful for managing concurrent scraping tasks within a single worker process.
- **Contribution opportunity:** Contribute priority queue patterns for heterogeneous tasks. Add rate-limiting integration examples.
- **Integration opportunity:** Use for fine-grained concurrency control within BullMQ workers. Complement BullMQ's job-level concurrency with p-queue's promise-level concurrency.
- **Strategic value:** MEDIUM. 4K stars. Sindresorhus ecosystem visibility.

### 20. sindresorhus/p-retry

- **Repo:** https://github.com/sindresorhus/p-retry
- **Stars:** 1,000 | **Last updated:** 2026-03-23
- **Description:** Retry a promise-returning or async function.
- **Relevance:** MEDIUM. Useful for wrapping unreliable external API calls with structured retry logic.
- **Contribution opportunity:** Contribute domain-specific retry strategies (e.g., different backoff for rate-limited vs. server-error responses).
- **Integration opportunity:** Use for all external API calls. Pairs well with circuit breakers.
- **Strategic value:** LOW-MEDIUM. Well-maintained but small scope.

### 21. sindresorhus/p-throttle

- **Repo:** https://github.com/sindresorhus/p-throttle
- **Stars:** 515 | **Last updated:** 2026-03-13
- **Description:** Throttle promise-returning and async functions.
- **Relevance:** MEDIUM. Directly applicable to rate-limiting API calls per government portal requirements.
- **Contribution opportunity:** Add patterns for adaptive throttling (adjust rate based on response codes).
- **Integration opportunity:** Use for per-portal rate throttling.
- **Strategic value:** LOW. Small but focused library.

### 22. redis/ioredis

- **Repo:** https://github.com/redis/ioredis
- **Stars:** 15,243 | **Last updated:** 2026-03-22
- **Description:** Robust, performance-focused Redis client for Node.js.
- **Relevance:** CRITICAL. Already in our dependency tree (ioredis ^5.9.2). Powers our BullMQ queues.
- **Contribution opportunity:**
  - Contribute patterns for connection management in worker processes.
  - Report and fix issues encountered in production queue operations.
  - Add documentation for sentinel/cluster configurations.
- **Integration opportunity:** Already integrated. Ensure we follow best practices for connection pooling and error handling.
- **Strategic value:** MEDIUM. 15K stars, but Redis-official project with high contribution bar.

---

## Tier 2B -- NLP/Entity Matching Infrastructure

### 23. krisk/Fuse

- **Repo:** https://github.com/krisk/Fuse
- **Stars:** 20,044 | **Last updated:** 2026-03-23
- **Description:** Lightweight fuzzy-search in JavaScript.
- **Relevance:** HIGH for entity matching. UCC filings use inconsistent business name formats (e.g., "ACME LLC" vs "Acme, LLC" vs "ACME L.L.C."). Fuse.js enables fuzzy matching for deduplication and entity resolution.
- **Contribution opportunity:**
  - Contribute business name matching examples/presets (common suffixes, abbreviation handling).
  - Add scoring threshold recommendation documentation for entity matching use cases.
  - Report and fix edge cases with special characters common in business names (ampersands, periods, commas).
- **Integration opportunity:** Use for client-side prospect search and for server-side entity deduplication in the enrichment pipeline.
- **Strategic value:** MEDIUM. 20K stars. Contributions in business entity matching are a specific, valued niche.

### 24. nol13/fuzzball.js

- **Repo:** https://github.com/nol13/fuzzball.js
- **Stars:** 637 | **Last updated:** 2026-03-22
- **Description:** Easy to use and powerful fuzzy string matching, port of fuzzywuzzy (Python).
- **Relevance:** HIGH for entity matching. Provides token_sort_ratio, token_set_ratio, and partial_ratio -- algorithms specifically useful for business name matching where word order varies.
- **Contribution opportunity:**
  - Contribute business name normalization utilities (strip suffixes like LLC, Inc, Corp before matching).
  - Add batch matching optimization for comparing against large candidate lists.
  - Improve TypeScript type definitions.
- **Integration opportunity:** Use token_set_ratio for matching UCC debtor names against enrichment sources. More suitable than Fuse.js for exact similarity scoring.
- **Strategic value:** MEDIUM. Smaller community means contributions are more impactful.

### 25. dedupeio/dedupe

- **Repo:** https://github.com/dedupeio/dedupe
- **Stars:** 4,448 | **Last updated:** 2026-03-20
- **Description:** Python library for accurate and scalable fuzzy matching, record deduplication, and entity resolution.
- **Relevance:** HIGH. The gold standard for entity resolution in the open source world. Uses active learning for training matching models.
- **Contribution opportunity:**
  - Contribute UCC filing deduplication examples (business names, addresses, filing numbers).
  - Add examples for financial services entity matching.
  - Improve documentation for integration with data pipelines.
- **Integration opportunity:** Could use as a Python microservice for batch entity resolution. Call from our Node.js enrichment pipeline via API.
- **Strategic value:** HIGH. 4.4K stars. Entity resolution is a valued skill. Contributions here signal data engineering maturity.

### 26. moj-analytical-services/splink

- **Repo:** https://github.com/moj-analytical-services/splink
- **Stars:** 2,015 | **Last updated:** 2026-03-23
- **Description:** Fast, accurate, and scalable probabilistic data linkage with support for multiple SQL backends.
- **Relevance:** HIGH. Probabilistic record linkage is exactly what is needed for matching UCC filing records across state databases and enrichment sources.
- **Contribution opportunity:**
  - Contribute comparison functions tuned for US business names and addresses.
  - Add examples for financial/commercial data linkage.
  - Contribute blocking rules optimized for UCC filing data (SOS numbers, EIN patterns).
- **Integration opportunity:** Use for batch matching of UCC records across states. Supports PostgreSQL backend (which we already use).
- **Strategic value:** HIGH. UK Ministry of Justice project. Government/institutional credibility.

### 27. psolin/cleanco

- **Repo:** https://github.com/psolin/cleanco
- **Stars:** 352 | **Last updated:** 2026-03-23
- **Description:** Company Name Processor written in Python. Strips business suffixes (LLC, Inc, GmbH, etc.) and classifies company types.
- **Relevance:** HIGH for preprocessing. Before fuzzy matching, business names need normalization -- strip "LLC", "Inc.", "Corporation", etc. Cleanco handles international business suffixes.
- **Contribution opportunity:**
  - Add US-specific suffixes that may be missing (state-specific corporation types).
  - Contribute a TypeScript/JavaScript port (none exists currently).
  - Add abbreviation expansion (e.g., "Intl" -> "International").
- **Integration opportunity:** Use (or port) for preprocessing business names before deduplication and matching.
- **Strategic value:** MEDIUM. 352 stars. A JavaScript port would be highly valuable and fill a gap in the npm ecosystem.

---

## Tier 2C -- Financial Data & Filing Infrastructure

### 28. tooksoi/ScraXBRL

- **Repo:** https://github.com/tooksoi/ScraXBRL
- **Stars:** 306 | **Last updated:** 2026-02-24
- **Description:** SEC Edgar scraper and XBRL parser/renderer.
- **Relevance:** MEDIUM. SEC filings contain financial data about companies that also appear in UCC filings. Cross-referencing UCC debtors with SEC filings provides enrichment data (revenue, debt levels, industry classification).
- **Contribution opportunity:** Contribute entity matching between UCC debtor names and SEC CIK numbers. Add financial health scoring from XBRL data.
- **Integration opportunity:** Use as enrichment source -- cross-reference UCC debtors with SEC filings to add financial data.
- **Strategic value:** MEDIUM. Demonstrates cross-database correlation capability.

### 29. Unstructured-IO/pipeline-sec-filings

- **Repo:** https://github.com/Unstructured-IO/pipeline-sec-filings
- **Stars:** 149 | **Last updated:** 2026-03-12
- **Description:** Preprocessing pipeline and API for text extraction from SEC documents.
- **Relevance:** MEDIUM. Document extraction pipeline patterns applicable to UCC filing document processing.
- **Contribution opportunity:** Contribute UCC filing document parsing (many states provide UCC filings as downloadable PDFs).
- **Integration opportunity:** Study their pipeline architecture for document processing patterns.
- **Strategic value:** MEDIUM. Unstructured.IO has good visibility in the data extraction space.

### 30. opensanctions/opensanctions

- **Repo:** https://github.com/opensanctions/opensanctions
- **Stars:** 695 | **Last updated:** 2026-03-23
- **Description:** Open database of international sanctions data, persons of interest, and politically exposed persons.
- **Relevance:** MEDIUM-HIGH for compliance. MCA lenders must screen prospects against sanctions lists. Cross-referencing UCC debtors against sanctions data is a compliance requirement.
- **Contribution opportunity:**
  - Contribute US business entity matching patterns against sanctions lists.
  - Add integration examples for financial services compliance workflows.
- **Integration opportunity:** Use as a compliance screening data source in the enrichment pipeline. Screen UCC debtors and secured parties.
- **Strategic value:** HIGH. Compliance/sanctions screening is a high-value capability. Demonstrates regulatory awareness.

### 31. opensanctions/yente

- **Repo:** https://github.com/opensanctions/yente
- **Stars:** 126 | **Last updated:** 2026-03-23
- **Description:** API for OpenSanctions with entity search and bulk matching. Supports Reconciliation API spec.
- **Relevance:** MEDIUM-HIGH. Provides the API layer for programmatic sanctions screening.
- **Contribution opportunity:** Contribute bulk matching optimizations for high-volume UCC filing processing. Add financial services-specific matching examples.
- **Integration opportunity:** Deploy as a sidecar service for compliance screening in our enrichment pipeline.
- **Strategic value:** MEDIUM-HIGH. Practical compliance tooling.

---

## Tier 2D -- Outreach & Communication Infrastructure

### 32. catamphetamine/libphonenumber-js

- **Repo:** https://github.com/catamphetamine/libphonenumber-js
- **Stars:** 2,967 | **Last updated:** 2026-03-20
- **Description:** Simpler and smaller rewrite of Google's libphonenumber in JavaScript.
- **Relevance:** MEDIUM-HIGH. Phone number validation and formatting for Twilio outreach. Essential for TCPA compliance (validating phone numbers before dialing).
- **Contribution opportunity:** Contribute business phone number validation patterns (toll-free detection, VOIP detection hints). Improve TypeScript types.
- **Integration opportunity:** Use for phone number validation in the lead enrichment pipeline before passing to Twilio for outreach.
- **Strategic value:** MEDIUM. 3K stars. Practical utility.

### 33. tobsn/blacklist-alliance-client

- **Repo:** https://github.com/tobsn/blacklist-alliance-client
- **Stars:** 0 | **Last updated:** 2025-12-16
- **Description:** Unofficial Node.js client for the Blacklist Alliance API -- phone and email blacklist lookup for TCPA compliance.
- **Relevance:** HIGH for compliance. TCPA compliance requires checking phone numbers against Do Not Call lists and litigator databases. Blacklist Alliance is a major provider in this space.
- **Contribution opportunity:**
  - Contribute TypeScript types and modernize the codebase.
  - Add batch lookup support.
  - Improve error handling and retry logic.
  - Add integration examples with BullMQ for batch processing.
- **Integration opportunity:** Direct integration for TCPA compliance screening in the outreach pipeline.
- **Strategic value:** HIGH. TCPA compliance is a critical legal requirement for MCA outreach. An improved client library serves the entire industry.

### 34. happyDomain/happydeliver

- **Repo:** https://github.com/happyDomain/happydeliver
- **Stars:** 203 | **Last updated:** 2026-03-23
- **Description:** Open-source, self-hosted email deliverability testing platform.
- **Relevance:** MEDIUM. Our platform includes email outreach via SendGrid. Testing deliverability before sending is critical for maintaining sender reputation.
- **Contribution opportunity:** Contribute SendGrid-specific deliverability testing patterns. Add integration with BullMQ for scheduled deliverability checks.
- **Integration opportunity:** Deploy for monitoring our SendGrid deliverability.
- **Strategic value:** MEDIUM. Practical ops tooling.

---

## Tier 3 -- Tangential but Strategically Valuable

Projects that build network, credibility, and cross-domain expertise.

### 35. wizenheimer/subsignal

- **Repo:** https://github.com/wizenheimer/subsignal
- **Stars:** 19 | **Last updated:** 2026-03-19
- **Description:** Open source deal flow monitoring / competitive intelligence infrastructure.
- **Relevance:** MEDIUM. Our CompetitorAgent already does competitive analysis. Subsignal approaches it from a VC/founder perspective -- monitoring competitor signals.
- **Contribution opportunity:** Contribute scraping patterns for public business data. Share patterns for structured data extraction from public filings.
- **Integration opportunity:** Study their signal detection patterns for our CompetitorAgent.
- **Strategic value:** MEDIUM. Competitive intelligence is a growing space.

### 36. brightdata/competitive-intelligence

- **Repo:** https://github.com/brightdata/competitive-intelligence
- **Stars:** 4 | **Last updated:** 2026-03-18
- **Description:** Competitive intelligence by Bright Data (major web data platform).
- **Relevance:** LOW-MEDIUM. Bright Data is a well-known name in web scraping infrastructure.
- **Contribution opportunity:** Contributing here gives visibility in the Bright Data ecosystem.
- **Integration opportunity:** Study their competitive intelligence patterns.
- **Strategic value:** LOW-MEDIUM. Bright Data brand association.

### 37. rly0nheart/occli

- **Repo:** https://github.com/rly0nheart/occli
- **Stars:** 33 | **Last updated:** 2026-01-10
- **Description:** CLI tool for querying OpenCorporates database.
- **Relevance:** MEDIUM. OpenCorporates is a major source of business entity data globally. Querying it for business verification enriches UCC filing data.
- **Contribution opportunity:** Contribute US-specific search patterns. Add batch query support. Improve output formatting for data pipeline integration.
- **Integration opportunity:** Use OpenCorporates as an enrichment data source for business verification.
- **Strategic value:** MEDIUM. OpenCorporates ecosystem.

### 38. pjryan126/opyncorporates

- **Repo:** https://github.com/pjryan126/opyncorporates
- **Stars:** 11 | **Last updated:** 2025-09-12
- **Description:** Python package for accessing the OpenCorporates API.
- **Relevance:** MEDIUM. Python client for OpenCorporates -- could study for API patterns even if we build a TypeScript client.
- **Contribution opportunity:** Contribute a TypeScript/JavaScript port. This is a gap in the ecosystem.
- **Integration opportunity:** Study API patterns for building our own OpenCorporates integration.
- **Strategic value:** MEDIUM. Creating a TypeScript OpenCorporates client would fill an npm gap.

### 39. BookletAI/lead-scoring-demo

- **Repo:** https://github.com/BookletAI/lead-scoring-demo
- **Stars:** 23 | **Last updated:** 2025-09-09
- **Description:** End-to-end lead scoring ML example with Jupyter, SageMaker, MLflow, and Booklet.ai.
- **Relevance:** MEDIUM. Our `mlScoring.ts` implements lead scoring. This repo provides ML pipeline patterns.
- **Contribution opportunity:** Contribute UCC filing-derived features for lead scoring models. Add business financing signal features.
- **Integration opportunity:** Study their feature engineering for ML scoring improvements.
- **Strategic value:** LOW-MEDIUM. ML lead scoring is niche but relevant.

### 40. KizitoNaanma/bullmq-patterns

- **Repo:** https://github.com/KizitoNaanma/bullmq-patterns
- **Stars:** 1 | **Last updated:** 2025-08-21
- **Description:** BullMQ queue patterns with NestJS -- retries, backoff, delayed jobs, rate limiting, dead-letter queues, multi-process workers, and Bull Board monitoring.
- **Relevance:** HIGH as a reference. Documents exactly the patterns we implement: retries, backoff, DLQ, rate limiting, multi-process workers.
- **Contribution opportunity:** Contribute additional patterns: circuit breaker integration, priority queues, flow producers, job dependencies, metrics/monitoring. Our production patterns are more mature than what exists here.
- **Integration opportunity:** Study for pattern validation.
- **Strategic value:** MEDIUM. Contributing production-proven patterns to a patterns repository is high-signal.

### 41. muneebhashone/typescript-backend-toolkit

- **Repo:** https://github.com/muneebhashone/typescript-backend-toolkit
- **Stars:** 321 | **Last updated:** 2026-03-20
- **Description:** Production-ready Express.js/TypeScript framework with auto-generated OpenAPI, CLI, BullMQ, React Email, Socket.io, Django-style admin, Zod validation.
- **Relevance:** MEDIUM. Uses the same stack combination (Express + BullMQ + Zod). Could study for architectural patterns.
- **Contribution opportunity:** Contribute queue worker patterns, data pipeline middleware.
- **Integration opportunity:** Study their OpenAPI generation and admin interface patterns.
- **Strategic value:** LOW-MEDIUM. Stack overlap suggests similar audience.

### 42. darky/bull-repl

- **Repo:** https://github.com/darky/bull-repl
- **Stars:** 239 | **Last updated:** 2026-03-12
- **Description:** Bull/BullMQ queue command line REPL.
- **Relevance:** MEDIUM. Debugging tool for our BullMQ queues. Interactive inspection of jobs, retries, failed jobs.
- **Contribution opportunity:** Add BullMQ 5.x features support. Contribute commands for pipeline inspection (multi-queue flow visualization).
- **Integration opportunity:** Use for development and debugging of queue issues.
- **Strategic value:** LOW-MEDIUM. Developer tooling.

### 43. OlivierBinette/Awesome-Entity-Resolution

- **Repo:** https://github.com/OlivierBinette/Awesome-Entity-Resolution
- **Stars:** 113 | **Last updated:** 2026-03-21
- **Description:** List of entity resolution software and resources.
- **Relevance:** MEDIUM. Curated list of all tools for the entity resolution problem space. Reference for evaluating matching approaches.
- **Contribution opportunity:** Add our project as a use case / application. Contribute UCC filing entity matching as a documented use case. Add any tools we discover or build.
- **Integration opportunity:** Reference for finding additional tools and research papers.
- **Strategic value:** MEDIUM. Getting listed here positions us in the entity resolution community.

---

## Summary Matrix

| #   | Repo                                      | Stars  | Tier | Integration | Contribution | Strategic  |
| --- | ----------------------------------------- | ------ | ---- | ----------- | ------------ | ---------- |
| 1   | tuna-danny/merchant-cash-advance-registry | 0      | T1   | LOW         | HIGH         | HIGH       |
| 2   | tdiorio2323/mca-crm                       | 0      | T1   | MEDIUM      | MEDIUM       | MEDIUM     |
| 3   | jaicedev/ai-call-trainer                  | 0      | T1   | LOW         | LOW          | LOW-MED    |
| 4   | crodriguezmer/parafin-analysis            | 0      | T1   | MEDIUM      | MEDIUM       | MEDIUM     |
| 5   | JatinFulra/MCA_Platform                   | 0      | T1   | LOW         | MEDIUM       | MEDIUM     |
| 6   | AL Secretary of State Scraper             | 0      | T1   | MEDIUM      | MEDIUM       | MEDIUM     |
| 7   | NC Court Records Scraper                  | 0      | T1   | LOW         | MEDIUM       | LOW-MED    |
| 8   | public-records-scraper                    | 0      | T1   | LOW         | LOW          | LOW        |
| 9   | apify/crawlee                             | 22,475 | T2   | **HIGH**    | **HIGH**     | **V.HIGH** |
| 10  | berstend/puppeteer-extra                  | 7,280  | T2   | **HIGH**    | HIGH         | HIGH       |
| 11  | apify/fingerprint-suite                   | 2,035  | T2   | MEDIUM      | MEDIUM       | MED-HIGH   |
| 12  | thomasdondorf/puppeteer-cluster           | 3,512  | T2   | **HIGH**    | HIGH         | HIGH       |
| 13  | taskforcesh/bullmq                        | 8,602  | T2   | **CRIT**    | **HIGH**     | **V.HIGH** |
| 14  | felixmosh/bull-board                      | 3,251  | T2   | HIGH        | MEDIUM       | MED-HIGH   |
| 15  | nodeshift/opossum                         | 1,622  | T2   | HIGH        | HIGH         | HIGH       |
| 16  | connor4312/cockatiel                      | 1,763  | T2   | HIGH        | HIGH         | HIGH       |
| 17  | node-rate-limiter-flexible                | 3,505  | T2   | HIGH        | MEDIUM       | MED-HIGH   |
| 18  | cheeriojs/cheerio                         | 30,227 | T2   | MEDIUM      | LOW          | MEDIUM     |
| 19  | sindresorhus/p-queue                      | 4,152  | T2   | MEDIUM      | LOW          | MEDIUM     |
| 20  | sindresorhus/p-retry                      | 1,000  | T2   | MEDIUM      | LOW          | LOW-MED    |
| 21  | sindresorhus/p-throttle                   | 515    | T2   | MEDIUM      | LOW          | LOW        |
| 22  | redis/ioredis                             | 15,243 | T2   | **CRIT**    | LOW          | MEDIUM     |
| 23  | krisk/Fuse                                | 20,044 | T2B  | HIGH        | MEDIUM       | MEDIUM     |
| 24  | nol13/fuzzball.js                         | 637    | T2B  | HIGH        | HIGH         | MEDIUM     |
| 25  | dedupeio/dedupe                           | 4,448  | T2B  | MEDIUM      | HIGH         | HIGH       |
| 26  | moj-analytical-services/splink            | 2,015  | T2B  | HIGH        | HIGH         | HIGH       |
| 27  | psolin/cleanco                            | 352    | T2B  | HIGH        | **HIGH**     | MEDIUM     |
| 28  | tooksoi/ScraXBRL                          | 306    | T2C  | MEDIUM      | MEDIUM       | MEDIUM     |
| 29  | Unstructured-IO/pipeline-sec-filings      | 149    | T2C  | MEDIUM      | MEDIUM       | MEDIUM     |
| 30  | opensanctions/opensanctions               | 695    | T2C  | MED-HIGH    | MEDIUM       | HIGH       |
| 31  | opensanctions/yente                       | 126    | T2C  | MED-HIGH    | MEDIUM       | MED-HIGH   |
| 32  | catamphetamine/libphonenumber-js          | 2,967  | T2D  | MED-HIGH    | LOW          | MEDIUM     |
| 33  | tobsn/blacklist-alliance-client           | 0      | T2D  | HIGH        | **HIGH**     | HIGH       |
| 34  | happyDomain/happydeliver                  | 203    | T2D  | MEDIUM      | LOW          | MEDIUM     |
| 35  | wizenheimer/subsignal                     | 19     | T3   | MEDIUM      | MEDIUM       | MEDIUM     |
| 36  | brightdata/competitive-intelligence       | 4      | T3   | LOW         | LOW          | LOW-MED    |
| 37  | rly0nheart/occli                          | 33     | T3   | MEDIUM      | MEDIUM       | MEDIUM     |
| 38  | pjryan126/opyncorporates                  | 11     | T3   | MEDIUM      | MEDIUM       | MEDIUM     |
| 39  | BookletAI/lead-scoring-demo               | 23     | T3   | LOW         | MEDIUM       | LOW-MED    |
| 40  | KizitoNaanma/bullmq-patterns              | 1      | T3   | LOW         | **HIGH**     | MEDIUM     |
| 41  | typescript-backend-toolkit                | 321    | T3   | LOW         | LOW          | LOW-MED    |
| 42  | darky/bull-repl                           | 239    | T3   | MEDIUM      | MEDIUM       | LOW-MED    |
| 43  | Awesome-Entity-Resolution                 | 113    | T3   | LOW         | LOW          | MEDIUM     |

---

## Recommended Action Plan

### Immediate (next 2 weeks)

1. **apify/crawlee** -- Open a PR contributing a "government portal scraping" example with rate limiting and session management patterns. Evaluate migrating StateCollectorFactory to use Crawlee's PuppeteerCrawler.

2. **taskforcesh/bullmq** -- Contribute a documentation PR showing multi-stage data pipeline patterns (ingestion -> enrichment -> scoring) with circuit breaker integration. Reference our production patterns.

3. **nodeshift/opossum** or **connor4312/cockatiel** -- Evaluate both, pick one, and integrate into all external service calls. Contribute a BullMQ worker integration example.

4. **tobsn/blacklist-alliance-client** -- Fork, modernize to TypeScript with proper types, add batch operations, and contribute back. TCPA compliance is a legal requirement.

### Short-term (next month)

5. **thomasdondorf/puppeteer-cluster** -- Integrate for parallel state scraping. Contribute rate-limiting-aware clustering examples.

6. **psolin/cleanco** -- Create a TypeScript port (`cleanco-js`) for the npm ecosystem. This fills a real gap. Use in our entity matching pipeline.

7. **nol13/fuzzball.js** -- Contribute business name matching presets. Integrate for UCC debtor name deduplication.

8. **animir/node-rate-limiter-flexible** -- Replace custom RateLimiter.ts. Contribute per-domain rate limiting patterns.

### Medium-term (next quarter)

9. **opensanctions/yente** -- Deploy for compliance screening. Contribute financial services matching examples.

10. **felixmosh/bull-board** -- Integrate for queue monitoring. Contribute custom views for data pipeline metrics.

11. **moj-analytical-services/splink** -- Evaluate for batch entity resolution across state databases. Contribute US business matching comparison functions.

12. **tuna-danny/merchant-cash-advance-registry** -- Engage as primary OSS contributor. Position as domain authority.

---

## Gaps Identified

The following areas have **no meaningful open source tooling** -- representing potential for us to create and own:

1. **UCC Filing Parser/Normalizer (TypeScript):** No npm package exists for parsing UCC filing data into a standard format. Our `types.ts` could become this.

2. **State Portal API Abstraction:** No standardized interface for querying across multiple state SOS/UCC portals. Our `StateCollectorFactory` pattern could be extracted.

3. **Company Name Normalization (JavaScript/TypeScript):** `cleanco` exists in Python but has no JavaScript port. This is a clear gap.

4. **MCA/Alternative Lending Data Models:** No shared data model standard for MCA industry data exchange. Could propose an open specification.

5. **TCPA Compliance Toolkit (Node.js):** No comprehensive Node.js library for TCPA compliance (DNC check + litigator check + consent management). Only fragments exist.

6. **Government Portal Anti-Detection Patterns:** While puppeteer-extra and fingerprint-suite exist for general anti-detection, government portal-specific patterns (.gov framework detection, CAPTCHA handling for state sites) are undocumented.

---

## Research Methodology

- **GitHub search:** `gh search repos` and `gh api repos/` for 11 topic areas across ~50 queries
- **npm ecosystem:** Evaluated packages already in our dependency tree for contribution opportunities
- **Stack analysis:** Cross-referenced our `package.json` dependencies against their upstream repos
- **Date:** 2026-03-23
- **Total repos evaluated:** 100+ (43 documented above as most relevant)
