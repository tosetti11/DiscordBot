-- Add tracker message columns to bracket_tournaments
ALTER TABLE bracket_tournaments ADD COLUMN IF NOT EXISTS tracker_message_id TEXT;
ALTER TABLE bracket_tournaments ADD COLUMN IF NOT EXISTS tracker_channel_id TEXT;
