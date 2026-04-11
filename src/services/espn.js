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
 * Get a golf event as a lightweight game-like object for the pollers.
 * Golf events are filtered out by getTodaysGames() (no home/away teams),
 * so this fetches the tournament directly from the scoreboard API.
 * Returns an object shaped like a team game but with minimal dummy team data.
 * @param {string} gameId - ESPN event ID
 * @param {string} [dateStr] - YYYYMMDD date
 * @returns {Object|null} Game-like object with id, state, sport
 */
async function getGolfEventStatus(gameId, dateStr) {
  const espnPath = ESPN_PATHS.golf_pga;
  if (!espnPath) return null;

  const today = dateStr || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
  const cacheKey = `golf-event:${today}`;
  let events;
  const cached = getCached(cacheKey, SCOREBOARD_TTL);
  if (cached) {
    events = cached;
  } else {
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard?dates=${today}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const json = await res.json();
      events = json.events || [];
      setCache(cacheKey, events);
    } catch { return null; }
  }

  const event = events.find(e => e.id === gameId) || events[0];
  if (!event) return null;

  const status = event.status || {};
  const statusType = status.type || {};

  return {
    id: event.id,
    sport: 'golf_pga',
    name: event.name || 'Golf Tournament',
    state: statusType.state || 'pre',
    completed: statusType.completed || false,
    detail: statusType.shortDetail || statusType.detail || '',
    // Dummy home/away so resolveResult doesn't crash — golf uses prop resolution only
    home: { name: event.name || 'Field', abbreviation: 'GOLF', score: 0 },
    away: { name: '', abbreviation: '', score: 0 },
    linescores: { home: [], away: [] },
  };
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
        const catName = (statGroup.name || statGroup.type || '').toLowerCase();
        for (const athlete of (statGroup.athletes || [])) {
          const name = athlete.athlete?.displayName || '';
          const playerId = athlete.athlete?.id || '';
          const newStats = {};
          (athlete.stats || []).forEach((val, i) => {
            if (labels[i]) {
              const key = labels[i].toLowerCase();
              newStats[key] = val;
              // Add category-prefixed version for disambiguation (e.g. passing_yds vs rushing_yds)
              if (catName) newStats[`${catName}_${key}`] = val;
            }
          });

          // Parse compound stat formats (NFL)
          if (newStats['c/att']) {
            const parts = newStats['c/att'].split('/');
            newStats['completions'] = parts[0];
            newStats['pass_attempts'] = parts[1];
          }
          if (typeof newStats['sacks'] === 'string' && newStats['sacks'].includes('-')) {
            const parts = newStats['sacks'].split('-');
            newStats['times_sacked'] = parts[0];
            newStats['sack_yards_lost'] = parts[1];
          }
          if (typeof newStats['fg'] === 'string' && newStats['fg'].includes('/')) {
            const parts = newStats['fg'].split('/');
            newStats['fg_made'] = parts[0];
            newStats['fg_attempted'] = parts[1];
          }
          if (typeof newStats['xp'] === 'string' && newStats['xp'].includes('/')) {
            const parts = newStats['xp'].split('/');
            newStats['xp_made'] = parts[0];
            newStats['xp_attempted'] = parts[1];
          }

          // Merge with existing player data (player may appear in multiple categories, e.g. NFL QB in passing + rushing)
          const existing = game.players[playerId];
          if (existing) {
            Object.assign(existing.stats, newStats);
          } else {
            const playerObj = {
              name,
              id: playerId,
              teamId: teamStats.team?.id,
              stats: newStats,
            };
            game.players[playerId] = playerObj;
            // Also index by normalized name for fuzzy matching
            const normName = name.toLowerCase().replace(/[^a-z ]/g, '').trim();
            game.players[normName] = playerObj;
          }
        }
      }
    }

    // Capture linescores for period-based resolution
    const headerHome = header?.competitors?.find(c => c.homeAway === 'home');
    const headerAway = header?.competitors?.find(c => c.homeAway === 'away');
    game.linescores = {
      home: headerHome?.linescores || [],
      away: headerAway?.linescores || [],
    };

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
 * Map a stat category name from a bet prop to ESPN box score label.
 * Football stats use category-prefixed keys (passing_yds, rushing_yds, etc.)
 * because the same label (YDS, TD) appears in multiple ESPN box score categories.
 */
