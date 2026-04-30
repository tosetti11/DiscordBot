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

// Sports with ESPN scoreboard coverage — bets on these should always get an espn_game_id
const ESPN_SUPPORTED = new Set([
  'nba', 'nfl', 'mlb', 'nhl', 'wnba',
  'cfb', 'cbb', 'ncaa_football', 'ncaa_mbb', 'ncaa_wbb',
  'mls', 'epl', 'la_liga', 'serie_a', 'bundesliga', 'ligue_1',
  'ucl', 'liga_mx', 'eredivisie', 'primeira_liga', 'europa_league',
  'mma', 'ufc',
  'tennis_atp', 'tennis_wta',
  'kbo', 'npb',
  'golf_pga',
  'nascar', 'f1',
  'rugby', 'cricket', 'cfl', 'afl',
]);

// ── Team keyword → sport mapping (for correcting GPT mis-classifications) ──
const TEAM_SPORT_KEYWORDS = {
  nhl: [
    'avalanche','blackhawks','blue jackets','blues','bruins','canadiens','canucks',
    'capitals','coyotes','devils','ducks','flames','flyers','golden knights',
    'hurricanes','islanders','jets','kings','kraken','lightning','maple leafs',
    'mammoth','oilers','panthers','penguins','predators','rangers','red wings',
    'sabres','senators','sharks','stars','wild','hockey club',
  ],
  nba: [
    'celtics','nets','knicks','76ers','raptors','bulls','cavaliers','pistons',
    'pacers','bucks','hawks','hornets','heat','magic','wizards','nuggets',
    'timberwolves','thunder','trail blazers','blazers','jazz','warriors','clippers',
    'lakers','suns','kings','mavericks','rockets','grizzlies','pelicans','spurs',
  ],
  mlb: [
    'diamondbacks','d-backs','braves','orioles','red sox','cubs','white sox',
    'reds','guardians','rockies','tigers','astros','royals','angels','dodgers',
    'marlins','brewers','twins','mets','yankees','athletics','phillies','pirates',
    'padres','giants','mariners','cardinals','rays','rangers','blue jays','nationals',
  ],
  nfl: [
    'cardinals','falcons','ravens','bills','panthers','bears','bengals','browns',
    'cowboys','broncos','lions','packers','texans','colts','jaguars','chiefs',
    'raiders','chargers','rams','dolphins','vikings','patriots','saints','giants',
    'jets','eagles','steelers','49ers','seahawks','buccaneers','titans','commanders',
  ],
};

/**
 * Infer sport from team names when GPT returns 'other'.
 * @param {string} teamA
 * @param {string} [teamB]
 * @returns {string|null} Corrected sport key, or null if no match
 */
function inferSportFromTeams(teamA, teamB) {
  const text = `${teamA || ''} ${teamB || ''}`.toLowerCase();
  for (const [sport, keywords] of Object.entries(TEAM_SPORT_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) return sport;
    }
  }
  return null;
}

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
 * Find a game by matching team name (word-boundary matching)
 * @param {string} teamName - Team name to search for
 * @param {Array} games - List of game objects from getTodaysGames
 * @returns {Object|null} Matching game
 */
