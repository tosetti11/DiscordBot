// --- Tail poll interaction handler ---
const tailedBetsDb = require('../../database/tailedBets');

async function handleTailPoll(interaction) {
  const [prefix, answer, betId] = interaction.customId.split('_');
  if (prefix !== 'tailbet') return;
  const tailed = answer === 'yes';
  const userId = interaction.user.id;

  // Record the tail poll in the DB
  await tailedBetsDb.addTailedBet(betId, userId, tailed);

  // Fetch all tailers for this bet
  const allTails = await interaction.client.database.supabase
    .from('tailed_bets')
    .select('*')
    .eq('bet_id', betId);
  const yesUsers = (allTails.data || []).filter(t => t.tailed).map(t => `<@${t.tailer_discord_id}>`);
  const noUsers = (allTails.data || []).filter(t => !t.tailed).map(t => `<@${t.tailer_discord_id}>`);

  // Update the poll message with the new stats
  let pollContent = 'Are You Tailing This Bet?\n';
  pollContent += `**Yes (${yesUsers.length}):** ${yesUsers.length ? yesUsers.join(', ') : 'None'}\n`;
  pollContent += `**No (${noUsers.length}):** ${noUsers.length ? noUsers.join(', ') : 'None'}`;

  // Keep the buttons
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  const pollRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`tailbet_yes_${betId}`)
      .setLabel('Yes')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`tailbet_no_${betId}`)
      .setLabel('No')
      .setStyle(ButtonStyle.Danger)
  );

  await interaction.update({ content: pollContent, components: [pollRow] });
}
const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { PermissionFlagsBits } = require('discord.js');
const { SPORTS } = require('../../config/constants');
const { americanToDecimal, decimalToAmerican } = require('../../utils/odds');
const { buildBetEmbed } = require('../../utils/embeds');
const db = require('../../database/queries');

// In-memory store for bet-building sessions (cleared on completion)
const betSessions = new Map();

const command = new SlashCommandBuilder()
  .setName('enterbet')
  .setDescription('Enter a new bet to track')
  .addUserOption(option =>
    option.setName('for')
      .setDescription('(Admin) Enter a bet on behalf of another user')
      .setRequired(false)
  );

async function execute(interaction) {
  // Check if admin is entering a bet for someone else
  const forUser = interaction.options.getUser('for');
  let targetUser = null;

  if (forUser) {
    // Only admins can enter bets for others
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Only admins can enter bets for other users.', ephemeral: true });
    }
    if (forUser.bot) {
      return interaction.reply({ content: '❌ You can\'t enter bets for bots.', ephemeral: true });
    }
    targetUser = forUser;
  }

  // Store the target user for later use in the session
  betSessions.set(interaction.user.id, { targetUser });

  const targetLabel = targetUser
    ? (interaction.guild ? (await interaction.guild.members.fetch(targetUser.id).catch(() => null))?.displayName || targetUser.displayName : targetUser.displayName)
    : null;

  // Step 1: Ask single or parlay
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
    content: `🎲 **New Bet**${targetLabel ? ` (for ${targetLabel})` : ''} — What type of bet?`,
    components: [row],
    ephemeral: true,
  });
}

// Handle bet type selection (single/parlay)
async function handleBetTypeSelect(interaction) {
  const betType = interaction.values[0];
  const userId = interaction.user.id;

  // Preserve targetUser from the initial session
  const existingSession = betSessions.get(userId);
  const targetUser = existingSession?.targetUser || null;

  betSessions.set(userId, {
    betType,
    legs: [],
    currentLeg: 0,
    targetUser,
  });

  if (betType === 'parlay') {
    // Ask how many legs
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('enterbet_parlay_count')
        .setPlaceholder('How many legs?')
        .addOptions(
          Array.from({ length: 9 }, (_, i) => ({
            label: `${i + 2} Legs`,
            value: `${i + 2}`,
          }))
        )
    );

    await interaction.update({
      content: '🎰 **Parlay** — How many legs?',
      components: [row],
    });
  } else {
    // Single bet - ask category
    await askBetCategory(interaction, 'single');
  }
}

// Handle parlay leg count
async function handleParlayCountSelect(interaction) {
  const userId = interaction.user.id;
  const session = betSessions.get(userId);
  if (!session) return interaction.update({ content: 'Session expired. Use `/enterbet` again.', components: [] });

  session.totalLegs = parseInt(interaction.values[0]);
  session.currentLeg = 1;
  betSessions.set(userId, session);

  await askBetCategory(interaction, 'parlay');
}

