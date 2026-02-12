const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const db = require('../../database/queries');
const { PermissionFlagsBits } = require('discord.js');
const { buildBetEmbed } = require('../../utils/embeds');
const { SPORT_NAMES, STATUS_EMOJI } = require('../../config/constants');
const { formatOdds } = require('../../utils/odds');

// Store pending deletions
const pendingDeletes = new Map();

const command = new SlashCommandBuilder()
  .setName('deletebet')
  .setDescription('Permanently delete one of your bets')
  .addUserOption(option =>
    option.setName('user')
      .setDescription('(Admin) Select a user to delete their bets')
      .setRequired(false)
  )
  .addStringOption(option =>
    option.setName('slip')
      .setDescription('Slip number to delete (e.g. RIC-001)')
  );

async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const targetUser = interaction.options.getUser('user');
  let userId = interaction.user.id;
  let isAdmin = false;
  if (targetUser) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.editReply({ content: '❌ Only admins can delete bets for other users.' });
    }
    userId = targetUser.id;
    isAdmin = true;
  }

  const slipSearch = interaction.options.getString('slip');

  if (slipSearch) {
    // Direct slip number lookup
    const bet = await db.getBetBySlip(slipSearch, interaction.guildId);
    if (!bet) {
      return interaction.editReply({ content: `📭 No bet found with slip **${slipSearch.toUpperCase()}**` });
    }
    if (!isAdmin && bet.discord_id !== interaction.user.id) {
      return interaction.editReply({ content: '❌ You can only delete your own bets.' });
    }

    // Show confirmation modal
    pendingDeletes.set(interaction.user.id, bet.id);
    return showDeleteConfirmation(interaction, bet);
  }

  // No slip provided - show list of user's bets
  const bets = await db.getUserBets(userId, interaction.guildId, 25);

  if (bets.length === 0) {
    return interaction.editReply({ content: `📭 ${targetUser ? 'This user has' : 'You have'} no bets to delete.` });
  }

  const options = bets.slice(0, 25).map(bet => {
    const sport = SPORT_NAMES[bet.sport] || bet.sport || 'Parlay';
    const statusEmoji = STATUS_EMOJI[bet.status] || '❓';
    let label;
    if (bet.bet_type === 'parlay') {
      label = `${bet.slip_number} | Parlay (${bet.parlay_legs?.length || '?'} legs)`;
    } else if (bet.bet_category === 'team_game') {
      label = `${bet.slip_number} | ${bet.team_a} vs ${bet.team_b}`;
    } else {
      label = `${bet.slip_number} | ${bet.player_name}`;
    }

    if (label.length > 95) label = label.substring(0, 95) + '...';

    const desc = `${statusEmoji} ${bet.status.toUpperCase()} | ${sport} | ${bet.units}u`;

    return {
      label,
      value: bet.id,
      description: desc.substring(0, 100),
    };
  });

  // Store admin session for target user
  if (isAdmin) {
    pendingDeletes.set(interaction.user.id, { adminFor: userId });
  }

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('deletebet_select')
      .setPlaceholder('Select a bet to delete')
      .addOptions(options)
  );

  await interaction.editReply({
    content: `🗑️ **Select a bet to delete** (${bets.length} total):`,
    components: [row],
  });
}

// Handle bet selection from dropdown
async function handleDeleteSelect(interaction) {
  const betId = interaction.values[0];
  const bet = await db.getBet(betId);

  // Check if this is an admin session
  const adminSession = pendingDeletes.get(interaction.user.id);
  let sessionUserId = interaction.user.id;
  let isAdmin = false;
  if (adminSession && adminSession.adminFor) {
    sessionUserId = adminSession.adminFor;
    isAdmin = true;
  }

  if (!bet) {
    return interaction.update({ content: '❌ Bet not found.', components: [] });
  }
  if (!isAdmin && bet.discord_id !== interaction.user.id) {
    return interaction.update({ content: '❌ You can only delete your own bets.', components: [] });
  }

  pendingDeletes.set(interaction.user.id, betId);
  await showDeleteConfirmation(interaction, bet);
}

