/**
 * AI Pick of the Day Service
 * Generates daily "lock" picks using ESPN game data + GPT-4o analysis.
 * Handles: pick generation, Discord posting, auto-closing, monthly recaps.
 */
const { getTodaysGames } = require('./espn');
const { SPORT_NAMES } = require('../config/constants');
const aiPicksDb = require('../database/aiPicks');
const { generateAiPickCardImage, generateAiRecordImage, generateMonthlyRecapImage } = require('../utils/aiPickCardImage');
const nbaGamePicks = require('./nbaGamePicks');

const AI_CHANNEL_ID = '1483720217044713674';
const AI_OPEN_SLIPS_CHANNEL_ID = '1485903920906895370';

// Seasonal sport weighting — prefer sports that are in season
function getSeasonalSports() {
  const month = new Date().getMonth() + 1; // 1-12
  if (month >= 9 && month <= 12) return ['nfl', 'nba', 'nhl', 'ncaa_mbb', 'ncaa_football', 'epl', 'la_liga', 'serie_a', 'bundesliga', 'ucl'];
  if (month >= 1 && month <= 2) return ['nba', 'nhl', 'ncaa_mbb', 'nfl', 'epl', 'la_liga', 'serie_a', 'bundesliga', 'ucl'];
  if (month === 3) return ['nba', 'nhl', 'ncaa_mbb', 'mlb', 'epl', 'la_liga', 'serie_a', 'ucl', 'kbo', 'npb'];
  if (month >= 4 && month <= 5) return ['nhl', 'nba', 'mlb', 'golf_pga', 'epl', 'la_liga', 'serie_a', 'ucl', 'mls', 'kbo', 'npb'];
  if (month === 6) return ['mlb', 'wnba', 'mls', 'kbo', 'npb', 'golf_pga'];
  if (month >= 7 && month <= 8) return ['mlb', 'wnba', 'mls', 'mma', 'kbo', 'npb', 'golf_pga', 'epl'];
  return ['nba', 'nfl', 'mlb', 'nhl', 'epl'];
}

function americanToImpliedProbability(odds) {
  if (typeof odds !== 'number' || Number.isNaN(odds) || odds === 0) return null;
  if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100);
  return 100 / (odds + 100);
}

function normalizePercent(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num <= 0) return null;
  if (num <= 1) return num;
  if (num <= 100) return num / 100;
  return null;
}

function extractPredictorProbabilities(summaryJson) {
  const predictor = summaryJson?.predictor;
  if (!predictor) return null;

  const candidatePairs = [
    [predictor.homeTeam?.gameProjection, predictor.awayTeam?.gameProjection],
    [predictor.homeTeam?.probability, predictor.awayTeam?.probability],
    [predictor.homeTeam?.winChance, predictor.awayTeam?.winChance],
    [predictor.home?.gameProjection, predictor.away?.gameProjection],
    [predictor.home?.probability, predictor.away?.probability],
    [predictor.homeWinPercentage, predictor.awayWinPercentage],
    [predictor.homeChance, predictor.awayChance],
  ];

  for (const [homeRaw, awayRaw] of candidatePairs) {
    const home = normalizePercent(homeRaw);
    const away = normalizePercent(awayRaw);
    if (home !== null && away !== null) {
      return { home, away };
    }
  }

  return null;
}

function extractMoneylines(summaryJson) {
  const odds = summaryJson?.header?.competitions?.[0]?.odds?.[0]
    || summaryJson?.pickcenter?.[0]
    || null;

  if (!odds) return { home: null, away: null };

  const home = odds.homeTeamOdds?.moneyLine
    ?? odds.moneyline?.home?.close?.odds
    ?? odds.moneyline?.home?.current?.odds
    ?? odds.homeMoneyLine
    ?? null;
  const away = odds.awayTeamOdds?.moneyLine
    ?? odds.moneyline?.away?.close?.odds
    ?? odds.moneyline?.away?.current?.odds
    ?? odds.awayMoneyLine
    ?? null;

  return {
    home: typeof home === 'number' ? home : Number(home),
    away: typeof away === 'number' ? away : Number(away),
  };
}