// Ask team game or player prop
async function askBetCategory(interaction, context) {
  const prefix = context === 'parlay' ? `🎰 **Parlay Leg ${betSessions.get(interaction.user.id)?.currentLeg}** — ` : '🎲 **Single Bet** — ';

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('enterbet_category')
      .setPlaceholder('Select bet category')
      .addOptions([
        { label: 'Team Game', value: 'team_game', description: 'Moneyline, spread, or total', emoji: '🏟️' },
        { label: 'Player Prop', value: 'player_prop', description: 'Over/under on a player stat', emoji: '🏀' },
      ])
  );

  await interaction.update({
    content: `${prefix}What kind of bet?`,
    components: [row],
  });
}

// Handle category selection
async function handleCategorySelect(interaction) {
  const userId = interaction.user.id;
  const session = betSessions.get(userId);
  if (!session) return interaction.update({ content: 'Session expired. Use `/enterbet` again.', components: [] });

  session.currentCategory = interaction.values[0];
  betSessions.set(userId, session);

  // Ask sport
  const sportOptions = SPORTS.map(s => ({
    label: s.name,
    value: s.value,
  }));

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('enterbet_sport')
      .setPlaceholder('Select sport')
      .addOptions(sportOptions)
  );

  const prefix = session.betType === 'parlay'
    ? `🎰 **Parlay Leg ${session.currentLeg}** — `
    : '🎲 **Single Bet** — ';

  await interaction.update({
    content: `${prefix}Which sport?`,
    components: [row],
  });
}

// Handle sport selection -> ask wager type (for team games) or show prop modal
async function handleSportSelect(interaction) {
  const userId = interaction.user.id;
  const session = betSessions.get(userId);
  if (!session) return interaction.update({ content: 'Session expired. Use `/enterbet` again.', components: [] });

  session.currentSport = interaction.values[0];
  betSessions.set(userId, session);

  if (session.currentCategory === 'player_prop') {
    // Player props skip wager type — go straight to modal
    await showPlayerPropModal(interaction, session);
  } else {
    // Team game — ask wager type
    const prefix = session.betType === 'parlay'
      ? `🎰 **Parlay Leg ${session.currentLeg}** — `
      : '🎲 **Single Bet** — ';

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('enterbet_wager_type')
        .setPlaceholder('Select wager type')
        .addOptions([
          { label: 'Moneyline', value: 'moneyline', description: 'Pick the winner', emoji: '💰' },
          { label: 'Spread', value: 'spread', description: 'Point spread bet', emoji: '📊' },
          { label: 'Over/Under', value: 'total', description: 'Total points line', emoji: '🔢' },
        ])
    );

    await interaction.update({
      content: `${prefix}What type of wager?`,
      components: [row],
    });
  }
}

// Handle wager type selection -> open modal
async function handleWagerTypeSelect(interaction) {
  const userId = interaction.user.id;
  const session = betSessions.get(userId);
  if (!session) return interaction.update({ content: 'Session expired. Use `/enterbet` again.', components: [] });

  session.currentWagerType = interaction.values[0];
  betSessions.set(userId, session);

  await showTeamGameModal(interaction, session);
}

