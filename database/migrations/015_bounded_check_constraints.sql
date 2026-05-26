-- ============================================================================
-- Migration 015: Bounded CHECK constraints (data integrity)
--
-- Adds bounded / non-negative CHECK constraints that were missing on numeric
-- columns. Constraints are added NOT VALID first where existing data might
-- violate them, then VALIDATEd separately so the table is not long-locked and
-- so the migration fails loudly (rather than silently) if legacy data is out of
-- range. Each ADD is guarded so the migration is re-runnable.
--
-- Ordering note: run after 006_deals.sql and 001_initial_schema.sql.
-- ============================================================================

BEGIN;

DO $$
BEGIN
    -- competitors.market_share: percentage 0-100
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competitors_market_share_range') THEN
        ALTER TABLE competitors
            ADD CONSTRAINT competitors_market_share_range
            CHECK (market_share IS NULL OR (market_share >= 0 AND market_share <= 100)) NOT VALID;
    END IF;

    -- competitors.monthly_trend: percentage change, bounded to a sane range
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competitors_monthly_trend_range') THEN
        ALTER TABLE competitors
            ADD CONSTRAINT competitors_monthly_trend_range
            CHECK (monthly_trend IS NULL OR (monthly_trend >= -100 AND monthly_trend <= 100)) NOT VALID;
    END IF;

    -- competitors.avg_deal_size: non-negative
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competitors_avg_deal_size_nonneg') THEN
        ALTER TABLE competitors
            ADD CONSTRAINT competitors_avg_deal_size_nonneg
            CHECK (avg_deal_size IS NULL OR avg_deal_size >= 0) NOT VALID;
    END IF;

    -- prospects.estimated_revenue: non-negative
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospects_estimated_revenue_nonneg') THEN
        ALTER TABLE prospects
            ADD CONSTRAINT prospects_estimated_revenue_nonneg
            CHECK (estimated_revenue IS NULL OR estimated_revenue >= 0) NOT VALID;
    END IF;

    -- prospects.enrichment_confidence: 0-1 (priority_score 0-100 already
    -- constrained in 001_initial_schema.sql).
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospects_enrichment_confidence_range') THEN
        ALTER TABLE prospects
            ADD CONSTRAINT prospects_enrichment_confidence_range
            CHECK (enrichment_confidence IS NULL OR (enrichment_confidence >= 0 AND enrichment_confidence <= 1)) NOT VALID;
    END IF;

    -- deals.factor_rate: non-negative
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_factor_rate_nonneg') THEN
        ALTER TABLE deals
            ADD CONSTRAINT deals_factor_rate_nonneg
            CHECK (factor_rate IS NULL OR factor_rate >= 0) NOT VALID;
    END IF;

    -- deals.commission_amount: non-negative
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_commission_amount_nonneg') THEN
        ALTER TABLE deals
            ADD CONSTRAINT deals_commission_amount_nonneg
            CHECK (commission_amount IS NULL OR commission_amount >= 0) NOT VALID;
    END IF;

    -- lenders.commission_rate: non-negative (rate as decimal, e.g. 0.025)
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lenders_commission_rate_nonneg') THEN
        ALTER TABLE lenders
            ADD CONSTRAINT lenders_commission_rate_nonneg
            CHECK (commission_rate IS NULL OR commission_rate >= 0) NOT VALID;
    END IF;
END $$;

-- Validate constraints (separate step; will error if legacy data is out of
-- range, surfacing data-quality issues rather than hiding them).
ALTER TABLE competitors VALIDATE CONSTRAINT competitors_market_share_range;
ALTER TABLE competitors VALIDATE CONSTRAINT competitors_monthly_trend_range;
ALTER TABLE competitors VALIDATE CONSTRAINT competitors_avg_deal_size_nonneg;
ALTER TABLE prospects   VALIDATE CONSTRAINT prospects_estimated_revenue_nonneg;
ALTER TABLE prospects   VALIDATE CONSTRAINT prospects_enrichment_confidence_range;
ALTER TABLE deals       VALIDATE CONSTRAINT deals_factor_rate_nonneg;
ALTER TABLE deals       VALIDATE CONSTRAINT deals_commission_amount_nonneg;
ALTER TABLE lenders     VALIDATE CONSTRAINT lenders_commission_rate_nonneg;

COMMIT;
