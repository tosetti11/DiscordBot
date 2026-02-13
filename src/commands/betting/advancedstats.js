const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { supabase } = require('../../config/supabase');
const { SPORT_NAMES, WAGER_TYPES, COLORS } = require('../../config/constants');
const tailedBetsDb = require('../../database/tailedBets');

const command = new SlashCommandBuilder()
  .setName('advancedstats')
  .setDescription('View detailed betting stats with filters')
  .addUserOption(option =>
    option.setName('user')
      .setDescription('View another user\'s stats')
  )
  .addStringOption(option =>
    option.setName('period')
      .setDescription('Time period to filter by')
      .addChoices(
        { name: 'Last 24 Hours', value: 'last24h' },
        { name: 'Today (Calendar Day)', value: 'today' },
        { name: 'This Week', value: 'week' },
        { name: 'This Month', value: 'month' },
        { name: 'This Year', value: 'year' },
        { name: 'All Time', value: 'all' },
      )
  )
  .addStringOption(option =>
    option.setName('breakdown')
      .setDescription('Break down stats by category')
      .addChoices(
        { name: 'By Sport', value: 'sport' },
        { name: 'By Wager Type', value: 'wager' },
        { name: 'Overview', value: 'overview' },
      )
  );

/**
 * Calculate date range based on period choice
 */
function getDateRange(period) {
  const now = new Date();
  let start;

  switch (period) {
    case 'last24h':
      start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case 'today': {
      start = new Date(now);
      start.setHours(0, 0, 0, 0);
      break;
    }
    case 'week': {
      start = new Date(now);
      const day = start.getDay();
      start.setDate(start.getDate() - day); // Sunday start
      start.setHours(0, 0, 0, 0);
      break;
    }
    case 'month': {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    }
    case 'year': {
      start = new Date(now.getFullYear(), 0, 1);
      break;
    }
    case 'all':
    default:
      return null; // no filter
  }

  return start.toISOString();
}

/**
 * Calculate stats from an array of bets
 */
function calcStats(bets) {
  const total = bets.length;
  const open = bets.filter(b => b.status === 'open').length;
  const wins = bets.filter(b => b.status === 'win').length;
  const losses = bets.filter(b => b.status === 'loss').length;
  const pushes = bets.filter(b => b.status === 'push').length;
  const closed = bets.filter(b => ['win', 'loss', 'push'].includes(b.status));

  const winPct = (wins + losses) > 0
    ? Math.round((wins / (wins + losses)) * 1000) / 10
    : 0;

  let netUnits = 0;
  let unitsWagered = 0;
  for (const b of closed) {
    unitsWagered += Number(b.units);
    if (b.status === 'win') {
      netUnits += b.odds_american >= 0
        ? b.units * (b.odds_american / 100)
        : b.units * (100 / Math.abs(b.odds_american));
    } else if (b.status === 'loss') {
      netUnits -= Number(b.units);
    }
  }

  const roi = unitsWagered > 0
    ? Math.round((netUnits / unitsWagered) * 1000) / 10
    : 0;

  return {
    total,
    open,
    wins,
    losses,
    pushes,
    winPct,
    netUnits: Math.round(netUnits * 100) / 100,
    unitsWagered: Math.round(unitsWagered * 100) / 100,
    roi,
  };
}

/**
 * Format a stats block as a string
 */
function formatStatsLine(stats) {
  const net = `${stats.netUnits >= 0 ? '+' : ''}${stats.netUnits}u`;
  return `${stats.wins}W-${stats.losses}L-${stats.pushes}P | ${stats.winPct}% | ${net} | ROI: ${stats.roi}%`;
}

/**
 * Get period display label
 */
function getPeriodLabel(period) {
  switch (period) {
    case 'last24h': return 'Last 24 Hours';
    case 'today': return 'Today';
    case 'week': return 'This Week';
    case 'month': return 'This Month';
    case 'year': return 'This Year';
    case 'all':
    default: return 'All Time';
  }
}