// Modal for team game bets (adapts based on wager type)
async function showTeamGameModal(interaction, session) {
  const legLabel = session.betType === 'parlay' ? ` (Leg ${session.currentLeg})` : '';
  const wagerType = session.currentWagerType;

  const wagerLabels = { moneyline: 'Moneyline', spread: 'Spread', total: 'Over/Under' };
  const modal = new ModalBuilder()
    .setCustomId('enterbet_team_modal')
    .setTitle(`${wagerLabels[wagerType]} Bet${legLabel}`);

  const teamAInput = new TextInputBuilder()
    .setCustomId('team_a')
    .setLabel('Team A (your pick)')
    .setPlaceholder('e.g. Duke')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const teamBInput = new TextInputBuilder()
    .setCustomId('team_b')
    .setLabel('Team B (opponent)')
    .setPlaceholder('e.g. UNC')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const oddsInput = new TextInputBuilder()
    .setCustomId('odds')
    .setLabel('Odds (American)')
    .setPlaceholder('e.g. -110, +150')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(20);

  const unitsInput = new TextInputBuilder()
    .setCustomId('units')
    .setLabel('Units')
    .setPlaceholder('e.g. 1, 2, 5')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(10);

  const fields = [
    new ActionRowBuilder().addComponents(teamAInput),
    new ActionRowBuilder().addComponents(teamBInput),
  ];

  // Add line field for spread or total (not moneyline)
  if (wagerType === 'spread') {
    const spreadInput = new TextInputBuilder()
      .setCustomId('line_value')
      .setLabel('Spread')
      .setPlaceholder('e.g. -1.5, +3, -7')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(10);
    fields.push(new ActionRowBuilder().addComponents(spreadInput));
  } else if (wagerType === 'total') {
    const totalInput = new TextInputBuilder()
      .setCustomId('line_value')
      .setLabel('Over/Under line')
      .setPlaceholder('e.g. 220.5, 48.5')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(10);
    fields.push(new ActionRowBuilder().addComponents(totalInput));
  }

  // Add odds field only for single bets — parlays get total odds at the end
  if (session.betType !== 'parlay') {
    fields.push(new ActionRowBuilder().addComponents(oddsInput));
  }

  // Only show units/note for single bets — parlays set odds/units on the whole slip
  if (session.betType !== 'parlay') {
    fields.push(new ActionRowBuilder().addComponents(unitsInput));

    // Add note field if there's room (moneyline = 4 fields so far, spread/total = 5)
    if (wagerType === 'moneyline') {
      const noteInput = new TextInputBuilder()
        .setCustomId('bet_note')
        .setLabel('Note (optional)')
        .setPlaceholder('e.g. Lock of the day')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(200);
      fields.push(new ActionRowBuilder().addComponents(noteInput));
    }
  }

  modal.addComponents(...fields);

  await interaction.showModal(modal);
}

// Modal for player prop bets
async function showPlayerPropModal(interaction, session) {
  const legLabel = session.betType === 'parlay' ? ` (Leg ${session.currentLeg})` : '';

  const modal = new ModalBuilder()
    .setCustomId('enterbet_prop_modal')
    .setTitle(`Player Prop Bet${legLabel}`);

  const playerInput = new TextInputBuilder()
    .setCustomId('player_name')
    .setLabel('Player Name')
    .setPlaceholder('e.g. LeBron James')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const propInput = new TextInputBuilder()
    .setCustomId('prop_desc')
    .setLabel('Prop (e.g. Over 25.5 Points)')
    .setPlaceholder('e.g. Over 25.5 Points')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(200);

  const oddsInput = new TextInputBuilder()
    .setCustomId('odds')
    .setLabel('Odds (American, e.g. -110)')
    .setPlaceholder('-110')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(20);

  const unitsInput = new TextInputBuilder()
    .setCustomId('units')
    .setLabel('Units')
    .setPlaceholder('e.g. 1, 2, 5')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(10);

  const noteInput = new TextInputBuilder()
    .setCustomId('bet_note')
    .setLabel('Note (optional)')
    .setPlaceholder('e.g. Bron is averaging 28 ppg')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(200);

  const propFields = [
    new ActionRowBuilder().addComponents(playerInput),
    new ActionRowBuilder().addComponents(propInput),
  ];

  // Only show odds/units/note for single bets — parlays get total odds at the end
  if (session.betType !== 'parlay') {
    propFields.push(new ActionRowBuilder().addComponents(oddsInput));
    propFields.push(new ActionRowBuilder().addComponents(unitsInput));
    propFields.push(new ActionRowBuilder().addComponents(noteInput));
  }

  modal.addComponents(...propFields);

  await interaction.showModal(modal);
}

