/**
 * MLB Daily Market Analysis Service
 * Generates daily NRFI, Strikeout O/U, and Home Run analyses
 * for every MLB game using ESPN data + GPT-4o.
 */
const { getTodaysGames, getGameSummary } = require('./espn');
const mlbDb = require('../database/mlbAnalysis');
const { generateNrfiCardImage, generateF5CardImage, generateTeamTotalCardImage } = require('../utils/mlbAnalysisCardImage');

// Channel IDs
const NRFI_CHANNEL_ID = '1490775859664257157';
const F5ML_CHANNEL_ID = '1497124815885176903';
const TEAMTOTAL_CHANNEL_ID = '1497125090582859806';

const MARKET_CHANNELS = {
  nrfi: NRFI_CHANNEL_ID,
  f5ml: F5ML_CHANNEL_ID,
  teamtotal: TEAMTOTAL_CHANNEL_ID,
};

const MARKET_HEADERS = {
  nrfi: '⚾ **MLB NRFI DAILY ANALYSIS** ⚾',
  f5ml: '5️⃣ **MLB FIRST 5 INNINGS ML** 5️⃣',
  teamtotal: '📊 **MLB TEAM TOTALS DAILY** 📊',
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
    } else if (marketType === 'f5ml') {
      imgBuffer = await generateF5CardImage(entries, record, streak);
    } else {
      imgBuffer = await generateTeamTotalCardImage(entries, record, streak);
    }

    const attachment = new AttachmentBuilder(imgBuffer, { name: `mlb-${marketType}.png` });

    // Role ping — auto-create role if missing
    const guild = client.guilds.cache.get(guildId);
    let rolePing = '';
    const roleNames = { nrfi: 'NRFI Alerts', f5ml: 'F5 Alerts', teamtotal: 'Team Total Alerts' };
    if (guild) {
      let role = guild.roles.cache.find(r => r.name === roleNames[marketType]);
      if (!role) {
        try {
          role = await guild.roles.create({
            name: roleNames[marketType],
            color: marketType === 'nrfi' ? 0x3fb950 : marketType === 'f5ml' ? 0x58a6ff : 0xf0a500,
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
    } else if (marketType === 'f5ml') {
      summary = `\n📊 ${entries.length} F5 ML picks | Starter-driven edges`;
    } else {
      const overCount = entries.filter(e => e.suggestion.includes('Over')).length;
      summary = `\n📊 ${overCount} Overs | ${entries.length - overCount} Unders | ${entries.length} team totals`;
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
// First 5 Innings Moneyline Analysis
// ══════════════════════════════════════════════════

async function generateF5Analysis(client, guildId) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  const existing = await mlbDb.hasAnalysisForToday('f5ml', guildId, today);
  if (existing) {
    console.log('[MLB F5] Already have analysis for today, checking for unposted...');
    const msg = await mlbDb.getMessage(today, 'f5ml', guildId);
    if (!msg) await postAnalysisToDiscord(client, guildId, 'f5ml', today);
    return;
  }

  const games = await fetchMLBScoreboardRaw();
  if (games.length === 0) { console.log('[MLB F5] No MLB games today.'); return; }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) return;

  const record = await mlbDb.getRecord('f5ml', guildId);

  console.log('[MLB F5] Fetching pitcher stats...');
  const pitcherStatsCache = {};
  const fetches = [];
  for (const g of games) {
    if (g.homePitcher.id) fetches.push(fetchPitcherDetailedStats(g.homePitcher.id).then(s => { pitcherStatsCache[g.homePitcher.id] = s; }));
    if (g.awayPitcher.id) fetches.push(fetchPitcherDetailedStats(g.awayPitcher.id).then(s => { pitcherStatsCache[g.awayPitcher.id] = s; }));
  }
  await Promise.all(fetches);

  const gamesData = games.map(g => {
    const hpStats = pitcherStatsCache[g.homePitcher.id];
    const apStats = pitcherStatsCache[g.awayPitcher.id];
    return {
      espnGameId: g.espnGameId,
      matchup: `${g.away.abbr} @ ${g.home.abbr}`,
      awayTeam: g.away.team, homeTeam: g.home.team,
      awayRecord: g.away.record, homeRecord: g.home.record,
      awayPitcher: {
        name: g.awayPitcher.name, record: g.awayPitcher.record,
        ERA: apStats?.ERA || g.awayPitcher.stats?.ERA || 'N/A',
        WHIP: apStats?.WHIP || 'N/A', IP: apStats?.IP || 'N/A',
        QS: apStats?.QS || 'N/A', K9: apStats?.K9 || 'N/A',
        PperStart: apStats?.PperStart || 'N/A',
      },
      homePitcher: {
        name: g.homePitcher.name, record: g.homePitcher.record,
        ERA: hpStats?.ERA || g.homePitcher.stats?.ERA || 'N/A',
        WHIP: hpStats?.WHIP || 'N/A', IP: hpStats?.IP || 'N/A',
        QS: hpStats?.QS || 'N/A', K9: hpStats?.K9 || 'N/A',
        PperStart: hpStats?.PperStart || 'N/A',
      },
      odds: { homeML: g.odds.homeML, awayML: g.odds.awayML, overUnder: g.odds.overUnder, spread: g.odds.spread },
      startTime: g.startTime, gameNumber: g.gameNumber,
    };
  });

  const prompt = `You are an elite MLB First 5 Innings (F5) moneyline analyst. Your current F5 record is ${record.hits}-${record.misses}.

The F5 moneyline bet ends after 5 full innings. Pick the team that will be LEADING after 5 innings. Key factors:
1. Starting pitcher quality is EVERYTHING — ERA, WHIP, IP (innings pitched), quality starts.
2. A starter averaging < 80 pitches/start may not reach inning 5 — HIGH RISK.
3. Bullpen is irrelevant — this is 100% about the starter.
4. Large moneyline favorites (< -150) usually have the dominant starter — lean with them.
5. Look for VALUE: a team at +120 F5 whose starter is equal or better than the opponent.
6. Skip games where both starters are TBD.

Today's MLB slate:
${JSON.stringify(gamesData, null, 2)}

For each game, pick the F5 ML winner. Return a JSON array:
[
  {
    "espnGameId": "<ESPN game ID>",
    "pick": "home" or "away",
    "pickTeam": "<team abbreviation>",
    "pickedOdds": <moneyline number e.g. -140 or 110>,
    "confidence": <number 55-95>,
    "reasoning": "<1-2 sentences citing starter ERA, WHIP, matchup edge>"
  }
]

Skip games where BOTH starters are TBD. Order by confidence (highest first). Return ONLY valid JSON array.`;

  try {
    const oaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: prompt }], temperature: 0.4, max_tokens: 5000 }),
    });
    const oaiData = await oaiRes.json();
    if (oaiData.error) { console.error('[MLB F5] OpenAI error:', oaiData.error); return; }

    const content = oaiData.choices?.[0]?.message?.content?.trim();
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').replace(/:\s*\+(\d)/g, ': $1').trim();
    const analyses = JSON.parse(jsonStr);

    const entries = analyses.map(a => {
      const game = games.find(g => g.espnGameId === a.espnGameId);
      if (!game) return null;
      const oddsStr = a.pickedOdds != null ? (a.pickedOdds > 0 ? `+${a.pickedOdds}` : String(a.pickedOdds)) : null;
      return {
        guild_id: guildId,
        analysis_date: today,
        market_type: 'f5ml',
        espn_game_id: a.espnGameId,
        home_team: game.home.team, home_abbr: game.home.abbr,
        away_team: game.away.team, away_abbr: game.away.abbr,
        game_number: game.gameNumber, event_start_time: game.startTime,
        home_pitcher: game.homePitcher.name, home_pitcher_id: game.homePitcher.id,
        home_pitcher_headshot: game.homePitcher.headshot, home_pitcher_stats: game.homePitcher.stats,
        away_pitcher: game.awayPitcher.name, away_pitcher_id: game.awayPitcher.id,
        away_pitcher_headshot: game.awayPitcher.headshot, away_pitcher_stats: game.awayPitcher.stats,
        suggestion: `${a.pickTeam} F5 ML${oddsStr ? ' ' + oddsStr : ''}`,
        confidence: a.confidence,
        reasoning: a.reasoning,
        odds: oddsStr,
        line: a.pick, // 'home' or 'away' — used for resolution
      };
    }).filter(Boolean);

    await mlbDb.createAnalysisEntries(entries);
    console.log(`[MLB F5] Generated ${entries.length} analyses for ${today}`);
    await postAnalysisToDiscord(client, guildId, 'f5ml', today);
  } catch (err) {
    console.error('[MLB F5] Generation error:', err);
  }
}

