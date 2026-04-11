/**
 * One-shot script: Backfill missing ESPN game IDs + regenerate Discord card images
 * 
 * Usage: node scripts/refresh-bet-images.js [slip_number]
 *   - With slip: refreshes just that bet
 *   - Without slip: refreshes ALL open bets missing ESPN game IDs
 */
require('dotenv').config();
const { resolveGameId } = require('../src/services/espn');
const { generateBetCardImage } = require('../src/utils/betCardImage');
const { supabase: supa } = require('../src/config/supabase');
const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');

async function main() {
  const slipArg = process.argv[2]; // optional slip number filter

  // ── Fetch bets ──
  let query = supa.from('bets').select('*, parlay_legs(*)').eq('status', 'open');
  if (slipArg) {
    query = query.eq('slip_number', slipArg);
  } else {
    query = query.is('espn_game_id', null).neq('bet_type', 'parlay');
  }
  const { data: bets, error } = await query;
  if (error) { console.error('DB error:', error.message); process.exit(1); }

  // Also get parlays with legs missing ESPN IDs (if no slip filter)
  let parlayBets = [];
  if (!slipArg) {
    const { data: pBets } = await supa
      .from('bets')
      .select('*, parlay_legs(*)')
      .eq('status', 'open')
      .eq('bet_type', 'parlay');
    parlayBets = (pBets || []).filter(b =>
      b.parlay_legs?.some(l => !l.espn_game_id)
    );
  }

  const allBets = slipArg ? bets : [...(bets || []), ...parlayBets];
  console.log(`Found ${allBets.length} bet(s) to process`);
  if (allBets.length === 0) { process.exit(0); }

  // ── Init Discord client ──
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(process.env.DISCORD_TOKEN);
  console.log('Discord logged in');

  for (const bet of allBets) {
    try {
      console.log(`\n── ${bet.slip_number} (${bet.sport}, ${bet.bet_type}) ──`);

      let updated = false;

      if (bet.bet_type !== 'parlay') {
        // Single bet — resolve ESPN game ID if missing
        if (!bet.espn_game_id) {
          const result = await resolveGameId(bet.sport, bet.team_a, bet.team_b, bet.event_start_time);
          const gameId = result?.gameId || null;
          if (gameId) {
            await supa.from('bets').update({ espn_game_id: gameId }).eq('id', bet.id);
            bet.espn_game_id = gameId;
            console.log(`  Assigned ESPN ID: ${gameId}`);
            updated = true;
          } else {
            console.log('  Could not resolve ESPN game ID');
          }
        } else {
          console.log(`  Already has ESPN ID: ${bet.espn_game_id}`);
        }
      } else {
        // Parlay — resolve legs
        for (const leg of (bet.parlay_legs || [])) {
          if (!leg.espn_game_id) {
            const result = await resolveGameId(leg.sport, leg.team_a, leg.team_b, leg.event_start_time);
            const gameId = result?.gameId || null;
            if (gameId) {
              await supa.from('parlay_legs').update({ espn_game_id: gameId }).eq('id', leg.id);
              leg.espn_game_id = gameId;
              console.log(`  Leg ${leg.id}: ESPN ID ${gameId}`);
              updated = true;
            }
          }
        }
      }

      // ── Regenerate Discord card image ──
      if (bet.message_id && bet.channel_id) {
        const guild = client.guilds.cache.get(bet.guild_id) || await client.guilds.fetch(bet.guild_id).catch(() => null);
        let displayName = bet.discord_id;
        if (guild) {
          const member = await guild.members.fetch(bet.discord_id).catch(() => null);
          displayName = member?.displayName || bet.discord_id;
        }
        const avatar = (await client.users.fetch(bet.discord_id).catch(() => null))?.displayAvatarURL() || '';

        // Refetch bet to get updated ESPN IDs
        const { data: freshBet } = await supa.from('bets').select('*, parlay_legs(*)').eq('id', bet.id).single();
        const imgBuffer = await generateBetCardImage(freshBet, displayName, avatar);
        const attachment = new AttachmentBuilder(imgBuffer, { name: 'bet-card.png' });

        const channel = await client.channels.fetch(bet.channel_id).catch(() => null);
        if (channel) {
          const msg = await channel.messages.fetch(bet.message_id).catch(() => null);
          if (msg) {
            await msg.edit({ files: [attachment] });
            console.log(`  ✅ Discord image updated`);
          } else {
            console.log('  ⚠️  Message not found');
          }
        } else {
          console.log('  ⚠️  Channel not found');
        }
      } else {
        console.log('  No message_id/channel_id — skipping Discord update');
      }
    } catch (e) {
      console.error(`  ❌ Error: ${e.message}`);
    }
  }

  console.log('\nDone!');
  client.destroy();
  process.exit(0);
}

main();
