// --- Tail poll interaction handler ---
const tailedBetsDb = require('../../database/tailedBets');
const { supabase } = require('../../config/supabase');
const { notifyFollowers, notifyBetOwner } = require('../../utils/notifications');

async function handleTailPoll(interaction) {
  const [prefix, answer, betId] = interaction.customId.split('_');
  if (prefix !== 'tailbet') return;
  const tailed = answer === 'yes';
  const userId = interaction.user.id;

  try {
    // Block self-tailing: look up who owns this bet
    const { data: bet, error: betErr } = await supabase
      .from('bets')
      .select('discord_id')
      .eq('id', betId)
      .single();
    if (betErr) throw betErr;

    if (bet.discord_id === userId) {
      return interaction.reply({ content: '❌ You can\'t tail your own bet!', ephemeral: true });
    }

    // Check if user already has the same vote — toggle off if so
    const existing = await tailedBetsDb.getTailedBet(betId, userId);
    let isNewAction = false;
    if (existing && existing.tailed === tailed) {
      // Same button clicked again — remove the vote
      await tailedBetsDb.removeTailedBet(betId, userId);
    } else {
      // New vote or switching vote
      await tailedBetsDb.addTailedBet(betId, userId, tailed);
      isNewAction = true;
    }

    // DM the bet owner when someone tails/fades (only on new action, not toggle-off)
    if (isNewAction && bet.discord_id !== userId) {
      const tailerName = interaction.user.displayName || interaction.user.username;
      const action = tailed ? 'tailed' : 'faded';
      // Fetch bet details for the DM
      const { data: betDetails } = await supabase
        .from('bets')
        .select('pick, odds_american')
        .eq('id', betId)
        .single();
      notifyBetOwner(interaction.client, bet.discord_id, tailerName, action, betDetails || {});
    }

    // Fetch all tailers for this bet
    const { data: allTails, error } = await supabase
      .from('tailed_bets')
      .select('*')
      .eq('bet_id', betId);
    if (error) throw error;

    const yesUsers = (allTails || []).filter(t => t.tailed).map(t => `<@${t.tailer_discord_id}>`);
    const noCount = (allTails || []).filter(t => !t.tailed).length;

    // Update the poll message with the new stats
    let pollContent = '**Are You Tailing This Bet?**\n\n';
    pollContent += `👍 **Tailing (${yesUsers.length}):** ${yesUsers.length ? yesUsers.join(', ') : 'None'}\n`;
    pollContent += `👎 **Fading (${noCount})**`;

    // Keep the buttons
    const pollRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`tailbet_yes_${betId}`)
        .setLabel(`✅ Tail (${yesUsers.length})`)
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`tailbet_no_${betId}`)
        .setLabel(`❌ Fade (${noCount})`)
        .setStyle(ButtonStyle.Danger)
    );

    await interaction.update({ content: pollContent, components: [pollRow] });
  } catch (err) {
    console.error('[TailPoll] Error:', err);
    try {
      await interaction.reply({ content: '❌ Error recording your vote. Please try again.', ephemeral: true });
    } catch (e) {
      // interaction may have already been responded to
    }
  }
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
const { PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const { SPORTS } = require('../../config/constants');
const { americanToDecimal, decimalToAmerican } = require('../../utils/odds');
const { buildBetEmbed } = require('../../utils/embeds');

// Helper: append share link to message content
function appendShareLink(content, shareLink) {
  if (!shareLink) return content;
  return `${content}\n\n🔗 **Copy this bet:** <${shareLink}>`;
}
const { generateBetCardImage } = require('../../utils/betCardImage');
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
    content: `🏀 **New Bet**${targetLabel ? ` (for ${targetLabel})` : ''} — What type of bet?\n\n` +
      `**Please select the appropriate channel for your bet:**\n` +
      `- <#1465758102887600401> for Daily Action\n` +
      `- <#1472806734081949746> for Parlay Mania\n` +
      `- <#1466427115363893431> for Over Under Extravaganza\n` +
      `- Whale channels are reserved for plays from the King and other whales.`,
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
  const isWhale = existingSession?.isWhale || false;
  const isRetro = existingSession?.isRetro || false;

  betSessions.set(userId, {
    betType,
    legs: [],
    currentLeg: 0,
    targetUser,
    isWhale,
    isRetro,
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
        { label: 'Futures', value: 'futures', description: 'Championship, MVP, season wins', emoji: '🏆' },
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
  } else if (session.currentCategory === 'futures') {
    // Futures skip wager type — go straight to modal
    await showFuturesModal(interaction, session);
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

// Handle wager type selection -> open modal (or over/under menu for totals)
async function handleWagerTypeSelect(interaction) {
  const userId = interaction.user.id;
  const session = betSessions.get(userId);
  if (!session) return interaction.update({ content: 'Session expired. Use `/enterbet` again.', components: [] });

  session.currentWagerType = interaction.values[0];
  betSessions.set(userId, session);

  // For total bets, ask Over or Under first
  if (session.currentWagerType === 'total') {
    const legLabel = session.betType === 'parlay' ? ` (Leg ${session.currentLeg})` : '';
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('enterbet_over_under')
        .setPlaceholder('Over or Under?')
        .addOptions([
          { label: 'Over', value: 'Over', emoji: '⬆️' },
          { label: 'Under', value: 'Under', emoji: '⬇️' },
        ])
    );
    return interaction.update({
      content: `🔢 Over or Under?${legLabel}`,
      components: [row],
    });
  }

  await showTeamGameModal(interaction, session);
}

// Handle over/under selection -> open team modal
async function handleOverUnderSelect(interaction) {
  const userId = interaction.user.id;
  const session = betSessions.get(userId);
  if (!session) return interaction.update({ content: 'Session expired. Use `/enterbet` again.', components: [] });

  session.overUnder = interaction.values[0]; // 'Over' or 'Under'
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
      .setLabel(`${session.overUnder || 'Over/Under'} — Total Line`)
      .setPlaceholder('e.g. 220.5, 48.5')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(10);
    fields.push(new ActionRowBuilder().addComponents(totalInput));
  }

  if (session.betType === 'parlay') {
    // Parlay legs: add event start time (no odds/units per leg — plenty of room)
    const startTimeInput = new TextInputBuilder()
      .setCustomId('event_start_time')
      .setLabel('Game Start Time (optional)')
      .setPlaceholder('e.g. Sun 1:00 PM ET, 7:30 PM EST')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(50);
    fields.push(new ActionRowBuilder().addComponents(startTimeInput));
  } else {
    // Single bets: add odds + units (game time & note collected in step 2 modal)
    fields.push(new ActionRowBuilder().addComponents(oddsInput));
    fields.push(new ActionRowBuilder().addComponents(unitsInput));
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

  const propFields = [
    new ActionRowBuilder().addComponents(playerInput),
    new ActionRowBuilder().addComponents(propInput),
  ];

  if (session.betType === 'parlay') {
    // Parlay legs: add event start time (no odds/units per leg)
    const startTimeInput = new TextInputBuilder()
      .setCustomId('event_start_time')
      .setLabel('Game Start Time (optional)')
      .setPlaceholder('e.g. Sun 1:00 PM ET, 7:30 PM EST')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(50);
    propFields.push(new ActionRowBuilder().addComponents(startTimeInput));
  } else {
    // Single bets: add odds + units (game time & note collected in step 2 modal)
    propFields.push(new ActionRowBuilder().addComponents(oddsInput));
    propFields.push(new ActionRowBuilder().addComponents(unitsInput));
  }

  modal.addComponents(...propFields);

  await interaction.showModal(modal);
}

// Modal for futures bets (market-style like sportsbooks)
async function showFuturesModal(interaction, session) {
  const legLabel = session.betType === 'parlay' ? ` (Leg ${session.currentLeg})` : '';

  const modal = new ModalBuilder()
    .setCustomId('enterbet_futures_modal')
    .setTitle(`Futures Bet${legLabel}`);

  const marketInput = new TextInputBuilder()
    .setCustomId('futures_market')
    .setLabel('Market')
    .setPlaceholder('e.g. Super Bowl LIX Winner, 2025 NBA MVP')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(200);

  const selectionInput = new TextInputBuilder()
    .setCustomId('futures_selection')
    .setLabel('Selection / Pick')
    .setPlaceholder('e.g. Chiefs, Jokic, Oilers')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const oddsInput = new TextInputBuilder()
    .setCustomId('odds')
    .setLabel('Odds (American, e.g. +500)')
    .setPlaceholder('+500')
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
    .setPlaceholder('e.g. Great value at this price')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(200);

  const futuresFields = [
    new ActionRowBuilder().addComponents(marketInput),
    new ActionRowBuilder().addComponents(selectionInput),
  ];

  if (session.betType !== 'parlay') {
    // Single futures: Market, Selection, Odds, Units, Note (5 fields — no two-step needed)
    futuresFields.push(new ActionRowBuilder().addComponents(oddsInput));
    futuresFields.push(new ActionRowBuilder().addComponents(unitsInput));
    futuresFields.push(new ActionRowBuilder().addComponents(noteInput));
  } else {
    // Parlay leg: just Market + Selection (odds/units set on whole slip)
    // No need for event start time on futures — the market name implies timing
  }

  modal.addComponents(...futuresFields);
  await interaction.showModal(modal);
}

// Handle futures modal submit
async function handleFuturesModalSubmit(interaction) {
  const userId = interaction.user.id;
  const session = betSessions.get(userId);
  if (!session) return interaction.reply({ content: 'Session expired. Use `/enterbet` again.', ephemeral: true });

  const futuresMarket = interaction.fields.getTextInputValue('futures_market').trim();
  const futuresSelection = interaction.fields.getTextInputValue('futures_selection').trim();
  const isParlay = session.betType === 'parlay';

  let oddsAmerican = null;
  let oddsDecimal = null;
  let units = null;
  let betNote = null;

  if (!isParlay) {
    const oddsRaw = interaction.fields.getTextInputValue('odds').trim();
    oddsAmerican = parseInt(oddsRaw);
    if (isNaN(oddsAmerican)) {
      return interaction.reply({ content: '❌ Invalid odds. Enter American odds (e.g. +500)', ephemeral: true });
    }
    oddsDecimal = americanToDecimal(oddsAmerican);

    const unitsRaw = interaction.fields.getTextInputValue('units').trim();
    units = parseFloat(unitsRaw);
    if (isNaN(units) || units <= 0) {
      return interaction.reply({ content: '❌ Invalid units. Enter a positive number.', ephemeral: true });
    }

    try { betNote = interaction.fields.getTextInputValue('bet_note')?.trim() || null; } catch (e) { /* no field */ }
  }

  // Build pick string: "Market → Selection"
  const pick = `${futuresMarket}: ${futuresSelection}`;

  const legData = {
    sport: session.currentSport,
    bet_category: 'futures',
    futures_market: futuresMarket,
    futures_selection: futuresSelection,
    pick,
    wager_type: 'futures',
    odds_american: oddsAmerican,
    odds_decimal: oddsDecimal,
    event_start_time: null, // Futures don't need event_start_time — market name implies timing
  };

  if (isParlay) {
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
            { label: 'Futures', value: 'futures', description: 'Championship, MVP, season wins', emoji: '🏆' },
          ])
      );

      return interaction.reply({
        content: `✅ Leg ${session.currentLeg - 1} added! Now enter **Leg ${session.currentLeg}** of ${session.totalLegs}:`,
        components: [row],
        ephemeral: true,
      });
    }

    // All legs entered
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

  // Single futures bet - show confirmation
  session.pendingLegData = legData;
  session.pendingUnits = units;
  session.pendingBetNote = betNote;
  betSessions.set(userId, session);

  await showBetConfirmation(interaction, session, legData, units, betNote);
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

  // Note is NOT in this modal anymore — collected in step 2 details modal
  let betNote = null;

  // Read event start time (available in parlay leg modals only)
  let eventStartTime = null;
  try { eventStartTime = interaction.fields.getTextInputValue('event_start_time')?.trim() || null; } catch (e) { /* no field for single bets */ }

  // Build pick string
  let pick;
  if (wagerType === 'moneyline') {
    pick = `${teamA} ML`;
  } else if (wagerType === 'spread') {
    pick = `${teamA} ${spreadValue > 0 ? '+' : ''}${spreadValue}`;
  } else {
    // total — use the over/under choice from session
    const direction = session.overUnder || (spreadValue > 0 ? 'Over' : 'Under');
    pick = `${direction} ${Math.abs(spreadValue)}`;
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
    event_start_time: eventStartTime,
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
            { label: 'Futures', value: 'futures', description: 'Championship, MVP, season wins', emoji: '🏆' },
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

  // Single bet - show "Continue" button for step 2 (game time + note)
  session.pendingLegData = legData;
  session.pendingUnits = units;
  session.pendingBetNote = null; // Will be set in details modal
  betSessions.set(userId, session);

  await showDetailsPrompt(interaction, session, legData, units);
}