async function execute(interaction) {
  await interaction.deferReply();

  const targetUser = interaction.options.getUser('user') || interaction.user;
  const period = interaction.options.getString('period') || 'all';
  const breakdown = interaction.options.getString('breakdown') || 'overview';

  // Get display name
  let displayName;
  try {
    const member = await interaction.guild.members.fetch(targetUser.id);
    displayName = member.displayName;
  } catch (e) {
    displayName = targetUser.displayName;
  }

  // Build query
  let query = supabase
    .from('bets')
    .select('*, parlay_legs(*)')
    .eq('discord_id', targetUser.id)
    .neq('status', 'void');

  const dateStart = getDateRange(period);
  if (dateStart) {
    query = query.gte('created_at', dateStart);
  }

  const { data: bets, error } = await query.order('created_at', { ascending: false });
  if (error) {
    console.error('[advancedstats] Query error:', error);
    return interaction.editReply({ content: '❌ Error fetching stats.' });
  }

  if (!bets || bets.length === 0) {
    return interaction.editReply({
      content: `📭 No bets found for **${displayName}** (${getPeriodLabel(period)}).`,
    });
  }

  const periodLabel = getPeriodLabel(period);
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setAuthor({
      name: `${displayName}'s Advanced Stats`,
      iconURL: targetUser.displayAvatarURL(),
    })
    .setFooter({ text: `GK | Sports Betting Tracker • ${periodLabel}` })
    .setTimestamp();

  if (breakdown === 'overview') {
    // ─── Overview ───
    const overall = calcStats(bets);
    const singles = calcStats(bets.filter(b => b.bet_type === 'single'));
    const parlays = calcStats(bets.filter(b => b.bet_type === 'parlay'));

    embed.setTitle(`📊 Performance Overview — ${periodLabel}`);
    embed.addFields(
      { name: '📋 Total Bets', value: `${overall.total}`, inline: true },
      { name: '🟡 Open', value: `${overall.open}`, inline: true },
      { name: '📈 Record', value: `${overall.wins}W - ${overall.losses}L - ${overall.pushes}P`, inline: true },
      { name: '🎯 Win %', value: `${overall.winPct}%`, inline: true },
      { name: '💰 Net Units', value: `${overall.netUnits >= 0 ? '+' : ''}${overall.netUnits}u`, inline: true },
      { name: '📊 ROI', value: `${overall.roi}%`, inline: true },
      { name: '💵 Units Wagered', value: `${overall.unitsWagered}u`, inline: true },
    );

    // Singles vs Parlays breakdown
    if (singles.total > 0) {
      embed.addFields({
        name: '🎰 Singles',
        value: `${singles.total} bets | ${formatStatsLine(singles)}`,
        inline: false,
      });
    }
    if (parlays.total > 0) {
      embed.addFields({
        name: '🎲 Parlays',
        value: `${parlays.total} bets | ${formatStatsLine(parlays)}`,
        inline: false,
      });
    }

    // Tail stats
    try {
      const tailStats = await tailedBetsDb.getTailStats(targetUser.id);
      if (tailStats && tailStats.total_tails > 0) {
        const tailNet = `${tailStats.tail_net_units >= 0 ? '+' : ''}${tailStats.tail_net_units}u`;
        embed.addFields({
          name: '🔗 Tailing Stats',
          value: `${tailStats.total_tails} tailed | ${tailStats.tail_wins}W-${tailStats.tail_losses}L-${tailStats.tail_pushes}P | ${tailStats.tail_win_pct}% | ${tailNet}`,
          inline: false,
        });
      }
    } catch (e) {
      // ignore tail stats errors
    }

  } else if (breakdown === 'sport') {
    // ─── By Sport ───
    embed.setTitle(`🏟️ Stats by Sport — ${periodLabel}`);

    // Group bets by sport
    const sportGroups = {};
    for (const bet of bets) {
      // For parlays, use each leg's sport
      if (bet.bet_type === 'parlay' && bet.parlay_legs?.length > 0) {
        // Count the parlay once under its primary sport (first leg)
        const sport = bet.parlay_legs[0].sport || 'other';
        if (!sportGroups[sport]) sportGroups[sport] = [];
        sportGroups[sport].push(bet);
      } else {
        const sport = bet.sport || 'other';
        if (!sportGroups[sport]) sportGroups[sport] = [];
        sportGroups[sport].push(bet);
      }
    }

    // Sort by number of bets descending
    const sortedSports = Object.entries(sportGroups)
      .sort((a, b) => b[1].length - a[1].length);

    for (const [sport, sportBets] of sortedSports) {
      const stats = calcStats(sportBets);
      const sportName = SPORT_NAMES[sport] || sport;
      const net = `${stats.netUnits >= 0 ? '+' : ''}${stats.netUnits}u`;
      embed.addFields({
        name: `${sportName} (${stats.total})`,
        value: `${stats.wins}W-${stats.losses}L-${stats.pushes}P | ${stats.winPct}% | ${net} | ROI: ${stats.roi}%`,
        inline: false,
      });
    }

  } else if (breakdown === 'wager') {
    // ─── By Wager Type ───
    embed.setTitle(`🎯 Stats by Wager Type — ${periodLabel}`);

    // Only single bets have wager_type; parlays are their own category
    const wagerGroups = {};
    for (const bet of bets) {
      if (bet.bet_type === 'parlay') {
        if (!wagerGroups['parlay']) wagerGroups['parlay'] = [];
        wagerGroups['parlay'].push(bet);
      } else {
        const wt = bet.wager_type || 'other';
        if (!wagerGroups[wt]) wagerGroups[wt] = [];
        wagerGroups[wt].push(bet);
      }
    }

    const wagerLabels = {
      moneyline: '💲 Moneyline',
      spread: '📏 Spread',
      total: '⬆️ Over/Under',
      prop: '🏀 Player Prop',
      parlay: '🎲 Parlay',
      other: '❓ Other',
    };

    // Sort by number of bets descending
    const sortedWagers = Object.entries(wagerGroups)
      .sort((a, b) => b[1].length - a[1].length);

    for (const [wager, wagerBets] of sortedWagers) {
      const stats = calcStats(wagerBets);
      const label = wagerLabels[wager] || wager;
      const net = `${stats.netUnits >= 0 ? '+' : ''}${stats.netUnits}u`;
      embed.addFields({
        name: `${label} (${stats.total})`,
        value: `${stats.wins}W-${stats.losses}L-${stats.pushes}P | ${stats.winPct}% | ${net} | ROI: ${stats.roi}%`,
        inline: false,
      });
    }
  }

  await interaction.editReply({ embeds: [embed] });
}

module.exports = {
  command,
  execute,
};
