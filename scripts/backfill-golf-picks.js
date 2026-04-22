/**
 * Backfill ESPN IDs on pending golf_round AI picks that are missing them,
 * then auto-resolve any rounds that are already complete.
 *
 * Usage: node scripts/backfill-golf-picks.js
 */
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Lightweight Discord client for posting result cards
const discordClient = new Client({ intents: [GatewayIntentBits.Guilds] });
let discordReady = false;
discordClient.once('ready', () => {
  discordReady = true;
  console.log(`Discord client ready as ${discordClient.user.tag}`);
});
discordClient.login(process.env.DISCORD_TOKEN).catch(e => console.warn('[Discord] Login failed:', e.message));

async function waitForDiscord(ms = 8000) {
  if (discordReady) return;
  const start = Date.now();
  while (!discordReady && Date.now() - start < ms) {
    await new Promise(r => setTimeout(r, 200));
  }
}

// ── ESPN Helpers ──────────────────────────────────────────────────────────────

async function fetchGolfScoreboard(dates) {
  const url = dates
    ? `https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates=${dates}`
    : `https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard`;
  const res = await fetch(url);
  if (!res.ok) return [];
  return (await res.json()).events || [];
}

/**
 * Given a tournament name and an approximate date (YYYY-MM-DD), look across
 * a ±5 day window + no-date fallback to find the ESPN event.
 */
async function findEspnEvent(tournamentName, approxDate) {
  const tNorm = (tournamentName || '').toLowerCase().replace(/[^a-z ]/g, '').trim();

  const datesToTry = [];
  if (approxDate) {
    // Try the 5-day window centred on the approximate date (covers multi-round tournaments)
    for (let offset = -2; offset <= 5; offset++) {
      const d = new Date(approxDate + 'T12:00:00Z'); // noon UTC — avoids timezone edge
      d.setUTCDate(d.getUTCDate() + offset);
      datesToTry.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
    }
  }
  datesToTry.push(null); // no-date = current/recent tournament

  for (const ds of datesToTry) {
    const events = await fetchGolfScoreboard(ds);
    if (!events.length) continue;

    let match = null;
    if (tNorm) {
      match = events.find(e => {
        const eName = (e.name || '').toLowerCase().replace(/[^a-z ]/g, '').trim();
        return eName.includes(tNorm) || tNorm.includes(eName);
      });
    }
    if (!match && !tNorm) match = events[0];
    if (match) return match;
  }
  return null;
}

// ── Result resolution ─────────────────────────────────────────────────────────

function resolveGolfPick(pick, event) {
  const roundNum = pick.round_number || 1;
  const rIdx = roundNum - 1;
  const competitors = event.competitions?.[0]?.competitors || [];

  // Require 80% of field to have a score
  const withScore = competitors.filter(c => c.linescores?.[rIdx]?.value != null).length;
  if (withScore < Math.max(1, Math.floor(competitors.length * 0.8))) return null; // not complete

  // Build score map
  const scoreMap = new Map();
  for (const c of competitors) {
    const name = (c.athlete?.displayName || '').toLowerCase().replace(/[^a-z ]/g, '').trim();
    const score = c.linescores?.[rIdx]?.value ?? null;
    if (name && score != null) scoreMap.set(name, score);
  }

  const desc = (pick.prop_description || '').toLowerCase();
  const m = desc.match(/(?:round\s*\d+\s+)?score\s+(over|under)\s+([\d.]+)/i);
  if (!m) return null;
  const side = m[1].toLowerCase();
  const line = parseFloat(m[2]);

  const normName = (pick.player_name || '').toLowerCase().replace(/[^a-z ]/g, '').trim();
  let playerScore = scoreMap.get(normName) ?? null;
  if (playerScore == null) {
    for (const [k, v] of scoreMap) {
      if (k.includes(normName) || normName.includes(k)) { playerScore = v; break; }
    }
  }
  if (playerScore == null) return null;

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
  return { status, note, playerScore };
}

