-- ============================================
-- Add share_link column to bets
-- Migration 005
-- For DraftKings / FanDuel / etc bet sharing links
-- ============================================

ALTER TABLE bets ADD COLUMN IF NOT EXISTS share_link TEXT;
