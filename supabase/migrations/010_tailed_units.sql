-- ============================================
-- 010: Add tailed_units to tailed_bets
-- Allows tailers to specify their own unit amount
-- instead of using the original bettor's units
-- ============================================

ALTER TABLE tailed_bets
  ADD COLUMN IF NOT EXISTS tailed_units NUMERIC(6,2);

NOTIFY pgrst, 'reload schema';