// Show prompt with button to open step 2 details modal (game time + note)
async function showDetailsPrompt(interaction, session, legData, units) {
  const { SPORT_NAMES } = require('../../config/constants');
  const { formatOdds } = require('../../utils/odds');

  const sportName = SPORT_NAMES[legData.sport] || legData.sport;
  let summary;

  if (legData.bet_category === 'futures') {
    summary = `**${sportName}**: 🏆 ${legData.futures_market || 'Futures'}\n**Pick**: ${legData.futures_selection || legData.pick}\n**Odds**: ${formatOdds(legData.odds_american)}\n**Units**: ${units}u`;
  } else if (legData.bet_category === 'team_game') {
    summary = `**${sportName}**: ${legData.team_a} vs ${legData.team_b}\n**Pick**: ${legData.pick}\n**Odds**: ${formatOdds(legData.odds_american)}\n**Units**: ${units}u`;
  } else {
    summary = `**${sportName}**: ${legData.player_name}\n**Prop**: ${legData.pick}\n**Odds**: ${formatOdds(legData.odds_american)}\n**Units**: ${units}u`;
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('enterbet_details_btn')
      .setLabel('📝 Continue — Add Game Time & Note')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('enterbet_skip_details')
      .setLabel('⏩ Skip & Confirm')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('enterbet_cancel')
      .setLabel('❌ Cancel')
      .setStyle(ButtonStyle.Danger),
  );

  await interaction.reply({
    content: `✅ **Bet details saved!**\n\n${summary}\n\nAdd game time & note, or skip to confirm:`,
    components: [row],
    ephemeral: true,
  });
}

