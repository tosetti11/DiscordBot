/**
 * Database functions for game pick tracking (ML, Spread, O/U).
 * Stores daily recommendations and tracks actual results.
 */
const { supabase } = require('../config/supabase');

/**
 * Get today's date in Eastern time (matches ESPN's game date).
 */
function getEasternDate(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/**
 * Save a batch of game picks to the database.
 * Uses upsert to avoid duplicates if regenerated same day.
 *
 * @param {Array} picks - Array of pick objects from generateTopGamePicks()
 * @param {string} pickType - 'ml', 'spread', or 'ou'
 */
async function savePicks(picks, pickType) {
  if (!picks.length) return;

  const rows = picks.map((p, i) => {
    const row = {
      generated_date: getEasternDate(),
      game_id: p.game.id,
      game_name: p.game.name,
      start_time: p.game.startTime || null,
      home_team: p.game.home.abbreviation,
      away_team: p.game.away.abbreviation,
      home_logo: p.game.home.logo || null,
      away_logo: p.game.away.logo || null,
      pick_type: pickType,
      pick: p.pick,
      pick_team: p.pickTeam || null,
      pick_direction: p.pickDirection || null,
      line: p.line != null ? p.line : null,
      probability: p.probability,
      confidence: p.confidence,
      rank: i + 1,
      home_power: p.homeAnalysis?.power ?? null,
      away_power: p.awayAnalysis?.power ?? null,
      home_record: p.homeAnalysis?.record || null,
      away_record: p.awayAnalysis?.record || null,
      home_form: p.homeAnalysis?.recentForm
        ? `${p.homeAnalysis.recentForm.wins}-${p.homeAnalysis.recentForm.losses}`
        : null,
      away_form: p.awayAnalysis?.recentForm
        ? `${p.awayAnalysis.recentForm.wins}-${p.awayAnalysis.recentForm.losses}`
        : null,
      projected_margin: p.projectedMargin ?? null,
      projected_total: p.projectedTotal ?? null,
      home_injuries: p.homeAnalysis?.injuries?.length ?? 0,
      away_injuries: p.awayAnalysis?.injuries?.length ?? 0,
      rest_advantage: _buildRestLabel(p.homeAnalysis, p.awayAnalysis),
      factors: p.factors ? JSON.stringify(p.factors) : null,
    };
    return row;
  });

  const { error } = await supabase
    .from('game_picks')
    .upsert(rows, { onConflict: 'generated_date,game_id,pick_type' });

  if (error) {
    console.error('[GamePicks DB] Save error:', error.message);
  }
}

function _buildRestLabel(homeAnalysis, awayAnalysis) {
  if (!homeAnalysis || !awayAnalysis) return null;
  const hDays = homeAnalysis.rest;
  const aDays = awayAnalysis.rest;
  if (hDays == null || aDays == null) return null;
  if (homeAnalysis.isB2B && !awayAnalysis.isB2B) return 'Home B2B';
  if (!homeAnalysis.isB2B && awayAnalysis.isB2B) return 'Away B2B';
  if (hDays === aDays) return 'Even rest';
  const diff = hDays - aDays;
  return diff > 0 ? `Home +${diff} days` : `Away +${Math.abs(diff)} days`;
}

/**
 * Get unresolved picks (hit IS NULL) for a given date.
 */
async function getUnresolvedPicks(date) {
  const { data, error } = await supabase
    .from('game_picks')
    .select('*')
    .eq('generated_date', date)
    .is('hit', null)
    .order('pick_type')
    .order('rank');

  if (error) {
    console.error('[GamePicks DB] Get unresolved error:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Resolve a single pick with final scores.
 */
async function resolvePick(pickId, homeScore, awayScore) {
  // Fetch the pick to determine if it hit
  const { data: pick, error: fetchErr } = await supabase
    .from('game_picks')
    .select('*')
    .eq('id', pickId)
    .single();

  if (fetchErr || !pick) return undefined;

  const hit = _didPickHit(pick, homeScore, awayScore);

  const { error } = await supabase
    .from('game_picks')
    .update({
      home_final: homeScore,
      away_final: awayScore,
      hit,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', pickId);

  if (error) {
    console.error('[GamePicks DB] Resolve error:', error.message);
  }
  return hit;
}

/**
 * Determine if a pick hit based on final scores.
 */
function _didPickHit(pick, homeScore, awayScore) {
  const margin = homeScore - awayScore; // positive = home won

  switch (pick.pick_type) {
    case 'ml': {
      // ML pick: did the picked team win?
      if (pick.pick_team === 'home') return homeScore > awayScore;
      if (pick.pick_team === 'away') return awayScore > homeScore;
      return false;
    }
    case 'spread': {
      // Spread pick: did the picked side cover?
      // pick.line = homeSpread (e.g. -5.5 if home is favored)
      const homeSpread = parseFloat(pick.line);
      const homePlusCover = homeScore + homeSpread; // e.g. 100 + (-5.5) = 94.5
      if (pick.pick_team === 'home') return homePlusCover > awayScore;
      if (pick.pick_team === 'away') return homePlusCover < awayScore;
      return false;
    }
    case 'ou': {
      // O/U pick: did the total go over or under the line?
      const total = homeScore + awayScore;
      const ouLine = parseFloat(pick.line);
      if (pick.pick_direction === 'over') return total > ouLine;
      if (pick.pick_direction === 'under') return total < ouLine;
      return false;
    }
    default:
      return false;
  }
}

/**
 * Batch resolve multiple picks.
 */
async function resolvePickBatch(resolutions) {
  // resolutions = [{ pickId, homeScore, awayScore }, ...]
  let resolved = 0;
  for (const { pickId, homeScore, awayScore } of resolutions) {
    const hit = await resolvePick(pickId, homeScore, awayScore);
    if (hit !== undefined) resolved++;
  }
  return { resolved };
}

/**
 * Get comprehensive accuracy stats for game picks analytics.
 */
async function getAccuracyStats() {
  const { data: allResolved, error } = await supabase
    .from('game_picks')
    .select('*')
    .not('hit', 'is', null)
    .order('generated_date', { ascending: false });

  if (error) {
    console.error('[GamePicks DB] Stats error:', error.message);
    return null;
  }

  const empty = {
    totalPicks: 0, totalHits: 0, hitRate: 0,
    mlStats: { total: 0, hits: 0, rate: 0 },
    spreadStats: { total: 0, hits: 0, rate: 0 },
    ouStats: { total: 0, hits: 0, rate: 0 },
    byConfidence: {},
    byProbBucket: {},
    last7Days: { total: 0, hits: 0, rate: 0 },
    last30Days: { total: 0, hits: 0, rate: 0 },
    dailyLog: [],
    streak: { current: 0, type: null },
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

  // By pick type
  const mlStats = calc(allResolved.filter(p => p.pick_type === 'ml'));
  const spreadStats = calc(allResolved.filter(p => p.pick_type === 'spread'));
  const ouStats = calc(allResolved.filter(p => p.pick_type === 'ou'));

  // By confidence
  const byConfidence = {};
  for (const level of ['high', 'medium', 'low']) {
    byConfidence[level] = calc(allResolved.filter(p => p.confidence === level));
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

  // ROI (flat 1-unit bets at -110: win +0.909, loss -1)
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

  // Calibration
  const calibration = buckets.map(b => {
    const picks = allResolved.filter(p => p.probability >= b.min && p.probability < b.max);
    if (!picks.length) return null;
    const actualHitRate = Math.round((picks.filter(p => p.hit).length / picks.length) * 100);
    const avgPredicted = Math.round(picks.reduce((s, p) => s + p.probability, 0) / picks.length);
    return { bucket: b.label, predicted: avgPredicted, actual: actualHitRate, count: picks.length };
  }).filter(Boolean);

  // Daily log
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
    mlStats, spreadStats, ouStats,
    byConfidence, byProbBucket,
    last7Days: last7Stats, last30Days: last30Stats,
    dailyLog, streak, roi, calibration,
  };
}

/**
 * Get picks for a specific date.
 */
async function getPicksByDate(date) {
  const { data, error } = await supabase
    .from('game_picks')
    .select('*')
    .eq('generated_date', date)
    .order('pick_type')
    .order('rank');

  if (error) {
    console.error('[GamePicks DB] Get by date error:', error.message);
    return [];
  }
  return (data || []).map(p => ({
    ...p,
    line: p.line != null ? parseFloat(p.line) : null,
    home_power: p.home_power ? parseFloat(p.home_power) : null,
    away_power: p.away_power ? parseFloat(p.away_power) : null,
    projected_margin: p.projected_margin ? parseFloat(p.projected_margin) : null,
    projected_total: p.projected_total ? parseFloat(p.projected_total) : null,
    factors: typeof p.factors === 'string' ? JSON.parse(p.factors) : (p.factors || []),
  }));
}

/**
 * Get all picks grouped by date, with daily stats.
 */
async function getDailyHistory() {
  const { data, error } = await supabase
    .from('game_picks')
    .select('*')
    .order('generated_date', { ascending: false })
    .order('pick_type')
    .order('rank');

  if (error) {
    console.error('[GamePicks DB] Daily history error:', error.message);
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
      gameId: p.game_id,
      gameName: p.game_name,
      startTime: p.start_time,
      homeTeam: p.home_team,
      awayTeam: p.away_team,
      homeLogo: p.home_logo,
      awayLogo: p.away_logo,
      pickType: p.pick_type,
      pick: p.pick,
      pickTeam: p.pick_team,
      pickDirection: p.pick_direction,
      line: p.line != null ? parseFloat(p.line) : null,
      probability: p.probability,
      confidence: p.confidence,
      rank: p.rank,
      homePower: p.home_power ? parseFloat(p.home_power) : null,
      awayPower: p.away_power ? parseFloat(p.away_power) : null,
      homeRecord: p.home_record,
      awayRecord: p.away_record,
      homeForm: p.home_form,
      awayForm: p.away_form,
      projectedMargin: p.projected_margin ? parseFloat(p.projected_margin) : null,
      projectedTotal: p.projected_total ? parseFloat(p.projected_total) : null,
      homeInjuries: p.home_injuries,
      awayInjuries: p.away_injuries,
      restAdvantage: p.rest_advantage,
      factors: typeof p.factors === 'string' ? JSON.parse(p.factors) : (p.factors || []),
      homeFinal: p.home_final,
      awayFinal: p.away_final,
      hit: p.hit,
    });
  }

  // Build array with daily stats
  const days = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  return days.map(date => {
    const picks = byDate[date];
    const resolved = picks.filter(p => p.hit !== null);
    const hits = resolved.filter(p => p.hit === true);
    const mlPicks = picks.filter(p => p.pickType === 'ml');
    const spreadPicks = picks.filter(p => p.pickType === 'spread');
    const ouPicks = picks.filter(p => p.pickType === 'ou');
    return {
      date,
      picks,
      total: picks.length,
      resolved: resolved.length,
      hits: hits.length,
      misses: resolved.length - hits.length,
      hitRate: resolved.length ? Math.round((hits.length / resolved.length) * 100) : null,
      pending: picks.length - resolved.length,
      mlCount: mlPicks.length,
      spreadCount: spreadPicks.length,
      ouCount: ouPicks.length,
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
