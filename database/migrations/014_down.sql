-- 014_down.sql
-- Rollback for prospects.org_id hardening.
-- Restores the original NULLABLE FK with no explicit ON DELETE (matching 004).
-- (The migration runner already wraps this in a transaction.)

ALTER TABLE prospects ALTER COLUMN org_id DROP NOT NULL;

ALTER TABLE prospects DROP CONSTRAINT IF EXISTS prospects_org_id_fkey;
ALTER TABLE prospects
    ADD CONSTRAINT prospects_org_id_fkey
    FOREIGN KEY (org_id) REFERENCES organizations(id);

-- NOTE: backfilled org_id values and the default org are intentionally left in
-- place; removing them could break rows that legitimately reference the default
-- organization.
