-- 013_down.sql
-- Revert ingestion telemetry available_strategies repair

ALTER TABLE ingestion_telemetry
DROP COLUMN IF EXISTS available_strategies;
