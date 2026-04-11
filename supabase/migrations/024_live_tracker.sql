-- ============================================
-- 024: Live Tracker — ESPN Game ID + Auto-Close
-- Adds espn_game_id to bets and parlay_legs,
-- auto_close_at and start_notified to bets
-- ============================================

-- Add ESPN game ID to bets (for single bets)
ALTER TABLE bets ADD COLUMN IF NOT EXISTS espn_game_id TEXT;

-- Add auto-close timestamp (NULL = not pending, set = will auto-close at this time)
ALTER TABLE bets ADD COLUMN IF NOT EXISTS auto_close_at TIMESTAMPTZ;

-- Track whether user was notified about game start
ALTER TABLE bets ADD COLUMN IF NOT EXISTS start_notified BOOLEAN DEFAULT FALSE;

-- Add ESPN game ID to parlay legs
ALTER TABLE parlay_legs ADD COLUMN IF NOT EXISTS espn_game_id TEXT;

-- Index for poller queries (open bets with game IDs)
CREATE INDEX IF NOT EXISTS idx_bets_espn_game_id ON bets(espn_game_id) WHERE espn_game_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bets_auto_close ON bets(auto_close_at) WHERE auto_close_at IS NOT NULL AND status = 'open';
CREATE INDEX IF NOT EXISTS idx_bets_open_with_game ON bets(status, espn_game_id) WHERE status = 'open' AND espn_game_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_parlay_legs_espn_game ON parlay_legs(espn_game_id) WHERE espn_game_id IS NOT NULL;
