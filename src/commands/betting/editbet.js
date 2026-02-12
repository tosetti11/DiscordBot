const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const db = require('../../database/queries');
const { buildBetEmbed } = require('../../utils/embeds');
const { PermissionFlagsBits } = require('discord.js');

const command = new SlashCommandBuilder();
command.setName('editbet2');
command.setDescription('(Admin) Edit an existing bet (test)');
command.addStringOption(option =>
  option.setName('slip')
    .setDescription('Slip number to edit (e.g. RIC-001)')
    .setRequired(false)
);
command.addUserOption(option =>
  option.setName('user')
    .setDescription('(Admin) Search bets by user')
    .setRequired(false)
);
  .addStringOption(option =>
    option.setName('slip')
      .setDescription('Slip number to edit (e.g. RIC-001)')
      .setRequired(true)
  );

async function execute(interaction) {
  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ Only admins can edit bets.', ephemeral: true });
  }

  const slip = interaction.options.getString('slip');
  const user = interaction.options.getUser('user');
  let bet;
  if (slip) {
    bet = await db.getBetBySlip(slip, interaction.guildId);
    if (!bet) {
      return interaction.reply({ content: `❌ No bet found with slip **${slip.toUpperCase()}**.`, ephemeral: true });
    }
  } else if (user) {
    // Admin only: search bets by user
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Only admins can search bets by user.', ephemeral: true });
    }
    const bets = await db.getUserBets(user.id, interaction.guildId, 10);
    if (!bets.length) {
      return interaction.reply({ content: `❌ No bets found for user <@${user.id}>.`, ephemeral: true });
    }
    // List bets and let admin pick one to edit
    const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
    const options = bets.map(b => ({
      label: `${b.slip_number} | ${b.pick || b.bet_type}`,
      value: b.id,
      description: `${b.status.toUpperCase()} | ${b.units}u | ${b.odds_american}`.substring(0, 100),
    }));
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('editbet2_select')
        .setPlaceholder('Select a bet to edit')
        .addOptions(options)
    );
    return interaction.reply({ content: `Select a bet to edit for <@${user.id}>:`, components: [row], ephemeral: true });
  } else {
    return interaction.reply({ content: '❌ You must provide a slip number or user to search.', ephemeral: true });
  }

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

}

// Handle select menu for admin user search
async function handleEditBetSelect(interaction) {
  const betId = interaction.values[0];
  // Show modal for the selected bet
  const bet = await db.getBet(betId);
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

module.exports = {
  command,
  execute,
  handleEditBetModal,
  handleEditBetSelect,
};
