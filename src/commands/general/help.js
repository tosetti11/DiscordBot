const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { COLORS } = require('../../config/constants');

const command = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show bot commands and how to use them');

async function execute(interaction) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('👑 GK | Sports Betting Tracker')
    .setDescription('Track your sports bets and compete with your community!')
    .addFields(
      {
        name: '🎲 /enterbet',
        value: 'Place a new bet (single or parlay). Walks you through sport, teams, odds, and units.',
        inline: false,
      },
      {
        name: '📕 /closebet',
        value: 'Close an open bet as Win, Loss, Push, or Void.',
        inline: false,
      },
      {
        name: '📋 /mybets',
        value: 'View your recent bets. Filter by status and limit count.',
        inline: false,
      },
      {
        name: '🔍 /viewbets',
        value: 'View all server bets. Search by slip number, filter by user or status.',
        inline: false,
      },
      {
        name: '🗑️ /deletebet',
        value: 'Permanently delete a bet. Requires typing "Delete" to confirm.',
        inline: false,
      },
      {
        name: '📊 /mystats',
        value: 'View your (or another user\'s) betting statistics.',
        inline: false,
      },
      {
        name: '👑 /leaderboard',
        value: 'See who\'s the Gambling King of the server!',
        inline: false,
      },
      {
        name: '💡 /convertodds',
        value: 'Convert between American and Decimal odds.',
        inline: false,
      },
      {
        name: '\u200b',
        value: '**Odds Format:** Use American odds (e.g., -110, +150)\n**Units:** Enter wager size in units (e.g., 1, 2.5, 5)\n**Spreads:** Use negative for favorite, positive for underdog (e.g., -1.5, +3)\n**Slip Numbers:** Each bet gets a unique slip (e.g., RIC-001) for easy lookup',
        inline: false,
      },
    )
    .setFooter({ text: 'GK | Sports Betting Tracker v1.0' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

module.exports = {
  command,
  execute,
};