function matchTeamToGame(teamName, games) {
  if (!teamName || !games?.length) return null;

  const needle = teamName.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

  // Word-boundary match: ensures short abbreviations like "la" don't match
  // inside longer words like "colorado". Uses \b regex anchors so "la" matches
  // "la kings" but not "colorado avalanche".
  const wordMatch = (search, text) => {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`).test(text);
  };

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

    if (homeNames.some(n => n === needle || wordMatch(n, needle) || wordMatch(needle, n))) return game;
    if (awayNames.some(n => n === needle || wordMatch(n, needle) || wordMatch(needle, n))) return game;
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

  // Over/Under with no stat name — golf: "Under 71.5", "Over 69.5"
  const bareOU = propDesc.match(/^(over|under)\s+([\d.]+)$/i);
  if (bareOU) {
    const direction = bareOU[1].toLowerCase();
    const line = parseFloat(bareOU[2]);
    // Infer stat from sport context
    const statName = sport === 'golf_pga' ? 'score' : 'score';
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

  // Threshold props: "1+ Home Runs", "2+ Hits", "1+ Stolen Bases"
  const threshMatch = propDesc.match(/^(\d+)\+\s+(.+)$/i);
  if (threshMatch) {
    const threshold = parseInt(threshMatch[1], 10);
    const statName = threshMatch[2].toLowerCase().trim();
    const espnKey = overrides[statName] || STAT_MAP[statName] || statName;
    // "1+ Home Runs" means >= 1, equivalent to Over 0.5
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
    const currentYear = new Date().getFullYear();
    // Sanity-check the year: new Date("1020") silently parses as year 1020, which
    // would send ESPN queries to a nonsensical date. Only trust the parsed date if
    // the year is within 5 years of today (catches bare time strings like "1020").
    if (!isNaN(d.getTime()) && d.getFullYear() >= currentYear - 1 && d.getFullYear() <= currentYear + 5) {
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

  // UFC/MMA: each fight on a card is its own game — match by fighter name
  if (sport === 'ufc' || sport === 'mma') {
    if (!teamA) return null;
    const etDate2 = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, ''); };
    const ufcDates = [];
    if (dateStr) ufcDates.push(dateStr);
    for (const off of [-1, 0, 1, 2]) { const d = etDate2(off); if (!ufcDates.includes(d)) ufcDates.push(d); }
    for (const d of ufcDates) {
      const fights = await getUFCFights(d);
      let fight = matchTeamToGame(teamA, fights);
      if (!fight && teamB) fight = matchTeamToGame(teamB, fights);
      if (fight) return { gameId: fight.id, game: fight };
    }
    return null;
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

  // Helper: ET date string with day offset
  const etDate = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
  };

  // Build ordered list of dates to try: derived date first, then yesterday/today/tomorrow/+2
  const datesToTry = [];
  if (dateStr) datesToTry.push(dateStr);
  for (const offset of [-1, 0, 1, 2]) {
    const d = etDate(offset);
    if (!datesToTry.includes(d)) datesToTry.push(d);
  }

  // Search each candidate date until we find a match
  let game = null;
  for (const d of datesToTry) {
    try {
      const games = await getTodaysGames(sport, d);
      if (!games.length) continue;
      game = matchTeamToGame(teamA, games);
      if (!game && teamB) game = matchTeamToGame(teamB, games);
      if (game) {
        // Prefer a game that's live or finished over a 'pre' game on a different date
        if (game.state !== 'pre' || d === dateStr) break;
        // Keep searching — a later date may have the actual game in progress
      }
    } catch {}
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
function resolveResult({ wagerType, pick, teamA, teamB, spreadValue, playerName, propDescription, sport, game, summary, period, fightRound, fightMethod }) {
  if (!game) return null;
  // Golf tournaments stay 'in' for days — resolve per-round via summary._golfRoundScore
  // NRFI/YRFI can resolve after 1st inning (game must be at least 'in', not 'pre')
  const isNrfiType = wagerType === 'nrfi' || wagerType === 'yrfi';
  if (isNrfiType && game.state === 'pre') return null;  // game hasn't started
  // Props/totals can early-resolve "over" direction mid-game (stat only goes up)
  const canEarlyOver = ['prop', 'homerun', 'total', 'team_total', 'mlb_live'].includes(wagerType);
  const earlyResolve = sport === 'golf_pga' || isNrfiType || canEarlyOver;
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

      // For fight bets with a specific round requirement, check the round too
      // ESPN provides the round the fight ended in via game.fightRound
      if (fightRound && (sport === 'ufc' || sport === 'mma' || sport === 'boxing')) {
        if (game.state !== 'post') return null;
        const endedInRound = game.fightRound === parseInt(fightRound);
        if (!endedInRound) return pickScore > oppScore ? 'loss' : null; // wrong round = loss if picked fighter won, wait if not
        // Correct round — still need the right fighter to have won
      }

      // Method bets (fightMethod set) can't be auto-resolved — ESPN doesn't expose KO/Sub/Decision
      if (fightMethod && (sport === 'ufc' || sport === 'mma' || sport === 'boxing')) {
        return null; // Leave for manual close
      }

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
      if (!isOver && totalScore > line) return 'loss';
      if (game.state !== 'post') return null; // live: score can still go up
      if (isOver && totalScore < line) return 'loss';
      if (!isOver && totalScore < line) return 'win';
      return 'push';
    }

    case 'team_total': {
      if (spreadValue == null || !pickTeamSide) return null;
      const teamScore = pickTeamSide === 'home' ? homeScore : awayScore;
      const line = parseFloat(spreadValue);
      const isOver = /over/i.test(pick);
      if (isOver && teamScore > line) return 'win';
      if (!isOver && teamScore > line) return 'loss';
      if (game.state !== 'post') return null; // live: score can still go up
      if (isOver && teamScore < line) return 'loss';
      if (!isOver && teamScore < line) return 'win';
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
      if (/^yes\b/i.test(pick)) {
        if (totalHRs > 0) return 'win';
        if (game.state !== 'post') return null; // live: HRs can still happen
        return 'loss';
      }
      if (/^no\b/i.test(pick)) {
        if (totalHRs > 0) return 'loss';
        if (game.state !== 'post') return null; // live: HRs can still happen
        return 'win';
      }

      // Over/Under HR bet
      if (spreadValue != null) {
        const line = parseFloat(spreadValue);
        const isOver = /over/i.test(pick);
        if (isOver && totalHRs > line) return 'win';
        if (!isOver && totalHRs > line) return 'loss';
        if (game.state !== 'post') return null; // live: HRs can still happen
        if (isOver && totalHRs < line) return 'loss';
        if (!isOver && totalHRs < line) return 'win';
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
      if (!playerData) {
        // Game over but player not in box score = DNP → push
        if (game.state === 'post') return 'push';
        return null;
      }

      // Check for DNP: player in box score but played 0 minutes (NBA/NFL/NHL)
      const minRaw = playerData.stats?.min || playerData.stats?.minutes;
      if (game.state === 'post' && minRaw !== undefined) {
        const minVal = typeof minRaw === 'string' ? parseFloat(minRaw) : minRaw;
        if (minVal === 0) return 'push'; // DNP
      }

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
        if (game.state !== 'post') return null; // live: stat can still go up
        if (statVal < parsed.line) return 'loss';
        return 'push';
      } else {
        if (statVal > parsed.line) return 'loss';
        if (game.state !== 'post') return null; // live: stat can still go up
        if (statVal < parsed.line) return 'win';
        return 'push';
      }
    }

    case 'double_chance': {
      // Pick format: "Double Chance: Arsenal or Draw" — covers 2 of 3 outcomes
      if (homeScore === awayScore) {
        // Draw — win if bet includes draw option
        return /draw/i.test(pick) ? 'win' : 'loss';
      }
      // A team won — check if it's the team the user picked via identifyPickSide
      if (!pickTeamSide) return null;
      const pickScore = pickTeamSide === 'home' ? homeScore : awayScore;
      const oppScore  = pickTeamSide === 'home' ? awayScore : homeScore;
      return pickScore > oppScore ? 'win' : 'loss';
    }

    case 'draw_no_bet': {
      if (homeScore === awayScore) return 'push'; // Draw = push
      if (!pickTeamSide) return null;
      const pickScore = pickTeamSide === 'home' ? homeScore : awayScore;
      const oppScore = pickTeamSide === 'home' ? awayScore : homeScore;
      return pickScore > oppScore ? 'win' : 'loss';
    }

    case 'mlb_live': {
      // MLB Live bets — resolve using ESPN linescore + MLB Stats API play-by-play
      if (!pick) return null;

      // ── Next Pitch — resolve from play-by-play pitch events ──
      // Pick format: "Next Pitch: Strike (Called) — Cole to Trout (3rd AB, Pitch 2) | NYY vs LAA"
      const nextPitchMatch = pick.match(/Next Pitch:\s*(.+?)\s*—\s*(.+?)\s+to\s+(.+?)\s*\((?:(\d+)(?:st|nd|rd|th)\s+AB|AB\s+(\d+)),\s*Pitch\s+(\d+)\)/i);
      if (nextPitchMatch) {
        const expectedOutcome = nextPitchMatch[1].trim();
        const pitcherName = nextPitchMatch[2].trim();
        const batterName = nextPitchMatch[3].trim();
        const abNum = parseInt(nextPitchMatch[4] || nextPitchMatch[5]);
        const pitchNumInAB = parseInt(nextPitchMatch[6]);
        const pbp = summary?._mlbPlayByPlay;
        if (!pbp) return null;

        // Find the batter's Nth plate appearance (including in-progress ones)
        const atBat = findPlayerAtBatIncludeActive(pbp, batterName, abNum);
        if (!atBat) return null;

        // Find the specific pitch within this AB
        const pitchEvents = (atBat.playEvents || []).filter(e => e.isPitch);
        if (pitchNumInAB > pitchEvents.length) return null; // pitch hasn't happened yet
        const pitch = pitchEvents[pitchNumInAB - 1];
        if (!pitch) return null;

        const callDesc = (pitch.details?.description || pitch.details?.call?.description || '').toLowerCase();

        // Map MLB API pitch descriptions to our outcome values
        const outcomeMap = {
          'strike/foul': ['called strike', 'strike looking', 'swinging strike', 'swinging strike (blocked)', 'missed bunt', 'foul', 'foul tip', 'foul bunt', 'foul pitchout'],
          'ball/hbp': ['ball', 'ball in dirt', 'intent ball', 'pitchout', 'automatic ball', 'hit by pitch'],
          'in play': ['in play, out(s)', 'in play, no out', 'in play, run(s)', 'hit into play'],
        };

        const expectedNorm = expectedOutcome.toLowerCase();
        const matches = outcomeMap[expectedNorm];
        if (matches) {
          return matches.some(m => callDesc.includes(m)) ? 'win' : 'loss';
        }
        // Fallback direct comparison
        return callDesc.includes(expectedNorm) ? 'win' : 'loss';
      }
      // Next pitch without AB/Pitch context — can't resolve
      if (pick.startsWith('Next Pitch:')) return null;

      // ── At Bat: Pitch Count O/U ──
      // Pick format: "Player 1st AB — Pitch Count Over 4.5" or "AB #3 Pitch Count Over 4.5 (Player)"
      const abPitchMatch = pick.match(/(?:(\d+)(?:st|nd|rd|th) AB|AB #(\d+)).*Pitch Count (Over|Under) ([\d.]+)/i);
      if (abPitchMatch) {
        const abNum = parseInt(abPitchMatch[1] || abPitchMatch[2]);
        const dir = abPitchMatch[3].toLowerCase();
        const line = parseFloat(abPitchMatch[4]);
        const pbp = summary?._mlbPlayByPlay;
        if (!pbp) return null;

        // Extract player name from pick
        const nameMatch = pick.match(/^(.+?)\s+\d+(?:st|nd|rd|th)\s+AB/i) || pick.match(/\(([^)]+)\)\s*$/);
        const playerName = nameMatch ? nameMatch[1].trim() : null;
        if (!playerName) return null;

        const atBat = findPlayerAtBat(pbp, playerName, abNum);
        if (!atBat) return null; // AB hasn't happened yet or player not found

        // Count pitches in this at-bat
        const pitchCount = (atBat.playEvents || []).filter(e => e.isPitch).length;
        if (dir === 'over') {
          if (pitchCount > line) return 'win';
          if (pitchCount < line) return 'loss';
          return 'push';
        } else {
          if (pitchCount < line) return 'win';
          if (pitchCount > line) return 'loss';
          return 'push';
        }
      }

      // ── At Bat: Pitch Count Exact ──
      // Pick format: "AB #3 Pitch Count Exact: 4 (Player)" or "Player 1st AB — Pitch Count Exact: 7+"
      const abPitchExactMatch = pick.match(/(?:(\d+)(?:st|nd|rd|th) AB|AB #(\d+)).*Pitch Count Exact:\s*(\d+\+?)/i);
      if (abPitchExactMatch) {
        const abNum = parseInt(abPitchExactMatch[1] || abPitchExactMatch[2]);
        const expectedCount = abPitchExactMatch[3]; // e.g. "4" or "7+"
        const pbp = summary?._mlbPlayByPlay;
        if (!pbp) return null;

        const nameMatch = pick.match(/^(.+?)\s+\d+(?:st|nd|rd|th)\s+AB/i) || pick.match(/\(([^)]+)\)\s*$/);
        const playerName = nameMatch ? nameMatch[1].trim() : null;
        if (!playerName) return null;

        const atBat = findPlayerAtBat(pbp, playerName, abNum);
        if (!atBat) return null;

        const pitchCount = (atBat.playEvents || []).filter(e => e.isPitch).length;
        if (expectedCount === '7+') {
          return pitchCount >= 7 ? 'win' : 'loss';
        } else {
          return pitchCount === parseInt(expectedCount) ? 'win' : 'loss';
        }
      }

      // ── At Bat: Exact Outcome ──
      // Pick format: "Player 1st AB — Single" or "AB #3 Exact Outcome: Strikeout (Player)"
      const abOutcomeMatch = pick.match(/(?:(\d+)(?:st|nd|rd|th) AB|AB #(\d+)).*(?:—\s*(.+?)(?:\s*\|)|Exact Outcome:\s*(.+?)(?:\s*\(|\s*\|))/i);
      if (abOutcomeMatch) {
        const abNum = parseInt(abOutcomeMatch[1] || abOutcomeMatch[2]);
        const expectedOutcome = (abOutcomeMatch[3] || abOutcomeMatch[4] || '').trim().toLowerCase();
        if (!expectedOutcome) return null;
        const pbp = summary?._mlbPlayByPlay;
        if (!pbp) return null;

        const nameMatch = pick.match(/^(.+?)\s+\d+(?:st|nd|rd|th)\s+AB/i) || pick.match(/\(([^)]+)\)\s*$/);
        const playerName = nameMatch ? nameMatch[1].trim() : null;
        if (!playerName) return null;

        const atBat = findPlayerAtBat(pbp, playerName, abNum);
        if (!atBat) return null;

        const actualEvent = (atBat.result?.event || '').toLowerCase();
        const actualType = (atBat.result?.eventType || '').toLowerCase();

        // Normalize outcome comparisons
        const outcomeMap = {
          'in play out': ['groundout', 'grounded_into_double_play', 'ground_out', 'force_out', 'flyout', 'fly_out', 'field_out', 'lineout', 'line_out', 'pop_out', 'pop out', 'line out', 'foul_out', 'sac_fly', 'sac_bunt', 'sacrifice_fly', 'sacrifice_bunt', 'fielders_choice', 'fielders_choice_out', 'double_play'],
          'strikeout': ['strikeout', 'strikeout_looking', 'strikeout_swinging', 'called_strikeout'],
          'single': ['single'],
          'walk/hbp': ['walk', 'hit_by_pitch'],
          'double': ['double'],
          'home run': ['home_run', 'home run'],
          'reach on error': ['error', 'field_error'],
          'triple': ['triple'],
        };

        const matches = outcomeMap[expectedOutcome];
        if (matches) {
          return (matches.includes(actualType) || matches.includes(actualEvent)) ? 'win' : 'loss';
        }
        // Fallback: direct comparison
        return (actualEvent === expectedOutcome || actualType === expectedOutcome) ? 'win' : 'loss';
      }

      // ── At Bat: On Base ──
      // Pick format: "Player 1st AB — On Base: Yes" or "AB #3 On Base: Yes (Player)"
      const abOnBaseMatch = pick.match(/(?:(\d+)(?:st|nd|rd|th) AB|AB #(\d+)).*On Base:\s*(Yes|No)/i);
      if (abOnBaseMatch) {
        const abNum = parseInt(abOnBaseMatch[1] || abOnBaseMatch[2]);
        const expectedOnBase = abOnBaseMatch[3].toLowerCase() === 'yes';
        const pbp = summary?._mlbPlayByPlay;
        if (!pbp) return null;

        const nameMatch = pick.match(/^(.+?)\s+\d+(?:st|nd|rd|th)\s+AB/i) || pick.match(/\(([^)]+)\)\s*$/);
        const playerName = nameMatch ? nameMatch[1].trim() : null;
        if (!playerName) return null;

        const atBat = findPlayerAtBat(pbp, playerName, abNum);
        if (!atBat) return null;

        // Check if batter reached base — check runners for end base, or result.event type
        const reachedBase = (atBat.runners || []).some(r => {
          const batter = r.details?.runner?.fullName || '';
          const nameNorm = playerName.toLowerCase().replace(/[^a-z ]/g, '').trim();
          const runnerNorm = batter.toLowerCase().replace(/[^a-z ]/g, '').trim();
          if (runnerNorm !== nameNorm && !runnerNorm.includes(nameNorm) && !nameNorm.includes(runnerNorm)) return false;
          // Runner reached a base (not out)
          return r.movement?.end && !r.movement?.isOut;
        });

        if (expectedOnBase && reachedBase) return 'win';
        if (expectedOnBase && !reachedBase) return 'loss';
        if (!expectedOnBase && !reachedBase) return 'win';
        return 'loss';
      }

      // ── Pitch by Pitch: MPH ──
      // Pick format: "Pitcher — Pitch #42 Faster than 96 MPH" or "Pitcher Pitch #42 Faster 96 MPH"
      const pitchMatch = pick.match(/^(.+?)(?:\s*—\s*|\s+)Pitch #(\d+)\s+(Faster|Slower)(?:\s+than)?\s+([\d.]+)\s*MPH/i);
      if (pitchMatch) {
        const pitcherName = pitchMatch[1].trim();
        const pitchNum = parseInt(pitchMatch[2]);
        const dir = pitchMatch[3].toLowerCase();
        const mphLine = parseFloat(pitchMatch[4]);
        const pbp = summary?._mlbPlayByPlay;
        if (!pbp) return null;

        const pitch = findPitcherPitch(pbp, pitcherName, pitchNum);
        if (!pitch) return null; // pitch hasn't been thrown yet

        const speed = pitch.pitchData?.startSpeed;
        if (speed == null) return null;

        if (dir === 'faster') {
          if (speed > mphLine) return 'win';
          if (speed < mphLine) return 'loss';
          return 'push';
        } else {
          if (speed < mphLine) return 'win';
          if (speed > mphLine) return 'loss';
          return 'push';
        }
      }

      // ── Inning Runs O/U (existing linescore-based logic) ──
      const inningRunsMatch = pick.match(/Inning (\d+) Runs (Over|Under) ([\d.]+)/i);
      if (inningRunsMatch) {
        const innNum = parseInt(inningRunsMatch[1]);
        const dir = inningRunsMatch[2].toLowerCase();
        const line = parseFloat(inningRunsMatch[3]);
        const linescores = getLinescores(game);
        if (!linescores) return null;
        // Inning index is 0-based
        const homeInn = linescores.home?.[innNum - 1];
        const awayInn = linescores.away?.[innNum - 1];
        if (!homeInn && !awayInn) return null; // inning hasn't happened yet
        const homeR = parseFloat(homeInn?.displayValue || homeInn?.value || '0');
        const awayR = parseFloat(awayInn?.displayValue || awayInn?.value || '0');
        // Wait for full inning to complete
        if (game.state === 'in') {
          const currentInning = game._raw?.competitions?.[0]?.status?.period || 0;
          if (currentInning <= innNum) return null;
        }
        const totalRuns = homeR + awayR;
        if (dir === 'over') {
          if (totalRuns > line) return 'win';
          if (game.state !== 'post' && game._raw?.competitions?.[0]?.status?.period <= innNum) return null;
          if (totalRuns < line) return 'loss';
          return 'push';
        } else {
          if (totalRuns > line) return 'loss';
          if (game.state !== 'post' && game._raw?.competitions?.[0]?.status?.period <= innNum) return null;
          if (totalRuns < line) return 'win';
          return 'push';
        }
      }

      const inningHRMatch = pick.match(/^Inning (\d+) HR: (Yes|No)/i);
      if (inningHRMatch) {
        // Can't reliably resolve HR per inning from ESPN linescore alone
        return null;
      }

      // AB-level and pitch-level bets can't be resolved from ESPN
      return null;
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
    const competitionState = compStatus?.type?.state || 'pre'; // 'pre', 'in', 'post'
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

    // Determine round status — only use period inference if competition is actually underway
    let roundStatus = 'pre'; // not started
    if (round?.linescores?.length === 18) roundStatus = 'post'; // complete (hole data present)
    else if (round?.linescores?.length > 0) roundStatus = 'in'; // in progress (hole data present)
    else if (competitionState !== 'pre' && roundNum < currentRound) roundStatus = 'post'; // past round, competition live/done

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

/**
 * Get MLB play-by-play data for AB-level and pitch-level resolution.
 * @param {number} gamePk - MLB game primary key
 * @returns {Object|null} { allPlays, currentPlay, playsByInning }
 */
async function getMlbPlayByPlay(gamePk) {
  if (!gamePk) return null;
  const cacheKey = `mlb-pbp:${gamePk}`;
  const cached = getCached(cacheKey, 30_000); // 30s cache — more frequent for live AB tracking
  if (cached) return cached;

  try {
    const url = `https://statsapi.mlb.com/api/v1/game/${encodeURIComponent(gamePk)}/playByPlay`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const pbp = {
      allPlays: json.allPlays || [],
      currentPlay: json.currentPlay || null,
      playsByInning: json.playsByInning || [],
    };
    setCache(cacheKey, pbp);
    return pbp;
  } catch { return null; }
}

