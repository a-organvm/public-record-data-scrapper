-- 015_down.sql
-- Remove bounded CHECK constraints added in migration 015.
-- (The migration runner already wraps this in a transaction.)

ALTER TABLE competitors DROP CONSTRAINT IF EXISTS competitors_market_share_range;
ALTER TABLE competitors DROP CONSTRAINT IF EXISTS competitors_monthly_trend_range;
ALTER TABLE competitors DROP CONSTRAINT IF EXISTS competitors_avg_deal_size_nonneg;
ALTER TABLE prospects   DROP CONSTRAINT IF EXISTS prospects_estimated_revenue_nonneg;
ALTER TABLE prospects   DROP CONSTRAINT IF EXISTS prospects_enrichment_confidence_range;
ALTER TABLE deals       DROP CONSTRAINT IF EXISTS deals_factor_rate_nonneg;
ALTER TABLE deals       DROP CONSTRAINT IF EXISTS deals_commission_amount_nonneg;
ALTER TABLE lenders     DROP CONSTRAINT IF EXISTS lenders_commission_rate_nonneg;
