-- ============================================
-- Migration: Add event_start_time, is_retro, futures support
-- Run this in your Supabase SQL Editor
-- ============================================

-- Add event_start_time to bets table (for single bets)
ALTER TABLE bets ADD COLUMN IF NOT EXISTS event_start_time TEXT;

-- Add is_whale flag (if not already present)
ALTER TABLE bets ADD COLUMN IF NOT EXISTS is_whale BOOLEAN DEFAULT false;

-- Add is_retro flag for retro slips
ALTER TABLE bets ADD COLUMN IF NOT EXISTS is_retro BOOLEAN DEFAULT false;

-- Add event_start_time to parlay_legs (each leg can have different start times)
ALTER TABLE parlay_legs ADD COLUMN IF NOT EXISTS event_start_time TEXT;

-- Update bet_category CHECK constraint to include 'futures'
ALTER TABLE bets DROP CONSTRAINT IF EXISTS bets_bet_category_check;
ALTER TABLE bets ADD CONSTRAINT bets_bet_category_check
  CHECK (bet_category IN ('team_game', 'player_prop', 'futures'));

ALTER TABLE parlay_legs DROP CONSTRAINT IF EXISTS parlay_legs_bet_category_check;
ALTER TABLE parlay_legs ADD CONSTRAINT parlay_legs_bet_category_check
  CHECK (bet_category IN ('team_game', 'player_prop', 'futures'));

-- Update wager_type CHECK constraint to include 'futures'
ALTER TABLE bets DROP CONSTRAINT IF EXISTS bets_wager_type_check;
ALTER TABLE bets ADD CONSTRAINT bets_wager_type_check
  CHECK (wager_type IN ('moneyline', 'spread', 'total', 'prop', 'futures'));

ALTER TABLE parlay_legs DROP CONSTRAINT IF EXISTS parlay_legs_wager_type_check;
ALTER TABLE parlay_legs ADD CONSTRAINT parlay_legs_wager_type_check
  CHECK (wager_type IN ('moneyline', 'spread', 'total', 'prop', 'futures'));

-- Index for retro bets (useful for filtering)
CREATE INDEX IF NOT EXISTS idx_bets_is_retro ON bets(is_retro);
