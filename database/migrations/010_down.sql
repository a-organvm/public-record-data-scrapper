-- 010_down.sql
-- Rollback for ingestion telemetry tables
--
-- WARNING (DESTRUCTIVE): These tables are ALSO part of the canonical
-- database/schema.sql fresh-install bootstrap. Running this rollback against a
-- database created from schema.sql will drop tables the bootstrap considers
-- "owned". Only run this if you intend to fully remove the migration-010
-- feature set. (The migration runner already wraps this script in a single
-- transaction; do not add BEGIN/COMMIT here.)
DROP TABLE IF EXISTS coverage_alerts;
DROP TABLE IF EXISTS data_quality_reports;
DROP TABLE IF EXISTS portal_probe_results;
DROP TABLE IF EXISTS ingestion_fallbacks;
DROP TABLE IF EXISTS ingestion_failures;
DROP TABLE IF EXISTS ingestion_successes;
DROP TABLE IF EXISTS ingestion_telemetry;
