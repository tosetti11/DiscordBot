const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const { PermissionFlagsBits } = require('discord.js');
const enterbet = require('./enterbet');

const command = new SlashCommandBuilder()
  .setName('retrobet')
  .setDescription('📋 Enter a retro bet — a bet you already placed that needs to be logged')
  .addUserOption(option =>
    option.setName('for')
      .setDescription('(Admin) Enter a retro bet on behalf of another user')
      .setRequired(false)
  );

async function execute(interaction) {
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

  // Set up the session with retro flag — reuse enterbet's session store
  enterbet.betSessions.set(interaction.user.id, { targetUser, isRetro: true });

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
    content: `📋 **Retro Bet**${targetLabel ? ` (for ${targetLabel})` : ''} — This bet will be logged as already closed. What type of bet?`,
    components: [row],
    ephemeral: true,
  });
}

module.exports = {
  command,
  execute,
};
