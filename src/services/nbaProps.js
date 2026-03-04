/**
 * NBA Player Props Analysis Service
 * Uses ESPN + NBA.com unofficial APIs (free, no key required).
 *
 * Fetches player season stats, game logs, matchup history,
 * and opponent defensive rankings to generate prop recommendations.
 */

// ── Cache ──
const cache = new Map();
const CACHE_TTL = 5 * 60_000; // 5 min

function getCached(key) {
  const e = cache.get(key);
  if (e && Date.now() - e.ts < CACHE_TTL) return e.data;
  return null;
}
function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

// ── ESPN helpers ──
const ESPN_NBA = 'basketball/nba';

/**
 * Get today's NBA games from ESPN
 */
async function getTodaysNBAGames() {
  const cached = getCached('nba-games-today');
  if (cached) return cached;

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
  const url = `https://site.api.espn.com/apis/site/v2/sports/${ESPN_NBA}/scoreboard?dates=${today}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN ${res.status}`);
    const json = await res.json();
    const games = (json.events || []).map(ev => {
      const comp = ev.competitions?.[0];
      const home = comp?.competitors?.find(c => c.homeAway === 'home');
      const away = comp?.competitors?.find(c => c.homeAway === 'away');
      return {
        id: ev.id,
        name: ev.shortName || ev.name,
        startTime: ev.date,
        state: ev.status?.type?.state || 'pre',
        home: {
          id: home?.team?.id,
          name: home?.team?.displayName,
          abbreviation: home?.team?.abbreviation,
          logo: home?.team?.logo,
        },
        away: {
          id: away?.team?.id,
          name: away?.team?.displayName,
          abbreviation: away?.team?.abbreviation,
          logo: away?.team?.logo,
        },
        odds: comp?.odds?.[0] ? {
          spread: comp.odds[0].details || '',
          overUnder: comp.odds[0].overUnder || null,
        } : null,
      };
    });
    setCache('nba-games-today', games);
    return games;
  } catch (err) {
    console.error('[Props] ESPN games error:', err.message);
    return [];
  }
}

/**
 * Get NBA team roster from ESPN
 */
async function getTeamRoster(teamId) {
  const cacheKey = `roster-${teamId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `https://site.api.espn.com/apis/site/v2/sports/${ESPN_NBA}/teams/${teamId}/roster`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN roster ${res.status}`);
    const json = await res.json();
    const players = (json.athletes || []).map(a => ({
      id: a.id,
      name: a.fullName || a.displayName,
      firstName: a.firstName,
      lastName: a.lastName,
      position: a.position?.abbreviation || '',
      jersey: a.jersey || '',
      headshot: a.headshot?.href || null,
    }));
    setCache(cacheKey, players);
    return players;
  } catch (err) {
    console.error('[Props] Roster error:', err.message);
    return [];
  }
}

/**
 * Get player season stats + game log from ESPN
 */