async function fetchSummaryJson(sport, gameId) {
  const pathMap = {
    nba: 'basketball/nba',
    nfl: 'football/nfl',
    mlb: 'baseball/mlb',
    nhl: 'hockey/nhl',
    wnba: 'basketball/wnba',
    ncaa_mbb: 'basketball/mens-college-basketball',
    ncaa_football: 'football/college-football',
    epl: 'soccer/eng.1',
    la_liga: 'soccer/esp.1',
    serie_a: 'soccer/ita.1',
    bundesliga: 'soccer/ger.1',
    ucl: 'soccer/uefa.champions',
    mls: 'soccer/usa.1',
    kbo: 'baseball/kbo',
    npb: 'baseball/npb',
  };

  const espnPath = pathMap[sport];
  if (!espnPath) return null;

  try {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${espnPath}/summary?event=${gameId}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function toPercentString(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A';
  const normalized = value <= 1 ? value * 100 : value;
  return `${normalized.toFixed(1)}%`;
}

function buildLocalReasoning(candidate) {
  const factorText = (candidate.analyticsFactors || []).filter(Boolean).slice(0, 2).join(' ');
  const source = candidate.analyticsSource || 'Model';
  return `${source} makes this ${candidate.pick} a high-likelihood play with ${toPercentString(candidate.modelWinProbability)} win probability against a market implied ${toPercentString(candidate.marketImpliedProbability)}. ${factorText}`.trim();
}

async function generateReasoningFromAnalytics(candidate, record, recentPerformance, openAiApiKey) {
  if (!openAiApiKey) return buildLocalReasoning(candidate);

  const prompt = `You are writing the public explanation for a sports betting pick that has ALREADY been selected by an analytics model.

Current record: ${record.wins}-${record.losses}-${record.pushes}
Recent results: ${recentPerformance || 'No recent picks'}

Selected pick data:
- Sport: ${candidate.sportName || candidate.sport}
- Pick: ${candidate.pick}
- Odds: ${candidate.oddsAmerican}
- Model win probability: ${toPercentString(candidate.modelWinProbability)}
- Market implied probability: ${toPercentString(candidate.marketImpliedProbability)}
- Model edge: ${toPercentString(candidate.modelEdge)}
- Analytics source: ${candidate.analyticsSource}
- Key factors: ${(candidate.analyticsFactors || []).slice(0, 3).join(' | ')}

Write exactly 2 sentences.
- Focus on why this is more likely than not to hit.
- Emphasize matchup quality, probability, and market mismatch.
- Do NOT invent any stats or facts beyond the data above.
- Do NOT mention OpenAI or say "edge" unless describing the market mismatch clearly.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openAiApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 150,
      }),
    });
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    return text || buildLocalReasoning(candidate);
  } catch {
    return buildLocalReasoning(candidate);
  }
}

function makeAnalyticsCandidate(base) {
  const implied = americanToImpliedProbability(base.oddsAmerican);
  if (implied === null || base.modelWinProbability === null) return null;

  const edge = base.modelWinProbability - implied;
  // Tighter criteria: odds -115 to -160, probability ≥ 60%, edge ≥ 3%
  if (base.oddsAmerican > -115 || base.oddsAmerican < -160) return null;
  if (base.modelWinProbability < 0.60) return null;
  if (edge < 0.03) return null;

  return {
    ...base,
    marketImpliedProbability: implied,
    modelEdge: edge,
    selectionScore: (base.modelWinProbability * 100) + (edge * 100 * 1.75),
    confidence: Math.max(60, Math.min(82, Math.round(base.modelWinProbability * 100))),
  };
}

async function buildAnalyticsCandidates(allGames) {
  const candidates = [];

  try {
    const nbaTopPicks = await nbaGamePicks.generateTopGamePicks();
    for (const pick of (nbaTopPicks.moneyline || [])) {
      const odds = pick.pickTeam === 'home' ? pick.game?.odds?.homeML : pick.game?.odds?.awayML;
      const candidate = makeAnalyticsCandidate({
        sport: 'nba',
        sportName: SPORT_NAMES.nba,
        espnGameId: pick.game?.id,
        pick: `${pick.pick} ML`,
        teamA: pick.pickTeam === 'home' ? pick.game?.home?.name : pick.game?.away?.name,
        teamB: pick.pickTeam === 'home' ? pick.game?.away?.name : pick.game?.home?.name,
        wagerType: 'moneyline',
        betCategory: 'team_game',
        oddsAmerican: odds,
        eventStartTime: pick.game?.startTime || null,
        modelWinProbability: typeof pick.probability === 'number' ? pick.probability / 100 : null,
        analyticsSource: 'NBA team model',
        analyticsFactors: (pick.factors || []).slice(0, 3).map(f => f.detail),
      });
      if (candidate) candidates.push(candidate);
    }
  } catch (err) {
    console.error('[AI Pick] NBA analytics build error:', err.message);
  }

  // Non-NBA sports excluded from analytics path: ESPN predictor probability is a public model
  // already priced into betting lines, making edge calculations circular. NBA analytics model
  // uses real team/form data and is the only trustworthy signal here.

  candidates.sort((a, b) => b.selectionScore - a.selectionScore);
  return candidates;
}

/**
 * Fetch today's games across all seasonal sports and build a GPT-4o prompt
 */
async function generateDailyPick(client, guildId) {
  // Check if we already have a pick for today
  const existing = await aiPicksDb.getTodaysAiPick(guildId);
  if (existing) {
    // If pick exists but wasn't posted to Discord, post it now
    if (!existing.message_id) {
      console.log('[AI Pick] Found unposted pick for today, posting now...');
      await postPickToDiscord(client, existing, guildId);
    } else {
      console.log('[AI Pick] Already have a pick for today, skipping.');
    }
    return existing;
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY || null;

  // Fetch games from in-season sports
  const seasonalSports = getSeasonalSports();
  const allGames = [];
  for (const sport of seasonalSports) {
    const games = await getTodaysGames(sport);
    const preGames = games.filter(g => g.state === 'pre');
    for (const g of preGames) {
      allGames.push({
        sport,
        sportName: SPORT_NAMES[sport] || sport,
        espnGameId: g.id,
        home: g.home.name,
        homeAbbr: g.home.abbreviation,
        homeRecord: g.home.record,
        away: g.away.name,
        awayAbbr: g.away.abbreviation,
        awayRecord: g.away.record,
        startTime: g.startTime,
        spread: g.odds?.spread || 'N/A',
        overUnder: g.odds?.overUnder || 'N/A',
        broadcast: g.broadcast || '',
      });
    }
  }

  if (allGames.length === 0) {
    console.log('[AI Pick] No games available today.');
    return null;
  }

  // Enrich MLB games with probable pitchers
  for (const game of allGames) {
    if (game.sport === 'mlb') {
      try {
        const rawUrl = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '')}`;
        const rawRes = await fetch(rawUrl);
        const rawJson = await rawRes.json();
        const event = (rawJson.events || []).find(e => e.id === game.espnGameId);
        if (event) {
          const comp = event.competitions?.[0];
          const homeComp = comp?.competitors?.find(c => c.homeAway === 'home');
          const awayComp = comp?.competitors?.find(c => c.homeAway === 'away');
          const hp = homeComp?.probables?.[0];
          const ap = awayComp?.probables?.[0];
          game.homePitcher = hp ? `${hp.athlete?.displayName} ${hp.record || ''}` : 'TBD';
          game.awayPitcher = ap ? `${ap.athlete?.displayName} ${ap.record || ''}` : 'TBD';
        }
      } catch (e) { /* non-critical */ }
    }
  }

  // Get current record for context
  const record = await aiPicksDb.getAiPickRecord(guildId);
  const streak = await aiPicksDb.getAiPickStreak(guildId);

  // Get recent performance for better self-awareness
  const closedPicks = await aiPicksDb.getAiPickFullRecord(guildId);
  const last10 = (closedPicks || []).slice(0, 10);
  const recentPerformance = last10.map(p => `${p.sport} ${p.wager_type} ${p.pick}: ${p.status}`).join('; ');

  // Use ALL recent picks (including pending) for variety tracking
  const allRecentPicks = await aiPicksDb.getAllAiPicks(guildId);
  const recentForVariety = (allRecentPicks || []).slice(0, 5);

  // Build sport frequency from last 5 picks to enforce variety
  const last5Sports = recentForVariety.map(p => p.sport);
  const last3Sports = last5Sports.slice(0, 3);
  const sportFreq = {};
  for (const s of last5Sports) sportFreq[s] = (sportFreq[s] || 0) + 1;
  const overusedSports = Object.entries(sportFreq).filter(([, c]) => c >= 2).map(([s]) => s);
  const lastSport = last5Sports[0] || null;
  const last3WagerTypes = recentForVariety.slice(0, 3).map(p => p.wager_type);

  const analyticsCandidates = await buildAnalyticsCandidates(allGames);
  const analyticsShortlist = analyticsCandidates.slice(0, 5).map(candidate => ({
    sport: candidate.sport,
    pick: candidate.pick,
    odds: candidate.oddsAmerican,
    winProbability: Math.round(candidate.modelWinProbability * 1000) / 10,
    impliedProbability: Math.round(candidate.marketImpliedProbability * 1000) / 10,
    edge: Math.round(candidate.modelEdge * 1000) / 10,
    source: candidate.analyticsSource,
  }));

  if (analyticsCandidates.length > 0) {
    const selected = analyticsCandidates[0];
    const reasoning = await generateReasoningFromAnalytics(selected, record, recentPerformance, OPENAI_API_KEY);
    const aiPick = await aiPicksDb.createAiPick({
      guild_id: guildId,
      channel_id: AI_CHANNEL_ID,
      sport: selected.sport,
      bet_category: selected.betCategory,
      wager_type: selected.wagerType,
      pick: selected.pick,
      team_a: selected.teamA || null,
      team_b: selected.teamB || null,
      player_name: null,
      prop_description: null,
      spread_value: null,
      over_under: null,
      odds_american: selected.oddsAmerican,
      reasoning,
      confidence: selected.confidence,
      espn_game_id: selected.espnGameId || null,
      espn_sport: selected.sport,
      event_start_time: selected.eventStartTime,
      record_wins: record.wins,
      record_losses: record.losses,
      record_pushes: record.pushes,
      record_units: calculateUnitsFromRecord(record, selected.oddsAmerican),
      streak,
      analytics_source: selected.analyticsSource,
      model_win_probability: Math.round(selected.modelWinProbability * 1000) / 10,
      market_implied_probability: Math.round(selected.marketImpliedProbability * 1000) / 10,
      model_edge: Math.round(selected.modelEdge * 1000) / 10,
      selection_score: Math.round(selected.selectionScore * 10) / 10,
      analytics_1: selected.analyticsFactors?.[0] || null,
      analytics_2: selected.analyticsFactors?.[1] || null,
      analytics_3: selected.analyticsFactors?.[2] || null,
    });

    await postPickToDiscord(client, aiPick, guildId);
    return aiPick;
  }

  if (!OPENAI_API_KEY) {
    console.error('[AI Pick] No analytics candidates available and OPENAI_API_KEY not set');
    return null;
  }

  const gamesJson = JSON.stringify(allGames.map(g => {
    const obj = {
      sport: g.sport,
      sportName: g.sportName,
      matchup: `${g.away} @ ${g.home}`,
      awayRecord: g.awayRecord,
      homeRecord: g.homeRecord,
      spread: g.spread,
      overUnder: g.overUnder,
      startTime: g.startTime,
      espnGameId: g.espnGameId,
    };
    if (g.homePitcher) obj.homePitcher = g.homePitcher;
    if (g.awayPitcher) obj.awayPitcher = g.awayPitcher;
    return obj;
  }), null, 2);

  const prompt = `You are a disciplined sports handicapper AI with a public betting record. Current record: ${record.wins}-${record.losses}-${record.pushes}.

Recent results: ${recentPerformance || 'No recent picks'}

YOUR ONLY GOAL IS HIT RATE. Do not force a pick if no strong play exists today.

=== SELECTION CRITERIA (ALL must be met) ===
1. Odds between -115 and -160 only. No plus odds. No heavy juice beyond -160.
2. The team must have a CLEAR, SPECIFIC advantage — records, recent form, home/away, rest days, pitching matchup.
3. You must be able to articulate WHY this team is more likely to win than the market implies.
4. If you cannot identify a genuine edge on any game today, return a NO PICK response.

=== NO PICK OPTION ===
If today's slate has no game that clearly meets all criteria above, return:
{"noPick": true, "reason": "<one sentence why no pick today>"}
This is the CORRECT answer on a bad day. A bad forced pick is worse than no pick.

=== WHAT COUNTS AS REAL EDGE ===
- Strong home team with rest advantage vs tired road team
- MLB: elite pitcher (ERA < 3.5) vs weak lineup, or weak opposing pitcher
- Recent dominant form (6+ wins in last 10) vs struggling opponent
- Significant talent disparity in a -130 to -150 line (implies ~57-60% win prob)
- Clear situational angle (must-win game, rivalry, revenge, etc.)

=== WHAT IS NOT AN EDGE ===
- "The team is good" — every team in the playoffs/late season is good
- Records alone without situational context
- Any logic that could apply equally to both teams

Analytics shortlist (NBA model only — high confidence picks):
${analyticsShortlist.length ? JSON.stringify(analyticsShortlist, null, 2) : 'None today'}

Today's games:
${gamesJson}

Return ONLY a JSON object — either a pick or a no-pick:

Pick format:
{
  "sport": "<sport>",
  "betCategory": "team_game",
  "wagerType": "moneyline" or "spread" or "total",
  "pick": "<e.g. Cubs ML, Over 8.5, Lakers -4.5>",
  "teamA": "<team picked or home team for totals>",
  "teamB": "<opponent>",
  "playerName": null,
  "propDescription": null,
  "spreadValue": <number or null>,
  "overUnder": "Over" or "Under" or null,
  "oddsAmerican": <number -115 to -160>,
  "espnGameId": "<ESPN game ID>",
  "confidence": <60-85>,
  "reasoning": "<2-3 sentences citing SPECIFIC factors: form, matchup, rest, pitching. No generic statements.>"
}

No-pick format:
{"noPick": true, "reason": "<why>"}

Return ONLY valid JSON. No markdown.`;

  try {
    let pickData = null;
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const oaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.15,
          max_tokens: 600,
        }),
      });

      const oaiData = await oaiRes.json();
      if (oaiData.error) {
        console.error('[AI Pick] OpenAI error:', oaiData.error);
        return null;
      }

      const content = oaiData.choices?.[0]?.message?.content?.trim();
      if (!content) {
        console.error('[AI Pick] Empty OpenAI response');
        return null;
      }

      const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const candidate = JSON.parse(jsonStr);

      // Model chose no pick today — respect it
      if (candidate.noPick === true) {
        console.log(`[AI Pick] Model returned no pick: ${candidate.reason}`);
        return null;
      }

      // === HARD VALIDATION ===
      const odds = candidate.oddsAmerican;
      const violations = [];

      // Odds range: -115 to -160
      if (odds > -115 || odds < -160) {
        violations.push(`odds ${odds} outside -115 to -160`);
      }

      if (violations.length > 0) {
        console.log(`[AI Pick] Attempt ${attempt}/${MAX_RETRIES} rejected: ${violations.join(', ')}`);
        if (attempt === MAX_RETRIES) {
          console.log('[AI Pick] Max retries reached, accepting last attempt with warnings.');
          pickData = candidate;
        }
        continue;
      }

      pickData = candidate;
      console.log(`[AI Pick] Accepted pick on attempt ${attempt}: ${candidate.sport} ${candidate.pick} (${odds})`);
      break;
    }

    if (!pickData) {
      console.error('[AI Pick] Failed to generate valid pick after retries');
      return null;
    }

    // Find the matching game for event time
    const matchedGame = allGames.find(g => g.espnGameId === pickData.espnGameId);
    const eventStartTime = matchedGame?.startTime || null;

    // Calculate running record for card display
    const unitsPl = calculateUnitsFromRecord(record, pickData.oddsAmerican);

    // Create the DB record
    const aiPick = await aiPicksDb.createAiPick({
      guild_id: guildId,
      channel_id: AI_CHANNEL_ID,
      sport: pickData.sport,
      bet_category: pickData.betCategory || 'team_game',
      wager_type: pickData.wagerType || 'moneyline',
      pick: pickData.pick,
      team_a: pickData.teamA || null,
      team_b: pickData.teamB || null,
      player_name: pickData.playerName || null,
      prop_description: pickData.propDescription || null,
      spread_value: pickData.spreadValue || null,
      over_under: pickData.overUnder || null,
      odds_american: pickData.oddsAmerican,
      reasoning: pickData.reasoning,
      confidence: pickData.confidence || 90,
      espn_game_id: pickData.espnGameId || null,
      espn_sport: pickData.sport,
      event_start_time: eventStartTime,
      record_wins: record.wins,
      record_losses: record.losses,
      record_pushes: record.pushes,
      record_units: unitsPl,
      streak: streak,
    });

    // Post to Discord
    await postPickToDiscord(client, aiPick, guildId);

    return aiPick;
  } catch (err) {
    console.error('[AI Pick] Generation error:', err);
    return null;
  }
}

