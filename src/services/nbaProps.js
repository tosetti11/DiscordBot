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
      fga: labelMap['fg'],   // We'll extract attempts from the "made-attempted" fg column
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
          if (key === 'fga') {
            // For fga, extract the ATTEMPTED (second) value from "made-attempted"
            result[key] = parseFloat(parts[1]);
          } else {
            result[key] = parseFloat(parts[0]); // just the "made" value
          }
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
 * Get full team stats (offensive, defensive, general).
 * Returns per-game averages + totals for pace calculation.
 */
async function getTeamFullStats(teamId) {
  const cacheKey = `team-full-stats-${teamId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const season = new Date().getMonth() >= 9 ? new Date().getFullYear() + 1 : new Date().getFullYear();

  try {
    // Fetch both endpoints in parallel: team record (avgPointsAgainst) + team statistics (totals)
    const [recordRes, statsRes] = await Promise.all([
      fetch(`https://site.api.espn.com/apis/site/v2/sports/${ESPN_NBA}/teams/${teamId}`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`https://site.api.espn.com/apis/site/v2/sports/${ESPN_NBA}/teams/${teamId}/statistics?season=${season}`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]);

    // Parse record stats (avgPointsFor, avgPointsAgainst, gamesPlayed)
    const recStats = {};
    const recItems = recordRes?.team?.record?.items?.[0]?.stats || [];
    for (const s of recItems) {
      recStats[s.name] = s.value;
    }

    // Parse team totals from statistics endpoint
    const totals = {};
    const cats = statsRes?.results?.stats?.categories || statsRes?.statistics?.splits?.categories || [];
    for (const cat of (Array.isArray(cats) ? cats : [])) {
      const catName = (cat.displayName || '').toLowerCase();
      for (const stat of (cat.stats || [])) {
        const key = (stat.abbreviation || stat.name || '').toLowerCase();
        if (key) totals[`${catName}_${key}`] = stat.value;
      }
    }

    const gp = recStats.gamesPlayed || 82;

    // Compute pace: Pace ≈ (FGA + 0.44 * FTA - ORB + TO) per game
    const fga = totals['offensive_fga'] || 0;
    const fta = totals['offensive_fta'] || 0;
    const orb = totals['offensive_or'] || totals['defensive_or'] || 0;
    const to  = totals['offensive_to'] || 0;
    const possessions = fga + 0.44 * fta - orb + to;
    const pace = possessions / gp;

    // Opponent-allowed per-game averages
    // ESPN doesn't give opponent stats by category, so we use avgPointsAgainst
    // and estimate opponent rebounds/assists from the team's defensive stats
    const ptsAllowed = recStats.avgPointsAgainst || 110;
    const ptsFor = recStats.avgPointsFor || 110;

    // For rebounds allowed: league avg ~44 RPG. We approximate from Defensive Rebounds
    // (opponent's ORB ≈ team's total REB - team's DRB; but we only have totals)
    // Better: use the team's points-allowed ratio vs league avg as a general defensive multiplier
    const rebTotal = totals['general_reb'] || 0;
    const dReb = totals['defensive_dr'] || 0;
    const astTotal = totals['offensive_ast'] || 0;
    const blkTotal = totals['defensive_blk'] || 0;
    const stlTotal = totals['defensive_stl'] || 0;
    const fg3Total = totals['offensive_3pm'] || 0;

    const result = {
      teamId,
      gp,
      pace: Math.round(pace * 10) / 10,
      avgPtsFor: ptsFor,
      avgPtsAllowed: ptsAllowed,
      // Per-game own stats (for understanding team context)
      rebPG: Math.round((rebTotal / gp) * 10) / 10,
      astPG: Math.round((astTotal / gp) * 10) / 10,
      blkPG: Math.round((blkTotal / gp) * 10) / 10,
      stlPG: Math.round((stlTotal / gp) * 10) / 10,
      fg3PG: Math.round((fg3Total / gp) * 10) / 10,
      dRebPG: Math.round((dReb / gp) * 10) / 10,
      // Raw totals for calcs
      totals,
    };

    setCache(cacheKey, result);
    return result;
  } catch (err) {
    console.error('[Props] Team full stats error:', err.message);
    return null;
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

/**
 * Build matchup context for a game.
 * Fetches both teams' stats and computes:
 *   - Pace factor (game pace vs league avg ~98)
 *   - Defensive multiplier (opponent's pts allowed vs league avg ~112)
 *   - Implied team total (from Vegas lines)
 *   - Back-to-back detection
 *
 * @param {string} opponentTeamId - The opponent's ESPN team ID
 * @param {string} playerTeamId - The player's own team ID
 * @param {Object} gameOdds - { spread, overUnder } from ESPN scoreboard
 * @param {Array} gameLog - Player's game log for B2B detection
 * @param {string} homeAway - 'home' or 'away' (player's side)
 * @returns {Object} matchupContext
 */
async function buildMatchupContext(opponentTeamId, playerTeamId, gameOdds, gameLog, homeAway) {
  const NBA_AVG_PACE = 99.0;  // ~2025-26 league avg possessions/game
  const NBA_AVG_PPG = 112.0;  // ~2025-26 league avg points/game

  // Fetch both teams' stats in parallel
  const [oppStats, playerTeamStats] = await Promise.all([
    getTeamFullStats(opponentTeamId),
    getTeamFullStats(playerTeamId),
  ]);

  // ── 1. Pace Factor ──
  // Average both teams' pace to estimate game pace, compare to league avg
  const oppPace = oppStats?.pace || NBA_AVG_PACE;
  const ownPace = playerTeamStats?.pace || NBA_AVG_PACE;
  const gamePace = (oppPace + ownPace) / 2;
  const paceMultiplier = gamePace / NBA_AVG_PACE; // >1 = fast, <1 = slow

  // ── 2. Defensive Multiplier ──
  // How many pts the opponent allows vs league avg
  const oppPtsAllowed = oppStats?.avgPtsAllowed || NBA_AVG_PPG;
  const defMultiplier = oppPtsAllowed / NBA_AVG_PPG; // >1 = weak defense, <1 = strong defense

  // ── 3. Implied Team Total ──
  // From Vegas: impliedTotal = (overUnder / 2) ± (spread / 2)
  // Spread: negative means favored. E.g. "BOS -5.5" means BOS favored.
  // For the player's team: if they're favored, add half the spread; else subtract
  let impliedTotal = null;
  if (gameOdds?.overUnder) {
    const ou = parseFloat(gameOdds.overUnder);
    // Parse spread — format "BOS -5.5" or just "-5.5"
    let spreadVal = 0;
    if (gameOdds.spread) {
      const spreadMatch = gameOdds.spread.match(/([-+]?\d+\.?\d*)/);
      if (spreadMatch) {
        spreadVal = parseFloat(spreadMatch[1]);
        // ESPN spread is for the favorite. If the spread text contains the player's
        // team abbreviation, they're the favored side.
        // For simplicity: spread is negative for favorite. The team listed is the favorite.
        // We'll adjust based on homeAway vs which team is in the spread text.
      }
    }
    // Simple implied total: ou/2 gives average per team
    // Then adjust by spread/2 (favorite scores more, underdog less)
    // If we can't determine sides, just use ou/2
    impliedTotal = ou / 2;
    // Note: Positive spread adjustment for favorite, negative for underdog
    // For now use simple ou/2 — still very useful as a game-environment signal
  }

  // ── 4. Back-to-Back Detection ──
  const isB2B = detectBackToBack(gameLog);

  return {
    // Pace
    gamePace: Math.round(gamePace * 10) / 10,
    paceMultiplier: Math.round(paceMultiplier * 1000) / 1000,
    oppPace: Math.round(oppPace * 10) / 10,
    ownPace: Math.round(ownPace * 10) / 10,
    paceLabel: gamePace >= 102 ? 'fast' : gamePace <= 96 ? 'slow' : 'average',

    // Defense
    defMultiplier: Math.round(defMultiplier * 1000) / 1000,
    oppPtsAllowed: Math.round(oppPtsAllowed * 10) / 10,
    defLabel: defMultiplier >= 1.04 ? 'weak defense' : defMultiplier <= 0.96 ? 'strong defense' : 'average defense',

    // Implied total
    impliedTotal: impliedTotal ? Math.round(impliedTotal * 10) / 10 : null,
    overUnder: gameOdds?.overUnder || null,

    // B2B
    isB2B,

    // Raw team stats for potential future use
    oppStats,
    playerTeamStats,
  };
}

/**
 * Fetch all NBA team injuries from ESPN.
 * Returns a map: { teamId: [{ playerId, playerName, status, comment }], ... }
 * Only includes players with status "Out" (not Day-To-Day or Questionable).
 */
async function fetchTeamInjuries() {
  const cacheKey = 'nba-injuries';
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${ESPN_NBA}/injuries`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN injuries ${res.status}`);
    const json = await res.json();

    const injuryMap = {}; // teamId → [{ playerId, playerName, status }]
    for (const team of (json.injuries || [])) {
      const teamId = String(team.id);
      const outs = (team.injuries || [])
        .filter(inj => inj.status === 'Out')
        .map(inj => ({
          playerId: inj.athlete?.id || null,
          playerName: inj.athlete?.displayName || 'Unknown',
          status: inj.status,
          comment: inj.shortComment || '',
        }));
      if (outs.length) injuryMap[teamId] = outs;
    }

    console.log(`[Props] Injuries: ${Object.values(injuryMap).flat().length} players OUT across ${Object.keys(injuryMap).length} teams`);
    setCache(cacheKey, injuryMap);
    return injuryMap;
  } catch (err) {
    console.error('[Props] Injuries fetch error:', err.message);
    return {};
  }
}