async function getPlayerStats(playerId) {
  const cacheKey = `player-stats-${playerId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  // ESPN player game log endpoint
  const season = new Date().getMonth() >= 9 ? new Date().getFullYear() + 1 : new Date().getFullYear();
  const logUrl = `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${playerId}/gamelog?season=${season}`;
  const statsUrl = `https://site.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${playerId}/stats`;

  try {
    const [logRes, statsRes] = await Promise.all([
      fetch(logUrl).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(statsUrl).then(r => r.ok ? r.json() : null).catch(() => null),
    ]);

    // Parse season averages
    let seasonAvg = {};
    if (statsRes?.resultSet || statsRes?.statistics) {
      // Try to extract from ESPN stats response
      const statsSplit = statsRes.statistics?.splits?.categories || statsRes.splits?.categories || [];
      for (const cat of statsSplit) {
        for (const stat of (cat.stats || [])) {
          seasonAvg[stat.abbreviation?.toLowerCase() || stat.name?.toLowerCase()] = stat.value;
        }
      }
    }

    // Parse game log
    let gameLog = [];
    if (logRes) {
      const categories = logRes.categories || logRes.seasonTypes?.[0]?.categories || [];
      const events = logRes.events || logRes.seasonTypes?.[0]?.events || {};
      
      // The gamelog structure can vary — try to extract stat labels and values
      let labels = [];
      let gameEntries = [];
      
      for (const cat of categories) {
        if (cat.name === 'offensive' || cat.type === 'offensive' || !labels.length) {
          labels = (cat.labels || cat.names || []).map(l => (typeof l === 'string' ? l : l.abbreviation || l.name || '').toLowerCase());
          gameEntries = cat.events || cat.totals || [];
        }
      }

      // Map events to game log entries
      const eventKeys = Object.keys(events);
      for (let i = 0; i < eventKeys.length && i < 82; i++) {
        const eventId = eventKeys[i];
        const eventInfo = events[eventId];
        const stats = {};
        
        // Find stat values for this event from categories
        for (const cat of categories) {
          const catEvents = cat.events || [];
          const catEvent = catEvents.find(e => e.eventId === eventId) || catEvents[i];
          if (catEvent?.stats) {
            const catLabels = (cat.labels || cat.names || []).map(l => 
              (typeof l === 'string' ? l : l.abbreviation || l.name || '').toLowerCase()
            );
            catEvent.stats.forEach((val, j) => {
              if (catLabels[j]) stats[catLabels[j]] = val;
            });
          }
        }

        if (Object.keys(stats).length > 0) {
          gameLog.push({
            date: eventInfo?.gameDate || null,
            opponent: eventInfo?.opponent?.displayName || eventInfo?.opponent?.abbreviation || '',
            opponentId: eventInfo?.opponent?.id || eventInfo?.opponentId || '',
            homeAway: eventInfo?.homeAway || '',
            result: eventInfo?.gameResult || '',
            stats,
          });
        }
      }
    }

    const result = { seasonAvg, gameLog, playerId };
    setCache(cacheKey, result);
    return result;
  } catch (err) {
    console.error('[Props] Player stats error:', err.message);
    return { seasonAvg: {}, gameLog: [], playerId };
  }
}

/**
 * Get opponent team defensive stats (what they allow per game)
 */
async function getTeamDefensiveStats(teamId) {
  const cacheKey = `team-defense-${teamId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const season = new Date().getMonth() >= 9 ? new Date().getFullYear() + 1 : new Date().getFullYear();
  const url = `https://site.api.espn.com/apis/site/v2/sports/${ESPN_NBA}/teams/${teamId}/statistics?season=${season}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN team stats ${res.status}`);
    const json = await res.json();

    const defStats = {};
    const splits = json.resultSet || json.results?.stats?.categories || json.statistics?.splits?.categories || [];
    for (const cat of (Array.isArray(splits) ? splits : [])) {
      for (const stat of (cat.stats || [])) {
        const key = (stat.abbreviation || stat.name || '').toLowerCase();
        if (key) defStats[key] = stat.value;
      }
    }

    setCache(cacheKey, defStats);
    return defStats;
  } catch (err) {
    console.error('[Props] Team defense stats error:', err.message);
    return {};
  }
}

// ── Prop Analysis ──

const STAT_CATEGORIES = [
  { key: 'pts', label: 'Points', shortLabel: 'PTS' },
  { key: 'reb', label: 'Rebounds', shortLabel: 'REB' },
  { key: 'ast', label: 'Assists', shortLabel: 'AST' },
  { key: 'fg3', label: '3-Pointers Made', shortLabel: '3PM' },
  { key: 'stl', label: 'Steals', shortLabel: 'STL' },
  { key: 'blk', label: 'Blocks', shortLabel: 'BLK' },
  { key: 'to', label: 'Turnovers', shortLabel: 'TO' },
];

// Alternative labels for the same stat in different ESPN response formats
const STAT_ALIASES = {
  pts: ['pts', 'points'],
  reb: ['reb', 'rebounds', 'totalrebounds'],
  ast: ['ast', 'assists'],
  fg3: ['3pm', 'fg3', 'threepointfieldgoalsmade', '3pt'],
  stl: ['stl', 'steals'],
  blk: ['blk', 'blocks'],
  to: ['to', 'turnovers'],
};

function getStatValue(statsObj, statKey) {
  if (!statsObj) return null;
  const aliases = STAT_ALIASES[statKey] || [statKey];
  for (const alias of aliases) {
    if (statsObj[alias] !== undefined && statsObj[alias] !== null) {
      const val = parseFloat(statsObj[alias]);
      if (!isNaN(val)) return val;
    }
  }
  return null;
}

