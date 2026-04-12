-- ============================================
-- 023: Cash Out — Add cashout status + payout amount
-- ============================================

-- Expand status constraint to include 'cashout'
ALTER TABLE bets DROP CONSTRAINT IF EXISTS bets_status_check;
ALTER TABLE bets ADD CONSTRAINT bets_status_check
  CHECK (status IN ('open', 'win', 'loss', 'push', 'void', 'cashout'));

-- Store the cash out payout amount (total received back, including stake)
ALTER TABLE bets ADD COLUMN IF NOT EXISTS cash_out_amount DECIMAL(8,2);

-- Update user_stats view to handle cashout in net_units calculation
CREATE OR REPLACE VIEW user_stats AS
SELECT
  u.discord_id,
  u.discord_username,
  COUNT(b.id) FILTER (WHERE b.status NOT IN ('void', 'cashout')) AS total_bets,
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
        WHEN b.status = 'cashout' THEN b.cash_out_amount - b.units
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
