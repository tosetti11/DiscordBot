const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
} = require('discord.js');
const { americanToDecimal } = require('../../utils/odds');
const { generateBetCardImage } = require('../../utils/betCardImage');
const db = require('../../database/queries');
const { notifyFollowers } = require('../../utils/notifications');

// In-memory store for MLB live bet sessions
const mlbLiveSessions = new Map();

// ── Next Pitch outcome options ──
const NEXT_PITCH_OUTCOMES = [
  { label: 'Strike (Called)', value: 'Strike (Called)', emoji: '🟢' },
  { label: 'Strike (Swinging)', value: 'Strike (Swinging)', emoji: '💨' },
  { label: 'Foul Ball', value: 'Foul Ball', emoji: '⚡' },
  { label: 'Ball', value: 'Ball', emoji: '🔴' },
  { label: 'In Play', value: 'In Play', emoji: '🏏' },
  { label: 'Hit By Pitch', value: 'Hit By Pitch', emoji: '🤕' },
];

// ── At-Bat outcome options ──
const AB_OUTCOMES = [
  { label: 'Single', value: 'Single', emoji: '🥎' },
  { label: 'Double', value: 'Double', emoji: '✌️' },
  { label: 'Triple', value: 'Triple', emoji: '3️⃣' },
  { label: 'Home Run', value: 'Home Run', emoji: '💣' },
  { label: 'Walk (BB)', value: 'Walk', emoji: '🚶' },
  { label: 'Strikeout', value: 'Strikeout', emoji: '🦁' },
  { label: 'Hit By Pitch', value: 'HBP', emoji: '🤕' },
  { label: 'Reach on Error', value: 'Reach on Error', emoji: '❌' },
  { label: 'Flyout', value: 'Flyout', emoji: '🪰' },
  { label: 'Groundout', value: 'Groundout', emoji: '⬇️' },
  { label: 'Lineout', value: 'Lineout', emoji: '➡️' },
  { label: 'Pop Out', value: 'Pop Out', emoji: '⬆️' },
  { label: 'Sacrifice Fly', value: 'Sac Fly', emoji: '✈️' },
  { label: 'Sacrifice Bunt', value: 'Sac Bunt', emoji: '🏏' },
  { label: 'Fielders Choice', value: 'Fielders Choice', emoji: '🔀' },
  { label: 'Double Play', value: 'Double Play', emoji: '2️⃣' },
];

const command = new SlashCommandBuilder()
  .setName('mlblive')
  .setDescription('Enter an MLB Live At-Bat, Inning, or Pitch-by-Pitch bet');

async function execute(interaction) {
  mlbLiveSessions.set(interaction.user.id, {});

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('mlblive_type')
      .setPlaceholder('Select live bet type')
      .addOptions([
        { label: 'Next Pitch', value: 'next_pitch', description: 'Strike, ball, foul, or in play', emoji: '⚾' },
        { label: 'At Bat Result', value: 'at_bat', description: 'Pitch count, exact outcome, or on base', emoji: '🦇' },
        { label: 'Inning', value: 'inning', description: 'Runs, home runs, or hits in an inning', emoji: '🏟️' },
        { label: 'Pitch Speed', value: 'pitch', description: 'Pitch speed (MPH) faster or slower', emoji: '🔥' },
      ])
  );

  await interaction.reply({
    content: '⚾ **MLB Live Bet** — What type of live bet?',
    components: [row],
    ephemeral: true,
  });
}

