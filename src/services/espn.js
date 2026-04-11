/**
 * ESPN API Service
 * Fetches live scores, game summaries, and player stats from ESPN's unofficial API.
 * Free, no API key required.
 */

// ── Sport-to-ESPN path mapping ──
const ESPN_PATHS = {
  // Major US
  nba: 'basketball/nba',
  nfl: 'football/nfl',
  mlb: 'baseball/mlb',
  nhl: 'hockey/nhl',
  wnba: 'basketball/wnba',
  // College
  cfb: 'football/college-football',
  cbb: 'basketball/mens-college-basketball',
  ncaa_football: 'football/college-football',
  ncaa_mbb: 'basketball/mens-college-basketball',
  ncaa_wbb: 'basketball/womens-college-basketball',
  // Soccer
  mls: 'soccer/usa.1',
  epl: 'soccer/eng.1',
  la_liga: 'soccer/esp.1',
  serie_a: 'soccer/ita.1',
  bundesliga: 'soccer/ger.1',
  ligue_1: 'soccer/fra.1',
  ucl: 'soccer/uefa.champions',
  liga_mx: 'soccer/mex.1',
  eredivisie: 'soccer/ned.1',
  primeira_liga: 'soccer/por.1',
  europa_league: 'soccer/uefa.europa',
  // Combat
  mma: 'mma/ufc',
  ufc: 'mma/ufc',
  // Tennis
  tennis_atp: 'tennis',
  tennis_wta: 'tennis',
  // International Baseball
  kbo: 'baseball/kbo',
  npb: 'baseball/npb',
  // Golf
  golf_pga: 'golf/pga',
  // Motorsport
  nascar: 'racing/nascar',
  f1: 'racing/f1',
  // Other
  rugby: 'rugby/sixnations',
  cricket: 'cricket',
  cfl: 'football/cfl',
  afl: 'football/afl',
};

// ── Response cache (avoid hammering ESPN) ──
const cache = new Map();
const SCOREBOARD_TTL = 30_000;  // 30s for scoreboard
const SUMMARY_TTL = 60_000;     // 60s for game summary

function getCached(key, ttl) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < ttl) return entry.data;
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

/**
 * Get today's games for a sport
 * @param {string} sport - Our internal sport value (e.g. 'nba', 'nfl')
 * @param {string} [dateStr] - Optional YYYYMMDD date string
 * @returns {Array} Parsed game objects
 */
async function getTodaysGames(sport, dateStr) {
  const espnPath = ESPN_PATHS[sport];
  if (!espnPath) return [];

  const today = dateStr || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
  
  // College sports need group + limit params to get all games (not just featured)
  // Group 50 = NCAA D1 Basketball, Group 80 = NCAA D1 Football (FBS)
  let extraParams = '';
  if (sport === 'cbb' || sport === 'ncaa_mbb') extraParams = '&groups=50&limit=200';
  else if (sport === 'cfb' || sport === 'ncaa_football') extraParams = '&groups=80&limit=200';
  else if (sport === 'ncaa_wbb') extraParams = '&groups=50&limit=200';
  
  const url = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard?dates=${today}${extraParams}`;

  const cacheKey = `scoreboard:${sport}:${today}`;
  const cached = getCached(cacheKey, SCOREBOARD_TTL);
  if (cached) return cached;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN API ${res.status}`);
    const json = await res.json();

    const games = (json.events || []).map(event => {
      const comp = event.competitions?.[0];
      if (!comp) return null;

      const home = comp.competitors?.find(c => c.homeAway === 'home');
      const away = comp.competitors?.find(c => c.homeAway === 'away');
      if (!home || !away) return null;

      const status = event.status || {};
      const statusType = status.type || {};

      return {
        id: event.id,
        sport,
        name: event.name || `${away.team?.displayName} at ${home.team?.displayName}`,
        shortName: event.shortName || '',
        startTime: event.date,
        // Teams
        home: {
          id: home.team?.id,
          name: home.team?.displayName || 'Home',
          abbreviation: home.team?.abbreviation || '',
          shortName: home.team?.shortDisplayName || home.team?.displayName || '',
          score: parseInt(home.score) || 0,
          logo: home.team?.logo || null,
          color: home.team?.color ? `#${home.team.color}` : '#555',
          altColor: home.team?.alternateColor ? `#${home.team.alternateColor}` : '#333',
          record: home.records?.[0]?.summary || '',
        },
        away: {
          id: away.team?.id,
          name: away.team?.displayName || 'Away',
          abbreviation: away.team?.abbreviation || '',
          shortName: away.team?.shortDisplayName || away.team?.displayName || '',
          score: parseInt(away.score) || 0,
          logo: away.team?.logo || null,
          color: away.team?.color ? `#${away.team.color}` : '#555',
          altColor: away.team?.alternateColor ? `#${away.team.alternateColor}` : '#333',
          record: away.records?.[0]?.summary || '',
        },
        // Game status
        state: statusType.state || 'pre',     // 'pre', 'in', 'post'
        completed: statusType.completed || false,
        period: status.period || 0,
        clock: status.displayClock || '',
        detail: statusType.shortDetail || statusType.detail || '',
        // Broadcast
        broadcast: comp.broadcasts?.[0]?.names?.[0] || '',
        // Odds (if available)
        odds: comp.odds?.[0] ? {
          spread: comp.odds[0].details || '',
          overUnder: comp.odds[0].overUnder || null,
        } : null,
        // Linescores for inning/quarter tracking
        linescores: {
          home: home.linescores || [],
          away: away.linescores || [],
        },
        // Raw event for advanced access
        _raw: event,
      };
    }).filter(Boolean);

    setCache(cacheKey, games);
    return games;
  } catch (err) {
    console.error(`[ESPN] Scoreboard fetch error (${sport}):`, err.message);
    return [];
  }
}

