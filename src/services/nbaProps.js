/**
 * NBA Player Props Analysis Service
 * Uses ESPN APIs for player stats + The Odds API for real sportsbook lines.
 *
 * Fetches player season stats, game logs, matchup history,
 * and real prop lines from DraftKings/FanDuel to generate
 * data-driven prop recommendations.
 */

// ── Cache ──
const cache = new Map();
const CACHE_TTL = 5 * 60_000; // 5 min
const ODDS_CACHE_TTL = 30 * 60_000; // 30 min — real lines don't change that fast

function getCached(key) {
  const e = cache.get(key);
  if (e && Date.now() - e.ts < CACHE_TTL) return e.data;
  return null;
}
function getCachedOdds(key) {
  const e = cache.get(key);
  if (e && Date.now() - e.ts < ODDS_CACHE_TTL) return e.data;
  return null;
}
function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

// ── The Odds API (real sportsbook lines) ──
const ODDS_API_KEY = process.env.ODDS_API_KEY || '';
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

// Map our internal stat keys to Odds API market keys
const STAT_TO_MARKET = {
  pts: 'player_points',
  reb: 'player_rebounds',
  ast: 'player_assists',
  fg3: 'player_threes',
};

// Reverse map: market key → our stat key
const MARKET_TO_STAT = {};
for (const [k, v] of Object.entries(STAT_TO_MARKET)) MARKET_TO_STAT[v] = k;

/**
 * Normalize a player name for fuzzy matching
 * "LeBron James" → "lebron james"
 * "P.J. Washington" → "pj washington"
 */
function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[.']/g, '')   // remove periods and apostrophes
    .replace(/\s+/g, ' ')   // collapse whitespace
    .trim();
}

/**
 * Fetch today's NBA events from The Odds API (FREE — no quota cost)
 */
async function fetchOddsApiEvents() {
  if (!ODDS_API_KEY) return [];
  const cacheKey = 'odds-api-events';
  const cached = getCachedOdds(cacheKey);
  if (cached) return cached;

  try {
    const url = `${ODDS_API_BASE}/sports/basketball_nba/events?apiKey=${ODDS_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[Props] Odds API events ${res.status}: ${res.statusText}`);
      return [];
    }
    const events = await res.json();
    setCache(cacheKey, events);
    console.log(`[Props] Odds API: ${events.length} NBA events found`);
    return events;
  } catch (err) {
    console.error('[Props] Odds API events error:', err.message);
    return [];
  }
}

/**
 * Fetch player props for a single event from The Odds API.
 * Markets: player_points, player_rebounds, player_assists, player_threes
 * Cost: 4 credits per event (4 markets × 1 region)
 */
