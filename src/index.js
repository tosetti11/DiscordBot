require('dotenv').config();
const { Client, GatewayIntentBits, Collection, Events } = require('discord.js');

// Import commands
const enterbet = require('./commands/betting/enterbet');
const closebet = require('./commands/betting/closebet');
const mybets = require('./commands/betting/mybets');
const mystats = require('./commands/betting/mystats');
const leaderboard = require('./commands/betting/leaderboard');
const viewbets = require('./commands/betting/viewbets');
const deletebet = require('./commands/betting/deletebet');
const editbet = require('./commands/betting/editbet');
const advancedstats = require('./commands/betting/advancedstats');
const whaledick = require('./commands/betting/whaledick');
const retrobet = require('./commands/betting/retrobet');
const help = require('./commands/general/help');
const convertodds = require('./commands/general/convertodds');
const reminder = require('./commands/general/reminder');
const announce = require('./commands/general/announce');
const remindersDb = require('./database/reminders');
const { createWebServer, setDiscordClient } = require('./web/server');

// Create Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
  ],
});

// Register commands in a collection
client.commands = new Collection();
const commandModules = [enterbet, closebet, mybets, mystats, leaderboard, viewbets, deletebet, editbet, advancedstats, whaledick, retrobet, help, convertodds, reminder, announce];
for (const mod of commandModules) {
  client.commands.set(mod.command.name, mod);
}

// ─── Ready Event ───
client.once(Events.ClientReady, (c) => {
  console.log(`\n👑 GK | Sports Betting Tracker is online!`);
  console.log(`   Logged in as: ${c.user.tag}`);
  console.log(`   Serving ${c.guilds.cache.size} server(s)`);
  console.log(`   Commands: ${client.commands.size} registered\n`);

  // Set bot status
  client.user.setPresence({
    activities: [{ name: '/enterbet to place a bet', type: 3 }], // "Watching"
    status: 'online',
  });

  // ─── Reminder Scheduler ───
  // Check for due reminders every 30 seconds
  setInterval(async () => {
    try {
      const due = await remindersDb.getDueReminders();
      for (const r of due) {
        await reminder.fireReminder(client, r);
      }
    } catch (err) {
      console.error('[Reminder Scheduler] Error:', err.message);
    }
  }, 30_000);
  console.log('   ⏰ Reminder scheduler started (30s interval)');

  // ─── Web Server ───
  setDiscordClient(client);
  const webApp = createWebServer();
  const WEB_PORT = process.env.WEB_PORT || 3000;
  webApp.listen(WEB_PORT, () => {
    console.log(`   🌐 Bet slip web form running at http://localhost:${WEB_PORT}`);
  });
});

// ─── Slash Command Handler ───
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    console.log(`[InteractionCreate] type=${interaction.type} customId=${interaction.customId || 'N/A'} commandName=${interaction.commandName || 'N/A'} user=${interaction.user?.username}`);

    // Slash commands
    if (interaction.isChatInputCommand()) {
      const cmd = client.commands.get(interaction.commandName);
      if (!cmd) return;

      console.log(`[CMD] /${interaction.commandName} by ${interaction.user.username} in #${interaction.channel?.name}`);
      await cmd.execute(interaction);
      return;
    }

    // String select menus
    if (interaction.isStringSelectMenu()) {
      await handleSelectMenu(interaction);
      return;
    }

    // Buttons
    if (interaction.isButton()) {
      await handleButton(interaction);
      return;
    }

    // Modal submits
    if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction);
      return;
    }
  } catch (error) {
    console.error(`[ERROR] Interaction handler:`, error);

    const content = '❌ An error occurred. Please try again.';
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content, ephemeral: true });
      } else {
        await interaction.reply({ content, ephemeral: true });
      }
    } catch (e) {
      // Interaction may have timed out
      console.error('[ERROR] Could not send error reply:', e.message);
    }
  }
});

// ─── Select Menu Router ───
async function handleSelectMenu(interaction) {
  const id = interaction.customId;
  console.log('[SelectMenu] Received interaction:', {
    customId: id,
    values: interaction.values,
    user: interaction.user?.id,
    guild: interaction.guildId,
    channel: interaction.channelId
  });

  if (id === 'enterbet_type') {
    console.log('[SelectMenu] Routing to handleBetTypeSelect');
    return enterbet.handleBetTypeSelect(interaction);
  }
  if (id === 'enterbet_parlay_count') {
    console.log('[SelectMenu] Routing to handleParlayCountSelect');
    return enterbet.handleParlayCountSelect(interaction);
  }
  if (id === 'enterbet_category') {
    console.log('[SelectMenu] Routing to handleCategorySelect');
    return enterbet.handleCategorySelect(interaction);
  }
  if (id === 'enterbet_sport') {
    console.log('[SelectMenu] Routing to handleSportSelect');
    return enterbet.handleSportSelect(interaction);
  }
  if (id === 'enterbet_wager_type') {
    console.log('[SelectMenu] Routing to handleWagerTypeSelect');
    return enterbet.handleWagerTypeSelect(interaction);
  }
  if (id === 'enterbet_over_under') {
    console.log('[SelectMenu] Routing to handleOverUnderSelect');
    return enterbet.handleOverUnderSelect(interaction);
  }
  if (id === 'closebet_select') {
    console.log('[SelectMenu] Routing to closebet.handleBetSelect');
    return closebet.handleBetSelect(interaction);
  }
  if (id === 'closebet_leg_select') {
    console.log('[SelectMenu] Routing to closebet.handleLegSelect');
    return closebet.handleLegSelect(interaction);
  }
  if (id === 'deletebet_select') {
    console.log('[SelectMenu] Routing to deletebet.handleDeleteSelect');
    return deletebet.handleDeleteSelect(interaction);
  }
  if (id === 'editbet2_select' || id.startsWith('editbet2_status_')) {
    console.log('[SelectMenu] Routing to editbet.handleEditBetSelect');
    return editbet.handleEditBetSelect(interaction);
  }
  // Log unhandled select menu
  console.warn('[SelectMenu] Unhandled select menu:', id);
  try {
    await interaction.reply({ content: '❌ This select menu is not handled by the bot.', ephemeral: true });
  } catch (e) {
    console.error('[SelectMenu] Failed to reply to unhandled select menu:', e);
  }
}