// Show the "type Delete to confirm" modal
async function showDeleteConfirmation(interaction, bet) {
  const embed = buildBetEmbed(
    bet,
    interaction.member?.displayName || interaction.user.displayName,
    interaction.user.displayAvatarURL()
  );

  const modal = new ModalBuilder()
    .setCustomId('deletebet_confirm_modal')
    .setTitle(`Delete Bet ${bet.slip_number}?`);

  const confirmInput = new TextInputBuilder()
    .setCustomId('confirm_text')
    .setLabel('Type "Delete" to permanently remove this bet')
    .setPlaceholder('Delete')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(10);

  modal.addComponents(
    new ActionRowBuilder().addComponents(confirmInput),
  );

  // If coming from a deferred reply (slash command with slip), we need to
  // handle differently than from a select menu
  if (interaction.isStringSelectMenu()) {
    await interaction.showModal(modal);
  } else {
    // For deferred replies, we can't show a modal. Show embed + instruction
    // We'll use a workaround: edit with info then the user can use the select
    // Actually, let's show the bet info and a select to confirm
    const { ActionRowBuilder: AR, StringSelectMenuBuilder: SM } = require('discord.js');
    const row = new AR().addComponents(
      new SM()
        .setCustomId('deletebet_select')
        .setPlaceholder('Select to confirm deletion')
        .addOptions([{
          label: `${bet.slip_number} — Confirm Delete`,
          value: bet.id,
          description: `This will permanently delete ${bet.slip_number}`,
        }])
    );

    await interaction.editReply({
      content: `⚠️ **You are about to delete bet ${bet.slip_number}**. Select it below to proceed to confirmation:`,
      embeds: [embed],
      components: [row],
    });
  }
}

// Handle the delete confirmation modal
async function handleDeleteConfirmModal(interaction) {
  const userId = interaction.user.id;
  const betId = pendingDeletes.get(userId);

  if (!betId) {
    return interaction.reply({ content: '❌ No pending deletion found. Use `/deletebet` again.', ephemeral: true });
  }

  const confirmText = interaction.fields.getTextInputValue('confirm_text').trim();

  if (confirmText.toLowerCase() !== 'delete') {
    pendingDeletes.delete(userId);
    return interaction.reply({
      content: '❌ Deletion cancelled. You must type exactly "Delete" to confirm.',
      ephemeral: true,
    });
  }

  // Check if this is an admin session
  let isAdmin = false;
  const adminSession = pendingDeletes.get(userId);
  if (adminSession && adminSession.adminFor) {
    isAdmin = true;
  }

  try {
    const bet = await db.getBet(betId);
    const result = await db.deleteBet(betId, userId, isAdmin);

    if (!result) {
      return interaction.reply({ content: '❌ Bet not found.', ephemeral: true });
    }
    if (!isAdmin && result.error === 'not_owner') {
      return interaction.reply({ content: '❌ You can only delete your own bets.', ephemeral: true });
    }

    // Try to delete the original message in the channel
    if (result.message_id && result.channel_id) {
      try {
        const channel = await interaction.client.channels.fetch(result.channel_id);
        const message = await channel.messages.fetch(result.message_id);
        await message.delete();
      } catch (e) {
        // Message may already be deleted
        console.warn('Could not delete original bet message:', e.message);
      }
    }

    pendingDeletes.delete(userId);
    await interaction.reply({
      content: `🗑️ Bet **${bet?.slip_number || betId.slice(0, 8)}** has been permanently deleted.`,
      ephemeral: true,
    });
  } catch (err) {
    console.error('Error deleting bet:', err);
    pendingDeletes.delete(userId);
    await interaction.reply({ content: '❌ Error deleting bet.', ephemeral: true });
  }
}

module.exports = {
  command,
  execute,
  handleDeleteSelect,
  handleDeleteConfirmModal,
  pendingDeletes,
};
