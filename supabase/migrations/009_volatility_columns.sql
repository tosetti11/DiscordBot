-- ============================================
-- 009: Add Role-Volatility Columns
-- Tracks minutes/usage volatility per pick
-- ============================================

ALTER TABLE prop_picks 
  ADD COLUMN IF NOT EXISTS volatility NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS volatility_label TEXT;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
