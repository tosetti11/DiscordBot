/**
 * One-time script: Sends an auto-updating "Pool Tracker" message
 * to the NCAA Tournament channel. The message ID is stored in the
 * bracket_tournaments table (tracker_message_id column) so the app
 * can edit it whenever someone new joins.
 *
 * Usage:  node scripts/send-pool-tracker.js
 */
require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
} = require('discord.js');

const CHANNEL_ID = '1478629367893594174';
const ENTRY_FEE  = 50;

async function main() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const { supabase } = require('../src/config/supabase');

  client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    try {
      const channel = await client.channels.fetch(CHANNEL_ID);
      if (!channel) { console.error('Channel not found!'); process.exit(1); }

      // Get current tournament
      const { data: tournament } = await supabase
        .from('bracket_tournaments')
        .select('*')
        .neq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!tournament) {
        console.error('No active tournament found! Create one first via the admin panel.');
        process.exit(1);
      }

      // Count current entries
      const { count } = await supabase
        .from('bracket_entries')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', tournament.id);

      const entryCount = count || 0;
      const pot = entryCount * ENTRY_FEE;

      const embed = new EmbedBuilder()
        .setTitle('🏆 BRACKET POOL TRACKER')
        .setColor(0xf9a825)
        .setDescription([
          '```',
          `   ENTRIES:  ${entryCount}`,
          `   POT:      $${pot.toLocaleString()}`,
          '```',
          '',
          '💰 **Payouts**',
          `> 🥇 1st — **$${Math.floor(pot * 0.7).toLocaleString()}** (70%)`,
          `> 🥈 2nd — **$${Math.floor(pot * 0.2).toLocaleString()}** (20%)`,
          `> 🥉 3rd — **$${Math.floor(pot * 0.1).toLocaleString()}** (10%)`,
          '',
          `**$${ENTRY_FEE} buy-in** • The more people, the bigger the bag 💸`,
          '',
          '🔗 **[Fill Out Your Bracket](https://thegamblingkingapp.com/bracket)**',
          '📨 **[Invite Friends to the Server](https://discord.gg/VKmkdSrk)**',
          '',
          '**#JMM** 🏀🔥',
        ].join('\n'))
        .setFooter({ text: 'Updates automatically when someone joins • thegamblingkingapp.com/bracket' })
        .setTimestamp();

      const msg = await channel.send({ embeds: [embed] });
      console.log(`✅ Tracker message sent! Message ID: ${msg.id}`);

      // Store the message ID in the tournament record
      const { error: updateErr } = await supabase
        .from('bracket_tournaments')
        .update({ tracker_message_id: msg.id, tracker_channel_id: CHANNEL_ID })
        .eq('id', tournament.id);

      if (updateErr) {
        console.error('⚠️  Could not save message ID to database. You may need to add tracker columns first.');
        console.error('   Run this SQL in Supabase:');
        console.error('   ALTER TABLE bracket_tournaments ADD COLUMN tracker_message_id TEXT;');
        console.error('   ALTER TABLE bracket_tournaments ADD COLUMN tracker_channel_id TEXT;');
        console.error(`   Then manually update: UPDATE bracket_tournaments SET tracker_message_id = '${msg.id}', tracker_channel_id = '${CHANNEL_ID}' WHERE id = '${tournament.id}';`);
      } else {
        console.log('✅ Message ID saved to tournament record. Auto-updates are ready!');
      }
    } catch (err) {
      console.error('Error:', err);
    }

    client.destroy();
    process.exit(0);
  });

  await client.login(process.env.DISCORD_TOKEN);
}

main();
