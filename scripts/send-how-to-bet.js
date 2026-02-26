/**
 * One-time script: Sends a "How to Place a Bet" instructional message
 * to Discord channel 1476401305038622721 with clickable Link buttons.
 *
 * Usage:  node scripts/send-how-to-bet.js
 */
require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const CHANNEL_ID = '1476401305038622721';
const BET_SLIP_URL = 'https://thegamblingkingapp.com/#slip';

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

      console.log(`Channel found: #${channel.name} (${channel.id}) in guild: ${channel.guild?.name}`);
      console.log(`Channel type: ${channel.type}, Parent/Category: ${channel.parent?.name || 'none'} (${channel.parentId || 'none'})`);
      const me = channel.guild?.members?.me;
      if (me) {
        const perms = channel.permissionsFor(me);
        console.log('Bot perms in channel:', {
          ViewChannel: perms.has('ViewChannel'),
          SendMessages: perms.has('SendMessages'),
          SendMessagesInThreads: perms.has('SendMessagesInThreads'),
          EmbedLinks: perms.has('EmbedLinks'),
          UseExternalEmojis: perms.has('UseExternalEmojis'),
          Administrator: perms.has('Administrator'),
        });
        console.log('Bot roles:', me.roles.cache.map(r => `${r.name} (${r.id})`).join(', '));
        
        // Check channel overwrites
        console.log('Channel permission overwrites:');
        channel.permissionOverwrites.cache.forEach((ow) => {
          const allow = ow.allow.toArray();
          const deny = ow.deny.toArray();
          console.log(`  ID: ${ow.id} (type: ${ow.type === 0 ? 'role' : 'member'}) — Allow: [${allow.join(', ')}] — Deny: [${deny.join(', ')}]`);
        });
      }

      // ── Link button rows (fill max width with 3 buttons for visual impact) ──
      const topRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨')
          .setStyle(ButtonStyle.Link)
          .setURL(BET_SLIP_URL),
      );
      const mainRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🎟️  CLICK HERE TO PLACE A BET  🎟️')
          .setStyle(ButtonStyle.Link)
          .setURL(BET_SLIP_URL),
      );
      const bottomDecor = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨')
          .setStyle(ButtonStyle.Link)
          .setURL(BET_SLIP_URL),
      );

      // ── Instructional message content (split into parts to stay under 2000 chars) ──
      const part1 = [
        '# 🏀 HOW TO PLACE A BET',
        '',
        '> Welcome to **The Gambling King**! Follow the steps below to get your bets tracked and posted to the channel.',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        '## 📸 Option 1 — Scan Your Bet Slip (Fastest)',
        '',
        '**1.** Click the **"Place a Bet Now"** button above to open the bet slip.',
        '**2.** Log in with your Discord account (first time only).',
        '**3.** Set your **unit size** (top-right of the slip) — this is how much $1 unit equals for you (e.g. $25).',
        '**4.** Click the **"📷 Scan Slip"** button.',
        '**5.** Upload a screenshot of your bet from your sportsbook app (DraftKings, FanDuel, BetMGM, etc.).',
        '**6.** The AI will auto-read your slip and fill in all the fields — sport, teams, pick, odds, and wager.',
        '**7.** **Select the correct channel for your bet (Daily Action, Parlay Mania, Over Under, etc.)**',
        '**8.** Review the auto-filled fields. Make any corrections if needed.',
        '**9.** Hit **"Place Bet 🎰"** and your bet is posted to the channel!',
        '',
        '> 💡 **Tip:** The scanner works best with clean, full-screen screenshots. Crop out any extra UI if possible.',
      ].join('\n');

      const part2 = [
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        '## ✍️ Option 2 — Enter a Bet Manually',
        '',
        '**1.** Click the **"Place a Bet Now"** button above (or below).',
        '**2.** Log in with your Discord account.',
        '**3.** **Select the correct channel for your bet (Daily Action, Parlay Mania, Over Under, etc.)**',
        '**4.** Select your **Sport** from the dropdown.',
        '**5.** Choose the **Bet Category**:',
        '   • **Team Game** — Moneyline, Spread, or Over/Under',
        '   • **Player Prop** — Over/Under on a player stat',
        '   • **Futures** — Championship, MVP, season wins, etc.',
        '**6.** Fill in the required fields:',
        '   • **Teams** (or Player Name for props)',
        '   • **Pick** (your selection)',
        '   • **Odds** (American format, e.g. -110, +150)',
        '   • **Units** (how many units you\'re wagering)',
        '**7.** Optionally add a **Note** with your reasoning.',
        '**8.** Click **"Place Bet 🎰"** — done! Your bet card is posted to the channel for everyone to see.',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        '## 🎰 Option 3 — Parlays',
        '',
        '**1.** On the bet slip, check the **"Parlay"** toggle.',
        '**2.** Add each leg one at a time — pick the sport, category, teams/players, and pick for each leg.',
        '**3.** Once all legs are added, enter the **total parlay odds** and **units**.',
        '**4.** Submit and your full parlay card is posted!',
      ].join('\n');

      const part3 = [
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        '## ❓ Quick FAQ',
        '',
        '> **Q: What are units?**',
        '> A unit is a standardized bet size. If your unit size is $25 and you bet $50, that\'s **2 units**.',
        '',
        '> **Q: Can I edit or delete a bet after posting?**',
        '> Yes! Use the website dashboard or the `/editbet` and `/deletebet` commands in Discord.',
        '',
        '> **Q: How do I close a bet as won/lost?**',
        '> Admins can close bets from the website or with `/closebet`. Results update the bet card automatically.',
        '',
        '> **Q: Do I need to download an app?**',
        '> Nope — it\'s a web app. Works on any phone, tablet, or computer browser. You can add it to your home screen for an app-like experience.',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      ].join('\n');

      // Send: top buttons (3 rows: decor → main CTA → decor)
      await channel.send({
        content: '\u200B',
        components: [topRow, mainRow, bottomDecor],
      });

      // Send instructions in parts
      await channel.send({ content: part1 });
      await channel.send({ content: part2 });
      await channel.send({ content: part3 });

      // Send: bottom buttons (decor → main CTA → decor)
      await channel.send({
        content: '**Ready to lock in a bet? 👇**',
        components: [topRow, mainRow, bottomDecor],
      });

      console.log('✅ How-to-bet message sent successfully!');
    } catch (err) {
      console.error('Error sending message:', err);
    }

    client.destroy();
    process.exit(0);
  });

  await client.login(process.env.DISCORD_TOKEN);
}

main();