// ─── Type Selection ───
async function handleTypeSelect(interaction) {
  const userId = interaction.user.id;
  const session = mlbLiveSessions.get(userId);
  if (!session) return interaction.update({ content: 'Session expired. Use `/mlblive` again.', components: [] });

  session.liveType = interaction.values[0];
  mlbLiveSessions.set(userId, session);

  if (session.liveType === 'next_pitch') {
    // Select outcome for next pitch
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('mlblive_next_pitch_outcome')
        .setPlaceholder('Select next pitch outcome')
        .addOptions(NEXT_PITCH_OUTCOMES)
    );
    await interaction.update({
      content: '⚾ **MLB Live — Next Pitch** — What will the next pitch be?',
      components: [row],
    });
  } else if (session.liveType === 'at_bat') {
    // Select AB number 1-10
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('mlblive_ab_number')
        .setPlaceholder('Select At-Bat number')
        .addOptions(
          Array.from({ length: 10 }, (_, i) => ({
            label: `${ordinal(i + 1)} At Bat`,
            value: `${i + 1}`,
            emoji: '🦇',
          }))
        )
    );
    await interaction.update({
      content: '⚾ **MLB Live — At Bat** — Which at-bat?',
      components: [row],
    });
  } else if (session.liveType === 'inning') {
    // Select inning 1-15 (split into 1 menu, max 15 options)
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('mlblive_inning_number')
        .setPlaceholder('Select inning')
        .addOptions(
          Array.from({ length: 15 }, (_, i) => ({
            label: `${ordinal(i + 1)} Inning`,
            value: `${i + 1}`,
            emoji: i >= 9 ? '⏰' : '⚾',
          }))
        )
    );
    await interaction.update({
      content: '⚾ **MLB Live — Inning** — Which inning?',
      components: [row],
    });
  } else {
    // Pitch by Pitch → go straight to modal
    await showPitchModal(interaction, session);
  }
}

// ─── Next Pitch Outcome Selection → open modal ───
async function handleNextPitchOutcomeSelect(interaction) {
  const userId = interaction.user.id;
  const session = mlbLiveSessions.get(userId);
  if (!session) return interaction.update({ content: 'Session expired. Use `/mlblive` again.', components: [] });

  session.nextPitchOutcome = interaction.values[0];
  mlbLiveSessions.set(userId, session);

  const modal = new ModalBuilder()
    .setCustomId('mlblive_next_pitch_modal')
    .setTitle(`Next Pitch — ${session.nextPitchOutcome}`);

  const pitcherInput = new TextInputBuilder()
    .setCustomId('pitcher_name')
    .setLabel('Pitcher Name')
    .setPlaceholder('e.g. Gerrit Cole')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const batterInput = new TextInputBuilder()
    .setCustomId('batter_name')
    .setLabel('Batter Name')
    .setPlaceholder('e.g. Mike Trout')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const teamsInput = new TextInputBuilder()
    .setCustomId('teams')
    .setLabel('Teams (e.g. NYY vs LAA)')
    .setPlaceholder('e.g. NYY vs LAA')
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

  modal.addComponents(
    new ActionRowBuilder().addComponents(pitcherInput),
    new ActionRowBuilder().addComponents(batterInput),
    new ActionRowBuilder().addComponents(teamsInput),
    new ActionRowBuilder().addComponents(oddsInput),
    new ActionRowBuilder().addComponents(unitsInput),
  );

  await interaction.showModal(modal);
}

// ─── Next Pitch Modal Submit ───
async function handleNextPitchModalSubmit(interaction) {
  const userId = interaction.user.id;
  const session = mlbLiveSessions.get(userId);
  if (!session) return interaction.reply({ content: 'Session expired. Use `/mlblive` again.', ephemeral: true });

  const pitcherName = interaction.fields.getTextInputValue('pitcher_name').trim();
  const batterName = interaction.fields.getTextInputValue('batter_name').trim();
  const teamsRaw = interaction.fields.getTextInputValue('teams').trim();
  const oddsRaw = interaction.fields.getTextInputValue('odds').trim();
  const unitsRaw = interaction.fields.getTextInputValue('units').trim();

  const oddsAmerican = parseInt(oddsRaw);
  if (isNaN(oddsAmerican)) {
    return interaction.reply({ content: '❌ Invalid odds. Enter American odds (e.g. -110, +150)', ephemeral: true });
  }
  const oddsDecimal = americanToDecimal(oddsAmerican);

  const units = parseFloat(unitsRaw);
  if (isNaN(units) || units <= 0) {
    return interaction.reply({ content: '❌ Invalid units. Enter a positive number.', ephemeral: true });
  }

  const { teamA, teamB } = parseTeams(teamsRaw);

  const pick = `Next Pitch: ${session.nextPitchOutcome} — ${pitcherName} to ${batterName}`;

  session.pendingBet = {
    pick,
    player_name: batterName,
    team_a: teamA,
    team_b: teamB,
    odds_american: oddsAmerican,
    odds_decimal: oddsDecimal,
    units,
    prop_description: pick,
  };
  mlbLiveSessions.set(userId, session);

  await showConfirmation(interaction, session);
}

