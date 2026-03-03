-- ============================================
-- GK | Sports Betting Tracker - Supabase Schema
-- Run this in your Supabase SQL Editor
-- ============================================

-- Users table (linked to Discord)
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  discord_id TEXT UNIQUE NOT NULL,
  discord_username TEXT NOT NULL,
  discord_avatar TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bets table
CREATE TABLE IF NOT EXISTS bets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  discord_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  mirror_message_id TEXT,
  mirror_channel_id TEXT,
  mirror_scoreboard_msg_id TEXT,

  -- Slip number (e.g. RIC-001)
  slip_number TEXT UNIQUE,

  -- Bet type
  bet_type TEXT NOT NULL CHECK (bet_type IN ('single', 'parlay')),

  -- For single bets (parlay legs stored in parlay_legs table)
  sport TEXT,
  bet_category TEXT CHECK (bet_category IN ('team_game', 'player_prop')),
  team_a TEXT,
  team_b TEXT,
  player_name TEXT,
  prop_description TEXT,
  pick TEXT,                  -- e.g. "Duke -1.5" or "LeBron Over 25.5 pts"
  wager_type TEXT CHECK (wager_type IN ('moneyline', 'spread', 'total', 'prop')),
  spread_value DECIMAL(5,1),
  odds_american INTEGER,     -- e.g. -110, +150
  odds_decimal DECIMAL(6,3), -- e.g. 1.909, 2.500

  -- Wager info
  units DECIMAL(5,2) NOT NULL DEFAULT 1,
  bet_note TEXT,
  share_link TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'win', 'loss', 'push', 'void')),
  result_note TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Parlay legs table (for parlay bets)
CREATE TABLE IF NOT EXISTS parlay_legs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bet_id UUID REFERENCES bets(id) ON DELETE CASCADE,
  leg_number INTEGER NOT NULL,

  sport TEXT,
  bet_category TEXT CHECK (bet_category IN ('team_game', 'player_prop')),
  team_a TEXT,
  team_b TEXT,
  player_name TEXT,
  prop_description TEXT,
  pick TEXT,
  wager_type TEXT CHECK (wager_type IN ('moneyline', 'spread', 'total', 'prop')),
  spread_value DECIMAL(5,1),
  odds_american INTEGER,
  odds_decimal DECIMAL(6,3),

  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'win', 'loss', 'push', 'void')),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_bets_discord_id ON bets(discord_id);
CREATE INDEX IF NOT EXISTS idx_bets_guild_id ON bets(guild_id);
CREATE INDEX IF NOT EXISTS idx_bets_status ON bets(status);
CREATE INDEX IF NOT EXISTS idx_bets_created_at ON bets(created_at);
CREATE INDEX IF NOT EXISTS idx_bets_slip_number ON bets(slip_number);
CREATE INDEX IF NOT EXISTS idx_parlay_legs_bet_id ON parlay_legs(bet_id);

-- Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE parlay_legs ENABLE ROW LEVEL SECURITY;

-- No RLS policies needed: the bot connects with the service_role key,
-- which bypasses RLS entirely. This means the anon role gets zero access
-- (which is correct — there is no direct client-side Supabase usage).

-- Tailed bets table (tracks who tailed/faded a bet)
CREATE TABLE IF NOT EXISTS tailed_bets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bet_id UUID REFERENCES bets(id) ON DELETE CASCADE,
  tailer_discord_id TEXT NOT NULL,
  tailed BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(bet_id, tailer_discord_id)
);

CREATE INDEX IF NOT EXISTS idx_tailed_bets_bet_id ON tailed_bets(bet_id);
CREATE INDEX IF NOT EXISTS idx_tailed_bets_tailer ON tailed_bets(tailer_discord_id);

ALTER TABLE tailed_bets ENABLE ROW LEVEL SECURITY;

-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bets_updated_at
  BEFORE UPDATE ON bets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- View for user stats (security_invoker = runs as querying user, not view owner)
CREATE OR REPLACE VIEW user_stats
WITH (security_invoker = true)
AS
SELECT
  u.discord_id,
  u.discord_username,
  COUNT(b.id) FILTER (WHERE b.status != 'void') AS total_bets,
  COUNT(b.id) FILTER (WHERE b.status = 'open') AS open_bets,
  COUNT(b.id) FILTER (WHERE b.status = 'win') AS wins,
  COUNT(b.id) FILTER (WHERE b.status = 'loss') AS losses,
  COUNT(b.id) FILTER (WHERE b.status = 'push') AS pushes,
  CASE
    WHEN COUNT(b.id) FILTER (WHERE b.status IN ('win', 'loss')) > 0
    THEN ROUND(
      COUNT(b.id) FILTER (WHERE b.status = 'win')::DECIMAL /
      COUNT(b.id) FILTER (WHERE b.status IN ('win', 'loss')) * 100, 1
    )
    ELSE 0
  END AS win_pct,
  COALESCE(SUM(b.units) FILTER (WHERE b.status = 'win'), 0) AS units_won,
  COALESCE(SUM(b.units) FILTER (WHERE b.status = 'loss'), 0) AS units_lost,
  COALESCE(
    SUM(
      CASE
        WHEN b.status = 'win' THEN
          CASE
            WHEN b.odds_american >= 0 THEN b.units * (b.odds_american::DECIMAL / 100)
            ELSE b.units * (100.0 / ABS(b.odds_american))
          END
        WHEN b.status = 'loss' THEN -b.units
        ELSE 0
      END
    ), 0
  ) AS net_units
FROM users u
LEFT JOIN bets b ON u.id = b.user_id
GROUP BY u.id, u.discord_id, u.discord_username;

-- Reminders table (scheduled messages)
CREATE TABLE IF NOT EXISTS reminders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  creator_discord_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'custom',
  message TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  repeat TEXT NOT NULL DEFAULT 'none' CHECK (repeat IN ('none', 'daily', 'weekly')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_fired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient scheduler queries
CREATE INDEX IF NOT EXISTS idx_reminders_active_scheduled
  ON reminders (scheduled_at)
  WHERE is_active = true;

ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;

-- Web analytics table (login / install tracking)
CREATE TABLE IF NOT EXISTS web_analytics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  discord_id TEXT NOT NULL,
  discord_username TEXT,
  display_name TEXT,
  avatar TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('login', 'pwa_install', 'page_view', 'bet_placed', 'view_leaderboard', 'view_stats', 'view_bets', 'view_tools', 'view_reminders')),
  user_agent TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_web_analytics_event_type
  ON web_analytics (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_web_analytics_discord_id
  ON web_analytics (discord_id, event_type);

ALTER TABLE web_analytics ENABLE ROW LEVEL SECURITY;

-- Guild settings (welcome message, etc.)
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY,
  welcome_enabled BOOLEAN DEFAULT true,
  welcome_message JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE guild_settings ENABLE ROW LEVEL SECURITY;
