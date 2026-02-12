const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database/queries');
const { buildBetEmbed } = require('../../utils/embeds');
const { SPORTS, SPORT_NAMES } = require('../../config/constants');

const command = new SlashCommandBuilder()
  .setName('viewbets')
  .setDescription('View all bets in the server')
  .addStringOption(option =>
    option.setName('slip')
      .setDescription('Search by slip number (e.g. RIC-001)')
  )
  .addUserOption(option =>
    option.setName('user')
      .setDescription('Filter by user')
  )
  .addStringOption(option =>
    option.setName('status')
      .setDescription('Filter by status')
      .addChoices(
        { name: 'All', value: 'all' },
        { name: 'Open', value: 'open' },
        { name: 'Wins', value: 'win' },
        { name: 'Losses', value: 'loss' },
        { name: 'Pushes', value: 'push' },
      )
  )
  .addStringOption(option =>
    option.setName('sport')
      .setDescription('Filter by sport')
      .addChoices(...SPORTS.slice(0, 25).map(s => ({ name: s.name, value: s.value })))
  )
  .addStringOption(option =>
    option.setName('team')
      .setDescription('Search by team or player name')
  )
  .addNumberOption(option =>
    option.setName('min_units')
      .setDescription('Minimum units wagered')
      .setMinValue(0)
  )
  .addNumberOption(option =>
    option.setName('max_units')
      .setDescription('Maximum units wagered')
      .setMinValue(0)
  )
  .addIntegerOption(option =>
    option.setName('limit')
      .setDescription('Number of bets to show (default: 10)')
      .setMinValue(1)
      .setMaxValue(25)
  );

async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const slipSearch = interaction.options.getString('slip');
  const targetUser = interaction.options.getUser('user');
  const statusFilter = interaction.options.getString('status') || 'all';
  const sportFilter = interaction.options.getString('sport');
  const teamSearch = interaction.options.getString('team');
  const minUnits = interaction.options.getNumber('min_units');
  const maxUnits = interaction.options.getNumber('max_units');
  const limit = interaction.options.getInteger('limit') || 10;

  // Search by slip number
  if (slipSearch) {
    const bet = await db.getBetBySlip(slipSearch, interaction.guildId);
    if (!bet) {
      return interaction.editReply({ content: `📭 No bet found with slip **${slipSearch.toUpperCase()}**` });
    }

    // Try to get the username from the guild
    let username = 'Unknown';
    try {
      const member = await interaction.guild.members.fetch(bet.discord_id);
      username = member.displayName;
    } catch (e) {
      username = bet.discord_id;
    }

    const embed = buildBetEmbed(bet, username, null);
    return interaction.editReply({ content: `🔍 **Slip ${bet.slip_number}**`, embeds: [embed] });
  }

  // Get all bets with filters
  const bets = await db.getAllBetsInGuild(interaction.guildId, {
    status: statusFilter,
    discordId: targetUser?.id,
    sport: sportFilter,
    team: teamSearch,
    minUnits,
    maxUnits,
    limit,
  });

  if (bets.length === 0) {
    const filters = [];
    if (statusFilter !== 'all') filters.push(statusFilter);
    if (sportFilter) filters.push(SPORT_NAMES[sportFilter] || sportFilter);
    if (teamSearch) filters.push(`"${teamSearch}"`);
    if (targetUser) {
      let targetName;
      try {
        const m = await interaction.guild.members.fetch(targetUser.id);
        targetName = m.displayName;
      } catch (e) {
        targetName = targetUser.displayName;
      }
      filters.push(`from ${targetName}`);
    }
    if (minUnits) filters.push(`≥${minUnits}u`);
    if (maxUnits) filters.push(`≤${maxUnits}u`);
    const filterStr = filters.length > 0 ? ` matching ${filters.join(', ')}` : '';
    return interaction.editReply({
      content: `📭 No bets found${filterStr}. Use \`/enterbet\` to get started!`,
    });
  }

  // Build embeds (max 10 per message)
  const embeds = [];
  for (const bet of bets.slice(0, 10)) {
    let username = 'Unknown';
    try {
      const member = await interaction.guild.members.fetch(bet.discord_id);
      username = member.displayName;
    } catch (e) {
      username = bet.discord_id;
    }
    embeds.push(buildBetEmbed(bet, username, null));
  }

  const filter = statusFilter !== 'all' ? ` ${statusFilter}` : '';
  let userFilter = '';
  if (targetUser) {
    try {
      const m = await interaction.guild.members.fetch(targetUser.id);
      userFilter = ` from ${m.displayName}`;
    } catch (e) {
      userFilter = ` from ${targetUser.displayName}`;
    }
  }

  await interaction.editReply({
    content: `📋 **${bets.length}${filter} bet(s)${userFilter}** (showing ${embeds.length}):`,
    embeds,
  });
}

module.exports = {
  command,
  execute,
};
