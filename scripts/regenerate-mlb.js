/**
 * Regenerate MLB analysis for today.
 * Usage: REGEN_MARKETS=strikeout,homerun node scripts/regenerate-mlb.js
 * 
 * This starts the Discord bot, waits for it to be ready,
 * then deletes+regenerates the specified markets and exits.
 */
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const mlbAnalysis = require('../src/services/mlbAnalysis');

const markets = (process.env.REGEN_MARKETS || 'strikeout,homerun').split(',').map(m => m.trim());
const guildId = process.env.DISCORD_GUILD_ID;

if (!guildId) {
  console.error('DISCORD_GUILD_ID not set');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

client.once('ready', async () => {
  console.log(`Bot ready as ${client.user.tag}`);
  try {
    for (const market of markets) {
      console.log(`\n=== Regenerating ${market} ===`);
      await mlbAnalysis.regenerateMarket(client, guildId, market);
    }
    console.log('\nAll done!');
  } catch (err) {
    console.error('Error:', err);
  }
  client.destroy();
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
