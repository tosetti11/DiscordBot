-- ============================================
-- 012: Injury Impact Tracking for Prop Picks
-- Stores role expansion context when key
-- teammates are OUT (injured/resting)
-- ============================================

-- Add injury impact column (JSON with role expansion details)
ALTER TABLE prop_picks
  ADD COLUMN IF NOT EXISTS injury_impact JSONB DEFAULT NULL;

-- Example value:
-- {"roleExpansion": 1.15, "outPlayers": ["LeBron James"], "totalPPGOut": 25.7}
