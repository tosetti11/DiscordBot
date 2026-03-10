-- ============================================
-- 013: Game Picks Tracking
-- Stores daily ML, Spread, and O/U game pick
-- recommendations and tracks actual results.
-- ============================================

CREATE TABLE IF NOT EXISTS game_picks (
  id              SERIAL PRIMARY KEY,
  generated_date  DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Game info
  game_id         TEXT NOT NULL,            -- ESPN event ID
  game_name       TEXT NOT NULL,            -- e.g. "BOS @ MIA"
  start_time      TIMESTAMPTZ,
  home_team       TEXT NOT NULL,            -- abbreviation e.g. "MIA"
  away_team       TEXT NOT NULL,            -- abbreviation e.g. "BOS"
  home_logo       TEXT,
  away_logo       TEXT,

  -- Pick details
  pick_type       TEXT NOT NULL CHECK (pick_type IN ('ml', 'spread', 'ou')),
  pick            TEXT NOT NULL,            -- e.g. "BOS", "BOS -5.5", "OVER 220.5"
  pick_team       TEXT,                     -- 'home' or 'away' (null for O/U)
  pick_direction  TEXT,                     -- 'over' or 'under' (for O/U picks only)
  line            NUMERIC(6,1),             -- spread value or O/U total
  probability     INTEGER NOT NULL,         -- predicted probability %
  confidence      TEXT NOT NULL,            -- high, medium, low
  rank            INTEGER NOT NULL,         -- 1-5 within pick type

  -- Context at time of prediction
  home_power      NUMERIC(5,1),             -- power rating 0-100
  away_power      NUMERIC(5,1),
  home_record     TEXT,                     -- e.g. "45-20"
  away_record     TEXT,
  home_form       TEXT,                     -- L10 record e.g. "7-3"
  away_form       TEXT,
  projected_margin NUMERIC(5,1),            -- for ML/spread: projected home margin
  projected_total NUMERIC(5,1),             -- for O/U: projected total points
  home_injuries   INTEGER DEFAULT 0,        -- count of OUT players
  away_injuries   INTEGER DEFAULT 0,
  rest_advantage  TEXT,                     -- e.g. "home +2 days"
  factors         JSONB,                    -- array of analysis factors

  -- Results (filled in after game)
  home_final      INTEGER,                  -- home team final score
  away_final      INTEGER,                  -- away team final score
  hit             BOOLEAN,                  -- did the pick hit?
  resolved_at     TIMESTAMPTZ,

  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX idx_game_picks_date ON game_picks (generated_date DESC);
CREATE INDEX idx_game_picks_unresolved ON game_picks (hit) WHERE hit IS NULL;
CREATE INDEX idx_game_picks_game ON game_picks (game_id, generated_date);

-- Prevent duplicate picks for same game/type/date
CREATE UNIQUE INDEX idx_game_picks_unique
  ON game_picks (generated_date, game_id, pick_type);
