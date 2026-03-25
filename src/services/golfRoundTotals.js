/**
 * Golf H2H Matchup Picks Service
 * Fetches real DraftKings/FanDuel tournament matchup odds from odds-api.io,
 * analyzes with GPT-4o + ESPN form data, and posts best-value H2H picks.
 * Schedule: Wednesday morning (picks), Sunday evening (close + recap).
 */
const aiPicksDb = require('../database/aiPicks');
const { generateGolfPickCardImage, generateGolfRecapImage, generateGolfTournamentRecapImage } = require('../utils/golfPickCardImage');

const GOLF_CHANNEL_ID = '1485903920906895370'; // AI Open Slips
const AI_PICKS_CHANNEL_ID = '1483720217044713674'; // AI Picks (main)
const ODDS_API_BASE = 'https://api.odds-api.io/v3';
const BOOKMAKERS = 'DraftKings,FanDuel';

// ── Odds API Helpers ──

/**
 * Fetch golf events from odds-api.io and find the current PGA Tour tournament matchups
 */
async function fetchGolfMatchups() {
  const apiKey = process.env.ODDS_API_IO_KEY;
  if (!apiKey) { console.error('[Golf] ODDS_API_IO_KEY not set'); return null; }

  try {
    const res = await fetch(`${ODDS_API_BASE}/events?sport=golf&apiKey=${apiKey}`);
    if (!res.ok) throw new Error(`odds-api.io events ${res.status}`);
    const events = await res.json();

    // Find PGA tournament matchup leagues (exclude TGL, non-PGA)
    const matchupEvents = events.filter(e =>
      e.league?.slug?.includes('tournament') &&
      e.league?.slug?.includes('matchup') &&
      e.status === 'pending'
    );

    if (matchupEvents.length === 0) {
      console.log('[Golf] No pending tournament matchup events found.');
      return null;
    }

    // Group by league (tournament)
    const byLeague = {};
    for (const e of matchupEvents) {
      const slug = e.league.slug;
      if (!byLeague[slug]) byLeague[slug] = { name: e.league.name, slug, events: [] };
      byLeague[slug].events.push(e);
    }

    // Prefer PGA/US tour over European/Asian tours
    const pgaKeywords = ['houston', 'masters', 'open', 'pga', 'players', 'memorial', 'us-open', 'genesis', 'arnold', 'waste', 'phoenix', 'at-t', 'rbc', 'traveler', 'john-deere', 'rocket', 'wyndham', 'fedex', 'tour-championship', 'sentry', 'sony', 'farmers', 'american-express'];
    let bestLeague = null;
    for (const [slug, league] of Object.entries(byLeague)) {
      if (pgaKeywords.some(kw => slug.toLowerCase().includes(kw))) {
        bestLeague = league;
        break;
      }
    }
    // Fallback to whichever league has the most events
    if (!bestLeague) {
      bestLeague = Object.values(byLeague).sort((a, b) => b.events.length - a.events.length)[0];
    }

    // Extract tournament name from league name (remove " - Tournament Matchup" suffix)
    const tournamentName = bestLeague.name.replace(/\s*-\s*Tournament[s]?\s*Matchup[s]?$/i, '').trim();

    return {
      tournamentName,
      leagueSlug: bestLeague.slug,
      matchups: bestLeague.events,
    };
  } catch (err) {
    console.error('[Golf] fetchGolfMatchups error:', err.message);
    return null;
  }
}

/**
 * Fetch DraftKings/FanDuel odds for up to 10 matchups at once via multi endpoint
 */
async function fetchMatchupOdds(eventIds) {
  const apiKey = process.env.ODDS_API_IO_KEY;
  if (!apiKey) return [];

  try {
    const batches = [];
    for (let i = 0; i < eventIds.length; i += 10) {
      batches.push(eventIds.slice(i, i + 10));
    }

    const allOdds = [];
    for (const batch of batches) {
      const ids = batch.join(',');
      const res = await fetch(
        `${ODDS_API_BASE}/odds/multi?apiKey=${apiKey}&eventIds=${ids}&bookmakers=${BOOKMAKERS}`
      );
      if (!res.ok) {
        console.error(`[Golf] odds/multi ${res.status}`);
        continue;
      }
      const data = await res.json();
      if (Array.isArray(data)) allOdds.push(...data);
    }

    return allOdds;
  } catch (err) {
    console.error('[Golf] fetchMatchupOdds error:', err.message);
    return [];
  }
}

