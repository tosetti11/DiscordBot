/**
 * MLB Daily Market Analysis Service
 * Generates daily NRFI, Strikeout O/U, and Home Run analyses
 * for every MLB game using ESPN data + GPT-4o.
 */
const { getTodaysGames, getGameSummary } = require('./espn');
const mlbDb = require('../database/mlbAnalysis');
const { generateNrfiCardImage, generateStrikeoutCardImage, generateHomerunCardImage } = require('../utils/mlbAnalysisCardImage');

// Channel IDs
const NRFI_CHANNEL_ID = '1490775859664257157';
const STRIKEOUT_CHANNEL_ID = '1490776189810381022';
const HOMERUN_CHANNEL_ID = '1490776370500862173';

const MARKET_CHANNELS = {
  nrfi: NRFI_CHANNEL_ID,
  strikeout: STRIKEOUT_CHANNEL_ID,
  homerun: HOMERUN_CHANNEL_ID,
};

const MARKET_HEADERS = {
  nrfi: '⚾ **MLB NRFI DAILY ANALYSIS** ⚾',
  strikeout: '🔥 **MLB STRIKEOUT O/U DAILY ANALYSIS** 🔥',
  homerun: '💣 **MLB HOME RUN DAILY ANALYSIS** 💣',
};

/**
 * Fetch all MLB games with enriched data (pitchers, odds, weather)
 */
