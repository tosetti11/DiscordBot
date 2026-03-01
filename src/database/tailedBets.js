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

/**
 * Get unique tailer discord IDs for a specific guild (scoped via bets table)
 */
async function getTailersInGuild(guildId) {
  const { data, error } = await supabase
    .from('tailed_bets')
    .select('tailer_discord_id, bets!inner(guild_id)')
    .eq('bets.guild_id', guildId)
    .eq('tailed', true);

  if (error) throw error;
  if (!data || data.length === 0) return [];

  const uniqueIds = [...new Set(data.map(t => t.tailer_discord_id))];
  return uniqueIds;
}

/**
 * Get tail stats for a user scoped to a specific guild
 * Returns full stats matching the user bet section layout
 */
async function getTailStatsInGuild(discordId, guildId) {
  const { data, error } = await supabase
    .from('tailed_bets')
    .select('*, bets!inner(status, units, odds_american, guild_id, pick, sport, created_at)')
    .eq('tailer_discord_id', discordId)
    .eq('tailed', true)
    .eq('bets.guild_id', guildId);

  if (error) throw error;
  if (!data || data.length === 0) return null;

  const total = data.length;
  const open = data.filter(t => t.bets.status === 'open').length;
  const closed = data.filter(t => ['win', 'loss', 'push'].includes(t.bets.status));
  const wins = closed.filter(t => t.bets.status === 'win').length;
  const losses = closed.filter(t => t.bets.status === 'loss').length;
  const pushes = closed.filter(t => t.bets.status === 'push').length;
  const winPct = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0;

  let netUnits = 0;
  let unitsWagered = 0;
  for (const t of closed) {
    const b = t.bets;
    unitsWagered += Number(b.units);
    if (b.status === 'win') {
      netUnits += b.odds_american >= 0
        ? b.units * (b.odds_american / 100)
        : b.units * (100 / Math.abs(b.odds_american));
    } else if (b.status === 'loss') {
      netUnits -= Number(b.units);
    }
  }
  netUnits = Math.round(netUnits * 100) / 100;
  unitsWagered = Math.round(unitsWagered * 100) / 100;
  const roi = unitsWagered > 0 ? Math.round((netUnits / unitsWagered) * 1000) / 10 : 0;

  // Avg odds (convert to decimal, average, convert back to American)
  const allOdds = data.filter(t => t.bets.odds_american).map(t => t.bets.odds_american);
  let avgOdds = 0;
  if (allOdds.length > 0) {
    const decArr = allOdds.map(o => o >= 0 ? (o / 100) + 1 : (100 / Math.abs(o)) + 1);
    const avgDec = decArr.reduce((a, b) => a + b, 0) / decArr.length;
    avgOdds = avgDec >= 2 ? Math.round((avgDec - 1) * 100) : Math.round(-100 / (avgDec - 1));
  }

  // Avg units
  const allUnits = data.map(t => Number(t.bets.units));
  const avgUnits = allUnits.length > 0 ? Math.round((allUnits.reduce((a, b) => a + b, 0) / allUnits.length) * 100) / 100 : 0;

  // Streak (most recent closed first)
  const closedSorted = data
    .filter(t => ['win', 'loss'].includes(t.bets.status))
    .sort((a, b) => new Date(b.bets.created_at) - new Date(a.bets.created_at));
  let streakCount = 0;
  let streakType = '';
  if (closedSorted.length > 0) {
    streakType = closedSorted[0].bets.status;
    for (const t of closedSorted) {
      if (t.bets.status === streakType) streakCount++;
      else break;
    }
  }

  // Best / worst bet
  let bestBet = null, worstBet = null;
  for (const t of closed.filter(t => ['win', 'loss'].includes(t.bets.status))) {
    const b = t.bets;
    let payout = 0;
    if (b.status === 'win') {
      payout = b.odds_american >= 0
        ? b.units * (b.odds_american / 100)
        : b.units * (100 / Math.abs(b.odds_american));
    } else {
      payout = -b.units;
    }
    payout = Math.round(payout * 100) / 100;
    const pickLabel = b.pick || (b.bet_type === 'parlay' ? `${(b.parlay_legs || []).length}-Leg Parlay` : b.slip_number || 'Bet');
    if (!bestBet || payout > bestBet.payout) bestBet = { pick: pickLabel, payout, odds: b.odds_american, units: b.units, sport: b.sport };
    if (!worstBet || payout < worstBet.payout) worstBet = { pick: pickLabel, payout, odds: b.odds_american, units: b.units, sport: b.sport };
  }

  return {
    total_tails: total,
    open_tails: open,
    tail_wins: wins,
    tail_losses: losses,
    tail_pushes: pushes,
    tail_win_pct: winPct,
    tail_net_units: netUnits,
    tail_units_wagered: unitsWagered,
    tail_roi: roi,
    tail_avg_odds: avgOdds,
    tail_avg_units: avgUnits,
    tail_streak: { count: streakCount, type: streakType },
    tail_best_bet: bestBet,
    tail_worst_bet: worstBet,
  };
}

module.exports = {
  addTailedBet,
  getTailedBet,
  removeTailedBet,
  getTailedBetsForUser,
  getTailStats,
  getWhaleTailStats,
  getTailersInGuild,
  getTailStatsInGuild,
};