// ─── At Bat Number Selection ───
async function handleABNumberSelect(interaction) {
  const userId = interaction.user.id;
  const session = mlbLiveSessions.get(userId);
  if (!session) return interaction.update({ content: 'Session expired. Use `/mlblive` again.', components: [] });

  session.abNumber = parseInt(interaction.values[0]);
  mlbLiveSessions.set(userId, session);

  // Select AB market
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('mlblive_ab_market')
      .setPlaceholder('Select market')
      .addOptions([
        { label: 'Pitch Count (Over/Under)', value: 'pitch_count', description: 'e.g. Over 3.5 pitches', emoji: '🔢' },
        { label: 'Exact Outcome', value: 'exact_outcome', description: 'Single, Double, HR, K, etc.', emoji: '🎯' },
        { label: 'On Base (Yes/No)', value: 'on_base', description: 'Plate appearance reaches base', emoji: '🏃' },
      ])
  );

  await interaction.update({
    content: `⚾ **${ordinal(session.abNumber)} At Bat** — What market?`,
    components: [row],
  });
}

// ─── AB Market Selection ───
async function handleABMarketSelect(interaction) {
  const userId = interaction.user.id;
  const session = mlbLiveSessions.get(userId);
  if (!session) return interaction.update({ content: 'Session expired. Use `/mlblive` again.', components: [] });

  session.abMarket = interaction.values[0];
  mlbLiveSessions.set(userId, session);

  if (session.abMarket === 'pitch_count') {
    // Over or Under
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('mlblive_ab_direction')
        .setPlaceholder('Over or Under?')
        .addOptions([
          { label: 'Over', value: 'Over', emoji: '⬆️' },
          { label: 'Under', value: 'Under', emoji: '⬇️' },
        ])
    );
    await interaction.update({
      content: `⚾ **${ordinal(session.abNumber)} AB — Pitch Count** — Over or Under?`,
      components: [row],
    });
  } else if (session.abMarket === 'exact_outcome') {
    // Select the outcome
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('mlblive_ab_outcome')
        .setPlaceholder('Select exact outcome')
        .addOptions(AB_OUTCOMES)
    );
    await interaction.update({
      content: `⚾ **${ordinal(session.abNumber)} AB — Exact Outcome** — Select the outcome:`,
      components: [row],
    });
  } else {
    // On Base → Yes or No
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('mlblive_ab_direction')
        .setPlaceholder('On Base?')
        .addOptions([
          { label: 'Yes — Reaches Base', value: 'Yes', emoji: '✅' },
          { label: 'No — Does Not Reach Base', value: 'No', emoji: '❌' },
        ])
    );
    await interaction.update({
      content: `⚾ **${ordinal(session.abNumber)} AB — On Base** — Yes or No?`,
      components: [row],
    });
  }
}

// ─── AB Direction (O/U or Yes/No) → open modal ───
async function handleABDirectionSelect(interaction) {
  const userId = interaction.user.id;
  const session = mlbLiveSessions.get(userId);
  if (!session) return interaction.update({ content: 'Session expired. Use `/mlblive` again.', components: [] });

  session.direction = interaction.values[0];
  mlbLiveSessions.set(userId, session);

  await showABModal(interaction, session);
}

