/**
 * Golf Round Totals AI Service
 * Generates AI-powered golf round total O/U picks using ESPN data + GPT-4o analysis.
 * Posts individual cards to Discord with tail/fade buttons (Thu-Sun during tournaments).
 * Handles: pick generation, evening round recaps, Sunday tournament recaps, auto-close.
 */
const aiPicksDb = require('../database/aiPicks');
const { generateGolfPickCardImage, generateGolfRecapImage, generateGolfTournamentRecapImage } = require('../utils/golfPickCardImage');

const GOLF_CHANNEL_ID = '1485903920906895370'; // AI Open Slips

// ── ESPN Golf Helpers ──

/**
 * Fetch current PGA tournament scoreboard from ESPN
 */
async function fetchGolfScoreboard() {
  try {
    const url = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN golf API ${res.status}`);
    const json = await res.json();

    const event = json.events?.[0];
    if (!event) return null;

    const comp = event.competitions?.[0];
    if (!comp) return null;

    const statusType = event.status?.type || {};

    return {
      eventId: event.id,
      name: event.name,
      shortName: event.shortName,
      startDate: event.date,
      endDate: event.endDate,
      state: statusType.state || 'pre',  // 'pre', 'in', 'post'
      completed: statusType.completed || false,
      statusDetail: statusType.description || '',
      competitors: (comp.competitors || []).map(p => ({
        id: p.id,
        name: p.athlete?.fullName || 'Unknown',
        displayName: p.athlete?.displayName || p.athlete?.fullName || 'Unknown',
        country: p.athlete?.flag?.alt || '',
        totalScore: p.score,
        rounds: (p.linescores || []).map(r => ({
          round: r.period,
          score: r.value,
          toPar: r.displayValue,
        })),
      })),
    };
  } catch (err) {
    console.error('[Golf] ESPN scoreboard error:', err.message);
    return null;
  }
}

/**
 * Determine which round is currently being played or is next
 */
function getCurrentRound(tournament) {
  if (!tournament || !tournament.competitors?.length) return null;

  // Find the max round that has any scores
  let maxRound = 0;
  for (const p of tournament.competitors) {
    for (const r of p.rounds) {
      if (r.score && r.round > maxRound) maxRound = r.round;
    }
  }

  // If tournament hasn't started (no rounds have scores), it's round 1
  if (maxRound === 0) return 1;

  // Check how many players have completed maxRound
  const withMaxRound = tournament.competitors.filter(p =>
    p.rounds.some(r => r.round === maxRound && r.score)
  ).length;

  // If most players have scores for this round, the current round is complete
  // and next round is upcoming (if tournament isn't over)
  const totalPlayers = tournament.competitors.length;
  if (withMaxRound > totalPlayers * 0.5 && !tournament.completed) {
    return maxRound < 4 ? maxRound + 1 : maxRound;
  }

  return maxRound;
}

/**
 * Determine if today is a tournament day (Thu-Sun) when we should post picks
 */
function isTournamentDay() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = now.getDay(); // 0=Sun, 1=Mon, ..., 4=Thu, 5=Fri, 6=Sat
  return day === 0 || day === 4 || day === 5 || day === 6;
}

// ── GPT-4o Pick Generation ──

/**
 * Generate golf round total picks using GPT-4o
 */
async function generateGolfPicks(client, guildId) {
  if (!isTournamentDay()) {
    console.log('[Golf] Not a tournament day (Thu-Sun), skipping.');
    return [];
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    console.error('[Golf] OPENAI_API_KEY not set');
    return [];
  }

  // Fetch tournament data
  const tournament = await fetchGolfScoreboard();
  if (!tournament) {
    console.log('[Golf] No active PGA tournament found.');
    return [];
  }

  if (tournament.completed) {
    console.log('[Golf] Tournament already completed, skipping picks.');
    return [];
  }

  const currentRound = getCurrentRound(tournament);
  if (!currentRound || currentRound > 4) {
    console.log('[Golf] Could not determine current round.');
    return [];
  }

  // Check if we already posted golf picks for this tournament + round today
  const existing = await aiPicksDb.getTodaysGolfPicks(guildId);
  if (existing.length > 0) {
    console.log(`[Golf] Already have ${existing.length} golf picks for today, skipping.`);
    return existing;
  }

  // Build player info for GPT-4o
  const topPlayers = tournament.competitors.slice(0, 60);
  const playerData = topPlayers.map(p => {
    const roundScores = p.rounds.map(r => `R${r.round}: ${r.score}`).join(', ');
    return {
      name: p.name,
      country: p.country,
      totalScore: p.totalScore,
      roundScores: roundScores || 'No scores yet',
    };
  });

  const prompt = `You are an elite golf handicapper AI analyzing the ${tournament.name} for Round ${currentRound} player round totals (over/under on a player's 18-hole score for this round).

Tournament: ${tournament.name}
Round: ${currentRound} of 4
Status: ${tournament.statusDetail}

Current field (top 60 by leaderboard position):
${JSON.stringify(playerData, null, 2)}

Analyze the field and generate exactly 4 round total over/under picks for Round ${currentRound}. Consider:
- Player's current form and momentum this tournament
- Historical scoring trends on this course
- Course difficulty and typical scoring average
- Player style fit (bombers vs accuracy players, etc.)
- Weather-related scoring tendencies
- Previous round scores as form indicators
- Cut line pressure (Round 2) or Sunday pressure (Round 4)

For each pick, set a realistic round total line (usually between 67.5 and 72.5 depending on course).

Return a JSON array with exactly 4 picks, ranked by confidence (highest first):
[
  {
    "playerName": "<exact player name from the data>",
    "line": <round total line, e.g. 69.5>,
    "direction": "Over" or "Under",
    "oddsAmerican": <odds between -130 and +100>,
    "confidence": <number 75-95>,
    "reasoning": "<2-3 sentences explaining the pick. Be specific about player form, course fit, and scoring trends.>"
  }
]

IMPORTANT: Return ONLY valid JSON array. No markdown, no explanation outside the JSON.`;

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
        max_tokens: 1200,
      }),
    });

    const oaiData = await oaiRes.json();
    if (oaiData.error) {
      console.error('[Golf] OpenAI error:', oaiData.error);
      return [];
    }

    const content = oaiData.choices?.[0]?.message?.content?.trim();
    if (!content) {
      console.error('[Golf] Empty OpenAI response');
      return [];
    }

    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const picks = JSON.parse(jsonStr);

    if (!Array.isArray(picks) || picks.length === 0) {
      console.error('[Golf] Invalid picks format');
      return [];
    }

    // Get current golf record
    const record = await aiPicksDb.getGolfRecord(guildId);

    // Create DB records and post each pick as individual card
    const postedPicks = [];
    for (let i = 0; i < picks.length; i++) {
      const p = picks[i];
      const aiPick = await aiPicksDb.createAiPick({
        guild_id: guildId,
        channel_id: GOLF_CHANNEL_ID,
        sport: 'golf_pga',
        bet_category: 'player_prop',
        wager_type: 'prop',
        pick: `${p.playerName} ${p.direction} ${p.line}`,
        team_a: null,
        team_b: null,
        player_name: p.playerName,
        prop_description: `Round ${currentRound} Total Strokes`,
        spread_value: p.line,
        over_under: p.direction,
        odds_american: p.oddsAmerican,
        reasoning: p.reasoning,
        confidence: p.confidence,
        espn_game_id: tournament.eventId,
        espn_sport: 'golf_pga',
        event_start_time: tournament.startDate,
        record_wins: record.wins,
        record_losses: record.losses,
        record_pushes: record.pushes,
        record_units: 0,
        streak: 0,
        pick_type: 'golf_round',
        tournament_name: tournament.name,
        round_number: currentRound,
      });

      await postGolfPickToDiscord(client, aiPick, guildId, i + 1, picks.length, record);
      postedPicks.push(aiPick);
    }

    console.log(`[Golf] Generated ${postedPicks.length} round ${currentRound} picks for ${tournament.name}`);
    return postedPicks;
  } catch (err) {
    console.error('[Golf] Generation error:', err);
    return [];
  }
}

// ── Discord Posting ──

/**
 * Post a single golf pick card to Discord with Tail/Fade buttons
 */
async function postGolfPickToDiscord(client, aiPick, guildId, pickNum, totalPicks, record) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');

  try {
    const channel = await client.channels.fetch(GOLF_CHANNEL_ID);
    if (!channel) {
      console.error('[Golf] Channel not found:', GOLF_CHANNEL_ID);
      return null;
    }

    // Generate card image
    const imgBuffer = await generateGolfPickCardImage(aiPick, record, pickNum, totalPicks);
    const attachment = new AttachmentBuilder(imgBuffer, { name: `golf-pick-${pickNum}.png` });

    // Tail/Fade buttons (reuse existing aipick_ prefix for compatibility)
    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`aipick_tail_${aiPick.id}`)
        .setLabel('⛳ Tail (0)')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`aipick_fade_${aiPick.id}`)
        .setLabel('Fade (0)')
        .setStyle(ButtonStyle.Danger),
    );

    // Role ping on first pick only
    let content = `⛳ **GOLF ROUND TOTAL** — Pick ${pickNum}/${totalPicks}`;
    if (pickNum === 1) {
      const guild = client.guilds.cache.get(guildId);
      if (guild) {
        let role = guild.roles.cache.find(r => r.name === 'AI Picks');
        if (role) content = `${role} ${content}`;
      }
    }

    const message = await channel.send({
      content,
      files: [attachment],
      components: [buttonRow],
    });

    await aiPicksDb.updateAiPickMessage(aiPick.id, message.id);
    console.log(`[Golf] Posted pick ${pickNum}/${totalPicks}: ${aiPick.pick}`);
    return message;
  } catch (err) {
    console.error('[Golf] Discord post error:', err);
    return null;
  }
}

// ── Auto-Close Golf Picks ──

/**
 * Check if golf round picks should be closed based on ESPN round scores
 */
async function autoCloseGolfPicks(client) {
  const pending = await aiPicksDb.getPendingGolfPicks();
  if (pending.length === 0) return;

  // Group by tournament event ID
  const byEvent = {};
  for (const pick of pending) {
    const key = pick.espn_game_id || 'unknown';
    if (!byEvent[key]) byEvent[key] = [];
    byEvent[key].push(pick);
  }

  for (const [eventId, picks] of Object.entries(byEvent)) {
    try {
      const tournament = await fetchGolfScoreboard();
      if (!tournament || tournament.eventId !== eventId) continue;

      for (const pick of picks) {
        const roundNum = pick.round_number;
        const playerName = pick.player_name;

        // Find the player in the tournament data
        const player = tournament.competitors.find(p =>
          p.name.toLowerCase() === playerName.toLowerCase() ||
          p.displayName.toLowerCase() === playerName.toLowerCase()
        );

        if (!player) continue;

        // Check if this round is complete for this player
        const roundData = player.rounds.find(r => r.round === roundNum);
        if (!roundData || !roundData.score) continue;

        // Round is complete — resolve the pick
        const actualScore = roundData.score;
        const line = parseFloat(pick.spread_value);
        const isOver = (pick.over_under || '').toLowerCase() === 'over';

        let status, note;
        if (isOver) {
          if (actualScore > line) {
            status = 'win';
            note = `${playerName} shot ${actualScore} (Over ${line}) ✅`;
          } else if (actualScore < line) {
            status = 'loss';
            note = `${playerName} shot ${actualScore} (Over ${line}) ❌`;
          } else {
            status = 'push';
            note = `${playerName} shot ${actualScore} = ${line}`;
          }
        } else {
          if (actualScore < line) {
            status = 'win';
            note = `${playerName} shot ${actualScore} (Under ${line}) ✅`;
          } else if (actualScore > line) {
            status = 'loss';
            note = `${playerName} shot ${actualScore} (Under ${line}) ❌`;
          } else {
            status = 'push';
            note = `${playerName} shot ${actualScore} = ${line}`;
          }
        }

        const closedPick = await aiPicksDb.closeAiPick(pick.id, status, note, `R${roundNum}: ${actualScore}`);
        await postGolfResultToDiscord(client, closedPick, pick.guild_id);
        console.log(`[Golf] Auto-closed: ${playerName} R${roundNum} ${actualScore} → ${status}`);
      }
    } catch (err) {
      console.error(`[Golf] Auto-close error for event ${eventId}:`, err.message);
    }
  }
}

/**
 * Post result card for a closed golf pick
 */
async function postGolfResultToDiscord(client, closedPick, guildId) {
  const { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

  try {
    const channel = await client.channels.fetch(GOLF_CHANNEL_ID);
    if (!channel) return;

    const record = await aiPicksDb.getGolfRecord(guildId);
    const imgBuffer = await generateGolfRecapImage(closedPick, record);
    const attachment = new AttachmentBuilder(imgBuffer, { name: 'golf-result.png' });

    const emoji = closedPick.status === 'win' ? '✅' : closedPick.status === 'loss' ? '❌' : '🔄';
    const statusText = closedPick.status === 'win' ? 'WIN' : closedPick.status === 'loss' ? 'LOSS' : 'PUSH';

    // Delete the open slip message from AI Open Slips (open slips only — no results there)
    if (closedPick.message_id) {
      try {
        const origMsg = await channel.messages.fetch(closedPick.message_id);
        await origMsg.delete();
        console.log(`[Golf] Deleted closed pick message ${closedPick.message_id} from AI Open Slips`);
      } catch (e) {
        console.error('[Golf] Failed to delete original message:', e.message);
      }
    }
  } catch (err) {
    console.error('[Golf] Result post error:', err);
  }
}

// ── Round Recap ──

/**
 * Post evening round recap after all picks for a round are closed
 */
async function postRoundRecap(client, guildId) {
  const { AttachmentBuilder } = require('discord.js');

  try {
    const tournament = await fetchGolfScoreboard();
    if (!tournament) return;

    // Get today's closed golf picks
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const todayPicks = await aiPicksDb.getGolfPicksByDate(guildId, today);

    // Only post recap if all of today's picks are closed
    const pendingToday = todayPicks.filter(p => p.status === 'pending');
    if (pendingToday.length > 0 || todayPicks.length === 0) return;

    // Check if we already posted a recap today (avoid duplicates)
    const closedToday = todayPicks.filter(p => p.status !== 'pending');
    if (closedToday.length === 0) return;

    const wins = closedToday.filter(p => p.status === 'win').length;
    const losses = closedToday.filter(p => p.status === 'loss').length;
    const pushes = closedToday.filter(p => p.status === 'push').length;

    const record = await aiPicksDb.getGolfRecord(guildId);

    const channel = await client.channels.fetch(GOLF_CHANNEL_ID);
    if (!channel) return;

    const imgBuffer = await generateGolfTournamentRecapImage(closedToday, tournament, record);
    const attachment = new AttachmentBuilder(imgBuffer, { name: 'golf-round-recap.png' });

    const roundNum = closedToday[0]?.round_number || '?';

    await channel.send({
      content: `📊 **ROUND ${roundNum} RECAP — ${tournament.name}** 📊\n\n⛳ Today: **${wins}-${losses}-${pushes}**\n📈 Overall Golf Record: **${record.wins}-${record.losses}-${record.pushes}**`,
      files: [attachment],
    });

    console.log(`[Golf] Posted round ${roundNum} recap: ${wins}-${losses}-${pushes}`);
  } catch (err) {
    console.error('[Golf] Round recap error:', err);
  }
}

module.exports = {
  GOLF_CHANNEL_ID,
  fetchGolfScoreboard,
  getCurrentRound,
  isTournamentDay,
  generateGolfPicks,
  autoCloseGolfPicks,
  postRoundRecap,
};
