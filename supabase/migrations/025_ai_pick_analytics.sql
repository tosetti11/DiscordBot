ALTER TABLE ai_picks
  ADD COLUMN IF NOT EXISTS analytics_source TEXT,
  ADD COLUMN IF NOT EXISTS model_win_probability NUMERIC,
  ADD COLUMN IF NOT EXISTS market_implied_probability NUMERIC,
  ADD COLUMN IF NOT EXISTS model_edge NUMERIC,
  ADD COLUMN IF NOT EXISTS selection_score NUMERIC,
  ADD COLUMN IF NOT EXISTS analytics_1 TEXT,
  ADD COLUMN IF NOT EXISTS analytics_2 TEXT,
  ADD COLUMN IF NOT EXISTS analytics_3 TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_picks_selection_score ON ai_picks(selection_score DESC);