const STAT_MAP = {
  // Basketball
  'points': 'pts',
  'rebounds': 'reb',
  'assists': 'ast',
  '3-pointers': '3pt',
  '3 pointers': '3pt',
  'threes': '3pt',
  'steals': 'stl',
  'blocks': 'blk',
  'turnovers': 'to',
  // Football — category-prefixed to avoid YDS/TD collisions across passing/rushing/receiving
  'passing yards': 'passing_yds',
  'pass yards': 'passing_yds',
  'rushing yards': 'rushing_yds',
  'rush yards': 'rushing_yds',
  'receiving yards': 'receiving_yds',
  'rec yards': 'receiving_yds',
  'completions': 'completions',           // parsed from C/ATT
  'pass attempts': 'pass_attempts',       // parsed from C/ATT
  'passing attempts': 'pass_attempts',
  'rush attempts': 'car',
  'carries': 'car',
  'rushing attempts': 'car',
  'receptions': 'rec',
  'targets': 'tgts',
  'passing touchdowns': 'passing_td',
  'passing tds': 'passing_td',
  'pass touchdowns': 'passing_td',
  'rushing touchdowns': 'rushing_td',
  'rushing tds': 'rushing_td',
  'rush touchdowns': 'rushing_td',
  'receiving touchdowns': 'receiving_td',
  'receiving tds': 'receiving_td',
  'touchdowns': 'anytime_td',            // computed: sum of all non-passing _td keys
  'tds': 'anytime_td',
  'anytime td': 'anytime_td',
  'anytime touchdown': 'anytime_td',
  'interceptions': 'int',
  'interceptions thrown': 'passing_int',
  'ints thrown': 'passing_int',
  'field goals made': 'fg_made',          // parsed from FG "5/5"
  'fg made': 'fg_made',
  'fgs made': 'fg_made',
  'field goals attempted': 'fg_attempted',
  'fg attempted': 'fg_attempted',
  'fgs attempted': 'fg_attempted',
  'extra points': 'xp_made',             // parsed from XP "2/2"
  'extra points made': 'xp_made',
  'xp made': 'xp_made',
  'passer rating': 'rtg',
  'qbr': 'qbr',
  'tackles': 'tot',
  'solo tackles': 'solo',
  'sacks': 'defensive_sacks',
  'kicking points': 'kicking_pts',
  // Baseball (ESPN keys)
  'strikeouts': 'k',
  'hits': 'h',
  'home runs': 'hr',
  'rbis': 'rbi',
  'runs': 'r',
  'walks': 'bb',
  // Baseball (MLB Stats API keys — not in ESPN box score)
  'total bases': 'totalBases',
  'stolen bases': 'stolenBases',
  'doubles': 'doubles',
  'triples': 'triples',
  'caught stealing': 'caughtStealing',
  // Hockey
  'goals': 'g',
  'saves': 'sv',
  'shots': 's',
  'shots on goal': 's',
  'blocked shots': 'bs',
  'penalty minutes': 'pim',
  'pims': 'pim',
  'faceoff wins': 'fw',
  'faceoffs won': 'fw',
  'plus minus': '+/-',
  'plus/minus': '+/-',
  'takeaways': 'tk',
  'giveaways': 'gv',
  'time on ice': 'toi',
  'goals against': 'ga',
  'shots against': 'sa',
  'save percentage': 'sv%',
  // Golf
  'round score': 'golf_round_score',
  'score': 'golf_round_score',
};

// Stats that require special golf handling (not in standard box score)
const GOLF_STATS = new Set(['golf_round_score']);

/**
 * Sport-specific stat key overrides.
 * Some stat names (assists, blocks, hits) map to different ESPN labels per sport.
 */
