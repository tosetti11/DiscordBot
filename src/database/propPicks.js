/**
 * Database functions for prop pick tracking.
 * Stores daily recommendations and tracks results.
 */
const { supabase } = require('../config/supabase');

/**
 * Get today's date in Eastern time (matches ESPN's game date).
 * Returns 'YYYY-MM-DD' string.
 */
function getEasternDate(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/**
 * Save a batch of top picks to the database.
 * Uses upsert to avoid duplicates if regenerated same day.
 */
async function savePicks(picks, direction) {
  if (!picks.length) return;

  const rows = picks.map((p, i) => ({
    generated_date: getEasternDate(),
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
    volatility: p.analysis.volatility ?? null,
    volatility_label: p.analysis.volatilityLabel || null,
    game_id: p.gameId || null,
    // Matchup context
    projected_value: p.analysis.projectedValue ?? null,
    game_pace: p.analysis.matchup?.gamePace ?? null,
    pace_label: p.analysis.matchup?.paceLabel || null,
    opp_pts_allowed: p.analysis.matchup?.oppPtsAllowed ?? null,
    def_label: p.analysis.matchup?.defLabel || null,
    implied_total: p.analysis.matchup?.impliedTotal ?? null,
    is_b2b: p.analysis.matchup?.isB2B ?? false,
    // Injury context
    injury_impact: p.analysis.injuryImpact ? JSON.stringify(p.analysis.injuryImpact) : null,
  }));

  const { error } = await supabase
    .from('prop_picks')
    .upsert(rows, { onConflict: 'generated_date,player_id,stat_key,direction' });

  if (error) {
    // If injury_impact column doesn't exist yet, retry without it
    if (error.message && error.message.includes('injury_impact')) {
      console.warn('[PropPicks] injury_impact column not found, saving without it');
      const fallbackRows = rows.map(({ injury_impact, ...rest }) => rest);
      const { error: e2 } = await supabase
        .from('prop_picks')
        .upsert(fallbackRows, { onConflict: 'generated_date,player_id,stat_key,direction' });
      if (e2) console.error('[PropPicks] Fallback save error:', e2.message);
    } else {
      console.error('[PropPicks] Save error:', error.message);
    }
  }
}

/**
 * Get unresolved picks (no actual_value yet, not DNP) for a given date.
 */
async function getUnresolvedPicks(date) {
  const { data, error } = await supabase
    .from('prop_picks')
    .select('*')
    .eq('generated_date', date)
    .is('hit', null)
    .or('dnp.is.null,dnp.eq.false')
    .order('direction')
    .order('rank');

  if (error) {
    console.error('[PropPicks] Get unresolved error:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Resolve a pick with actual results, or mark as DNP.
 */
async function resolvePick(pickId, actualValue, dnp = false) {
  if (dnp) {
    // DNP — void this pick, don't count in stats
    const { error } = await supabase
      .from('prop_picks')
      .update({
        dnp: true,
        actual_value: null,
        hit: null,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', pickId);

    if (error) console.error('[PropPicks] DNP mark error:', error.message);
    return undefined; // not a hit or miss
  }

  // Normal resolution
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
      dnp: false,
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
  // resolutions = [{ pickId, actualValue, dnp }, ...]
  let resolved = 0;
  let dnpCount = 0;
  for (const { pickId, actualValue, dnp } of resolutions) {
    if (dnp) {
      await resolvePick(pickId, null, true);
      dnpCount++;
      resolved++;
    } else {
      const hit = await resolvePick(pickId, actualValue, false);
      if (hit !== undefined) resolved++;
    }
  }
  return { resolved, dnpCount };
}

/**
 * Get comprehensive accuracy stats for the model analytics dashboard.
 */
async function getAccuracyStats() {
  const { data: allResolved, error } = await supabase
    .from('prop_picks')
    .select('*')
    .not('hit', 'is', null)
    .or('dnp.is.null,dnp.eq.false')
    .order('generated_date', { ascending: false });

  if (error) {
    console.error('[PropPicks] Stats error:', error.message);
    return null;
  }

  const empty = {
    totalPicks: 0, totalHits: 0, hitRate: 0,
    overStats: { total: 0, hits: 0, rate: 0 },
    underStats: { total: 0, hits: 0, rate: 0 },
    byConfidence: {}, byStat: {}, byProbBucket: {},
    byVolatility: {}, byMatchup: {},
    last7Days: { total: 0, hits: 0, rate: 0 },
    last30Days: { total: 0, hits: 0, rate: 0 },
    dailyLog: [], streak: { current: 0, type: null },
    roi: { units: 0, wagers: 0, pct: 0 },
    calibration: [],
  };

  if (!allResolved?.length) return empty;

  const calc = (picks) => {
    const t = picks.length, h = picks.filter(p => p.hit).length;
    return { total: t, hits: h, misses: t - h, rate: t ? Math.round((h / t) * 100) : 0 };
  };

  const totalPicks = allResolved.length;
  const totalHits = allResolved.filter(p => p.hit).length;
  const hitRate = Math.round((totalHits / totalPicks) * 100);

  // Over vs Under
  const overStats = calc(allResolved.filter(p => p.direction === 'over'));
  const underStats = calc(allResolved.filter(p => p.direction === 'under'));

  // By confidence
  const byConfidence = {};
  for (const level of ['high', 'medium', 'low']) {
    byConfidence[level] = calc(allResolved.filter(p => p.confidence === level));
  }

  // By stat category
  const byStat = {};
  const statLabels = { pts: 'Points', reb: 'Rebounds', ast: 'Assists', fg3: '3-Pointers' };
  for (const key of ['pts', 'reb', 'ast', 'fg3']) {
    const s = calc(allResolved.filter(p => p.stat_key === key));
    s.label = statLabels[key];
    byStat[key] = s;
  }

  // By probability bucket
  const byProbBucket = {};
  const buckets = [
    { key: '50-55', min: 50, max: 55, label: '50-55%' },
    { key: '55-60', min: 55, max: 60, label: '55-60%' },
    { key: '60-65', min: 60, max: 65, label: '60-65%' },
    { key: '65-70', min: 65, max: 70, label: '65-70%' },
    { key: '70+', min: 70, max: 101, label: '70%+' },
  ];
  for (const b of buckets) {
    const picks = allResolved.filter(p => p.probability >= b.min && p.probability < b.max);
    if (picks.length) byProbBucket[b.key] = { ...calc(picks), label: b.label };
  }

  // By volatility tier
  const byVolatility = {};
  const volTiers = [
    { key: 'very-stable', min: 0, max: 0.15, label: '🔒 Very Stable' },
    { key: 'stable', min: 0.15, max: 0.30, label: '🟢 Stable' },
    { key: 'moderate', min: 0.30, max: 0.50, label: '🟡 Moderate' },
    { key: 'high', min: 0.50, max: 2.0, label: '⚠️ High Vol' },
  ];
  for (const t of volTiers) {
    const picks = allResolved.filter(p => p.volatility !== null && parseFloat(p.volatility) >= t.min && parseFloat(p.volatility) < t.max);
    if (picks.length) byVolatility[t.key] = { ...calc(picks), label: t.label };
  }

  // By matchup factors
  const byMatchup = {};
  // Pace
  const fastPace = allResolved.filter(p => p.pace_label === 'fast');
  const slowPace = allResolved.filter(p => p.pace_label === 'slow');
  const avgPace = allResolved.filter(p => p.pace_label === 'average');
  if (fastPace.length) byMatchup.fastPace = { ...calc(fastPace), label: '🏃 Fast Pace' };
  if (slowPace.length) byMatchup.slowPace = { ...calc(slowPace), label: '🐢 Slow Pace' };
  if (avgPace.length) byMatchup.avgPace = { ...calc(avgPace), label: '⚖️ Avg Pace' };
  // Defense
  const weakDef = allResolved.filter(p => p.def_label === 'weak defense');
  const strongDef = allResolved.filter(p => p.def_label === 'strong defense');
  const avgDef = allResolved.filter(p => p.def_label === 'average defense');
  if (weakDef.length) byMatchup.weakDef = { ...calc(weakDef), label: '🎯 Weak Defense' };
  if (strongDef.length) byMatchup.strongDef = { ...calc(strongDef), label: '🛡️ Strong Defense' };
  if (avgDef.length) byMatchup.avgDef = { ...calc(avgDef), label: '⚖️ Avg Defense' };
  // B2B
  const b2b = allResolved.filter(p => p.is_b2b === true);
  const nonB2B = allResolved.filter(p => p.is_b2b === false || p.is_b2b === null);
  if (b2b.length) byMatchup.b2b = { ...calc(b2b), label: '⚠️ Back-to-Back' };
  if (nonB2B.length) byMatchup.nonB2B = { ...calc(nonB2B), label: '✅ Rested' };

  // Time periods
  const now = new Date();
  const d7 = new Date(now); d7.setDate(d7.getDate() - 7);
  const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
  const last7 = allResolved.filter(p => new Date(p.generated_date) >= d7);
  const last30 = allResolved.filter(p => new Date(p.generated_date) >= d30);
  const last7Stats = calc(last7);
  const last30Stats = calc(last30);

  // Current streak
  let streak = { current: 0, type: null };
  for (const pick of allResolved) {
    if (streak.type === null) {
      streak.type = pick.hit ? 'hit' : 'miss';
      streak.current = 1;
    } else if ((pick.hit && streak.type === 'hit') || (!pick.hit && streak.type === 'miss')) {
      streak.current++;
    } else break;
  }

  // ROI calculation (assuming flat 1-unit bets at -110)
  // Win = +0.909 units, Loss = -1 unit
  let unitsResult = 0;
  const wagers = allResolved.length;
  for (const p of allResolved) {
    unitsResult += p.hit ? 0.909 : -1;
  }
  const roi = {
    units: Math.round(unitsResult * 100) / 100,
    wagers,
    pct: wagers ? Math.round((unitsResult / wagers) * 10000) / 100 : 0,
  };

  // Calibration: for each probability bucket, are predicted % matching actual %?
  const calibration = buckets.map(b => {
    const picks = allResolved.filter(p => p.probability >= b.min && p.probability < b.max);
    if (!picks.length) return null;
    const actualHitRate = Math.round((picks.filter(p => p.hit).length / picks.length) * 100);
    const avgPredicted = Math.round(picks.reduce((s, p) => s + p.probability, 0) / picks.length);
    return { bucket: b.label, predicted: avgPredicted, actual: actualHitRate, count: picks.length };
  }).filter(Boolean);

  // Daily log: per-day W/L for chart
  const dailyMap = {};
  for (const p of allResolved) {
    const d = p.generated_date;
    if (!dailyMap[d]) dailyMap[d] = { date: d, total: 0, hits: 0 };
    dailyMap[d].total++;
    if (p.hit) dailyMap[d].hits++;
  }
  const dailyLog = Object.values(dailyMap)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({ ...d, rate: Math.round((d.hits / d.total) * 100) }));

  return {
    totalPicks, totalHits, hitRate,
    overStats, underStats,
    byConfidence, byStat, byProbBucket,
    byVolatility, byMatchup,
    last7Days: last7Stats, last30Days: last30Stats,
    dailyLog, streak, roi, calibration,
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

/**
 * Get all picks grouped by date, with daily stats.
 * Returns an array of day objects sorted newest-first.
 */
async function getDailyHistory() {
  const { data, error } = await supabase
    .from('prop_picks')
    .select('*')
    .order('generated_date', { ascending: false })
    .order('direction')
    .order('rank');

  if (error) {
    console.error('[PropPicks] Daily history error:', error.message);
    return [];
  }

  if (!data || !data.length) return [];

  // Group by date
  const byDate = {};
  for (const p of data) {
    const d = p.generated_date;
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push({
      id: p.id,
      playerName: p.player_name,
      playerId: p.player_id,
      teamAbbr: p.team_abbr,
      matchup: p.matchup,
      headshot: p.headshot_url,
      direction: p.direction,
      statKey: p.stat_key,
      statLabel: p.stat_label,
      propLine: parseFloat(p.prop_line),
      probability: p.probability,
      confidence: p.confidence,
      rank: p.rank,
      seasonAvg: p.season_avg ? parseFloat(p.season_avg) : null,
      l5Avg: p.l5_avg ? parseFloat(p.l5_avg) : null,
      l10Avg: p.l10_avg ? parseFloat(p.l10_avg) : null,
      hitRateSeason: p.hit_rate_season ? parseFloat(p.hit_rate_season) : null,
      vsOpponentAvg: p.vs_opponent_avg ? parseFloat(p.vs_opponent_avg) : null,
      vsOpponentGames: p.vs_opponent_games,
      trending: p.trending,
      volatility: p.volatility ? parseFloat(p.volatility) : null,
      volatilityLabel: p.volatility_label || null,
      // Matchup context
      projectedValue: p.projected_value ? parseFloat(p.projected_value) : null,
      gamePace: p.game_pace ? parseFloat(p.game_pace) : null,
      paceLabel: p.pace_label || null,
      oppPtsAllowed: p.opp_pts_allowed ? parseFloat(p.opp_pts_allowed) : null,
      defLabel: p.def_label || null,
      impliedTotal: p.implied_total ? parseFloat(p.implied_total) : null,
      isB2B: p.is_b2b || false,
      actualValue: p.actual_value !== null ? parseFloat(p.actual_value) : null,
      hit: p.hit,
      dnp: p.dnp === true,
      gameId: p.game_id,
    });
  }

  // Build array with daily stats (exclude DNPs from counts)
  const days = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  return days.map(date => {
    const picks = byDate[date];
    const activePicks = picks.filter(p => !p.dnp);
    const dnpPicks = picks.filter(p => p.dnp);
    const resolved = activePicks.filter(p => p.hit !== null);
    const hits = resolved.filter(p => p.hit === true);
    return {
      date,
      picks,
      total: activePicks.length,
      resolved: resolved.length,
      hits: hits.length,
      misses: resolved.length - hits.length,
      hitRate: resolved.length ? Math.round((hits.length / resolved.length) * 100) : null,
      pending: activePicks.length - resolved.length,
      dnps: dnpPicks.length,
    };
  });
}

module.exports = {
  savePicks,
  getUnresolvedPicks,
  resolvePick,
  resolvePickBatch,
  getAccuracyStats,
  getPicksByDate,
  getDailyHistory,
};
