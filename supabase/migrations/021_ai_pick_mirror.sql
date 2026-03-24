-- ============================================
-- 021: AI Pick Mirror Message Tracking
-- Adds mirror_message_id and mirror_channel_id
-- for cross-posting AI picks to AI Open Slips.
-- ============================================

ALTER TABLE ai_picks ADD COLUMN IF NOT EXISTS mirror_message_id TEXT;
ALTER TABLE ai_picks ADD COLUMN IF NOT EXISTS mirror_channel_id TEXT;
