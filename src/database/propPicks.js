/**
 * Database functions for prop pick tracking.
 * Stores daily recommendations and tracks results.
 */
const { supabase } = require('../config/supabase');

/**
 * Save a batch of top picks to the database.
 * Uses upsert to avoid duplicates if regenerated same day.
 */
async function savePicks(picks, direction) {
  if (!picks.length) return;

  const rows = picks.map((p, i) => ({
    generated_date: new Date().toISOString().slice(0, 10),
    player_id: p.player.id,
    player_name: p.player.name,
    team_abbr: p.teamAbbr,
    matchup: p.matchup,
    headshot_url: p.player.headshot || null,
    direction,
    stat_key: p.stat.key,
    stat_label: p.stat.label,
    prop_line: p.analysis.propLine,
    probability: direction === 'over' ? p.analysis.overProbability : p.analysis.underProbability,
    confidence: p.analysis.confidence,
    rank: i + 1,
    season_avg: p.analysis.seasonAvg,
    l5_avg: p.analysis.avg5,
    l10_avg: p.analysis.avg10,
    hit_rate_season: p.analysis.hitRateSeason,
    vs_opponent_avg: p.analysis.vsOpponent?.avg || null,
    vs_opponent_games: p.analysis.vsOpponent?.games || null,
    trending: p.analysis.trending,
    game_id: p.gameId || null,
  }));

  const { error } = await supabase
    .from('prop_picks')
    .upsert(rows, { onConflict: 'generated_date,player_id,stat_key,direction' });

  if (error) {
    console.error('[PropPicks] Save error:', error.message);
  }
}

/**
 * Get unresolved picks (no actual_value yet) for a given date.
 */
