-- ============================================
-- 011: Matchup Context Columns for Prop Picks
-- Stores matchup adjustment data at time of pick
-- for analyzing which factors improve hit rate
-- ============================================

ALTER TABLE prop_picks ADD COLUMN IF NOT EXISTS projected_value NUMERIC(6,1);
ALTER TABLE prop_picks ADD COLUMN IF NOT EXISTS game_pace NUMERIC(5,1);
ALTER TABLE prop_picks ADD COLUMN IF NOT EXISTS pace_label TEXT;           -- fast, average, slow
ALTER TABLE prop_picks ADD COLUMN IF NOT EXISTS opp_pts_allowed NUMERIC(5,1);
ALTER TABLE prop_picks ADD COLUMN IF NOT EXISTS def_label TEXT;            -- weak defense, average defense, strong defense
ALTER TABLE prop_picks ADD COLUMN IF NOT EXISTS implied_total NUMERIC(5,1);
ALTER TABLE prop_picks ADD COLUMN IF NOT EXISTS is_b2b BOOLEAN DEFAULT FALSE;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