function calculateUnitsFromRecord(record, _currentOdds) {
  // Just return approximate units P/L based on closed picks
  // The actual unit tracking happens when picks close
  return 0; // Will be calculated properly from closed picks
}

async function calculateTotalUnits(guildId) {
  const closedPicks = await aiPicksDb.getAiPickFullRecord(guildId);
  let units = 0;
  for (const p of closedPicks) {
    if (p.status === 'win') {
      units += p.odds_american > 0 ? p.odds_american / 100 : 100 / Math.abs(p.odds_american);
    } else if (p.status === 'loss') {
      units -= 1;
    }
  }
  return parseFloat(units.toFixed(2));
}

/**
 * Post the AI pick to Discord with Tail/Fade buttons
 */
async function postPickToDiscord(client, aiPick, guildId) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');

  try {
    const channel = await client.channels.fetch(AI_CHANNEL_ID);
    if (!channel) {
      console.error('[AI Pick] Channel not found:', AI_CHANNEL_ID);
      return null;
    }

    // Get record for card
    const record = await aiPicksDb.getAiPickRecord(guildId);
    const streak = await aiPicksDb.getAiPickStreak(guildId);
    const totalUnits = await calculateTotalUnits(guildId);

    // Generate pick card image
    const imgBuffer = await generateAiPickCardImage(aiPick, record, streak, totalUnits);
    const attachment = new AttachmentBuilder(imgBuffer, { name: 'ai-pick.png' });

    // Tail/Fade buttons
    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`aipick_tail_${aiPick.id}`)
        .setLabel('🔒 Tail (0)')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`aipick_fade_${aiPick.id}`)
        .setLabel('Fade (0)')
        .setStyle(ButtonStyle.Danger),
    );

    // Role ping — auto-create "AI Picks" role if missing
    const guild = client.guilds.cache.get(guildId);
    let rolePing = '';
    if (guild) {
      let role = guild.roles.cache.find(r => r.name === 'AI Picks');
      if (!role) {
        try {
          role = await guild.roles.create({
            name: 'AI Picks',
            color: 0xFFD700,
            mentionable: true,
            reason: 'Auto-created for AI Pick of the Day notifications',
          });
          console.log('[AI Pick] Created "AI Picks" role:', role.id);
        } catch (e) {
          console.error('[AI Pick] Could not create AI Picks role:', e.message);
        }
      }
      if (role) rolePing = `${role} `;
    }

    // Post to primary AI Picks channel (with role ping)
    const message = await channel.send({
      content: `${rolePing}🔒 **AI LOCK OF THE DAY** 🔒`,
      files: [attachment],
      components: [buttonRow],
    });

    await aiPicksDb.updateAiPickMessage(aiPick.id, message.id);
    console.log(`[AI Pick] Posted pick ${aiPick.id} to channel ${AI_CHANNEL_ID}`);

    // Cross-post to AI Open Slips channel (no role ping to avoid double notification)
    try {
      const slipsChannel = await client.channels.fetch(AI_OPEN_SLIPS_CHANNEL_ID);
      if (slipsChannel) {
        const mirrorImg = new AttachmentBuilder(imgBuffer, { name: 'ai-pick.png' });
        const mirrorRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`aipick_tail_${aiPick.id}`)
            .setLabel('🔒 Tail (0)')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`aipick_fade_${aiPick.id}`)
            .setLabel('Fade (0)')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setLabel('Comment')
            .setStyle(ButtonStyle.Link)
            .setURL(`https://discord.com/channels/${guildId}/${AI_CHANNEL_ID}/${message.id}`),
        );
        const mirrorMsg = await slipsChannel.send({
          content: '🔒 **AI LOCK OF THE DAY** 🔒',
          files: [mirrorImg],
          components: [mirrorRow],
        });
        await aiPicksDb.updateAiPickMirrorMessage(aiPick.id, mirrorMsg.id, AI_OPEN_SLIPS_CHANNEL_ID);
        console.log(`[AI Pick] Cross-posted pick ${aiPick.id} to AI Open Slips`);
      }
    } catch (e) {
      console.error('[AI Pick] Cross-post to AI Open Slips error:', e.message);
    }

    return message;
  } catch (err) {
    console.error('[AI Pick] Discord post error:', err);
    return null;
  }
}