async function postResultCard(pick, status, note, playerScore) {
  try {
    await waitForDiscord(5000);
    if (!discordReady) { console.warn('  [discord] Not ready — skipping result card'); return; }

    const { AttachmentBuilder: AB, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const { generateAiRecordImage } = require('../src/utils/aiPickCardImage');

    const channelId = pick.channel_id || process.env.GOLF_CHANNEL_ID;
    if (!channelId) { console.warn('  [discord] No channel ID for result card'); return; }

    const channel = await discordClient.channels.fetch(channelId);
    if (!channel) return;

    const emoji = status === 'win' ? '✅' : status === 'loss' ? '❌' : '🔄';
    const statusText = status === 'win' ? 'WIN' : status === 'loss' ? 'LOSS' : 'PUSH';

    // Fetch latest record for the guild
    const { data: wins } = await supabase.from('ai_picks').select('id').eq('guild_id', pick.guild_id).eq('pick_type', 'golf_round').eq('status', 'win');
    const { data: losses } = await supabase.from('ai_picks').select('id').eq('guild_id', pick.guild_id).eq('pick_type', 'golf_round').eq('status', 'loss');
    const record = { wins: wins?.length || 0, losses: losses?.length || 0, pushes: 0 };

    const content = `${emoji} **GOLF PICK RESULT: ${statusText}** ${emoji}\n${note}\n⛳ Golf Record: **${record.wins}-${record.losses}**`;

    // Disable buttons on the original pick message
    if (pick.message_id) {
      try {
        const origMsg = await channel.messages.fetch(pick.message_id);
        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`aipick_tail_${pick.id}`)
            .setLabel(`🔒 Tail (${pick.tail_count || 0})`)
            .setStyle(ButtonStyle.Success)
            .setDisabled(true),
          new ButtonBuilder()
            .setCustomId(`aipick_fade_${pick.id}`)
            .setLabel(`Fade (${pick.fade_count || 0})`)
            .setStyle(ButtonStyle.Danger)
            .setDisabled(true),
        );
        await origMsg.edit({ components: [disabledRow] });
      } catch (e) {
        console.warn(`  [discord] Could not disable buttons: ${e.message}`);
      }
    }

    await channel.send({ content });
    console.log(`  [discord] Posted result card for pick ${pick.id}: ${status}`);
  } catch (e) {
    console.warn(`  [discord] Result card error: ${e.message}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Golf Pick Backfill — ESPN IDs + Auto-Resolve ===\n');

  // Fetch all pending golf_round picks
  const { data: picks, error } = await supabase
    .from('ai_picks')
    .select('*')
    .eq('pick_type', 'golf_round')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) { console.error('Supabase error:', error); process.exit(1); }
  if (!picks.length) { console.log('No pending golf_round picks found.'); process.exit(0); }

  console.log(`Found ${picks.length} pending golf_round picks\n`);

  // Group by tournament_name + round_number to minimise ESPN API calls
  const groups = new Map();
  for (const pick of picks) {
    const key = `${pick.tournament_name || 'unknown'}__R${pick.round_number || 1}`;
    if (!groups.has(key)) {
      groups.set(key, {
        tournamentName: pick.tournament_name,
        roundNum: pick.round_number || 1,
        approxDate: pick.pick_date || pick.created_at?.slice(0, 10) || null,
        espnIdFromDB: pick.espn_game_id || null,
        picks: [],
      });
    }
    groups.get(key).picks.push(pick);
  }

  for (const [groupKey, group] of groups) {
    const { tournamentName, roundNum, approxDate, espnIdFromDB, picks: groupPicks } = group;
    console.log(`\n── ${groupKey} (${groupPicks.length} picks) ──`);

    // Find ESPN event
    let event = null;
    if (espnIdFromDB) {
      // Try to find by ID first (fastest)
      const events = await fetchGolfScoreboard(null);
      event = events.find(e => e.id === espnIdFromDB) || null;
      if (!event) {
        // ID not in current scoreboard — search by date + name
        event = await findEspnEvent(tournamentName, approxDate);
        if (event && event.id !== espnIdFromDB) {
          console.log(`  Found event by name (ID mismatch — using found ID: ${event.id})`);
        }
      }
    } else {
      event = await findEspnEvent(tournamentName, approxDate);
    }

    if (!event) {
      console.log(`  ⚠ Could not find ESPN event for "${tournamentName}" — skipping`);
      continue;
    }

    const resolvedId = event.id;
    console.log(`  ESPN event: "${event.name}" (ID: ${resolvedId})`);

    // Back-fill espn_game_id on picks that are missing it
    const needsId = groupPicks.filter(p => !p.espn_game_id);
    if (needsId.length) {
      const ids = needsId.map(p => p.id);
      const { error: uErr } = await supabase
        .from('ai_picks')
        .update({ espn_game_id: resolvedId })
        .in('id', ids);
      if (uErr) console.warn(`  Error updating ESP IDs: ${uErr.message}`);
      else console.log(`  ✓ Set espn_game_id=${resolvedId} on ${ids.length} picks`);
      // Also update local pick objects so resolve step sees the ID
      for (const p of needsId) p.espn_game_id = resolvedId;
    }

    // Try to resolve each pick
    let resolved = 0, skipped = 0;
    for (const pick of groupPicks) {
      const result = resolveGolfPick(pick, event);
      if (!result) { skipped++; continue; }

      const { status, note, playerScore } = result;

      // Close in DB
      const { error: cErr } = await supabase
        .from('ai_picks')
        .update({
          status,
          result_note: note,
          final_score: `R${roundNum}: ${playerScore}`,
          closed_at: new Date().toISOString(),
        })
        .eq('id', pick.id);

      if (cErr) {
        console.warn(`  Error closing pick ${pick.id}: ${cErr.message}`);
        continue;
      }

      console.log(`  ✓ ${pick.player_name} — ${status.toUpperCase()} (shot ${playerScore}, line ${(pick.prop_description || '').match(/([\d.]+)$/)?.[1] || '?'})`);
      resolved++;

      // Post result card to Discord
      await postResultCard(pick, status, note, playerScore);
      await new Promise(r => setTimeout(r, 800)); // rate limit
    }

    console.log(`  → Resolved: ${resolved}, Skipped (incomplete/not found): ${skipped}`);
  }

  console.log('\n=== Done ===');
  discordClient.destroy();
}

main().catch(err => {
  console.error('Fatal:', err);
  discordClient.destroy();
  process.exit(1);
});