async function fetchEnrichedMLBGames() {
  const games = await getTodaysGames('mlb');
  const preGames = games.filter(g => g.state === 'pre');

  const enriched = [];
  for (const game of preGames) {
    // Get summary for weather and predictor data
    let weather = null;
    let predictor = null;
    try {
      const summary = await getGameSummary('mlb', game.id);
      if (summary) {
        // Weather is in the raw response, re-fetch to get it
        const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${game.id}`);
        const json = await res.json();
        weather = json.gameInfo?.weather || null;
        predictor = json.predictor || null;
      }
    } catch (e) {
      // Non-critical, continue without weather
    }

    enriched.push({
      ...game,
      weather,
      predictor,
    });
  }

  return enriched;
}

/**
 * Extract probable pitcher info from ESPN scoreboard competition data
 */
function extractFromScoreboard(game) {
  return {
    espnGameId: game.id,
    homeTeam: game.home.name,
    homeAbbr: game.home.abbreviation,
    homeRecord: game.home.record,
    awayTeam: game.away.name,
    awayAbbr: game.away.abbreviation,
    awayRecord: game.away.record,
    startTime: game.startTime,
    spread: game.odds?.spread || 'N/A',
    overUnder: game.odds?.overUnder || 'N/A',
    weather: game.weather,
    predictor: game.predictor,
    broadcast: game.broadcast || '',
  };
}

/**
 * Fetch full scoreboard with probable pitchers from ESPN raw API
 */
async function fetchMLBScoreboardRaw() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
  const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${today}`;
  const res = await fetch(url);
  const json = await res.json();

  const games = [];
  for (const event of (json.events || [])) {
    const comp = event.competitions?.[0];
    if (!comp) continue;

    const status = event.status?.type?.state || 'pre';
    // Include pre-game AND games that just started (1st inning or earlier)
    // so early-start games aren't missed when analysis runs at 9 AM ET
    const period = event.status?.period || 0;
    if (status === 'post') continue;
    if (status === 'in' && period > 1) continue;

    const home = comp.competitors?.find(c => c.homeAway === 'home');
    const away = comp.competitors?.find(c => c.homeAway === 'away');
    if (!home || !away) continue;

    // Extract probable pitchers
    const homeProbable = home.probables?.[0];
    const awayProbable = away.probables?.[0];

    // Extract full odds
    const odds = comp.odds?.[0] || {};
    const moneyline = odds.moneyline || {};
    const total = odds.total || {};

    games.push({
      espnGameId: event.id,
      name: event.name,
      startTime: event.date,
      gameNumber: comp.gameNumber || 1,
      notes: comp.notes?.map(n => n.headline) || [],
      home: {
        team: home.team?.displayName || 'Home',
        abbr: home.team?.abbreviation || '',
        id: home.team?.id || null,
        record: home.records?.[0]?.summary || '',
        logo: home.team?.logo || null,
      },
      away: {
        team: away.team?.displayName || 'Away',
        abbr: away.team?.abbreviation || '',
        id: away.team?.id || null,
        record: away.records?.[0]?.summary || '',
        logo: away.team?.logo || null,
      },
      homePitcher: homeProbable ? {
        name: homeProbable.athlete?.displayName || 'TBD',
        id: homeProbable.athlete?.id || null,
        headshot: homeProbable.athlete?.headshot || null,
        record: homeProbable.record || '',
        stats: (homeProbable.statistics || []).reduce((acc, s) => {
          acc[s.abbreviation || s.name] = s.displayValue;
          return acc;
        }, {}),
      } : { name: 'TBD', id: null, headshot: null, record: '', stats: {} },
      awayPitcher: awayProbable ? {
        name: awayProbable.athlete?.displayName || 'TBD',
        id: awayProbable.athlete?.id || null,
        headshot: awayProbable.athlete?.headshot || null,
        record: awayProbable.record || '',
        stats: (awayProbable.statistics || []).reduce((acc, s) => {
          acc[s.abbreviation || s.name] = s.displayValue;
          return acc;
        }, {}),
      } : { name: 'TBD', id: null, headshot: null, record: '', stats: {} },
      odds: {
        spread: odds.details || 'N/A',
        overUnder: odds.overUnder || null,
        homeML: moneyline.home?.close?.odds || null,
        awayML: moneyline.away?.close?.odds || null,
        overOdds: total.over?.close?.odds || null,
        underOdds: total.under?.close?.odds || null,
      },
    });
  }

  // Sort by start time
  games.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  return games;
}

/**
 * Fetch detailed season stats for a pitcher from ESPN web API.
 * Returns { K9, WHIP, IP, K, BB, KBB, ERA, GS, QS, PperStart, PperInning, GB, FB, GF } or null.
 */
async function fetchPitcherDetailedStats(espnAthleteId) {
  if (!espnAthleteId) return null;
  try {
    const res = await fetch(`https://site.web.api.espn.com/apis/common/v3/sports/baseball/mlb/athletes/${espnAthleteId}/stats`);
    const json = await res.json();
    if (!json.categories) return null;

    const pitching = json.categories.find(c => c.name === 'pitching');
    const expanded = json.categories.find(c => c.name === 'expanded-pitching');
    if (!pitching || !expanded) return null;

    // Current season = last entry
    const pSeason = pitching.statistics[pitching.statistics.length - 1];
    const eSeason = expanded.statistics[expanded.statistics.length - 1];
    if (!pSeason || !eSeason) return null;

    const pIdx = (label) => pitching.labels.indexOf(label);
    const eIdx = (label) => expanded.labels.indexOf(label);

    // Opponent batting for HR allowed
    const oppBatting = json.categories.find(c => c.name === 'opponent-batting');
    const oSeason = oppBatting?.statistics?.[oppBatting.statistics.length - 1];
    const oIdx = (label) => oppBatting ? oppBatting.labels.indexOf(label) : -1;

    const ip = parseFloat(pSeason.stats[pIdx('IP')]) || 0;
    const hrAllowed = oSeason ? parseInt(oSeason.stats[oIdx('HR')]) || 0 : 0;
    const hr9 = ip > 0 ? ((hrAllowed / ip) * 9).toFixed(2) : 'N/A';

    return {
      season: pSeason.season?.year,
      GP: pSeason.stats[pIdx('GP')] || '0',
      GS: pSeason.stats[pIdx('GS')] || '0',
      ERA: pSeason.stats[pIdx('ERA')] || 'N/A',
      WHIP: pSeason.stats[pIdx('WHIP')] || 'N/A',
      IP: pSeason.stats[pIdx('IP')] || '0',
      K: pSeason.stats[pIdx('K')] || '0',
      BB: pSeason.stats[pIdx('BB')] || '0',
      KBB: pSeason.stats[pIdx('K/BB')] || 'N/A',
      K9: eSeason.stats[eIdx('K/9')] || 'N/A',
      QS: eSeason.stats[eIdx('QS')] || '0',
      PperStart: eSeason.stats[eIdx('P/S')] || 'N/A',
      PperInning: eSeason.stats[eIdx('P/I')] || 'N/A',
      GB: eSeason.stats[eIdx('GB')] || '0',
      FB: eSeason.stats[eIdx('FB')] || '0',
      GF: eSeason.stats[eIdx('G/F')] || 'N/A',
      HRAllowed: String(hrAllowed),
      HR9: hr9,
    };
  } catch (e) {
    console.error(`[MLB] Failed to fetch pitcher stats for ${espnAthleteId}:`, e.message);
    return null;
  }
}

/**
 * Fetch team batting stats from ESPN. Returns { SO, AB, PA, AVG, OBP, OPS, BBPA, BBK } or null.
 */
async function fetchTeamBattingStats(espnTeamId) {
  if (!espnTeamId) return null;
  try {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/${espnTeamId}/statistics`);
    const json = await res.json();
    const batting = json.results?.stats?.categories?.find(c => c.name === 'batting');
    if (!batting) return null;

    const get = (abbr) => {
      const stat = batting.stats.find(s => s.abbreviation === abbr);
      return stat ? stat.displayValue : null;
    };

    const so = parseFloat(get('SO')) || 0;
    const pa = parseFloat(get('PA')) || 1;
    const gp = parseFloat(get('GP')) || 1;
    const hr = parseFloat(get('HR')) || 0;

    return {
      SO: get('SO'),
      HR: get('HR'),
      AB: get('AB'),
      PA: get('PA'),
      GP: get('GP'),
      AVG: get('AVG'),
      OBP: get('OBP'),
      SLG: get('SLG'),
      OPS: get('OPS'),
      KRate: ((so / pa) * 100).toFixed(1) + '%',
      KPerGame: (so / gp).toFixed(1),
      HRPerGame: (hr / gp).toFixed(2),
    };
  } catch (e) {
    console.error(`[MLB] Failed to fetch team batting stats for ${espnTeamId}:`, e.message);
    return null;
  }
}

/**
 * Fetch team leaders (HR leader, AVG leader, etc.) from ESPN game summary.
 * Returns { home: { hrLeader, hrCount, avgLeader }, away: { ... } } or null.
 */
async function fetchGameLeaders(espnGameId) {
  try {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${espnGameId}`);
    const json = await res.json();
    if (!json.leaders || !json.header) return null;

    // Determine home/away team IDs from header
    const comp = json.header.competitions?.[0];
    const homeTeamId = comp?.competitors?.find(c => c.homeAway === 'home')?.team?.id;
    const awayTeamId = comp?.competitors?.find(c => c.homeAway === 'away')?.team?.id;

    const result = { home: null, away: null };
    for (const teamLeaders of json.leaders) {
      const teamId = String(teamLeaders.team?.id);
      const side = teamId === String(homeTeamId) ? 'home' : teamId === String(awayTeamId) ? 'away' : null;
      if (!side) continue;

      const leaders = {};
      for (const cat of (teamLeaders.leaders || [])) {
        const top = cat.leaders?.[0];
        if (!top) continue;
        leaders[cat.name || cat.displayName] = {
          player: top.athlete?.displayName || 'Unknown',
          value: top.displayValue || top.value,
        };
      }
      result[side] = {
        team: teamLeaders.team?.displayName,
        hrLeader: leaders.homeRuns?.player || null,
        hrCount: leaders.homeRuns?.value || '0',
        avgLeader: leaders.avg?.player || null,
        avgValue: leaders.avg?.value || null,
        rbiLeader: leaders.RBIs?.player || null,
        rbiCount: leaders.RBIs?.value || '0',
      };
    }
    return result;
  } catch (e) {
    console.error(`[MLB] Failed to fetch game leaders for ${espnGameId}:`, e.message);
    return null;
  }
}

/**
 * Fetch weather for a game from ESPN summary
 */
async function fetchGameWeather(espnGameId) {
  try {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${espnGameId}`);
    const json = await res.json();
    return json.gameInfo?.weather || null;
  } catch (e) {
    return null;
  }
}

// ══════════════════════════════════════════════════
// NRFI Analysis
// ══════════════════════════════════════════════════

async function generateNrfiAnalysis(client, guildId) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  // Already generated today?
  const existing = await mlbDb.hasAnalysisForToday('nrfi', guildId, today);
  if (existing) {
    console.log('[MLB NRFI] Already have analysis for today, checking for unposted...');
    const msg = await mlbDb.getMessage(today, 'nrfi', guildId);
    if (!msg) {
      await postAnalysisToDiscord(client, guildId, 'nrfi', today);
    }
    return;
  }

  const games = await fetchMLBScoreboardRaw();
  if (games.length === 0) {
    console.log('[MLB NRFI] No MLB games today.');
    return;
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    console.error('[MLB NRFI] OPENAI_API_KEY not set');
    return;
  }

  // Fetch weather for first few games (batch limit to avoid rate limits)
  const weatherMap = {};
  for (const game of games.slice(0, 8)) {
    const w = await fetchGameWeather(game.espnGameId);
    if (w) weatherMap[game.espnGameId] = w;
  }

  const record = await mlbDb.getRecord('nrfi', guildId);

  const gamesData = games.map(g => ({
    espnGameId: g.espnGameId,
    matchup: `${g.away.abbr} @ ${g.home.abbr}`,
    awayTeam: g.away.team,
    homeTeam: g.home.team,
    awayRecord: g.away.record,
    homeRecord: g.home.record,
    awayPitcher: g.awayPitcher.name,
    awayPitcherRecord: g.awayPitcher.record,
    awayPitcherERA: g.awayPitcher.stats?.ERA || 'N/A',
    homePitcher: g.homePitcher.name,
    homePitcherRecord: g.homePitcher.record,
    homePitcherERA: g.homePitcher.stats?.ERA || 'N/A',
    overUnder: g.odds.overUnder,
    startTime: g.startTime,
    gameNumber: g.gameNumber,
    weather: weatherMap[g.espnGameId] ? {
      temp: weatherMap[g.espnGameId].temperature,
      condition: weatherMap[g.espnGameId].conditionId,
      wind: weatherMap[g.espnGameId].gust,
    } : null,
  }));

  const prompt = `You are an elite MLB analytics model specializing in NRFI (No Run First Inning) bets. Your current NRFI record is ${record.hits}-${record.misses}.

Analyze EVERY game on today's MLB slate for NRFI probability. For each game, consider:
1. Starting pitcher 1st inning tendencies and overall ERA
2. Starting pitcher K/9 rate and control (walks)
3. Opposing lineup power and recent scoring in 1st innings
4. Ballpark factors (pitcher-friendly vs hitter-friendly)
5. Weather conditions (temp, wind — heat + wind out = more runs)
6. Historical NRFI rates for these pitcher matchups
7. Bullpen usage — are starters likely to be on short leash?
8. Day/night splits

Today's MLB slate:
${JSON.stringify(gamesData, null, 2)}

Return a JSON array with one object per game in this EXACT format:
[
  {
    "espnGameId": "<ESPN game ID>",
    "suggestion": "NRFI" or "YRFI",
    "confidence": <number 50-99>,
    "reasoning": "<1-2 sentence specific analysis for this matchup>",
    "nrfiOdds": "<approximate NRFI odds if known, e.g. '-140', or null if unknown>"
  }
]

Order by confidence (highest first). Return ONLY valid JSON array. No markdown.`;

  try {
    const oaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        max_tokens: 4000,
      }),
    });

    const oaiData = await oaiRes.json();
    if (oaiData.error) {
      console.error('[MLB NRFI] OpenAI error:', oaiData.error);
      return;
    }

    const content = oaiData.choices?.[0]?.message?.content?.trim();
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const analyses = JSON.parse(jsonStr);

    // Build DB entries
    const entries = analyses.map(a => {
      const game = games.find(g => g.espnGameId === a.espnGameId);
      if (!game) return null;
      return {
        guild_id: guildId,
        analysis_date: today,
        market_type: 'nrfi',
        espn_game_id: a.espnGameId,
        home_team: game.home.team,
        home_abbr: game.home.abbr,
        away_team: game.away.team,
        away_abbr: game.away.abbr,
        game_number: game.gameNumber,
        event_start_time: game.startTime,
        home_pitcher: game.homePitcher.name,
        home_pitcher_id: game.homePitcher.id,
        home_pitcher_headshot: game.homePitcher.headshot,
        home_pitcher_stats: game.homePitcher.stats,
        away_pitcher: game.awayPitcher.name,
        away_pitcher_id: game.awayPitcher.id,
        away_pitcher_headshot: game.awayPitcher.headshot,
        away_pitcher_stats: game.awayPitcher.stats,
        suggestion: a.suggestion,
        confidence: a.confidence,
        reasoning: a.reasoning,
        odds: a.nrfiOdds || null,
        temperature: weatherMap[a.espnGameId]?.temperature || null,
        weather_condition: weatherMap[a.espnGameId]?.conditionId || null,
        wind_speed: weatherMap[a.espnGameId]?.gust || null,
      };
    }).filter(Boolean);

    await mlbDb.createAnalysisEntries(entries);
    console.log(`[MLB NRFI] Generated ${entries.length} analyses for ${today}`);

    await postAnalysisToDiscord(client, guildId, 'nrfi', today);
  } catch (err) {
    console.error('[MLB NRFI] Generation error:', err);
  }
}

// ══════════════════════════════════════════════════
// Strikeout O/U Analysis
// ══════════════════════════════════════════════════

async function generateStrikeoutAnalysis(client, guildId) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  const existing = await mlbDb.hasAnalysisForToday('strikeout', guildId, today);
  if (existing) {
    console.log('[MLB K] Already have analysis for today, checking for unposted...');
    const msg = await mlbDb.getMessage(today, 'strikeout', guildId);
    if (!msg) await postAnalysisToDiscord(client, guildId, 'strikeout', today);
    return;
  }

  const games = await fetchMLBScoreboardRaw();
  if (games.length === 0) {
    console.log('[MLB K] No MLB games today.');
    return;
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) return;

  const record = await mlbDb.getRecord('strikeout', guildId);

  // Fetch detailed pitcher stats and team batting stats in parallel
  console.log('[MLB K] Fetching detailed pitcher stats and team batting data...');
  const pitcherStatsCache = {};
  const teamBattingCache = {};

  const pitcherFetches = [];
  const teamFetches = new Set();

  for (const g of games) {
    if (g.homePitcher.id) pitcherFetches.push(fetchPitcherDetailedStats(g.homePitcher.id).then(s => { pitcherStatsCache[g.homePitcher.id] = s; }));
    if (g.awayPitcher.id) pitcherFetches.push(fetchPitcherDetailedStats(g.awayPitcher.id).then(s => { pitcherStatsCache[g.awayPitcher.id] = s; }));
    // Fetch batting stats for each team (pitcher faces opposing team's batters)
    if (g.home.id && !teamFetches.has(g.home.id)) {
      teamFetches.add(g.home.id);
      pitcherFetches.push(fetchTeamBattingStats(g.home.id).then(s => { teamBattingCache[g.home.id] = s; }));
    }
    if (g.away.id && !teamFetches.has(g.away.id)) {
      teamFetches.add(g.away.id);
      pitcherFetches.push(fetchTeamBattingStats(g.away.id).then(s => { teamBattingCache[g.away.id] = s; }));
    }
  }

  await Promise.all(pitcherFetches);
  console.log(`[MLB K] Fetched stats for ${Object.keys(pitcherStatsCache).length} pitchers, ${Object.keys(teamBattingCache).length} teams`);

  // Build data with real K/9, IP, WHIP, and opposing team K-rate
  const gamesData = games.map(g => {
    const hpStats = pitcherStatsCache[g.homePitcher.id];
    const apStats = pitcherStatsCache[g.awayPitcher.id];
    // Away pitcher faces home team's batting; home pitcher faces away team's batting
    const homeTeamBatting = teamBattingCache[g.home.id];
    const awayTeamBatting = teamBattingCache[g.away.id];

    return {
      espnGameId: g.espnGameId,
      matchup: `${g.away.abbr} @ ${g.home.abbr}`,
      awayTeam: g.away.team,
      homeTeam: g.home.team,
      awayPitcher: {
        name: g.awayPitcher.name,
        record: g.awayPitcher.record,
        seasonERA: apStats?.ERA || g.awayPitcher.stats?.ERA || 'N/A',
        seasonK9: apStats?.K9 || 'N/A',
        seasonWHIP: apStats?.WHIP || 'N/A',
        seasonIP: apStats?.IP || 'N/A',
        seasonK: apStats?.K || 'N/A',
        seasonBB: apStats?.BB || 'N/A',
        seasonGS: apStats?.GS || 'N/A',
        avgPitchesPerStart: apStats?.PperStart || 'N/A',
        qualityStarts: apStats?.QS || 'N/A',
      },
      homePitcher: {
        name: g.homePitcher.name,
        record: g.homePitcher.record,
        seasonERA: hpStats?.ERA || g.homePitcher.stats?.ERA || 'N/A',
        seasonK9: hpStats?.K9 || 'N/A',
        seasonWHIP: hpStats?.WHIP || 'N/A',
        seasonIP: hpStats?.IP || 'N/A',
        seasonK: hpStats?.K || 'N/A',
        seasonBB: hpStats?.BB || 'N/A',
        seasonGS: hpStats?.GS || 'N/A',
        avgPitchesPerStart: hpStats?.PperStart || 'N/A',
        qualityStarts: hpStats?.QS || 'N/A',
      },
      homeTeamBatting: homeTeamBatting ? {
        teamKRate: homeTeamBatting.KRate,
        teamKPerGame: homeTeamBatting.KPerGame,
        teamSO: homeTeamBatting.SO,
        teamAVG: homeTeamBatting.AVG,
        teamOPS: homeTeamBatting.OPS,
      } : 'N/A',
      awayTeamBatting: awayTeamBatting ? {
        teamKRate: awayTeamBatting.KRate,
        teamKPerGame: awayTeamBatting.KPerGame,
        teamSO: awayTeamBatting.SO,
        teamAVG: awayTeamBatting.AVG,
        teamOPS: awayTeamBatting.OPS,
      } : 'N/A',
      overUnder: g.odds.overUnder,
      startTime: g.startTime,
      gameNumber: g.gameNumber,
    };
  });

  const prompt = `You are an elite MLB strikeout prop analyst. Your current record is ${record.hits}-${record.misses}.

CRITICAL RULES:
- You MUST produce a MIX of Over AND Under picks. Target roughly 40-60% Unders.
- Do NOT default to Over. Many pitchers have low K/9 or face low-K teams — those are Unders.
- Set your projected K line based on the pitcher's K/9 rate and expected innings:
  • Expected K = (K/9 × expected IP) / 9
  • If a pitcher has 7.0 K/9 and you expect 5.5 IP, projected Ks ≈ 4.3 → line should be ~4.5
  • If a pitcher has 11.0 K/9 and you expect 6.0 IP, projected Ks ≈ 7.3 → line should be ~6.5
- A pitcher with K/9 below 7.5 facing a team with K-rate below 23% is a STRONG Under candidate.
- A pitcher with K/9 above 9.5 facing a team with K-rate above 25% is a STRONG Over candidate.
- A pitcher averaging under 80 pitches/start likely won't last 5+ innings — lean Under.
- Factor in the opposing team's K-rate heavily. High-contact teams (low K%) = fewer Ks for the pitcher.

GUIDELINES FOR SETTING K LINES:
- Lines should be realistic sportsbook-style half numbers (4.5, 5.5, 6.5, 7.5, etc.)
- Average MLB starter: ~5.0-5.5 K per game. Only elite aces consistently hit 7+.
- K/9 is per 9 innings. Most starters go 5-6 IP, so multiply K/9 by ~0.6 for expected Ks.
- Low K/9 (< 7.5) pitcher vs low-K team = line 4.5 or lower, suggest Under
- Moderate K/9 (7.5-9.0) = line 5.5, direction depends on matchup
- High K/9 (> 9.5) vs high-K team = line 6.5+, lean Over
- Factor expected pitch count: low pitches/start = fewer innings = fewer K opportunities

Today's MLB slate with detailed stats:
${JSON.stringify(gamesData, null, 2)}

For each game, analyze BOTH starting pitchers. Return a JSON array with one object per pitcher (two per game):
[
  {
    "espnGameId": "<ESPN game ID>",
    "pitcher": "<pitcher name>",
    "team": "<team abbreviation>",
    "side": "home" or "away",
    "line": <projected K line as X.5 number>,
    "suggestion": "Over" or "Under",
    "confidence": <number 50-99>,
    "reasoning": "<1-2 sentence reasoning citing specific K/9, opposing K-rate, expected IP>",
    "odds": null
  }
]

Order by confidence (highest first). Return ONLY valid JSON array.`;

  try {
    const oaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        max_tokens: 6000,
      }),
    });

    const oaiData = await oaiRes.json();
    if (oaiData.error) {
      console.error('[MLB K] OpenAI error:', oaiData.error);
      return;
    }

    const content = oaiData.choices?.[0]?.message?.content?.trim();
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const analyses = JSON.parse(jsonStr);

    // Build DB entries — one per pitcher (two per game)
    const entries = [];
    for (const a of analyses) {
      const game = games.find(g => g.espnGameId === a.espnGameId);
      if (!game) continue;

      const side = a.side || (a.team === game.home.abbr ? 'home' : 'away');
      const pitcher = side === 'home' ? game.homePitcher : game.awayPitcher;

      entries.push({
        guild_id: guildId,
        analysis_date: today,
        market_type: 'strikeout',
        espn_game_id: `${a.espnGameId}_${side}`,
        home_team: game.home.team,
        home_abbr: game.home.abbr,
        away_team: game.away.team,
        away_abbr: game.away.abbr,
        game_number: game.gameNumber,
        event_start_time: game.startTime,
        home_pitcher: game.homePitcher.name,
        home_pitcher_id: game.homePitcher.id,
        home_pitcher_headshot: game.homePitcher.headshot,
        home_pitcher_stats: game.homePitcher.stats,
        away_pitcher: game.awayPitcher.name,
        away_pitcher_id: game.awayPitcher.id,
        away_pitcher_headshot: game.awayPitcher.headshot,
        away_pitcher_stats: game.awayPitcher.stats,
        suggestion: `${a.pitcher} ${a.suggestion} ${a.line} K`,
        confidence: a.confidence,
        reasoning: a.reasoning,
        odds: a.odds || null,
        line: a.line,
      });
    }

    await mlbDb.createAnalysisEntries(entries);
    console.log(`[MLB K] Generated ${entries.length} analyses for ${today}`);

    await postAnalysisToDiscord(client, guildId, 'strikeout', today);
  } catch (err) {
    console.error('[MLB K] Generation error:', err);
  }
}

// ══════════════════════════════════════════════════
// Home Run Analysis
// ══════════════════════════════════════════════════

async function generateHomerunAnalysis(client, guildId) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  const existing = await mlbDb.hasAnalysisForToday('homerun', guildId, today);
  if (existing) {
    console.log('[MLB HR] Already have analysis for today, checking for unposted...');
    const msg = await mlbDb.getMessage(today, 'homerun', guildId);
    if (!msg) await postAnalysisToDiscord(client, guildId, 'homerun', today);
    return;
  }

  const games = await fetchMLBScoreboardRaw();
  if (games.length === 0) {
    console.log('[MLB HR] No MLB games today.');
    return;
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) return;

  const record = await mlbDb.getRecord('homerun', guildId);

  // Fetch weather, pitcher stats, team batting stats, and game leaders in parallel
  console.log('[MLB HR] Fetching weather, pitcher stats, team batting, and game leaders...');
  const weatherMap = {};
  const pitcherStatsCache = {};
  const teamBattingCache = {};
  const gameLeadersMap = {};

  const fetches = [];

  // Weather for first 8 games
  for (const game of games.slice(0, 8)) {
    fetches.push(fetchGameWeather(game.espnGameId).then(w => { if (w) weatherMap[game.espnGameId] = w; }));
  }

  // Game leaders (HR leaders per team) for all games
  for (const game of games) {
    fetches.push(fetchGameLeaders(game.espnGameId).then(l => { if (l) gameLeadersMap[game.espnGameId] = l; }));
  }

  // Pitcher detailed stats
  const teamFetches = new Set();
  for (const g of games) {
    if (g.homePitcher.id) fetches.push(fetchPitcherDetailedStats(g.homePitcher.id).then(s => { pitcherStatsCache[g.homePitcher.id] = s; }));
    if (g.awayPitcher.id) fetches.push(fetchPitcherDetailedStats(g.awayPitcher.id).then(s => { pitcherStatsCache[g.awayPitcher.id] = s; }));
    if (g.home.id && !teamFetches.has(g.home.id)) {
      teamFetches.add(g.home.id);
      fetches.push(fetchTeamBattingStats(g.home.id).then(s => { teamBattingCache[g.home.id] = s; }));
    }
    if (g.away.id && !teamFetches.has(g.away.id)) {
      teamFetches.add(g.away.id);
      fetches.push(fetchTeamBattingStats(g.away.id).then(s => { teamBattingCache[g.away.id] = s; }));
    }
  }

  await Promise.all(fetches);
  console.log(`[MLB HR] Fetched data: ${Object.keys(gameLeadersMap).length} game leaders, ${Object.keys(pitcherStatsCache).length} pitchers, ${Object.keys(teamBattingCache).length} teams`);

  const gamesData = games.map(g => {
    const hpStats = pitcherStatsCache[g.homePitcher.id];
    const apStats = pitcherStatsCache[g.awayPitcher.id];
    const homeTeamBatting = teamBattingCache[g.home.id];
    const awayTeamBatting = teamBattingCache[g.away.id];
    const leaders = gameLeadersMap[g.espnGameId];

    return {
      espnGameId: g.espnGameId,
      matchup: `${g.away.abbr} @ ${g.home.abbr}`,
      awayTeam: g.away.team,
      homeTeam: g.home.team,
      awayRecord: g.away.record,
      homeRecord: g.home.record,
      awayPitcher: {
        name: g.awayPitcher.name,
        ERA: apStats?.ERA || g.awayPitcher.stats?.ERA || 'N/A',
        HR9: apStats?.HR9 || 'N/A',
        HRAllowed: apStats?.HRAllowed || 'N/A',
        IP: apStats?.IP || 'N/A',
        WHIP: apStats?.WHIP || 'N/A',
        FBRate: apStats?.FB || 'N/A',
        GBtoFB: apStats?.GF || 'N/A',
      },
      homePitcher: {
        name: g.homePitcher.name,
        ERA: hpStats?.ERA || g.homePitcher.stats?.ERA || 'N/A',
        HR9: hpStats?.HR9 || 'N/A',
        HRAllowed: hpStats?.HRAllowed || 'N/A',
        IP: hpStats?.IP || 'N/A',
        WHIP: hpStats?.WHIP || 'N/A',
        FBRate: hpStats?.FB || 'N/A',
        GBtoFB: hpStats?.GF || 'N/A',
      },
      homeTeamBatting: homeTeamBatting ? {
        teamHR: homeTeamBatting.HR,
        teamHRPerGame: homeTeamBatting.HRPerGame,
        teamSLG: homeTeamBatting.SLG,
        teamOPS: homeTeamBatting.OPS,
      } : 'N/A',
      awayTeamBatting: awayTeamBatting ? {
        teamHR: awayTeamBatting.HR,
        teamHRPerGame: awayTeamBatting.HRPerGame,
        teamSLG: awayTeamBatting.SLG,
        teamOPS: awayTeamBatting.OPS,
      } : 'N/A',
      homeHRLeader: leaders?.home ? `${leaders.home.hrLeader} (${leaders.home.hrCount} HR)` : 'N/A',
      awayHRLeader: leaders?.away ? `${leaders.away.hrLeader} (${leaders.away.hrCount} HR)` : 'N/A',
      overUnder: g.odds.overUnder,
      startTime: g.startTime,
      gameNumber: g.gameNumber,
      weather: weatherMap[g.espnGameId] ? {
        temp: weatherMap[g.espnGameId].temperature,
        wind: weatherMap[g.espnGameId].gust,
      } : null,
    };
  });

  const prompt = `You are an elite MLB home run prop analyst. Your current record is ${record.hits}-${record.misses}.

CRITICAL RULES:
- For topHRCandidate, you MUST ONLY use player names from the data provided below (homeHRLeader, awayHRLeader fields). Do NOT use players from your training data — rosters change every season.
- If a leader field says "N/A", use null for topHRCandidate.
- Factor in pitcher HR/9 rate and fly ball tendency heavily. High HR/9 + high fly ball rate = HR-friendly pitcher.
- A pitcher with HR/9 > 1.50 is very HR-prone. HR/9 < 0.80 is HR-resistant.
- Ground ball pitchers (G/F > 1.2) suppress HRs. Fly ball pitchers (G/F < 0.9) allow more HRs.
- Team SLG > .420 and OPS > .750 indicates a power-hitting lineup.
- Weather: games 75°F+ with wind blowing out favor HRs. Dome/cold games suppress them.

Today's MLB slate with real current-season stats:
${JSON.stringify(gamesData, null, 2)}

For each game, analyze HR potential. Return a JSON array:
[
  {
    "espnGameId": "<ESPN game ID>",
    "suggestion": "HR Likely" or "Low HR Game",
    "hrOverUnder": <suggested total HRs line, e.g. 1.5 or 2.5>,
    "overUnderPick": "Over" or "Under",
    "confidence": <number 50-99>,
    "reasoning": "<1-2 sentence analysis citing pitcher HR/9, team HR stats, and ballpark/weather>",
    "topHRCandidate": "<ONLY a player name from the homeHRLeader or awayHRLeader data provided, or null>",
    "topCandidateTeam": "<team abbreviation of top HR candidate>",
    "odds": null
  }
]

Order by confidence (highest first). Return ONLY valid JSON array.`;

  try {
    const oaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        max_tokens: 5000,
      }),
    });

    const oaiData = await oaiRes.json();
    if (oaiData.error) {
      console.error('[MLB HR] OpenAI error:', oaiData.error);
      return;
    }

    const content = oaiData.choices?.[0]?.message?.content?.trim();
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const analyses = JSON.parse(jsonStr);

    const entries = analyses.map(a => {
      const game = games.find(g => g.espnGameId === a.espnGameId);
      if (!game) return null;
      return {
        guild_id: guildId,
        analysis_date: today,
        market_type: 'homerun',
        espn_game_id: a.espnGameId,
        home_team: game.home.team,
        home_abbr: game.home.abbr,
        away_team: game.away.team,
        away_abbr: game.away.abbr,
        game_number: game.gameNumber,
        event_start_time: game.startTime,
        home_pitcher: game.homePitcher.name,
        home_pitcher_id: game.homePitcher.id,
        home_pitcher_headshot: game.homePitcher.headshot,
        home_pitcher_stats: game.homePitcher.stats,
        away_pitcher: game.awayPitcher.name,
        away_pitcher_id: game.awayPitcher.id,
        away_pitcher_headshot: game.awayPitcher.headshot,
        away_pitcher_stats: game.awayPitcher.stats,
        suggestion: a.suggestion,
        confidence: a.confidence,
        reasoning: a.reasoning + (a.topHRCandidate ? ` 🎯 HR Watch: ${a.topHRCandidate} (${a.topCandidateTeam})` : ''),
        odds: a.odds || null,
        line: a.hrOverUnder || null,
        temperature: weatherMap[a.espnGameId]?.temperature || null,
        weather_condition: weatherMap[a.espnGameId]?.conditionId || null,
        wind_speed: weatherMap[a.espnGameId]?.gust || null,
      };
    }).filter(Boolean);

    // Fill in any games GPT missed with a default entry
    const coveredGameIds = new Set(entries.map(e => e.espn_game_id));
    for (const game of games) {
      if (coveredGameIds.has(game.espnGameId)) continue;
      console.log(`[MLB HR] GPT missed game ${game.espnGameId} (${game.away.abbr}@${game.home.abbr}), adding default`);
      entries.push({
        guild_id: guildId,
        analysis_date: today,
        market_type: 'homerun',
        espn_game_id: game.espnGameId,
        home_team: game.home.team,
        home_abbr: game.home.abbr,
        away_team: game.away.team,
        away_abbr: game.away.abbr,
        game_number: game.gameNumber,
        event_start_time: game.startTime,
        home_pitcher: game.homePitcher.name,
        home_pitcher_id: game.homePitcher.id,
        home_pitcher_headshot: game.homePitcher.headshot,
        home_pitcher_stats: game.homePitcher.stats,
        away_pitcher: game.awayPitcher.name,
        away_pitcher_id: game.awayPitcher.id,
        away_pitcher_headshot: game.awayPitcher.headshot,
        away_pitcher_stats: game.awayPitcher.stats,
        suggestion: 'HR Likely',
        confidence: 55,
        reasoning: 'Analysis unavailable — default pick based on league averages.',
        odds: null,
        line: 1.5,
        temperature: weatherMap[game.espnGameId]?.temperature || null,
        weather_condition: weatherMap[game.espnGameId]?.conditionId || null,
        wind_speed: weatherMap[game.espnGameId]?.gust || null,
      });
    }

    await mlbDb.createAnalysisEntries(entries);
    console.log(`[MLB HR] Generated ${entries.length} analyses for ${today}`);

    await postAnalysisToDiscord(client, guildId, 'homerun', today);
  } catch (err) {
    console.error('[MLB HR] Generation error:', err);
  }
}

// ══════════════════════════════════════════════════
// Discord Posting
// ══════════════════════════════════════════════════

async function postAnalysisToDiscord(client, guildId, marketType, date) {
  const { AttachmentBuilder } = require('discord.js');

  try {
    const channelId = MARKET_CHANNELS[marketType];
    const channel = await client.channels.fetch(channelId);
    if (!channel) {
      console.error(`[MLB ${marketType}] Channel not found:`, channelId);
      return;
    }

    const entries = await mlbDb.getAnalysisByDate(date, marketType, guildId);
    if (entries.length === 0) return;

    const record = await mlbDb.getRecord(marketType, guildId);
    const streak = await mlbDb.getStreak(marketType, guildId);

    // Generate card image
    let imgBuffer;
    if (marketType === 'nrfi') {
      imgBuffer = await generateNrfiCardImage(entries, record, streak);
    } else if (marketType === 'strikeout') {
      imgBuffer = await generateStrikeoutCardImage(entries, record, streak);
    } else {
      imgBuffer = await generateHomerunCardImage(entries, record, streak);
    }

    const attachment = new AttachmentBuilder(imgBuffer, { name: `mlb-${marketType}.png` });

    // Role ping — auto-create role if missing
    const guild = client.guilds.cache.get(guildId);
    let rolePing = '';
    const roleNames = { nrfi: 'NRFI Alerts', strikeout: 'Strikeout Alerts', homerun: 'HR Alerts' };
    if (guild) {
      let role = guild.roles.cache.find(r => r.name === roleNames[marketType]);
      if (!role) {
        try {
          role = await guild.roles.create({
            name: roleNames[marketType],
            color: marketType === 'nrfi' ? 0x3fb950 : marketType === 'strikeout' ? 0xf85149 : 0x9b59b6,
            mentionable: true,
            reason: `Auto-created for MLB ${marketType} notifications`,
          });
        } catch (e) {
          console.error(`[MLB ${marketType}] Could not create role:`, e.message);
        }
      }
      if (role) rolePing = `${role} `;
    }

    const nrfiCount = entries.filter(e => e.suggestion === 'NRFI').length;
    const yrfiCount = entries.filter(e => e.suggestion === 'YRFI').length;
    const header = MARKET_HEADERS[marketType];
    let summary = '';
    if (marketType === 'nrfi') {
      summary = `\n📊 ${nrfiCount} NRFI | ${yrfiCount} YRFI | ${entries.length} games`;
    } else if (marketType === 'strikeout') {
      const overCount = entries.filter(e => e.suggestion.includes('Over')).length;
      summary = `\n📊 ${overCount} Overs | ${entries.length - overCount} Unders | ${entries.length} matchups`;
    } else {
      const likelyCount = entries.filter(e => e.suggestion === 'HR Likely').length;
      summary = `\n📊 ${likelyCount} HR Likely | ${entries.length - likelyCount} Low HR | ${entries.length} games`;
    }

    const existingMsg = await mlbDb.getMessage(date, marketType, guildId);
    if (existingMsg) {
      // Update existing message
      try {
        const msg = await channel.messages.fetch(existingMsg.message_id);
        const newAttachment = new AttachmentBuilder(imgBuffer, { name: `mlb-${marketType}.png` });
        await msg.edit({ files: [newAttachment] });
        console.log(`[MLB ${marketType}] Updated existing message`);
        return;
      } catch (e) {
        // Message might be deleted — post new one
      }
    }

    const message = await channel.send({
      content: `${rolePing}${header}${summary}`,
      files: [attachment],
    });

    await mlbDb.saveMessage(guildId, channelId, message.id, date, marketType);
    console.log(`[MLB ${marketType}] Posted analysis to Discord (${entries.length} games)`);
  } catch (err) {
    console.error(`[MLB ${marketType}] Discord post error:`, err);
  }
}

// ══════════════════════════════════════════════════
// Auto-Resolution
// ══════════════════════════════════════════════════

async function autoResolveNrfi(client) {
  const pending = await mlbDb.getPendingAnalysis('nrfi');
  if (pending.length === 0) return;

  for (const entry of pending) {
    try {
      // Fetch the game's current status
      const dateStr = entry.analysis_date.replace(/-/g, '');
      const games = await getTodaysGames('mlb', dateStr);
      const game = games.find(g => g.id === entry.espn_game_id);
      if (!game) continue;

      // Need the game to be at least past the 1st inning or complete
      if (game.state === 'pre') continue;

      // Fetch full game data for linescore + scoring plays
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${entry.espn_game_id}`);
      const json = await res.json();

      // Get 1st inning scores from linescore
      const header = json.header?.competitions?.[0];
      if (!header) continue;

      const homeComp = header.competitors?.find(c => c.homeAway === 'home');
      const awayComp = header.competitors?.find(c => c.homeAway === 'away');

      const homeLinescores = homeComp?.linescores || [];
      const awayLinescores = awayComp?.linescores || [];

      // Need at least 1st inning complete (top and bottom)
      if (awayLinescores.length < 1) continue;

      let awayFirstInning = parseInt(awayLinescores[0]?.displayValue ?? awayLinescores[0]?.value ?? -1);
      let homeFirstInning = parseInt(homeLinescores[0]?.displayValue ?? homeLinescores[0]?.value ?? -1);
      if (isNaN(awayFirstInning)) awayFirstInning = -1;
      if (isNaN(homeFirstInning)) homeFirstInning = -1;

      // Fallback: check scoring plays for 1st inning runs if linescore looks empty
      if (awayFirstInning <= 0 && homeFirstInning <= 0 && (game.period > 1 || game.completed)) {
        const scoringPlays = json.scoringPlays || [];
        let awayR1 = 0, homeR1 = 0;
        for (const play of scoringPlays) {
          const period = play.period?.number || play.period;
          if (period === 1 || period === '1') {
            const homeAwayVal = play.team?.id === homeComp?.id ? 'home' : 'away';
            // Match by team ID
            const playTeamId = play.team?.id || play.team?.$ref?.match(/teams\/(\d+)/)?.[1];
            const homeTeamId = homeComp?.id || homeComp?.team?.id;
            const awayTeamId = awayComp?.id || awayComp?.team?.id;
            if (playTeamId === homeTeamId) homeR1++;
            else if (playTeamId === awayTeamId) awayR1++;
            else awayR1++; // Default: count as away run if ambiguous
          }
        }
        if (awayR1 > 0 || homeR1 > 0) {
          console.log(`[MLB NRFI] Linescore showed 0-0 but scoring plays found ${awayR1}-${homeR1} for ${entry.away_abbr}@${entry.home_abbr}`);
          awayFirstInning = awayR1;
          homeFirstInning = homeR1;
        } else if (awayFirstInning < 0) {
          // Linescore wasn't populated, and no scoring plays in 1st — truly 0-0
          awayFirstInning = 0;
          homeFirstInning = 0;
        }
      }

      // Clamp negatives to 0
      if (awayFirstInning < 0) awayFirstInning = 0;
      if (homeFirstInning < 0) homeFirstInning = 0;

      const bottomFirstComplete = homeLinescores.length >= 1 && (game.period > 1 || game.completed);

      if (awayFirstInning > 0 || homeFirstInning > 0) {
        // Runs scored in 1st inning = YRFI
        const isNrfiPick = entry.suggestion === 'NRFI';
        const status = isNrfiPick ? 'miss' : 'hit';
        const result = `1st Inning: ${awayFirstInning}-${homeFirstInning} (runs scored)`;
        await mlbDb.closeAnalysisEntry(entry.id, status, result);
        console.log(`[MLB NRFI] Resolved ${entry.away_abbr}@${entry.home_abbr}: ${status} (${result})`);
      } else if (bottomFirstComplete) {
        // No runs in 1st inning = NRFI
        const isNrfiPick = entry.suggestion === 'NRFI';
        const status = isNrfiPick ? 'hit' : 'miss';
        await mlbDb.closeAnalysisEntry(entry.id, status, '1st Inning: 0-0 (NRFI)');
        console.log(`[MLB NRFI] Resolved ${entry.away_abbr}@${entry.home_abbr}: ${status} (NRFI)`);
      }
    } catch (err) {
      console.error(`[MLB NRFI] Resolve error for ${entry.id}:`, err.message);
    }
  }

  // Update the card image if any were resolved
  const nrfiDates = [...new Set(pending.map(e => e.analysis_date))];
  for (const d of nrfiDates) await refreshAnalysisCards(client, 'nrfi', d);
}