// Handle "Continue" button → show details modal (game time + note)
async function handleDetailsButton(interaction) {
  const userId = interaction.user.id;
  const session = betSessions.get(userId);
  if (!session) return interaction.reply({ content: 'Session expired. Use `/enterbet` again.', ephemeral: true });

  const modal = new ModalBuilder()
    .setCustomId('enterbet_details_modal')
    .setTitle('Game Time & Note');

  const startTimeInput = new TextInputBuilder()
    .setCustomId('event_start_time')
    .setLabel('Game Start Time (optional)')
    .setPlaceholder('e.g. Sun 1:00 PM ET, Tonight 7:30 PM')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(50);

  const noteInput = new TextInputBuilder()
    .setCustomId('bet_note')
    .setLabel('Note (optional)')
    .setPlaceholder('e.g. Bron averaging 28 ppg, sharp line movement')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);

  const shareLinkInput = new TextInputBuilder()
    .setCustomId('share_link')
    .setLabel('DraftKings / Bet Share Link (optional)')
    .setPlaceholder('e.g. https://sportsbook.draftkings.com/...')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(500);

  modal.addComponents(
    new ActionRowBuilder().addComponents(startTimeInput),
    new ActionRowBuilder().addComponents(noteInput),
    new ActionRowBuilder().addComponents(shareLinkInput),
  );

  await interaction.showModal(modal);
}

