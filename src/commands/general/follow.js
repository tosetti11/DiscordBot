const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { COLORS } = require('../../config/constants');
const followsDb = require('../../database/bettorFollows');

const command = new SlashCommandBuilder()
  .setName('follow')
  .setDescription('Follow/unfollow a bettor to get DM notifications when they post bets')
  .addUserOption(option =>
    option.setName('user')
      .setDescription('The bettor to follow or unfollow')
      .setRequired(false)
  );

async function execute(interaction) {
  const targetUser = interaction.options.getUser('user');

  // If no user provided, show who you're following
  if (!targetUser) {
    const following = await followsDb.getFollowing(interaction.user.id, interaction.guildId);

    if (following.length === 0) {
      return interaction.reply({
        content: '📭 You\'re not following anyone yet. Use `/follow @user` to follow a bettor.',
        ephemeral: true,
      });
    }

    const userMentions = following.map(f => `<@${f.bettor_discord_id}>`).join('\n');
    const embed = new EmbedBuilder()
      .setColor(COLORS.primary || 0xf5c518)
      .setTitle('👥 Bettors You\'re Following')
      .setDescription(userMentions)
      .setFooter({ text: `${following.length} bettor${following.length === 1 ? '' : 's'} • Use /follow @user to unfollow` });

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // Can't follow yourself
  if (targetUser.id === interaction.user.id) {
    return interaction.reply({ content: '❌ You can\'t follow yourself.', ephemeral: true });
  }

  // Can't follow bots
  if (targetUser.bot) {
    return interaction.reply({ content: '❌ You can\'t follow bots.', ephemeral: true });
  }

  try {
    const result = await followsDb.toggleFollow(interaction.user.id, targetUser.id, interaction.guildId);

    if (result.followed) {
      await interaction.reply({
        content: `✅ You're now following **${targetUser.displayName}**! You'll get a DM when they post a new bet.`,
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: `🔕 Unfollowed **${targetUser.displayName}**. You'll no longer get notifications for their bets.`,
        ephemeral: true,
      });
    }
  } catch (err) {
    console.error('[Follow] Error:', err);
    await interaction.reply({ content: '❌ Something went wrong. Please try again.', ephemeral: true });
  }
}

module.exports = { command, execute };
