/**
 * Force-refresh stuck cards: GAM-150 + AI picks (HR, K, NRFI) for a given date.
 * Usage: node scripts/force-refresh-all.js [date]
 *   date defaults to yesterday ET (YYYY-MM-DD)
 */
require('dotenv').config();
const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const { supabase: supa } = require('../src/config/supabase');
const { generateBetCardImage } = require('../src/utils/betCardImage');
const { refreshAnalysisCards } = require('../src/services/mlbAnalysis');

// Get yesterday in ET
function yesterdayET() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  et.setDate(et.getDate() - 1);
  return et.toISOString().slice(0, 10);
}

const targetDate = process.argv[2] || yesterdayET();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

client.once('ready', async () => {
  console.log(`Bot ready as ${client.user.tag}`);
  console.log(`Target analysis date: ${targetDate}`);

  try {
    // ── 1. Refresh all open bet cards (GAM-150 and any others) ──
    const { data: openBets } = await supa
      .from('bets')
      .select('*, parlay_legs(*)')
      .eq('status', 'open')
      .eq('start_notified', true)
      .not('message_id', 'is', null);

    console.log(`\nFound ${(openBets || []).length} open notified bet(s) to refresh`);

    for (const bet of (openBets || [])) {
      try {
        const guild = client.guilds.cache.get(bet.guild_id) || await client.guilds.fetch(bet.guild_id).catch(() => null);
        let displayName = bet.discord_id;
        if (guild) {
          const member = await guild.members.fetch(bet.discord_id).catch(() => null);
          displayName = member?.displayName || bet.discord_id;
        }
        const avatar = (await client.users.fetch(bet.discord_id).catch(() => null))?.displayAvatarURL() || '';

        const imgBuffer = await generateBetCardImage(bet, displayName, avatar);
        const attachment = new AttachmentBuilder(imgBuffer, { name: 'bet-card.png' });

        const channel = await client.channels.fetch(bet.channel_id).catch(() => null);
        if (channel) {
          const msg = await channel.messages.fetch(bet.message_id).catch(() => null);
          if (msg) {
            await msg.edit({ files: [attachment] });
            console.log(`  ✅ ${bet.slip_number} card updated`);
          } else {
            console.log(`  ⚠️  ${bet.slip_number} message not found`);
          }
        }
      } catch (e) {
        console.error(`  ❌ ${bet.slip_number}: ${e.message}`);
      }
    }

    // ── 2. Refresh AI analysis cards for target date ──
    for (const market of ['nrfi', 'strikeout', 'homerun']) {
      try {
        await refreshAnalysisCards(client, market, targetDate);
        console.log(`  ✅ ${market} card refreshed for ${targetDate}`);
      } catch (e) {
        console.error(`  ❌ ${market}: ${e.message}`);
      }
    }

    // Also refresh today's date in case there are entries
    const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    if (todayET !== targetDate) {
      for (const market of ['nrfi', 'strikeout', 'homerun']) {
        try {
          await refreshAnalysisCards(client, market, todayET);
          console.log(`  ✅ ${market} card refreshed for ${todayET}`);
        } catch (e) {
          // Ignore — may not have today's entries yet
        }
      }
    }

    console.log('\n✅ All done!');
  } catch (err) {
    console.error('Error:', err);
  }

  client.destroy();
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
