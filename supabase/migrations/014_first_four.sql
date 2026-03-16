-- ============================================
-- 014: First Four (Play-in) Support
-- Expands bracket to support 67 games (63 + 4 First Four)
-- and 68 teams (64 + 4 play-in teams sharing seeds).
-- ============================================

-- Allow multiple teams per region+seed (play-in teams share seeds)
-- Drop the old unique constraint and add one that includes team_name
ALTER TABLE bracket_teams DROP CONSTRAINT IF EXISTS bracket_teams_tournament_id_seed_region_key;

-- Add is_playin flag to identify play-in teams
ALTER TABLE bracket_teams ADD COLUMN IF NOT EXISTS is_playin BOOLEAN DEFAULT FALSE;

-- New unique constraint: allow same seed in region if different teams
CREATE UNIQUE INDEX IF NOT EXISTS idx_bracket_teams_unique
  ON bracket_teams (tournament_id, region, seed, team_name);

-- Expand game_number range to include First Four games (64-67)
ALTER TABLE bracket_games DROP CONSTRAINT IF EXISTS bracket_games_game_number_check;
ALTER TABLE bracket_games ADD CONSTRAINT bracket_games_game_number_check
  CHECK (game_number BETWEEN 1 AND 67);

-- Expand round range to include round 0 (First Four)
ALTER TABLE bracket_games DROP CONSTRAINT IF EXISTS bracket_games_round_check;
ALTER TABLE bracket_games ADD CONSTRAINT bracket_games_round_check
  CHECK (round BETWEEN 0 AND 6);
