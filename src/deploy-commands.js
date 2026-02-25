require('dotenv').config();
const { REST, Routes } = require('discord.js');

// Import all commands
const enterbet = require('./commands/betting/enterbet');
const closebet = require('./commands/betting/closebet');

const mybets = require('./commands/betting/mybets');
const mystats = require('./commands/betting/mystats');
const leaderboard = require('./commands/betting/leaderboard');
const viewbets = require('./commands/betting/viewbets');
const deletebet = require('./commands/betting/deletebet');
const editbet = require('./commands/betting/editbet');
const advancedstats = require('./commands/betting/advancedstats');
const whaledick = require('./commands/betting/whaledick');
const retrobet = require('./commands/betting/retrobet');
const help = require('./commands/general/help');
const convertodds = require('./commands/general/convertodds');
const reminder = require('./commands/general/reminder');
const announce = require('./commands/general/announce');
const follow = require('./commands/general/follow');


const commandObjs = [
  enterbet.command,
  closebet.command,
  mybets.command,
  mystats.command,
  leaderboard.command,
  viewbets.command,
  deletebet.command,
  editbet.command,
  advancedstats.command,
  whaledick.command,
  retrobet.command,
  help.command,
  convertodds.command,
  reminder.command,
  announce.command,
  follow.command,
];
console.log('Registering the following commands:');
for (const c of commandObjs) {
  console.log('-', c.name || (c.data && c.data.name) || '[unknown]');
}
const commands = commandObjs.map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

async function deployCommands() {
  try {
    console.log(`🔄 Registering ${commands.length} slash commands...`);

    if (process.env.DISCORD_GUILD_ID) {
      // Guild commands (instant, good for development)
      await rest.put(
        Routes.applicationGuildCommands(
          process.env.DISCORD_CLIENT_ID,
          process.env.DISCORD_GUILD_ID
        ),
        { body: commands }
      );
      console.log(`✅ Registered ${commands.length} guild commands (server: ${process.env.DISCORD_GUILD_ID})`);
    } else {
      // Global commands (takes up to 1 hour to propagate)
      await rest.put(
        Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
        { body: commands }
      );
      console.log(`✅ Registered ${commands.length} global commands (may take up to 1 hour)`);
    }
  } catch (error) {
    console.error('❌ Error deploying commands:', error);
  }
}

deployCommands();
