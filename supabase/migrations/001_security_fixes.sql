-- =============================================
-- Security Fixes Migration
-- Run this in Supabase SQL Editor
-- Fixes all linter errors & warnings
-- =============================================

-- ===================
-- FIX 1: security_definer_view (ERROR)
-- View `user_stats` was SECURITY DEFINER (runs as view creator).
-- Recreate with security_invoker = true (runs as querying user).
-- ===================
DROP VIEW IF EXISTS user_stats;

CREATE VIEW user_stats
WITH (security_invoker = true)
AS
SELECT
  u.discord_id,
  u.discord_username,
  COUNT(b.id) FILTER (WHERE b.status != 'void') AS total_bets,
  COUNT(b.id) FILTER (WHERE b.status = 'open') AS open_bets,
  COUNT(b.id) FILTER (WHERE b.status = 'win') AS wins,
  COUNT(b.id) FILTER (WHERE b.status = 'loss') AS losses,
  COUNT(b.id) FILTER (WHERE b.status = 'push') AS pushes,
  CASE
    WHEN COUNT(b.id) FILTER (WHERE b.status IN ('win', 'loss')) > 0
    THEN ROUND(
      COUNT(b.id) FILTER (WHERE b.status = 'win')::DECIMAL /
      COUNT(b.id) FILTER (WHERE b.status IN ('win', 'loss')) * 100, 1
    )
    ELSE 0
  END AS win_pct,
  COALESCE(SUM(b.units) FILTER (WHERE b.status = 'win'), 0) AS units_won,
  COALESCE(SUM(b.units) FILTER (WHERE b.status = 'loss'), 0) AS units_lost,
  COALESCE(
    SUM(
      CASE
        WHEN b.status = 'win' THEN
          CASE
            WHEN b.odds_american >= 0 THEN b.units * (b.odds_american::DECIMAL / 100)
            ELSE b.units * (100.0 / ABS(b.odds_american))
          END
        WHEN b.status = 'loss' THEN -b.units
        ELSE 0
      END
    ), 0
  ) AS net_units
FROM users u
LEFT JOIN bets b ON u.id = b.user_id
GROUP BY u.id, u.discord_id, u.discord_username;


-- ===================
-- FIX 2: rls_disabled_in_public (ERROR)
-- Enable RLS on all tables that were missing it.
-- These are idempotent — safe to re-run.
-- ===================
ALTER TABLE web_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE tailed_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;


-- ===================
-- FIX 3: function_search_path_mutable (WARN)
-- Pin search_path so function cannot be hijacked via path manipulation.
-- ===================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;


-- ===================
-- FIX 4: rls_policy_always_true (WARN)
-- Drop overly permissive "USING (true)" policies.
-- The service_role key BYPASSES RLS entirely, so these policies
-- were never needed — they only opened access to the anon role.
-- After dropping, anon gets zero access (correct behavior).
-- ===================
DROP POLICY IF EXISTS "Service role full access" ON users;
DROP POLICY IF EXISTS "Service role full access" ON bets;
DROP POLICY IF EXISTS "Service role full access" ON parlay_legs;
DROP POLICY IF EXISTS "Service role full access" ON tailed_bets;


-- ===================
-- VERIFICATION (optional — run to confirm fixes applied)
-- ===================
-- Check RLS is enabled on all public tables:
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
--
-- Check no permissive "true" policies remain:
-- SELECT schemaname, tablename, policyname, permissive, cmd, qual
-- FROM pg_policies WHERE schemaname = 'public';
--
-- Check view is security_invoker:
-- SELECT viewname, viewowner FROM pg_views WHERE viewname = 'user_stats';
