-- ============================================
-- 025: MLB Live Bets
-- Adds 'mlb_live' to bet_category and wager_type
-- CHECK constraints on both bets and parlay_legs
-- ============================================

-- Update bet_category CHECK to include 'mlb_live'
ALTER TABLE bets DROP CONSTRAINT IF EXISTS bets_bet_category_check;
ALTER TABLE bets ADD CONSTRAINT bets_bet_category_check
  CHECK (bet_category IN ('team_game', 'player_prop', 'futures', 'mlb_live'));

ALTER TABLE parlay_legs DROP CONSTRAINT IF EXISTS parlay_legs_bet_category_check;
ALTER TABLE parlay_legs ADD CONSTRAINT parlay_legs_bet_category_check
  CHECK (bet_category IN ('team_game', 'player_prop', 'futures', 'mlb_live'));

-- Update wager_type CHECK to include 'mlb_live'
ALTER TABLE bets DROP CONSTRAINT IF EXISTS bets_wager_type_check;
ALTER TABLE bets ADD CONSTRAINT bets_wager_type_check
  CHECK (wager_type IN (
    'moneyline', 'spread', 'total', 'team_total', 'prop',
    'futures', 'nrfi', 'yrfi', 'homerun', 'double_chance', 'draw_no_bet',
    'mlb_live'
  ));

ALTER TABLE parlay_legs DROP CONSTRAINT IF EXISTS parlay_legs_wager_type_check;
ALTER TABLE parlay_legs ADD CONSTRAINT parlay_legs_wager_type_check
  CHECK (wager_type IN (
    'moneyline', 'spread', 'total', 'team_total', 'prop',
    'futures', 'nrfi', 'yrfi', 'homerun', 'double_chance', 'draw_no_bet',
    'mlb_live'
  ));
