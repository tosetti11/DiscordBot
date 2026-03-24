-- ============================================
-- 020: Golf Round Totals AI Picks
-- Adds pick_type, tournament_name, round_number
-- to ai_picks table for golf-specific picks.
-- ============================================

-- Add pick_type to distinguish daily lock vs golf round totals
ALTER TABLE ai_picks ADD COLUMN IF NOT EXISTS pick_type TEXT NOT NULL DEFAULT 'daily';

-- Golf-specific columns
ALTER TABLE ai_picks ADD COLUMN IF NOT EXISTS tournament_name TEXT;
ALTER TABLE ai_picks ADD COLUMN IF NOT EXISTS round_number INTEGER;

-- Index for efficient golf pick queries
CREATE INDEX IF NOT EXISTS idx_ai_picks_pick_type ON ai_picks(pick_type);
CREATE INDEX IF NOT EXISTS idx_ai_picks_tournament ON ai_picks(tournament_name);