async function autoResolveStrikeouts(client) {
  const pending = await mlbDb.getPendingAnalysis('strikeout');
  if (pending.length === 0) return;

  for (const entry of pending) {
    try {
      // espn_game_id may have _away or _home suffix for per-pitcher entries
      const realGameId = entry.espn_game_id.replace(/_(away|home)$/, '');
      const dateStr = entry.analysis_date.replace(/-/g, '');
      const games = await getTodaysGames('mlb', dateStr);
      const game = games.find(g => g.id === realGameId);
      if (!game || !game.completed) continue;

      // Fetch box score for pitcher K stats
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${realGameId}`);
      const json = await res.json();

      const boxPlayers = json.boxscore?.players || [];
      let bestPitcherK = null;
      let bestPitcherName = null;

      // The suggestion contains the pitcher name, find their K count
      // Format: "Pitcher Name Over/Under X.5 K"
      const suggestionMatch = entry.suggestion.match(/^(.+?)\s+(Over|Under)\s+([\d.]+)\s+K$/i);
      if (!suggestionMatch) continue;

      const targetPitcher = suggestionMatch[1].trim();
      const direction = suggestionMatch[2].toLowerCase();
      const kLine = parseFloat(suggestionMatch[3]);

      // Find pitcher in box score (ESPN uses statGroup.type, not .name)
      for (const teamStats of boxPlayers) {
        for (const statGroup of (teamStats.statistics || [])) {
          if ((statGroup.type || statGroup.name) !== 'pitching') continue;
          const kIdx = (statGroup.labels || []).findIndex(l => l === 'K');
          if (kIdx === -1) continue;
          for (const athlete of (statGroup.athletes || [])) {
            const name = athlete.athlete?.displayName || '';
            if (name.toLowerCase().includes(targetPitcher.toLowerCase().split(' ').pop()) ||
                targetPitcher.toLowerCase().includes(name.toLowerCase().split(' ').pop())) {
              const kCount = parseInt(athlete.stats?.[kIdx] || 0);
              if (athlete.starter || bestPitcherK === null) {
                bestPitcherK = kCount;
                bestPitcherName = name;
              }
            }
          }
        }
      }

      if (bestPitcherK === null) continue;

      let status;
      if (direction === 'over') {
        status = bestPitcherK > kLine ? 'hit' : bestPitcherK === kLine ? 'push' : 'miss';
      } else {
        status = bestPitcherK < kLine ? 'hit' : bestPitcherK === kLine ? 'push' : 'miss';
      }

      const result = `${bestPitcherName}: ${bestPitcherK} K (${direction} ${kLine}) ${status === 'hit' ? '✅' : status === 'push' ? '🟡' : '❌'}`;
      await mlbDb.closeAnalysisEntry(entry.id, status, result);
      console.log(`[MLB K] Resolved ${entry.away_abbr}@${entry.home_abbr}: ${status} (${result})`);
    } catch (err) {
      console.error(`[MLB K] Resolve error for ${entry.id}:`, err.message);
    }
  }

  const kDates = [...new Set(pending.map(e => e.analysis_date))];
  for (const d of kDates) await refreshAnalysisCards(client, 'strikeout', d);
}

async function autoResolveHomeruns(client) {
  const pending = await mlbDb.getPendingAnalysis('homerun');
  if (pending.length === 0) return;

  for (const entry of pending) {
    try {
      const dateStr = entry.analysis_date.replace(/-/g, '');
      const games = await getTodaysGames('mlb', dateStr);
      const game = games.find(g => g.id === entry.espn_game_id);
      if (!game || !game.completed) continue;

      // Fetch box score for HR data
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${entry.espn_game_id}`);
      const json = await res.json();

      // Count total HRs from box score hitting stats (ESPN uses statGroup.type, not .name)
      let totalHR = 0;
      const hrHitters = [];
      const boxPlayers = json.boxscore?.players || [];
      for (const teamStats of boxPlayers) {
        for (const statGroup of (teamStats.statistics || [])) {
          if ((statGroup.type || statGroup.name) !== 'batting') continue;
          const hrIdx = (statGroup.labels || []).findIndex(l => l === 'HR');
          if (hrIdx === -1) continue;
          for (const athlete of (statGroup.athletes || [])) {
            const hr = parseInt(athlete.stats?.[hrIdx] || 0);
            if (hr > 0) {
              totalHR += hr;
              hrHitters.push(athlete.athlete?.displayName || '?');
            }
          }
        }
      }

      const isHRLikely = entry.suggestion === 'HR Likely';
      const hadHR = totalHR > 0;
      const status = (isHRLikely === hadHR) ? 'hit' : 'miss';
      const hitterStr = hrHitters.length > 0 ? ` (${hrHitters.join(', ')})` : '';
      const result = `${totalHR} HR${totalHR !== 1 ? 's' : ''}${hitterStr} ${status === 'hit' ? '✅' : '❌'}`;

      await mlbDb.closeAnalysisEntry(entry.id, status, result);
      console.log(`[MLB HR] Resolved ${entry.away_abbr}@${entry.home_abbr}: ${status} (${result})`);
    } catch (err) {
      console.error(`[MLB HR] Resolve error for ${entry.id}:`, err.message);
    }
  }

  const hrDates = [...new Set(pending.map(e => e.analysis_date))];
  for (const d of hrDates) await refreshAnalysisCards(client, 'homerun', d);
}