// Handle team game modal submit
async function handleTeamModalSubmit(interaction) {
  const userId = interaction.user.id;
  const session = betSessions.get(userId);
  if (!session) return interaction.reply({ content: 'Session expired. Use `/enterbet` again.', ephemeral: true });

  const teamA = interaction.fields.getTextInputValue('team_a').trim();
  const teamB = interaction.fields.getTextInputValue('team_b').trim();

  // Units and odds only present for single bets (parlays set these on the whole slip)
  const isParlay = session.betType === 'parlay';

  // Wager type was already selected via the menu
  const wagerType = session.currentWagerType;
  let spreadValue = null;

  // Parse line value for spread/total
  if (wagerType === 'spread' || wagerType === 'total') {
    const lineRaw = interaction.fields.getTextInputValue('line_value').trim();
    spreadValue = parseFloat(lineRaw);
    if (isNaN(spreadValue)) {
      return interaction.reply({ content: '❌ Invalid line value. Enter a number (e.g. -1.5, 220.5)', ephemeral: true });
    }
  }

  // Parse odds (only for single bets)
  let oddsAmerican = null;
  let oddsDecimal = null;
  if (!isParlay) {
    const oddsRaw = interaction.fields.getTextInputValue('odds').trim();
    oddsAmerican = parseInt(oddsRaw);
    if (isNaN(oddsAmerican)) {
      return interaction.reply({ content: '❌ Invalid odds. Enter American odds (e.g. -110, +150)', ephemeral: true });
    }
    oddsDecimal = americanToDecimal(oddsAmerican);
  }

  // Parse units (only for single bets)
  let units = null;
  if (!isParlay) {
    const unitsRaw = interaction.fields.getTextInputValue('units').trim();
    units = parseFloat(unitsRaw);
    if (isNaN(units) || units <= 0) {
      return interaction.reply({ content: '❌ Invalid units. Enter a positive number.', ephemeral: true });
    }
  }

  // Note is optional (only available for single moneyline where there's room for 5th field)
  let betNote = null;
  if (!isParlay) {
    try { betNote = interaction.fields.getTextInputValue('bet_note')?.trim() || null; } catch (e) { /* no note field */ }
  }

  // Build pick string
  let pick;
  if (wagerType === 'moneyline') {
    pick = `${teamA} ML`;
  } else if (wagerType === 'spread') {
    pick = `${teamA} ${spreadValue > 0 ? '+' : ''}${spreadValue}`;
  } else {
    pick = `${spreadValue > 0 ? 'Over' : 'Under'} ${Math.abs(spreadValue)}`;
  }

  const legData = {
    sport: session.currentSport,
    bet_category: 'team_game',
    team_a: teamA,
    team_b: teamB,
    pick,
    wager_type: wagerType,
    spread_value: spreadValue,
    odds_american: oddsAmerican,
    odds_decimal: oddsDecimal,
  };

  if (session.betType === 'parlay') {
    session.legs.push(legData);
    session.currentLeg++;
    betSessions.set(userId, session);

    if (session.currentLeg <= session.totalLegs) {
      // More legs to enter
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('enterbet_category')
          .setPlaceholder('Select bet category')
          .addOptions([
            { label: 'Team Game', value: 'team_game', description: 'Moneyline, spread, or total', emoji: '🏟️' },
            { label: 'Player Prop', value: 'player_prop', description: 'Over/under on a player stat', emoji: '🏀' },
          ])
      );

      return interaction.reply({
        content: `✅ Leg ${session.currentLeg - 1} added! Now enter **Leg ${session.currentLeg}** of ${session.totalLegs}:`,
        components: [row],
        ephemeral: true,
      });
    }

    // All legs entered - show button to open parlay final modal
    // (Can't show a modal from a modal submit, so use a button as intermediary)
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('enterbet_parlay_final_btn')
        .setLabel('Enter Parlay Details (Odds & Units)')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📋')
    );

    return interaction.reply({
      content: `✅ All **${session.totalLegs} legs** entered! Click below to enter your total parlay odds and units.`,
      components: [row],
      ephemeral: true,
    });
  }

  // Single bet - show confirmation
  session.pendingLegData = legData;
  session.pendingUnits = units;
  session.pendingBetNote = betNote;
  betSessions.set(userId, session);

  await showBetConfirmation(interaction, session, legData, units, betNote);
}

// Show confirmation prompt before placing bet
async function showBetConfirmation(interaction, session, legData, units, betNote) {
  const { SPORT_NAMES, WAGER_TYPES } = require('../../config/constants');
  const { formatOdds } = require('../../utils/odds');

  const sportName = SPORT_NAMES[legData.sport] || legData.sport;
  let summary;

  if (legData.bet_category === 'team_game') {
    summary = `**${sportName}**: ${legData.team_a} vs ${legData.team_b}\n**Pick**: ${legData.pick}\n**Odds**: ${formatOdds(legData.odds_american)}\n**Units**: ${units}u`;
  } else {
    summary = `**${sportName}**: ${legData.player_name}\n**Prop**: ${legData.pick}\n**Odds**: ${formatOdds(legData.odds_american)}\n**Units**: ${units}u`;
  }
  if (betNote) summary += `\n**Note**: ${betNote}`;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('enterbet_confirm')
      .setLabel('✅ Confirm Bet')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('enterbet_cancel')
      .setLabel('❌ Cancel')
      .setStyle(ButtonStyle.Danger),
  );

  await interaction.reply({
    content: `⚠️ **Are you sure you want to place this bet?**\n\n${summary}`,
    components: [row],
    ephemeral: true,
  });
}

