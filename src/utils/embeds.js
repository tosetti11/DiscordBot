const { EmbedBuilder } = require('discord.js');
const { SPORT_NAMES, STATUS_EMOJI, WAGER_TYPES, COLORS } = require('../config/constants');
const { formatOdds, formatSpread, calculatePayout } = require('./odds');

/** Format a unit value to at most 2 decimal places for display */
function fmtU(v) {
  const n = Number(v);
  return Number.isFinite(n) ? parseFloat(n.toFixed(2)) : v;
}

/**
 * Build a rich embed for a single bet
 */
function buildBetEmbed(bet, username, avatarUrl) {
  const statusEmoji = STATUS_EMOJI[bet.status] || '❓';
  const sportName = SPORT_NAMES[bet.sport] || bet.sport;
  const color = getStatusColor(bet.status);
  const retroTag = bet.is_retro ? ' 📋 RETRO' : '';

  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({
      name: `${username}'s Bet${retroTag}`,
      iconURL: avatarUrl,
    })
    .setTimestamp(new Date(bet.created_at));

  if (bet.bet_type === 'parlay' && bet.parlay_legs?.length > 0) {
    // Parlay bet
    embed.setTitle(`🎰 Parlay (${bet.parlay_legs.length} Legs)${retroTag ? ' — RETRO SLIP' : ''}`);

    let description = '';
    bet.parlay_legs.forEach((leg, i) => {
      const legSport = SPORT_NAMES[leg.sport] || leg.sport;
      const legEmoji = STATUS_EMOJI[leg.status] || '🟡';
      description += `**Leg ${i + 1}** ${legEmoji}\n`;

      if (leg.bet_category === 'futures') {
        // Market-style: "Market: Selection"
        const parts = leg.pick ? leg.pick.split(': ') : [leg.pick];
        const market = parts.length > 1 ? parts[0] : 'Futures';
        const selection = parts.length > 1 ? parts.slice(1).join(': ') : leg.pick;
        description += `${legSport}: 🏆 ${market}\n`;
        description += `Pick: **${selection}**`;
        if (leg.odds_american) description += ` (${formatOdds(leg.odds_american)})`;
        description += '\n';
      } else if (leg.bet_category === 'team_game') {
        description += `${legSport}: ${leg.team_a} vs ${leg.team_b}\n`;
        description += `Pick: **${leg.pick}**`;
        if (leg.odds_american) description += ` (${formatOdds(leg.odds_american)})`;
        description += '\n';
      } else {
        description += `${legSport}: ${leg.player_name}\n`;
        description += `Pick: **${leg.pick}**`;
        if (leg.odds_american) description += ` (${formatOdds(leg.odds_american)})`;
        description += '\n';
      }

      if (leg.event_start_time) {
        description += `⏰ ${leg.event_start_time}\n`;
      }
      description += '\n';
    });

    embed.setDescription(description);
  } else {
    // Single bet
    if (bet.bet_category === 'futures') {
      // Market-style: pick is stored as "Market: Selection"
      const parts = bet.pick ? bet.pick.split(': ') : [bet.pick];
      const market = parts.length > 1 ? parts[0] : 'Futures';
      const selection = parts.length > 1 ? parts.slice(1).join(': ') : bet.pick;
      embed.setTitle(`🏆 ${sportName}: ${market}${retroTag ? ' — RETRO' : ''}`);
      embed.setDescription(`**Pick**: ${selection}`);
    } else if (bet.bet_category === 'team_game') {
      embed.setTitle(`${sportName}: ${bet.team_a} vs ${bet.team_b}`);

      const wagerLabel = WAGER_TYPES[bet.wager_type] || bet.wager_type;
      let pickLine = bet.pick || '';
      if (bet.wager_type === 'spread' && bet.spread_value !== null) {
        pickLine = `${bet.pick} ${formatSpread(bet.spread_value)}`;
      }

      embed.setDescription(`**${wagerLabel}**: ${pickLine}`);
    } else {
      // Player prop
      embed.setTitle(`${sportName}: ${bet.player_name}`);
      embed.setDescription(`**Prop**: ${bet.pick || bet.prop_description}`);
    }
  }

  // Common fields
  const fields = [];

  if (bet.event_start_time) {
    fields.push({
      name: '⏰ Game Time',
      value: bet.event_start_time,
      inline: true,
    });
  }

  if (bet.odds_american) {
    fields.push({
      name: 'Odds',
      value: `${formatOdds(bet.odds_american)} (${bet.odds_decimal})`,
      inline: true,
    });
  }

  fields.push({
    name: 'Units',
    value: `${fmtU(bet.units)}u`,
    inline: true,
  });

  if (bet.odds_american) {
    const payout = calculatePayout(bet.odds_american, bet.units);
    fields.push({
      name: 'To Win',
      value: `${payout}u`,
      inline: true,
    });
  }

  fields.push({
    name: 'Status',
    value: `${statusEmoji} ${bet.status.toUpperCase()}${bet.is_retro ? ' (RETRO)' : ''}`,
    inline: true,
  });

  if (bet.bet_note) {
    fields.push({
      name: 'Note',
      value: bet.bet_note,
      inline: false,
    });
  }

  if (bet.result_note) {
    fields.push({
      name: 'Result Note',
      value: bet.result_note,
      inline: false,
    });
  }

  embed.addFields(fields);
  const retroFooter = bet.is_retro ? ' • 📋 RETRO SLIP' : '';
  embed.setFooter({ text: `GK | Sports Betting Tracker • Slip: ${bet.slip_number || bet.id.slice(0, 8)}${retroFooter}` });

  return embed;
}

