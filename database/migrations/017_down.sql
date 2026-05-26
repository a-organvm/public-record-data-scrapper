-- 017_down.sql
-- Remove the TRUNCATE guard on audit_logs.
-- (The migration runner already wraps this in a transaction.)

DROP TRIGGER IF EXISTS prevent_audit_truncate ON audit_logs;