/**
 * Get detailed game summary with box score + player stats
 * @param {string} sport - Our internal sport value
 * @param {string} gameId - ESPN event ID
 * @returns {Object|null} Detailed game data
 */
async function getGameSummary(sport, gameId) {
  const espnPath = ESPN_PATHS[sport];
  if (!espnPath) return null;

  const url = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/summary?event=${gameId}`;

  const cacheKey = `summary:${gameId}`;
  const cached = getCached(cacheKey, SUMMARY_TTL);
  if (cached) return cached;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN API ${res.status}`);
    const json = await res.json();

    // Parse header / game info
    const header = json.header?.competitions?.[0];
    const game = {
      id: gameId,
      sport,
    };

    // Score and status from header
    if (header) {
      const homeComp = header.competitors?.find(c => c.homeAway === 'home');
      const awayComp = header.competitors?.find(c => c.homeAway === 'away');
      game.home = {
        id: homeComp?.id,
        name: homeComp?.team?.displayName || '',
        abbreviation: homeComp?.team?.abbreviation || '',
        score: parseInt(homeComp?.score) || 0,
        logo: homeComp?.team?.logo || null,
        color: homeComp?.team?.color ? `#${homeComp.team.color}` : '#555',
        record: homeComp?.record?.[0]?.displayValue || '',
      };
      game.away = {
        id: awayComp?.id,
        name: awayComp?.team?.displayName || '',
        abbreviation: awayComp?.team?.abbreviation || '',
        score: parseInt(awayComp?.score) || 0,
        logo: awayComp?.team?.logo || null,
        color: awayComp?.team?.color ? `#${awayComp.team.color}` : '#555',
        record: awayComp?.record?.[0]?.displayValue || '',
      };
      game.state = header.status?.type?.state || 'pre';
      game.completed = header.status?.type?.completed || false;
      game.period = header.status?.period || 0;
      game.clock = header.status?.displayClock || '';
      game.detail = header.status?.type?.shortDetail || '';
    }

    // Parse player stats from box score
    game.players = {};
    const boxPlayers = json.boxscore?.players || [];
    for (const teamStats of boxPlayers) {
      for (const statGroup of (teamStats.statistics || [])) {
        const labels = statGroup.labels || [];
        for (const athlete of (statGroup.athletes || [])) {
          const name = athlete.athlete?.displayName || '';
          const playerId = athlete.athlete?.id || '';
          const stats = {};
          (athlete.stats || []).forEach((val, i) => {
            if (labels[i]) stats[labels[i].toLowerCase()] = val;
          });
          game.players[playerId] = {
            name,
            id: playerId,
            teamId: teamStats.team?.id,
            stats,
          };
          // Also index by normalized name for fuzzy matching
          const normName = name.toLowerCase().replace(/[^a-z ]/g, '').trim();
          game.players[normName] = game.players[playerId];
        }
      }
    }

    setCache(cacheKey, game);
    return game;
  } catch (err) {
    console.error(`[ESPN] Summary fetch error (${gameId}):`, err.message);
    return null;
  }
}

