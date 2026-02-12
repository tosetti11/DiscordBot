const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database/queries');
const { buildLeaderboardEmbed } = require('../../utils/embeds');

const command = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('View the server betting leaderboard');

async function execute(interaction) {
  await interaction.deferReply();

  const leaderboard = await db.getLeaderboard(interaction.guildId, 10);

  // Resolve server display names for leaderboard entries
  for (const entry of leaderboard) {
    try {
      const member = await interaction.guild.members.fetch(entry.discord_id);
      entry.discord_username = member.displayName;
    } catch (e) {
      // Keep the stored username as fallback
    }
  }

  const embed = buildLeaderboardEmbed(leaderboard, interaction.guild.name);

  await interaction.editReply({ embeds: [embed] });
}

module.exports = {
  command,
  execute,
};
