-- 011_competitive_intelligence.sql
-- Competitive intelligence: amendments, velocity, events, market positions

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

-- Competitor market position snapshots
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
