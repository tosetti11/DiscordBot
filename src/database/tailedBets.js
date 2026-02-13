const { supabase } = require('../config/supabase');

/**
 * Add a tailed bet entry
 */
async function addTailedBet(betId, tailerDiscordId, tailed) {
  const { data, error } = await supabase
    .from('tailed_bets')
    .upsert({ bet_id: betId, tailer_discord_id: tailerDiscordId, tailed }, { onConflict: ['bet_id', 'tailer_discord_id'] })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Get a user's tail record for a specific bet
 */
async function getTailedBet(betId, tailerDiscordId) {
  const { data, error } = await supabase
    .from('tailed_bets')
    .select('*')
    .eq('bet_id', betId)
    .eq('tailer_discord_id', tailerDiscordId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Remove a tailed bet entry (toggle off)
 */
async function removeTailedBet(betId, tailerDiscordId) {
  const { error } = await supabase
    .from('tailed_bets')
    .delete()
    .eq('bet_id', betId)
    .eq('tailer_discord_id', tailerDiscordId);
  if (error) throw error;
}

/**
 * Get tailed bet stats for a user
 */
async function getTailedBetsForUser(discordId) {
  const { data, error } = await supabase
    .from('tailed_bets')
    .select('*')
    .eq('tailer_discord_id', discordId);
  if (error) throw error;
  return data || [];
}

/**
 * Get tail stats for a user (win/loss/push/net from tailed bets)
 */
async function getTailStats(discordId) {
  const { data, error } = await supabase
    .from('tailed_bets')
    .select('*, bets!inner(status, units, odds_american)')
    .eq('tailer_discord_id', discordId)
    .eq('tailed', true);

  if (error) throw error;
  if (!data || data.length === 0) return null;

  const closed = data.filter(t => ['win', 'loss', 'push'].includes(t.bets.status));
  const wins = closed.filter(t => t.bets.status === 'win').length;
  const losses = closed.filter(t => t.bets.status === 'loss').length;
  const pushes = closed.filter(t => t.bets.status === 'push').length;
  const total = data.length;
  const open = data.filter(t => t.bets.status === 'open').length;

  let netUnits = 0;
  for (const t of closed) {
    const b = t.bets;
    if (b.status === 'win') {
      netUnits += b.odds_american >= 0
        ? b.units * (b.odds_american / 100)
        : b.units * (100 / Math.abs(b.odds_american));
    } else if (b.status === 'loss') {
      netUnits -= b.units;
    }
  }

  const winPct = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0;

  return {
    total_tails: total,
    open_tails: open,
    tail_wins: wins,
    tail_losses: losses,
    tail_pushes: pushes,
    tail_win_pct: winPct,
    tail_net_units: Math.round(netUnits * 100) / 100,
  };
}

/**
 * Get tail stats for whale bets only
 */
async function getWhaleTailStats(discordId) {
  const { data, error } = await supabase
    .from('tailed_bets')
    .select('*, bets!inner(status, units, odds_american, is_whale)')
    .eq('tailer_discord_id', discordId)
    .eq('tailed', true)
    .eq('bets.is_whale', true);

  if (error) throw error;
  if (!data || data.length === 0) return null;

  const closed = data.filter(t => ['win', 'loss', 'push'].includes(t.bets.status));
  const wins = closed.filter(t => t.bets.status === 'win').length;
  const losses = closed.filter(t => t.bets.status === 'loss').length;
  const pushes = closed.filter(t => t.bets.status === 'push').length;
  const total = data.length;
  const open = data.filter(t => t.bets.status === 'open').length;

  let netUnits = 0;
  for (const t of closed) {
    const b = t.bets;
    if (b.status === 'win') {
      netUnits += b.odds_american >= 0
        ? b.units * (b.odds_american / 100)
        : b.units * (100 / Math.abs(b.odds_american));
    } else if (b.status === 'loss') {
      netUnits -= b.units;
    }
  }

  const winPct = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0;

  return {
    total_tails: total,
    open_tails: open,
    tail_wins: wins,
    tail_losses: losses,
    tail_pushes: pushes,
    tail_win_pct: winPct,
    tail_net_units: Math.round(netUnits * 100) / 100,
  };
}

module.exports = {
  addTailedBet,
  getTailedBet,
  removeTailedBet,
  getTailedBetsForUser,
  getTailStats,
  getWhaleTailStats,
};