async function fetchEventProps(eventId) {
  if (!ODDS_API_KEY) return null;
  const cacheKey = `odds-props-${eventId}`;
  const cached = getCachedOdds(cacheKey);
  if (cached) return cached;

  const markets = Object.values(STAT_TO_MARKET).join(',');
  const url = `${ODDS_API_BASE}/sports/basketball_nba/events/${eventId}/odds`
    + `?apiKey=${ODDS_API_KEY}&regions=us&markets=${markets}&oddsFormat=american&bookmakers=draftkings,fanduel`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[Props] Odds API event props ${res.status}: ${res.statusText}`);
      // Log remaining quota
      const remaining = res.headers.get('x-requests-remaining');
      if (remaining) console.log(`[Props] Odds API quota remaining: ${remaining}`);
      return null;
    }

    const remaining = res.headers.get('x-requests-remaining');
    const used = res.headers.get('x-requests-used');
    console.log(`[Props] Odds API quota: ${used} used, ${remaining} remaining`);

    const data = await res.json();
    setCache(cacheKey, data);
    return data;
  } catch (err) {
    console.error('[Props] Odds API event props error:', err.message);
    return null;
  }
}

/**
 * Fetch all player prop lines for today's games.
 * Returns a map: { "lebron james": { pts: 25.5, reb: 7.5, ast: 8.5, fg3: 2.5 }, ... }
 * Each entry also has odds: { "lebron james": { pts: { line: 25.5, overOdds: -110, underOdds: -110, book: "draftkings" } } }
 */
async function fetchAllTodaysProps() {
  const cacheKey = 'all-todays-props';
  const cached = getCachedOdds(cacheKey);
  if (cached) return cached;

  if (!ODDS_API_KEY) {
    console.log('[Props] No ODDS_API_KEY set — using generated lines');
    return null;
  }

  const events = await fetchOddsApiEvents();
  if (!events.length) return null;

  // Filter to today's events only (not yet started or recently started)
  const now = new Date();
  const todayEvents = events.filter(ev => {
    const start = new Date(ev.commence_time);
    const diffHours = (start - now) / (1000 * 60 * 60);
    return diffHours > -3 && diffHours < 24; // within a reasonable window
  });

  console.log(`[Props] Fetching props for ${todayEvents.length} events...`);

  const propMap = {}; // normalized player name → { pts: {line, overOdds, underOdds, book}, ... }

  for (const event of todayEvents) {
    const data = await fetchEventProps(event.id);
    if (!data || !data.bookmakers) continue;

    // Prefer DraftKings, fall back to FanDuel, fall back to first available
    const dk = data.bookmakers.find(b => b.key === 'draftkings');
    const fd = data.bookmakers.find(b => b.key === 'fanduel');
    const book = dk || fd || data.bookmakers[0];
    if (!book) continue;

    const bookName = book.title || book.key;

    for (const market of (book.markets || [])) {
      const statKey = MARKET_TO_STAT[market.key];
      if (!statKey) continue;

      for (const outcome of (market.outcomes || [])) {
        if (outcome.name !== 'Over' || outcome.point === undefined) continue;

        const playerName = normalizeName(outcome.description);
        if (!playerName) continue;

        if (!propMap[playerName]) propMap[playerName] = {};
        propMap[playerName][statKey] = {
          line: outcome.point,
          overOdds: outcome.price,
          underOdds: null, // will fill below
          book: bookName,
        };
      }

      // Fill underOdds
      for (const outcome of (market.outcomes || [])) {
        if (outcome.name !== 'Under' || outcome.point === undefined) continue;
        const playerName = normalizeName(outcome.description);
        if (propMap[playerName]?.[statKey]) {
          propMap[playerName][statKey].underOdds = outcome.price;
        }
      }
    }
  }

  const playerCount = Object.keys(propMap).length;
  console.log(`[Props] Got real prop lines for ${playerCount} players`);
  setCache(cacheKey, propMap);
  return propMap;
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

  // Correct ESPN gamelog endpoint (site.api, NOT site.web.api)
  const logUrl = `https://site.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${playerId}/gamelog`;

  try {
    const logRes = await fetch(logUrl).then(r => r.ok ? r.json() : null).catch(() => null);
    if (!logRes) {
      return { seasonAvg: {}, gameLog: [], playerId };
    }

    // Stat column labels (e.g. ['MIN','FG','FG%','3PT','3P%','FT','FT%','REB','AST','BLK','STL','PF','TO','PTS'])
    const labels = (logRes.labels || []).map(l => l.toLowerCase());
    const names = (logRes.names || []).map(n => n.toLowerCase());

    // Build label→index map for the stats we care about
    // labels: MIN, FG, FG%, 3PT, 3P%, FT, FT%, REB, AST, BLK, STL, PF, TO, PTS
    const labelMap = {};
    labels.forEach((l, i) => { labelMap[l] = i; });

    // Map from our stat keys to gamelog label indices
    const STAT_LABEL_MAP = {
      min: labelMap['min'],
      pts: labelMap['pts'],
      reb: labelMap['reb'],
      ast: labelMap['ast'],
      blk: labelMap['blk'],
      stl: labelMap['stl'],
      to: labelMap['to'],
      fg3: labelMap['3pt'],  // "3PT" label contains "made-attempted"
      pf: labelMap['pf'],
      fg: labelMap['fg'],
    };

    // Parse a raw stats array into our stat object
    function parseStats(statsArr) {
      const result = {};
      for (const [key, idx] of Object.entries(STAT_LABEL_MAP)) {
        if (idx === undefined || !statsArr[idx]) continue;
        const raw = String(statsArr[idx]);
        // Handle "made-attempted" format (e.g. "7-16" for 3PT)
        if (raw.includes('-') && key !== 'min') {
          const parts = raw.split('-');
          result[key] = parseFloat(parts[0]); // just the "made" value
        } else {
          const val = parseFloat(raw);
          if (!isNaN(val)) result[key] = val;
        }
      }
      return result;
    }

    // Events map: eventId → {gameDate, opponent, atVs, gameResult, ...}
    const eventsMap = logRes.events || {};

    // Parse season averages from the "Regular Season" seasonType summary
    let seasonAvg = {};
    const regSeason = (logRes.seasonTypes || []).find(st =>
      st.displayName?.toLowerCase().includes('regular')
    );

    if (regSeason?.summary?.stats) {
      const avgRow = regSeason.summary.stats.find(s => s.type === 'avg');
      if (avgRow?.stats) {
        seasonAvg = parseStats(avgRow.stats);
      }
    }

    // Collect game log entries from regular season categories (months)
    // Categories are ordered most-recent-first: [april, march, feb, ...]
    // Events within each category are also most-recent-first
    let gameLog = [];

    if (regSeason?.categories) {
      for (const monthCat of regSeason.categories) {
        // Skip the "Regular Season" totals row (no events)
        if (!monthCat.events || monthCat.events.length === 0) continue;

        for (const catEvent of monthCat.events) {
          const eventId = catEvent.eventId;
          const eventInfo = eventsMap[eventId] || {};
          const stats = parseStats(catEvent.stats || []);

          if (Object.keys(stats).length === 0) continue;

          gameLog.push({
            date: eventInfo.gameDate || null,
            opponent: eventInfo.opponent?.abbreviation || eventInfo.opponent?.displayName || '',
            opponentFull: eventInfo.opponent?.displayName || '',
            opponentId: eventInfo.opponent?.id || '',
            homeAway: eventInfo.atVs === 'vs' ? 'home' : 'away',
            result: eventInfo.gameResult || '',
            score: eventInfo.score || '',
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

/**
 * Generate top 5 OVER and top 5 UNDER picks across all of today's games.
 * Now fetches REAL sportsbook lines from The Odds API (DraftKings/FanDuel).
 * Falls back to generated lines if no API key is configured.
 */
async function generateTopPicks() {
  const cacheKey = 'top-picks-today';
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const games = await getTodaysNBAGames();
  if (!games.length) return { overs: [], unders: [], gamesScanned: 0, playersScanned: 0 };

  // Fetch real prop lines from The Odds API (returns null if no key)
  const realProps = await fetchAllTodaysProps();
  const usingRealLines = !!realProps;
  console.log(`[Props] Using ${usingRealLines ? 'REAL sportsbook' : 'generated'} prop lines`);

  // Collect all (player, opponentId, game) tuples
  const playerTasks = [];
  for (const game of games) {
    const [awayRoster, homeRoster] = await Promise.all([
      getTeamRoster(game.away.id),
      getTeamRoster(game.home.id),
    ]);
    for (const p of awayRoster) {
      playerTasks.push({ player: p, opponentId: game.home.id, game, teamName: game.away.name, teamAbbr: game.away.abbreviation });
    }
    for (const p of homeRoster) {
      playerTasks.push({ player: p, opponentId: game.away.id, game, teamName: game.home.name, teamAbbr: game.home.abbreviation });
    }
  }

  // Analyze players in batches of 6 to avoid hammering ESPN
  const allPicks = [];
  let playersScanned = 0;
  const BATCH_SIZE = 6;

  for (let i = 0; i < playerTasks.length; i += BATCH_SIZE) {
    const batch = playerTasks.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async ({ player, opponentId, game, teamName, teamAbbr }) => {
        const stats = await getPlayerStats(player.id);
        // Filter: need enough games and meaningful minutes
        if (stats.gameLog.length < 10) return null;
        const avgMin = getStatValue(stats.seasonAvg, 'min');
        if (avgMin !== null && avgMin < 15) return null;

        playersScanned++;

        // Look up real prop lines for this player
        const playerNameNorm = normalizeName(player.name);
        const playerProps = realProps ? realProps[playerNameNorm] : null;

        // Run analysis on key stat categories (PTS, REB, AST, 3PM)
        const keyCats = STAT_CATEGORIES.filter(c => ['pts', 'reb', 'ast', 'fg3'].includes(c.key));
        const picks = [];
        for (const cat of keyCats) {
          const validGames = stats.gameLog.filter(g => getStatValue(g.stats, cat.key) !== null);
          if (validGames.length < 10) continue;

          const values = validGames.map(g => getStatValue(g.stats, cat.key));
          const avg = values.reduce((a, b) => a + b, 0) / values.length;

          // Use REAL line from sportsbook, or fall back to generated
          let propLine;
          let lineSource = 'generated';
          let bookOdds = null;

          if (playerProps && playerProps[cat.key]) {
            propLine = playerProps[cat.key].line;
            lineSource = playerProps[cat.key].book || 'sportsbook';
            bookOdds = {
              over: playerProps[cat.key].overOdds,
              under: playerProps[cat.key].underOdds,
              book: playerProps[cat.key].book,
            };
          } else {
            // No sportsbook line available — generate from average
            propLine = Math.round(avg * 2) / 2;
          }

          if (propLine <= 0) continue;

          const analysis = analyzePlayerProp(stats, cat.key, propLine, opponentId);
          if (!analysis) continue;

          picks.push({
            player: { id: player.id, name: player.name, position: player.position, headshot: player.headshot },
            teamName,
            teamAbbr,
            matchup: `${game.away.abbreviation} @ ${game.home.abbreviation}`,
            gameId: game.id,
            stat: cat,
            analysis,
            lineSource,
            bookOdds,
          });
        }
        return picks;
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        allPicks.push(...r.value);
      }
    }
  }

  // Sort for best overs (highest overProbability) and best unders (highest underProbability)
  // Prioritize picks with real sportsbook lines over generated ones
  const overCandidates = allPicks
    .filter(p => p.analysis.overProbability >= 58)
    .sort((a, b) => {
      // Real lines first, then by probability
      if (a.lineSource !== 'generated' && b.lineSource === 'generated') return -1;
      if (a.lineSource === 'generated' && b.lineSource !== 'generated') return 1;
      return b.analysis.overProbability - a.analysis.overProbability;
    });

  const underCandidates = allPicks
    .filter(p => p.analysis.underProbability >= 58)
    .sort((a, b) => {
      if (a.lineSource !== 'generated' && b.lineSource === 'generated') return -1;
      if (a.lineSource === 'generated' && b.lineSource !== 'generated') return 1;
      return b.analysis.underProbability - a.analysis.underProbability;
    });

  const result = {
    overs: overCandidates.slice(0, 5),
    unders: underCandidates.slice(0, 5),
    gamesScanned: games.length,
    playersScanned,
    totalAnalyzed: allPicks.length,
    usingRealLines,
    generatedAt: new Date().toISOString(),
  };

  setCache(cacheKey, result);
  return result;
}

/**
 * Resolve unresolved picks by fetching ESPN box scores.
 * Looks up each game's summary to find the player's actual stats.
 */
async function resolvePicksFromESPN(unresolvedPicks) {
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

      // Build a map of playerId -> stats from box score
      const playerStatsMap = {};
      const boxscore = summary.boxscore;
      if (boxscore?.players) {
        for (const team of boxscore.players) {
          // team.statistics[0] has the stat categories
          const statLabels = (team.statistics?.[0]?.labels || []).map(l => l.toLowerCase());
          for (const athlete of (team.statistics?.[0]?.athletes || [])) {
            const pid = athlete.athlete?.id;
            if (!pid) continue;
            const stats = {};
            (athlete.stats || []).forEach((val, idx) => {
              if (statLabels[idx]) {
                const raw = String(val);
                // Handle "made-attempted" format
                if (raw.includes('-') && statLabels[idx] !== 'min') {
                  stats[statLabels[idx]] = parseFloat(raw.split('-')[0]);
                } else {
                  const num = parseFloat(raw);
                  if (!isNaN(num)) stats[statLabels[idx]] = num;
                }
              }
            });
            playerStatsMap[pid] = stats;
          }
        }
      }

      // Resolve each pick for this game
      for (const pick of picks) {
        const pStats = playerStatsMap[pick.player_id];
        if (!pStats) continue;

        // Map our stat_key to the box score key
        const BOX_MAP = { pts: 'pts', reb: 'reb', ast: 'ast', fg3: '3pt', stl: 'stl', blk: 'blk', to: 'to' };
        const boxKey = BOX_MAP[pick.stat_key] || pick.stat_key;
        let actualValue = pStats[boxKey];
        if (actualValue === undefined) actualValue = pStats[pick.stat_key];
        if (actualValue === undefined) continue;

        resolutions.push({ pickId: pick.id, actualValue });
      }
    } catch (err) {
      console.error(`[Props] Failed to resolve game ${gameId}:`, err.message);
    }
  }

  return resolutions;
}

module.exports = {
  getTodaysNBAGames,
  getTeamRoster,
  getPlayerStats,
  getTeamDefensiveStats,
  analyzePlayerProp,
  analyzePlayerForGame,
  autoAnalyzePlayer,
  generateTopPicks,
  resolvePicksFromESPN,
  fetchAllTodaysProps,
  STAT_CATEGORIES,
};
