const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const db = require('../../database/queries');
const { buildBetEmbed } = require('../../utils/embeds');
const { SPORT_NAMES, STATUS_EMOJI } = require('../../config/constants');
const { formatOdds } = require('../../utils/odds');

// In-memory sessions for parlay leg closing
const closeSessions = new Map();

const command = new SlashCommandBuilder()
  .setName('closebet')
  .setDescription('Close an open bet as win, loss, or push');

async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const openBets = await db.getOpenBets(interaction.user.id, interaction.guildId);

  if (openBets.length === 0) {
    return interaction.editReply({ content: '📭 You have no open bets to close.' });
  }

  const options = openBets.slice(0, 25).map(bet => {
    const sport = SPORT_NAMES[bet.sport] || bet.sport || 'Parlay';
    let label;
    if (bet.bet_type === 'parlay') {
      label = `Parlay (${bet.parlay_legs?.length || '?'} legs)`;
    } else if (bet.bet_category === 'team_game') {
      label = `${bet.team_a} vs ${bet.team_b}`;
    } else {
      label = `${bet.player_name} - ${bet.pick}`;
    }

    if (label.length > 95) label = label.substring(0, 95) + '...';

    const desc = `${sport} | ${bet.units}u at ${formatOdds(bet.odds_american)} | ${new Date(bet.created_at).toLocaleDateString()}`;

    return {
      label,
      value: bet.id,
      description: desc.substring(0, 100),
    };
  });

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('closebet_select')
      .setPlaceholder('Select a bet to close')
      .addOptions(options)
  );

  await interaction.editReply({
    content: `📋 **Open Bets (${openBets.length})** — Select one to close:`,
    components: [row],
  });
}

// ─── Handle bet selection ───
async function handleBetSelect(interaction) {
  const betId = interaction.values[0];
  const bet = await db.getBet(betId);

  if (bet.bet_type === 'parlay' && bet.parlay_legs?.length > 0) {
    const session = {
      betId,
      legs: bet.parlay_legs.sort((a, b) => a.leg_number - b.leg_number),
    };
    closeSessions.set(interaction.user.id, session);
    return showParlayDashboard(interaction, session, 'update');
  }

  // Single bet — show result buttons directly
  showOverallResult(interaction, betId, 'update');
}

// ─── Parlay Dashboard ───
function buildDashboardContent(session) {
  let content = '🎰 **Parlay — Manage Legs**\n\n';

  session.legs.forEach((leg, i) => {
    const emoji = leg.status === 'open' ? '🟡' : (STATUS_EMOJI[leg.status] || '❓');
    const sport = SPORT_NAMES[leg.sport] || leg.sport;
    const statusLabel = leg.status === 'open' ? 'OPEN' : leg.status.toUpperCase();

    content += `${emoji} **Leg ${i + 1}** — ${statusLabel}\n`;
    if (leg.bet_category === 'team_game') {
      content += `   ${sport}: ${leg.team_a} vs ${leg.team_b}\n`;
      content += `   Pick: **${leg.pick}**\n`;
    } else {
      content += `   ${sport}: ${leg.player_name}\n`;
      content += `   Pick: **${leg.pick}**\n`;
    }
    content += '\n';
  });

  return content;
}

async function showParlayDashboard(interaction, session, method) {
  const content = buildDashboardContent(session);
  const components = [];

  // Select menu with only open legs
  const openLegs = session.legs
    .map((leg, i) => ({ leg, index: i }))
    .filter(({ leg }) => leg.status === 'open');

  if (openLegs.length > 0) {
    const legOptions = openLegs.map(({ leg, index }) => {
      const sport = SPORT_NAMES[leg.sport] || leg.sport;
      let label = `Leg ${index + 1}: ${leg.pick}`;
      if (label.length > 95) label = label.substring(0, 95) + '...';
      return {
        label,
        value: leg.id,
        description: `${sport}`.substring(0, 100),
      };
    });

    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('closebet_leg_select')
          .setPlaceholder('Select a leg to close')
          .addOptions(legOptions)
      )
    );
  }

  // Action buttons
  const allClosed = openLegs.length === 0;
  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('closebet_close_whole')
      .setLabel(allClosed ? '📋 Close Entire Bet' : '📋 Close Entire Bet Now')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('closebet_done')
      .setLabel('✅ Done for Now')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(allClosed),
  );
  components.push(buttonRow);

  const msgContent = allClosed
    ? content + '**All legs are closed!** Close the entire bet to finalize.'
    : content + 'Select a leg to close, or close the entire bet.';

  if (method === 'update') {
    await interaction.update({ content: msgContent, components });
  } else {
    await interaction.editReply({ content: msgContent, components });
  }
}