// ─── AB Exact Outcome Selection → open modal ───
async function handleABOutcomeSelect(interaction) {
  const userId = interaction.user.id;
  const session = mlbLiveSessions.get(userId);
  if (!session) return interaction.update({ content: 'Session expired. Use `/mlblive` again.', components: [] });

  session.exactOutcome = interaction.values[0];
  mlbLiveSessions.set(userId, session);

  await showABModal(interaction, session);
}

// ─── Inning Number Selection ───
async function handleInningNumberSelect(interaction) {
  const userId = interaction.user.id;
  const session = mlbLiveSessions.get(userId);
  if (!session) return interaction.update({ content: 'Session expired. Use `/mlblive` again.', components: [] });

  session.inningNumber = parseInt(interaction.values[0]);
  mlbLiveSessions.set(userId, session);

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('mlblive_inning_market')
      .setPlaceholder('Select inning market')
      .addOptions([
        { label: 'Runs (Over/Under)', value: 'runs', description: 'Total runs scored in the inning', emoji: '🔢' },
        { label: 'Home Run (Yes/No)', value: 'home_run', description: 'A home run in the inning', emoji: '💣' },
        { label: 'Hits (Over/Under)', value: 'hits', description: 'Total hits in the inning', emoji: '🥎' },
      ])
  );

  await interaction.update({
    content: `⚾ **${ordinal(session.inningNumber)} Inning** — What market?`,
    components: [row],
  });
}

// ─── Inning Market Selection ───
async function handleInningMarketSelect(interaction) {
  const userId = interaction.user.id;
  const session = mlbLiveSessions.get(userId);
  if (!session) return interaction.update({ content: 'Session expired. Use `/mlblive` again.', components: [] });

  session.inningMarket = interaction.values[0];
  mlbLiveSessions.set(userId, session);

  if (session.inningMarket === 'home_run') {
    // Yes or No
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('mlblive_inning_direction')
        .setPlaceholder('Home Run in this inning?')
        .addOptions([
          { label: 'Yes — HR Hit', value: 'Yes', emoji: '✅' },
          { label: 'No — No HR', value: 'No', emoji: '❌' },
        ])
    );
    await interaction.update({
      content: `⚾ **${ordinal(session.inningNumber)} Inning — Home Run** — Yes or No?`,
      components: [row],
    });
  } else {
    // Runs or Hits → Over/Under
    const marketLabel = session.inningMarket === 'runs' ? 'Runs' : 'Hits';
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('mlblive_inning_direction')
        .setPlaceholder(`${marketLabel} — Over or Under?`)
        .addOptions([
          { label: 'Over', value: 'Over', emoji: '⬆️' },
          { label: 'Under', value: 'Under', emoji: '⬇️' },
        ])
    );
    await interaction.update({
      content: `⚾ **${ordinal(session.inningNumber)} Inning — ${marketLabel}** — Over or Under?`,
      components: [row],
    });
  }
}

// ─── Inning Direction → open modal ───
async function handleInningDirectionSelect(interaction) {
  const userId = interaction.user.id;
  const session = mlbLiveSessions.get(userId);
  if (!session) return interaction.update({ content: 'Session expired. Use `/mlblive` again.', components: [] });

  session.direction = interaction.values[0];
  mlbLiveSessions.set(userId, session);

  await showInningModal(interaction, session);
}

// ══════════════════════════════════════
// MODALS
// ══════════════════════════════════════