/**
 * Get all live/today's games across all supported sports
 * @returns {Array} All games grouped by sport
 */
async function getAllTodaysGames() {
  // Use primary sport keys only (avoid duplicates from aliases)
  const primarySports = ['nba', 'nfl', 'mlb', 'nhl', 'cfb', 'cbb', 'wnba', 'mma'];
  const results = [];

  // Fetch in parallel (batches of 4 to be respectful)
  for (let i = 0; i < primarySports.length; i += 4) {
    const batch = primarySports.slice(i, i + 4);
    const batchResults = await Promise.all(
      batch.map(sport => getTodaysGames(sport).then(games => ({ sport, games })))
    );
    for (const { sport, games } of batchResults) {
      if (games.length > 0) {
        results.push({ sport, games });
      }
    }
  }

  return results;
}

/**
 * Find a game by matching team name (fuzzy)
 * @param {string} teamName - Team name to search for
 * @param {Array} games - List of game objects from getTodaysGames
 * @returns {Object|null} Matching game
 */
function matchTeamToGame(teamName, games) {
  if (!teamName || !games?.length) return null;

  const needle = teamName.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

  // Exact match on abbreviation, short name, or display name
  for (const game of games) {
    const homeNames = [
      game.home.abbreviation.toLowerCase(),
      game.home.shortName.toLowerCase(),
      game.home.name.toLowerCase(),
    ];
    const awayNames = [
      game.away.abbreviation.toLowerCase(),
      game.away.shortName.toLowerCase(),
      game.away.name.toLowerCase(),
    ];

    if (homeNames.some(n => n === needle || needle.includes(n) || n.includes(needle))) return game;
    if (awayNames.some(n => n === needle || needle.includes(n) || n.includes(needle))) return game;
  }

  return null;
}

/**
 * Map a stat category name from a bet prop to ESPN box score label
 */
const STAT_MAP = {
  // Basketball
  'points': 'pts',
  'rebounds': 'reb',
  'assists': 'ast',
  '3-pointers': 'fg3',
  '3 pointers': 'fg3',
  'threes': 'fg3',
  'steals': 'stl',
  'blocks': 'blk',
  'turnovers': 'to',
  // Football
  'passing yards': 'yds',
  'rushing yards': 'yds',
  'receiving yards': 'yds',
  'touchdowns': 'td',
  'interceptions': 'int',
  'completions': 'cmp',
  // Baseball
  'strikeouts': 'k',
  'hits': 'h',
  'home runs': 'hr',
  'rbis': 'rbi',
  'runs': 'r',
  'total bases': 'tb',
  'stolen bases': 'sb',
  'walks': 'bb',
  // Hockey
  'goals': 'g',
  'saves': 'sv',
  'shots': 'sog',
};

/**
 * Parse a prop description into structured data
 * e.g. "Over 25.5 Points" → { direction: 'over', line: 25.5, stat: 'points', espnKey: 'pts' }
 */
function parsePropDescription(propDesc) {
  if (!propDesc) return null;

  // Standard: "Over 2.5 Hits", "Under 4.5 Strikeouts"
  const match = propDesc.match(/^(over|under)\s+([\d.]+)\s+(.+)$/i);
  if (match) {
    const direction = match[1].toLowerCase();
    const line = parseFloat(match[2]);
    const statName = match[3].toLowerCase().trim();
    const espnKey = STAT_MAP[statName] || statName;
    return { direction, line, stat: statName, espnKey };
  }

  // ALT props: "ALT Hits 1+", "ALT Total Bases 2+", "ALT Strikeouts 5+"
  const altMatch = propDesc.match(/^ALT\s+(.+?)\s+(\d+)\+$/i);
  if (altMatch) {
    const statName = altMatch[1].toLowerCase().trim();
    const threshold = parseInt(altMatch[2], 10);
    const espnKey = STAT_MAP[statName] || statName;
    // "ALT Hits 1+" means >= 1, which is equivalent to Over 0.5
    return { direction: 'over', line: threshold - 0.5, stat: statName, espnKey };
  }

  return null;
}

