/**
 * One-time script: Sends the NCAA Tournament Bracket Challenge announcement
 * to Discord channel 1478629367893594174 with clickable Link buttons.
 * Includes a live-updating Pool Tracker embed whose message ID is saved
 * to bracket_tournaments so the app can auto-edit it on new signups.
 *
 * Usage:  node scripts/send-ncaa-tournament.js
 */
require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const CHANNEL_ID = '1478629367893594174';
const BRACKET_URL = 'https://thegamblingkingapp.com/bracket';
const INVITE_URL = 'https://discord.gg/VKmkdSrk';
const ENTRY_FEE = 50;

async function main() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const { supabase } = require('../src/config/supabase');

  client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    try {
      const channel = await client.channels.fetch(CHANNEL_ID);
      if (!channel) {
        console.error('Channel not found!');
        process.exit(1);
      }

      console.log(`Channel found: #${channel.name} (${channel.id})`);

      // Get current tournament for tracker
      const { data: tournament } = await supabase
        .from('bracket_tournaments')
        .select('*')
        .neq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Count current entries
      let entryCount = 0;
      if (tournament) {
        const { count } = await supabase
          .from('bracket_entries')
          .select('*', { count: 'exact', head: true })
          .eq('tournament_id', tournament.id);
        entryCount = count || 0;
      }
      const pot = entryCount * ENTRY_FEE;

      // ── Link button rows ──
      const topRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨')
          .setStyle(ButtonStyle.Link)
          .setURL(BRACKET_URL),
      );
      const mainRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🏀  FILL OUT YOUR BRACKET NOW  🏀')
          .setStyle(ButtonStyle.Link)
          .setURL(BRACKET_URL),
      );
      const bottomDecor = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨')
          .setStyle(ButtonStyle.Link)
          .setURL(BRACKET_URL),
      );

      const inviteRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('📨  INVITE FRIENDS TO THE SERVER  📨')
          .setStyle(ButtonStyle.Link)
          .setURL(INVITE_URL),
        new ButtonBuilder()
          .setLabel('🏀  FILL OUT YOUR BRACKET  🏀')
          .setStyle(ButtonStyle.Link)
          .setURL(BRACKET_URL),
      );

      // ── Pool Tracker Embed (auto-updates) ──
      const trackerEmbed = new EmbedBuilder()
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

      // ── Message content (split into parts to stay under 2000 chars) ──

      const part1 = [
        '# 🏆 NCAA TOURNAMENT BRACKET CHALLENGE 2026',
        '',
        '> **It\'s that time of year.** March Madness is here and we\'re running a **Bracket Challenge** for the server. Fill out your bracket, compete against everyone, and take home the pot.',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        '## 📅 KEY DATES',
        '',
        '🗓️ **Selection Sunday** — **March 15** (Teams & matchups announced)',
        '🗓️ **Bracket Opens** — **March 16** (Fill out your picks starting Monday)',
        '🔒 **Picks Lock** — **March 19 at 12:00 PM ET** (Round of 64 tip-off — NO changes after this)',
        '🏀 **Tournament Runs** — **March 19 – April 6**',
        '',
        '> ⚠️ **You MUST have your bracket submitted before March 19 at noon ET.** Once games start, picks are locked. No exceptions.',
      ].join('\n');

      const part2 = [
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        '## 💰 BUY-IN & PAYOUTS',
        '',
        '**Entry Fee: $50**',
        '',
        '| Place | Payout |',
        '|-------|--------|',
        '| 🥇 **1st** | **70%** of the pot |',
        '| 🥈 **2nd** | **20%** of the pot |',
        '| 🥉 **3rd** | **10%** of the pot |',
        '',
        '> 💡 **Example:** 10 entries = $500 pot → 1st gets **$350**, 2nd gets **$100**, 3rd gets **$50**',
        '> 💡 **The more people, the bigger the bag.** Tell your friends. Bring your coworkers. **Let\'s make this pot nasty.** 💸',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      ].join('\n');

      const part3 = [
        '## 📋 HOW TO ENTER',
        '',
        '**1.** Click the **"Fill Out Your Bracket"** button above or below',
        '**2.** Create an account (email or Discord login)',
        '**3.** Wait for the bracket to open on **March 16** after Selection Sunday',
        '**4.** Pick your winners for all 63 games — from the Round of 64 through the Championship',
        '**5.** Submit your picks before the **March 19 at 12:00 PM ET** deadline',
        '**6.** Pay your **$50 entry fee** to lock in',
        '',
        '> 🔄 You can edit your picks as many times as you want **before the lock date**. Once the games start, your bracket is final.',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        '## 📊 SCORING',
        '',
        'Each correct pick earns points. Later rounds are worth more:',
        '',
        '| Round | Points Per Pick |',
        '|-------|----------------|',
        '| Round of 64 | 1 pt |',
        '| Round of 32 | 2 pts |',
        '| Sweet 16 | 4 pts |',
        '| Elite 8 | 8 pts |',
        '| Final Four | 16 pts |',
        '| Championship | 32 pts |',
        '',
        '> **Max possible score: 192 points.** Good luck. 🫡',
      ].join('\n');

      const part4 = [
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        '## 📣 SPREAD THE WORD',
        '',
        '**The bigger the field, the bigger the payout.** Don\'t keep this to yourself.',
        '',
        '🔗 **Share the bracket:** `https://thegamblingkingapp.com/bracket`',
        '🔗 **Invite to the server:** `https://discord.gg/VKmkdSrk`',
        '',
        '> Copy those links. Text them to your group chats. Post them on socials. Tag your degenerate friends. **The more entries, the fatter the pot.** 🤑',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        '**#JMM** 🏀🔥',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      ].join('\n');

      // ── Send messages in order ──

      // 1. Top buttons
      await channel.send({
        content: '\u200B',
        components: [topRow, mainRow, bottomDecor],
      });

      // 2. Key Dates
      await channel.send({ content: part1 });

      // 3. Buy-in & Payouts
      await channel.send({ content: part2 });

      // 4. Pool Tracker embed (this one auto-updates)
      const trackerMsg = await channel.send({ embeds: [trackerEmbed] });
      console.log(`📊 Pool tracker message ID: ${trackerMsg.id}`);

      // 5. How to Enter + Scoring
      await channel.send({ content: part3 });

      // 6. Spread the Word
      await channel.send({ content: part4 });

      // 7. Bottom buttons
      await channel.send({
        content: '**Ready to fill out your bracket? Lock it in 👇**',
        components: [topRow, mainRow, inviteRow],
      });

      // Save tracker message ID to tournament
      if (tournament) {
        const { error: updateErr } = await supabase
          .from('bracket_tournaments')
          .update({ tracker_message_id: trackerMsg.id, tracker_channel_id: CHANNEL_ID })
          .eq('id', tournament.id);

        if (updateErr) {
          console.error('⚠️  Could not save tracker message ID:', updateErr.message);
        } else {
          console.log('✅ Tracker message ID saved to tournament. Auto-updates are ready!');
        }
      } else {
        console.log('⚠️  No tournament found — tracker message sent but not linked. Create a tournament and manually set tracker_message_id.');
      }

      console.log('✅ All NCAA Tournament messages sent successfully!');
    } catch (err) {
      console.error('Error sending message:', err);
    }

    client.destroy();
    process.exit(0);
  });

  await client.login(process.env.DISCORD_TOKEN);
}

main();