// ─── At Bat Modal ───
async function showABModal(interaction, session) {
  const abLabel = `${ordinal(session.abNumber)} AB`;
  let marketLabel;
  if (session.abMarket === 'pitch_count') {
    marketLabel = `Pitch Count ${session.direction}`;
  } else if (session.abMarket === 'exact_outcome') {
    marketLabel = session.exactOutcome;
  } else {
    marketLabel = `On Base: ${session.direction}`;
  }

  const modal = new ModalBuilder()
    .setCustomId('mlblive_ab_modal')
    .setTitle(`${abLabel} — ${marketLabel}`);

  const playerInput = new TextInputBuilder()
    .setCustomId('player_name')
    .setLabel('Batter Name')
    .setPlaceholder('e.g. Mike Trout')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const teamsInput = new TextInputBuilder()
    .setCustomId('teams')
    .setLabel('Teams (e.g. LAA vs NYY)')
    .setPlaceholder('e.g. LAA vs NYY')
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
    new ActionRowBuilder().addComponents(playerInput),
    new ActionRowBuilder().addComponents(teamsInput),
  ];

  // For pitch count, add line value field
  if (session.abMarket === 'pitch_count') {
    const lineInput = new TextInputBuilder()
      .setCustomId('line_value')
      .setLabel(`${session.direction} — Pitch Count Line`)
      .setPlaceholder('e.g. 3.5, 4.5')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(10);
    fields.push(new ActionRowBuilder().addComponents(lineInput));
  }

  fields.push(new ActionRowBuilder().addComponents(oddsInput));
  fields.push(new ActionRowBuilder().addComponents(unitsInput));

  modal.addComponents(...fields);
  await interaction.showModal(modal);
}

// ─── Inning Modal ───
async function showInningModal(interaction, session) {
  const innLabel = `${ordinal(session.inningNumber)} Inning`;
  let marketLabel;
  if (session.inningMarket === 'home_run') {
    marketLabel = `HR: ${session.direction}`;
  } else {
    const mkt = session.inningMarket === 'runs' ? 'Runs' : 'Hits';
    marketLabel = `${mkt} ${session.direction}`;
  }

  const modal = new ModalBuilder()
    .setCustomId('mlblive_inning_modal')
    .setTitle(`${innLabel} — ${marketLabel}`);

  const teamsInput = new TextInputBuilder()
    .setCustomId('teams')
    .setLabel('Teams (e.g. LAD vs NYM)')
    .setPlaceholder('e.g. LAD vs NYM')
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
    new ActionRowBuilder().addComponents(teamsInput),
  ];

  // For runs/hits O/U, add line value
  if (session.inningMarket !== 'home_run') {
    const lineInput = new TextInputBuilder()
      .setCustomId('line_value')
      .setLabel(`${session.direction} — Line`)
      .setPlaceholder('e.g. 0.5, 1.5')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(10);
    fields.push(new ActionRowBuilder().addComponents(lineInput));
  }

  fields.push(new ActionRowBuilder().addComponents(oddsInput));
  fields.push(new ActionRowBuilder().addComponents(unitsInput));

  modal.addComponents(...fields);
  await interaction.showModal(modal);
}

// ─── Pitch by Pitch Modal ───
async function showPitchModal(interaction, session) {
  const modal = new ModalBuilder()
    .setCustomId('mlblive_pitch_modal')
    .setTitle('Pitch by Pitch — MPH');

  const playerInput = new TextInputBuilder()
    .setCustomId('player_name')
    .setLabel('Pitcher Name')
    .setPlaceholder('e.g. Shohei Ohtani')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const teamsInput = new TextInputBuilder()
    .setCustomId('teams')
    .setLabel('Teams (e.g. LAD vs NYM)')
    .setPlaceholder('e.g. LAD vs NYM')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const pitchInfoInput = new TextInputBuilder()
    .setCustomId('pitch_info')
    .setLabel('Pitch #, MPH, Faster/Slower (e.g. 2, 95.5, Faster)')
    .setPlaceholder('e.g. 2, 95.5, Faster')
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

  modal.addComponents(
    new ActionRowBuilder().addComponents(playerInput),
    new ActionRowBuilder().addComponents(teamsInput),
    new ActionRowBuilder().addComponents(pitchInfoInput),
    new ActionRowBuilder().addComponents(oddsInput),
    new ActionRowBuilder().addComponents(unitsInput),
  );

  await interaction.showModal(modal);
}

// ══════════════════════════════════════
// MODAL SUBMIT HANDLERS
// ══════════════════════════════════════

