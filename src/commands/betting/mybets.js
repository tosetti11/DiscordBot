const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database/queries');
const { buildBetEmbed } = require('../../utils/embeds');
const { SPORTS, SPORT_NAMES } = require('../../config/constants');

const command = new SlashCommandBuilder()
  .setName('mybets')
  .setDescription('View your recent bets')
  .addStringOption(option =>
    option.setName('status')
      .setDescription('Filter by status')
      .addChoices(
        { name: 'All', value: 'all' },
        { name: 'Open', value: 'open' },
        { name: 'Wins', value: 'win' },
        { name: 'Losses', value: 'loss' },
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
      .setDescription('Number of bets to show (default: 5)')
      .setMinValue(1)
      .setMaxValue(10)
  );

async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const statusFilter = interaction.options.getString('status') || 'all';
  const sportFilter = interaction.options.getString('sport');
  const teamSearch = interaction.options.getString('team');
  const minUnits = interaction.options.getNumber('min_units');
  const maxUnits = interaction.options.getNumber('max_units');
  const limit = interaction.options.getInteger('limit') || 5;

  const bets = await db.getAllBetsInGuild(interaction.guildId, {
    status: statusFilter,
    discordId: interaction.user.id,
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
    if (minUnits) filters.push(`≥${minUnits}u`);
    if (maxUnits) filters.push(`≤${maxUnits}u`);
    const filterStr = filters.length > 0 ? ` matching ${filters.join(', ')}` : '';
    return interaction.editReply({
      content: `📭 No bets found${filterStr}. Use \`/enterbet\` to place your first bet!`,
    });
  }

  const embeds = bets.map(bet =>
    buildBetEmbed(bet, interaction.member?.displayName || interaction.user.displayName, interaction.user.displayAvatarURL())
  );

  const filters = [];
  if (statusFilter !== 'all') filters.push(statusFilter);
  if (sportFilter) filters.push(SPORT_NAMES[sportFilter] || sportFilter);
  if (teamSearch) filters.push(`"${teamSearch}"`);
  const filterStr = filters.length > 0 ? ` (${filters.join(', ')})` : '';

  await interaction.editReply({
    content: `📋 **Your bets${filterStr}** (showing ${bets.length}):`,
    embeds: embeds.slice(0, 10),
  });
}

module.exports = {
  command,
  execute,
};
