-- ============================================
-- 027: 2-Ball / 3-Ball Golf Matchup Bets
-- Adds 2ball/3ball wager types + player columns
-- for head-to-head golf matchup tracking
-- ============================================

-- Extend wager_type CHECK to include 2ball and 3ball
ALTER TABLE bets
  DROP CONSTRAINT IF EXISTS bets_wager_type_check;
ALTER TABLE bets
  ADD CONSTRAINT bets_wager_type_check
  CHECK (wager_type IN (
    'moneyline','spread','total','team_total','prop','futures',
    'nrfi','yrfi','homerun','double_chance','draw_no_bet',
    'mlb_live','2ball','3ball'
  ));

ALTER TABLE parlay_legs
  DROP CONSTRAINT IF EXISTS parlay_legs_wager_type_check;
ALTER TABLE parlay_legs
  ADD CONSTRAINT parlay_legs_wager_type_check
  CHECK (wager_type IN (
    'moneyline','spread','total','team_total','prop','futures',
    'nrfi','yrfi','homerun','double_chance','draw_no_bet',
    'mlb_live','2ball','3ball'
  ));

-- Player columns for match-play bets
-- match_player_a  : Player/Group A, member 1 (the side being bet on)
-- match_player_a2 : Player/Group A, member 2 (team format like Zurich Classic)
-- match_player_b  : Player/Group B, member 1 (the opponent)
-- match_player_b2 : Player/Group B, member 2 (team format)
-- match_player_c  : Third player (3-ball only)
ALTER TABLE bets ADD COLUMN IF NOT EXISTS match_player_a  TEXT;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS match_player_a2 TEXT;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS match_player_b  TEXT;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS match_player_b2 TEXT;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS match_player_c  TEXT;

-- Same columns on parlay_legs for parlays that include 2ball/3ball legs
ALTER TABLE parlay_legs ADD COLUMN IF NOT EXISTS match_player_a  TEXT;
ALTER TABLE parlay_legs ADD COLUMN IF NOT EXISTS match_player_a2 TEXT;
ALTER TABLE parlay_legs ADD COLUMN IF NOT EXISTS match_player_b  TEXT;
ALTER TABLE parlay_legs ADD COLUMN IF NOT EXISTS match_player_b2 TEXT;
ALTER TABLE parlay_legs ADD COLUMN IF NOT EXISTS match_player_c  TEXT;

-- Index for quick lookup of open match-play bets
CREATE INDEX IF NOT EXISTS idx_bets_match_player ON bets(match_player_a)
  WHERE match_player_a IS NOT NULL AND status = 'open';