/**
 * Build stats embed for a user
 */
function buildStatsEmbed(stats, username, avatarUrl, tailStats = null, whaleStats = null, whaleTailStats = null) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setAuthor({
      name: `${username}'s Betting Stats`,
      iconURL: avatarUrl,
    })
    .setTitle('📊 Performance Overview');

  if (stats && stats.total_bets > 0) {
    embed.addFields(
      { name: 'Total Bets', value: `${stats.total_bets}`, inline: true },
      { name: 'Open', value: `${stats.open_bets}`, inline: true },
      { name: 'Record', value: `${stats.wins}W - ${stats.losses}L - ${stats.pushes}P`, inline: true },
      { name: 'Win %', value: `${stats.win_pct}%`, inline: true },
      { name: 'Net Units', value: `${stats.net_units >= 0 ? '+' : ''}${fmtU(stats.net_units)}u`, inline: true },
      { name: 'Units Won', value: `${fmtU(stats.units_won)}u`, inline: true },
    );
  }

  if (tailStats) {
    embed.addFields(
      { name: '\u200B', value: '**🔗 Tailing Stats**', inline: false },
      { name: 'Tails', value: `${tailStats.total_tails}`, inline: true },
      { name: 'Open', value: `${tailStats.open_tails}`, inline: true },
      { name: 'Record', value: `${tailStats.tail_wins}W - ${tailStats.tail_losses}L - ${tailStats.tail_pushes}P`, inline: true },
      { name: 'Win %', value: `${tailStats.tail_win_pct}%`, inline: true },
      { name: 'Net Units', value: `${tailStats.tail_net_units >= 0 ? '+' : ''}${fmtU(tailStats.tail_net_units)}u`, inline: true },
    );
  }

  if (whaleStats) {
    const whaleNet = `${whaleStats.net_units >= 0 ? '+' : ''}${fmtU(whaleStats.net_units)}u`;
    embed.addFields(
      { name: '\u200B', value: '**🐋 Whale Dick Slips**', inline: false },
      { name: 'Whale Bets', value: `${whaleStats.total_bets}`, inline: true },
      { name: 'Open', value: `${whaleStats.open_bets}`, inline: true },
      { name: 'Record', value: `${whaleStats.wins}W - ${whaleStats.losses}L - ${whaleStats.pushes}P`, inline: true },
      { name: 'Win %', value: `${whaleStats.win_pct}%`, inline: true },
      { name: 'Net Units', value: whaleNet, inline: true },
    );
  }

  if (whaleTailStats) {
    const whaleTailNet = `${whaleTailStats.tail_net_units >= 0 ? '+' : ''}${fmtU(whaleTailStats.tail_net_units)}u`;
    embed.addFields(
      { name: '\u200B', value: '**🐋🔗 Whale Dick Tails**', inline: false },
      { name: 'Whale Tails', value: `${whaleTailStats.total_tails}`, inline: true },
      { name: 'Open', value: `${whaleTailStats.open_tails}`, inline: true },
      { name: 'Record', value: `${whaleTailStats.tail_wins}W - ${whaleTailStats.tail_losses}L - ${whaleTailStats.tail_pushes}P`, inline: true },
      { name: 'Win %', value: `${whaleTailStats.tail_win_pct}%`, inline: true },
      { name: 'Net Units', value: whaleTailNet, inline: true },
    );
  }

  embed
    .setFooter({ text: 'GK | Sports Betting Tracker' })
    .setTimestamp();

  return embed;
}