/**
 * Find a specific at-bat in play-by-play data.
 * Matches by batter name + sequential AB number for that batter.
 * @param {Object} pbp - Play-by-play data from getMlbPlayByPlay
 * @param {string} playerName - Batter name
 * @param {number} abNumber - Which AB for this player (1st, 2nd, 3rd, etc.)
 * @returns {Object|null} The matching play object, or null
 */
/**
 * Find a player's Nth plate appearance, including in-progress ABs.
 * Unlike findPlayerAtBat which only counts completed ABs, this counts
 * all plate appearances so we can resolve pitch-level bets during an AB.
 */
function findPlayerAtBatIncludeActive(pbp, playerName, abNumber) {
  if (!pbp?.allPlays || !playerName || !abNumber) return null;
  const norm = playerName.toLowerCase().replace(/[^a-z ]/g, '').trim();
  let count = 0;
  for (const play of pbp.allPlays) {
    const batter = (play.matchup?.batter?.fullName || '').toLowerCase().replace(/[^a-z ]/g, '').trim();
    if (!batter) continue;
    if (batter === norm || batter.includes(norm) || norm.includes(batter)) {
      count++;
      if (count === abNumber) return play;
    }
  }
  return null;
}

function findPlayerAtBat(pbp, playerName, abNumber) {
  if (!pbp?.allPlays || !playerName || !abNumber) return null;
  const norm = playerName.toLowerCase().replace(/[^a-z ]/g, '').trim();
  let count = 0;
  for (const play of pbp.allPlays) {
    const batter = (play.matchup?.batter?.fullName || '').toLowerCase().replace(/[^a-z ]/g, '').trim();
    if (!batter) continue;
    if (batter === norm || batter.includes(norm) || norm.includes(batter)) {
      // Only count completed at-bats (result.type === 'atBat')
      if (play.result?.type === 'atBat' || play.about?.isComplete) {
        count++;
        if (count === abNumber) return play;
      }
    }
  }
  return null;
}