// Handle details modal submit → show confirmation
async function handleDetailsModalSubmit(interaction) {
  const userId = interaction.user.id;
  const session = betSessions.get(userId);
  if (!session) return interaction.reply({ content: 'Session expired. Use `/enterbet` again.', ephemeral: true });

  const eventStartTime = interaction.fields.getTextInputValue('event_start_time')?.trim() || null;
  const betNote = interaction.fields.getTextInputValue('bet_note')?.trim() || null;
  let shareLink = null;
  try { shareLink = interaction.fields.getTextInputValue('share_link')?.trim() || null; } catch (e) { /* no field */ }

  // Store on session
  session.pendingEventStartTime = eventStartTime;
  session.pendingBetNote = betNote;
  session.pendingShareLink = shareLink;

  // Also update the pending leg data
  if (session.pendingLegData) {
    session.pendingLegData.event_start_time = eventStartTime;
  }
  betSessions.set(userId, session);

  await showBetConfirmation(interaction, session, session.pendingLegData, session.pendingUnits, betNote);
}

// Handle "Skip & Confirm" button → go straight to confirmation with no game time/note
async function handleSkipDetails(interaction) {
  const userId = interaction.user.id;
  const session = betSessions.get(userId);
  if (!session) return interaction.update({ content: '❌ Session expired. Use `/enterbet` again.', components: [] });

  // Go straight to confirmation with no game time or note
  await showBetConfirmation(interaction, session, session.pendingLegData, session.pendingUnits, session.pendingBetNote);
}