// ══════════════════════════════════════════════════
// Team Totals Analysis
// ══════════════════════════════════════════════════

async function generateTeamTotalAnalysis(client, guildId) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  const existing = await mlbDb.hasAnalysisForToday('teamtotal', guildId, today);
  if (existing) {
    console.log('[MLB TT] Already have analysis for today, checking for unposted...');
    const msg = await mlbDb.getMessage(today, 'teamtotal', guildId);
    if (!msg) await postAnalysisToDiscord(client, guildId, 'teamtotal', today);
    return;
  }

  const games = await fetchMLBScoreboardRaw();
  if (games.length === 0) { console.log('[MLB TT] No MLB games today.'); return; }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) return;

  const record = await mlbDb.getRecord('teamtotal', guildId);

  console.log('[MLB TT] Fetching pitcher + batting stats...');
  const pitcherStatsCache = {};
  const teamBattingCache = {};
  const fetches = [];
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

  const gamesData = games.map(g => {
    const hpStats = pitcherStatsCache[g.homePitcher.id];
    const apStats = pitcherStatsCache[g.awayPitcher.id];
    const homeBatting = teamBattingCache[g.home.id];
    const awayBatting = teamBattingCache[g.away.id];
    return {
      espnGameId: g.espnGameId,
      matchup: `${g.away.abbr} @ ${g.home.abbr}`,
      awayTeam: { abbr: g.away.abbr, team: g.away.team, record: g.away.record },
      homeTeam: { abbr: g.home.abbr, team: g.home.team, record: g.home.record },
      // Away team bats against home pitcher; home team bats against away pitcher
      awayVsPitcher: { name: g.homePitcher.name, ERA: hpStats?.ERA || 'N/A', WHIP: hpStats?.WHIP || 'N/A', IP: hpStats?.IP || 'N/A' },
      homeVsPitcher: { name: g.awayPitcher.name, ERA: apStats?.ERA || 'N/A', WHIP: apStats?.WHIP || 'N/A', IP: apStats?.IP || 'N/A' },
      awayBatting: awayBatting ? { AVG: awayBatting.AVG, OBP: awayBatting.OBP, OPS: awayBatting.OPS, KRate: awayBatting.KRate } : null,
      homeBatting: homeBatting ? { AVG: homeBatting.AVG, OBP: homeBatting.OBP, OPS: homeBatting.OPS, KRate: homeBatting.KRate } : null,
      gameTotal: g.odds.overUnder,
      startTime: g.startTime, gameNumber: g.gameNumber,
    };
  });

  const prompt = `You are an elite MLB team total analyst. Your record is ${record.hits}-${record.misses}.

A team total bet is Over/Under on ONE team's full-game run total. Key factors:
1. The OPPOSING pitcher's ERA/WHIP is the #1 factor — team total is a bet against that pitcher.
2. Team batting OPS and AVG: high-OPS offenses vs weak pitchers = Over.
3. Over is attractive: opposing pitcher ERA > 4.50 + team OPS > .750.
4. Under is attractive: opposing pitcher ERA < 3.00 + team K-rate > 24%.
5. Typical lines: 3.5 to 5.5 runs. Use half-number lines.
6. Pick ONE team per game (the clearest edge side). Do NOT pick both teams from the same game.

Today's slate:
${JSON.stringify(gamesData, null, 2)}

Return a JSON array — one pick per game:
[
  {
    "espnGameId": "<ESPN game ID>",
    "team": "home" or "away",
    "teamAbbr": "<team abbreviation>",
    "line": <half-number e.g. 4.5>,
    "suggestion": "Over" or "Under",
    "confidence": <number 55-95>,
    "reasoning": "<1-2 sentences citing opposing pitcher ERA/WHIP and team batting>"
  }
]

Order by confidence (highest first). Return ONLY valid JSON array.`;

  try {
    const oaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: prompt }], temperature: 0.4, max_tokens: 5000 }),
    });
    const oaiData = await oaiRes.json();
    if (oaiData.error) { console.error('[MLB TT] OpenAI error:', oaiData.error); return; }

    const content = oaiData.choices?.[0]?.message?.content?.trim();
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const analyses = JSON.parse(jsonStr);

    const entries = analyses.map(a => {
      const game = games.find(g => g.espnGameId === a.espnGameId);
      if (!game) return null;
      return {
        guild_id: guildId,
        analysis_date: today,
        market_type: 'teamtotal',
        espn_game_id: `${a.espnGameId}_${a.team}`,
        home_team: game.home.team, home_abbr: game.home.abbr,
        away_team: game.away.team, away_abbr: game.away.abbr,
        game_number: game.gameNumber, event_start_time: game.startTime,
        home_pitcher: game.homePitcher.name, home_pitcher_id: game.homePitcher.id,
        home_pitcher_headshot: game.homePitcher.headshot, home_pitcher_stats: game.homePitcher.stats,
        away_pitcher: game.awayPitcher.name, away_pitcher_id: game.awayPitcher.id,
        away_pitcher_headshot: game.awayPitcher.headshot, away_pitcher_stats: game.awayPitcher.stats,
        suggestion: `${a.teamAbbr} ${a.suggestion} ${a.line}`,
        confidence: a.confidence,
        reasoning: a.reasoning,
        odds: null,
        line: a.line,
      };
    }).filter(Boolean);

    await mlbDb.createAnalysisEntries(entries);
    console.log(`[MLB TT] Generated ${entries.length} analyses for ${today}`);
    await postAnalysisToDiscord(client, guildId, 'teamtotal', today);
  } catch (err) {
    console.error('[MLB TT] Generation error:', err);
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

async function autoResolveF5(client) {
  const pending = await mlbDb.getPendingAnalysis('f5ml');
  if (pending.length === 0) return;

  for (const entry of pending) {
    try {
      const realGameId = entry.espn_game_id; // no suffix for F5
      const dateStr = entry.analysis_date.replace(/-/g, '');
      const games = await getTodaysGames('mlb', dateStr);
      const game = games.find(g => g.id === realGameId);
      // Only resolve when inning 5 has been completed (period >= 5) or game is over
      if (!game || (!game.completed && (game.period || 0) < 5)) continue;

      // Fetch linescore for inning-by-inning runs
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${realGameId}`);
      const json = await res.json();

      const linescore = json.header?.competitions?.[0]?.competitors;
      if (!linescore || linescore.length < 2) continue;

      // ESPN returns competitors array: [home, away] (homeAtIndex depends on homeAway field)
      const homeComp = linescore.find(c => c.homeAway === 'home');
      const awayComp = linescore.find(c => c.homeAway === 'away');
      if (!homeComp || !awayComp) continue;

      // Sum innings 1-5 from linescores
      const homeInnings = homeComp.linescores || [];
      const awayInnings = awayComp.linescores || [];
      const sumFirst5 = arr => arr.slice(0, 5).reduce((sum, inn) => sum + (inn.value || 0), 0);

      if (homeInnings.length < 5 && !game.completed) continue; // haven't played 5 yet

      const homeF5Runs = sumFirst5(homeInnings);
      const awayF5Runs = sumFirst5(awayInnings);

      const pickedSide = entry.line; // 'home' or 'away'
      let status;
      if (pickedSide === 'home') {
        status = homeF5Runs > awayF5Runs ? 'hit' : homeF5Runs < awayF5Runs ? 'miss' : 'push';
      } else {
        status = awayF5Runs > homeF5Runs ? 'hit' : awayF5Runs < homeF5Runs ? 'miss' : 'push';
      }

      const icon = status === 'hit' ? '✅' : status === 'push' ? '🟡' : '❌';
      const result = `F5: ${entry.away_abbr} ${awayF5Runs} - ${homeF5Runs} ${entry.home_abbr} ${icon}`;
      await mlbDb.closeAnalysisEntry(entry.id, status, result);
      console.log(`[MLB F5] Resolved ${entry.away_abbr}@${entry.home_abbr}: ${status} (${result})`);
    } catch (err) {
      console.error(`[MLB F5] Resolve error for ${entry.id}:`, err.message);
    }
  }

  const f5Dates = [...new Set(pending.map(e => e.analysis_date))];
  for (const d of f5Dates) await refreshAnalysisCards(client, 'f5ml', d);
}

async function autoResolveTeamTotals(client) {
  const pending = await mlbDb.getPendingAnalysis('teamtotal');
  if (pending.length === 0) return;

  for (const entry of pending) {
    try {
      const side = entry.espn_game_id.endsWith('_home') ? 'home' : 'away';
      const realGameId = entry.espn_game_id.replace(/_(home|away)$/, '');
      const dateStr = entry.analysis_date.replace(/-/g, '');
      const games = await getTodaysGames('mlb', dateStr);
      const game = games.find(g => g.id === realGameId);
      if (!game || !game.completed) continue;

      // Parse direction and line from suggestion: e.g. "NYY Over 4.5"
      const suggMatch = entry.suggestion.match(/\b(Over|Under)\s+([\d.]+)/i);
      if (!suggMatch) continue;
      const direction = suggMatch[1].toLowerCase(); // 'over' or 'under'
      const line = entry.line != null ? parseFloat(entry.line) : parseFloat(suggMatch[2]);

      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${realGameId}`);
      const json = await res.json();

      const competitors = json.header?.competitions?.[0]?.competitors;
      if (!competitors || competitors.length < 2) continue;

      const comp = competitors.find(c => c.homeAway === side);
      if (!comp) continue;

      const teamRuns = parseInt(comp.score || 0);
      let status;
      if (direction === 'over') {
        status = teamRuns > line ? 'hit' : teamRuns < line ? 'miss' : 'push';
      } else {
        status = teamRuns < line ? 'hit' : teamRuns > line ? 'miss' : 'push';
      }

      const teamAbbr = side === 'home' ? entry.home_abbr : entry.away_abbr;
      const icon = status === 'hit' ? '✅' : status === 'push' ? '🟡' : '❌';
      const result = `${teamAbbr}: ${teamRuns} runs (${direction} ${line}) ${icon}`;
      await mlbDb.closeAnalysisEntry(entry.id, status, result);
      console.log(`[MLB TT] Resolved ${entry.away_abbr}@${entry.home_abbr} ${teamAbbr}: ${status} (${result})`);
    } catch (err) {
      console.error(`[MLB TT] Resolve error for ${entry.id}:`, err.message);
    }
  }

  const ttDates = [...new Set(pending.map(e => e.analysis_date))];
  for (const d of ttDates) await refreshAnalysisCards(client, 'teamtotal', d);
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
    } else if (marketType === 'f5ml') {
      imgBuffer = await generateF5CardImage(entries, record, streak);
    } else {
      imgBuffer = await generateTeamTotalCardImage(entries, record, streak);
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
  await generateF5Analysis(client, guildId);
  await new Promise(r => setTimeout(r, 5000));
  await generateTeamTotalAnalysis(client, guildId);
  console.log('[MLB] Daily MLB analysis complete.');
}

