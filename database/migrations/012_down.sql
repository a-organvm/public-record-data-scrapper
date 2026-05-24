-- 012_down.sql
--
-- WARNING (DESTRUCTIVE): These tables are ALSO part of the canonical
-- database/schema.sql fresh-install bootstrap. Running this rollback against a
-- database created from schema.sql will drop tables the bootstrap considers
-- "owned". Only run this if you intend to fully remove the migration-012
-- feature set. (The migration runner already wraps this in a transaction.)
DROP TABLE IF EXISTS pre_call_briefings;
DROP TABLE IF EXISTS outreach_steps;
DROP TABLE IF EXISTS outreach_sequences;
