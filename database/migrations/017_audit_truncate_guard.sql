-- ============================================================================
-- Migration 017: Block TRUNCATE on audit_logs (immutability hardening)
--
-- Migration 008 added row-level BEFORE UPDATE / BEFORE DELETE triggers that
-- raise on any modification, but TRUNCATE bypasses row-level triggers entirely,
-- so the audit trail could still be wiped. This adds a statement-level
-- BEFORE TRUNCATE trigger to close that gap.
--
-- Ordering note: run after 008_compliance.sql.
-- ============================================================================

BEGIN;

-- Reuses prevent_audit_modification() from migration 008. A TRUNCATE trigger
-- must be FOR EACH STATEMENT (TRUNCATE is not a per-row operation).
CREATE TRIGGER prevent_audit_truncate
    BEFORE TRUNCATE ON audit_logs
    FOR EACH STATEMENT
    EXECUTE FUNCTION prevent_audit_modification();

COMMIT;
