/**
 * ESPN API Service
 * Fetches live scores, game summaries, and player stats from ESPN's unofficial API.
 * Free, no API key required.
 */

// ── Sport-to-ESPN path mapping ──
const ESPN_PATHS = {
  nba: 'basketball/nba',
  nfl: 'football/nfl',
  mlb: 'baseball/mlb',
  nhl: 'hockey/nhl',
  cfb: 'football/college-football',
  cbb: 'basketball/mens-college-basketball',
  ncaa_football: 'football/college-football',
  ncaa_mbb: 'basketball/mens-college-basketball',
  ncaa_wbb: 'basketball/womens-college-basketball',
  wnba: 'basketball/wnba',
  mls: 'soccer/usa.1',
  epl: 'soccer/eng.1',
  la_liga: 'soccer/esp.1',
  ucl: 'soccer/uefa.champions',
  mma: 'mma/ufc',
  ufc: 'mma/ufc',
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
  const url = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard?dates=${today}`;

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

  const match = propDesc.match(/^(over|under)\s+([\d.]+)\s+(.+)$/i);
  if (!match) return null;

  const direction = match[1].toLowerCase();
  const line = parseFloat(match[2]);
  const statName = match[3].toLowerCase().trim();
  const espnKey = STAT_MAP[statName] || statName;

  return { direction, line, stat: statName, espnKey };
}

module.exports = {
  ESPN_PATHS,
  getTodaysGames,
  getGameSummary,
  getAllTodaysGames,
  matchTeamToGame,
  parsePropDescription,
  STAT_MAP,
};
