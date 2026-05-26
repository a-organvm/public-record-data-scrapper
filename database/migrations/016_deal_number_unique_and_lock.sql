-- ============================================================================
-- Migration 016: Deal number uniqueness + race-free generation
--
-- Migration 006's generate_deal_number() computes MAX(...) + 1 with no lock and
-- deal_number has no UNIQUE constraint, so concurrent inserts can produce
-- duplicate deal numbers within an org.
--
-- This migration:
--   1. Adds a partial UNIQUE index on (org_id, deal_number) (partial so legacy
--      NULL deal_numbers, if any, do not collide).
--   2. Replaces generate_deal_number() to take a per-org transaction-scoped
--      advisory lock so the MAX()+1 computation is serialized per organization.
--
-- Ordering note: run after 006_deals.sql. If duplicate (org_id, deal_number)
-- pairs already exist, the unique index build will fail — dedupe first.
-- ============================================================================

BEGIN;

-- 1. Enforce uniqueness of deal_number within an org.
CREATE UNIQUE INDEX IF NOT EXISTS uq_deals_org_deal_number
    ON deals (org_id, deal_number)
    WHERE deal_number IS NOT NULL;

-- 2. Race-free deal number generation via a per-org advisory lock.
CREATE OR REPLACE FUNCTION generate_deal_number()
RETURNS TRIGGER AS $$
DECLARE
    org_prefix VARCHAR(100);
    next_num INTEGER;
BEGIN
    IF NEW.deal_number IS NULL THEN
        -- Serialize numbering per organization for the duration of this
        -- transaction so concurrent inserts cannot read the same MAX().
        PERFORM pg_advisory_xact_lock(hashtext('deal_number:' || NEW.org_id::text));

        SELECT COALESCE(slug, 'DEAL') INTO org_prefix
        FROM organizations WHERE id = NEW.org_id;

        SELECT COALESCE(MAX(
            CAST(NULLIF(regexp_replace(deal_number, '[^0-9]', '', 'g'), '') AS INTEGER)
        ), 0) + 1 INTO next_num
        FROM deals WHERE org_id = NEW.org_id;

        NEW.deal_number = UPPER(LEFT(org_prefix, 4)) || '-' || LPAD(next_num::TEXT, 6, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
