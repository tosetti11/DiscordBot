-- Add NRFI and YRFI wager types for baseball bets
-- Drop and recreate CHECK constraints on bets and parlay_legs tables

ALTER TABLE bets DROP CONSTRAINT IF EXISTS bets_wager_type_check;
ALTER TABLE bets ADD CONSTRAINT bets_wager_type_check
  CHECK (wager_type IN ('moneyline', 'spread', 'total', 'team_total', 'prop', 'futures', 'nrfi', 'yrfi'));

ALTER TABLE parlay_legs DROP CONSTRAINT IF EXISTS parlay_legs_wager_type_check;
ALTER TABLE parlay_legs ADD CONSTRAINT parlay_legs_wager_type_check
  CHECK (wager_type IN ('moneyline', 'spread', 'total', 'team_total', 'prop', 'futures', 'nrfi', 'yrfi'));