// ─── At Bat Modal Submit ───
async function handleABModalSubmit(interaction) {
  const userId = interaction.user.id;
  const session = mlbLiveSessions.get(userId);
  if (!session) return interaction.reply({ content: 'Session expired. Use `/mlblive` again.', ephemeral: true });

  const playerName = interaction.fields.getTextInputValue('player_name').trim();
  const teamsRaw = interaction.fields.getTextInputValue('teams').trim();
  const oddsRaw = interaction.fields.getTextInputValue('odds').trim();
  const unitsRaw = interaction.fields.getTextInputValue('units').trim();

  const oddsAmerican = parseInt(oddsRaw);
  if (isNaN(oddsAmerican)) {
    return interaction.reply({ content: '❌ Invalid odds. Enter American odds (e.g. -110, +150)', ephemeral: true });
  }
  const oddsDecimal = americanToDecimal(oddsAmerican);

  const units = parseFloat(unitsRaw);
  if (isNaN(units) || units <= 0) {
    return interaction.reply({ content: '❌ Invalid units. Enter a positive number.', ephemeral: true });
  }

  // Parse teams
  const { teamA, teamB } = parseTeams(teamsRaw);

  // Build pick string
  const abLabel = `${ordinal(session.abNumber)} AB`;
  let pick;
  if (session.abMarket === 'pitch_count') {
    const lineRaw = interaction.fields.getTextInputValue('line_value').trim();
    const lineValue = parseFloat(lineRaw);
    if (isNaN(lineValue)) {
      return interaction.reply({ content: '❌ Invalid line value. Enter a number (e.g. 3.5)', ephemeral: true });
    }
    session.lineValue = lineValue;
    pick = `${playerName} ${abLabel} — Pitch Count ${session.direction} ${lineValue}`;
  } else if (session.abMarket === 'exact_outcome') {
    pick = `${playerName} ${abLabel} — ${session.exactOutcome}`;
  } else {
    pick = `${playerName} ${abLabel} — On Base: ${session.direction}`;
  }

  session.pendingBet = {
    pick,
    player_name: playerName,
    team_a: teamA,
    team_b: teamB,
    odds_american: oddsAmerican,
    odds_decimal: oddsDecimal,
    units,
    prop_description: pick,
  };
  mlbLiveSessions.set(userId, session);

  await showConfirmation(interaction, session);
}

// ─── Inning Modal Submit ───
async function handleInningModalSubmit(interaction) {
  const userId = interaction.user.id;
  const session = mlbLiveSessions.get(userId);
  if (!session) return interaction.reply({ content: 'Session expired. Use `/mlblive` again.', ephemeral: true });

  const teamsRaw = interaction.fields.getTextInputValue('teams').trim();
  const oddsRaw = interaction.fields.getTextInputValue('odds').trim();
  const unitsRaw = interaction.fields.getTextInputValue('units').trim();

  const oddsAmerican = parseInt(oddsRaw);
  if (isNaN(oddsAmerican)) {
    return interaction.reply({ content: '❌ Invalid odds. Enter American odds (e.g. -110, +150)', ephemeral: true });
  }
  const oddsDecimal = americanToDecimal(oddsAmerican);

  const units = parseFloat(unitsRaw);
  if (isNaN(units) || units <= 0) {
    return interaction.reply({ content: '❌ Invalid units. Enter a positive number.', ephemeral: true });
  }

  const { teamA, teamB } = parseTeams(teamsRaw);

  const innLabel = `${ordinal(session.inningNumber)} Inning`;
  let pick;
  if (session.inningMarket === 'home_run') {
    pick = `${teamA} vs ${teamB} — ${innLabel} Home Run: ${session.direction}`;
  } else {
    const lineRaw = interaction.fields.getTextInputValue('line_value').trim();
    const lineValue = parseFloat(lineRaw);
    if (isNaN(lineValue)) {
      return interaction.reply({ content: '❌ Invalid line value. Enter a number (e.g. 0.5)', ephemeral: true });
    }
    session.lineValue = lineValue;
    const mkt = session.inningMarket === 'runs' ? 'Runs' : 'Hits';
    pick = `${teamA} vs ${teamB} — ${innLabel} ${mkt} ${session.direction} ${lineValue}`;
  }

  session.pendingBet = {
    pick,
    player_name: null,
    team_a: teamA,
    team_b: teamB,
    odds_american: oddsAmerican,
    odds_decimal: oddsDecimal,
    units,
    prop_description: pick,
  };
  mlbLiveSessions.set(userId, session);

  await showConfirmation(interaction, session);
}