/**
 * Resolve ESPN game ID for a bet based on team names, sport, and date.
 * Tries the event_start_time date first, then today.
 * @param {string} sport - Our internal sport key
 * @param {string} teamA - Team A name
 * @param {string} teamB - Team B name (optional)
 * @param {string} [eventStartTime] - ISO/free-text start time (used to derive date)
 * @returns {Object|null} { gameId, game } or null
 */
async function resolveGameId(sport, teamA, teamB, eventStartTime) {
  if (!sport) return null;

  // Derive date string from eventStartTime if possible
  let dateStr = null;
  if (eventStartTime) {
    // Try ISO parse
    const d = new Date(eventStartTime);
    if (!isNaN(d.getTime())) {
      dateStr = d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
    } else {
      // Try "Fri Apr 10 9:41 PM ET" format — extract month+day
      const MONTH_NUM = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
      const m = eventStartTime.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\b/i);
      if (m) {
        const mon = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
        if (MONTH_NUM[mon]) dateStr = `${new Date().getFullYear()}${MONTH_NUM[mon]}${m[2].padStart(2, '0')}`;
      }
    }
  }

  // Golf: tournament is a single event, return it directly
  if (sport === 'golf_pga') {
    const games = await getTodaysGames(sport, dateStr || undefined);
    if (games.length > 0) return { gameId: games[0].id, game: games[0] };
    return null;
  }

  if (!teamA) return null;

  // Fetch games for the sport on that date (or today)
  const games = await getTodaysGames(sport, dateStr || undefined);
  if (!games.length) return null;

  // Try matching teamA first
  let game = matchTeamToGame(teamA, games);
  // If no match and teamB exists, try teamB
  if (!game && teamB) {
    game = matchTeamToGame(teamB, games);
  }

  if (game) return { gameId: game.id, game };
  return null;
}

/**
 * Auto-resolve a bet or parlay leg result based on ESPN final game data.
 * Returns the computed result or null if unresolvable.
 *
 * @param {Object} params
 * @param {string} params.wagerType - moneyline, spread, total, etc.
 * @param {string} params.pick - The pick text (e.g., "Lakers -4.5", "Over 220.5")
 * @param {string} params.teamA - Team A name
 * @param {string} params.teamB - Team B name
 * @param {number|null} params.spreadValue - Spread/line value
 * @param {string|null} params.playerName - For player props
 * @param {string|null} params.propDescription - For player props (e.g., "Over 25.5 Points")
 * @param {string} params.sport - Sport key
 * @param {Object} params.game - ESPN game object (from scoreboard, must be state='post')
 * @param {Object} [params.summary] - ESPN game summary (needed for player props / HR)
 * @param {string} [params.period] - Period for the bet (full_game, first_3, first_5, 1st_half, etc.)
 * @returns {string|null} 'win', 'loss', 'push', or null if can't determine
 */
