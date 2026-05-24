-- ============================================================================
-- Migration 019: Basic JSONB shape CHECKs (LOW priority data integrity)
--
-- Several JSONB columns are expected to hold a specific top-level shape but are
-- unvalidated. This adds lightweight jsonb_typeof() guards where the intended
-- shape is unambiguous (an array). NULLs remain allowed. Constraints are added
-- NOT VALID and validated separately so existing data is checked explicitly.
--
-- TODO: tighten further with per-key validation if/when shapes stabilize
-- (e.g. attachments element schema, evidence/metadata object shapes). Left as
-- a follow-up to avoid over-constraining evolving payloads.
--
-- Ordering note: run after 001 (ingestion_logs, enrichment_logs) and 007
-- (communications.attachments).
-- ============================================================================

BEGIN;

DO $$
BEGIN
    -- ingestion_logs.errors expected to be a JSON array.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ingestion_logs_errors_is_array') THEN
        ALTER TABLE ingestion_logs
            ADD CONSTRAINT ingestion_logs_errors_is_array
            CHECK (errors IS NULL OR jsonb_typeof(errors) = 'array') NOT VALID;
    END IF;

    -- enrichment_logs.errors expected to be a JSON array.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enrichment_logs_errors_is_array') THEN
        ALTER TABLE enrichment_logs
            ADD CONSTRAINT enrichment_logs_errors_is_array
            CHECK (errors IS NULL OR jsonb_typeof(errors) = 'array') NOT VALID;
    END IF;

    -- communications.attachments expected to be a JSON array (defaults to '[]').
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'communications' AND column_name = 'attachments')
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'communications_attachments_is_array') THEN
        ALTER TABLE communications
            ADD CONSTRAINT communications_attachments_is_array
            CHECK (attachments IS NULL OR jsonb_typeof(attachments) = 'array') NOT VALID;
    END IF;
END $$;

ALTER TABLE ingestion_logs  VALIDATE CONSTRAINT ingestion_logs_errors_is_array;
ALTER TABLE enrichment_logs VALIDATE CONSTRAINT enrichment_logs_errors_is_array;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'communications_attachments_is_array') THEN
        ALTER TABLE communications VALIDATE CONSTRAINT communications_attachments_is_array;
    END IF;
END $$;

COMMIT;
