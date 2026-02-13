const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const { PermissionFlagsBits } = require('discord.js');
const enterbet = require('./enterbet');

// Allowed roles (case-insensitive check)
const WHALE_ROLES = ['sharp', 'admin', 'the king'];

const command = new SlashCommandBuilder()
  .setName('whaledick')
  .setDescription('🐋 Place a WHALE DICK bet — for massive plays only')
  .addUserOption(option =>
    option.setName('for')
      .setDescription('(Admin) Enter a whale bet on behalf of another user')
      .setRequired(false)
  );

async function execute(interaction) {
  // Check roles
  const memberRoles = interaction.member.roles.cache.map(r => r.name.toLowerCase());
  const hasWhaleRole = WHALE_ROLES.some(wr => memberRoles.includes(wr));

  if (!hasWhaleRole) {
    return interaction.reply({
      content: '❌ Only **Sharps**, **Admins**, and **The King** can place Whale Dick bets!',
      ephemeral: true,
    });
  }

  // Check if admin is entering for someone else
  const forUser = interaction.options.getUser('for');
  let targetUser = null;

  if (forUser) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Only admins can enter bets for other users.', ephemeral: true });
    }
    if (forUser.bot) {
      return interaction.reply({ content: '❌ You can\'t enter bets for bots.', ephemeral: true });
    }
    targetUser = forUser;
  }

  // Set up the session with whale flag — reuse enterbet's session store
  enterbet.betSessions.set(interaction.user.id, { targetUser, isWhale: true });

  const targetLabel = targetUser
    ? (interaction.guild ? (await interaction.guild.members.fetch(targetUser.id).catch(() => null))?.displayName || targetUser.displayName : targetUser.displayName)
    : null;

  // Step 1: Ask single or parlay (reuses enterbet's select menus)
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('enterbet_type')
      .setPlaceholder('Select bet type')
      .addOptions([
        { label: 'Single Bet', value: 'single', description: 'One game or prop', emoji: '1️⃣' },
        { label: 'Parlay', value: 'parlay', description: 'Multiple legs combined', emoji: '🎰' },
      ])
  );

  await interaction.reply({
    content: `🐋🚨 **WHALE DICK BET** 🚨🐋${targetLabel ? ` (for ${targetLabel})` : ''} — What type of bet?`,
    components: [row],
    ephemeral: true,
  });
}

module.exports = {
  command,
  execute,
};
