-- ============================================
-- 026: MLB F5 ML + Team Total Market Types
-- Replaces Strikeout O/U and Home Run markets
-- with First 5 Innings ML and Team Totals.
-- ============================================

-- Update market_type constraint on mlb_daily_analysis
ALTER TABLE mlb_daily_analysis
  DROP CONSTRAINT IF EXISTS mlb_daily_analysis_market_type_check;

ALTER TABLE mlb_daily_analysis
  ADD CONSTRAINT mlb_daily_analysis_market_type_check
  CHECK (market_type IN ('nrfi', 'strikeout', 'homerun', 'f5ml', 'teamtotal'));

-- Update market_type constraint on mlb_analysis_messages
ALTER TABLE mlb_analysis_messages
  DROP CONSTRAINT IF EXISTS mlb_analysis_messages_market_type_check;

ALTER TABLE mlb_analysis_messages
  ADD CONSTRAINT mlb_analysis_messages_market_type_check
  CHECK (market_type IN ('nrfi', 'strikeout', 'homerun', 'f5ml', 'teamtotal'));