/**
 * Refresh the card image for a market type (re-render with resolved results)
 */
async function refreshAnalysisCards(client, marketType, analysisDate) {
  const today = analysisDate || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) return;

  const msgRecord = await mlbDb.getMessage(today, marketType, guildId);
  if (!msgRecord) return;

  try {
    const channel = await client.channels.fetch(msgRecord.channel_id);
    if (!channel) return;

    const entries = await mlbDb.getAnalysisByDate(today, marketType, guildId);
    if (entries.length === 0) return;

    const record = await mlbDb.getRecord(marketType, guildId);
    const streak = await mlbDb.getStreak(marketType, guildId);

    let imgBuffer;
    if (marketType === 'nrfi') {
      imgBuffer = await generateNrfiCardImage(entries, record, streak);
    } else if (marketType === 'strikeout') {
      imgBuffer = await generateStrikeoutCardImage(entries, record, streak);
    } else {
      imgBuffer = await generateHomerunCardImage(entries, record, streak);
    }

    const { AttachmentBuilder } = require('discord.js');
    const attachment = new AttachmentBuilder(imgBuffer, { name: `mlb-${marketType}.png` });

    const msg = await channel.messages.fetch(msgRecord.message_id);
    await msg.edit({ files: [attachment] });
  } catch (e) {
    console.error(`[MLB ${marketType}] Card refresh error:`, e.message);
  }
}

