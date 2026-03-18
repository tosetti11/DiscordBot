/**
 * AI Pick of the Day Service
 * Generates daily "lock" picks using ESPN game data + GPT-4o analysis.
 * Handles: pick generation, Discord posting, auto-closing, monthly recaps.
 */
const { getAllTodaysGames, getTodaysGames } = require('./espn');
const { SPORT_NAMES } = require('../config/constants');
const aiPicksDb = require('../database/aiPicks');
const { generateAiPickCardImage, generateAiRecordImage, generateMonthlyRecapImage } = require('../utils/aiPickCardImage');

const AI_CHANNEL_ID = '1483720217044713674';

// Seasonal sport weighting — prefer sports that are in season
function getSeasonalSports() {
  const month = new Date().getMonth() + 1; // 1-12
  if (month >= 9 && month <= 12) return ['nfl', 'nba', 'nhl', 'ncaa_mbb', 'ncaa_football'];
  if (month >= 1 && month <= 2) return ['nba', 'nhl', 'ncaa_mbb', 'nfl'];
  if (month === 3) return ['nba', 'nhl', 'ncaa_mbb', 'mlb'];
  if (month >= 4 && month <= 6) return ['nba', 'nhl', 'mlb'];
  if (month >= 7 && month <= 8) return ['mlb', 'nfl', 'mma'];
  return ['nba', 'nfl', 'mlb', 'nhl'];
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

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    console.error('[AI Pick] OPENAI_API_KEY not set');
    return null;
  }

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

  // Get current record for context
  const record = await aiPicksDb.getAiPickRecord(guildId);
  const streak = await aiPicksDb.getAiPickStreak(guildId);

  const gamesJson = JSON.stringify(allGames.map(g => ({
    sport: g.sport,
    sportName: g.sportName,
    matchup: `${g.away} @ ${g.home}`,
    awayRecord: g.awayRecord,
    homeRecord: g.homeRecord,
    spread: g.spread,
    overUnder: g.overUnder,
    startTime: g.startTime,
    espnGameId: g.espnGameId,
  })), null, 2);

  const prompt = `You are an expert sports handicapper AI with an elite track record. Your current record is ${record.wins}-${record.losses}-${record.pushes}.

Today's available games:
${gamesJson}

Select ONE "Lock Pick of the Day" — your single best value play. Requirements:
- Odds MUST be between -135 and +100 (this is a value-focused approach)
- The pick must be a moneyline, spread, or over/under (team_game bets). Player props are acceptable too.
- Focus on value — find where the line is off or where one side has a clear edge
- Distribute picks across sports over time (don't always pick the same sport)
- Consider the matchup, records, situational factors, and line value

Return a JSON object with this EXACT structure:
{
  "sport": "<sport value from the game>",
  "betCategory": "team_game" or "player_prop",
  "wagerType": "moneyline" or "spread" or "total" or "prop",
  "pick": "<formatted pick text, e.g. 'Lakers ML', 'Celtics -3.5', 'Over 220.5'>",
  "teamA": "<team being bet on or first team for totals>",
  "teamB": "<opponent or second team>",
  "playerName": "<player name if player_prop, else null>",
  "propDescription": "<prop description if player_prop, else null>",
  "spreadValue": <numeric spread or total line, or null>,
  "overUnder": "Over" or "Under" or null,
  "oddsAmerican": <American odds number between -135 and +100>,
  "espnGameId": "<ESPN game ID from the data>",
  "confidence": <number 85-99 representing confidence level>,
  "reasoning": "<2-3 sentence analysis explaining WHY this is the lock pick. Be specific about matchup advantages, trends, or line value.>"
}

IMPORTANT: Return ONLY valid JSON. No markdown, no explanation outside the JSON.`;

  try {
    const oaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 500,
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
    const pickData = JSON.parse(jsonStr);

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

    const message = await channel.send({
      content: `${rolePing}🔒 **AI LOCK OF THE DAY** 🔒`,
      files: [attachment],
      components: [buttonRow],
    });

    await aiPicksDb.updateAiPickMessage(aiPick.id, message.id);
    console.log(`[AI Pick] Posted pick ${aiPick.id} to channel ${AI_CHANNEL_ID}`);
    return message;
  } catch (err) {
    console.error('[AI Pick] Discord post error:', err);
    return null;
  }
}

/**
 * Handle Tail/Fade button interaction
 */
async function handleTailFade(interaction) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  const customId = interaction.customId;
  const parts = customId.split('_');
  const action = parts[1]; // 'tail' or 'fade'
  const pickId = parts.slice(2).join('_');

  try {
    await interaction.deferUpdate();

    // Record the user's tail/fade
    await aiPicksDb.recordTailFade(pickId, interaction.user.id, action);

    // Get updated counts
    const counts = await aiPicksDb.getTailFadeCounts(pickId);
    await aiPicksDb.updateAiPickTailCount(pickId, counts.tails, counts.fades);

    // Update buttons with new counts
    const newRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`aipick_tail_${pickId}`)
        .setLabel(`🔒 Tail (${counts.tails})`)
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`aipick_fade_${pickId}`)
        .setLabel(`Fade (${counts.fades})`)
        .setStyle(ButtonStyle.Danger),
    );

    await interaction.message.edit({ components: [newRow] });
  } catch (err) {
    console.error('[AI Pick] Tail/Fade error:', err);
  }
}

/**
 * Auto-close pending picks by checking ESPN scores
 */
async function autoClosePendingPicks(client) {
  const pending = await aiPicksDb.getPendingAiPicks();
  if (pending.length === 0) return;

  for (const pick of pending) {
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
}

function getDateStr(dateVal) {
  if (!dateVal) return undefined;
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
    const channel = await client.channels.fetch(AI_CHANNEL_ID);
    if (!channel) return;

    // Get updated record
    const record = await aiPicksDb.getAiPickRecord(guildId);
    const streak = await aiPicksDb.getAiPickStreak(guildId);
    const totalUnits = await calculateTotalUnits(guildId);

    // Generate record graphic
    const imgBuffer = await generateAiRecordImage(closedPick, record, streak, totalUnits);
    const attachment = new AttachmentBuilder(imgBuffer, { name: 'ai-result.png' });

    const emoji = closedPick.status === 'win' ? '✅' : closedPick.status === 'loss' ? '❌' : '🔄';
    const statusText = closedPick.status === 'win' ? 'WIN' : closedPick.status === 'loss' ? 'LOSS' : 'PUSH';

    await channel.send({
      content: `${emoji} **AI PICK RESULT: ${statusText}** ${emoji}\n${closedPick.result_note || ''}\n📊 Record: **${record.wins}-${record.losses}-${record.pushes}** | Units: **${totalUnits >= 0 ? '+' : ''}${totalUnits}u**`,
      files: [attachment],
    });

    // Update the original message to disable buttons
    if (closedPick.message_id) {
      try {
        const origMsg = await channel.messages.fetch(closedPick.message_id);
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
        await origMsg.edit({ components: [disabledRow] });
      } catch (e) {
        console.error('[AI Pick] Failed to update original message:', e.message);
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
  generateDailyPick,
  postPickToDiscord,
  handleTailFade,
  autoClosePendingPicks,
  postResultToDiscord,
  postMonthlyRecap,
  postTeaser,
  calculateTotalUnits,
  getSeasonalSports,
};
