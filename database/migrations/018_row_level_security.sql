-- ============================================================================
-- Migration 018: Row-Level Security (multi-tenant isolation)
--
-- Despite org_id existing on nearly every business table, no RLS was enforced,
-- so tenant isolation relied entirely on every query remembering to filter by
-- org_id. This migration enables RLS and adds a tenant-isolation policy on the
-- org-scoped tables, keyed off the session GUC `app.current_org_id`.
--
-- ----------------------------------------------------------------------------
-- REQUIRED APP WIRING (TODO — not done by this migration):
--   The application MUST set the tenant context on every request/connection,
--   e.g. at the start of each request (or per pooled connection checkout):
--
--       SET app.current_org_id = '<org-uuid>';
--       -- or, transaction-scoped:
--       SELECT set_config('app.current_org_id', '<org-uuid>', true);
--
--   Until this is wired, queries run by a NON-OWNER role will see NO rows for
--   these tables (fail-closed). The table OWNER and roles with BYPASSRLS are
--   NOT subject to these policies — migrations and admin tooling continue to
--   work. Run the application under a dedicated NON-owner role.
--
-- SAFETY / GATING:
--   * Policies are FAIL-CLOSED: with the GUC unset, current_setting(...,true)
--     returns NULL and the USING/CHECK predicate is false, so no rows match.
--   * This is intentionally conservative. If enabling fail-closed RLS by
--     default is too disruptive for your rollout, run 018_down.sql to disable
--     it again after deploying the SET app.current_org_id wiring, or change the
--     policies to FORCE only in non-prod first.
--
-- Ordering note: run after all org_id columns exist (004, 005, 006, 007, 008)
-- and after 014 (prospects.org_id NOT NULL).
-- ============================================================================

BEGIN;

-- Helper: current tenant from session GUC, NULL-safe (missing_ok = true).
CREATE OR REPLACE FUNCTION app_current_org_id()
RETURNS UUID AS $$
DECLARE
    raw TEXT;
BEGIN
    raw := current_setting('app.current_org_id', true);
    IF raw IS NULL OR raw = '' THEN
        RETURN NULL;
    END IF;
    RETURN raw::UUID;
EXCEPTION WHEN others THEN
    -- Malformed GUC -> treat as no tenant (fail closed).
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- Apply RLS + a uniform tenant policy to each org-scoped table.
DO $$
DECLARE
    tbl TEXT;
    org_tables TEXT[] := ARRAY[
        'prospects',
        'contacts',
        'deals',
        'communications',
        'consent_records',
        'deal_stages',
        'lenders',
        'communication_templates',
        'follow_up_reminders',
        'disclosures',
        'dnc_list',
        'compliance_alerts',
        'api_keys'
    ];
BEGIN
    FOREACH tbl IN ARRAY org_tables LOOP
        -- Only act on tables that actually exist and have an org_id column.
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = tbl AND column_name = 'org_id'
        ) THEN
            EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
            -- FORCE so even the table owner is subject to RLS is intentionally
            -- NOT set here, to keep migrations/admin tooling working. Run the
            -- app under a non-owner role for isolation to take effect.
            EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
            EXECUTE format(
                'CREATE POLICY tenant_isolation ON %I '
                || 'USING (org_id = app_current_org_id()) '
                || 'WITH CHECK (org_id = app_current_org_id())',
                tbl
            );
        END IF;
    END LOOP;
END $$;

COMMIT;
