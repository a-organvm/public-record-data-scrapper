-- 014_billing_signups.sql
-- Capture pricing-page signups before or alongside Stripe checkout

CREATE TABLE IF NOT EXISTS billing_signups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) NOT NULL,
  requested_plan VARCHAR(20) NOT NULL CHECK (requested_plan IN ('free', 'starter', 'pro')),
  status VARCHAR(20) NOT NULL DEFAULT 'captured' CHECK (
    status IN ('captured', 'waitlisted', 'checkout_started', 'subscribed')
  ),
  company_name VARCHAR(255),
  source VARCHAR(100) NOT NULL DEFAULT 'pricing-page',
  stripe_checkout_session_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_signups_email_created
ON billing_signups(email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_signups_plan_status
ON billing_signups(requested_plan, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_signups_checkout_session
ON billing_signups(stripe_checkout_session_id)
WHERE stripe_checkout_session_id IS NOT NULL;
