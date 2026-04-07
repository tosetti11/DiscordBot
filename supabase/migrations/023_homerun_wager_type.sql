-- ============================================
-- 023: Add homerun wager type
-- ============================================

-- Update bets table wager_type CHECK
ALTER TABLE bets DROP CONSTRAINT IF EXISTS bets_wager_type_check;
ALTER TABLE bets ADD CONSTRAINT bets_wager_type_check
  CHECK (wager_type IN ('moneyline', 'spread', 'total', 'team_total', 'prop', 'futures', 'nrfi', 'yrfi', 'homerun', 'double_chance', 'draw_no_bet'));

-- Update parlay_legs table wager_type CHECK
ALTER TABLE parlay_legs DROP CONSTRAINT IF EXISTS parlay_legs_wager_type_check;
ALTER TABLE parlay_legs ADD CONSTRAINT parlay_legs_wager_type_check
  CHECK (wager_type IN ('moneyline', 'spread', 'total', 'team_total', 'prop', 'futures', 'nrfi', 'yrfi', 'homerun', 'double_chance', 'draw_no_bet'));
