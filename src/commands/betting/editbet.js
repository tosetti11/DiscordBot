const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/queries');
const { buildBetEmbed } = require('../../utils/embeds');

const command = new SlashCommandBuilder()
    .setName('editbet2')
    .setDescription('(Admin) Edit an existing bet')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('(Admin) Select a user to edit their bets')
        .setRequired(true)
    );

async function execute(interaction) {
  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ Only admins can edit bets.', ephemeral: true });
  }

  const user = interaction.options.getUser('user');
  if (!user) {
    return interaction.reply({ content: '❌ You must select a user.', ephemeral: true });
  }

  // Step 1: Ask for open/closed status
  const statusRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`editbet2_status_${user.id}`)
      .setPlaceholder('Select bet status')
      .addOptions([
        { label: 'Open Bets', value: 'open', description: 'Edit open bets' },
        { label: 'Closed Bets', value: 'closed', description: 'Edit closed bets' },
      ])
  );
  return interaction.reply({ content: `Select bet status for <@${user.id}>:`, components: [statusRow], ephemeral: true });

  // Show modal to edit bet fields
  const modal = new ModalBuilder()
    .setCustomId(`editbet2_modal_${bet.id}`)
    .setTitle(`Edit Bet ${bet.slip_number}`);

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('edit_odds')
        .setLabel('Odds (American)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(bet.odds_american || ''))
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('edit_units')
        .setLabel('Units')
        .setStyle(TextInputStyle.Short)
        .setValue(String(bet.units || ''))
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('edit_pick')
        .setLabel('Pick')
        .setStyle(TextInputStyle.Short)
        .setValue(bet.pick || '')
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('edit_note')
        .setLabel('Bet Note')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(bet.bet_note || '')
        .setRequired(false)
    )
  );

  await interaction.showModal(modal);
}

// Modal handler (to be registered in your interaction handler)
async function handleEditBetModal(interaction) {
  try {
    const betId = interaction.customId.replace('editbet2_modal_', '');
    const odds = interaction.fields.getTextInputValue('edit_odds');
    const units = interaction.fields.getTextInputValue('edit_units');
    const pick = interaction.fields.getTextInputValue('edit_pick');
    const bet_note = interaction.fields.getTextInputValue('edit_note');

    // Update bet in DB
    await db.updateBetFields(betId, { odds_american: odds, units, pick, bet_note });
    const bet = await db.getBet(betId);

    // Update original message if possible
    if (bet.message_id && bet.channel_id) {
      try {
        const channel = await interaction.client.channels.fetch(bet.channel_id);
        const message = await channel.messages.fetch(bet.message_id);
        const embed = buildBetEmbed(bet, null, null);
        await message.edit({ embeds: [embed] });
      } catch (e) {
        // ignore
      }
    }

    await interaction.reply({ content: `✅ Bet **${bet.slip_number}** updated.`, ephemeral: true });
  } catch (err) {
    await interaction.reply({ content: `❌ Error updating bet: ${err.message || err}`, ephemeral: true });
  }

}

// Handle select menu for admin user search
async function handleEditBetSelect(interaction) {
  let replied = false;
  try {
    console.log('[editbet2] handleEditBetSelect called:', {
      customId: interaction.customId,
      values: interaction.values,
      user: interaction.user?.id,
      guild: interaction.guildId
    });
    // Step 2: If status select, show bets for user/status
    if (interaction.customId.startsWith('editbet2_status_')) {
      const userId = interaction.customId.replace('editbet2_status_', '');
      const status = interaction.values[0]; // 'open' or 'closed'
      console.log('[editbet2] Status select:', { userId, status, guildId: interaction.guildId });
      // 'closed' means won/lost/push — use .in filter; 'open' is exact match
      const filterOpts = { discordId: userId, limit: 25 };
      if (status === 'closed') {
        filterOpts.statusIn = ['won', 'lost', 'push'];
      } else {
        filterOpts.status = status;
      }
      console.log('[editbet2] Filter opts:', filterOpts);
      const bets = await db.getAllBetsInGuild(interaction.guildId, filterOpts);
      console.log('[editbet2] Bets found:', bets.length, bets.map(b => ({ id: b.id, slip: b.slip_number, status: b.status, discord_id: b.discord_id })));
      console.log('[editbet2] Bets found:', bets.length);
      if (!bets.length) {
        replied = true;
        return interaction.reply({ content: `❌ No ${status} bets found for <@${userId}>.`, ephemeral: true });
      }
      const options = bets.map(b => ({
        label: `${b.slip_number} | ${b.pick || b.bet_type}`,
        value: b.id,
        description: `${b.status.toUpperCase()} | ${b.units}u | ${b.odds_american}`.substring(0, 100),
      }));
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('editbet2_select')
        .setPlaceholder('Select a bet to edit')
        .addOptions(options);
      console.log('[editbet2] Creating select menu with customId:', selectMenu.data.custom_id);
      const row = new ActionRowBuilder().addComponents(selectMenu);
      console.log('[editbet2] Sending select menu reply for user:', userId);
      replied = true;
      return interaction.reply({ content: `Select a bet to edit for <@${userId}>:`, components: [row], ephemeral: true });
    }

    // Step 3: If bet select, show modal
    const betId = interaction.values[0];
    const bet = await db.getBet(betId);
    console.log('[editbet2] Bet loaded:', bet ? bet.id : null);
    if (!bet) {
      replied = true;
      return await interaction.reply({ content: '❌ Bet not found.', ephemeral: true });
    }
    const modal = new ModalBuilder()
      .setCustomId(`editbet2_modal_${bet.id}`)
      .setTitle(`Edit Bet ${bet.slip_number}`);
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('edit_odds')
          .setLabel('Odds (American)')
          .setStyle(TextInputStyle.Short)
          .setValue(String(bet.odds_american || ''))
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('edit_units')
          .setLabel('Units')
          .setStyle(TextInputStyle.Short)
          .setValue(String(bet.units || ''))
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('edit_pick')
          .setLabel('Pick')
          .setStyle(TextInputStyle.Short)
          .setValue(bet.pick || '')
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('edit_note')
          .setLabel('Bet Note')
          .setStyle(TextInputStyle.Paragraph)
          .setValue(bet.bet_note || '')
          .setRequired(false)
      )
    );
    replied = true;
    await interaction.showModal(modal);
  } catch (err) {
    console.error('[editbet2] Error in handleEditBetSelect:', err);
    if (!replied) {
      try {
        await interaction.reply({ content: `❌ Error loading bet: ${err.message || err}`, ephemeral: true });
      } catch (e) {
        console.error('[editbet2] Fallback error reply failed:', e);
      }
    }
  }
}

module.exports = {
  command,
  execute,
  handleEditBetModal,
  handleEditBetSelect,
};