/**
 * Build the Tail/Fade button row with current counts
 */
function buildTailFadeRow(pickId, counts, isGolf = false) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  const emoji = isGolf ? '⛳' : '🔒';
  const tailLabel = counts.totalUnits > 0
    ? `${emoji} Tail (${counts.tails}) ${counts.totalUnits}u`
    : `${emoji} Tail (${counts.tails})`;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`aipick_tail_${pickId}`)
      .setLabel(tailLabel)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`aipick_fade_${pickId}`)
      .setLabel(`Fade (${counts.fades})`)
      .setStyle(ButtonStyle.Danger),
  );
}

/**
 * Build message content showing who is tailing/fading
 */
function buildTailFadeContent(counts, header = '🔒 **AI LOCK OF THE DAY** 🔒') {
  let content = `${header}\n\n`;
  const tailMentions = (counts.tailUsers || []).map(u => `<@${u.discordId}> (${u.units}u)`);
  const fadeMentions = (counts.fadeUsers || []).map(u => `<@${u.discordId}>`);
  content += `👍 **Tailing (${counts.tails}):** ${tailMentions.length ? tailMentions.join(', ') : 'None'}\n`;
  content += `👎 **Fading (${counts.fades}):** ${fadeMentions.length ? fadeMentions.join(', ') : 'None'}`;
  return content;
}