/**
 * Fetch ESPN scoreboard for player form context
 */
async function fetchEspnGolfForm() {
  try {
    const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard');
    if (!res.ok) return null;
    const json = await res.json();
    const event = json.events?.[0];
    if (!event) return null;
    const comp = event.competitions?.[0];
    if (!comp) return null;
    return {
      name: event.name,
      players: (comp.competitors || []).map(p => ({
        name: p.athlete?.fullName || 'Unknown',
        rank: p.status?.position?.id || null,
        score: p.score,
        rounds: (p.linescores || []).map(r => `R${r.period}: ${r.value}`).join(', '),
      })),
    };
  } catch { return null; }
}

/**
 * Convert decimal odds to American odds
 */
function decimalToAmerican(dec) {
  const d = parseFloat(dec);
  if (!d || d <= 1) return '+100';
  if (d >= 2) return `+${Math.round((d - 1) * 100)}`;
  return `${Math.round(-100 / (d - 1))}`;
}

/**
 * Check if today is a golf pick day (Tuesday or Wednesday)
 * Matchup odds usually drop Tue-Wed before Thursday round 1
 */
function isGolfPickDay() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return now.getDay() === 3; // Wednesday only
}

/**
 * Check if today is Sunday (results day)
 */
function isSunday() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return now.getDay() === 0;
}

// ── GPT-4o Pick Generation ──

/**
 * Generate golf H2H matchup picks using real odds + GPT-4o analysis
 */