// Handle player prop modal submit
async function handlePropModalSubmit(interaction) {
  const userId = interaction.user.id;
  const session = betSessions.get(userId);
  if (!session) return interaction.reply({ content: 'Session expired. Use `/enterbet` again.', ephemeral: true });

  const playerName = interaction.fields.getTextInputValue('player_name').trim();
  const propDesc = interaction.fields.getTextInputValue('prop_desc').trim();

  // Odds/units only present for single bets (parlays set these on the whole slip)
  const isParlay = session.betType === 'parlay';

  let oddsAmerican = null;
  let oddsDecimal = null;
  let units = null;
  let betNote = null;

  if (!isParlay) {
    const oddsRaw = interaction.fields.getTextInputValue('odds').trim();
    oddsAmerican = parseInt(oddsRaw);
    if (isNaN(oddsAmerican)) {
      return interaction.reply({ content: '\u274c Invalid odds. Enter American odds (e.g. -110, +150)', ephemeral: true });
    }
    oddsDecimal = americanToDecimal(oddsAmerican);

    const unitsRaw = interaction.fields.getTextInputValue('units').trim();
    units = parseFloat(unitsRaw);
    if (isNaN(units) || units <= 0) {
      return interaction.reply({ content: '\u274c Invalid units. Enter a positive number.', ephemeral: true });
    }
    try { betNote = interaction.fields.getTextInputValue('bet_note')?.trim() || null; } catch (e) { /* no note field */ }
  }

  const legData = {
    sport: session.currentSport,
    bet_category: 'player_prop',
    player_name: playerName,
    prop_description: propDesc,
    pick: propDesc,
    wager_type: 'prop',
    odds_american: oddsAmerican,
    odds_decimal: oddsDecimal,
  };

  if (session.betType === 'parlay') {
    session.legs.push(legData);
    session.currentLeg++;
    betSessions.set(userId, session);

    if (session.currentLeg <= session.totalLegs) {
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('enterbet_category')
          .setPlaceholder('Select bet category')
          .addOptions([
            { label: 'Team Game', value: 'team_game', description: 'Moneyline, spread, or total', emoji: '🏟️' },
            { label: 'Player Prop', value: 'player_prop', description: 'Over/under on a player stat', emoji: '🏀' },
          ])
      );

      return interaction.reply({
        content: `✅ Leg ${session.currentLeg - 1} added! Now enter **Leg ${session.currentLeg}** of ${session.totalLegs}:`,
        components: [row],
        ephemeral: true,
      });
    }

    // All legs entered - show button to open parlay final modal
    // (Can't show a modal from a modal submit, so use a button as intermediary)
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('enterbet_parlay_final_btn')
        .setLabel('Enter Parlay Details (Odds & Units)')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📋')
    );

    return interaction.reply({
      content: `✅ All **${session.totalLegs} legs** entered! Click below to enter your total parlay odds and units.`,
      components: [row],
      ephemeral: true,
    });
  }

  // Single bet - show confirmation
  session.pendingLegData = legData;
  session.pendingUnits = units;
  session.pendingBetNote = betNote;
  betSessions.set(userId, session);

  await showBetConfirmation(interaction, session, legData, units, betNote);
}

// Handle parlay final button click -> show modal
async function handleParlayFinalButton(interaction) {
  const userId = interaction.user.id;
  const session = betSessions.get(userId);
  if (!session) return interaction.reply({ content: 'Session expired. Use `/enterbet` again.', ephemeral: true });

  const modal = new ModalBuilder()
    .setCustomId('enterbet_parlay_final')
    .setTitle('Parlay Final Details');

  const oddsInput = new TextInputBuilder()
    .setCustomId('total_odds')
    .setLabel('Total Parlay Odds (American)')
    .setPlaceholder('e.g. +650')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const unitsInput = new TextInputBuilder()
    .setCustomId('units')
    .setLabel('Units')
    .setPlaceholder('e.g. 1, 2, 5')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const noteInput = new TextInputBuilder()
    .setCustomId('bet_note')
    .setLabel('Note (optional)')
    .setPlaceholder('e.g. Feeling lucky')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(200);

  modal.addComponents(
    new ActionRowBuilder().addComponents(oddsInput),
    new ActionRowBuilder().addComponents(unitsInput),
    new ActionRowBuilder().addComponents(noteInput),
  );

  await interaction.showModal(modal);
}

