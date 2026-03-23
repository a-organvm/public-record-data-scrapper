-- 010_down.sql
-- Rollback for ingestion telemetry tables
DROP TABLE IF EXISTS coverage_alerts;
DROP TABLE IF EXISTS data_quality_reports;
DROP TABLE IF EXISTS portal_probe_results;
DROP TABLE IF EXISTS ingestion_fallbacks;
DROP TABLE IF EXISTS ingestion_failures;
DROP TABLE IF EXISTS ingestion_successes;
DROP TABLE IF EXISTS ingestion_telemetry;