/**
 * Find a specific pitch in play-by-play data.
 * @param {Object} pbp - Play-by-play data from getMlbPlayByPlay
 * @param {string} pitcherName - Pitcher name
 * @param {number} pitchNumber - Pitch # overall for this pitcher in the game
 * @returns {Object|null} The matching pitch event, or null
 */
function findPitcherPitch(pbp, pitcherName, pitchNumber) {
  if (!pbp?.allPlays || !pitcherName || !pitchNumber) return null;
  const norm = pitcherName.toLowerCase().replace(/[^a-z ]/g, '').trim();
  let count = 0;
  for (const play of pbp.allPlays) {
    const pitcher = (play.matchup?.pitcher?.fullName || '').toLowerCase().replace(/[^a-z ]/g, '').trim();
    if (!pitcher) continue;
    if (pitcher === norm || pitcher.includes(norm) || norm.includes(pitcher)) {
      // Count pitches from this pitcher's at-bats
      for (const evt of (play.playEvents || [])) {
        if (evt.isPitch) {
          count++;
          if (count === pitchNumber) return evt;
        }
      }
    }
  }
  return null;
}

/**
 * Find a specific game by ESPN game ID, trying multiple dates to handle:
 *  - Late-night games that cross midnight ET
 *  - event_start_time entered incorrectly / off by a day
 *  - UTC vs ET date mismatch in ESPN's API
 *
 * Tries: preferredDateStr → today (ET) → yesterday (ET) → tomorrow (ET)
 *
 * @param {string} sport - Internal sport key
 * @param {string} gameId - ESPN game/event ID
 * @param {string} [preferredDateStr] - YYYYMMDD date to try first
 * @returns {Object|null} Game object or null if not found
 */