async function generateGolfPicks(client, guildId) {
  if (!isGolfPickDay()) {
    console.log('[Golf] Not a pick day (Tue/Wed), skipping.');
    return [];
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) { console.error('[Golf] OPENAI_API_KEY not set'); return []; }

  // Check if we already posted golf picks today
  const existing = await aiPicksDb.getTodaysGolfPicks(guildId);
  if (existing.length > 0) {
    console.log(`[Golf] Already have ${existing.length} golf picks for today, skipping.`);
    return existing;
  }

  // Fetch tournament matchups
  const tournament = await fetchGolfMatchups();
  if (!tournament || tournament.matchups.length === 0) {
    console.log('[Golf] No golf matchups available.');
    return [];
  }

  console.log(`[Golf] Found ${tournament.matchups.length} matchups for ${tournament.tournamentName}`);

  // Fetch odds for all matchups
  const eventIds = tournament.matchups.map(e => e.id);
  const oddsData = await fetchMatchupOdds(eventIds);

  // Filter to matchups that actually have odds
  const withOdds = oddsData.filter(o => o.bookmakers && Object.keys(o.bookmakers).length > 0);

  if (withOdds.length === 0) {
    console.log('[Golf] No matchup odds available yet from DK/FanDuel.');
    return [];
  }

  console.log(`[Golf] ${withOdds.length}/${tournament.matchups.length} matchups have DK/FanDuel odds`);

  // Build matchup data for GPT-4o
  const matchupsForGpt = withOdds.map(evt => {
    const odds = {};
    for (const [bk, markets] of Object.entries(evt.bookmakers)) {
      const ml = markets.find(m => m.name === 'ML');
      if (ml?.odds?.[0]) {
        odds[bk] = {
          home: decimalToAmerican(ml.odds[0].home),
          away: decimalToAmerican(ml.odds[0].away),
        };
      }
    }
    return {
      eventId: evt.id,
      playerA: evt.home,
      playerB: evt.away,
      eventDate: evt.date,
      odds,
    };
  });

  // Fetch ESPN form data for context
  const espnForm = await fetchEspnGolfForm();
  let formContext = '';
  if (espnForm) {
    const top30 = espnForm.players.slice(0, 30);
    formContext = `\n\nESPN Current Tournament Data (${espnForm.name}):\n${top30.map(p => `${p.name}: Rank ${p.rank || 'N/A'}, Score ${p.score || 'N/A'}, ${p.rounds || 'No rounds yet'}`).join('\n')}`;
  }

  const prompt = `You are an elite golf handicapper AI analyzing tournament head-to-head matchup bets for the ${tournament.tournamentName}.

These are REAL sportsbook odds from DraftKings and FanDuel. You are picking which golfer will finish higher in the overall tournament standings.

Available Matchups with Odds:
${JSON.stringify(matchupsForGpt, null, 2)}
${formContext}

Analyze the matchups and select exactly 3 best-value plays. Consider:
- Current form and recent tournament results
- Course history and fit (length, style)
- Odds value — where is the market mispriced?
- Player consistency vs volatility
- Historical head-to-head performance
- Injury/fatigue factors

For each pick, choose which player wins the matchup and note the best available odds.

Return a JSON array with exactly 3 picks, ranked by confidence (highest first):
[
  {
    "eventId": <event ID number>,
    "playerPick": "<exact name of the player you're picking to win>",
    "opponent": "<exact name of the other player>",
    "bookmaker": "<DraftKings or FanDuel — whichever has better odds>",
    "oddsDecimal": "<the decimal odds string for your pick from that bookmaker>",
    "oddsAmerican": <American odds integer>,
    "confidence": <number 70-95>,
    "reasoning": "<2-3 sentences. Be specific about form, course fit, and why this is value.>"
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
        max_tokens: 1500,
      }),
    });

    const oaiData = await oaiRes.json();
    if (oaiData.error) { console.error('[Golf] OpenAI error:', oaiData.error); return []; }

    const content = oaiData.choices?.[0]?.message?.content?.trim();
    if (!content) { console.error('[Golf] Empty OpenAI response'); return []; }

    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const picks = JSON.parse(jsonStr);

    if (!Array.isArray(picks) || picks.length === 0) {
      console.error('[Golf] Invalid picks format');
      return [];
    }

    const record = await aiPicksDb.getGolfRecord(guildId);
    const postedPicks = [];

    for (let i = 0; i < picks.length; i++) {
      const p = picks[i];
      const aiPick = await aiPicksDb.createAiPick({
        guild_id: guildId,
        channel_id: AI_PICKS_CHANNEL_ID,
        sport: 'golf_pga',
        bet_category: 'matchup',
        wager_type: 'moneyline',
        pick: `${p.playerPick} over ${p.opponent}`,
        team_a: p.playerPick,
        team_b: p.opponent,
        player_name: p.playerPick,
        prop_description: `Tournament Matchup \u2022 ${p.bookmaker}`,
        odds_american: p.oddsAmerican,
        reasoning: p.reasoning,
        confidence: p.confidence,
        espn_game_id: String(p.eventId),
        espn_sport: 'golf_pga',
        event_start_time: tournament.matchups.find(m => m.id === p.eventId)?.date || null,
        record_wins: record.wins,
        record_losses: record.losses,
        record_pushes: record.pushes,
        record_units: 0,
        streak: 0,
        pick_type: 'golf_matchup',
        tournament_name: tournament.tournamentName,
      });

      await postGolfPickToDiscord(client, aiPick, guildId, i + 1, picks.length, record);
      postedPicks.push(aiPick);
    }

    console.log(`[Golf] Generated ${postedPicks.length} H2H matchup picks for ${tournament.tournamentName}`);
    return postedPicks;
  } catch (err) {
    console.error('[Golf] Generation error:', err);
    return [];
  }
}

// ── Discord Posting ──

/**
 * Post a single golf H2H pick card to AI Picks channel + cross-post to AI Open Slips
 */
async function postGolfPickToDiscord(client, aiPick, guildId, pickNum, totalPicks, record) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');

  try {
    const channel = await client.channels.fetch(AI_PICKS_CHANNEL_ID);
    if (!channel) { console.error('[Golf] Channel not found:', AI_PICKS_CHANNEL_ID); return null; }

    const imgBuffer = await generateGolfPickCardImage(aiPick, record, pickNum, totalPicks);
    const attachment = new AttachmentBuilder(imgBuffer, { name: `golf-pick-${pickNum}.png` });

    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`aipick_tail_${aiPick.id}`)
        .setLabel('\u26f3 Tail (0)')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`aipick_fade_${aiPick.id}`)
        .setLabel('Fade (0)')
        .setStyle(ButtonStyle.Danger),
    );

    // Role ping on first pick only
    let content = `\u26f3 **GOLF H2H MATCHUP** \u2014 Pick ${pickNum}/${totalPicks}`;
    if (pickNum === 1) {
      const guild = client.guilds.cache.get(guildId);
      if (guild) {
        const role = guild.roles.cache.find(r => r.name === 'AI Picks');
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

    // Cross-post to AI Open Slips (no role ping)
    try {
      const slipsChannel = await client.channels.fetch(GOLF_CHANNEL_ID);
      if (slipsChannel) {
        const mirrorImg = new AttachmentBuilder(imgBuffer, { name: `golf-pick-${pickNum}.png` });
        const mirrorRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`aipick_tail_${aiPick.id}`)
            .setLabel('\u26f3 Tail (0)')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`aipick_fade_${aiPick.id}`)
            .setLabel('Fade (0)')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setLabel('Comment')
            .setStyle(ButtonStyle.Link)
            .setURL(`https://discord.com/channels/${guildId}/${AI_PICKS_CHANNEL_ID}/${message.id}`),
        );
        const mirrorMsg = await slipsChannel.send({
          content: `\u26f3 **GOLF H2H MATCHUP** \u2014 Pick ${pickNum}/${totalPicks}`,
          files: [mirrorImg],
          components: [mirrorRow],
        });
        await aiPicksDb.updateAiPickMirrorMessage(aiPick.id, mirrorMsg.id, GOLF_CHANNEL_ID);
        console.log(`[Golf] Cross-posted pick ${aiPick.id} to AI Open Slips`);
      }
    } catch (e) {
      console.error('[Golf] Cross-post error:', e.message);
    }

    return message;
  } catch (err) {
    console.error('[Golf] Discord post error:', err);
    return null;
  }
}

