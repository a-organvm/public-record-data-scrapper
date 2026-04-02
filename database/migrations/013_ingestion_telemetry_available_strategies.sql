-- 013_ingestion_telemetry_available_strategies.sql
-- Repair drift for JSON-encoded ingestion strategy chains

ALTER TABLE ingestion_telemetry
ADD COLUMN IF NOT EXISTS available_strategies TEXT;

ALTER TABLE ingestion_telemetry
ALTER COLUMN available_strategies TYPE TEXT
USING CASE
  WHEN available_strategies IS NULL THEN '[]'
  ELSE available_strategies::TEXT
END;

UPDATE ingestion_telemetry
SET available_strategies = '[]'
WHERE available_strategies IS NULL OR btrim(available_strategies) = '';

ALTER TABLE ingestion_telemetry
ALTER COLUMN available_strategies SET DEFAULT '[]';

ALTER TABLE ingestion_telemetry
ALTER COLUMN available_strategies SET NOT NULL;
