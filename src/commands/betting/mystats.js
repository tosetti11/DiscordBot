const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database/queries');
const tailedBetsDb = require('../../database/tailedBets');
const { buildStatsEmbed } = require('../../utils/embeds');

const command = new SlashCommandBuilder()
  .setName('mystats')
  .setDescription('View your betting stats')
  .addUserOption(option =>
    option.setName('user')
      .setDescription('View another user\'s stats')
  );

async function execute(interaction) {
  await interaction.deferReply();

  const targetUser = interaction.options.getUser('user') || interaction.user;

  const stats = await db.getUserStats(targetUser.id);
  const tailStats = await tailedBetsDb.getTailStats(targetUser.id);

  // Get display name from guild member
  let targetDisplayName;
  try {
    const member = await interaction.guild.members.fetch(targetUser.id);
    targetDisplayName = member.displayName;
  } catch (e) {
    targetDisplayName = targetUser.displayName;
  }

  if ((!stats || stats.total_bets === 0) && !tailStats) {
    return interaction.editReply({
      content: `📭 ${targetUser.id === interaction.user.id ? 'You have' : `${targetDisplayName} has`} no bets recorded yet.`,
    });
  }

  const embed = buildStatsEmbed(
    stats,
    targetDisplayName,
    targetUser.displayAvatarURL(),
    tailStats
  );

  await interaction.editReply({ embeds: [embed] });
}

module.exports = {
  command,
  execute,
};
