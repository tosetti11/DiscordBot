-- ============================================
-- 015: Reminder links + multi-channel support
-- Adds links (JSONB array) and channel_ids (JSONB array)
-- ============================================

-- Links array for reminders (clickable URLs in Discord embeds)
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS links JSONB DEFAULT '[]'::jsonb;

-- Multiple channel IDs (allows sending one reminder to multiple channels)
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS channel_ids JSONB DEFAULT '[]'::jsonb;