// Show confirmation prompt before placing bet
async function showBetConfirmation(interaction, session, legData, units, betNote) {
  const { SPORT_NAMES, WAGER_TYPES } = require('../../config/constants');
  const { formatOdds } = require('../../utils/odds');

  const sportName = SPORT_NAMES[legData.sport] || legData.sport;
  let summary;

  if (legData.bet_category === 'futures') {
    const market = legData.futures_market || 'Futures';
    const selection = legData.futures_selection || legData.pick;
    summary = `**${sportName}**: 🏆 ${market}\n**Pick**: ${selection}\n**Odds**: ${formatOdds(legData.odds_american)}\n**Units**: ${units}u`;
  } else if (legData.bet_category === 'team_game') {
    summary = `**${sportName}**: ${legData.team_a} vs ${legData.team_b}\n**Pick**: ${legData.pick}\n**Odds**: ${formatOdds(legData.odds_american)}\n**Units**: ${units}u`;
  } else {
    summary = `**${sportName}**: ${legData.player_name}\n**Prop**: ${legData.pick}\n**Odds**: ${formatOdds(legData.odds_american)}\n**Units**: ${units}u`;
  }
  if (session.pendingEventStartTime || legData.event_start_time) summary += `\n**⏰ Game Time**: ${session.pendingEventStartTime || legData.event_start_time}`;
  if (betNote) summary += `\n**Note**: ${betNote}`;

  // Determine reply method — modal submits use .reply(), button clicks use .update()
  const isModalSubmit = interaction.isModalSubmit?.() || false;
  const respond = isModalSubmit
    ? (opts) => interaction.reply({ ...opts, ephemeral: true })
    : (opts) => interaction.update(opts);

  if (session.isRetro) {
    // Retro bet — ask for result instead of confirm
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('enterbet_retro_win')
        .setLabel('✅ Won')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('enterbet_retro_loss')
        .setLabel('❌ Lost')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('enterbet_retro_push')
        .setLabel('🔄 Push')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('enterbet_cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    await respond({
      content: `📋 **Retro Bet** — How did this bet finish?\n\n${summary}`,
      components: [row],
    });
  } else {
    // Normal bet — just confirm or cancel (game time/note already set in step 2)
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

    await respond({
      content: `⚠️ **Are you sure you want to place this bet?**\n\n${summary}`,
      components: [row],
    });
  }
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
  }

  // Read event start time (available in parlay leg modals)
  let eventStartTime = null;
  if (isParlay) {
    try { eventStartTime = interaction.fields.getTextInputValue('event_start_time')?.trim() || null; } catch (e) { /* no field */ }
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
    event_start_time: eventStartTime,
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
            { label: 'Futures', value: 'futures', description: 'Championship, MVP, season wins', emoji: '🏆' },
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

  // Single prop bet - show "Continue" button for step 2 (game time + note)
  session.pendingLegData = legData;
  session.pendingUnits = units;
  session.pendingBetNote = null; // Will be set in details modal
  betSessions.set(userId, session);

  await showDetailsPrompt(interaction, session, legData, units);
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

  const shareLinkInput = new TextInputBuilder()
    .setCustomId('share_link')
    .setLabel('DraftKings / Bet Share Link (optional)')
    .setPlaceholder('e.g. https://sportsbook.draftkings.com/...')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(500);

  modal.addComponents(
    new ActionRowBuilder().addComponents(oddsInput),
    new ActionRowBuilder().addComponents(unitsInput),
    new ActionRowBuilder().addComponents(noteInput),
    new ActionRowBuilder().addComponents(shareLinkInput),
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
  let shareLink = null;
  try { shareLink = interaction.fields.getTextInputValue('share_link')?.trim() || null; } catch (e) { /* no field */ }

  const oddsDecimal = americanToDecimal(oddsAmerican);

  try {
    // Store pending parlay data for confirmation
    session.pendingParlayData = {
      oddsAmerican,
      oddsDecimal,
      units,
      betNote,
      shareLink,
    };
    betSessions.set(userId, session);

    const { formatOdds } = require('../../utils/odds');
    let summary = `**Parlay (${session.legs.length} Legs)** at ${formatOdds(oddsAmerican)}\n**Units**: ${units}u\n`;
    session.legs.forEach((leg, i) => {
      const { SPORT_NAMES } = require('../../config/constants');
      const sn = SPORT_NAMES[leg.sport] || leg.sport;
      summary += `\n**Leg ${i + 1}**: ${sn} — ${leg.pick}`;
      if (leg.event_start_time) summary += ` ⏰ ${leg.event_start_time}`;
    });
    if (betNote) summary += `\n**Note**: ${betNote}`;

    if (session.isRetro) {
      // Retro parlay — ask for result
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('enterbet_retro_win')
          .setLabel('✅ Won')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('enterbet_retro_loss')
          .setLabel('❌ Lost')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('enterbet_retro_push')
          .setLabel('🔄 Push')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('enterbet_cancel')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary),
      );

      await interaction.reply({
        content: `📋 **Retro Parlay** — How did this bet finish?\n\n${summary}`,
        components: [row],
        ephemeral: true,
      });
    } else {
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
    await saveSingleBet(interaction, session.pendingLegData, session.pendingUnits, session.pendingBetNote, session.pendingShareLink);
  }
}

