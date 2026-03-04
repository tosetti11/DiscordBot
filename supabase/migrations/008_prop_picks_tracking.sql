-- ============================================
-- 008: Prop Picks Tracking
-- Stores daily top pick recommendations and 
-- tracks actual results for hit rate analysis
-- ============================================

CREATE TABLE IF NOT EXISTS prop_picks (
  id              SERIAL PRIMARY KEY,
  generated_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  
  -- Player / Game info
  player_id       TEXT NOT NULL,
  player_name     TEXT NOT NULL,
  team_abbr       TEXT NOT NULL,
  matchup         TEXT NOT NULL,         -- e.g. "CHA @ BOS"
  headshot_url    TEXT,
  
  -- Pick details
  direction       TEXT NOT NULL CHECK (direction IN ('over', 'under')),
  stat_key        TEXT NOT NULL,          -- pts, reb, ast, fg3
  stat_label      TEXT NOT NULL,          -- Points, Rebounds, etc.
  prop_line       NUMERIC(6,1) NOT NULL,  -- e.g. 26.5
  probability     INTEGER NOT NULL,       -- predicted probability %
  confidence      TEXT NOT NULL,          -- high, medium, low
  rank            INTEGER NOT NULL,       -- 1-5 within direction
  
  -- Context at time of prediction
  season_avg      NUMERIC(6,1),
  l5_avg          NUMERIC(6,1),
  l10_avg         NUMERIC(6,1),
  hit_rate_season INTEGER,               -- % at time of pick
  vs_opponent_avg NUMERIC(6,1),
  vs_opponent_games INTEGER,
  trending        TEXT,                   -- up, down, stable
  
  -- Results (filled in after game)
  actual_value    NUMERIC(6,1),           -- actual stat value from box score
  hit             BOOLEAN,                -- did the pick hit?
  resolved_at     TIMESTAMPTZ,
  game_id         TEXT,                   -- ESPN game ID for resolution
  
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX idx_prop_picks_date ON prop_picks (generated_date DESC);
CREATE INDEX idx_prop_picks_unresolved ON prop_picks (hit) WHERE hit IS NULL;
CREATE INDEX idx_prop_picks_player ON prop_picks (player_id, generated_date);

-- Prevent duplicate picks for same player/stat/date
CREATE UNIQUE INDEX idx_prop_picks_unique 
  ON prop_picks (generated_date, player_id, stat_key, direction);
