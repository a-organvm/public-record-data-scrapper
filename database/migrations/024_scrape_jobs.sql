-- ============================================================================
-- Migration 024: Async scrape job queue
--
-- Revenue path: the synchronous POST /api/scrape/ucc endpoint works for small
-- queries but can timeout on large state scrapes. Paying customers need a
-- fire-and-forget pattern: submit a job, poll for results. This table is the
-- durable backing store for that async queue.
--
-- Design decisions:
--   - api_key_id nullable: JWT-authenticated requests (internal tooling) can
--     also submit jobs, so the column is optional.
--   - result JSONB: stores the full UCCSearchResponse so the polling endpoint
--     never needs to re-query the collectors.
--   - expires_at: completed/failed jobs are garbage-collected after 7 days.
--     Keeps the table bounded without losing in-flight or recent results.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS scrape_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    -- Key that submitted the job; NULL for JWT-authenticated (internal) requests.
    api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    -- Search parameters captured at enqueue time.
    company_name VARCHAR(200) NOT NULL,
    state CHAR(2) NOT NULL,
    search_limit INTEGER NOT NULL DEFAULT 100,
    -- Lifecycle: queued → processing → completed | failed
    status VARCHAR(20) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    -- Full UCCSearchResponse JSON when completed, NULL otherwise.
    result JSONB,
    -- Human-readable error message when failed, NULL otherwise.
    error TEXT,
    queued_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    -- Jobs that are completed/failed expire after 7 days (garbage-collected).
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '7 days')
);

-- Poll by org to list a customer's jobs.
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_org ON scrape_jobs(org_id);

-- Pick up queued jobs ordered by submission time.
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_status ON scrape_jobs(status, queued_at);

-- Fast lookup for a single org's job (the polling endpoint).
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_org_id ON scrape_jobs(org_id, id);

-- Usage metering: aggregate per key per billing period.
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_api_key ON scrape_jobs(api_key_id)
    WHERE api_key_id IS NOT NULL;

COMMENT ON TABLE scrape_jobs IS 'Async scrape job queue for data-as-a-service. POST /api/scrape/jobs enqueues; GET /api/scrape/jobs/:id polls.';

COMMIT;