// ─── Pitch Modal Submit ───
async function handlePitchModalSubmit(interaction) {
  const userId = interaction.user.id;
  const session = mlbLiveSessions.get(userId);
  if (!session) return interaction.reply({ content: 'Session expired. Use `/mlblive` again.', ephemeral: true });

  const playerName = interaction.fields.getTextInputValue('player_name').trim();
  const teamsRaw = interaction.fields.getTextInputValue('teams').trim();
  const pitchInfo = interaction.fields.getTextInputValue('pitch_info').trim();
  const oddsRaw = interaction.fields.getTextInputValue('odds').trim();
  const unitsRaw = interaction.fields.getTextInputValue('units').trim();

  const oddsAmerican = parseInt(oddsRaw);
  if (isNaN(oddsAmerican)) {
    return interaction.reply({ content: '❌ Invalid odds. Enter American odds (e.g. -110, +150)', ephemeral: true });
  }
  const oddsDecimal = americanToDecimal(oddsAmerican);

  const units = parseFloat(unitsRaw);
  if (isNaN(units) || units <= 0) {
    return interaction.reply({ content: '❌ Invalid units. Enter a positive number.', ephemeral: true });
  }

  const { teamA, teamB } = parseTeams(teamsRaw);

  // Parse pitch info: "2, 95.5, Faster" or "2 95.5 Faster"
  const parts = pitchInfo.split(/[,\s]+/).filter(Boolean);
  let pitchNum = '?';
  let mph = '?';
  let fasterSlower = 'Faster';

  if (parts.length >= 1) pitchNum = parts[0];
  if (parts.length >= 2) mph = parts[1];
  if (parts.length >= 3) fasterSlower = parts[2].charAt(0).toUpperCase() + parts[2].slice(1).toLowerCase();

  // Normalize to "Faster" or "Slower"
  if (fasterSlower.toLowerCase().startsWith('y')) fasterSlower = 'Faster';
  else if (fasterSlower.toLowerCase().startsWith('n')) fasterSlower = 'Slower';

  const pick = `${playerName} — Pitch #${pitchNum} ${fasterSlower} than ${mph} MPH`;

  session.pendingBet = {
    pick,
    player_name: playerName,
    team_a: teamA,
    team_b: teamB,
    odds_american: oddsAmerican,
    odds_decimal: oddsDecimal,
    units,
    prop_description: pick,
  };
  mlbLiveSessions.set(userId, session);

  await showConfirmation(interaction, session);
}

// ══════════════════════════════════════
// CONFIRMATION & SAVE
// ══════════════════════════════════════

async function showConfirmation(interaction, session) {
  const bet = session.pendingBet;
  const { formatOdds } = require('../../utils/odds');

  const matchup = bet.team_a && bet.team_b ? `**Game**: ${bet.team_a} vs ${bet.team_b}\n` : '';
  const player = bet.player_name ? `**Player**: ${bet.player_name}\n` : '';
  const summary = `${player}${matchup}**Pick**: ${bet.pick}\n**Odds**: ${formatOdds(bet.odds_american)}\n**Units**: ${bet.units}u`;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('mlblive_confirm')
      .setLabel('✅ Confirm Bet')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('mlblive_cancel')
      .setLabel('❌ Cancel')
      .setStyle(ButtonStyle.Danger),
  );

  await interaction.reply({
    content: `⚠️ **Confirm MLB Live Bet?**\n\n${summary}`,
    components: [row],
    ephemeral: true,
  });
}

