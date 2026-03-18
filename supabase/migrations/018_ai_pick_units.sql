-- ============================================
-- 018: Add units column to ai_pick_tails
-- Allows users to specify how many units they
-- are tailing (1-5). Fades default to 0.
-- ============================================

ALTER TABLE ai_pick_tails ADD COLUMN IF NOT EXISTS units NUMERIC DEFAULT 1;
