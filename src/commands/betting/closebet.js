const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const db = require('../../database/queries');
const { PermissionFlagsBits } = require('discord.js');
const { buildBetEmbed } = require('../../utils/embeds');
const { generateBetCardImage } = require('../../utils/betCardImage');
const { SPORT_NAMES, STATUS_EMOJI } = require('../../config/constants');
const { formatOdds } = require('../../utils/odds');

// In-memory sessions for parlay leg closing
const closeSessions = new Map();

const command = new SlashCommandBuilder()
  .setName('closebet')
  .setDescription('Close an open bet as win, loss, or push')
  .addUserOption(option =>
    option.setName('user')
      .setDescription('(Admin) Select a user to close their bets')
      .setRequired(false)
  );

async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  // Admins can select a user to close their bets
  const targetUser = interaction.options.getUser('user');
  let userId = interaction.user.id;
  let isAdmin = false;
  if (targetUser) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.editReply({ content: '❌ Only admins can close bets for other users.' });
    }
    userId = targetUser.id;
    isAdmin = true;
  }

  const openBets = await db.getOpenBets(userId, interaction.guildId);

  if (openBets.length === 0) {
    return interaction.editReply({ content: `📭 ${targetUser ? 'This user has' : 'You have'} no open bets to close.` });
  }

  const options = openBets.slice(0, 25).map(bet => {
    const sport = SPORT_NAMES[bet.sport] || bet.sport || 'Parlay';
    let label;
    if (bet.bet_type === 'parlay') {
      label = `Parlay (${bet.parlay_legs?.length || '?'} legs)`;
    } else if (bet.bet_category === 'team_game') {
      label = `${bet.team_a} vs ${bet.team_b}`;
    } else if (bet.bet_category === 'futures') {
      const parts = bet.pick ? bet.pick.split(': ') : [bet.pick];
      label = parts.length > 1 ? `🏆 ${parts[0]} — ${parts.slice(1).join(': ')}` : `🏆 ${bet.pick}`;
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

  // Store admin session for target user
  if (isAdmin) {
    closeSessions.set(interaction.user.id, { adminFor: userId });
  }

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

  // Check if this is an admin session
  const adminSession = closeSessions.get(interaction.user.id);
  let sessionUserId = interaction.user.id;
  if (adminSession && adminSession.adminFor) {
    sessionUserId = adminSession.adminFor;
  }

  if (bet.bet_type === 'parlay' && bet.parlay_legs?.length > 0) {
    const session = {
      betId,
      legs: bet.parlay_legs.sort((a, b) => a.leg_number - b.leg_number),
    };
    closeSessions.set(sessionUserId, session);
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
    } else if (leg.bet_category === 'futures') {
      const parts = leg.pick ? leg.pick.split(': ') : [leg.pick];
      const market = parts.length > 1 ? parts[0] : 'Futures';
      const selection = parts.length > 1 ? parts.slice(1).join(': ') : leg.pick;
      content += `   ${sport}: 🏆 ${market}\n`;
      content += `   Pick: **${selection}**\n`;
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
  } else if (leg.bet_category === 'futures') {
    const parts = leg.pick ? leg.pick.split(': ') : [leg.pick];
    const market = parts.length > 1 ? parts[0] : 'Futures';
    const selection = parts.length > 1 ? parts.slice(1).join(': ') : leg.pick;
    desc += `${sport}: 🏆 ${market}\n`;
    desc += `Pick: **${selection}**`;
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

// Update the parlay embed in the channel + mirror in open slips
async function updateParlayEmbed(interaction, session) {
  try {
    const fullBet = await db.getBet(session.betId);
    const displayName = interaction.member?.displayName || interaction.user.displayName;
    const { AttachmentBuilder } = require('discord.js');
    const imgBuffer = await generateBetCardImage(fullBet, displayName, interaction.user.displayAvatarURL());

    // Update primary message
    if (fullBet.message_id && fullBet.channel_id) {
      try {
        const channel = await interaction.client.channels.fetch(fullBet.channel_id);
        const message = await channel.messages.fetch(fullBet.message_id);
        const attachment = new AttachmentBuilder(imgBuffer, { name: 'bet-card.png' });
        const editPayload = { files: [attachment], embeds: [], attachments: [] };
        if (fullBet.share_link) editPayload.content = `🔗 **Copy this bet:** <${fullBet.share_link}>`;
        await message.edit(editPayload);
      } catch (e) {
        console.warn('Could not update parlay embed:', e.message);
      }
    }

    // Update mirror message in open slips channel
    if (fullBet.mirror_message_id && fullBet.mirror_channel_id) {
      try {
        const mirrorChannel = await interaction.client.channels.fetch(fullBet.mirror_channel_id);
        const mirrorMsg = await mirrorChannel.messages.fetch(fullBet.mirror_message_id);
        const mirrorAttachment = new AttachmentBuilder(imgBuffer, { name: 'bet-card.png' });
        const mirrorPayload = { files: [mirrorAttachment], embeds: [], attachments: [] };
        if (fullBet.share_link) mirrorPayload.content = `🔗 **Copy this bet:** <${fullBet.share_link}>`;
        await mirrorMsg.edit(mirrorPayload);
      } catch (e) {
        console.warn('Could not update mirror parlay embed:', e.message);
      }
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
        const displayName = interaction.member?.displayName || interaction.user.displayName;
        const { AttachmentBuilder } = require('discord.js');
        const imgBuffer = await generateBetCardImage(fullBet, displayName, interaction.user.displayAvatarURL());
        const attachment = new AttachmentBuilder(imgBuffer, { name: 'bet-card.png' });
        await message.edit({ files: [attachment], embeds: [], attachments: [] });
      } catch (e) {
        console.warn('Could not update original bet message:', e.message);
      }
    }

    // Delete mirror message from open slips channel (bet is now closed)
    if (fullBet.mirror_message_id && fullBet.mirror_channel_id) {
      try {
        const mirrorChannel = await interaction.client.channels.fetch(fullBet.mirror_channel_id);
        const mirrorMsg = await mirrorChannel.messages.fetch(fullBet.mirror_message_id);
        await mirrorMsg.delete();
      } catch (e) {
        console.warn('Could not delete mirror message from open slips:', e.message);
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