function resolveResult({ wagerType, pick, teamA, teamB, spreadValue, playerName, propDescription, sport, game, summary, period }) {
  if (!game || game.state !== 'post') return null;

  const homeScore = game.home?.score ?? 0;
  const awayScore = game.away?.score ?? 0;

  // Determine which team the user picked (home or away)
  const pickTeamSide = identifyPickSide(pick, teamA, teamB, game);

  switch (wagerType) {
    case 'moneyline': {
      if (!pickTeamSide) return null;
      const pickScore = pickTeamSide === 'home' ? homeScore : awayScore;
      const oppScore = pickTeamSide === 'home' ? awayScore : homeScore;
      if (pickScore > oppScore) return 'win';
      if (pickScore < oppScore) return 'loss';
      return 'push';
    }

    case 'spread': {
      if (!pickTeamSide || spreadValue == null) return null;
      const pickScore = pickTeamSide === 'home' ? homeScore : awayScore;
      const oppScore = pickTeamSide === 'home' ? awayScore : homeScore;
      const adjusted = pickScore + parseFloat(spreadValue);
      if (adjusted > oppScore) return 'win';
      if (adjusted < oppScore) return 'loss';
      return 'push';
    }

    case 'total': {
      if (spreadValue == null) return null;
      const totalScore = homeScore + awayScore;
      const line = parseFloat(spreadValue);
      const isOver = /over/i.test(pick);
      if (isOver && totalScore > line) return 'win';
      if (isOver && totalScore < line) return 'loss';
      if (!isOver && totalScore < line) return 'win';
      if (!isOver && totalScore > line) return 'loss';
      return 'push';
    }

    case 'team_total': {
      if (spreadValue == null || !pickTeamSide) return null;
      const teamScore = pickTeamSide === 'home' ? homeScore : awayScore;
      const line = parseFloat(spreadValue);
      const isOver = /over/i.test(pick);
      if (isOver && teamScore > line) return 'win';
      if (isOver && teamScore < line) return 'loss';
      if (!isOver && teamScore < line) return 'win';
      if (!isOver && teamScore > line) return 'loss';
      return 'push';
    }

    case 'nrfi': {
      // NRFI = No Run First Inning — need linescore
      const linescores = getLinescores(game);
      if (!linescores) return null;
      const homeR1 = parseFloat(linescores.home?.[0]?.displayValue || linescores.home?.[0]?.value || '0');
      const awayR1 = parseFloat(linescores.away?.[0]?.displayValue || linescores.away?.[0]?.value || '0');
      return (homeR1 === 0 && awayR1 === 0) ? 'win' : 'loss';
    }

    case 'yrfi': {
      const linescores = getLinescores(game);
      if (!linescores) return null;
      const homeR1 = parseFloat(linescores.home?.[0]?.displayValue || linescores.home?.[0]?.value || '0');
      const awayR1 = parseFloat(linescores.away?.[0]?.displayValue || linescores.away?.[0]?.value || '0');
      return (homeR1 > 0 || awayR1 > 0) ? 'win' : 'loss';
    }

    case 'homerun': {
      // Need box score for HR data
      if (!summary) return null;
      const totalHRs = countGameHomers(summary);
      if (totalHRs === null) return null;

      // Yes/No HR bet
      if (/^yes\b/i.test(pick)) return totalHRs > 0 ? 'win' : 'loss';
      if (/^no\b/i.test(pick)) return totalHRs === 0 ? 'win' : 'loss';

      // Over/Under HR bet
      if (spreadValue != null) {
        const line = parseFloat(spreadValue);
        const isOver = /over/i.test(pick);
        if (isOver && totalHRs > line) return 'win';
        if (isOver && totalHRs < line) return 'loss';
        if (!isOver && totalHRs < line) return 'win';
        if (!isOver && totalHRs > line) return 'loss';
        return 'push';
      }
      return null;
    }

    case 'prop': {
      // Player prop — need game summary with box score
      if (!summary || !playerName || !propDescription) return null;
      const parsed = parsePropDescription(propDescription);
      if (!parsed) return null;

      const playerData = findPlayer(summary.players, playerName);
      if (!playerData) return null;

      const statVal = parseFloat(playerData.stats?.[parsed.espnKey]) || 0;
      if (parsed.direction === 'over') {
        if (statVal > parsed.line) return 'win';
        if (statVal < parsed.line) return 'loss';
        return 'push';
      } else {
        if (statVal < parsed.line) return 'win';
        if (statVal > parsed.line) return 'loss';
        return 'push';
      }
    }

    case 'double_chance': {
      // Pick covers 2 of 3 outcomes — e.g., "Home/Draw", "Away/Draw", "Home/Away"
      if (homeScore > awayScore) {
        return /home|1/i.test(pick) ? 'win' : 'loss';
      } else if (awayScore > homeScore) {
        return /away|2/i.test(pick) ? 'win' : 'loss';
      } else {
        // Draw
        return /draw|x/i.test(pick) ? 'win' : 'loss';
      }
    }

    case 'draw_no_bet': {
      if (homeScore === awayScore) return 'push'; // Draw = push
      if (!pickTeamSide) return null;
      const pickScore = pickTeamSide === 'home' ? homeScore : awayScore;
      const oppScore = pickTeamSide === 'home' ? awayScore : homeScore;
      return pickScore > oppScore ? 'win' : 'loss';
    }

    case 'futures':
      return null; // Cannot auto-resolve futures

    default:
      return null;
  }
}