async function findGameById(sport, gameId, preferredDateStr) {
  if (!sport || !gameId) return null;
  const etDate = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
  };
  const today = etDate(0);
  const yesterday = etDate(-1);
  const tomorrow = etDate(1);

  const datesToTry = [...new Set([preferredDateStr, today, yesterday, tomorrow].filter(Boolean))];

  for (const ds of datesToTry) {
    try {
      const games = await getTodaysGames(sport, ds);
      const game = games.find(g => g.id === gameId);
      if (game) return game;
    } catch {}
  }
  return null;
}

/**
 * Get all individual fights from the UFC card on a given date.
 * Returns each fight as a game-like object where score is 1 for the winner and 0 for the loser,
 * so the standard moneyline resolveResult() logic works without modification.
 * @param {string} [dateStr] - YYYYMMDD
 * @returns {Array} Fight objects shaped like team game objects
 */
async function getUFCFights(dateStr) {
  const today = dateStr || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
  const cacheKey = `ufc-fights:${today}`;
  const cached = getCached(cacheKey, SCOREBOARD_TTL);
  if (cached) return cached;

  const url = `https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?dates=${today}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();

    const fights = [];
    for (const event of (json.events || [])) {
      for (const comp of (event.competitions || [])) {
        const f1 = comp.competitors?.find(c => c.order === 1) || comp.competitors?.[0];
        const f2 = comp.competitors?.find(c => c.order === 2) || comp.competitors?.[1];
        if (!f1 || !f2) continue;

        const statusType = comp.status?.type || {};
        const state = statusType.state || 'pre';
        const round = comp.status?.period || 0;

        // Map winner to score=1, loser to score=0 so standard moneyline resolution works
        const f1Name = f1.athlete?.displayName || f1.athlete?.fullName || '';
        const f2Name = f2.athlete?.displayName || f2.athlete?.fullName || '';

        fights.push({
          id: comp.id,
          sport: 'ufc',
          eventId: event.id,
          name: `${f1Name} vs ${f2Name}`,
          shortName: `${f1.athlete?.shortName || f1Name} vs ${f2.athlete?.shortName || f2Name}`,
          startTime: event.date,
          state,
          completed: statusType.completed || false,
          detail: statusType.shortDetail || '',
          // Map fighter 1 (order=1) as "home", fighter 2 (order=2) as "away"
          // Score is 1 for winner, 0 for loser — makes moneyline resolution work
          home: {
            id: f1.id,
            name: f1Name,
            abbreviation: f1.athlete?.shortName || f1Name,
            shortName: f1.athlete?.shortName || f1Name,
            score: f1.winner ? 1 : 0,
            record: f1.records?.[0]?.summary || '',
          },
          away: {
            id: f2.id,
            name: f2Name,
            abbreviation: f2.athlete?.shortName || f2Name,
            shortName: f2.athlete?.shortName || f2Name,
            score: f2.winner ? 1 : 0,
            record: f2.records?.[0]?.summary || '',
          },
          // Fight-specific fields for round-bet resolution
          fightRound: round,
          fightClock: comp.status?.displayClock || '',
          linescores: { home: [], away: [] },
          _raw: { competitions: [comp] },
        });
      }
    }

    setCache(cacheKey, fights);
    return fights;
  } catch (err) {
    console.error('[ESPN] UFC fights fetch error:', err.message);
    return [];
  }
}

/**
 * Get live 2-ball or 3-ball golf match-play data.
 *
 * Fetches round scores for all players and calculates match-play
 * status (X Up / All Square / X Dn) relative to Group A.
 *
 * For team format (Zurich Classic): pass two players per side; their
 * round scores are combined (summed stroke total for the day).
 *
 * @param {Object} params
 * @param {string}  params.playerA  - Group A player 1 name
 * @param {string}  [params.playerA2] - Group A player 2 (team format)
 * @param {string}  params.playerB  - Group B / opponent player 1
 * @param {string}  [params.playerB2] - Group B player 2 (team format)
 * @param {string}  [params.playerC]  - 3rd player (3-ball only)
 * @param {number}  [params.roundNum] - Tournament round (1-4)
 * @returns {Object|null} match-play data structure
 */
async function getGolf2BallLive({ playerA, playerA2, playerB, playerB2, playerC, roundNum, holeNum } = {}) {
  if (!playerA || !playerB) return null;

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
    const tournamentName = event.name || 'Tournament';

    // Fuzzy player finder
    function normName(s) {
      return (s || '').toLowerCase().replace(/[^a-z ]/g, '').trim();
    }

    function nameMatches(entryName, searchName) {
      if (!entryName || !searchName) return false;
      const dn = normName(entryName);
      const norm = normName(searchName);
      if (!dn || !norm) return false;
      const lastName = norm.split(' ').pop();
      return dn === norm || dn.includes(norm) || norm.includes(dn) || dn.includes(lastName);
    }

    function getCompName(c) {
      return c.athlete?.displayName || c.team?.displayName || c.team?.name || c.athlete?.fullName || '';
    }

    // For TEAM format (playerA2 specified), try to find a single ESPN entry containing BOTH names.
    // This handles Zurich Classic where pairs are stored as "LastA/LastB" team entries.
    function findTeamComp(nameA, nameB) {
      if (!nameA || !nameB) return null;
      return competitors.find(c => {
        const dn = normName(getCompName(c));
        return nameMatches(dn, nameA) && nameMatches(dn, nameB);
      });
    }

    function findComp(name) {
      if (!name) return null;
      return competitors.find(c => nameMatches(getCompName(c), name));
    }

    // Extract per-player round info
    function extractPlayer(comp, rNum) {
      if (!comp) return { name: null, found: false, roundScore: null, holesCompleted: 0, roundStatus: 'pre', overallScore: 'E', holeStrokes: null, holeCompleted: false };

      const rounds = comp.linescores || [];
      const currentRound = event.competitions?.[0]?.status?.period || rounds.length || 1;
      const rIdx = rNum ? rNum - 1 : currentRound - 1;
      const round = rounds[rIdx];

      let holesCompleted = 0;
      let toParScore = 0;
      let hasToParData = false;
      let strokeCount = 0;
      let holeStrokes = null;   // strokes on the specific holeNum (null = not yet played)
      let holeCompleted = false;

      if (round?.linescores?.length) {
        holesCompleted = round.linescores.length;
        for (const hole of round.linescores) {
          // hole.value = raw stroke count; scoreType.displayValue = to-par
          strokeCount += hole.value || 0;
          const tpStr = hole.scoreType?.displayValue ?? hole.t?.displayValue;
          if (tpStr !== undefined && tpStr !== null) {
            hasToParData = true;
            toParScore += tpStr === 'E' ? 0 : (parseInt(tpStr) || 0);
          }
          // Hole-specific: hole.period is the hole number (1-18)
          if (holeNum && hole.period === holeNum) {
            holeStrokes = hole.value || 0;
            holeCompleted = true;
          }
        }
      }

      let roundStatus = 'pre';
      if (holesCompleted === 18) roundStatus = 'post';
      else if (holesCompleted > 0) roundStatus = 'in';
      else if (rIdx < currentRound - 1) roundStatus = 'post';

      // Round score: use per-hole to-par sum (most reliable), or round.value only if it looks like to-par (small integer)
      let roundScore = null;
      if (holesCompleted > 0 && hasToParData) {
        roundScore = toParScore;
      } else if (holesCompleted > 0 && round?.value != null && Math.abs(round.value) <= 30) {
        // round.value is to-par only if small; large values (e.g. 47) are raw stroke counts
        roundScore = round.value;
      }

      // Name: athlete for individual events, team for team events (e.g. Zurich Classic)
      const name = comp.athlete?.displayName || comp.team?.displayName || comp.team?.name || null;

      return {
        name,
        found: true,
        roundScore,
        strokeCount: holesCompleted > 0 ? strokeCount : null,
        holesCompleted,
        roundStatus,
        overallScore: comp.score || 'E',
        position: comp.order || null,
        holeStrokes,
        holeCompleted,
      };
    }

    // For team format, try to find a SINGLE team entry containing BOTH players first;
    // fall back to individual lookups if not found.
    const compA  = (playerA2 ? findTeamComp(playerA, playerA2) : null) || findComp(playerA);
    const compA2 = playerA2 ? ((compA && nameMatches(getCompName(compA), playerA2)) ? compA : findComp(playerA2)) : null;
    const compB  = (playerB2 ? findTeamComp(playerB, playerB2) : null) || findComp(playerB);
    const compB2 = playerB2 ? ((compB && nameMatches(getCompName(compB), playerB2)) ? compB : findComp(playerB2)) : null;
    const compC  = playerC  ? findComp(playerC)  : null;

    const pA  = extractPlayer(compA,  roundNum);
    const pA2 = extractPlayer(compA2, roundNum);
    const pB  = extractPlayer(compB,  roundNum);
    const pB2 = extractPlayer(compB2, roundNum);
    const pC  = extractPlayer(compC,  roundNum);

    // Determine max holes completed across all players for context
    const allPlayers = [pA, pA2, pB, pB2, pC].filter(p => p.found);
    const maxHoles = Math.max(0, ...allPlayers.map(p => p.holesCompleted));
    const isTeamFormat = !!(playerA2 || playerB2);
    const is3Ball = !!playerC;

    // For team-format events (e.g. Zurich Classic), ESPN stores each PAIR as a single competitor.
    // If playerA and playerA2 both match the same competitor, don't double-count the score.
    const teamAisSingleEntry = isTeamFormat && compA != null && compA === compA2;
    const teamBisSingleEntry = isTeamFormat && compB != null && compB === compB2;

    const groupAScore = pA.roundScore != null
      ? pA.roundScore + (!teamAisSingleEntry && isTeamFormat && pA2.roundScore != null ? pA2.roundScore : 0)
      : null;
    const groupBScore = pB.roundScore != null
      ? pB.roundScore + (!teamBisSingleEntry && isTeamFormat && pB2.roundScore != null ? pB2.roundScore : 0)
      : null;
    const groupCScore = is3Ball ? pC.roundScore : null;

    // Display names: for team entries, use the ESPN team name directly; otherwise build from individual names
    const groupADisplayName = isTeamFormat
      ? (teamAisSingleEntry && pA.name ? pA.name : `${pA.name || playerA} / ${pA2.name || playerA2}`)
      : (pA.name || playerA);
    const groupBDisplayName = isTeamFormat
      ? (teamBisSingleEntry && pB.name ? pB.name : `${pB.name || playerB} / ${pB2.name || playerB2}`)
      : (pB.name || playerB);

    // Match play status relative to group A (lower score = better in golf)
    function matchStatus(scoreA, scoreB) {
      if (scoreA == null || scoreB == null) return null;
      const diff = scoreB - scoreA; // positive = A is winning
      if (diff > 0) return { up: diff, label: `${diff} Up`, ahead: true };
      if (diff < 0) return { down: Math.abs(diff), label: `${Math.abs(diff)} Dn`, ahead: false };
      return { label: 'AS', ahead: null }; // All Square
    }

    const statusVsB = matchStatus(groupAScore, groupBScore);
    const statusVsC = is3Ball ? matchStatus(groupAScore, groupCScore) : null;

    // Determine overall round status
    const statuses = allPlayers.map(p => p.roundStatus);
    let overallStatus = 'pre';
    if (statuses.every(s => s === 'post')) overallStatus = 'post';
    else if (statuses.some(s => s === 'in' || s === 'post')) overallStatus = 'in';

    // ── Hole-specific mode ──
    // When holeNum is set, compute per-group hole strokes and a hole winner.
    // For team format (A2/B2), lowest single-player stroke count on the hole wins (best-ball/alt-shot TBD).
    let holeMode = false;
    let holeData = null;
    if (holeNum) {
      holeMode = true;
      // Find holes completed for the target hole from each primary player
      const holeA = pA.holeCompleted ? pA.holeStrokes : (isTeamFormat && pA2.holeCompleted ? pA2.holeStrokes : null);
      const holeB = pB.holeCompleted ? pB.holeStrokes : (isTeamFormat && pB2.holeCompleted ? pB2.holeStrokes : null);
      const holeC = is3Ball && pC.holeCompleted ? pC.holeStrokes : null;

      // A hole is completed for a group once we have their strokes for it
      const holeADone = holeA != null;
      const holeBDone = holeB != null;
      const holeCDone = !is3Ball || holeC != null;
      const holeCompleted = holeADone && holeBDone && holeCDone;

      // Hole winner (lower strokes wins; tie = all square)
      let holeWinner = null; // 'A', 'B', 'C', or 'tie'
      if (holeCompleted) {
        const scores = [
          { group: 'A', strokes: holeA },
          { group: 'B', strokes: holeB },
          ...(is3Ball ? [{ group: 'C', strokes: holeC }] : []),
        ];
        const minStrokes = Math.min(...scores.map(s => s.strokes));
        const winners = scores.filter(s => s.strokes === minStrokes);
        holeWinner = winners.length === 1 ? winners[0].group : 'tie';
      }

      // Hole status: 'pre' if nobody on the hole yet, 'in' if some are done, 'post' if all done
      const anyStarted = holeADone || holeBDone || (is3Ball && holeC != null);
      const holeStatus = holeCompleted ? 'post' : (anyStarted ? 'in' : 'pre');
      // Also treat as post if everyone has passed the hole already (holesCompleted >= holeNum)
      const allPastHole = allPlayers.every(p => p.holesCompleted >= holeNum);
      const holeOverallStatus = (holeCompleted || allPastHole) ? 'post' : holeStatus;

      holeData = {
        holeNum,
        holeA, holeB, holeC,
        holeCompleted: holeCompleted || allPastHole,
        holeWinner,       // 'A', 'B', 'C', 'tie', or null
        overallStatus: holeOverallStatus,
      };

      // When in hole mode, overallStatus tracks the hole completion status
      if (holeOverallStatus === 'post') overallStatus = 'post';
      else if (holeOverallStatus === 'in' || holeOverallStatus === 'pre') {
        overallStatus = anyStarted ? 'in' : 'pre';
      }
    }

    return {
      tournamentName,
      roundNum: roundNum || (event.competitions?.[0]?.status?.period || 1),
      overallStatus,
      isTeamFormat,
      is3Ball,
      holeMode,
      holeData,
      maxHoles,
      groupA: {
        displayName: groupADisplayName,
        player1: pA,
        player2: isTeamFormat && !teamAisSingleEntry ? pA2 : null,
        roundScore: groupAScore,
        strokeCount: pA.strokeCount != null
          ? pA.strokeCount + (!teamAisSingleEntry && isTeamFormat && pA2.strokeCount != null ? pA2.strokeCount : 0)
          : null,
        holesCompleted: Math.max(pA.holesCompleted, isTeamFormat && !teamAisSingleEntry ? (pA2.holesCompleted || 0) : 0),
        holeStrokes: holeMode ? (holeData?.holeA ?? null) : null,
      },
      groupB: {
        displayName: groupBDisplayName,
        player1: pB,
        player2: isTeamFormat && !teamBisSingleEntry ? pB2 : null,
        roundScore: groupBScore,
        strokeCount: pB.strokeCount != null
          ? pB.strokeCount + (!teamBisSingleEntry && isTeamFormat && pB2.strokeCount != null ? pB2.strokeCount : 0)
          : null,
        holesCompleted: Math.max(pB.holesCompleted, isTeamFormat && !teamBisSingleEntry ? (pB2.holesCompleted || 0) : 0),
        holeStrokes: holeMode ? (holeData?.holeB ?? null) : null,
      },
      groupC: is3Ball ? {
        displayName: pC.name || playerC,
        player1: pC,
        player2: null,
        roundScore: groupCScore,
        holesCompleted: pC.holesCompleted,
        holeStrokes: holeMode ? (holeData?.holeC ?? null) : null,
      } : null,
      matchStatus: statusVsB,
      matchStatusVsC: statusVsC,
    };
  } catch (err) {
    console.error('[ESPN] Golf 2-ball live error:', err.message);
    return null;
  }
}

module.exports = {
  ESPN_PATHS,
  ESPN_SUPPORTED,
  getTodaysGames,
  getUFCFights,
  findGameById,
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
  getGolf2BallLive,
  findMlbGamePk,
  getMlbPlayerStats,
  getMlbPlayByPlay,
  findPlayerAtBat,
  findPitcherPitch,
  inferSportFromTeams,
  MLB_API_STATS,
  GOLF_STATS,
  STAT_MAP,
  SPORT_STAT_OVERRIDES,
  COMPUTED_STATS,
};
