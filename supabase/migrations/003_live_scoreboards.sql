-- Add scoreboard placeholder column to bets table
ALTER TABLE bets ADD COLUMN IF NOT EXISTS mirror_scoreboard_msg_id TEXT;

-- Live Scoreboards table
-- Tracks active scoreboards posted to Discord channels
CREATE TABLE IF NOT EXISTS live_scoreboards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  discord_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  espn_game_id TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  bet_ids TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'ended', 'error')),
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_live_scoreboards_active
  ON live_scoreboards (status, guild_id);

CREATE INDEX IF NOT EXISTS idx_live_scoreboards_espn
  ON live_scoreboards (espn_game_id);