// ─── Handle leg selection from dashboard ───
async function handleLegSelect(interaction) {
  const legId = interaction.values[0];
  const userId = interaction.user.id;
  const session = closeSessions.get(userId);
  if (!session) {
    return interaction.update({ content: 'Session expired. Use `/closebet` again.', components: [] });
  }

  session.pendingLegId = legId;
  closeSessions.set(userId, session);

  const legIndex = session.legs.findIndex(l => l.id === legId);
  const leg = session.legs[legIndex];
  const sport = SPORT_NAMES[leg.sport] || leg.sport;

  let desc = `**Leg ${legIndex + 1}**\n`;
  if (leg.bet_category === 'team_game') {
    desc += `${sport}: ${leg.team_a} vs ${leg.team_b}\n`;
    desc += `Pick: **${leg.pick}**`;
  } else {
    desc += `${sport}: ${leg.player_name}\n`;
    desc += `Pick: **${leg.pick}**`;
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`closebet_leg_win_${legId}`)
      .setLabel('✅ Win')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`closebet_leg_loss_${legId}`)
      .setLabel('❌ Loss')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`closebet_leg_push_${legId}`)
      .setLabel('🔄 Push')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`closebet_leg_void_${legId}`)
      .setLabel('⛔ Void')
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.update({
    content: `🎰 **What was the result of this leg?**\n\n${desc}`,
    components: [row],
  });
}

// ─── Handle leg result button → return to dashboard ───
async function handleLegResultButton(interaction) {
  const parts = interaction.customId.split('_');
  const result = parts[2]; // win, loss, push, void
  const legId = parts[3];

  const userId = interaction.user.id;
  const session = closeSessions.get(userId);
  if (!session) {
    return interaction.update({ content: 'Session expired. Use `/closebet` again.', components: [] });
  }

  try {
    // Update leg status in DB
    await db.updateParlayLegStatus(legId, result);

    // Update local session
    const legIndex = session.legs.findIndex(l => l.id === legId);
    if (legIndex !== -1) session.legs[legIndex].status = result;
    closeSessions.set(userId, session);

    // Update the channel embed to reflect leg status changes
    await updateParlayEmbed(interaction, session);

    // Return to dashboard
    return showParlayDashboard(interaction, session, 'update');
  } catch (err) {
    console.error('Error updating leg status:', err);
    await interaction.update({ content: '❌ Error updating leg. Please try again.', components: [] });
  }
}

// Update the parlay embed in the channel
async function updateParlayEmbed(interaction, session) {
  try {
    const fullBet = await db.getBet(session.betId);
    if (fullBet.message_id && fullBet.channel_id) {
      const channel = await interaction.client.channels.fetch(fullBet.channel_id);
      const message = await channel.messages.fetch(fullBet.message_id);
      const embed = buildBetEmbed(
        fullBet,
        interaction.member?.displayName || interaction.user.displayName,
        interaction.user.displayAvatarURL()
      );
      await message.edit({ embeds: [embed] });
    }
  } catch (e) {
    console.warn('Could not update parlay embed:', e.message);
  }
}

// ─── Handle "Close Entire Bet" button ───
async function handleCloseWhole(interaction) {
  const userId = interaction.user.id;
  const session = closeSessions.get(userId);
  if (!session) {
    return interaction.update({ content: 'Session expired. Use `/closebet` again.', components: [] });
  }

  const summary = buildDashboardContent(session);
  showOverallResult(interaction, session.betId, 'update', summary);
}

// ─── Handle "Done for Now" button ───
async function handleDone(interaction) {
  closeSessions.delete(interaction.user.id);
  await interaction.update({
    content: '✅ **Leg updates saved.** The bet remains open. Use `/closebet` again when more legs finish.',
    components: [],
  });
}

// ─── Show overall bet result buttons ───
async function showOverallResult(interaction, betId, method, prefix = '') {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`closebet_result_win_${betId}`)
      .setLabel('✅ Win')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`closebet_result_loss_${betId}`)
      .setLabel('❌ Loss')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`closebet_result_push_${betId}`)
      .setLabel('🔄 Push')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`closebet_result_void_${betId}`)
      .setLabel('⛔ Void')
      .setStyle(ButtonStyle.Secondary),
  );

  const content = `${prefix}**What is the overall bet result?**`;

  if (method === 'update') {
    await interaction.update({ content, components: [row] });
  } else {
    await interaction.editReply({ content, components: [row] });
  }
}

// ─── Handle overall result button ───
async function handleResultButton(interaction) {
  const [, , result, betId] = interaction.customId.split('_');

  try {
    await db.closeBet(betId, result);
    const fullBet = await db.getBet(betId);
    const emoji = STATUS_EMOJI[result];

    // Update the original channel message
    if (fullBet.message_id && fullBet.channel_id) {
      try {
        const channel = await interaction.client.channels.fetch(fullBet.channel_id);
        const message = await channel.messages.fetch(fullBet.message_id);
        const embed = buildBetEmbed(
          fullBet,
          interaction.member?.displayName || interaction.user.displayName,
          interaction.user.displayAvatarURL()
        );
        await message.edit({ embeds: [embed] });
      } catch (e) {
        console.warn('Could not update original bet message:', e.message);
      }
    }

    closeSessions.delete(interaction.user.id);

    await interaction.update({
      content: `${emoji} Bet closed as **${result.toUpperCase()}**!`,
      components: [],
    });
  } catch (err) {
    console.error('Error closing bet:', err);
    await interaction.update({ content: '❌ Error closing bet.', components: [] });
  }
}

module.exports = {
  command,
  execute,
  handleBetSelect,
  handleLegSelect,
  handleLegResultButton,
  handleCloseWhole,
  handleDone,
  handleResultButton,
};