async function handleBetCancel(interaction) {
  const userId = interaction.user.id;
  betSessions.delete(userId);
  await interaction.update({ content: '❌ Bet cancelled.', components: [] });
}

// Handle retro bet result buttons
async function handleRetroResult(interaction) {
  const userId = interaction.user.id;
  const session = betSessions.get(userId);
  if (!session) return interaction.update({ content: '❌ Session expired. Use `/enterbet` again.', components: [] });

  // Determine result from button ID
  const resultMap = {
    'enterbet_retro_win': 'win',
    'enterbet_retro_loss': 'loss',
    'enterbet_retro_push': 'push',
  };
  const result = resultMap[interaction.customId];
  if (!result) return;

  // Store result in session for save functions
  session.retroResult = result;
  betSessions.set(userId, session);

  if (session.betType === 'parlay') {
    await saveParlayBet(interaction, session);
  } else {
    await saveSingleBet(interaction, session.pendingLegData, session.pendingUnits, session.pendingBetNote, session.pendingShareLink);
  }
}

// Save a parlay bet to DB and post embed
async function saveParlayBet(interaction, session) {
  const userId = interaction.user.id;
  const { oddsAmerican, oddsDecimal, units, betNote, shareLink } = session.pendingParlayData;

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
      share_link: shareLink || null,
      is_whale: session.isWhale || false,
      is_retro: session.isRetro || false,
      status: session.isRetro ? (session.retroResult || 'win') : 'open',
      closed_at: session.isRetro ? new Date().toISOString() : null,
    }, displayName);

    // Create parlay legs (set all leg statuses to match overall for retro)
    const retroStatus = session.isRetro ? (session.retroResult || 'win') : 'open';
    const legRecords = session.legs.map((leg, i) => ({
      bet_id: bet.id,
      leg_number: i + 1,
      ...leg,
      status: retroStatus,
    }));

    await db.createParlayLegs(legRecords);

    // Fetch the full bet with legs
    const fullBet = await db.getBet(bet.id);

    const isWhale = session.isWhale || false;

    // Build image attachment
    const imgBuffer = await generateBetCardImage(fullBet, displayName, bettor.displayAvatarURL());
    const attachment = new AttachmentBuilder(imgBuffer, { name: 'bet-card.png' });
    const sendPayload = { files: [attachment] };

    // Post to channel (channel already resolved above)
    const betShareLink = fullBet.share_link || shareLink;
    if (session.isRetro) {
      // Retro — post without tail poll
      const retroLabel = `📋 **RETRO SLIP** — ${session.retroResult.toUpperCase()}`;
      sendPayload.content = isWhale
        ? `🚨🚨🐋🍆🐋🍆🐋🍆 <@${bettor.id}> JUST SUBMITTED A MF'ING WHALE DICK BET! 🍆🐋🍆🐋🍆🐋🚨🚨\n\n${retroLabel}\nARE YOU READY TO MAKE SOME MF'ING MONEY. #JMM`
        : retroLabel;
      sendPayload.content = appendShareLink(sendPayload.content, betShareLink);
      const message = await channel.send(sendPayload);
      await db.updateBetMessageId(bet.id, message.id);
    } else {
      // Normal — add poll buttons
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

      let whaleContent = `🚨🚨🐋🍆🐋🍆🐋🍆 <@${bettor.id}> JUST SUBMITTED A MF'ING WHALE DICK BET! 🍆🐋🍆🐋🍆🐋🚨🚨\n\nARE YOU READY TO MAKE SOME MF'ING MONEY. #JMM`;
      sendPayload.components = [pollRow];
      sendPayload.content = isWhale ? whaleContent : 'Are You Tailing This Bet?';
      sendPayload.content = appendShareLink(sendPayload.content, betShareLink);
      const message = await channel.send(sendPayload);
      await db.updateBetMessageId(bet.id, message.id);
    }

    // Notify followers
    notifyFollowers(interaction.client, bettor.id, interaction.guildId, fullBet, displayName, session.isRetro);

    const forLabel = session.targetUser ? ` for **${displayName}**` : '';
    const retroSuffix = session.isRetro ? ` — ${session.retroResult.toUpperCase()} (RETRO)` : '';
    await interaction.update({
      content: `✅ Parlay posted${forLabel}! Slip **${bet.slip_number}** (${session.legs.length} legs, ${units}u at ${oddsAmerican >= 0 ? '+' : ''}${oddsAmerican})${retroSuffix}`,
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
async function saveSingleBet(interaction, legData, units, betNote, shareLink) {
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

    const betData = {
      user_id: user.id,
      discord_id: bettor.id,
      guild_id: interaction.guildId,
      channel_id: interaction.channelId,
      bet_type: 'single',
      ...legData,
      units,
      bet_note: betNote,
      share_link: shareLink || null,
      is_whale: session?.isWhale || false,
      is_retro: session?.isRetro || false,
      event_start_time: legData.event_start_time || session?.pendingEventStartTime || null,
      status: session?.isRetro ? (session.retroResult || 'win') : 'open',
      closed_at: session?.isRetro ? new Date().toISOString() : null,
    };
    console.log('Attempting to create single bet with data:', betData);

    const bet = await db.createBet(betData, displayName);

    const isWhale = session?.isWhale || false;
    const betShareLink = bet.share_link || shareLink;

    // Build image attachment
    const imgBuffer = await generateBetCardImage(bet, displayName, bettor.displayAvatarURL());
    const attachment = new AttachmentBuilder(imgBuffer, { name: 'bet-card.png' });
    const sendPayload = { files: [attachment] };

    // Post to channel
    if (session?.isRetro) {
      // Retro — post without tail poll
      const retroLabel = `📋 **RETRO SLIP** — ${session.retroResult.toUpperCase()}`;
      sendPayload.content = isWhale
        ? `🚨🚨🐋🍆🐋🍆🐋🍆 <@${bettor.id}> JUST SUBMITTED A MF'ING WHALE DICK BET! 🍆🐋🍆🐋🍆🐋🚨🚨\n\n${retroLabel}\nARE YOU READY TO MAKE SOME MF'ING MONEY. #JMM`
        : retroLabel;
      sendPayload.content = appendShareLink(sendPayload.content, betShareLink);
      const message = await channel.send(sendPayload);
      await db.updateBetMessageId(bet.id, message.id);
    } else {
      // Normal — add poll buttons
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

      let whaleContent = `🚨🚨🐋🍆🐋🍆🐋🍆 <@${bettor.id}> JUST SUBMITTED A MF'ING WHALE DICK BET! 🍆🐋🍆🐋🍆🐋🚨🚨\n\nARE YOU READY TO MAKE SOME MF'ING MONEY. #JMM`;
      sendPayload.components = [pollRow];
      sendPayload.content = isWhale ? whaleContent : 'Are You Tailing This Bet?';
      sendPayload.content = appendShareLink(sendPayload.content, betShareLink);
      const message = await channel.send(sendPayload);
      await db.updateBetMessageId(bet.id, message.id);
    }

    // Notify followers
    notifyFollowers(interaction.client, bettor.id, interaction.guildId, bet, displayName, session?.isRetro);

    const forLabel = session?.targetUser ? ` for **${displayName}**` : '';
    const retroSuffix = session?.isRetro ? ` — ${session.retroResult.toUpperCase()} (RETRO)` : '';
    await interaction.update({
      content: `✅ Bet posted${forLabel}! Slip **${bet.slip_number}** — ${legData.pick} (${units}u)${retroSuffix}`,
      components: [],
    });

    betSessions.delete(interaction.user.id);
  } catch (err) {
    console.error('Error saving bet:', err);
    if (err && err.message) {
      console.error('Supabase error message:', err.message);
    }
    if (err && err.details) {
      console.error('Supabase error details:', err.details);
    }
    if (err && err.hint) {
      console.error('Supabase error hint:', err.hint);
    }
    const msg = err.code === 50001
      ? '❌ Bot lacks permission to post in this channel. Give the bot **Send Messages** access, then try again.'
      : `❌ Error saving bet. Please try again.\n${err.message ? err.message : ''}`;
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
  handleOverUnderSelect,
  handleTeamModalSubmit,
  handlePropModalSubmit,
  handleFuturesModalSubmit,
  handleParlayFinalButton,
  handleParlayFinalSubmit,
  handleBetConfirm,
  handleBetCancel,
  handleDetailsButton,
  handleDetailsModalSubmit,
  handleSkipDetails,
  handleRetroResult,
  betSessions,
  handleTailPoll,
};
