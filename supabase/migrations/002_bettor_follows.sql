-- Follow system: users can follow bettors and get DM notifications when they post new bets
CREATE TABLE IF NOT EXISTS bettor_follows (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  follower_discord_id text NOT NULL,
  bettor_discord_id text NOT NULL,
  guild_id text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(follower_discord_id, bettor_discord_id, guild_id)
);

-- Index for fast lookup when a bettor posts a new bet
CREATE INDEX idx_bettor_follows_bettor ON bettor_follows (bettor_discord_id, guild_id);

-- Index for listing who a user follows
CREATE INDEX idx_bettor_follows_follower ON bettor_follows (follower_discord_id, guild_id);
