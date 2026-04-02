-- 010_ingestion_telemetry.sql
-- Persistent telemetry for ingestion coverage monitoring

CREATE TABLE IF NOT EXISTS ingestion_telemetry (
  state_code VARCHAR(2) PRIMARY KEY,
  current_status VARCHAR(20) NOT NULL DEFAULT 'idle',
  last_job_id VARCHAR(100),
  last_queued_at TIMESTAMPTZ,
  last_started_at TIMESTAMPTZ,
  last_successful_pull TIMESTAMPTZ,
  last_failed_at TIMESTAMPTZ,
  last_error TEXT,
  last_records_processed INTEGER,
  data_tier VARCHAR(20),
  ucc_provider VARCHAR(50),
  queued_by VARCHAR(20),
  current_strategy VARCHAR(20),
  available_strategies TEXT NOT NULL DEFAULT '[]',
  circuit_state VARCHAR(20) NOT NULL DEFAULT 'closed',
  circuit_opened_at TIMESTAMPTZ,
  circuit_backoff_until TIMESTAMPTZ,
  circuit_trip_count INTEGER NOT NULL DEFAULT 0,
  escalation_count INTEGER NOT NULL DEFAULT 0,
  last_escalated_at TIMESTAMPTZ,
  last_escalation_reason TEXT,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingestion_successes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code VARCHAR(2) NOT NULL REFERENCES ingestion_telemetry(state_code),
  completed_at TIMESTAMPTZ NOT NULL,
  records_processed INTEGER NOT NULL,
  strategy VARCHAR(20),
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingestion_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code VARCHAR(2) NOT NULL REFERENCES ingestion_telemetry(state_code),
  failed_at TIMESTAMPTZ NOT NULL,
  error TEXT NOT NULL,
  strategy VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingestion_fallbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code VARCHAR(2) NOT NULL REFERENCES ingestion_telemetry(state_code),
  escalated_at TIMESTAMPTZ NOT NULL,
  from_strategy VARCHAR(20) NOT NULL,
  to_strategy VARCHAR(20),
  reason TEXT NOT NULL,
  delay_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portal_probe_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code VARCHAR(2) NOT NULL,
  probe_timestamp TIMESTAMPTZ NOT NULL,
  reachable BOOLEAN NOT NULL,
  response_time_ms INTEGER,
  http_status INTEGER,
  schema_valid BOOLEAN NOT NULL DEFAULT true,
  anti_bot_detected BOOLEAN NOT NULL DEFAULT false,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS data_quality_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code VARCHAR(2) NOT NULL,
  job_id VARCHAR(100) NOT NULL,
  records_ingested INTEGER NOT NULL,
  volume_in_range BOOLEAN NOT NULL,
  field_completeness NUMERIC(5,2) NOT NULL,
  deduplication_rate NUMERIC(5,2) NOT NULL,
  filing_date_recency BOOLEAN NOT NULL,
  party_name_present NUMERIC(5,2) NOT NULL,
  passed BOOLEAN NOT NULL,
  warnings TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coverage_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type VARCHAR(50) NOT NULL,
  state_code VARCHAR(2),
  severity VARCHAR(20) NOT NULL DEFAULT 'medium',
  message TEXT NOT NULL,
  details JSONB,
  emailed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_successes_state_date ON ingestion_successes(state_code, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_failures_state_date ON ingestion_failures(state_code, failed_at DESC);
CREATE INDEX IF NOT EXISTS idx_fallbacks_state_date ON ingestion_fallbacks(state_code, escalated_at DESC);
CREATE INDEX IF NOT EXISTS idx_probes_state_date ON portal_probe_results(state_code, probe_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_dq_state_date ON data_quality_reports(state_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_type_date ON coverage_alerts(alert_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_state ON coverage_alerts(state_code, created_at DESC);

-- Seed all 50 states + DC into ingestion_telemetry
INSERT INTO ingestion_telemetry (state_code) VALUES
  ('AL'),('AK'),('AZ'),('AR'),('CA'),('CO'),('CT'),('DE'),('FL'),('GA'),
  ('HI'),('ID'),('IL'),('IN'),('IA'),('KS'),('KY'),('LA'),('ME'),('MD'),
  ('MA'),('MI'),('MN'),('MS'),('MO'),('MT'),('NE'),('NV'),('NH'),('NJ'),
  ('NM'),('NY'),('NC'),('ND'),('OH'),('OK'),('OR'),('PA'),('RI'),('SC'),
  ('SD'),('TN'),('TX'),('UT'),('VT'),('VA'),('WA'),('WV'),('WI'),('WY'),
  ('DC')
ON CONFLICT (state_code) DO NOTHING;