// Handle parlay final modal
async function handleParlayFinalSubmit(interaction) {
  const userId = interaction.user.id;
  const session = betSessions.get(userId);
  if (!session) return interaction.reply({ content: 'Session expired. Use `/enterbet` again.', ephemeral: true });

  const oddsAmerican = parseInt(interaction.fields.getTextInputValue('total_odds').trim());
  const unitsRaw = interaction.fields.getTextInputValue('units').trim();

  if (isNaN(oddsAmerican)) {
    return interaction.reply({ content: '❌ Invalid odds.', ephemeral: true });
  }

  const units = parseFloat(unitsRaw);
  if (isNaN(units) || units <= 0) {
    return interaction.reply({ content: '❌ Invalid units.', ephemeral: true });
  }

  let betNote = null;
  try { betNote = interaction.fields.getTextInputValue('bet_note')?.trim() || null; } catch (e) { /* no note field */ }

  const oddsDecimal = americanToDecimal(oddsAmerican);

  try {
    // Store pending parlay data for confirmation
    session.pendingParlayData = {
      oddsAmerican,
      oddsDecimal,
      units,
      betNote,
    };
    betSessions.set(userId, session);

    const { formatOdds } = require('../../utils/odds');
    let summary = `**Parlay (${session.legs.length} Legs)** at ${formatOdds(oddsAmerican)}\n**Units**: ${units}u\n`;
    session.legs.forEach((leg, i) => {
      const { SPORT_NAMES } = require('../../config/constants');
      const sn = SPORT_NAMES[leg.sport] || leg.sport;
      summary += `\n**Leg ${i + 1}**: ${sn} — ${leg.pick}`;
    });
    if (betNote) summary += `\n**Note**: ${betNote}`;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('enterbet_confirm')
        .setLabel('✅ Confirm Bet')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('enterbet_cancel')
        .setLabel('❌ Cancel')
        .setStyle(ButtonStyle.Danger),
    );

    await interaction.reply({
      content: `⚠️ **Are you sure you want to place this bet?**\n\n${summary}`,
      components: [row],
      ephemeral: true,
    });
  } catch (err) {
    console.error('Error preparing parlay confirmation:', err);
    await interaction.reply({ content: '❌ Error. Please try again.', ephemeral: true });
  }
}

// Handle confirm/cancel button for bet placement
async function handleBetConfirm(interaction) {
  const userId = interaction.user.id;
  const session = betSessions.get(userId);
  if (!session) return interaction.update({ content: '❌ Session expired. Use `/enterbet` again.', components: [] });

  if (session.betType === 'parlay') {
    await saveParlayBet(interaction, session);
  } else {
    await saveSingleBet(interaction, session.pendingLegData, session.pendingUnits, session.pendingBetNote);
  }
}

async function handleBetCancel(interaction) {
  const userId = interaction.user.id;
  betSessions.delete(userId);
  await interaction.update({ content: '❌ Bet cancelled.', components: [] });
}

