-- 011_down.sql
--
-- WARNING (DESTRUCTIVE): These tables/columns are ALSO part of the canonical
-- database/schema.sql fresh-install bootstrap. Running this rollback against a
-- database created from schema.sql will drop objects the bootstrap considers
-- "owned". Only run this if you intend to fully remove the migration-011
-- feature set. (The migration runner already wraps this in a transaction.)
DROP TABLE IF EXISTS competitor_market_positions;
DROP TABLE IF EXISTS filing_velocity_metrics;
DROP TABLE IF EXISTS filing_events;
DROP TABLE IF EXISTS ucc_amendments;
ALTER TABLE ucc_filings DROP COLUMN IF EXISTS expiration_date;
ALTER TABLE ucc_filings DROP COLUMN IF EXISTS termination_date;
ALTER TABLE ucc_filings DROP COLUMN IF EXISTS amendment_count;
ALTER TABLE ucc_filings DROP COLUMN IF EXISTS last_amendment_date;