async function handleConfirm(interaction) {
  const userId = interaction.user.id;
  const session = mlbLiveSessions.get(userId);
  if (!session || !session.pendingBet) {
    return interaction.update({ content: '❌ Session expired. Use `/mlblive` again.', components: [] });
  }

  const bet = session.pendingBet;
  const displayName = interaction.guild
    ? (await interaction.guild.members.fetch(interaction.user.id).catch(() => null))?.displayName || interaction.user.displayName
    : interaction.user.displayName;

  try {
    const user = await db.getOrCreateUser(interaction.user);
    const channel = interaction.channel || await interaction.client.channels.fetch(interaction.channelId);

    const betData = {
      user_id: user.id,
      discord_id: interaction.user.id,
      guild_id: interaction.guildId,
      channel_id: interaction.channelId,
      bet_type: 'single',
      sport: 'mlb',
      bet_category: 'mlb_live',
      wager_type: 'mlb_live',
      player_name: bet.player_name,
      team_a: bet.team_a,
      team_b: bet.team_b,
      pick: bet.pick,
      prop_description: bet.prop_description,
      odds_american: bet.odds_american,
      odds_decimal: bet.odds_decimal,
      units: bet.units,
      status: 'open',
    };

    const savedBet = await db.createBet(betData, displayName);

    // Generate card image
    const imgBuffer = await generateBetCardImage(savedBet, displayName, interaction.user.displayAvatarURL());
    const attachment = new AttachmentBuilder(imgBuffer, { name: 'bet-card.png' });

    // Post with tail poll
    const pollRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`tailbet_yes_${savedBet.id}`)
        .setLabel('Yes')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`tailbet_no_${savedBet.id}`)
        .setLabel('No')
        .setStyle(ButtonStyle.Danger),
    );

    const message = await channel.send({
      content: 'Are You Tailing This Bet?',
      files: [attachment],
      components: [pollRow],
    });

    await db.updateBetMessageId(savedBet.id, message.id);

    // Notify followers
    notifyFollowers(interaction.client, interaction.user.id, interaction.guildId, savedBet, displayName, false);

    await interaction.update({
      content: `✅ MLB Live bet posted! Slip **${savedBet.slip_number}** — ${bet.pick} (${bet.units}u)`,
      components: [],
    });

    mlbLiveSessions.delete(userId);
  } catch (err) {
    console.error('Error saving MLB live bet:', err);
    const msg = err.code === 50001
      ? '❌ Bot lacks permission to post in this channel.'
      : `❌ Error saving bet. Please try again.\n${err.message || ''}`;
    await interaction.update({ content: msg, components: [] });
  }
}

async function handleCancel(interaction) {
  mlbLiveSessions.delete(interaction.user.id);
  await interaction.update({ content: '❌ MLB Live bet cancelled.', components: [] });
}

// ══════════════════════════════════════
// HELPERS
// ══════════════════════════════════════

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function parseTeams(raw) {
  const parts = raw.split(/\s+(?:vs\.?|v|@|[-–—])\s+/i);
  if (parts.length >= 2) {
    return { teamA: parts[0].trim(), teamB: parts[1].trim() };
  }
  return { teamA: raw.trim(), teamB: null };
}

module.exports = {
  command,
  execute,
  handleTypeSelect,
  handleNextPitchOutcomeSelect,
  handleNextPitchModalSubmit,
  handleABNumberSelect,
  handleABMarketSelect,
  handleABDirectionSelect,
  handleABOutcomeSelect,
  handleInningNumberSelect,
  handleInningMarketSelect,
  handleInningDirectionSelect,
  handleABModalSubmit,
  handleInningModalSubmit,
  handlePitchModalSubmit,
  handleConfirm,
  handleCancel,
  mlbLiveSessions,
};
