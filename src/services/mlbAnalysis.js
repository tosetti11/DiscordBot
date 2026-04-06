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
    if (status !== 'pre') continue;

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
        record: home.records?.[0]?.summary || '',
        logo: home.team?.logo || null,
      },
      away: {
        team: away.team?.displayName || 'Away',
        abbr: away.team?.abbreviation || '',
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

  // Build data emphasizing pitcher strikeout profiles
  const gamesData = games.map(g => ({
    espnGameId: g.espnGameId,
    matchup: `${g.away.abbr} @ ${g.home.abbr}`,
    awayTeam: g.away.team,
    homeTeam: g.home.team,
    awayPitcher: g.awayPitcher.name,
    awayPitcherRecord: g.awayPitcher.record,
    awayPitcherERA: g.awayPitcher.stats?.ERA || 'N/A',
    homePitcher: g.homePitcher.name,
    homePitcherRecord: g.homePitcher.record,
    homePitcherERA: g.homePitcher.stats?.ERA || 'N/A',
    overUnder: g.odds.overUnder,
    startTime: g.startTime,
    gameNumber: g.gameNumber,
  }));

  const prompt = `You are an elite MLB analytics model specializing in starting pitcher strikeout over/under markets. Your current record is ${record.hits}-${record.misses}.

Analyze the starting pitchers in EVERY game on today's MLB slate for strikeout over/under bets. For EACH starting pitcher (both home and away), consider:
1. Career K/9 rate and recent K/9 trends
2. Opposing lineup strikeout rate (high-K lineup = more K's for pitcher)
3. Pitcher's average innings pitched (more IP = more K opportunity)
4. Day/night splits for K rate
5. Ballpark effects on strikeouts
6. Recent form (last 3-5 starts K totals)
7. Pitch mix and dominant pitch effectiveness
8. Umpire tendencies (expanded/tight zone)

Today's MLB slate:
${JSON.stringify(gamesData, null, 2)}

For each game, analyze BOTH starting pitchers. Return a JSON array with one object per pitcher (two per game):
[
  {
    "espnGameId": "<ESPN game ID>",
    "pitcher": "<pitcher name>",
    "team": "<team abbreviation>",
    "side": "home" or "away",
    "line": <projected K line, e.g. 5.5>,
    "suggestion": "Over" or "Under",
    "confidence": <number 50-99>,
    "reasoning": "<1-2 sentence specific analysis>",
    "odds": "<approximate odds if known, e.g. '-120', or null>"
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

    // Build DB entries — one per pitcher (we use espnGameId + pitcher side as unique key via market_type)
    // Actually, we'll store both pitchers in each game row as a combined analysis
    // Group by espnGameId
    const byGame = {};
    for (const a of analyses) {
      if (!byGame[a.espnGameId]) byGame[a.espnGameId] = [];
      byGame[a.espnGameId].push(a);
    }

    const entries = [];
    for (const [gameId, pitchers] of Object.entries(byGame)) {
      const game = games.find(g => g.espnGameId === gameId);
      if (!game) continue;

      // Store the best suggestion per game (highest confidence)
      const bestPick = pitchers.sort((a, b) => b.confidence - a.confidence)[0];
      const allPitcherData = pitchers.map(p => ({
        pitcher: p.pitcher,
        team: p.team,
        side: p.side,
        line: p.line,
        suggestion: p.suggestion,
        confidence: p.confidence,
        reasoning: p.reasoning,
        odds: p.odds,
      }));

      entries.push({
        guild_id: guildId,
        analysis_date: today,
        market_type: 'strikeout',
        espn_game_id: gameId,
        home_team: game.home.team,
        home_abbr: game.home.abbr,
        away_team: game.away.team,
        away_abbr: game.away.abbr,
        game_number: game.gameNumber,
        event_start_time: game.startTime,
        home_pitcher: game.homePitcher.name,
        home_pitcher_id: game.homePitcher.id,
        home_pitcher_headshot: game.homePitcher.headshot,
        home_pitcher_stats: { ...game.homePitcher.stats, analysis: allPitcherData.find(p => p.side === 'home') },
        away_pitcher: game.awayPitcher.name,
        away_pitcher_id: game.awayPitcher.id,
        away_pitcher_headshot: game.awayPitcher.headshot,
        away_pitcher_stats: { ...game.awayPitcher.stats, analysis: allPitcherData.find(p => p.side === 'away') },
        suggestion: `${bestPick.pitcher} ${bestPick.suggestion} ${bestPick.line} K`,
        confidence: bestPick.confidence,
        reasoning: bestPick.reasoning,
        odds: bestPick.odds || null,
        line: bestPick.line,
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

  const weatherMap = {};
  for (const game of games.slice(0, 8)) {
    const w = await fetchGameWeather(game.espnGameId);
    if (w) weatherMap[game.espnGameId] = w;
  }

  const gamesData = games.map(g => ({
    espnGameId: g.espnGameId,
    matchup: `${g.away.abbr} @ ${g.home.abbr}`,
    awayTeam: g.away.team,
    homeTeam: g.home.team,
    awayRecord: g.away.record,
    homeRecord: g.home.record,
    awayPitcher: g.awayPitcher.name,
    awayPitcherERA: g.awayPitcher.stats?.ERA || 'N/A',
    homePitcher: g.homePitcher.name,
    homePitcherERA: g.homePitcher.stats?.ERA || 'N/A',
    overUnder: g.odds.overUnder,
    startTime: g.startTime,
    gameNumber: g.gameNumber,
    weather: weatherMap[g.espnGameId] ? {
      temp: weatherMap[g.espnGameId].temperature,
      wind: weatherMap[g.espnGameId].gust,
    } : null,
  }));

  const prompt = `You are an elite MLB analytics model specializing in home run markets. Your current record is ${record.hits}-${record.misses}.

Analyze EVERY game on today's MLB slate for home run potential. For each game, consider:
1. Starting pitcher HR/9 rate and fly ball tendency
2. Opposing lineup HR power (team HR stats, individual sluggers)
3. Ballpark HR factors (park dimensions, altitude — e.g. Coors Field is elite for HRs)
4. Weather: temperature (heat = ball carries further), wind direction/speed (wind blowing out = more HRs)
5. Pitcher handedness vs lineup handedness splits
6. Recent HR trends for both teams
7. Game total (high O/U correlates with HR likelihood)
8. Bullpen HR tendencies for later innings

Today's MLB slate:
${JSON.stringify(gamesData, null, 2)}

For each game, suggest whether the game is likely to see home runs. Return a JSON array:
[
  {
    "espnGameId": "<ESPN game ID>",
    "suggestion": "HR Likely" or "Low HR Game",
    "hrOverUnder": <suggested total HRs line, e.g. 1.5 or 2.5>,
    "overUnderPick": "Over" or "Under",
    "confidence": <number 50-99>,
    "reasoning": "<1-2 sentence specific analysis focusing on HR factors>",
    "topHRCandidate": "<name of batter most likely to homer, or null>",
    "topCandidateTeam": "<team abbreviation of top HR candidate>",
    "odds": "<approximate HR O/U odds if known, or null>"
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

      // Fetch full game data for linescore
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

      const awayFirstInning = parseInt(awayLinescores[0]?.value || 0);
      const homeFirstInning = parseInt(homeLinescores[0]?.value || 0);

      // If away team scored in top of 1st, YRFI immediately
      // If we have bottom of 1st too, we can fully resolve
      const topFirstComplete = awayLinescores.length >= 1;
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
  await refreshAnalysisCards(client, 'nrfi');
}

async function autoResolveStrikeouts(client) {
  const pending = await mlbDb.getPendingAnalysis('strikeout');
  if (pending.length === 0) return;

  for (const entry of pending) {
    try {
      const dateStr = entry.analysis_date.replace(/-/g, '');
      const games = await getTodaysGames('mlb', dateStr);
      const game = games.find(g => g.id === entry.espn_game_id);
      if (!game || !game.completed) continue;

      // Fetch box score for pitcher K stats
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${entry.espn_game_id}`);
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

      // Find pitcher in box score
      for (const teamStats of boxPlayers) {
        for (const statGroup of (teamStats.statistics || [])) {
          if (statGroup.name !== 'pitching') continue;
          const kIdx = (statGroup.labels || []).findIndex(l => l === 'K');
          for (const athlete of (statGroup.athletes || [])) {
            const name = athlete.athlete?.displayName || '';
            if (name.toLowerCase().includes(targetPitcher.toLowerCase().split(' ').pop()) ||
                targetPitcher.toLowerCase().includes(name.toLowerCase().split(' ').pop())) {
              // Check if this is the starting pitcher (usually first listed)
              const kCount = parseInt(athlete.stats?.[kIdx] || 0);
              if (athlete.starter || !bestPitcherK) {
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

      const result = `${bestPitcherName}: ${bestPitcherK} K (${direction} ${kLine})`;
      await mlbDb.closeAnalysisEntry(entry.id, status, result);
      console.log(`[MLB K] Resolved ${entry.away_abbr}@${entry.home_abbr}: ${status} (${result})`);
    } catch (err) {
      console.error(`[MLB K] Resolve error for ${entry.id}:`, err.message);
    }
  }

  await refreshAnalysisCards(client, 'strikeout');
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

      // Count total HRs from box score hitting stats
      let totalHR = 0;
      const boxPlayers = json.boxscore?.players || [];
      for (const teamStats of boxPlayers) {
        for (const statGroup of (teamStats.statistics || [])) {
          if (statGroup.name !== 'batting') continue;
          const hrIdx = (statGroup.labels || []).findIndex(l => l === 'HR');
          if (hrIdx === -1) continue;
          for (const athlete of (statGroup.athletes || [])) {
            totalHR += parseInt(athlete.stats?.[hrIdx] || 0);
          }
        }
      }

      const isHRLikely = entry.suggestion === 'HR Likely';
      const hadHR = totalHR > 0;
      const status = (isHRLikely === hadHR) ? 'hit' : 'miss';
      const result = `${totalHR} HR${totalHR !== 1 ? 's' : ''} in game (${game.away.abbreviation} ${game.away.score} - ${game.home.abbreviation} ${game.home.score})`;

      await mlbDb.closeAnalysisEntry(entry.id, status, result);
      console.log(`[MLB HR] Resolved ${entry.away_abbr}@${entry.home_abbr}: ${status} (${result})`);
    } catch (err) {
      console.error(`[MLB HR] Resolve error for ${entry.id}:`, err.message);
    }
  }

  await refreshAnalysisCards(client, 'homerun');
}

/**
 * Refresh the card image for a market type (re-render with resolved results)
 */
async function refreshAnalysisCards(client, marketType) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
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
};
