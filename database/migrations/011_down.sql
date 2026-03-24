-- 011_down.sql
DROP TABLE IF EXISTS competitor_market_positions;
DROP TABLE IF EXISTS filing_velocity_metrics;
DROP TABLE IF EXISTS filing_events;
DROP TABLE IF EXISTS ucc_amendments;
ALTER TABLE ucc_filings DROP COLUMN IF EXISTS expiration_date;
ALTER TABLE ucc_filings DROP COLUMN IF EXISTS termination_date;
ALTER TABLE ucc_filings DROP COLUMN IF EXISTS amendment_count;
ALTER TABLE ucc_filings DROP COLUMN IF EXISTS last_amendment_date;
