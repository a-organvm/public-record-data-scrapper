-- ============================================================================
-- Migration 014: Enforce prospects.org_id (multi-tenancy hardening)
--
-- Migration 004 added prospects.org_id as a NULLABLE FK with no ON DELETE
-- behavior and no backfill. That allows tenant-less prospect rows and an
-- ambiguous delete behavior for the parent organization.
--
-- This migration:
--   1. Ensures a default "Unassigned" organization exists.
--   2. Backfills any NULL prospects.org_id to that default org (ordering: this
--      MUST run before the NOT NULL is applied, all within one transaction).
--   3. Recreates the FK with an explicit ON DELETE behavior.
--   4. Marks prospects.org_id NOT NULL.
--
-- Ordering note: run after 004_multitenancy.sql. Idempotent where practical.
-- ============================================================================

BEGIN;

-- 1. Default org for legacy / tenant-less rows. Fixed UUID for determinism.
INSERT INTO organizations (id, name, slug, subscription_tier, is_active)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Unassigned (system default)',
    'unassigned',
    'free',
    true
)
ON CONFLICT (id) DO NOTHING;

-- 2. Backfill NULL org_id rows to the default org BEFORE applying NOT NULL.
UPDATE prospects
SET org_id = '00000000-0000-0000-0000-000000000001'
WHERE org_id IS NULL;

-- 3. Replace the FK with an explicit ON DELETE RESTRICT so an org cannot be
--    deleted while it still owns prospects (prevents accidental data loss and
--    avoids orphaning tenant-scoped rows). The original constraint name from
--    migration 004 is the default 'prospects_org_id_fkey'.
ALTER TABLE prospects DROP CONSTRAINT IF EXISTS prospects_org_id_fkey;
ALTER TABLE prospects
    ADD CONSTRAINT prospects_org_id_fkey
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- 4. Enforce tenancy: every prospect must belong to an organization.
ALTER TABLE prospects ALTER COLUMN org_id SET NOT NULL;

COMMIT;