const SPORT_STAT_OVERRIDES = {
  nhl: { 'assists': 'a', 'blocks': 'bs', 'hits': 'ht', 'points': 'pts' },
};

/**
 * Computed/derived stats — used when the raw ESPN key doesn't exist in box score.
 * Each function receives the player's full stats object and returns a numeric value or null.
 */
const COMPUTED_STATS = {
  'pts': (stats) => {
    // Hockey: goals + assists (PTS not in ESPN hockey box score)
    if (stats.g !== undefined || stats.a !== undefined) {
      return (parseFloat(stats.g) || 0) + (parseFloat(stats.a) || 0);
    }
    return null;
  },
  'anytime_td': (stats) => {
    // Football: sum of all scoring TDs (rushing + receiving + return TDs, NOT passing TDs)
    let total = 0;
    for (const [key, val] of Object.entries(stats)) {
      if (key.endsWith('_td') && key !== 'passing_td') {
        total += parseFloat(val) || 0;
      }
    }
    return total > 0 ? total : null;
  },
};

// Stats that require MLB Stats API (not available in ESPN box score)
const MLB_API_STATS = new Set(['totalBases', 'stolenBases', 'doubles', 'triples', 'caughtStealing']);

/**
 * Parse a prop description into structured data
 * e.g. "Over 25.5 Points" → { direction: 'over', line: 25.5, stat: 'points', espnKey: 'pts' }
 * @param {string} propDesc - The prop description text
 * @param {string} [sport] - Sport key for sport-specific stat key overrides
 */