// ─── Button Router ───
async function handleButton(interaction) {
  const id = interaction.customId;

  if (id.startsWith('closebet_leg_')) {
    return closebet.handleLegResultButton(interaction);
  }
  if (id === 'closebet_close_whole') {
    return closebet.handleCloseWhole(interaction);
  }
  if (id === 'closebet_done') {
    return closebet.handleDone(interaction);
  }
  if (id.startsWith('closebet_result_')) {
    return closebet.handleResultButton(interaction);
  }
  if (id === 'enterbet_parlay_final_btn') {
    return enterbet.handleParlayFinalButton(interaction);
  }
  if (id === 'enterbet_confirm') {
    return enterbet.handleBetConfirm(interaction);
  }
  if (id === 'enterbet_cancel') {
    return enterbet.handleBetCancel(interaction);
  }
  if (id === 'enterbet_details_btn') {
    return enterbet.handleDetailsButton(interaction);
  }
  if (id === 'enterbet_skip_details') {
    return enterbet.handleSkipDetails(interaction);
  }
  if (id.startsWith('enterbet_retro_')) {
    return enterbet.handleRetroResult(interaction);
  }
  if (id.startsWith('tailbet_')) {
    return enterbet.handleTailPoll(interaction);
  }
}

// ─── Modal Submit Router ───
async function handleModalSubmit(interaction) {
  const id = interaction.customId;

  if (id === 'enterbet_team_modal') {
    return enterbet.handleTeamModalSubmit(interaction);
  }
  if (id === 'enterbet_prop_modal') {
    return enterbet.handlePropModalSubmit(interaction);
  }
  if (id === 'enterbet_futures_modal') {
    return enterbet.handleFuturesModalSubmit(interaction);
  }
  if (id === 'enterbet_details_modal') {
    return enterbet.handleDetailsModalSubmit(interaction);
  }
  if (id === 'enterbet_parlay_final') {
    return enterbet.handleParlayFinalSubmit(interaction);
  }
  if (id === 'deletebet_confirm_modal') {
    return deletebet.handleDeleteConfirmModal(interaction);
  }
  if (id.startsWith('editbet2_modal_')) {
    return editbet.handleEditBetModal(interaction);
  }
}

// ─── Login ───
if (!process.env.DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKEN not found in .env file!');
  console.error('   Copy .env.example to .env and fill in your values.');
  process.exit(1);
}

// ─── Welcome DM on Member Join ───
const { supabase } = require('./config/supabase');

const DEFAULT_WELCOME_FIELDS = [
  { name: '🎰 Place Bets', value: 'Use `/enterbet` in any channel or visit the web app to submit your picks with our sleek bet slip.' },
  { name: '🔗 Tail Bets', value: 'When someone posts a pick, hit **Yes** or **No** on the poll to tail or fade their bet.' },
  { name: '🏆 Leaderboards', value: 'Use `/leaderboard` to see who\'s on top, or check the web dashboard for full stats.' },
  { name: '📊 Your Stats', value: 'Use `/mystats` to see your record, ROI, streaks, and more.' },
  { name: '🌐 Web Dashboard', value: '**[thegamblingkingapp.com](https://thegamblingkingapp.com)**\nLog in with Discord to place bets, view stats, set reminders, and more — all from your browser or phone.' },
  { name: '📱 Get the App', value: 'Visit the web dashboard and tap **📱 App** in the nav to install it on your phone for instant access.' },
];

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    // Check if welcome is enabled and get custom message
    const { data: settings } = await supabase
      .from('guild_settings')
      .select('*')
      .eq('guild_id', member.guild.id)
      .single();

    // If explicitly disabled, skip
    if (settings && settings.welcome_enabled === false) return;

    const wm = settings?.welcome_message || {};
    const title = wm.title || '👑 Welcome to TheGamblingKing!';
    const description = wm.description || `Hey **${member.displayName}**, welcome to the server! Here's everything you need to get started:`;
    const fields = wm.fields || DEFAULT_WELCOME_FIELDS;

    const dm = await member.createDM();
    await dm.send({
      embeds: [{
        color: 0xf5c518,
        title,
        description: description.replace('{user}', member.displayName),
        fields,
        thumbnail: { url: 'https://thegamblingkingapp.com/TheGamblingKing.jpg' },
        footer: { text: 'TheGamblingKing • Good luck out there 🎲' },
      }],
    });
    console.log(`[Welcome] Sent DM to ${member.user.username}`);
  } catch (err) {
    // User may have DMs disabled — that's fine
    console.log(`[Welcome] Could not DM ${member.user.username}: ${err.message}`);
  }
});

client.login(process.env.DISCORD_TOKEN);
