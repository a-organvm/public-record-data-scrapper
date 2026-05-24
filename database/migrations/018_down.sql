-- 018_down.sql
-- Disable Row-Level Security and remove tenant-isolation policies.
-- (The migration runner already wraps this in a transaction.)

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
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = tbl) THEN
            EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
            EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', tbl);
        END IF;
    END LOOP;
END $$;

DROP FUNCTION IF EXISTS app_current_org_id();