/**
 * Build leaderboard embed
 */
function buildLeaderboardEmbed(leaderboard, guildName) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('👑 Gambling King Leaderboard')
    .setFooter({ text: 'GK | Sports Betting Tracker' })
    .setTimestamp();

  if (!leaderboard || leaderboard.length === 0) {
    embed.setDescription('No bets have been placed yet! Use `/enterbet` to get started.');
    return embed;
  }

  let description = '';
  leaderboard.forEach((user, i) => {
    const medal = i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
    const netUnits = `${user.net_units >= 0 ? '+' : ''}${fmtU(user.net_units)}u`;
    const record = `${user.wins}W-${user.losses}L-${user.pushes}P`;
    description += `${medal} **${user.discord_username}** — ${netUnits} (${record}, ${user.win_pct}%)\n`;
  });

  embed.setDescription(description);
  return embed;
}

function getStatusColor(status) {
  switch (status) {
    case 'open': return COLORS.warning;
    case 'win': return COLORS.success;
    case 'loss': return COLORS.danger;
    case 'push': return COLORS.neutral;
    case 'void': return COLORS.neutral;
    default: return COLORS.info;
  }
}

/**
 * Build a WHALE DICK bet embed — loud, bright, unmissable
 */
function buildWhaleBetEmbed(bet, username, avatarUrl) {
  const statusEmoji = STATUS_EMOJI[bet.status] || '❓';
  const sportName = SPORT_NAMES[bet.sport] || bet.sport;
  const WHALE_COLOR = 0xFF00FF; // Hot magenta
  const retroTag = bet.is_retro ? ' 📋 RETRO' : '';

  const embed = new EmbedBuilder()
    .setColor(WHALE_COLOR)
    .setAuthor({
      name: `🐋💰 ${username.toUpperCase()} JUST DROPPED A WHALE DICK 💰🐋${retroTag}`,
      iconURL: avatarUrl,
    })
    .setTimestamp(new Date(bet.created_at));

  const divider = '🐋🚨🐋🚨🐋🚨🐋🚨🐋🚨🐋🚨🐋🚨🐋🚨🐋';

  if (bet.bet_type === 'parlay' && bet.parlay_legs?.length > 0) {
    embed.setTitle(`🐋🚨 WHALE DICK PARLAY (${bet.parlay_legs.length} LEGS) 🚨🐋${retroTag ? '\n📋 RETRO SLIP' : ''}`);

    let description = `${divider}\n\n`;
    bet.parlay_legs.forEach((leg, i) => {
      const legSport = SPORT_NAMES[leg.sport] || leg.sport;
      const legEmoji = STATUS_EMOJI[leg.status] || '🟡';
      description += `🐋 **LEG ${i + 1}** ${legEmoji}\n`;

      if (leg.bet_category === 'futures') {
        const parts = leg.pick ? leg.pick.split(': ') : [leg.pick];
        const market = parts.length > 1 ? parts[0] : 'Futures';
        const selection = parts.length > 1 ? parts.slice(1).join(': ') : leg.pick;
        description += `${legSport}: 🏆 ${market}\n`;
        description += `Pick: **${selection}**`;
        if (leg.odds_american) description += ` (${formatOdds(leg.odds_american)})`;
        description += '\n';
      } else if (leg.bet_category === 'team_game') {
        description += `${legSport}: ${leg.team_a} vs ${leg.team_b}\n`;
        description += `Pick: **${leg.pick}**`;
        if (leg.odds_american) description += ` (${formatOdds(leg.odds_american)})`;
        description += '\n';
      } else {
        description += `${legSport}: ${leg.player_name}\n`;
        description += `Pick: **${leg.pick}**`;
        if (leg.odds_american) description += ` (${formatOdds(leg.odds_american)})`;
        description += '\n';
      }

      if (leg.event_start_time) {
        description += `⏰ ${leg.event_start_time}\n`;
      }
      description += '\n';
    });
    description += divider;

    embed.setDescription(description);
  } else {
    if (bet.bet_category === 'futures') {
      const parts = bet.pick ? bet.pick.split(': ') : [bet.pick];
      const market = parts.length > 1 ? parts[0] : 'Futures';
      const selection = parts.length > 1 ? parts.slice(1).join(': ') : bet.pick;
      embed.setTitle(`🐋🚨 WHALE DICK FUTURES BET 🚨🐋\n🏆 ${sportName}: ${market}`);
      embed.setDescription(`${divider}\n\n**Pick**: ${selection}\n\n${divider}`);
    } else if (bet.bet_category === 'team_game') {
      embed.setTitle(`🐋🚨 WHALE DICK BET 🚨🐋\n${sportName}: ${bet.team_a} vs ${bet.team_b}`);

      const wagerLabel = WAGER_TYPES[bet.wager_type] || bet.wager_type;
      let pickLine = bet.pick || '';
      if (bet.wager_type === 'spread' && bet.spread_value !== null) {
        pickLine = `${bet.pick} ${formatSpread(bet.spread_value)}`;
      }

      embed.setDescription(`${divider}\n\n**${wagerLabel}**: ${pickLine}\n\n${divider}`);
    } else {
      embed.setTitle(`🐋🚨 WHALE DICK BET 🚨🐋\n${sportName}: ${bet.player_name}`);
      embed.setDescription(`${divider}\n\n**Prop**: ${bet.pick || bet.prop_description}\n\n${divider}`);
    }
  }

  const fields = [];

  if (bet.event_start_time) {
    fields.push({
      name: '🐋 ⏰ Game Time',
      value: `**${bet.event_start_time}**`,
      inline: true,
    });
  }

  if (bet.odds_american) {
    fields.push({
      name: '🐋 Odds',
      value: `**${formatOdds(bet.odds_american)}** (${bet.odds_decimal})`,
      inline: true,
    });
  }

  fields.push({
    name: '🐋 Units',
    value: `**${fmtU(bet.units)}u**`,
    inline: true,
  });

  if (bet.odds_american) {
    const payout = calculatePayout(bet.odds_american, bet.units);
    fields.push({
      name: '🐋 To Win',
      value: `**${payout}u**`,
      inline: true,
    });
  }

  fields.push({
    name: '🐋 Status',
    value: `${statusEmoji} **${bet.status.toUpperCase()}**${bet.is_retro ? ' (RETRO)' : ''}`,
    inline: true,
  });

  if (bet.bet_note) {
    fields.push({
      name: '🐋 Note',
      value: bet.bet_note,
      inline: false,
    });
  }

  if (bet.result_note) {
    fields.push({
      name: '🐋 Result Note',
      value: bet.result_note,
      inline: false,
    });
  }

  embed.addFields(fields);
  const retroFooter = bet.is_retro ? ' • 📋 RETRO SLIP' : '';
  embed.setFooter({ text: `🐋🐋🐋 WHALE DICK ALERT • Slip: ${bet.slip_number || bet.id.slice(0, 8)} 🐋🐋🐋${retroFooter}` });

  return embed;
}

module.exports = {
  buildBetEmbed,
  buildWhaleBetEmbed,
  buildStatsEmbed,
  buildLeaderboardEmbed,
};
