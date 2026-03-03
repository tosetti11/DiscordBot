-- ============================================
-- Email verification + password reset
-- Migration 006
-- Adds verification and reset fields to bracket_email_users
-- ============================================

ALTER TABLE bracket_email_users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE bracket_email_users ADD COLUMN IF NOT EXISTS verification_token TEXT;
ALTER TABLE bracket_email_users ADD COLUMN IF NOT EXISTS reset_token TEXT;
ALTER TABLE bracket_email_users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ;