function parsePropDescription(propDesc, sport) {
  if (!propDesc) return null;
  const overrides = (sport && SPORT_STAT_OVERRIDES[sport]) || {};

  // Standard: "Over 2.5 Hits", "Under 4.5 Strikeouts"
  const match = propDesc.match(/^(over|under)\s+([\d.]+)\s+(.+)$/i);
  if (match) {
    const direction = match[1].toLowerCase();
    const line = parseFloat(match[2]);
    const statName = match[3].toLowerCase().trim();
    const espnKey = overrides[statName] || STAT_MAP[statName] || statName;
    return { direction, line, stat: statName, espnKey };
  }

  // ALT props: "ALT Hits 1+", "ALT Total Bases 2+", "ALT Strikeouts 5+"
  const altMatch = propDesc.match(/^ALT\s+(.+?)\s+(\d+)\+$/i);
  if (altMatch) {
    const statName = altMatch[1].toLowerCase().trim();
    const threshold = parseInt(altMatch[2], 10);
    const espnKey = overrides[statName] || STAT_MAP[statName] || statName;
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
    const espnPath = ESPN_PATHS[sport];
    if (!espnPath) return null;
    const ds = dateStr || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
    const url = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard?dates=${ds}`;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const json = await res.json();
      const event = json.events?.[0];
      if (event) return { gameId: event.id, game: { id: event.id, sport, name: event.name, state: event.status?.type?.state || 'pre' } };
    } catch {}
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
 * Get scores for a specific period/quarter from linescore data.
 * @param {Object} game - Game object with linescores
 * @param {string} period - Period key (full_game, 1st_quarter, 1st_half, etc.)
 * @returns {Object|null} { home, away } scores for the period
 */
function getPeriodScores(game, period) {
  if (!period || period === 'full_game') {
    return { home: game.home?.score ?? 0, away: game.away?.score ?? 0 };
  }

  const linescores = getLinescores(game);
  if (!linescores) return null;

  // Map period to linescore array indices
  const PERIOD_INDICES = {
    '1st_quarter': [0],
    '2nd_quarter': [1],
    '3rd_quarter': [2],
    '4th_quarter': [3],
    '1st_half': [0, 1],
    '1st_period': [0],
    '2nd_period': [1],
    '3rd_period': [2],
    'first_3': [0, 1, 2],
    'first_5': [0, 1, 2, 3, 4],
    '1st_inning': [0],
    '2nd_inning': [1],
    '3rd_inning': [2],
    '4th_inning': [3],
    '5th_inning': [4],
  };

  let indices = PERIOD_INDICES[period];

  // 2nd_half: index 2 through end (includes OT)
  if (period === '2nd_half') {
    const maxLen = Math.max(linescores.home?.length || 0, linescores.away?.length || 0);
    indices = [];
    for (let i = 2; i < maxLen; i++) indices.push(i);
  }

  if (!indices || !indices.length) return null;

  const sumScores = (ls, idxs) => idxs.reduce((sum, i) => {
    return sum + (parseFloat(ls?.[i]?.displayValue || ls?.[i]?.value || '0') || 0);
  }, 0);

  return {
    home: sumScores(linescores.home, indices),
    away: sumScores(linescores.away, indices),
  };
}

/**
 * Auto-resolve a bet or parlay leg result based on ESPN final game data.
 * Supports period-based bets (1st_quarter, 1st_half, etc.) using linescore data.
 * Supports computed stats (hockey points = G+A, football anytime TD).
 */
function resolveResult({ wagerType, pick, teamA, teamB, spreadValue, playerName, propDescription, sport, game, summary, period }) {
  if (!game) return null;
  // Golf tournaments stay 'in' for days — resolve per-round via summary._golfRoundScore
  // NRFI/YRFI can resolve after 1st inning (game must be at least 'in', not 'pre')
  const isNrfiType = wagerType === 'nrfi' || wagerType === 'yrfi';
  if (isNrfiType && game.state === 'pre') return null;  // game hasn't started
  const earlyResolve = sport === 'golf_pga' || isNrfiType;
  if (game.state !== 'post' && !earlyResolve) return null;

  // Compute scores based on period — use linescore data for period bets
  let homeScore, awayScore;
  if (period && period !== 'full_game') {
    const periodScores = getPeriodScores(game, period);
    if (!periodScores) return null; // Can't resolve period bet without linescore data
    homeScore = periodScores.home;
    awayScore = periodScores.away;
  } else {
    homeScore = game.home?.score ?? 0;
    awayScore = game.away?.score ?? 0;
  }

  // Determine which team the user picked (home or away) — skip for golf (no teams)
  const pickTeamSide = sport === 'golf_pga' ? null : identifyPickSide(pick, teamA, teamB, game);

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
      // NRFI = No Run First Inning — need 1st inning linescore data to exist
      const linescores = getLinescores(game);
      if (!linescores) return null;
      // Make sure 1st inning data actually exists (not just empty arrays)
      const homeInning1 = linescores.home?.[0];
      const awayInning1 = linescores.away?.[0];
      if (!homeInning1 && !awayInning1) return null; // no 1st inning data yet
      const homeR1 = parseFloat(homeInning1?.displayValue || homeInning1?.value || '0');
      const awayR1 = parseFloat(awayInning1?.displayValue || awayInning1?.value || '0');
      // Only resolve once BOTH halves of the 1st inning are done (need bottom of 1st)
      // If game is still in the 1st inning, wait — unless game is already past inning 1
      if (game.state === 'in') {
        const inning = game._raw?.competitions?.[0]?.status?.period || 0;
        if (inning <= 1) return null; // still in 1st inning, wait
      }
      return (homeR1 === 0 && awayR1 === 0) ? 'win' : 'loss';
    }

    case 'yrfi': {
      const linescores = getLinescores(game);
      if (!linescores) return null;
      const homeInning1 = linescores.home?.[0];
      const awayInning1 = linescores.away?.[0];
      if (!homeInning1 && !awayInning1) return null;
      const homeR1 = parseFloat(homeInning1?.displayValue || homeInning1?.value || '0');
      const awayR1 = parseFloat(awayInning1?.displayValue || awayInning1?.value || '0');
      // YRFI can resolve early if a run scores in top of 1st
      if (homeR1 > 0 || awayR1 > 0) return 'win';
      // But can only confirm loss after full 1st inning
      if (game.state === 'in') {
        const inning = game._raw?.competitions?.[0]?.status?.period || 0;
        if (inning <= 1) return null; // still in 1st inning
      }
      return 'loss';
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
      const parsed = parsePropDescription(propDescription, sport);
      if (!parsed) return null;

      // Golf round score — resolved from golf scoreboard, not box score
      if (GOLF_STATS.has(parsed.espnKey) && sport === 'golf_pga') {
        if (summary?._golfRoundScore === undefined) return null;
        const statVal = summary._golfRoundScore;
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

      const playerData = findPlayer(summary.players, playerName);
      if (!playerData) return null;

      let statVal;
      const rawStat = playerData.stats?.[parsed.espnKey];

      // Handle "made-attempted" format (e.g. NBA 3pt: "3-7")
      if (typeof rawStat === 'string' && rawStat.includes('-') && /^\d+-\d+$/.test(rawStat)) {
        statVal = parseFloat(rawStat.split('-')[0]) || 0;
      } else {
        statVal = parseFloat(rawStat) || 0;
      }

      // Try computed/derived stats if raw value is 0 (e.g. hockey points = G+A, anytime TD)
      if (statVal === 0 && COMPUTED_STATS[parsed.espnKey] && playerData.stats) {
        const computed = COMPUTED_STATS[parsed.espnKey](playerData.stats);
        if (computed !== null) statVal = computed;
      }

      // If ESPN doesn't have this stat and it's an MLB game, try MLB Stats API
      if (statVal === 0 && MLB_API_STATS.has(parsed.espnKey) && ['mlb', 'kbo', 'npb'].includes(sport)) {
        // Will be resolved by the poller which passes mlbPlayerStats
        if (summary._mlbStats) {
          statVal = parseFloat(summary._mlbStats[parsed.espnKey]) || 0;
        } else {
          return null; // Can't resolve yet — need MLB API data
        }
      }

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

/**
 * Get a golf player's round data from the ESPN scoreboard.
 * @param {string} playerName - Player display name (e.g. "Si Woo Kim")
 * @param {number} roundNum - Round number (1-4)
 * @returns {Object|null} { playerName, overallScore, roundNum, roundScore, roundDisplay, holesCompleted, totalHoles, holeScores, tournamentName, roundStatus }
 */
async function getGolfPlayerRound(playerName, roundNum) {
  if (!playerName) return null;
  const espnPath = ESPN_PATHS.golf_pga;
  if (!espnPath) return null;

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
  const url = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard?dates=${today}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const event = json.events?.[0];
    if (!event) return null;

    const competitors = event.competitions?.[0]?.competitors || [];
    const norm = playerName.toLowerCase().replace(/[^a-z ]/g, '').trim();

    // Find the player (fuzzy)
    const comp = competitors.find(c => {
      const dn = (c.athlete?.displayName || '').toLowerCase().replace(/[^a-z ]/g, '').trim();
      const fn = (c.athlete?.fullName || '').toLowerCase().replace(/[^a-z ]/g, '').trim();
      return dn === norm || fn === norm || dn.includes(norm) || norm.includes(dn);
    });
    if (!comp) return null;

    const rounds = comp.linescores || [];
    const rIdx = (roundNum || rounds.length) - 1;
    const round = rounds[rIdx];

    // Competition status shows current round info
    const compStatus = event.competitions?.[0]?.status;
    const currentRound = compStatus?.period || rounds.length;

    let holesCompleted = 0;
    let runningScore = 0;
    const holeScores = [];

    if (round?.linescores?.length) {
      holesCompleted = round.linescores.length;
      for (const hole of round.linescores) {
        runningScore += hole.value || 0;
        holeScores.push({
          hole: hole.period,
          strokes: hole.value,
          toPar: hole.scoreType?.displayValue || '',
        });
      }
    }

    // Determine round status
    let roundStatus = 'pre'; // not started
    if (round?.linescores?.length === 18) roundStatus = 'post'; // complete
    else if (round?.linescores?.length > 0) roundStatus = 'in'; // in progress
    else if (roundNum < currentRound) roundStatus = 'post'; // past round with no hole data

    return {
      playerName: comp.athlete?.displayName || playerName,
      overallScore: comp.score || 'E',
      roundNum: rIdx + 1,
      roundScore: round?.value || (roundStatus === 'in' ? runningScore : null),
      roundDisplay: round?.displayValue || null,
      holesCompleted,
      totalHoles: 18,
      holeScores,
      tournamentName: event.name || 'Tournament',
      roundStatus,
      position: comp.order || null,
    };
  } catch (err) {
    console.error('[ESPN] Golf player round error:', err.message);
    return null;
  }
}

// ── MLB Stats API (free, no auth) ──────────────────────────
// Used for stats ESPN doesn't provide: totalBases, stolenBases, doubles, triples
const MLB_API_TTL = 60_000; // 60s cache

/**
 * Find the MLB Stats API gamePk for a game using ESPN game ID or team names.
 * @param {string} espnGameId - ESPN event ID
 * @param {string} dateStr - YYYYMMDD date
 * @param {string} [teamA] - Team name for matching
 * @param {string} [teamB] - Team name for matching
 * @returns {number|null} MLB gamePk
 */
async function findMlbGamePk(espnGameId, dateStr, teamA, teamB) {
  const ds = dateStr || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const cacheKey = `mlb-schedule:${ds}`;
  let games;
  const cached = getCached(cacheKey, MLB_API_TTL);
  if (cached) {
    games = cached;
  } else {
    try {
      const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${ds}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const json = await res.json();
      games = json.dates?.[0]?.games || [];
      setCache(cacheKey, games);
    } catch { return null; }
  }
  if (!games.length) return null;

  // Match by team name
  const needle = (teamA || '').toLowerCase();
  const needle2 = (teamB || '').toLowerCase();
  for (const g of games) {
    const home = (g.teams?.home?.team?.name || '').toLowerCase();
    const away = (g.teams?.away?.team?.name || '').toLowerCase();
    if (needle && (home.includes(needle) || away.includes(needle) || needle.includes(home.split(' ').pop()) || needle.includes(away.split(' ').pop()))) return g.gamePk;
    if (needle2 && (home.includes(needle2) || away.includes(needle2) || needle2.includes(home.split(' ').pop()) || needle2.includes(away.split(' ').pop()))) return g.gamePk;
  }
  return games.length === 1 ? games[0].gamePk : null;
}

/**
 * Get player batting stats from MLB Stats API live feed.
 * Returns stats object with totalBases, stolenBases, etc.
 * @param {number} gamePk - MLB game primary key
 * @param {string} playerName - Player name for fuzzy match
 * @returns {Object|null} batting stats object
 */
async function getMlbPlayerStats(gamePk, playerName) {
  if (!gamePk || !playerName) return null;
  const cacheKey = `mlb-live:${gamePk}`;
  let liveData;
  const cached = getCached(cacheKey, MLB_API_TTL);
  if (cached) {
    liveData = cached;
  } else {
    try {
      const url = `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const json = await res.json();
      liveData = json.liveData;
      setCache(cacheKey, liveData);
    } catch { return null; }
  }

  const boxscore = liveData?.boxscore;
  if (!boxscore) return null;

  const norm = playerName.toLowerCase().replace(/[^a-z ]/g, '').trim();

  // Search both teams
  for (const side of ['home', 'away']) {
    const players = boxscore.teams?.[side]?.players || {};
    for (const p of Object.values(players)) {
      const pName = (p.person?.fullName || '').toLowerCase().replace(/[^a-z ]/g, '').trim();
      if (pName === norm || pName.includes(norm) || norm.includes(pName)) {
        // Return batting stats with pitching fallback if no batting
        return p.stats?.batting || p.stats?.pitching || null;
      }
    }
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
  getGolfEventStatus,
  getPeriodScores,
  getGolfPlayerRound,
  findMlbGamePk,
  getMlbPlayerStats,
  MLB_API_STATS,
  GOLF_STATS,
  STAT_MAP,
  SPORT_STAT_OVERRIDES,
  COMPUTED_STATS,
};
