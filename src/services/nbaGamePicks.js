/**
 * NBA Game Picks Analysis Service
 * Generates Moneyline, Spread, and Over/Under recommendations
 * using ESPN data only (free, unlimited, no API key needed).
 *
 * Analyzes: team records, home/away splits, recent form (L10),
 * scoring trends, pace matchups, injuries, rest advantage,
 * and head-to-head history.
 */

// ── Cache ──
const cache = new Map();
const CACHE_TTL = 5 * 60_000;       // 5 min for general data
const LONG_CACHE_TTL = 30 * 60_000;  // 30 min for season-level data

function getCached(key, ttl = CACHE_TTL) {
  const e = cache.get(key);
  if (e && Date.now() - e.ts < ttl) return e.data;
  return null;
}
function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

const ESPN_NBA = 'basketball/nba';
const NBA_AVG_PPG = 112.0;  // ~2025-26 league avg
const NBA_AVG_PACE = 99.0;

// ═══════════════════════════════════════════
//  ESPN Data Fetchers
// ═══════════════════════════════════════════

/**
 * Get today's NBA games from ESPN (with odds, records, etc.)
 */
async function getTodaysGames() {
  const cacheKey = 'game-picks-today-games';
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
  const url = `https://site.api.espn.com/apis/site/v2/sports/${ESPN_NBA}/scoreboard?dates=${today}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN ${res.status}`);
    const json = await res.json();

    const games = (json.events || []).map(ev => {
      const comp = ev.competitions?.[0];
      if (!comp) return null;
      const home = comp.competitors?.find(c => c.homeAway === 'home');
      const away = comp.competitors?.find(c => c.homeAway === 'away');
      if (!home || !away) return null;

      // Parse records (overall and home/away)
      const parseRecords = (competitor) => {
        const records = {};
        for (const rec of (competitor.records || [])) {
          if (rec.type === 'total') records.overall = rec.summary || '';
          else if (rec.type === 'home') records.home = rec.summary || '';
          else if (rec.type === 'road') records.away = rec.summary || '';
        }
        return records;
      };

      return {
        id: ev.id,
        name: ev.shortName || ev.name,
        startTime: ev.date,
        state: ev.status?.type?.state || 'pre',
        home: {
          id: home.team?.id,
          name: home.team?.displayName,
          abbreviation: home.team?.abbreviation,
          logo: home.team?.logo,
          records: parseRecords(home),
        },
        away: {
          id: away.team?.id,
          name: away.team?.displayName,
          abbreviation: away.team?.abbreviation,
          logo: away.team?.logo,
          records: parseRecords(away),
        },
        odds: comp.odds?.[0] ? {
          provider: comp.odds[0].provider?.name || 'ESPN',
          spread: comp.odds[0].details || '',
          overUnder: comp.odds[0].overUnder || null,
          homeML: comp.odds[0].homeTeamOdds?.moneyLine || null,
          awayML: comp.odds[0].awayTeamOdds?.moneyLine || null,
          homeFavorite: comp.odds[0].homeTeamOdds?.favorite || false,
          awayFavorite: comp.odds[0].awayTeamOdds?.favorite || false,
        } : null,
      };
    }).filter(Boolean);

    setCache(cacheKey, games);
    return games;
  } catch (err) {
    console.error('[GamePicks] ESPN games error:', err.message);
    return [];
  }
}

/**
 * Get team schedule/results for the season (for recent form, H2H, rest days).
 * Returns last N games with scores and results.
 */
async function getTeamSchedule(teamId) {
  const cacheKey = `team-schedule-${teamId}`;
  const cached = getCached(cacheKey, LONG_CACHE_TTL);
  if (cached) return cached;

  const season = new Date().getMonth() >= 9 ? new Date().getFullYear() + 1 : new Date().getFullYear();
  const url = `https://site.api.espn.com/apis/site/v2/sports/${ESPN_NBA}/teams/${teamId}/schedule?season=${season}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN schedule ${res.status}`);
    const json = await res.json();

    const events = (json.events || []).map(ev => {
      const comp = ev.competitions?.[0];
      if (!comp) return null;
      const home = comp.competitors?.find(c => c.homeAway === 'home');
      const away = comp.competitors?.find(c => c.homeAway === 'away');
      if (!home || !away) return null;

      const isHome = String(home.team?.id) === String(teamId);
      const team = isHome ? home : away;
      const opponent = isHome ? away : home;
      const won = team.winner === true;

      return {
        date: ev.date,
        gameId: ev.id,
        homeAway: isHome ? 'home' : 'away',
        teamScore: parseInt(team.score) || 0,
        oppScore: parseInt(opponent.score) || 0,
        oppId: opponent.team?.id,
        oppName: opponent.team?.displayName || '',
        oppAbbr: opponent.team?.abbreviation || '',
        won,
        completed: ev.status?.type?.completed || false,
        state: ev.status?.type?.state || 'pre',
      };
    }).filter(Boolean);

    // Only completed games, sorted most recent first
    const completed = events
      .filter(e => e.completed && e.state === 'post')
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    setCache(cacheKey, completed);
    return completed;
  } catch (err) {
    console.error(`[GamePicks] Schedule error for team ${teamId}:`, err.message);
    return [];
  }
}

/**
 * Get full team stats (offensive/defensive averages, pace).
 * Same data as nbaProps.getTeamFullStats but independent cache.
 */
