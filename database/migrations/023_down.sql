-- 023_down.sql
--
-- Reverses migration 023: drops the api_keys table and its indexes.
--
-- Destructive: removes all issued API keys. Any caller authenticating with an
-- API key will fall back to JWT-only access (401 if they have no JWT). The
-- migration runner wraps this in a transaction.

BEGIN;

DROP TABLE IF EXISTS api_keys;

COMMIT;
