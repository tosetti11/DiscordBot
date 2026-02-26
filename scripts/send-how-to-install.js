/**
 * One-time script: Sends a "How to Download the App" instructional message
 * to Discord channel 1476409090472149125 with a clickable Link button.
 *
 * Usage:  node scripts/send-how-to-install.js
 */
require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const CHANNEL_ID = '1476409090472149125';
const INSTALL_URL = 'https://thegamblingkingapp.com/#install';

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
          .setURL(INSTALL_URL),
      );
      const mainRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('📲  DOWNLOAD THE APP  📲')
          .setStyle(ButtonStyle.Link)
          .setURL(INSTALL_URL),
      );
      const bottomDecor = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨')
          .setStyle(ButtonStyle.Link)
          .setURL(INSTALL_URL),
      );

      // ── Instructional content (split to stay under 2000 chars) ──
      const part1 = [
        '# 📲 HOW TO DOWNLOAD THE APP',
        '',
        '> Get TheGamblingKing on your phone\'s home screen for instant access — just like a real app!',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        '## 🍎 iPhone / iPad (Safari)',
        '',
        '**1.** Open **Safari** and go to `thegamblingkingapp.com`',
        '   *(Must be Safari — Chrome/Firefox won\'t work on iOS)*',
        '**2.** Tap the **Share** button ⬆️ at the bottom of the screen',
        '**3.** Scroll down and tap **"Add to Home Screen"** ➕',
        '**4.** Tap **"Add"** in the top right corner',
        '**5.** The app icon will appear on your home screen! 🎉',
        '',
        '> 💡 **Tip:** If you don\'t see "Add to Home Screen", make sure you\'re using Safari, not the Discord in-app browser. Copy the link and paste it into Safari.',
      ].join('\n');

      const part2 = [
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        '## 🤖 Android (Chrome)',
        '',
        '**1.** Open **Chrome** and go to `thegamblingkingapp.com`',
        '**2.** Tap the **⋮ three-dot menu** in the top right corner',
        '**3.** Tap **"Install app"** or **"Add to Home screen"**',
        '**4.** Tap **"Install"** to confirm',
        '**5.** The app icon will appear on your home screen! 🎉',
        '',
        '> 💡 **Tip:** On some Android phones, you\'ll see a pop-up bar at the bottom asking to install — just tap it!',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        '## ✅ Why Download?',
        '',
        '> ⚡ **Instant Access** — Launch from your home screen, no browser needed',
        '> 📱 **Full Screen** — Runs like a native app, no address bar',
        '> 🚀 **Faster Loading** — Cached assets load instantly',
        '> 🔔 **Push Notifications** — Get alerted when bets are closed *(coming soon)*',
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
        content: '**Download the app and never miss a bet 👇**',
        components: [topRow, mainRow, bottomDecor],
      });

      console.log('✅ How-to-install message sent successfully!');
    } catch (err) {
      console.error('Error sending message:', err);
    }

    client.destroy();
    process.exit(0);
  });

  await client.login(process.env.DISCORD_TOKEN);
}

main();
