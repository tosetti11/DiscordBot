-- ============================================
-- 017: AI Pick of the Day
-- Tracks daily AI lock picks with records,
-- tail/fade engagement, and auto-close results.
-- ============================================

CREATE TABLE IF NOT EXISTS ai_picks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  
  -- Pick details
  sport TEXT NOT NULL,
  bet_category TEXT NOT NULL DEFAULT 'team_game',
  wager_type TEXT NOT NULL DEFAULT 'moneyline',
  pick TEXT NOT NULL,
  team_a TEXT,
  team_b TEXT,
  player_name TEXT,
  prop_description TEXT,
  spread_value NUMERIC,
  over_under TEXT,
  odds_american INTEGER NOT NULL,
  
  -- AI analysis
  reasoning TEXT,
  confidence INTEGER DEFAULT 90,
  
  -- ESPN tracking for auto-close
  espn_game_id TEXT,
  espn_sport TEXT,
  event_start_time TEXT,
  
  -- Results
  status TEXT NOT NULL DEFAULT 'pending',
  result_note TEXT,
  final_score TEXT,
  
  -- Tail/Fade tracking
  tail_count INTEGER DEFAULT 0,
  fade_count INTEGER DEFAULT 0,
  
  -- Record at time of pick (for display on card)
  record_wins INTEGER DEFAULT 0,
  record_losses INTEGER DEFAULT 0,
  record_pushes INTEGER DEFAULT 0,
  record_units NUMERIC DEFAULT 0,
  streak INTEGER DEFAULT 0,
  
  pick_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

-- Tail/Fade per-user tracking for leaderboard
CREATE TABLE IF NOT EXISTS ai_pick_tails (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pick_id UUID REFERENCES ai_picks(id) ON DELETE CASCADE,
  discord_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('tail', 'fade')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pick_id, discord_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_picks_date ON ai_picks(pick_date DESC);
CREATE INDEX IF NOT EXISTS idx_ai_picks_status ON ai_picks(status);
CREATE INDEX IF NOT EXISTS idx_ai_picks_guild ON ai_picks(guild_id);
CREATE INDEX IF NOT EXISTS idx_ai_pick_tails_pick ON ai_pick_tails(pick_id);
CREATE INDEX IF NOT EXISTS idx_ai_pick_tails_user ON ai_pick_tails(discord_id);