/**
 * Identify key players on a team and compute their "impact share".
 * Uses season averages to estimate how much of the team's offense flows through each player.
 * Returns sorted by PPG descending.
 */
async function getTeamKeyPlayers(teamId) {
  const cacheKey = `key-players-${teamId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const roster = await getTeamRoster(teamId);
  const keyPlayers = [];

  // Fetch stats for top roster players (limit to avoid too many API calls)
  const statsPromises = roster.slice(0, 15).map(async (p) => {
    try {
      const stats = await getPlayerStats(p.id);
      const ppg = getStatValue(stats.seasonAvg, 'pts');
      const apg = getStatValue(stats.seasonAvg, 'ast');
      const rpg = getStatValue(stats.seasonAvg, 'reb');
      const mpg = getStatValue(stats.seasonAvg, 'min');
      const fga = getStatValue(stats.seasonAvg, 'fga') || getStatValue(stats.seasonAvg, 'fg');
      if (ppg !== null && ppg > 0) {
        keyPlayers.push({
          id: p.id,
          name: p.name,
          ppg: ppg || 0,
          apg: apg || 0,
          rpg: rpg || 0,
          mpg: mpg || 0,
          fga: fga || 0,
        });
      }
    } catch (e) { /* skip */ }
  });

  await Promise.all(statsPromises);
  keyPlayers.sort((a, b) => b.ppg - a.ppg);

  setCache(cacheKey, keyPlayers);
  return keyPlayers;
}

/**
 * Calculate "role expansion factor" for a player when key teammates are out.
 * Returns a multiplier > 1.0 if the player is likely to see expanded role.
 *
 * Logic:
 *   - For each OUT teammate, calculate their share of team offense
 *   - Remaining players absorb that share proportionally
 *   - The "boost" is how much more usage/minutes the analyzed player gets
 *
 * @param {string} playerId - The player being analyzed
 * @param {string} teamId - The player's team
 * @param {Object} injuryMap - From fetchTeamInjuries()
 * @returns {{ factor: number, outPlayers: string[], totalPPGOut: number }}
 */
async function calcRoleExpansion(playerId, teamId, injuryMap) {
  const teamInjuries = injuryMap[teamId];
  if (!teamInjuries || !teamInjuries.length) {
    return { factor: 1.0, outPlayers: [], totalPPGOut: 0 };
  }

  const keyPlayers = await getTeamKeyPlayers(teamId);
  if (!keyPlayers.length) return { factor: 1.0, outPlayers: [], totalPPGOut: 0 };

  // Find which key players are OUT
  const outPlayerIds = new Set(teamInjuries.map(inj => String(inj.playerId)));
  const outKeyPlayers = keyPlayers.filter(kp => outPlayerIds.has(String(kp.id)));

  if (!outKeyPlayers.length) return { factor: 1.0, outPlayers: [], totalPPGOut: 0 };

  // Don't apply expansion if the analyzed player is the one who's out
  if (outPlayerIds.has(String(playerId))) {
    return { factor: 1.0, outPlayers: [], totalPPGOut: 0 };
  }

  // Calculate total PPG of OUT players
  const totalPPGOut = outKeyPlayers.reduce((s, p) => s + p.ppg, 0);
  const outNames = outKeyPlayers.map(p => p.name);

  // Find the analyzed player in the key players list
  const thisPlayer = keyPlayers.find(kp => String(kp.id) === String(playerId));
  if (!thisPlayer) return { factor: 1.0, outPlayers: outNames, totalPPGOut };

  // Calculate available players' total PPG (excluding OUT players)
  const availablePlayers = keyPlayers.filter(kp => !outPlayerIds.has(String(kp.id)));
  const availableTotalPPG = availablePlayers.reduce((s, p) => s + p.ppg, 0);

  if (availableTotalPPG <= 0) return { factor: 1.0, outPlayers: outNames, totalPPGOut };

  // Player's share of remaining offense
  const playerShare = thisPlayer.ppg / availableTotalPPG;

  // How much additional offense flows to this player
  // Assume ~60% of the OUT player's production gets redistributed (rest is lost efficiency)
  const redistributed = totalPPGOut * 0.6;
  const playerBoost = redistributed * playerShare;

  // Convert to a multiplier on the player's expected output
  const factor = 1 + (playerBoost / thisPlayer.ppg);

  // Cap at 1.35 (35% max expansion) to avoid extreme predictions
  const cappedFactor = Math.min(1.35, Math.max(1.0, factor));

  console.log(`[Props] Role expansion for ${thisPlayer.name}: ${cappedFactor.toFixed(3)}x ` +
    `(${outNames.join(', ')} OUT, ${totalPPGOut.toFixed(1)} PPG missing)`);

  return { factor: cappedFactor, outPlayers: outNames, totalPPGOut };
}

/**
 * Detect if the player is on the second night of a back-to-back.
 * Checks if the most recent game in their log was yesterday (ET).
 */
function detectBackToBack(gameLog) {
  if (!gameLog || !gameLog.length) return false;

  // Get the most recent game date
  const lastGame = gameLog[0];
  if (!lastGame?.date) return false;

  const lastDate = new Date(lastGame.date);
  // Compare to today in Eastern Time
  const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const yesterdayDate = new Date(todayET);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);
  const lastDateStr = lastDate.toISOString().slice(0, 10);

  return lastDateStr === yesterdayStr;
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
 * Calculate role-volatility score for a player (0–1).
 * Measures how stable a player's minutes and usage are.
 *   0.0–0.15 = rock-solid role (e.g. franchise player)
 *   0.15–0.30 = stable role
 *   0.30–0.50 = moderate volatility
 *   0.50+ = high volatility (bench/rotation risk)
 *
 * Uses coefficient of variation (stddev / mean) for both
 * minutes and FGA over the last 10 games, weighted 50/50.
 */
function calcVolatility(gameLog) {
  // Need at least 5 games to compute meaningful volatility
  const recent = gameLog.slice(0, 10);
  if (recent.length < 5) return { volatility: 0, minVol: 0, useVol: 0, label: 'unknown' };

  function coeffVar(values) {
    if (!values.length) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    if (mean === 0) return 0;
    const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
    return Math.sqrt(variance) / mean;
  }

  // Minutes volatility
  const minValues = recent.map(g => g.stats.min).filter(v => v != null && v > 0);
  const minVol = minValues.length >= 5 ? coeffVar(minValues) : 0;

  // Usage volatility (FGA as proxy for touches/usage)
  const fgaValues = recent.map(g => g.stats.fga).filter(v => v != null && v > 0);
  const useVol = fgaValues.length >= 5 ? coeffVar(fgaValues) : minVol; // fallback to minVol if no FGA data

  // Weighted combination (no context layer yet — just min + usage)
  const raw = 0.5 * minVol + 0.5 * useVol;
  // Clamp to 0–1
  const volatility = Math.min(1, Math.max(0, raw));

  // Human-readable label
  let label;
  if (volatility <= 0.15) label = 'very stable';
  else if (volatility <= 0.30) label = 'stable';
  else if (volatility <= 0.50) label = 'volatile';
  else label = 'very volatile';

  return {
    volatility: Math.round(volatility * 100) / 100,
    minVol: Math.round(minVol * 100) / 100,
    useVol: Math.round(useVol * 100) / 100,
    label,
  };
}

/**
 * Analyze a player for a specific stat category against a given opponent.
 * Returns hit rates, averages, trends, and a confidence score.
 */
function analyzePlayerProp(playerStats, statKey, propLine, opponentId, matchupCtx = null, roleCtx = null) {
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

  // ── Role Volatility ──
  const vol = calcVolatility(gameLog);

  // ── Build Matchup-Adjusted Projected Value ──
  // Start from recent average, then adjust with matchup factors
  let projectedValue = avg10; // L10 avg as baseline

  // Matchup adjustments (if context available)
  let paceAdj = 1.0;
  let defAdj = 1.0;
  let b2bAdj = 1.0;
  let impliedTotalAdj = 1.0;

  if (matchupCtx) {
    // ── 1. Pace Factor ──
    // Fast games inflate all counting stats proportionally
    // Weight: apply 50% of the pace differential (don't over-adjust)
    paceAdj = 1 + (matchupCtx.paceMultiplier - 1) * 0.5;

    // ── 2. Defensive Multiplier ──
    // Weak defense → boost, strong defense → diminish
    // For pts: use the multiplier directly
    // For reb/ast/fg3: dampen the effect (defense affects pts most)
    const defSensitivity = { pts: 0.6, reb: 0.3, ast: 0.4, fg3: 0.5, stl: 0.2, blk: 0.2, to: 0.2 };
    const sensitivity = defSensitivity[statKey] || 0.3;
    defAdj = 1 + (matchupCtx.defMultiplier - 1) * sensitivity;

    // ── 3. Implied Team Total ──
    // If Vegas projects a high-scoring game, all counting stats go up
    // Compare implied total to league avg (~112)
    if (matchupCtx.impliedTotal) {
      const impliedDiff = (matchupCtx.impliedTotal - 112) / 112;
      // Pts gets full effect, others damped
      const itSensitivity = { pts: 0.5, reb: 0.2, ast: 0.35, fg3: 0.4, stl: 0.1, blk: 0.1, to: 0.15 };
      impliedTotalAdj = 1 + impliedDiff * (itSensitivity[statKey] || 0.2);
    }

    // ── 4. Back-to-Back ──
    // Players average ~5-8% fewer counting stats on B2B
    if (matchupCtx.isB2B) {
      b2bAdj = 0.94; // 6% reduction
    }
  }

  // Apply all multipliers to get matchup-adjusted projection
  projectedValue = projectedValue * paceAdj * defAdj * impliedTotalAdj * b2bAdj;

  // ── 5. Role Expansion (Injury Impact) ──
  // When key teammates are OUT, remaining players absorb more usage/shots
  // This boosts the projected value and makes UNDER picks riskier
  let roleExpansionAdj = 1.0;
  let injuryFlag = false;
  let outTeammates = [];

  if (roleCtx && roleCtx.factor > 1.0) {
    roleExpansionAdj = roleCtx.factor;
    injuryFlag = true;
    outTeammates = roleCtx.outPlayers || [];
    projectedValue = projectedValue * roleExpansionAdj;
  }

  // ── Confidence Score ──
  // Weighted average of multiple signals to determine over/under probability
  let overProbability = 0;
  let totalWeight = 0;

  // Season hit rate (weight 20%)
  overProbability += hitRateSeason * 20;
  totalWeight += 20;

  // Last 10 hit rate (weight 25% — recent form)
  overProbability += hitRate10 * 25;
  totalWeight += 25;

  // Last 5 hit rate (weight 15%)
  overProbability += hitRate5 * 15;
  totalWeight += 15;

  // vs Opponent (weight 10% if data exists)
  if (vsOppHitRate !== null && vsOppValues.length >= 1) {
    overProbability += vsOppHitRate * 10;
    totalWeight += 10;
  }

  // Season avg vs line (weight 5%)
  const avgSignal = avg > propLine ? 0.65 : avg < propLine ? 0.35 : 0.5;
  overProbability += avgSignal * 5;
  totalWeight += 5;

  // ── 6. Matchup-Adjusted Projection vs Line (weight 25%) ──
  // This is the KEY signal — our adjusted projection compared to the prop line
  // Convert to a 0-1 signal based on how far the projection is from the line
  if (matchupCtx) {
    const projDiff = projectedValue - propLine;
    // Map difference to probability: each unit = ~8% confidence shift
    // Cap at 0.2–0.8 to avoid extreme signals
    const projSignal = Math.min(0.8, Math.max(0.2, 0.5 + projDiff * 0.08));
    overProbability += projSignal * 25;
    totalWeight += 25;
  } else {
    // Without matchup context, give more weight to season avg vs line
    overProbability += avgSignal * 15;
    totalWeight += 15;
  }

  overProbability = overProbability / totalWeight;

  // ── Apply volatility adjustment ──
  // Pull raw probability toward 50% based on volatility.
  const volAdj = 1 - vol.volatility;
  overProbability = 0.5 + (overProbability - 0.5) * volAdj;

  // ── Injury-based adjustment ──
  // When key teammates are OUT, shift probability toward OVER
  // The logic: if a 25 PPG teammate is out, this player gets more touches → OVER more likely
  if (injuryFlag && roleExpansionAdj > 1.0) {
    // Shift overProbability up proportionally to the expansion factor
    // E.g. 1.15x expansion → shift 5% toward OVER
    const injuryShift = (roleExpansionAdj - 1.0) * 0.35; // 35% of expansion as probability shift
    overProbability = Math.min(0.85, overProbability + injuryShift);
  }

  // ── Probability Cap (calibration correction) ──
  // Data shows 70%+ predicted only hits 64% — cap to prevent overconfidence
  // With generated lines, cap at 73%. With real sportsbook lines, allow up to 80%.
  const MAX_PROB = 0.73; // Will be overridden by caller if using real lines
  overProbability = Math.min(MAX_PROB, Math.max(1 - MAX_PROB, overProbability));

  let underProbability = 1 - overProbability;

  // ── UNDER penalty (calibration correction) ──
  // Data shows UNDERs hit 55% vs OVERs at 79% — apply a dampening factor
  // When using generated lines, UNDER is inherently harder (betting against player's own avg)
  // Pull under probability 5% toward 50%
  if (underProbability > 0.5) {
    underProbability = underProbability * 0.93 + 0.5 * 0.07; // 7% regression toward 50%
    overProbability = 1 - underProbability;
  }

  // Determine recommendation
  let recommendation = 'skip';
  let confidence = 'low';
  const strongThreshold = 0.65;
  const medThreshold = 0.58;

  if (overProbability >= strongThreshold) {
    recommendation = 'OVER';
    confidence = overProbability >= 0.70 ? 'high' : 'medium';
  } else if (underProbability >= strongThreshold) {
    recommendation = 'UNDER';
    // Unders need higher bar for "high" confidence due to historical underperformance
    confidence = underProbability >= 0.72 ? 'high' : 'medium';
  } else if (overProbability >= medThreshold) {
    recommendation = 'LEAN OVER';
    confidence = 'low';
  } else if (underProbability >= medThreshold) {
    recommendation = 'LEAN UNDER';
    confidence = 'low';
  }

  // ── Injury-based confidence downgrade ──
  // If key teammates are out and we're recommending UNDER, downgrade confidence
  if (injuryFlag && (recommendation === 'UNDER' || recommendation === 'LEAN UNDER')) {
    if (confidence === 'high') confidence = 'medium';
    else if (confidence === 'medium') confidence = 'low';
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
    volatility: vol.volatility,
    volatilityLabel: vol.label,
    minVol: vol.minVol,
    useVol: vol.useVol,
    // Matchup context
    projectedValue: Math.round(projectedValue * 10) / 10,
    matchup: matchupCtx ? {
      paceLabel: matchupCtx.paceLabel,
      gamePace: matchupCtx.gamePace,
      defLabel: matchupCtx.defLabel,
      oppPtsAllowed: matchupCtx.oppPtsAllowed,
      impliedTotal: matchupCtx.impliedTotal,
      isB2B: matchupCtx.isB2B,
      paceAdj: Math.round(paceAdj * 1000) / 1000,
      defAdj: Math.round(defAdj * 1000) / 1000,
      b2bAdj,
      impliedTotalAdj: Math.round(impliedTotalAdj * 1000) / 1000,
    } : null,
    // Injury / role expansion context
    injuryImpact: injuryFlag ? {
      roleExpansion: Math.round(roleExpansionAdj * 1000) / 1000,
      outPlayers: outTeammates,
      totalPPGOut: roleCtx?.totalPPGOut || 0,
    } : null,
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
 * Now fetches REAL sportsbook lines from The Odds API when available.
 */
async function autoAnalyzePlayer(playerId, opponentTeamId, playerName = null, gameCtx = null) {
  const playerStats = await getPlayerStats(playerId);
  if (!playerStats.gameLog.length) {
    return { error: 'No game log data found for this player' };
  }

  // Fetch real sportsbook lines
  const realProps = await fetchAllTodaysProps();
  let playerProps = null;
  if (realProps && playerName) {
    const nameNorm = normalizeName(playerName);
    playerProps = realProps[nameNorm] || null;
  }

  // Build matchup context if we have game info
  let matchupCtx = null;
  let roleCtx = null;
  if (gameCtx?.playerTeamId) {
    matchupCtx = await buildMatchupContext(
      opponentTeamId,
      gameCtx.playerTeamId,
      gameCtx.odds || null,
      playerStats.gameLog,
      gameCtx.homeAway || 'home'
    );

    // Check injuries for role expansion
    const injuryMap = await fetchTeamInjuries();
    roleCtx = await calcRoleExpansion(playerId, gameCtx.playerTeamId, injuryMap);
  }

  const results = {};
  for (const cat of STAT_CATEGORIES) {
    const validGames = playerStats.gameLog.filter(g => getStatValue(g.stats, cat.key) !== null);
    if (validGames.length < 5) continue;

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

    const analysis = analyzePlayerProp(playerStats, cat.key, propLine, opponentTeamId, matchupCtx, roleCtx);
    if (analysis) {
      results[cat.key] = { ...analysis, label: cat.label, shortLabel: cat.shortLabel, lineSource, bookOdds };
    }
  }

  return {
    playerId,
    gameLog: playerStats.gameLog.slice(0, 10),
    seasonAvg: playerStats.seasonAvg,
    analyses: results,
    usingRealLines: !!realProps,
    matchupContext: matchupCtx ? {
      gamePace: matchupCtx.gamePace,
      paceLabel: matchupCtx.paceLabel,
      defLabel: matchupCtx.defLabel,
      oppPtsAllowed: matchupCtx.oppPtsAllowed,
      impliedTotal: matchupCtx.impliedTotal,
      isB2B: matchupCtx.isB2B,
    } : null,
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

  // Fetch league-wide injury report
  const injuryMap = await fetchTeamInjuries();
  const injuredTeamCount = Object.keys(injuryMap).length;
  console.log(`[Props] Injury report: ${Object.values(injuryMap).flat().length} players OUT on ${injuredTeamCount} teams`);

  // Collect all (player, opponentId, game) tuples
  const playerTasks = [];
  const matchupContextCache = {}; // gameId → { away: matchupCtx, home: matchupCtx }

  for (const game of games) {
    const [awayRoster, homeRoster] = await Promise.all([
      getTeamRoster(game.away.id),
      getTeamRoster(game.home.id),
    ]);

    // Pre-build matchup context for each side of this game (cached per game)
    try {
      const [awayCtx, homeCtx] = await Promise.all([
        buildMatchupContext(game.home.id, game.away.id, game.odds, [], 'away'),
        buildMatchupContext(game.away.id, game.home.id, game.odds, [], 'home'),
      ]);
      matchupContextCache[game.id] = { away: awayCtx, home: homeCtx };
    } catch (e) {
      console.error(`[Props] Matchup context error for game ${game.id}:`, e.message);
      matchupContextCache[game.id] = { away: null, home: null };
    }

    for (const p of awayRoster) {
      playerTasks.push({ player: p, opponentId: game.home.id, game, teamName: game.away.name, teamAbbr: game.away.abbreviation, teamId: game.away.id, side: 'away' });
    }
    for (const p of homeRoster) {
      playerTasks.push({ player: p, opponentId: game.away.id, game, teamName: game.home.name, teamAbbr: game.home.abbreviation, teamId: game.home.id, side: 'home' });
    }
  }

  // Analyze players in batches of 6 to avoid hammering ESPN
  const allPicks = [];
  let playersScanned = 0;
  const BATCH_SIZE = 6;

  for (let i = 0; i < playerTasks.length; i += BATCH_SIZE) {
    const batch = playerTasks.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async ({ player, opponentId, game, teamName, teamAbbr, teamId, side }) => {
        const stats = await getPlayerStats(player.id);
        // Filter: need enough games and meaningful minutes
        if (stats.gameLog.length < 10) return null;
        const avgMin = getStatValue(stats.seasonAvg, 'min');
        if (avgMin !== null && avgMin < 15) return null;

        playersScanned++;

        // Look up real prop lines for this player
        const playerNameNorm = normalizeName(player.name);
        const playerProps = realProps ? realProps[playerNameNorm] : null;

        // Get pre-built matchup context for this side of the game
        let matchupCtx = matchupContextCache[game.id]?.[side] || null;
        // Update B2B detection with this specific player's game log
        if (matchupCtx) {
          matchupCtx = { ...matchupCtx, isB2B: detectBackToBack(stats.gameLog) };
        }

        // Calculate role expansion from injuries
        const roleCtx = await calcRoleExpansion(player.id, teamId, injuryMap);

        // Skip players who are OUT (they'll be in the injury map)
        const teamInjuries = injuryMap[teamId] || [];
        const isOut = teamInjuries.some(inj => String(inj.playerId) === String(player.id));
        if (isOut) return null;

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

          const analysis = analyzePlayerProp(stats, cat.key, propLine, opponentId, matchupCtx, roleCtx);
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
  // Filter out moderate+ volatility players (they only hit 50%)
  const overCandidates = allPicks
    .filter(p => p.analysis.overProbability >= 58)
    .filter(p => p.analysis.volatility <= 0.30) // Only stable players
    .sort((a, b) => {
      // Real lines first, then by probability
      if (a.lineSource !== 'generated' && b.lineSource === 'generated') return -1;
      if (a.lineSource === 'generated' && b.lineSource !== 'generated') return 1;
      return b.analysis.overProbability - a.analysis.overProbability;
    });

  // Unders require higher threshold (historically weaker performance)
  const underCandidates = allPicks
    .filter(p => p.analysis.underProbability >= 62) // Tighter threshold for unders (was 58)
    .filter(p => p.analysis.volatility <= 0.30) // Only stable players
    .filter(p => !p.analysis.injuryImpact) // Skip unders when key teammates are OUT
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

        // Player not in boxscore, empty stats (DNP), or played 0 minutes = DNP
        if (!pStats || Object.keys(pStats).length === 0 || (pStats.min !== undefined && pStats.min === 0)) {
          resolutions.push({ pickId: pick.id, actualValue: null, dnp: true });
          continue;
        }

        // Map our stat_key to the box score key
        const BOX_MAP = { pts: 'pts', reb: 'reb', ast: 'ast', fg3: '3pt', stl: 'stl', blk: 'blk', to: 'to' };
        const boxKey = BOX_MAP[pick.stat_key] || pick.stat_key;
        let actualValue = pStats[boxKey];
        if (actualValue === undefined) actualValue = pStats[pick.stat_key];
        if (actualValue === undefined) continue;

        resolutions.push({ pickId: pick.id, actualValue, dnp: false });
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