/**
 * Run all three daily analyses
 */
async function generateAllDailyAnalysis(client, guildId) {
  console.log('[MLB] Starting daily MLB analysis...');
  await generateNrfiAnalysis(client, guildId);
  // Stagger to avoid rate limits
  await new Promise(r => setTimeout(r, 5000));
  await generateStrikeoutAnalysis(client, guildId);
  await new Promise(r => setTimeout(r, 5000));
  await generateHomerunAnalysis(client, guildId);
  console.log('[MLB] Daily MLB analysis complete.');
}

/**
 * Run all three auto-resolvers
 */
async function autoResolveAll(client) {
  await autoResolveNrfi(client);
  await autoResolveStrikeouts(client);
  await autoResolveHomeruns(client);
}

/**
 * Delete today's analysis for a market type and regenerate it.
 */
async function regenerateMarket(client, guildId, marketType) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  console.log(`[MLB] Regenerating ${marketType} for ${today}...`);
  await mlbDb.deleteAnalysisForToday(marketType, guildId, today);
  if (marketType === 'nrfi') await generateNrfiAnalysis(client, guildId);
  else if (marketType === 'strikeout') await generateStrikeoutAnalysis(client, guildId);
  else if (marketType === 'homerun') await generateHomerunAnalysis(client, guildId);
  console.log(`[MLB] ${marketType} regeneration complete.`);
}

module.exports = {
  NRFI_CHANNEL_ID,
  STRIKEOUT_CHANNEL_ID,
  HOMERUN_CHANNEL_ID,
  generateNrfiAnalysis,
  generateStrikeoutAnalysis,
  generateHomerunAnalysis,
  generateAllDailyAnalysis,
  autoResolveAll,
  autoResolveNrfi,
  autoResolveStrikeouts,
  autoResolveHomeruns,
  refreshAnalysisCards,
  regenerateMarket,
};