async function getTeamStats(teamId) {
  const cacheKey = `game-team-stats-${teamId}`;
  const cached = getCached(cacheKey, LONG_CACHE_TTL);
  if (cached) return cached;

  const season = new Date().getMonth() >= 9 ? new Date().getFullYear() + 1 : new Date().getFullYear();

  try {
    const [recordRes, statsRes] = await Promise.all([
      fetch(`https://site.api.espn.com/apis/site/v2/sports/${ESPN_NBA}/teams/${teamId}`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`https://site.api.espn.com/apis/site/v2/sports/${ESPN_NBA}/teams/${teamId}/statistics?season=${season}`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]);

    // Parse record
    const recStats = {};
    for (const s of (recordRes?.team?.record?.items?.[0]?.stats || [])) {
      recStats[s.name] = s.value;
    }

    // Parse totals
    const totals = {};
    const cats = statsRes?.results?.stats?.categories || statsRes?.statistics?.splits?.categories || [];
    for (const cat of (Array.isArray(cats) ? cats : [])) {
      for (const stat of (cat.stats || [])) {
        const key = (stat.abbreviation || stat.name || '').toLowerCase();
        if (key) totals[key] = stat.value;
      }
    }

    const gp = recStats.gamesPlayed || 82;
    const fga = totals['fga'] || 0;
    const fta = totals['fta'] || 0;
    const orb = totals['or'] || 0;
    const to = totals['to'] || 0;
    const possessions = fga + 0.44 * fta - orb + to;
    const pace = possessions / gp;

    const result = {
      teamId,
      gp,
      wins: recStats.wins || 0,
      losses: recStats.losses || 0,
      winPct: recStats.winPercent || 0,
      pace: Math.round(pace * 10) / 10,
      avgPtsFor: recStats.avgPointsFor || 110,
      avgPtsAllowed: recStats.avgPointsAgainst || 110,
      pointDiff: Math.round(((recStats.avgPointsFor || 110) - (recStats.avgPointsAgainst || 110)) * 10) / 10,
      // Per-game stats
      rebPG: Math.round((totals['reb'] || 0) / gp * 10) / 10,
      astPG: Math.round((totals['ast'] || 0) / gp * 10) / 10,
      fg3PG: Math.round((totals['3pm'] || 0) / gp * 10) / 10,
      fgPct: totals['fg%'] || 0,
      fg3Pct: totals['3p%'] || 0,
      ftPct: totals['ft%'] || 0,
      toPG: Math.round((totals['to'] || 0) / gp * 10) / 10,
    };

    setCache(cacheKey, result);
    return result;
  } catch (err) {
    console.error(`[GamePicks] Team stats error for ${teamId}:`, err.message);
    return null;
  }
}

/**
 * Fetch NBA injuries from ESPN.
 * Returns { teamId: [{ playerName, status, comment }], ... }
 */
async function fetchInjuries() {
  const cacheKey = 'game-picks-injuries';
  const cached = getCached(cacheKey, LONG_CACHE_TTL);
  if (cached) return cached;

  try {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${ESPN_NBA}/injuries`);
    if (!res.ok) throw new Error(`ESPN injuries ${res.status}`);
    const json = await res.json();

    const injuryMap = {};
    for (const team of (json.injuries || [])) {
      const teamId = String(team.id);
      const outs = (team.injuries || [])
        .filter(inj => inj.status === 'Out')
        .map(inj => ({
          playerName: inj.athlete?.displayName || 'Unknown',
          status: inj.status,
          comment: inj.shortComment || '',
        }));
      if (outs.length) injuryMap[teamId] = outs;
    }

    setCache(cacheKey, injuryMap);
    return injuryMap;
  } catch (err) {
    console.error('[GamePicks] Injuries error:', err.message);
    return {};
  }
}


// ═══════════════════════════════════════════
//  Analysis Functions
// ═══════════════════════════════════════════

/**
 * Compute recent form from last N completed games.
 * Returns { wins, losses, winPct, avgPtsFor, avgPtsAllowed, avgMargin, streak }
 */
function getRecentForm(schedule, n = 10) {
  const recent = schedule.slice(0, n);
  if (!recent.length) return null;

  const wins = recent.filter(g => g.won).length;
  const losses = recent.length - wins;
  const avgPtsFor = recent.reduce((s, g) => s + g.teamScore, 0) / recent.length;
  const avgPtsAllowed = recent.reduce((s, g) => s + g.oppScore, 0) / recent.length;
  const avgMargin = avgPtsFor - avgPtsAllowed;

  // Calculate streak
  let streakType = recent[0]?.won ? 'W' : 'L';
  let streakCount = 0;
  for (const g of recent) {
    if ((g.won && streakType === 'W') || (!g.won && streakType === 'L')) {
      streakCount++;
    } else break;
  }

  // ATS (against the spread) — not available from schedule data, skip for now
  // Over/under record from recent games
  const totalPoints = recent.map(g => g.teamScore + g.oppScore);
  const avgTotal = totalPoints.reduce((a, b) => a + b, 0) / totalPoints.length;

  return {
    games: recent.length,
    wins,
    losses,
    winPct: Math.round((wins / recent.length) * 100),
    avgPtsFor: Math.round(avgPtsFor * 10) / 10,
    avgPtsAllowed: Math.round(avgPtsAllowed * 10) / 10,
    avgMargin: Math.round(avgMargin * 10) / 10,
    avgTotal: Math.round(avgTotal * 10) / 10,
    streak: `${streakType}${streakCount}`,
    scores: recent.map(g => ({
      pts: g.teamScore,
      opp: g.oppScore,
      total: g.teamScore + g.oppScore,
      won: g.won,
      homeAway: g.homeAway,
    })),
  };
}

/**
 * Get home/away splits from schedule data.
 */
function getHomAwaySplits(schedule) {
  const homeGames = schedule.filter(g => g.homeAway === 'home');
  const awayGames = schedule.filter(g => g.homeAway === 'away');

  const calcSplit = (games) => {
    if (!games.length) return { wins: 0, losses: 0, winPct: 0, avgPtsFor: 0, avgPtsAllowed: 0 };
    const wins = games.filter(g => g.won).length;
    return {
      wins,
      losses: games.length - wins,
      winPct: Math.round((wins / games.length) * 100),
      avgPtsFor: Math.round(games.reduce((s, g) => s + g.teamScore, 0) / games.length * 10) / 10,
      avgPtsAllowed: Math.round(games.reduce((s, g) => s + g.oppScore, 0) / games.length * 10) / 10,
    };
  };

  return { home: calcSplit(homeGames), away: calcSplit(awayGames) };
}

/**
 * Find head-to-head results this season.
 */
function getH2H(schedule, opponentId) {
  const games = schedule.filter(g => String(g.oppId) === String(opponentId));
  if (!games.length) return null;

  return {
    games: games.length,
    wins: games.filter(g => g.won).length,
    losses: games.filter(g => !g.won).length,
    results: games.map(g => ({
      pts: g.teamScore,
      opp: g.oppScore,
      total: g.teamScore + g.oppScore,
      won: g.won,
      homeAway: g.homeAway,
      date: g.date,
    })),
    avgMargin: Math.round(games.reduce((s, g) => s + (g.teamScore - g.oppScore), 0) / games.length * 10) / 10,
    avgTotal: Math.round(games.reduce((s, g) => s + g.teamScore + g.oppScore, 0) / games.length * 10) / 10,
  };
}

/**
 * Detect rest days advantage.
 * Returns { teamDays, oppDays, advantage } where advantage = teamDays - oppDays.
 */
function detectRestAdvantage(teamSchedule, oppSchedule) {
  const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const today = new Date(todayET);

  const getDaysRest = (schedule) => {
    if (!schedule.length) return null;
    const lastGameDate = new Date(schedule[0].date);
    const diff = Math.floor((today - lastGameDate) / (1000 * 60 * 60 * 24));
    return Math.max(0, diff - 1); // 0 = back-to-back, 1 = one day rest, etc.
  };

  const teamDays = getDaysRest(teamSchedule);
  const oppDays = getDaysRest(oppSchedule);

  return {
    teamDays,
    oppDays,
    isB2B: teamDays === 0,
    oppIsB2B: oppDays === 0,
    advantage: teamDays !== null && oppDays !== null ? teamDays - oppDays : 0,
  };
}

/**
 * Parse W-L record string into { wins, losses, winPct }
 */
function parseRecord(recordStr) {
  if (!recordStr) return null;
  const match = recordStr.match(/(\d+)-(\d+)/);
  if (!match) return null;
  const w = parseInt(match[1]);
  const l = parseInt(match[2]);
  return { wins: w, losses: l, winPct: (w + l) > 0 ? Math.round((w / (w + l)) * 100) : 0 };
}


// ═══════════════════════════════════════════
//  Core Analysis Engine
// ═══════════════════════════════════════════

/**
 * Analyze a single game and produce ML, Spread, and O/U recommendations.
 *
 * Returns {
 *   game, homeAnalysis, awayAnalysis,
 *   moneyline: { pick, confidence, probability, factors },
 *   spread: { pick, line, confidence, probability, factors },
 *   overUnder: { pick, line, confidence, probability, factors },
 * }
 */
async function analyzeGame(game) {
  // Fetch all data in parallel
  const [homeSchedule, awaySchedule, homeStats, awayStats, injuries] = await Promise.all([
    getTeamSchedule(game.home.id),
    getTeamSchedule(game.away.id),
    getTeamStats(game.home.id),
    getTeamStats(game.away.id),
    fetchInjuries(),
  ]);

  // ── Derived Data ──
  const homeForm = getRecentForm(homeSchedule, 10);
  const awayForm = getRecentForm(awaySchedule, 10);
  const homeForm5 = getRecentForm(homeSchedule, 5);
  const awayForm5 = getRecentForm(awaySchedule, 5);
  const homeSplits = getHomAwaySplits(homeSchedule);
  const awaySplits = getHomAwaySplits(awaySchedule);
  const h2hHome = getH2H(homeSchedule, game.away.id);
  const rest = detectRestAdvantage(homeSchedule, awaySchedule);
  const homeInjuries = injuries[String(game.home.id)] || [];
  const awayInjuries = injuries[String(game.away.id)] || [];

  // ── Power Rating ──
  // Composite score that rates each team's overall strength
  const homePower = calcPowerRating(homeStats, homeForm, homeSplits, 'home');
  const awayPower = calcPowerRating(awayStats, awayForm, awaySplits, 'away');

  // ── Moneyline Analysis ──
  const mlResult = analyzeMoneyline(
    game, homePower, awayPower, homeForm, awayForm, homeForm5, awayForm5,
    homeSplits, awaySplits, h2hHome, rest, homeInjuries, awayInjuries, homeStats, awayStats
  );

  // ── Spread Analysis ──
  const spreadResult = analyzeSpread(
    game, homePower, awayPower, homeForm, awayForm, homeForm5, awayForm5,
    homeSplits, awaySplits, h2hHome, rest, homeInjuries, awayInjuries, homeStats, awayStats
  );

  // ── Over/Under Analysis ──
  const ouResult = analyzeOverUnder(
    game, homeForm, awayForm, homeForm5, awayForm5,
    homeSplits, awaySplits, h2hHome, rest, homeStats, awayStats
  );

  return {
    game: {
      id: game.id,
      name: game.name,
      startTime: game.startTime,
      home: game.home,
      away: game.away,
      odds: game.odds,
    },
    homeAnalysis: {
      record: homeStats ? `${homeStats.wins}-${homeStats.losses}` : game.home.records?.overall,
      homeRecord: game.home.records?.home || `${homeSplits.home.wins}-${homeSplits.home.losses}`,
      recentForm: homeForm,
      recentForm5: homeForm5,
      power: homePower,
      injuries: homeInjuries,
      rest: rest.teamDays,
      isB2B: rest.isB2B,
    },
    awayAnalysis: {
      record: awayStats ? `${awayStats.wins}-${awayStats.losses}` : game.away.records?.overall,
      awayRecord: game.away.records?.away || `${awaySplits.away.wins}-${awaySplits.away.losses}`,
      recentForm: awayForm,
      recentForm5: awayForm5,
      power: awayPower,
      injuries: awayInjuries,
      rest: rest.oppDays,
      isB2B: rest.oppIsB2B,
    },
    h2h: h2hHome,
    moneyline: mlResult,
    spread: spreadResult,
    overUnder: ouResult,
  };
}

/**
 * Calculate a composite power rating for a team.
 * Scale: 0-100 where 50 = league average.
 */
function calcPowerRating(stats, form, splits, side) {
  if (!stats) return 50;

  let rating = 50;

  // 1. Win percentage (season) — weight 25
  //    50% = 0, 75% = +12.5, 25% = -12.5
  rating += (stats.winPct - 0.5) * 25;

  // 2. Point differential per game — weight 20
  //    +10 diff = +10 rating, -10 diff = -10 rating
  rating += Math.min(10, Math.max(-10, stats.pointDiff));

  // 3. Recent form (L10 win%) — weight 20
  if (form) {
    const recentBoost = ((form.winPct / 100) - 0.5) * 20;
    rating += recentBoost;
  }

  // 4. Home/Away specific performance — weight 10
  if (side === 'home' && splits.home.wins + splits.home.losses > 0) {
    const homeWinPct = splits.home.winPct / 100;
    rating += (homeWinPct - 0.5) * 10;
  } else if (side === 'away' && splits.away.wins + splits.away.losses > 0) {
    const awayWinPct = splits.away.winPct / 100;
    rating += (awayWinPct - 0.5) * 10;
  }

  // 5. Scoring efficiency — weight 5
  //    Above-average PPG = slight boost
  if (stats.avgPtsFor > NBA_AVG_PPG) {
    rating += Math.min(3, (stats.avgPtsFor - NBA_AVG_PPG) * 0.3);
  } else {
    rating -= Math.min(3, (NBA_AVG_PPG - stats.avgPtsFor) * 0.3);
  }

  // 6. Defensive strength — weight 5
  //    Below-average PPG allowed = boost
  if (stats.avgPtsAllowed < NBA_AVG_PPG) {
    rating += Math.min(3, (NBA_AVG_PPG - stats.avgPtsAllowed) * 0.3);
  } else {
    rating -= Math.min(3, (stats.avgPtsAllowed - NBA_AVG_PPG) * 0.3);
  }

  return Math.round(Math.min(90, Math.max(10, rating)) * 10) / 10;
}


/**
 * Analyze Moneyline pick.
 * Produces probability of each team winning, then compares to implied odds.
 */
function analyzeMoneyline(
  game, homePower, awayPower, homeForm, awayForm, homeForm5, awayForm5,
  homeSplits, awaySplits, h2h, rest, homeInjuries, awayInjuries, homeStats, awayStats
) {
  const factors = [];
  let homeProb = 0;
  let totalWeight = 0;

  // ── 1. Power rating differential (weight 30) ──
  const powerDiff = homePower - awayPower;
  // Map power diff to probability: ±20 diff ≈ ±20% swing from 50%
  const powerSignal = 0.5 + (powerDiff / 100) * 0.5;
  homeProb += Math.min(0.85, Math.max(0.15, powerSignal)) * 30;
  totalWeight += 30;
  factors.push({ label: 'Power Rating', detail: `Home ${homePower.toFixed(1)} vs Away ${awayPower.toFixed(1)}`, impact: powerDiff > 0 ? 'home' : 'away' });

  // ── 2. Recent form L10 (weight 20) ──
  if (homeForm && awayForm) {
    const formDiff = (homeForm.winPct - awayForm.winPct) / 100;
    const formSignal = 0.5 + formDiff * 0.3;
    homeProb += Math.min(0.8, Math.max(0.2, formSignal)) * 20;
    totalWeight += 20;
    factors.push({
      label: 'L10 Form',
      detail: `Home ${homeForm.wins}-${homeForm.losses} (${homeForm.streak}) vs Away ${awayForm.wins}-${awayForm.losses} (${awayForm.streak})`,
      impact: homeForm.winPct > awayForm.winPct ? 'home' : 'away',
    });
  }

  // ── 3. Home/Away splits (weight 15) ──
  if (homeSplits.home.wins + homeSplits.home.losses > 5 && awaySplits.away.wins + awaySplits.away.losses > 5) {
    const splitDiff = (homeSplits.home.winPct - awaySplits.away.winPct) / 100;
    const splitSignal = 0.5 + splitDiff * 0.25;
    homeProb += Math.min(0.75, Math.max(0.25, splitSignal)) * 15;
    totalWeight += 15;
    factors.push({
      label: 'Home/Away Splits',
      detail: `Home at home: ${homeSplits.home.wins}-${homeSplits.home.losses} · Away on road: ${awaySplits.away.wins}-${awaySplits.away.losses}`,
      impact: homeSplits.home.winPct > awaySplits.away.winPct ? 'home' : 'away',
    });
  }

  // ── 4. Scoring margin (weight 10) ──
  if (homeStats && awayStats) {
    const marginDiff = homeStats.pointDiff - awayStats.pointDiff;
    const marginSignal = 0.5 + (marginDiff / 30) * 0.3;
    homeProb += Math.min(0.75, Math.max(0.25, marginSignal)) * 10;
    totalWeight += 10;
    factors.push({
      label: 'Point Differential',
      detail: `Home ${homeStats.pointDiff > 0 ? '+' : ''}${homeStats.pointDiff} vs Away ${awayStats.pointDiff > 0 ? '+' : ''}${awayStats.pointDiff}`,
      impact: homeStats.pointDiff > awayStats.pointDiff ? 'home' : 'away',
    });
  }

  // ── 5. Head-to-head (weight 10 if data) ──
  if (h2h && h2h.games >= 1) {
    const h2hSignal = h2h.wins / h2h.games;
    homeProb += Math.min(0.8, Math.max(0.2, h2hSignal)) * 10;
    totalWeight += 10;
    factors.push({
      label: 'Head-to-Head',
      detail: `Season series: ${h2h.wins}-${h2h.losses} (avg margin: ${h2h.avgMargin > 0 ? '+' : ''}${h2h.avgMargin})`,
      impact: h2h.wins > h2h.losses ? 'home' : 'away',
    });
  }

  // ── 6. Rest advantage (weight 8) ──
  if (rest.teamDays !== null && rest.oppDays !== null) {
    let restSignal = 0.5;
    if (rest.isB2B && !rest.oppIsB2B) restSignal = 0.38;        // home on B2B, big disadvantage
    else if (!rest.isB2B && rest.oppIsB2B) restSignal = 0.62;    // opponent on B2B
    else if (rest.advantage >= 2) restSignal = 0.58;              // 2+ more rest days
    else if (rest.advantage <= -2) restSignal = 0.42;

    homeProb += restSignal * 8;
    totalWeight += 8;

    if (rest.isB2B || rest.oppIsB2B || Math.abs(rest.advantage) >= 2) {
      factors.push({
        label: 'Rest',
        detail: `Home: ${rest.teamDays === 0 ? 'B2B' : rest.teamDays + ' days rest'} · Away: ${rest.oppDays === 0 ? 'B2B' : rest.oppDays + ' days rest'}`,
        impact: rest.advantage > 0 ? 'home' : rest.advantage < 0 ? 'away' : 'neutral',
      });
    }
  }

  // ── 7. Injury impact (weight 7) ──
  const homeInjuryCount = homeInjuries.length;
  const awayInjuryCount = awayInjuries.length;
  if (homeInjuryCount > 0 || awayInjuryCount > 0) {
    const injDiff = awayInjuryCount - homeInjuryCount; // positive = away has more injuries = good for home
    const injSignal = 0.5 + injDiff * 0.03; // each injury shifts ~3%
    homeProb += Math.min(0.7, Math.max(0.3, injSignal)) * 7;
    totalWeight += 7;
    factors.push({
      label: 'Injuries',
      detail: `Home: ${homeInjuryCount} OUT · Away: ${awayInjuryCount} OUT`,
      impact: injDiff > 0 ? 'home' : injDiff < 0 ? 'away' : 'neutral',
    });
  }

  // Calculate final probability
  homeProb = totalWeight > 0 ? homeProb / totalWeight : 0.5;

  // Apply home court advantage boost (+2.5%)
  homeProb = Math.min(0.85, homeProb + 0.025);
  const awayProb = 1 - homeProb;

  // Determine pick and confidence
  const pickHome = homeProb >= 0.5;
  const prob = pickHome ? homeProb : awayProb;

  let confidence = 'low';
  if (prob >= 0.70) confidence = 'high';
  else if (prob >= 0.60) confidence = 'medium';

  // Check for value vs market odds
  let value = null;
  if (game.odds) {
    const marketML = pickHome ? game.odds.homeML : game.odds.awayML;
    if (marketML) {
      const impliedProb = mlToImpliedProb(marketML);
      const edge = prob - impliedProb;
      if (edge > 0.03) {
        value = { edge: Math.round(edge * 100), impliedProb: Math.round(impliedProb * 100), ml: marketML };
      }
    }
  }

  return {
    pick: pickHome ? game.home.abbreviation : game.away.abbreviation,
    pickTeam: pickHome ? 'home' : 'away',
    probability: Math.round(prob * 100),
    confidence,
    homeProb: Math.round(homeProb * 100),
    awayProb: Math.round(awayProb * 100),
    factors,
    value,
  };
}


/**
 * Analyze Spread pick.
 */
function analyzeSpread(
  game, homePower, awayPower, homeForm, awayForm, homeForm5, awayForm5,
  homeSplits, awaySplits, h2h, rest, homeInjuries, awayInjuries, homeStats, awayStats
) {
  if (!game.odds?.spread) {
    return { pick: null, line: null, probability: 50, confidence: 'low', factors: [{ label: 'No Line', detail: 'No spread available for this game', impact: 'neutral' }] };
  }

  const factors = [];

  // Parse spread — "BOS -5.5" format
  const spreadMatch = game.odds.spread.match(/([A-Z]+)\s*([-+]?\d+\.?\d*)/);
  if (!spreadMatch) {
    return { pick: null, line: null, probability: 50, confidence: 'low', factors: [{ label: 'Parse Error', detail: 'Could not parse spread', impact: 'neutral' }] };
  }

  const favAbbr = spreadMatch[1];
  const spreadVal = parseFloat(spreadMatch[2]);
  const favIsHome = favAbbr === game.home.abbreviation;

  // Determine effective spread from home perspective
  // If home is favorite: homeSpread = spreadVal (negative, e.g. -5.5)
  // If away is favorite: homeSpread = -spreadVal (positive for home, e.g. +5.5)
  const homeSpread = favIsHome ? spreadVal : -spreadVal;

  // ── Calculate projected margin ──
  // Use multiple signals to project the scoring margin (home - away)
  let projectedMargin = 0;
  let totalWeight = 0;

  // 1. Power rating differential (weight 30)
  const powerDiff = homePower - awayPower;
  // Each point of power rating ≈ 0.4 points of margin
  projectedMargin += (powerDiff * 0.4) * 30;
  totalWeight += 30;

  // 2. Season point differential (weight 20)
  if (homeStats && awayStats) {
    const marginDiff = homeStats.pointDiff - awayStats.pointDiff;
    // Half the raw differential (season-long data regresses)
    projectedMargin += (marginDiff / 2) * 20;
    totalWeight += 20;
    factors.push({
      label: 'Season Margin',
      detail: `Home ${homeStats.pointDiff > 0 ? '+' : ''}${homeStats.pointDiff} PPG · Away ${awayStats.pointDiff > 0 ? '+' : ''}${awayStats.pointDiff} PPG`,
      impact: homeStats.pointDiff > awayStats.pointDiff ? 'home' : 'away',
    });
  }

  // 3. Recent form margin L10 (weight 25)
  if (homeForm && awayForm) {
    const recentMarginDiff = homeForm.avgMargin - awayForm.avgMargin;
    projectedMargin += (recentMarginDiff / 2) * 25;
    totalWeight += 25;
    factors.push({
      label: 'L10 Margin',
      detail: `Home ${homeForm.avgMargin > 0 ? '+' : ''}${homeForm.avgMargin} · Away ${awayForm.avgMargin > 0 ? '+' : ''}${awayForm.avgMargin}`,
      impact: homeForm.avgMargin > awayForm.avgMargin ? 'home' : 'away',
    });
  }

  // 4. Home/Away scoring margins (weight 15)
  const homeAtHome = homeSplits.home;
  const awayOnRoad = awaySplits.away;
  if (homeAtHome.wins + homeAtHome.losses > 5 && awayOnRoad.wins + awayOnRoad.losses > 5) {
    const homeMargin = homeAtHome.avgPtsFor - homeAtHome.avgPtsAllowed;
    const awayMargin = awayOnRoad.avgPtsFor - awayOnRoad.avgPtsAllowed;
    const splitMargin = (homeMargin - awayMargin) / 2;
    projectedMargin += splitMargin * 15;
    totalWeight += 15;
  }

  // 5. H2H (weight 10 if data)
  if (h2h && h2h.games >= 1) {
    projectedMargin += h2h.avgMargin * 10;
    totalWeight += 10;
    factors.push({
      label: 'H2H Margin',
      detail: `Avg margin: ${h2h.avgMargin > 0 ? '+' : ''}${h2h.avgMargin}`,
      impact: h2h.avgMargin > 0 ? 'home' : 'away',
    });
  }

  // Finalize projected margin
  projectedMargin = totalWeight > 0 ? projectedMargin / totalWeight : 0;

  // Add home court advantage (~+3 pts)
  projectedMargin += 3.0;

  // Apply rest adjustments
  if (rest.isB2B && !rest.oppIsB2B) projectedMargin -= 2.5;
  else if (!rest.isB2B && rest.oppIsB2B) projectedMargin += 2.5;
  else if (rest.advantage >= 2) projectedMargin += 1.0;
  else if (rest.advantage <= -2) projectedMargin -= 1.0;

  // Apply injury adjustment (~1 pt per injury differential — rough heuristic)
  const injDiff = awayInjuries.length - homeInjuries.length;
  projectedMargin += injDiff * 1.0;

  projectedMargin = Math.round(projectedMargin * 10) / 10;

  factors.unshift({
    label: 'Projected Margin',
    detail: `Model projects ${projectedMargin > 0 ? game.home.abbreviation : game.away.abbreviation} ${projectedMargin > 0 ? '+' : ''}${projectedMargin}`,
    impact: projectedMargin > 0 ? 'home' : 'away',
  });

  // ── Compare projected margin to spread ──
  // homeSpread is negative if home is favored (e.g. -5.5)
  // If projectedMargin > |homeSpread|, home covers
  // coverMargin = projectedMargin + homeSpread (since homeSpread is negative for favorites)
  // e.g. projected +8, spread -5.5 → cover by 2.5
  // e.g. projected +3, spread -5.5 → fail to cover by 2.5

  const coverMargin = projectedMargin + homeSpread; // positive = home covers

  // Convert cover margin to probability
  // Each point of cover margin ≈ 5% probability shift from 50%
  const coverProb = 0.5 + (coverMargin * 0.05);
  const homeCoverProb = Math.min(0.82, Math.max(0.18, coverProb));
  const awayCoverProb = 1 - homeCoverProb;

  const pickHome = homeCoverProb >= 0.5;
  const prob = pickHome ? homeCoverProb : awayCoverProb;

  let confidence = 'low';
  if (prob >= 0.68) confidence = 'high';
  else if (prob >= 0.58) confidence = 'medium';

  // Build readable pick label
  let pickLabel;
  if (pickHome) {
    pickLabel = `${game.home.abbreviation} ${homeSpread > 0 ? '+' : ''}${homeSpread}`;
  } else {
    const awaySpread = -homeSpread;
    pickLabel = `${game.away.abbreviation} ${awaySpread > 0 ? '+' : ''}${awaySpread}`;
  }

  factors.push({
    label: 'Spread Edge',
    detail: `${pickHome ? 'Home' : 'Away'} covers by projected ${Math.abs(coverMargin).toFixed(1)} pts`,
    impact: pickHome ? 'home' : 'away',
  });

  return {
    pick: pickLabel,
    pickTeam: pickHome ? 'home' : 'away',
    line: homeSpread,
    projectedMargin,
    coverMargin: Math.round(coverMargin * 10) / 10,
    probability: Math.round(prob * 100),
    confidence,
    homeCoverProb: Math.round(homeCoverProb * 100),
    awayCoverProb: Math.round(awayCoverProb * 100),
    factors,
  };
}


/**
 * Analyze Over/Under.
 */
function analyzeOverUnder(
  game, homeForm, awayForm, homeForm5, awayForm5,
  homeSplits, awaySplits, h2h, rest, homeStats, awayStats
) {
  if (!game.odds?.overUnder) {
    return { pick: null, line: null, probability: 50, confidence: 'low', factors: [{ label: 'No Line', detail: 'No over/under available for this game', impact: 'neutral' }] };
  }

  const ouLine = parseFloat(game.odds.overUnder);
  const factors = [];

  // ── Project total points ──
  let projectedTotal = 0;
  let totalWeight = 0;

  // 1. Season averages — each team's PF + PA, averaged (weight 25)
  if (homeStats && awayStats) {
    // Home team scores their avg + away team scores their avg
    // But adjust: home team's opponents score awayStats.avgPtsFor, etc.
    // Simpler: (homePF + awayPF) is the raw projection
    const rawTotal = homeStats.avgPtsFor + awayStats.avgPtsFor;
    // Adjust by defensive context: if both teams allow more than avg, total goes up
    const defAdj = ((homeStats.avgPtsAllowed - NBA_AVG_PPG) + (awayStats.avgPtsAllowed - NBA_AVG_PPG)) * 0.3;
    projectedTotal += (rawTotal + defAdj) * 25;
    totalWeight += 25;
    factors.push({
      label: 'Season Scoring',
      detail: `Home: ${homeStats.avgPtsFor} PPG · Away: ${awayStats.avgPtsFor} PPG`,
      impact: rawTotal + defAdj > ouLine ? 'over' : 'under',
    });
  }

  // 2. Recent form L10 totals (weight 30)
  if (homeForm && awayForm) {
    const recentTotal = homeForm.avgPtsFor + awayForm.avgPtsFor;
    const recentDefAdj = ((homeForm.avgPtsAllowed - NBA_AVG_PPG) + (awayForm.avgPtsAllowed - NBA_AVG_PPG)) * 0.3;
    projectedTotal += (recentTotal + recentDefAdj) * 30;
    totalWeight += 30;
    factors.push({
      label: 'L10 Scoring',
      detail: `Home L10: ${homeForm.avgPtsFor} PPG (${homeForm.avgTotal} avg total) · Away L10: ${awayForm.avgPtsFor} PPG (${awayForm.avgTotal} avg total)`,
      impact: recentTotal + recentDefAdj > ouLine ? 'over' : 'under',
    });
  }

  // 3. Recent form L5 totals (weight 15)
  if (homeForm5 && awayForm5) {
    const l5Total = homeForm5.avgPtsFor + awayForm5.avgPtsFor;
    const l5DefAdj = ((homeForm5.avgPtsAllowed - NBA_AVG_PPG) + (awayForm5.avgPtsAllowed - NBA_AVG_PPG)) * 0.2;
    projectedTotal += (l5Total + l5DefAdj) * 15;
    totalWeight += 15;
  }

  // 4. Pace matchup (weight 15)
  if (homeStats && awayStats) {
    const gamePace = (homeStats.pace + awayStats.pace) / 2;
    // Faster pace → more possessions → more points
    const paceAdj = (gamePace / NBA_AVG_PACE);
    // Apply pace adjustment to the running projection
    const paceAdjTotal = (homeStats.avgPtsFor + awayStats.avgPtsFor) * paceAdj;
    projectedTotal += paceAdjTotal * 15;
    totalWeight += 15;
    const paceLabel = gamePace >= 102 ? 'fast' : gamePace <= 96 ? 'slow' : 'average';
    factors.push({
      label: 'Pace',
      detail: `Combined pace: ${gamePace.toFixed(1)} (${paceLabel}) — Home: ${homeStats.pace} · Away: ${awayStats.pace}`,
      impact: gamePace >= 100 ? 'over' : gamePace <= 97 ? 'under' : 'neutral',
    });
  }

  // 5. Home/Away totals (weight 10)
  const homeAtHome = homeSplits.home;
  const awayOnRoad = awaySplits.away;
  if (homeAtHome.wins + homeAtHome.losses > 5 && awayOnRoad.wins + awayOnRoad.losses > 5) {
    const splitTotal = (homeAtHome.avgPtsFor + homeAtHome.avgPtsAllowed + awayOnRoad.avgPtsFor + awayOnRoad.avgPtsAllowed) / 2;
    projectedTotal += splitTotal * 10;
    totalWeight += 10;
  }

  // 6. H2H totals (weight 5 if data)
  if (h2h && h2h.games >= 1) {
    projectedTotal += h2h.avgTotal * 5;
    totalWeight += 5;
    factors.push({
      label: 'H2H Total',
      detail: `Avg total in ${h2h.games} meeting(s): ${h2h.avgTotal}`,
      impact: h2h.avgTotal > ouLine ? 'over' : 'under',
    });
  }

  // Finalize
  projectedTotal = totalWeight > 0 ? projectedTotal / totalWeight : ouLine;

  // Rest adjustment: B2B teams score ~3-4 fewer points
  if (rest.isB2B) projectedTotal -= 2;
  if (rest.oppIsB2B) projectedTotal -= 2;

  projectedTotal = Math.round(projectedTotal * 10) / 10;

  factors.unshift({
    label: 'Projected Total',
    detail: `Model projects ${projectedTotal} points`,
    impact: projectedTotal > ouLine ? 'over' : 'under',
  });

  // ── Compare to line ──
  const diff = projectedTotal - ouLine;
  // Each point of difference ≈ 4% probability shift
  const overProb = Math.min(0.82, Math.max(0.18, 0.5 + diff * 0.04));
  const underProb = 1 - overProb;

  const pickOver = overProb >= 0.5;
  const prob = pickOver ? overProb : underProb;

  let confidence = 'low';
  if (prob >= 0.68) confidence = 'high';
  else if (prob >= 0.58) confidence = 'medium';

  factors.push({
    label: 'Edge',
    detail: `${diff > 0 ? 'Over' : 'Under'} by ${Math.abs(diff).toFixed(1)} points vs line of ${ouLine}`,
    impact: diff > 0 ? 'over' : 'under',
  });

  return {
    pick: pickOver ? `OVER ${ouLine}` : `UNDER ${ouLine}`,
    pickDirection: pickOver ? 'over' : 'under',
    line: ouLine,
    projectedTotal,
    diff: Math.round(diff * 10) / 10,
    probability: Math.round(prob * 100),
    confidence,
    overProb: Math.round(overProb * 100),
    underProb: Math.round(underProb * 100),
    factors,
  };
}


// ═══════════════════════════════════════════
//  Top Game Picks Generator
// ═══════════════════════════════════════════

/**
 * Generate top game picks for today's NBA slate.
 * Returns best ML, Spread, and O/U picks ranked by confidence.
 */
async function generateTopGamePicks() {
  const cacheKey = 'top-game-picks-today';
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const games = await getTodaysGames();
  if (!games.length) {
    return { picks: [], gamesScanned: 0, generatedAt: new Date().toISOString() };
  }

  console.log(`[GamePicks] Analyzing ${games.length} NBA games...`);

  // Analyze all games in parallel (batches of 3 to be respectful to ESPN)
  const analyses = [];
  const BATCH_SIZE = 3;

  for (let i = 0; i < games.length; i += BATCH_SIZE) {
    const batch = games.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(g => analyzeGame(g)));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        analyses.push(r.value);
      }
    }
  }

  // Collect all picks
  const allML = [];
  const allSpread = [];
  const allOU = [];

  for (const a of analyses) {
    if (a.moneyline.probability >= 55) {
      allML.push({ ...a.moneyline, game: a.game, homeAnalysis: a.homeAnalysis, awayAnalysis: a.awayAnalysis, h2h: a.h2h });
    }
    if (a.spread.probability >= 55 && a.spread.pick) {
      allSpread.push({ ...a.spread, game: a.game, homeAnalysis: a.homeAnalysis, awayAnalysis: a.awayAnalysis, h2h: a.h2h });
    }
    if (a.overUnder.probability >= 55 && a.overUnder.pick) {
      allOU.push({ ...a.overUnder, game: a.game, homeAnalysis: a.homeAnalysis, awayAnalysis: a.awayAnalysis, h2h: a.h2h });
    }
  }

  // Sort by probability (strongest picks first)
  allML.sort((a, b) => b.probability - a.probability);
  allSpread.sort((a, b) => b.probability - a.probability);
  allOU.sort((a, b) => b.probability - a.probability);

  const result = {
    moneyline: allML.slice(0, 5),
    spread: allSpread.slice(0, 5),
    overUnder: allOU.slice(0, 5),
    allGames: analyses.map(a => ({
      game: a.game,
      moneyline: a.moneyline,
      spread: a.spread,
      overUnder: a.overUnder,
      homeAnalysis: a.homeAnalysis,
      awayAnalysis: a.awayAnalysis,
      h2h: a.h2h,
    })),
    gamesScanned: games.length,
    generatedAt: new Date().toISOString(),
  };

  setCache(cacheKey, result);
  return result;
}


// ═══════════════════════════════════════════
//  Resolution — Check ESPN Final Scores
// ═══════════════════════════════════════════

/**
 * Resolve unresolved game picks by fetching final scores from ESPN.
 * @param {Array} unresolvedPicks - picks from game_picks table with hit=null
 * @returns {Array} resolutions - [{ pickId, homeScore, awayScore }]
 */
async function resolveGamePicksFromESPN(unresolvedPicks) {
  if (!unresolvedPicks.length) return [];

  // Group picks by game_id to minimize API calls
  const byGame = {};
  for (const pick of unresolvedPicks) {
    if (!pick.game_id) continue;
    if (!byGame[pick.game_id]) byGame[pick.game_id] = [];
    byGame[pick.game_id].push(pick);
  }

  const resolutions = [];

  for (const [gameId, picks] of Object.entries(byGame)) {
    try {
      // Fetch game summary from ESPN
      const url = `https://site.api.espn.com/apis/site/v2/sports/${ESPN_NBA}/summary?event=${gameId}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const summary = await res.json();

      // Check if game is final
      const state = summary.header?.competitions?.[0]?.status?.type?.state;
      if (state !== 'post') continue; // Game not finished yet

      // Get final scores
      const competitors = summary.header?.competitions?.[0]?.competitors;
      if (!competitors) continue;

      let homeScore = null, awayScore = null;
      for (const c of competitors) {
        if (c.homeAway === 'home') homeScore = parseInt(c.score);
        if (c.homeAway === 'away') awayScore = parseInt(c.score);
      }

      if (homeScore === null || awayScore === null || isNaN(homeScore) || isNaN(awayScore)) continue;

      // Add resolution for each pick in this game
      for (const pick of picks) {
        resolutions.push({ pickId: pick.id, homeScore, awayScore });
      }
    } catch (err) {
      console.error(`[GamePicks] Failed to resolve game ${gameId}:`, err.message);
    }
  }

  return resolutions;
}


// ═══════════════════════════════════════════
//  Utility
// ═══════════════════════════════════════════

/**
 * Convert American moneyline odds to implied probability.
 * -150 → 60%, +200 → 33.3%
 */
function mlToImpliedProb(ml) {
  if (!ml) return 0.5;
  if (ml < 0) return Math.abs(ml) / (Math.abs(ml) + 100);
  return 100 / (ml + 100);
}

module.exports = {
  getTodaysGames,
  analyzeGame,
  generateTopGamePicks,
  resolveGamePicksFromESPN,
  getTeamSchedule,
  getTeamStats,
  mlToImpliedProb,
};
