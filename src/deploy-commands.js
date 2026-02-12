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
const help = require('./commands/general/help');
const convertodds = require('./commands/general/convertodds');

const commands = [
  enterbet.command,
  closebet.command,
  mybets.command,
  mystats.command,
  leaderboard.command,
  viewbets.command,
  deletebet.command,
  help.command,
  convertodds.command,
].map(cmd => cmd.toJSON());

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
