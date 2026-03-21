-- ============================================
-- 019: Add team_total to wager_type CHECK constraint
-- The team_total wager type was supported in the UI and server
-- but missing from the database CHECK constraint, causing
-- inserts to fail for team total bets.
-- ============================================

-- Update bets table wager_type CHECK
ALTER TABLE bets DROP CONSTRAINT IF EXISTS bets_wager_type_check;
ALTER TABLE bets ADD CONSTRAINT bets_wager_type_check
  CHECK (wager_type IN ('moneyline', 'spread', 'total', 'team_total', 'prop', 'futures'));

-- Update parlay_legs table wager_type CHECK
ALTER TABLE parlay_legs DROP CONSTRAINT IF EXISTS parlay_legs_wager_type_check;
ALTER TABLE parlay_legs ADD CONSTRAINT parlay_legs_wager_type_check
  CHECK (wager_type IN ('moneyline', 'spread', 'total', 'team_total', 'prop', 'futures'));
