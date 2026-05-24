-- 019_down.sql
-- Remove JSONB shape CHECK constraints added in migration 019.
-- (The migration runner already wraps this in a transaction.)

ALTER TABLE ingestion_logs  DROP CONSTRAINT IF EXISTS ingestion_logs_errors_is_array;
ALTER TABLE enrichment_logs DROP CONSTRAINT IF EXISTS enrichment_logs_errors_is_array;
ALTER TABLE communications  DROP CONSTRAINT IF EXISTS communications_attachments_is_array;
