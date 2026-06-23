-- ============================================================================
-- Migration 023: API keys for programmatic access
--
-- First-paying-customer revenue path: the on-demand UCC scrape endpoints
-- (server/routes/scrape.ts) are the data-as-a-service product, but they sat
-- behind JWT-only auth. A JWT requires an interactive IdP/login flow, so there
-- was no credential an operator could hand a paying stranger to call the API.
--
-- This adds long-lived, revocable API keys scoped to an organization. The
-- secret itself is NEVER stored — only a SHA-256 hash (for lookup) and a short
-- non-secret prefix (for display, e.g. "prk_AbC12…"). A presented key is
-- hashed and matched against key_hash; the row carries the org_id and role that
-- populate the request's auth context, so the existing org-scoping / RLS and
-- requireRole machinery work unchanged.
--
-- Migration style: the runner (scripts/migrate.ts) executes each file as one
-- pool.query() inside a transaction; this mirrors the repo's transactional,
-- plain-CREATE convention (no CONCURRENTLY).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    -- Human label so an operator can tell keys apart ("acme-prod", "trial-bob").
    name VARCHAR(120) NOT NULL,
    -- Non-secret leading characters of the full key, safe to display in UIs/logs.
    key_prefix VARCHAR(16) NOT NULL,
    -- SHA-256 (hex) of the full presented key. The plaintext key is shown to the
    -- caller exactly once at creation and never persisted.
    key_hash CHAR(64) NOT NULL,
    -- Role granted to requests authenticated with this key. Mirrors the role
    -- vocabulary the scrape routes gate on via requireRole().
    role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    -- Best-effort usage timestamp, updated on successful verification. Foundation
    -- for per-key usage metering / billing.
    last_used_at TIMESTAMP WITH TIME ZONE,
    -- Optional expiry; NULL means the key never expires until revoked.
    expires_at TIMESTAMP WITH TIME ZONE,
    -- Soft revocation; set to disable a key without losing its audit trail.
    revoked_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Unique on the hash: verification is a single point lookup by hashed key, and
-- two keys must never collide to the same secret.
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- List/manage keys for an org; partial index keeps the common "active keys"
-- listing cheap.
CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys(org_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_org_active
    ON api_keys(org_id) WHERE revoked_at IS NULL;

COMMENT ON TABLE api_keys IS 'Org-scoped programmatic API keys for the data-as-a-service scrape endpoints. Stores a SHA-256 hash of the secret, never the plaintext.';
COMMENT ON COLUMN api_keys.key_hash IS 'SHA-256 hex digest of the full key; the plaintext is returned once at creation and never stored.';
COMMENT ON COLUMN api_keys.key_prefix IS 'Non-secret display prefix (e.g. prk_AbC12) for identifying a key without exposing the secret.';
COMMENT ON COLUMN api_keys.last_used_at IS 'Updated on successful verification; basis for per-key usage metering.';

COMMIT;
