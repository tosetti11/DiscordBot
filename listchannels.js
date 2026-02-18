require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('ready', () => {
  const g = c.guilds.cache.first();
  g.channels.cache
    .filter(ch => ch.isTextBased() && !ch.isThread())
    .forEach(ch => console.log(ch.name));
  process.exit();
});
c.login(process.env.DISCORD_TOKEN);
