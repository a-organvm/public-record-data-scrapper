-- 016_down.sql
-- Revert deal number uniqueness + advisory-lock generation.
-- Restores the original generate_deal_number() body from migration 006
-- (MAX()+1, no lock). (The migration runner already wraps this in a transaction.)

DROP INDEX IF EXISTS uq_deals_org_deal_number;

CREATE OR REPLACE FUNCTION generate_deal_number()
RETURNS TRIGGER AS $$
DECLARE
    org_prefix VARCHAR(100);
    next_num INTEGER;
BEGIN
    IF NEW.deal_number IS NULL THEN
        SELECT COALESCE(slug, 'DEAL') INTO org_prefix
        FROM organizations WHERE id = NEW.org_id;

        SELECT COALESCE(MAX(
            CAST(regexp_replace(deal_number, '[^0-9]', '', 'g') AS INTEGER)
        ), 0) + 1 INTO next_num
        FROM deals WHERE org_id = NEW.org_id;

        NEW.deal_number = UPPER(LEFT(org_prefix, 4)) || '-' || LPAD(next_num::TEXT, 6, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