// ── Auto-Close Golf Matchup Picks ──

/**
 * Check matchup results via odds-api.io event status
 */
async function autoCloseGolfPicks(client) {
  const pending = await aiPicksDb.getPendingGolfPicks();
  if (pending.length === 0) return;

  const apiKey = process.env.ODDS_API_IO_KEY;
  if (!apiKey) return;

  try {
    const res = await fetch(`${ODDS_API_BASE}/events?sport=golf&apiKey=${apiKey}`);
    if (!res.ok) return;
    const allEvents = await res.json();

    const eventMap = {};
    for (const e of allEvents) eventMap[String(e.id)] = e;

    for (const pick of pending) {
      const evt = eventMap[pick.espn_game_id];
      if (!evt) continue;
      if (evt.status !== 'settled') continue;

      const homeScore = evt.scores?.home;
      const awayScore = evt.scores?.away;
      const playerPick = pick.player_name;
      const isPickHome = evt.home?.toLowerCase() === playerPick?.toLowerCase();

      let status, note;

      if (homeScore !== null && awayScore !== null && (homeScore > 0 || awayScore > 0)) {
        const pickScore = isPickHome ? homeScore : awayScore;
        const oppScore = isPickHome ? awayScore : homeScore;
        const opponent = isPickHome ? evt.away : evt.home;

        if (pickScore > oppScore) {
          status = 'win';
          note = `${playerPick} beat ${opponent} \u2705`;
        } else if (pickScore < oppScore) {
          status = 'loss';
          note = `${playerPick} lost to ${opponent} \u274c`;
        } else {
          status = 'push';
          note = `${playerPick} tied ${opponent} \ud83d\udd04`;
        }
      } else {
        continue;
      }

      const closedPick = await aiPicksDb.closeAiPick(pick.id, status, note, `${evt.home} vs ${evt.away}`);
      await postGolfResultToDiscord(client, closedPick, pick.guild_id);
      console.log(`[Golf] Auto-closed: ${pick.pick} \u2192 ${status}`);
    }
  } catch (err) {
    console.error('[Golf] Auto-close error:', err.message);
  }
}

/**
 * Handle a closed golf pick — delete mirror from AI Open Slips, post result to AI Picks
 */