/**
 * Analyze a player for a specific stat category against a given opponent.
 * Returns hit rates, averages, trends, and a confidence score.
 */
function analyzePlayerProp(playerStats, statKey, propLine, opponentId) {
  const { seasonAvg, gameLog } = playerStats;
  const seasonVal = getStatValue(seasonAvg, statKey);

  // Filter for games with valid stat data
  const validGames = gameLog.filter(g => getStatValue(g.stats, statKey) !== null);
  if (validGames.length === 0) {
    return null;
  }

  // Season average
  const allValues = validGames.map(g => getStatValue(g.stats, statKey));
  const computedAvg = allValues.reduce((a, b) => a + b, 0) / allValues.length;
  const avg = seasonVal || computedAvg;

  // Last 5 / 10 / 20 games
  const last5 = allValues.slice(0, 5);
  const last10 = allValues.slice(0, 10);
  const last20 = allValues.slice(0, 20);
  const avg5 = last5.length ? last5.reduce((a, b) => a + b, 0) / last5.length : avg;
  const avg10 = last10.length ? last10.reduce((a, b) => a + b, 0) / last10.length : avg;
  const avg20 = last20.length ? last20.reduce((a, b) => a + b, 0) / last20.length : avg;

  // Hit rate over the line
  const overCount = allValues.filter(v => v > propLine).length;
  const hitRateSeason = allValues.length ? overCount / allValues.length : 0.5;
  const overCount5 = last5.filter(v => v > propLine).length;
  const hitRate5 = last5.length ? overCount5 / last5.length : hitRateSeason;
  const overCount10 = last10.filter(v => v > propLine).length;
  const hitRate10 = last10.length ? overCount10 / last10.length : hitRateSeason;

  // vs. Opponent (this season)
  const vsOpp = validGames.filter(g => String(g.opponentId) === String(opponentId));
  const vsOppValues = vsOpp.map(g => getStatValue(g.stats, statKey));
  const vsOppAvg = vsOppValues.length ? vsOppValues.reduce((a, b) => a + b, 0) / vsOppValues.length : null;
  const vsOppHitRate = vsOppValues.length ? vsOppValues.filter(v => v > propLine).length / vsOppValues.length : null;

  // Home/Away
  const homeGames = validGames.filter(g => g.homeAway === 'home');
  const awayGames = validGames.filter(g => g.homeAway === 'away');
  const homeValues = homeGames.map(g => getStatValue(g.stats, statKey));
  const awayValues = awayGames.map(g => getStatValue(g.stats, statKey));
  const homeAvg = homeValues.length ? homeValues.reduce((a, b) => a + b, 0) / homeValues.length : avg;
  const awayAvg = awayValues.length ? awayValues.reduce((a, b) => a + b, 0) / awayValues.length : avg;

  // Trend (is the player trending up or down?)
  const trend5VsSeason = avg5 - avg;
  const trending = trend5VsSeason > 1 ? 'up' : trend5VsSeason < -1 ? 'down' : 'stable';

  // Consistency (standard deviation)
  const variance = allValues.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / allValues.length;
  const stdDev = Math.sqrt(variance);

  // ── Confidence Score ──
  // Weighted average of multiple signals to determine over/under probability
  let overProbability = 0;
  let totalWeight = 0;

  // Season hit rate (weight 25%)
  overProbability += hitRateSeason * 25;
  totalWeight += 25;

  // Last 10 hit rate (weight 30% — recent form matters most)
  overProbability += hitRate10 * 30;
  totalWeight += 30;

  // Last 5 hit rate (weight 20%)
  overProbability += hitRate5 * 20;
  totalWeight += 20;

  // vs Opponent (weight 15% if data exists)
  if (vsOppHitRate !== null && vsOppValues.length >= 1) {
    overProbability += vsOppHitRate * 15;
    totalWeight += 15;
  }

  // Season avg vs line (weight 10%)
  const avgSignal = avg > propLine ? 0.65 : avg < propLine ? 0.35 : 0.5;
  overProbability += avgSignal * 10;
  totalWeight += 10;

  overProbability = overProbability / totalWeight;
  const underProbability = 1 - overProbability;

  // Determine recommendation
  let recommendation = 'skip';
  let confidence = 'low';
  const strongThreshold = 0.65;
  const medThreshold = 0.58;

  if (overProbability >= strongThreshold) {
    recommendation = 'OVER';
    confidence = overProbability >= 0.72 ? 'high' : 'medium';
  } else if (underProbability >= strongThreshold) {
    recommendation = 'UNDER';
    confidence = underProbability >= 0.72 ? 'high' : 'medium';
  } else if (overProbability >= medThreshold) {
    recommendation = 'LEAN OVER';
    confidence = 'low';
  } else if (underProbability >= medThreshold) {
    recommendation = 'LEAN UNDER';
    confidence = 'low';
  }

  return {
    statKey,
    propLine,
    seasonAvg: Math.round(avg * 10) / 10,
    avg5: Math.round(avg5 * 10) / 10,
    avg10: Math.round(avg10 * 10) / 10,
    avg20: Math.round(avg20 * 10) / 10,
    homeAvg: Math.round(homeAvg * 10) / 10,
    awayAvg: Math.round(awayAvg * 10) / 10,
    gamesPlayed: allValues.length,
    hitRateSeason: Math.round(hitRateSeason * 100),
    hitRate5: Math.round(hitRate5 * 100),
    hitRate10: Math.round(hitRate10 * 100),
    vsOpponent: vsOppValues.length > 0 ? {
      games: vsOppValues.length,
      avg: Math.round(vsOppAvg * 10) / 10,
      hitRate: Math.round(vsOppHitRate * 100),
      values: vsOppValues,
    } : null,
    trending,
    stdDev: Math.round(stdDev * 10) / 10,
    overProbability: Math.round(overProbability * 100),
    underProbability: Math.round(underProbability * 100),
    recommendation,
    confidence,
  };
}

