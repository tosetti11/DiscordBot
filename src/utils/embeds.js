const { EmbedBuilder } = require('discord.js');
const { SPORT_NAMES, STATUS_EMOJI, WAGER_TYPES, COLORS } = require('../config/constants');
const { formatOdds, formatSpread, calculatePayout } = require('./odds');

/** Format a unit value to at most 2 decimal places for display */
function fmtU(v) {
  const n = Number(v);
  return Number.isFinite(n) ? parseFloat(n.toFixed(2)) : v;
}

/**
 * Divider line for Discord embeds (mimics the dashed receipt divider in the web app)
 */
const DIVIDER = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

/**
 * Build a "ticket-style" embed for a single bet — matches the web app card layout
 */
function buildBetEmbed(bet, username, avatarUrl) {
  const statusEmoji = STATUS_EMOJI[bet.status] || '🟡';
  const sportName = SPORT_NAMES[bet.sport] || bet.sport;
  const color = getStatusColor(bet.status);
  const retroTag = bet.is_retro ? ' 📋 RETRO' : '';

  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({
      name: `${username}`,
      iconURL: avatarUrl,
    })
    .setTimestamp(new Date(bet.created_at));

  // ── Status ──
  const statusLabel = { open: 'PENDING', win: 'WON', loss: 'LOST', push: 'PUSH', void: 'VOID' }[bet.status] || 'PENDING';

  // ── Build description to mimic web card ──
  let desc = '';

  // Sport row (sport badge + wager type + tags)
  const wagerLabel = WAGER_TYPES[bet.wager_type] || '';
  const tags = [];
  if (bet.is_whale) tags.push('🐋 WHALE');
  if (bet.is_retro) tags.push('📋 RETRO');
  const tagStr = tags.length > 0 ? ` · ${tags.join(' · ')}` : '';

  if (bet.bet_type === 'parlay' && bet.parlay_legs?.length > 0) {
    // ── PARLAY ──
    embed.setTitle(`${statusEmoji} ${statusLabel}`);
    desc += `**${sportName}** · Parlay${tagStr}\n`;
    desc += DIVIDER + '\n\n';
    desc += `## 🎰 ${bet.parlay_legs.length}-Leg Parlay\n\n`;

    bet.parlay_legs.forEach((leg, i) => {
      const legSport = SPORT_NAMES[leg.sport] || leg.sport;
      const legEmoji = STATUS_EMOJI[leg.status] || '🟡';

      desc += `${legEmoji} **Leg ${i + 1}** — ${legSport}\n`;

      if (leg.bet_category === 'futures') {
        const parts = leg.pick ? leg.pick.split(': ') : [leg.pick];
        const market = parts.length > 1 ? parts[0] : 'Futures';
        const selection = parts.length > 1 ? parts.slice(1).join(': ') : leg.pick;
        desc += `🏆 ${market}: **${selection}**`;
      } else if (leg.bet_category === 'team_game') {
        desc += `${leg.team_a} vs ${leg.team_b}\n`;
        desc += `Pick: **${leg.pick}**`;
      } else {
        desc += `${leg.player_name}\n`;
        desc += `Pick: **${leg.pick}**`;
      }

      if (leg.odds_american) desc += ` (${formatOdds(leg.odds_american)})`;
      desc += '\n';
      if (leg.event_start_time) desc += `⏰ ${leg.event_start_time}\n`;
      desc += '\n';
    });

    desc += DIVIDER + '\n';
  } else {
    // ── SINGLE BET ──
    embed.setTitle(`${statusEmoji} ${statusLabel}`);

    if (bet.bet_category === 'futures') {
      const parts = bet.pick ? bet.pick.split(': ') : [bet.pick];
      const market = parts.length > 1 ? parts[0] : 'Futures';
      const selection = parts.length > 1 ? parts.slice(1).join(': ') : bet.pick;

      desc += `**${sportName}** · Futures${tagStr}\n`;
      desc += DIVIDER + '\n\n';
      desc += `## 🏆 ${market}\n`;
      desc += `**${selection}**\n`;
    } else if (bet.bet_category === 'team_game') {
      desc += `**${sportName}**${wagerLabel ? ` · ${wagerLabel}` : ''}${tagStr}\n`;
      desc += DIVIDER + '\n\n';
      desc += `## ${bet.pick || '—'}\n`;
      const is2ball = bet.wager_type === '2ball' || bet.wager_type === '3ball';
      const matchupA = (is2ball && bet.match_player_a) ? (bet.match_player_a2 ? `${bet.match_player_a} / ${bet.match_player_a2}` : bet.match_player_a) : bet.team_a;
      const matchupB = (is2ball && bet.match_player_b) ? (bet.match_player_b2 ? `${bet.match_player_b} / ${bet.match_player_b2}` : bet.match_player_b) : bet.team_b;
      const matchupC = is2ball && bet.match_player_c ? ` / ${bet.match_player_c}` : '';
      desc += `${matchupA} vs ${matchupB}${matchupC}\n`;
    } else {
      // Player prop
      desc += `**${sportName}** · Player Prop${tagStr}\n`;
      desc += DIVIDER + '\n\n';
      desc += `## ${bet.pick || bet.prop_description || '—'}\n`;
      desc += `${bet.player_name}\n`;
    }

    if (bet.event_start_time) {
      desc += `⏰ ${bet.event_start_time}\n`;
    }

    desc += '\n' + DIVIDER + '\n';
  }

  // ── Stats row ──
  const oddsStr = bet.odds_american ? `${formatOdds(bet.odds_american)} (${bet.odds_decimal})` : '—';
  const unitsStr = `${fmtU(bet.units)}u`;
  let toWinStr = '—';
  if (bet.odds_american) {
    toWinStr = `${calculatePayout(bet.odds_american, bet.units)}u`;
  }

  desc += `\n**ODDS** ${oddsStr}   ·   **WAGER** ${unitsStr}   ·   **TO WIN** ${toWinStr}\n`;

  if (bet.bet_note) {
    desc += `\n> 📝 ${bet.bet_note}\n`;
  }

  if (bet.result_note) {
    desc += `\n> 📊 ${bet.result_note}\n`;
  }

  embed.setDescription(desc);

  const retroFooter = bet.is_retro ? ' · 📋 RETRO SLIP' : '';
  embed.setFooter({ text: `#${bet.slip_number || bet.id.slice(0, 8)}${retroFooter} · GK | Sports Betting Tracker` });

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
 * Build a WHALE DICK ticket embed — same card layout but loud colors and whale branding
 */
function buildWhaleBetEmbed(bet, username, avatarUrl) {
  const statusEmoji = STATUS_EMOJI[bet.status] || '🟡';
  const sportName = SPORT_NAMES[bet.sport] || bet.sport;
  const WHALE_COLOR = 0xFF00FF; // Hot magenta

  const embed = new EmbedBuilder()
    .setColor(WHALE_COLOR)
    .setAuthor({
      name: `🐋💰 ${username.toUpperCase()} DROPPED A WHALE DICK 💰🐋`,
      iconURL: avatarUrl,
    })
    .setTimestamp(new Date(bet.created_at));

  const statusLabel = { open: 'PENDING', win: 'WON', loss: 'LOST', push: 'PUSH', void: 'VOID' }[bet.status] || 'PENDING';
  embed.setTitle(`${statusEmoji} ${statusLabel}`);

  const whaleDivider = '🐋🚨🐋🚨🐋🚨🐋🚨🐋🚨🐋🚨🐋🚨🐋';
  let desc = '';

  const wagerLabel = WAGER_TYPES[bet.wager_type] || '';
  const retroStr = bet.is_retro ? ' · 📋 RETRO' : '';

  if (bet.bet_type === 'parlay' && bet.parlay_legs?.length > 0) {
    desc += `**${sportName}** · 🐋 WHALE PARLAY${retroStr}\n`;
    desc += whaleDivider + '\n\n';
    desc += `## 🐋🎰 ${bet.parlay_legs.length}-Leg Whale Parlay\n\n`;

    bet.parlay_legs.forEach((leg, i) => {
      const legSport = SPORT_NAMES[leg.sport] || leg.sport;
      const legEmoji = STATUS_EMOJI[leg.status] || '🟡';

      desc += `${legEmoji} **Leg ${i + 1}** — ${legSport}\n`;

      if (leg.bet_category === 'futures') {
        const parts = leg.pick ? leg.pick.split(': ') : [leg.pick];
        const market = parts.length > 1 ? parts[0] : 'Futures';
        const selection = parts.length > 1 ? parts.slice(1).join(': ') : leg.pick;
        desc += `🏆 ${market}: **${selection}**`;
      } else if (leg.bet_category === 'team_game') {
        desc += `${leg.team_a} vs ${leg.team_b}\n`;
        desc += `Pick: **${leg.pick}**`;
      } else {
        desc += `${leg.player_name}\n`;
        desc += `Pick: **${leg.pick}**`;
      }

      if (leg.odds_american) desc += ` (${formatOdds(leg.odds_american)})`;
      desc += '\n';
      if (leg.event_start_time) desc += `⏰ ${leg.event_start_time}\n`;
      desc += '\n';
    });

    desc += whaleDivider + '\n';
  } else {
    if (bet.bet_category === 'futures') {
      const parts = bet.pick ? bet.pick.split(': ') : [bet.pick];
      const market = parts.length > 1 ? parts[0] : 'Futures';
      const selection = parts.length > 1 ? parts.slice(1).join(': ') : bet.pick;

      desc += `**${sportName}** · 🐋 WHALE FUTURES${retroStr}\n`;
      desc += whaleDivider + '\n\n';
      desc += `## 🐋🏆 ${market}\n`;
      desc += `**${selection}**\n`;
    } else if (bet.bet_category === 'team_game') {
      desc += `**${sportName}**${wagerLabel ? ` · ${wagerLabel}` : ''} · 🐋 WHALE${retroStr}\n`;
      desc += whaleDivider + '\n\n';
      desc += `## 🐋 ${bet.pick || '—'}\n`;
      const is2ballW = bet.wager_type === '2ball' || bet.wager_type === '3ball';
      const wMatchupA = (is2ballW && bet.match_player_a) ? (bet.match_player_a2 ? `${bet.match_player_a} / ${bet.match_player_a2}` : bet.match_player_a) : bet.team_a;
      const wMatchupB = (is2ballW && bet.match_player_b) ? (bet.match_player_b2 ? `${bet.match_player_b} / ${bet.match_player_b2}` : bet.match_player_b) : bet.team_b;
      const wMatchupC = is2ballW && bet.match_player_c ? ` / ${bet.match_player_c}` : '';
      desc += `${wMatchupA} vs ${wMatchupB}${wMatchupC}\n`;
    } else {
      desc += `**${sportName}** · 🐋 WHALE PROP${retroStr}\n`;
      desc += whaleDivider + '\n\n';
      desc += `## 🐋 ${bet.pick || bet.prop_description || '—'}\n`;
      desc += `${bet.player_name}\n`;
    }

    if (bet.event_start_time) {
      desc += `⏰ ${bet.event_start_time}\n`;
    }

    desc += '\n' + whaleDivider + '\n';
  }

  // Stats row
  const oddsStr = bet.odds_american ? `${formatOdds(bet.odds_american)} (${bet.odds_decimal})` : '—';
  const unitsStr = `${fmtU(bet.units)}u`;
  let toWinStr = '—';
  if (bet.odds_american) {
    toWinStr = `${calculatePayout(bet.odds_american, bet.units)}u`;
  }

  desc += `\n🐋 **ODDS** ${oddsStr}   ·   **WAGER** ${unitsStr}   ·   **TO WIN** ${toWinStr}\n`;

  if (bet.bet_note) {
    desc += `\n> 📝 ${bet.bet_note}\n`;
  }

  if (bet.result_note) {
    desc += `\n> 📊 ${bet.result_note}\n`;
  }

  embed.setDescription(desc);

  const retroFooter = bet.is_retro ? ' · 📋 RETRO SLIP' : '';
  embed.setFooter({ text: `🐋 #${bet.slip_number || bet.id.slice(0, 8)}${retroFooter} · WHALE DICK ALERT 🐋` });

  return embed;
}

module.exports = {
  buildBetEmbed,
  buildWhaleBetEmbed,
  buildStatsEmbed,
  buildLeaderboardEmbed,
};
