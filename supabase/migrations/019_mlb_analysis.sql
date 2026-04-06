-- ============================================
-- 019: MLB Daily Market Analysis
-- Tracks daily NRFI, Strikeout O/U, and HR
-- analysis for every MLB game.
-- ============================================

-- Per-game analysis entries
CREATE TABLE IF NOT EXISTS mlb_daily_analysis (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  guild_id TEXT NOT NULL,
  analysis_date DATE NOT NULL DEFAULT CURRENT_DATE,
  market_type TEXT NOT NULL CHECK (market_type IN ('nrfi', 'strikeout', 'homerun')),
  espn_game_id TEXT NOT NULL,

  -- Teams
  home_team TEXT NOT NULL,
  home_abbr TEXT,
  away_team TEXT NOT NULL,
  away_abbr TEXT,
  game_number INTEGER DEFAULT 1,
  event_start_time TEXT,

  -- Pitching matchup
  home_pitcher TEXT,
  home_pitcher_id TEXT,
  home_pitcher_headshot TEXT,
  home_pitcher_stats JSONB DEFAULT '{}',
  away_pitcher TEXT,
  away_pitcher_id TEXT,
  away_pitcher_headshot TEXT,
  away_pitcher_stats JSONB DEFAULT '{}',

  -- AI Analysis
  suggestion TEXT NOT NULL,
  confidence INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  reasoning TEXT,
  odds TEXT,
  line NUMERIC,

  -- Weather context
  temperature INTEGER,
  weather_condition TEXT,
  wind_speed INTEGER,

  -- Result tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'hit', 'miss', 'push', 'postponed', 'no_line')),
  actual_result TEXT,
  closed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(analysis_date, market_type, espn_game_id)
);

-- Track the Discord messages posted per market type per day
CREATE TABLE IF NOT EXISTS mlb_analysis_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  analysis_date DATE NOT NULL DEFAULT CURRENT_DATE,
  market_type TEXT NOT NULL CHECK (market_type IN ('nrfi', 'strikeout', 'homerun')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(analysis_date, market_type, guild_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mlb_analysis_date ON mlb_daily_analysis(analysis_date DESC);
CREATE INDEX IF NOT EXISTS idx_mlb_analysis_market ON mlb_daily_analysis(market_type);
CREATE INDEX IF NOT EXISTS idx_mlb_analysis_status ON mlb_daily_analysis(status);
CREATE INDEX IF NOT EXISTS idx_mlb_analysis_guild ON mlb_daily_analysis(guild_id);
CREATE INDEX IF NOT EXISTS idx_mlb_analysis_game ON mlb_daily_analysis(espn_game_id);
CREATE INDEX IF NOT EXISTS idx_mlb_messages_date ON mlb_analysis_messages(analysis_date DESC);
