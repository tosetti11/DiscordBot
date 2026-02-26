/**
 * One-time script: Sends a "How to View Your Stats" instructional message
 * to Discord channel 1476407386678755540 with clickable Link buttons.
 *
 * Usage:  node scripts/send-how-to-stats.js
 */
require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const CHANNEL_ID = '1476407386678755540';
const STATS_URL = 'https://thegamblingkingapp.com/#stats';
const LEADERBOARD_URL = 'https://thegamblingkingapp.com/#leaderboard';

async function main() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    try {
      const channel = await client.channels.fetch(CHANNEL_ID);
      if (!channel) {
        console.error('Channel not found!');
        process.exit(1);
      }

      // ── Link button rows ──
      const topRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨')
          .setStyle(ButtonStyle.Link)
          .setURL(STATS_URL),
      );
      const mainRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('📊  VIEW YOUR STATS  📊')
          .setStyle(ButtonStyle.Link)
          .setURL(STATS_URL),
        new ButtonBuilder()
          .setLabel('🏆  LEADERBOARD  🏆')
          .setStyle(ButtonStyle.Link)
          .setURL(LEADERBOARD_URL),
      );
      const bottomDecor = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨')
          .setStyle(ButtonStyle.Link)
          .setURL(STATS_URL),
      );

      // ── Instructional content (split to stay under 2000 chars) ──
      const part1 = [
        '# 📊 HOW TO VIEW YOUR STATS',
        '',
        '> Track your betting performance, see your win rate, ROI, streaks, and more — all from the web dashboard.',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        '## 📈 Your Personal Stats Dashboard',
        '',
        '**1.** Click the **"View Your Stats"** button above.',
        '**2.** Log in with your Discord account (first time only).',
        '**3.** Select the server from the dropdown at the top.',
        '**4.** Your full stats dashboard loads automatically:',
        '',
        '> 📋 **Record** — Wins, Losses, Pushes, and your overall Win %',
        '> 💰 **Units** — Total units wagered, won, and your net profit/loss',
        '> 📊 **ROI** — Return on investment across all your bets',
        '> 🔥 **Streaks** — Current streak and best winning streak',
        '> 🐋 **Whale Stats** — Separate breakdown for whale bets',
        '> 🏅 **Sport Breakdown** — Win rate per sport',
        '',
        '> 💡 **Tip:** Your stats update in real-time as bets are closed. Check back after every result!',
      ].join('\n');

      const part2 = [
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        '## 🏆 The Leaderboard',
        '',
        '**1.** Click the **"Leaderboard"** button above (or below).',
        '**2.** See how you stack up against everyone in the server.',
        '**3.** The leaderboard ranks by **net units** — the ultimate measure of who\'s printing money.',
        '',
        '> 🥇 **Top 3** get highlighted with gold, silver, and bronze',
        '> 📊 Each entry shows record, win %, units won/lost, and ROI',
        '> 🐋 There\'s a separate **Whale Leaderboard** for whale bets only',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        '## 🤖 Discord Commands',
        '',
        'You can also check stats right in Discord:',
        '',
        '> `/mystats` — Your personal stats summary',
        '> `/leaderboard` — Server leaderboard',
        '> `/advancedstats` — Deep dive into your betting patterns',
        '> `/viewbets` — Browse all your past bets',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      ].join('\n');

      // Send: top buttons
      await channel.send({
        content: '\u200B',
        components: [topRow, mainRow, bottomDecor],
      });

      // Send instructions
      await channel.send({ content: part1 });
      await channel.send({ content: part2 });

      // Send: bottom buttons
      await channel.send({
        content: '**Check your stats and climb the leaderboard 👇**',
        components: [topRow, mainRow, bottomDecor],
      });

      console.log('✅ How-to-stats message sent successfully!');
    } catch (err) {
      console.error('Error sending message:', err);
    }

    client.destroy();
    process.exit(0);
  });

  await client.login(process.env.DISCORD_TOKEN);
}

main();