/**
 * Full analysis for a player in a given game — returns analysis for all stat categories.
 */
async function analyzePlayerForGame(playerId, opponentTeamId, propLines = {}) {
  const playerStats = await getPlayerStats(playerId);
  if (!playerStats.gameLog.length) {
    return { error: 'No game log data found for this player' };
  }

  const results = {};
  for (const cat of STAT_CATEGORIES) {
    const line = propLines[cat.key];
    if (line === undefined || line === null) continue;
    const analysis = analyzePlayerProp(playerStats, cat.key, parseFloat(line), opponentTeamId);
    if (analysis) {
      results[cat.key] = { ...analysis, label: cat.label, shortLabel: cat.shortLabel };
    }
  }

  return {
    playerId,
    gameLog: playerStats.gameLog.slice(0, 10), // Last 10 for display
    seasonAvg: playerStats.seasonAvg,
    analyses: results,
  };
}

/**
 * Auto-analyze: for a player, find "interesting" lines based on season avg
 * and generate analysis for each stat without requiring manual prop lines.
 */
async function autoAnalyzePlayer(playerId, opponentTeamId) {
  const playerStats = await getPlayerStats(playerId);
  if (!playerStats.gameLog.length) {
    return { error: 'No game log data found for this player' };
  }

  const results = {};
  for (const cat of STAT_CATEGORIES) {
    const validGames = playerStats.gameLog.filter(g => getStatValue(g.stats, cat.key) !== null);
    if (validGames.length < 5) continue;

    const values = validGames.map(g => getStatValue(g.stats, cat.key));
    const avg = values.reduce((a, b) => a + b, 0) / values.length;

    // Generate a typical betting line (round to nearest 0.5)
    const propLine = Math.round(avg * 2) / 2;
    if (propLine <= 0) continue;

    const analysis = analyzePlayerProp(playerStats, cat.key, propLine, opponentTeamId);
    if (analysis) {
      results[cat.key] = { ...analysis, label: cat.label, shortLabel: cat.shortLabel };
    }
  }

  return {
    playerId,
    gameLog: playerStats.gameLog.slice(0, 10),
    seasonAvg: playerStats.seasonAvg,
    analyses: results,
  };
}

module.exports = {
  getTodaysNBAGames,
  getTeamRoster,
  getPlayerStats,
  getTeamDefensiveStats,
  analyzePlayerProp,
  analyzePlayerForGame,
  autoAnalyzePlayer,
  STAT_CATEGORIES,
};