/**
 * Run all three auto-resolvers
 */
async function autoResolveAll(client) {
  await autoResolveNrfi(client);
  await autoResolveF5(client);
  await autoResolveTeamTotals(client);
}

/**
 * Delete today's analysis for a market type and regenerate it.
 */
async function regenerateMarket(client, guildId, marketType) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  console.log(`[MLB] Regenerating ${marketType} for ${today}...`);
  await mlbDb.deleteAnalysisForToday(marketType, guildId, today);
  if (marketType === 'nrfi') await generateNrfiAnalysis(client, guildId);
  else if (marketType === 'f5ml') await generateF5Analysis(client, guildId);
  else if (marketType === 'teamtotal') await generateTeamTotalAnalysis(client, guildId);
  console.log(`[MLB] ${marketType} regeneration complete.`);
}

module.exports = {
  NRFI_CHANNEL_ID,
  F5ML_CHANNEL_ID,
  TEAMTOTAL_CHANNEL_ID,
  generateNrfiAnalysis,
  generateF5Analysis,
  generateTeamTotalAnalysis,
  generateAllDailyAnalysis,
  autoResolveAll,
  autoResolveNrfi,
  autoResolveF5,
  autoResolveTeamTotals,
  refreshAnalysisCards,
  regenerateMarket,
};