// Save a parlay bet to DB and post embed
async function saveParlayBet(interaction, session) {
  const userId = interaction.user.id;
  const { oddsAmerican, oddsDecimal, units, betNote } = session.pendingParlayData;

  // Determine the actual bettor (target user or the interaction user)
  const bettor = session.targetUser || interaction.user;
  // Get server display name
  const displayName = interaction.guild
    ? (await interaction.guild.members.fetch(bettor.id).catch(() => null))?.displayName || bettor.displayName
    : bettor.displayName;

  try {
    const user = await db.getOrCreateUser(bettor);

    // Resolve channel (may be null on ephemeral button interactions)
    const channel = interaction.channel || await interaction.client.channels.fetch(interaction.channelId);

    const bet = await db.createBet({
      user_id: user.id,
      discord_id: bettor.id,
      guild_id: interaction.guildId,
      channel_id: interaction.channelId,
      bet_type: 'parlay',
      odds_american: oddsAmerican,
      odds_decimal: oddsDecimal,
      units,
      bet_note: betNote,
      status: 'open',
    }, displayName);

    // Create parlay legs
    const legRecords = session.legs.map((leg, i) => ({
      bet_id: bet.id,
      leg_number: i + 1,
      ...leg,
    }));

    await db.createParlayLegs(legRecords);

    // Fetch the full bet with legs
    const fullBet = await db.getBet(bet.id);

    const embed = buildBetEmbed(
      fullBet,
      displayName,
      bettor.displayAvatarURL()
    );

    // Add poll buttons
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const pollRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`tailbet_yes_${bet.id}`)
        .setLabel('Yes')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`tailbet_no_${bet.id}`)
        .setLabel('No')
        .setStyle(ButtonStyle.Danger)
    );

    // Post to channel
    const message = await channel.send({
      embeds: [embed],
      components: [pollRow],
      content: 'Are You Tailing This Bet?'
    });
    await db.updateBetMessageId(bet.id, message.id);

    const forLabel = session.targetUser ? ` for **${displayName}**` : '';
    await interaction.update({
      content: `✅ Parlay posted${forLabel}! Slip **${bet.slip_number}** (${session.legs.length} legs, ${units}u at ${oddsAmerican >= 0 ? '+' : ''}${oddsAmerican})`,
      components: [],
    });

    betSessions.delete(userId);
  } catch (err) {
    console.error('Error saving parlay:', err);
    const msg = err.code === 50001
      ? '❌ Bot lacks permission to post in this channel. Give the bot **Send Messages** access, then try again.'
      : '❌ Error saving bet. Please try again.';
    await interaction.update({ content: msg, components: [] });
  }
}

// Save a single bet to DB and post embed
async function saveSingleBet(interaction, legData, units, betNote) {
  const session = betSessions.get(interaction.user.id);
  // Determine the actual bettor (target user or the interaction user)
  const bettor = session?.targetUser || interaction.user;
  // Get server display name
  const displayName = interaction.guild
    ? (await interaction.guild.members.fetch(bettor.id).catch(() => null))?.displayName || bettor.displayName
    : bettor.displayName;

  try {
    const user = await db.getOrCreateUser(bettor);

    // Resolve channel (may be null on ephemeral button interactions)
    const channel = interaction.channel || await interaction.client.channels.fetch(interaction.channelId);

    const bet = await db.createBet({
      user_id: user.id,
      discord_id: bettor.id,
      guild_id: interaction.guildId,
      channel_id: interaction.channelId,
      bet_type: 'single',
      ...legData,
      units,
      bet_note: betNote,
      status: 'open',
    }, displayName);

    const embed = buildBetEmbed(
      bet,
      displayName,
      bettor.displayAvatarURL()
    );

    // Add poll buttons
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const pollRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`tailbet_yes_${bet.id}`)
        .setLabel('Yes')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`tailbet_no_${bet.id}`)
        .setLabel('No')
        .setStyle(ButtonStyle.Danger)
    );

    // Post to channel (visible to everyone)
    const message = await channel.send({
      embeds: [embed],
      components: [pollRow],
      content: 'Are You Tailing This Bet?'
    });
    await db.updateBetMessageId(bet.id, message.id);

    const forLabel = session?.targetUser ? ` for **${displayName}**` : '';
    await interaction.update({
      content: `✅ Bet posted${forLabel}! Slip **${bet.slip_number}** — ${legData.pick} (${units}u)`,
      components: [],
    });

    betSessions.delete(interaction.user.id);
  } catch (err) {
    console.error('Error saving bet:', err);
    const msg = err.code === 50001
      ? '❌ Bot lacks permission to post in this channel. Give the bot **Send Messages** access, then try again.'
      : '❌ Error saving bet. Please try again.';
    await interaction.update({ content: msg, components: [] });
  }
}

module.exports = {
  command,
  execute,
  handleBetTypeSelect,
  handleParlayCountSelect,
  handleCategorySelect,
  handleSportSelect,
  handleWagerTypeSelect,
  handleTeamModalSubmit,
  handlePropModalSubmit,
  handleParlayFinalButton,
  handleParlayFinalSubmit,
  handleBetConfirm,
  handleBetCancel,
  betSessions,
  handleTailPoll,
};