/**
 * Identify which side (home/away) the user's pick is on
 */
function identifyPickSide(pick, teamA, teamB, game) {
  if (!pick || !game) return null;

  const pickLower = pick.toLowerCase();
  const homeNames = [
    game.home.name?.toLowerCase(),
    game.home.abbreviation?.toLowerCase(),
    game.home.shortName?.toLowerCase(),
  ].filter(Boolean);
  const awayNames = [
    game.away.name?.toLowerCase(),
    game.away.abbreviation?.toLowerCase(),
    game.away.shortName?.toLowerCase(),
  ].filter(Boolean);

  // Also check teamA/teamB against game sides
  if (teamA) {
    const tA = teamA.toLowerCase();
    if (homeNames.some(n => n.includes(tA) || tA.includes(n))) {
      // teamA is home — check if pick mentions teamA
      if (pickLower.includes(tA) || homeNames.some(n => pickLower.includes(n))) return 'home';
    }
    if (awayNames.some(n => n.includes(tA) || tA.includes(n))) {
      if (pickLower.includes(tA) || awayNames.some(n => pickLower.includes(n))) return 'away';
    }
  }
  if (teamB) {
    const tB = teamB.toLowerCase();
    if (homeNames.some(n => n.includes(tB) || tB.includes(n))) {
      if (pickLower.includes(tB) || homeNames.some(n => pickLower.includes(n))) return 'home';
    }
    if (awayNames.some(n => n.includes(tB) || tB.includes(n))) {
      if (pickLower.includes(tB) || awayNames.some(n => pickLower.includes(n))) return 'away';
    }
  }

  // Direct pick text match
  if (homeNames.some(n => pickLower.includes(n))) return 'home';
  if (awayNames.some(n => pickLower.includes(n))) return 'away';

  return null;
}

/**
 * Extract linescore data from a game object
 */
function getLinescores(game) {
  // Direct linescores from our parsed object
  if (game.linescores && (game.linescores.home?.length || game.linescores.away?.length)) {
    return game.linescores;
  }
  // Fallback to raw event
  if (!game._raw) return null;
  const comp = game._raw?.competitions?.[0];
  if (!comp) return null;
  const home = comp.competitors?.find(c => c.homeAway === 'home');
  const away = comp.competitors?.find(c => c.homeAway === 'away');
  return {
    home: home?.linescores || [],
    away: away?.linescores || [],
  };
}

/**
 * Count total home runs in a game from ESPN box score summary
 */
function countGameHomers(summary) {
  if (!summary?.players) return null;
  let total = 0;
  for (const key of Object.keys(summary.players)) {
    const player = summary.players[key];
    if (player?.stats?.hr) {
      total += parseInt(player.stats.hr) || 0;
    }
  }
  return total;
}

/**
 * Find player in game summary players object (fuzzy)
 */
function findPlayer(players, playerName) {
  if (!players || !playerName) return null;
  const norm = playerName.toLowerCase().replace(/[^a-z ]/g, '').trim();
  if (players[norm]) return players[norm];
  for (const key of Object.keys(players)) {
    if (typeof key === 'string' && key.includes(norm)) return players[key];
    if (typeof key === 'string' && norm.includes(key)) return players[key];
  }
  return null;
}

module.exports = {
  ESPN_PATHS,
  getTodaysGames,
  getGameSummary,
  getAllTodaysGames,
  matchTeamToGame,
  parsePropDescription,
  resolveGameId,
  resolveResult,
  identifyPickSide,
  findPlayer,
  STAT_MAP,
};