/**
 * Update the mirror copy of a message in the other channel (best-effort)
 * If updating the mirror (Open Slips), append a Comment link button back to original.
 */
async function updateMirrorMessage(client, pick, clickedMessageId, content, components) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  try {
    let targetMsgId, targetChannelId, isUpdatingMirror;
    if (clickedMessageId === pick.message_id && pick.mirror_message_id) {
      targetMsgId = pick.mirror_message_id;
      targetChannelId = pick.mirror_channel_id;
      isUpdatingMirror = true;
    } else if (clickedMessageId === pick.mirror_message_id && pick.message_id) {
      targetMsgId = pick.message_id;
      targetChannelId = pick.channel_id;
      isUpdatingMirror = false;
    } else {
      return;
    }

    // Add Comment link button to mirror copy pointing back to original message
    if (isUpdatingMirror && pick.message_id && pick.channel_id) {
      const guildId = pick.guild_id || process.env.DISCORD_GUILD_ID;
      const commentBtn = new ButtonBuilder()
        .setLabel('Comment')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/channels/${guildId}/${pick.channel_id}/${pick.message_id}`);
      if (components.length > 0 && components[0] instanceof ActionRowBuilder) {
        components[0].addComponents(commentBtn);
      }
    }

    const ch = await client.channels.fetch(targetChannelId);
    if (!ch) return;
    const msg = await ch.messages.fetch(targetMsgId);
    await msg.edit({ content, components });
  } catch (e) {
    // Mirror update is best-effort — don't crash if the message is gone
  }
}

/**
 * Handle Tail/Fade button interaction (toggle + unit modal for tails)
 */
async function handleTailFade(interaction) {
  const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
  const customId = interaction.customId;
  const parts = customId.split('_');
  const action = parts[1]; // 'tail' or 'fade'
  const pickId = parts.slice(2).join('_');

  try {
    // Fetch pick to determine type (daily vs golf) and mirror info
    const pick = await aiPicksDb.getAiPick(pickId);
    const isGolf = pick?.pick_type === 'golf_round';
    const header = isGolf ? '⛳ **GOLF ROUND TOTAL** ⛳' : '🔒 **AI LOCK OF THE DAY** 🔒';

    // Check if user already has an action on this pick
    const existing = await aiPicksDb.getUserTailFade(pickId, interaction.user.id);

    // TAIL button clicked
    if (action === 'tail') {
      if (existing && existing.action === 'tail') {
        // Already tailing → toggle OFF (remove)
        await interaction.deferUpdate();
        await aiPicksDb.removeTailFade(pickId, interaction.user.id);
        const counts = await aiPicksDb.getTailFadeCounts(pickId);
        await aiPicksDb.updateAiPickTailCount(pickId, counts.tails, counts.fades);
        const content = buildTailFadeContent(counts, header);
        const components = [buildTailFadeRow(pickId, counts, isGolf)];
        await interaction.message.edit({ content, components });
        await updateMirrorMessage(interaction.client, pick, interaction.message.id, content, components);
        await interaction.followUp({ content: '🔓 Tail removed.', ephemeral: true });
        return;
      }
      // Not tailing → show modal to pick units
      const modal = new ModalBuilder()
        .setCustomId(`aipick_tail_units_${pickId}`)
        .setTitle('Tail — How many units?');
      const unitsInput = new TextInputBuilder()
        .setCustomId('units')
        .setLabel('Units (1-5)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('1')
        .setMinLength(1)
        .setMaxLength(1)
        .setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(unitsInput));
      await interaction.showModal(modal);
      return;
    }

    // FADE button clicked
    await interaction.deferUpdate();
    if (existing && existing.action === 'fade') {
      // Already fading → toggle OFF (remove)
      await aiPicksDb.removeTailFade(pickId, interaction.user.id);
      const counts = await aiPicksDb.getTailFadeCounts(pickId);
      await aiPicksDb.updateAiPickTailCount(pickId, counts.tails, counts.fades);
      const content = buildTailFadeContent(counts, header);
      const components = [buildTailFadeRow(pickId, counts, isGolf)];
      await interaction.message.edit({ content, components });
      await updateMirrorMessage(interaction.client, pick, interaction.message.id, content, components);
      await interaction.followUp({ content: '↩️ Fade removed.', ephemeral: true });
    } else {
      // Not fading (or was tailing) → switch to fade
      await aiPicksDb.recordTailFade(pickId, interaction.user.id, 'fade', 0);
      const counts = await aiPicksDb.getTailFadeCounts(pickId);
      await aiPicksDb.updateAiPickTailCount(pickId, counts.tails, counts.fades);
      const content = buildTailFadeContent(counts, header);
      const components = [buildTailFadeRow(pickId, counts, isGolf)];
      await interaction.message.edit({ content, components });
      await updateMirrorMessage(interaction.client, pick, interaction.message.id, content, components);
      await interaction.followUp({ content: '🚫 Fade locked in.', ephemeral: true });
    }
  } catch (err) {
    console.error('[AI Pick] Tail/Fade error:', err);
  }
}

/**
 * Handle the Tail units modal submission
 */
async function handleTailUnitsModal(interaction) {
  try {
    const pickId = interaction.customId.replace('aipick_tail_units_', '');
    const raw = interaction.fields.getTextInputValue('units');
    const units = parseInt(raw, 10);
    if (isNaN(units) || units < 1 || units > 5) {
      return interaction.reply({ content: '❌ Enter a number between 1 and 5.', ephemeral: true });
    }

    const pick = await aiPicksDb.getAiPick(pickId);
    const isGolf = pick?.pick_type === 'golf_round';
    const header = isGolf ? '⛳ **GOLF ROUND TOTAL** ⛳' : '🔒 **AI LOCK OF THE DAY** 🔒';

    await interaction.deferUpdate();
    await aiPicksDb.recordTailFade(pickId, interaction.user.id, 'tail', units);
    const counts = await aiPicksDb.getTailFadeCounts(pickId);
    await aiPicksDb.updateAiPickTailCount(pickId, counts.tails, counts.fades);
    const content = buildTailFadeContent(counts, header);
    const components = [buildTailFadeRow(pickId, counts, isGolf)];
    await interaction.message.edit({ content, components });
    await updateMirrorMessage(interaction.client, pick, interaction.message.id, content, components);
    await interaction.followUp({ content: `🔒 Tailing **${units}u** — locked in!`, ephemeral: true });
  } catch (err) {
    console.error('[AI Pick] Tail units modal error:', err);
  }
}

/**
 * Auto-close pending picks by checking ESPN scores
 */
async function autoClosePendingPicks(client) {
  const pending = await aiPicksDb.getPendingAiPicks();
  if (pending.length === 0) return;

  // ── Regular team-sport picks ──────────────────────────────────────────────
  for (const pick of pending) {
    if (pick.pick_type === 'golf_round') continue; // handled separately below
    if (!pick.espn_game_id || !pick.espn_sport) continue;

    try {
      const games = await getTodaysGames(pick.espn_sport, getDateStr(pick.pick_date));
      const game = games.find(g => g.id === pick.espn_game_id);
      if (!game || !game.completed) continue;

      // Determine win/loss/push
      const result = resolvePickResult(pick, game);
      if (!result) continue;

      const finalScore = `${game.away.name} ${game.away.score} - ${game.home.name} ${game.home.score}`;
      const closedPick = await aiPicksDb.closeAiPick(pick.id, result.status, result.note, finalScore);

      // Post result to Discord
      await postResultToDiscord(client, closedPick, pick.guild_id);
      console.log(`[AI Pick] Auto-closed pick ${pick.id}: ${result.status} (${finalScore})`);
    } catch (err) {
      console.error(`[AI Pick] Auto-close error for ${pick.id}:`, err.message);
    }
  }

  // ── Golf round picks ──────────────────────────────────────────────────────
  // Include golf picks even without espn_game_id — we'll try to match by tournament name
  const golfPending = pending.filter(p => p.pick_type === 'golf_round');
  if (golfPending.length === 0) return;

  // Group by (espn_game_id or tournament_name) + round number so we only fetch each scoreboard once
  const golfGroups = new Map();
  for (const pick of golfPending) {
    const key = `${pick.espn_game_id || pick.tournament_name || 'unknown'}:${pick.round_number}`;
    if (!golfGroups.has(key)) {
      golfGroups.set(key, {
        eventId: pick.espn_game_id || null,
        tournamentName: pick.tournament_name || null,
        roundNum: pick.round_number,
        pickDate: pick.pick_date,
        picks: [],
      });
    }
    golfGroups.get(key).picks.push(pick);
  }

  for (const [, group] of golfGroups) {
    const { eventId, tournamentName, roundNum, pickDate, picks: groupPicks } = group;
    try {
      // Build a prioritised list of URLs to try:
      // 1. pick_date specific (most precise)
      // 2. no-date = ESPN returns current/most-recent tournament (handles null pick_date)
      const dateStr = getDateStr(pickDate);
      const urls = [];
      if (dateStr) urls.push(`https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates=${dateStr}`);
      urls.push(`https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard`);

      let event = null;
      let resolvedEventId = eventId;

      for (const url of urls) {
        const res = await fetch(url);
        if (!res.ok) continue;
        const events = (await res.json()).events || [];
        if (eventId) {
          event = events.find(e => e.id === eventId) || null;
        }
        // Fallback: match by tournament name (covers picks without espn_game_id)
        if (!event && tournamentName) {
          const tNorm = tournamentName.toLowerCase().replace(/[^a-z ]/g, '').trim();
          event = events.find(e => {
            const eName = (e.name || '').toLowerCase().replace(/[^a-z ]/g, '').trim();
            return eName.includes(tNorm) || tNorm.includes(eName);
          }) || null;
          if (event) resolvedEventId = event.id;
        }
        if (event) break;
      }
      if (!event) continue;

      // Back-fill espn_game_id on any picks in this group that were missing it
      if (resolvedEventId && resolvedEventId !== eventId) {
        for (const pick of groupPicks) {
          if (!pick.espn_game_id) {
            await aiPicksDb.updateAiPickEspnId(pick.id, resolvedEventId);
          }
        }
      }

      const competitors = event.competitions?.[0]?.competitors || [];
      const rIdx = roundNum - 1;

      // Check if the round is complete: at least 80% of the field has a score
      const withScore = competitors.filter(c => {
        const r = c.linescores?.[rIdx];
        return r && r.value != null;
      }).length;
      const roundComplete = withScore >= Math.max(1, Math.floor(competitors.length * 0.8));
      if (!roundComplete) continue;

      // Build player → round score map (normalised name → strokes)
      const scoreMap = new Map();
      for (const c of competitors) {
        const name = (c.athlete?.displayName || '').toLowerCase().replace(/[^a-z ]/g, '').trim();
        const score = c.linescores?.[rIdx]?.value ?? null;
        if (name && score != null) scoreMap.set(name, score);
      }

      for (const pick of groupPicks) {
        try {
          // prop_description format: "Round N Score Over/Under X.X"
          const desc = (pick.prop_description || '').toLowerCase();
          const m = desc.match(/(?:round\s*\d+\s+)?score\s+(over|under)\s+([\d.]+)/i);
          if (!m) continue;
          const side = m[1].toLowerCase(); // 'over' or 'under'
          const line = parseFloat(m[2]);

          // Find player score (with fuzzy fallback)
          const normName = (pick.player_name || '').toLowerCase().replace(/[^a-z ]/g, '').trim();
          let playerScore = scoreMap.get(normName) ?? null;
          if (playerScore == null) {
            for (const [k, v] of scoreMap) {
              if (k.includes(normName) || normName.includes(k)) { playerScore = v; break; }
            }
          }
          if (playerScore == null) continue; // player not found yet — skip

          let status, note;
          if (side === 'over') {
            if (playerScore > line) { status = 'win'; note = `Auto-resolved: ${pick.player_name} R${roundNum} shot ${playerScore} (OVER ${line}) ✅`; }
            else if (playerScore < line) { status = 'loss'; note = `Auto-resolved: ${pick.player_name} R${roundNum} shot ${playerScore} (OVER ${line} failed) ❌`; }
            else { status = 'push'; note = `Auto-resolved: ${pick.player_name} R${roundNum} shot ${playerScore} exactly ${line} 🔄`; }
          } else {
            if (playerScore < line) { status = 'win'; note = `Auto-resolved: ${pick.player_name} R${roundNum} shot ${playerScore} (UNDER ${line}) ✅`; }
            else if (playerScore > line) { status = 'loss'; note = `Auto-resolved: ${pick.player_name} R${roundNum} shot ${playerScore} (UNDER ${line} failed) ❌`; }
            else { status = 'push'; note = `Auto-resolved: ${pick.player_name} R${roundNum} shot ${playerScore} exactly ${line} 🔄`; }
          }

          const closedPick = await aiPicksDb.closeAiPick(pick.id, status, note, `R${roundNum}: ${playerScore}`);
          await postResultToDiscord(client, closedPick, pick.guild_id);
          console.log(`[AI Pick] Auto-closed golf pick ${pick.id}: ${status} (${note})`);
        } catch (err) {
          console.error(`[AI Pick] Golf auto-close error for pick ${pick.id}:`, err.message);
        }
      }
    } catch (err) {
      console.error(`[AI Pick] Golf group auto-close error (event ${eventId} R${roundNum}):`, err.message);
    }
  }
}

function getDateStr(dateVal) {
  if (!dateVal) return undefined;
  // If dateVal is a plain YYYY-MM-DD string, use it directly to avoid
  // UTC-vs-ET timezone shift (new Date('2026-03-18') = midnight UTC = Mar 17 ET)
  if (typeof dateVal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
    return dateVal.replace(/-/g, '');
  }
  const d = new Date(dateVal);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
}

/**
 * Determine if a pick won, lost, or pushed based on final score
 */
function resolvePickResult(pick, game) {
  const homeScore = game.home.score;
  const awayScore = game.away.score;
  const wt = pick.wager_type;

  // Determine which team is "our" team
  const isHomePick = fuzzyMatch(pick.team_a, game.home.name) || fuzzyMatch(pick.team_a, game.home.abbreviation);
  const pickScore = isHomePick ? homeScore : awayScore;
  const oppScore = isHomePick ? awayScore : homeScore;

  if (wt === 'moneyline') {
    if (pickScore > oppScore) return { status: 'win', note: `${pick.team_a} won ${pickScore}-${oppScore}` };
    if (pickScore < oppScore) return { status: 'loss', note: `${pick.team_a} lost ${oppScore}-${pickScore}` };
    return { status: 'push', note: 'Game ended in a tie' };
  }

  if (wt === 'spread') {
    const spread = parseFloat(pick.spread_value);
    const adjustedScore = pickScore + spread;
    if (adjustedScore > oppScore) return { status: 'win', note: `${pick.team_a} ${spread > 0 ? '+' : ''}${spread} covered (${pickScore}-${oppScore})` };
    if (adjustedScore < oppScore) return { status: 'loss', note: `${pick.team_a} ${spread > 0 ? '+' : ''}${spread} failed to cover (${pickScore}-${oppScore})` };
    return { status: 'push', note: `Push on ${spread}` };
  }

  if (wt === 'total') {
    const totalLine = parseFloat(pick.spread_value);
    const actualTotal = homeScore + awayScore;
    const isOver = (pick.over_under || '').toLowerCase() === 'over';
    if (isOver) {
      if (actualTotal > totalLine) return { status: 'win', note: `Total: ${actualTotal} (Over ${totalLine}) ✅` };
      if (actualTotal < totalLine) return { status: 'loss', note: `Total: ${actualTotal} (Over ${totalLine}) ❌` };
      return { status: 'push', note: `Total: ${actualTotal} = ${totalLine}` };
    } else {
      if (actualTotal < totalLine) return { status: 'win', note: `Total: ${actualTotal} (Under ${totalLine}) ✅` };
      if (actualTotal > totalLine) return { status: 'loss', note: `Total: ${actualTotal} (Under ${totalLine}) ❌` };
      return { status: 'push', note: `Total: ${actualTotal} = ${totalLine}` };
    }
  }

  if (wt === 'team_total') {
    const totalLine = parseFloat(pick.spread_value);
    const isOver = (pick.over_under || '').toLowerCase() === 'over';
    if (isOver) {
      if (pickScore > totalLine) return { status: 'win', note: `${pick.team_a}: ${pickScore} pts (Over ${totalLine}) ✅` };
      if (pickScore < totalLine) return { status: 'loss', note: `${pick.team_a}: ${pickScore} pts (Over ${totalLine}) ❌` };
      return { status: 'push', note: `${pick.team_a}: ${pickScore} = ${totalLine}` };
    } else {
      if (pickScore < totalLine) return { status: 'win', note: `${pick.team_a}: ${pickScore} pts (Under ${totalLine}) ✅` };
      if (pickScore > totalLine) return { status: 'loss', note: `${pick.team_a}: ${pickScore} pts (Under ${totalLine}) ❌` };
      return { status: 'push', note: `${pick.team_a}: ${pickScore} = ${totalLine}` };
    }
  }

  return null;
}

function fuzzyMatch(a, b) {
  if (!a || !b) return false;
  return a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase());
}

/**
 * Post the result card after a pick closes
 */
async function postResultToDiscord(client, closedPick, guildId) {
  const { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

  try {
    // Use the pick's own channel so golf picks post to the golf channel
    const targetChannelId = closedPick.channel_id || AI_CHANNEL_ID;
    const channel = await client.channels.fetch(targetChannelId);
    if (!channel) return;

    // Build disabled button row (used for both paths)
    const disabledRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`aipick_tail_${closedPick.id}`)
        .setLabel(`🔒 Tail (${closedPick.tail_count || 0})`)
        .setStyle(ButtonStyle.Success)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`aipick_fade_${closedPick.id}`)
        .setLabel(`Fade (${closedPick.fade_count || 0})`)
        .setStyle(ButtonStyle.Danger)
        .setDisabled(true),
    );

    // ── Golf picks: edit the original card image to show WIN/LOSS stamp ──
    if (closedPick.pick_type === 'golf_round') {
      if (closedPick.message_id) {
        try {
          const { generateGolfRoundOUCardImage } = require('../utils/golfPickCardImage');
          const origMsg = await channel.messages.fetch(closedPick.message_id);

          // Extract the pick number/total from original message content (e.g. "Pick 3/10")
          const numMatch = (origMsg.content || '').match(/Pick (\d+)\/(\d+)/i);
          const pickNum = numMatch ? parseInt(numMatch[1]) : 1;
          const totalPicks = numMatch ? parseInt(numMatch[2]) : 1;

          // Parse playerScore from final_score ("R4: 67" → 67)
          const scoreMatch = (closedPick.final_score || '').match(/:\s*(\d+)/);
          const playerScore = scoreMatch ? parseInt(scoreMatch[1]) : null;

          // Rebuild a pick object from the closed pick record
          const pickForCard = {
            player_name: closedPick.player_name || closedPick.pick,
            line: (() => {
              const lm = (closedPick.prop_description || '').match(/([\d.]+)\s*$/);
              return lm ? parseFloat(lm[1]) : null;
            })(),
            pick_side: (() => {
              const pm = (closedPick.prop_description || '').match(/\b(over|under)\b/i);
              return pm ? pm[1] : closedPick.pick?.split(' ')[1] || 'Over';
            })(),
            odds_american: closedPick.odds_american,
            confidence: closedPick.confidence,
            reasoning: closedPick.reasoning,
            tournament_name: closedPick.tournament_name,
            round_label: closedPick.round_number ? `Round ${closedPick.round_number}` : 'Round',
          };

          // Fetch golf record for footer
          const golfRecord = await aiPicksDb.getGolfRoundRecord(guildId);

          const result = { status: closedPick.status, playerScore, note: closedPick.result_note };
          const imgBuffer = await generateGolfRoundOUCardImage(pickForCard, golfRecord, pickNum, totalPicks, result);
          const attachment = new AttachmentBuilder(imgBuffer, { name: 'golf-pick-result.png' });

          await origMsg.edit({ files: [attachment], components: [disabledRow] });
          console.log(`[AI Pick] Edited golf pick image for ${closedPick.id}: ${closedPick.status}`);
        } catch (e) {
          console.error('[AI Pick] Failed to edit golf pick message:', e.message);
        }
      }
      return; // Golf picks: no separate result post needed
    }

    // ── Regular daily picks: post a new result card + disable original buttons ──
    const record = await aiPicksDb.getAiPickRecord(guildId);
    const streak = await aiPicksDb.getAiPickStreak(guildId);
    const totalUnits = await calculateTotalUnits(guildId);

    const imgBuffer = await generateAiRecordImage(closedPick, record, streak, totalUnits);
    const attachment = new AttachmentBuilder(imgBuffer, { name: 'ai-result.png' });

    const emoji = closedPick.status === 'win' ? '✅' : closedPick.status === 'loss' ? '❌' : '🔄';
    const statusText = closedPick.status === 'win' ? 'WIN' : closedPick.status === 'loss' ? 'LOSS' : 'PUSH';
    const resultContent = `${emoji} **AI PICK RESULT: ${statusText}** ${emoji}\n${closedPick.result_note || ''}\n📊 Record: **${record.wins}-${record.losses}-${record.pushes}** | Units: **${totalUnits >= 0 ? '+' : ''}${totalUnits}u**`;

    await channel.send({
      content: resultContent,
      files: [attachment],
    });

    // Disable buttons on original message
    if (closedPick.message_id) {
      try {
        const origMsg = await channel.messages.fetch(closedPick.message_id);
        await origMsg.edit({ components: [disabledRow] });
      } catch (e) {
        console.error('[AI Pick] Failed to update original message:', e.message);
      }
    }

    // Delete mirror message from AI Open Slips (open slips only — no results there)
    if (closedPick.mirror_message_id) {
      try {
        const slipsChannel = await client.channels.fetch(AI_OPEN_SLIPS_CHANNEL_ID);
        if (slipsChannel) {
          const mirrorMsg = await slipsChannel.messages.fetch(closedPick.mirror_message_id);
          await mirrorMsg.delete();
          console.log(`[AI Pick] Deleted mirror message ${closedPick.mirror_message_id} from AI Open Slips`);
        }
      } catch (e) {
        console.error('[AI Pick] Failed to delete mirror message:', e.message);
      }
    }
  } catch (err) {
    console.error('[AI Pick] Result post error:', err);
  }
}

/**
 * Post monthly recap at end of month
 */
async function postMonthlyRecap(client, guildId, year, month) {
  const { AttachmentBuilder } = require('discord.js');

  try {
    const recap = await aiPicksDb.getMonthlyRecap(guildId, year, month);
    if (recap.record.wins + recap.record.losses + recap.record.pushes === 0) return;

    const channel = await client.channels.fetch(AI_CHANNEL_ID);
    if (!channel) return;

    const imgBuffer = await generateMonthlyRecapImage(recap, year, month);
    const attachment = new AttachmentBuilder(imgBuffer, { name: 'monthly-recap.png' });

    const monthName = new Date(year, month - 1).toLocaleString('en-US', { month: 'long' });
    const roi = recap.record.wins + recap.record.losses > 0
      ? ((recap.record.units / (recap.record.wins + recap.record.losses)) * 100).toFixed(1)
      : '0.0';

    await channel.send({
      content: `📊 **${monthName} ${year} AI PICK RECAP** 📊\n\n🏆 Record: **${recap.record.wins}-${recap.record.losses}-${recap.record.pushes}**\n💰 Units: **${recap.record.units >= 0 ? '+' : ''}${recap.record.units.toFixed(2)}u** (${roi}% ROI)\n🔥 Best Streak: **${recap.maxStreak}W**`,
      files: [attachment],
    });

    console.log(`[AI Pick] Posted monthly recap for ${monthName} ${year}`);
  } catch (err) {
    console.error('[AI Pick] Monthly recap error:', err);
  }
}

/**
 * Post teaser 30 min before the daily pick
 */
async function postTeaser(client) {
  try {
    const channel = await client.channels.fetch(AI_CHANNEL_ID);
    if (!channel) return;
    await channel.send('⏳ **AI Lock of the Day dropping in 30 minutes...** 🔒');
  } catch (err) {
    console.error('[AI Pick] Teaser error:', err);
  }
}

module.exports = {
  AI_CHANNEL_ID,
  AI_OPEN_SLIPS_CHANNEL_ID,
  generateDailyPick,
  postPickToDiscord,
  handleTailFade,
  handleTailUnitsModal,
  autoClosePendingPicks,
  postResultToDiscord,
  postMonthlyRecap,
  postTeaser,
  calculateTotalUnits,
  getSeasonalSports,
};
