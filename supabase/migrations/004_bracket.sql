-- ============================================
-- March Madness Bracket Challenge
-- Migration 004
-- ============================================

-- Email-only users (non-Discord bracket participants)
CREATE TABLE IF NOT EXISTS bracket_email_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tournament configuration
CREATE TABLE IF NOT EXISTS bracket_tournaments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  year INTEGER NOT NULL DEFAULT 2026,
  entry_fee DECIMAL(10,2) DEFAULT 0,
  prize_description TEXT,
  status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'open', 'locked', 'active', 'completed')),
  scoring JSONB NOT NULL DEFAULT '{"1":1,"2":2,"3":4,"4":8,"5":16,"6":32}',
  lock_date TIMESTAMPTZ,
  venmo_username TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 64 teams per tournament
CREATE TABLE IF NOT EXISTS bracket_teams (
  id SERIAL PRIMARY KEY,
  tournament_id UUID REFERENCES bracket_tournaments(id) ON DELETE CASCADE,
  seed INTEGER NOT NULL CHECK (seed BETWEEN 1 AND 16),
  region TEXT NOT NULL CHECK (region IN ('East', 'West', 'South', 'Midwest')),
  team_name TEXT NOT NULL,
  short_name TEXT,
  abbreviation TEXT,
  logo_url TEXT,
  espn_team_id TEXT,
  is_eliminated BOOLEAN DEFAULT FALSE,
  UNIQUE(tournament_id, seed, region)
);

-- 63 games per tournament (actual results)
CREATE TABLE IF NOT EXISTS bracket_games (
  id SERIAL PRIMARY KEY,
  tournament_id UUID REFERENCES bracket_tournaments(id) ON DELETE CASCADE,
  game_number INTEGER NOT NULL CHECK (game_number BETWEEN 1 AND 63),
  round INTEGER NOT NULL CHECK (round BETWEEN 1 AND 6),
  region TEXT,
  top_team_id INTEGER REFERENCES bracket_teams(id),
  bottom_team_id INTEGER REFERENCES bracket_teams(id),
  winner_id INTEGER REFERENCES bracket_teams(id),
  top_score INTEGER,
  bottom_score INTEGER,
  espn_game_id TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'live', 'final')),
  game_time TIMESTAMPTZ,
  UNIQUE(tournament_id, game_number)
);

-- One bracket entry per participant per tournament
CREATE TABLE IF NOT EXISTS bracket_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tournament_id UUID REFERENCES bracket_tournaments(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  email_user_id UUID REFERENCES bracket_email_users(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  email TEXT,
  auth_type TEXT NOT NULL DEFAULT 'discord' CHECK (auth_type IN ('discord', 'email')),
  picks JSONB DEFAULT '{}',
  tiebreaker INTEGER,
  score INTEGER DEFAULT 0,
  max_possible INTEGER DEFAULT 192,
  correct_picks INTEGER DEFAULT 0,
  paid BOOLEAN DEFAULT FALSE,
  paid_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bracket_teams_tourn ON bracket_teams(tournament_id);
CREATE INDEX IF NOT EXISTS idx_bracket_games_tourn ON bracket_games(tournament_id);
CREATE INDEX IF NOT EXISTS idx_bracket_entries_tourn ON bracket_entries(tournament_id);
CREATE INDEX IF NOT EXISTS idx_bracket_entries_user ON bracket_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_bracket_entries_email ON bracket_entries(email_user_id);
CREATE INDEX IF NOT EXISTS idx_bracket_email_users_email ON bracket_email_users(email);
