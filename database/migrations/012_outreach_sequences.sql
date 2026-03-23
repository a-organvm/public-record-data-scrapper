-- 012_outreach_sequences.sql

CREATE TABLE IF NOT EXISTS outreach_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  filing_event_id UUID REFERENCES filing_events(id) ON DELETE SET NULL,
  trigger_type VARCHAR(30) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'cancelled', 'failed')),
  current_step INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 1,
  fresh_capacity_score INTEGER,
  metadata JSONB,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sequences_prospect ON outreach_sequences(prospect_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sequences_status ON outreach_sequences(status) WHERE status IN ('pending', 'active');

CREATE TABLE IF NOT EXISTS outreach_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES outreach_sequences(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  channel VARCHAR(10) NOT NULL CHECK (channel IN ('email', 'sms', 'call', 'briefing')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'sent', 'delivered', 'failed', 'skipped')),
  template_key VARCHAR(100),
  subject TEXT,
  body TEXT,
  scheduled_for TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  external_id VARCHAR(200),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_steps_sequence ON outreach_steps(sequence_id, step_number);
CREATE INDEX IF NOT EXISTS idx_steps_scheduled ON outreach_steps(scheduled_for) WHERE status = 'scheduled';

CREATE TABLE IF NOT EXISTS pre_call_briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  content JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  UNIQUE(prospect_id)
);
CREATE INDEX IF NOT EXISTS idx_briefings_prospect ON pre_call_briefings(prospect_id);