async function postGolfResultToDiscord(client, closedPick, guildId) {
  const { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

  try {
    // Delete mirror from AI Open Slips (open slips only — no results)
    if (closedPick.mirror_message_id && closedPick.mirror_channel_id) {
      try {
        const slipsCh = await client.channels.fetch(closedPick.mirror_channel_id);
        const mirrorMsg = await slipsCh.messages.fetch(closedPick.mirror_message_id);
        await mirrorMsg.delete();
        console.log(`[Golf] Deleted mirror ${closedPick.mirror_message_id} from AI Open Slips`);
      } catch (e) {
        console.error('[Golf] Failed to delete mirror:', e.message);
      }
    }

    // Post result card to AI Picks channel
    const channel = await client.channels.fetch(AI_PICKS_CHANNEL_ID);
    if (!channel) return;

    const record = await aiPicksDb.getGolfRecord(guildId);
    const imgBuffer = await generateGolfRecapImage(closedPick, record);
    const attachment = new AttachmentBuilder(imgBuffer, { name: 'golf-result.png' });

    const emoji = closedPick.status === 'win' ? '\u2705' : closedPick.status === 'loss' ? '\u274c' : '\ud83d\udd04';
    const statusText = closedPick.status === 'win' ? 'WIN' : closedPick.status === 'loss' ? 'LOSS' : 'PUSH';

    await channel.send({
      content: `${emoji} **GOLF H2H RESULT: ${statusText}** \u2014 ${closedPick.pick}`,
      files: [attachment],
    });

    // Disable buttons on original message in AI Picks
    if (closedPick.message_id) {
      try {
        const origMsg = await channel.messages.fetch(closedPick.message_id);
        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`aipick_tail_${closedPick.id}`)
            .setLabel(`\u26f3 Tail (${closedPick.tail_count || 0})`)
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
        console.error('[Golf] Failed to disable buttons:', e.message);
      }
    }
  } catch (err) {
    console.error('[Golf] Result post error:', err);
  }
}

// ── Sunday Recap ──

/**
 * Post tournament recap on Sunday evening after all matchup picks are closed
 */
async function postWeeklyRecap(client, guildId) {
  const { AttachmentBuilder } = require('discord.js');

  try {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekStr = weekAgo.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

    const allPicks = await aiPicksDb.getGolfPicksSince(guildId, weekStr);
    if (allPicks.length === 0) return;

    const pendingPicks = allPicks.filter(p => p.status === 'pending');
    if (pendingPicks.length > 0) return;

    const closedPicks = allPicks.filter(p => p.status !== 'pending');
    if (closedPicks.length === 0) return;

    const wins = closedPicks.filter(p => p.status === 'win').length;
    const losses = closedPicks.filter(p => p.status === 'loss').length;
    const pushes = closedPicks.filter(p => p.status === 'push').length;

    const record = await aiPicksDb.getGolfRecord(guildId);
    const tournamentName = closedPicks[0]?.tournament_name || 'PGA Tournament';

    const channel = await client.channels.fetch(AI_PICKS_CHANNEL_ID);
    if (!channel) return;

    const imgBuffer = await generateGolfTournamentRecapImage(closedPicks, tournamentName, record);
    const attachment = new AttachmentBuilder(imgBuffer, { name: 'golf-week-recap.png' });

    await channel.send({
      content: `\ud83d\udcca **GOLF WEEKLY RECAP \u2014 ${tournamentName}** \ud83d\udcca\n\n\u26f3 This Week: **${wins}-${losses}-${pushes}**\n\ud83d\udcc8 Overall Golf Record: **${record.wins}-${record.losses}-${record.pushes}**`,
      files: [attachment],
    });

    console.log(`[Golf] Posted weekly recap: ${wins}-${losses}-${pushes}`);
  } catch (err) {
    console.error('[Golf] Weekly recap error:', err);
  }
}

module.exports = {
  GOLF_CHANNEL_ID,
  AI_PICKS_CHANNEL_ID,
  isGolfPickDay,
  isSunday,
  generateGolfPicks,
  autoCloseGolfPicks,
  postWeeklyRecap,
};
