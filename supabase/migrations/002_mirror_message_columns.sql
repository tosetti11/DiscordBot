-- Add mirror message columns for open bets channels
ALTER TABLE bets ADD COLUMN IF NOT EXISTS mirror_message_id TEXT;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS mirror_channel_id TEXT;
