-- ============================================
-- 016: Expanded Bet Types
-- Adds period/half for totals & spreads,
-- round/method for MMA/Boxing,
-- golf hole/round for golf props.
-- ============================================

-- Period column for totals and spreads (e.g. 1st half, 2nd half, 1st period)
ALTER TABLE bets ADD COLUMN IF NOT EXISTS period TEXT DEFAULT 'full_game';
ALTER TABLE parlay_legs ADD COLUMN IF NOT EXISTS period TEXT DEFAULT 'full_game';

-- MMA/Boxing: round number and method of victory
ALTER TABLE bets ADD COLUMN IF NOT EXISTS fight_round INTEGER;
ALTER TABLE parlay_legs ADD COLUMN IF NOT EXISTS fight_round INTEGER;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS fight_method TEXT;
ALTER TABLE parlay_legs ADD COLUMN IF NOT EXISTS fight_method TEXT;

-- Golf: hole number and tournament round
ALTER TABLE bets ADD COLUMN IF NOT EXISTS golf_hole INTEGER;
ALTER TABLE parlay_legs ADD COLUMN IF NOT EXISTS golf_hole INTEGER;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS golf_round INTEGER;
ALTER TABLE parlay_legs ADD COLUMN IF NOT EXISTS golf_round INTEGER;