async function getUnresolvedPicks(date) {
  const { data, error } = await supabase
    .from('prop_picks')
    .select('*')
    .eq('generated_date', date)
    .is('hit', null)
    .order('direction')
    .order('rank');

  if (error) {
    console.error('[PropPicks] Get unresolved error:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Resolve a pick with actual results.
 */
async function resolvePick(pickId, actualValue) {
  // We need to fetch the pick first to calculate hit
  const { data: pick, error: fetchErr } = await supabase
    .from('prop_picks')
    .select('*')
    .eq('id', pickId)
    .single();

  if (fetchErr || !pick) return;

  const hit = pick.direction === 'over'
    ? actualValue > pick.prop_line
    : actualValue < pick.prop_line;

  const { error } = await supabase
    .from('prop_picks')
    .update({
      actual_value: actualValue,
      hit,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', pickId);

  if (error) {
    console.error('[PropPicks] Resolve error:', error.message);
  }
  return hit;
}

/**
 * Batch resolve multiple picks.
 */
async function resolvePickBatch(resolutions) {
  // resolutions = [{ pickId, actualValue }, ...]
  let resolved = 0;
  for (const { pickId, actualValue } of resolutions) {
    const hit = await resolvePick(pickId, actualValue);
    if (hit !== undefined) resolved++;
  }
  return resolved;
}

/**
 * Get accuracy stats — overall and by time period.
 */
async function getAccuracyStats() {
  // All-time resolved picks
  const { data: allResolved, error } = await supabase
    .from('prop_picks')
    .select('*')
    .not('hit', 'is', null)
    .order('generated_date', { ascending: false });

  if (error) {
    console.error('[PropPicks] Stats error:', error.message);
    return null;
  }

  if (!allResolved?.length) {
    return {
      totalPicks: 0,
      totalHits: 0,
      hitRate: 0,
      overStats: { total: 0, hits: 0, rate: 0 },
      underStats: { total: 0, hits: 0, rate: 0 },
      byConfidence: {},
      byStat: {},
      last7Days: { total: 0, hits: 0, rate: 0 },
      last30Days: { total: 0, hits: 0, rate: 0 },
      recentPicks: [],
      streak: { current: 0, type: null },
    };
  }

  const totalPicks = allResolved.length;
  const totalHits = allResolved.filter(p => p.hit).length;
  const hitRate = Math.round((totalHits / totalPicks) * 100);

  // Over vs Under
  const overs = allResolved.filter(p => p.direction === 'over');
  const unders = allResolved.filter(p => p.direction === 'under');
  const overStats = { total: overs.length, hits: overs.filter(p => p.hit).length, rate: overs.length ? Math.round((overs.filter(p => p.hit).length / overs.length) * 100) : 0 };
  const underStats = { total: unders.length, hits: unders.filter(p => p.hit).length, rate: unders.length ? Math.round((unders.filter(p => p.hit).length / unders.length) * 100) : 0 };

  // By confidence
  const byConfidence = {};
  for (const level of ['high', 'medium', 'low']) {
    const picks = allResolved.filter(p => p.confidence === level);
    byConfidence[level] = {
      total: picks.length,
      hits: picks.filter(p => p.hit).length,
      rate: picks.length ? Math.round((picks.filter(p => p.hit).length / picks.length) * 100) : 0,
    };
  }

  // By stat category
  const byStat = {};
  for (const key of ['pts', 'reb', 'ast', 'fg3']) {
    const picks = allResolved.filter(p => p.stat_key === key);
    byStat[key] = {
      total: picks.length,
      hits: picks.filter(p => p.hit).length,
      rate: picks.length ? Math.round((picks.filter(p => p.hit).length / picks.length) * 100) : 0,
    };
  }

  // Last 7 and 30 days
  const now = new Date();
  const d7 = new Date(now); d7.setDate(d7.getDate() - 7);
  const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
  const last7 = allResolved.filter(p => new Date(p.generated_date) >= d7);
  const last30 = allResolved.filter(p => new Date(p.generated_date) >= d30);

  const last7Stats = { total: last7.length, hits: last7.filter(p => p.hit).length, rate: last7.length ? Math.round((last7.filter(p => p.hit).length / last7.length) * 100) : 0 };
  const last30Stats = { total: last30.length, hits: last30.filter(p => p.hit).length, rate: last30.length ? Math.round((last30.filter(p => p.hit).length / last30.length) * 100) : 0 };

  // Current streak
  let streak = { current: 0, type: null };
  for (const pick of allResolved) {
    if (streak.type === null) {
      streak.type = pick.hit ? 'hit' : 'miss';
      streak.current = 1;
    } else if ((pick.hit && streak.type === 'hit') || (!pick.hit && streak.type === 'miss')) {
      streak.current++;
    } else {
      break;
    }
  }

  // Recent picks for display (last 20)
  const recentPicks = allResolved.slice(0, 20).map(p => ({
    date: p.generated_date,
    playerName: p.player_name,
    teamAbbr: p.team_abbr,
    matchup: p.matchup,
    direction: p.direction,
    statLabel: p.stat_label,
    statKey: p.stat_key,
    propLine: parseFloat(p.prop_line),
    probability: p.probability,
    confidence: p.confidence,
    actualValue: p.actual_value !== null ? parseFloat(p.actual_value) : null,
    hit: p.hit,
    headshot: p.headshot_url,
  }));

  return {
    totalPicks,
    totalHits,
    hitRate,
    overStats,
    underStats,
    byConfidence,
    byStat,
    last7Days: last7Stats,
    last30Days: last30Stats,
    recentPicks,
    streak,
  };
}

/**
 * Get picks for a specific date.
 */
async function getPicksByDate(date) {
  const { data, error } = await supabase
    .from('prop_picks')
    .select('*')
    .eq('generated_date', date)
    .order('direction')
    .order('rank');

  if (error) {
    console.error('[PropPicks] Get by date error:', error.message);
    return [];
  }
  return (data || []).map(p => ({
    ...p,
    prop_line: parseFloat(p.prop_line),
    season_avg: p.season_avg ? parseFloat(p.season_avg) : null,
    l5_avg: p.l5_avg ? parseFloat(p.l5_avg) : null,
    l10_avg: p.l10_avg ? parseFloat(p.l10_avg) : null,
    actual_value: p.actual_value !== null ? parseFloat(p.actual_value) : null,
    vs_opponent_avg: p.vs_opponent_avg ? parseFloat(p.vs_opponent_avg) : null,
  }));
}

module.exports = {
  savePicks,
  getUnresolvedPicks,
  resolvePick,
  resolvePickBatch,
  getAccuracyStats,
  getPicksByDate,
};
