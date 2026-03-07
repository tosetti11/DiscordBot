const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { supabase } = require('../../config/supabase');
const { SPORT_NAMES, WAGER_TYPES } = require('../../config/constants');
const tailedBetsDb = require('../../database/tailedBets');
const { generateProfileCardImage } = require('../../utils/profileCardImage');
const roleManager = require('../../services/roleManager');

const command = new SlashCommandBuilder()
  .setName('profile')
  .setDescription('View a bettor\'s profile card with stats and badges')
  .addUserOption(option =>
    option.setName('user')
      .setDescription('User to view (leave blank for yourself)')
  );

// ── Stats calculator ──
function calcStats(bets) {
  const total = bets.length;
  const open = bets.filter(b => b.status === 'open').length;
  const wins = bets.filter(b => b.status === 'win').length;
  const losses = bets.filter(b => b.status === 'loss').length;
  const pushes = bets.filter(b => b.status === 'push').length;
  const closed = bets.filter(b => ['win', 'loss', 'push'].includes(b.status));
  const winPct = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0;

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

  const roi = unitsWagered > 0 ? Math.round((netUnits / unitsWagered) * 1000) / 10 : 0;
  return { total, open, wins, losses, pushes, winPct, netUnits: Math.round(netUnits * 100) / 100, unitsWagered: Math.round(unitsWagered * 100) / 100, roi };
}

async function execute(interaction) {
  await interaction.deferReply();

  const targetUser = interaction.options.getUser('user') || interaction.user;
  const guildId = interaction.guildId;

  // Get display name
  let targetDisplayName;
  let memberSince;
  let member;
  try {
    member = await interaction.guild.members.fetch(targetUser.id);
    targetDisplayName = member.displayName;
    memberSince = member.joinedAt ? member.joinedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  } catch (e) {
    targetDisplayName = targetUser.displayName;
  }

  // Fetch all bets
  const { data: bets, error } = await supabase
    .from('bets')
    .select('*, parlay_legs(*)')
    .eq('discord_id', targetUser.id)
    .eq('guild_id', guildId)
    .neq('status', 'void')
    .order('created_at', { ascending: false });

  if (error) {
    return interaction.editReply({ content: '❌ Error fetching stats.' });
  }

  if (!bets || bets.length === 0) {
    return interaction.editReply({ content: `📭 ${targetUser.id === interaction.user.id ? 'You have' : `**${targetDisplayName}** has`} no bets recorded yet.` });
  }

  // Overall stats
  const overall = calcStats(bets);

  // Avg odds
  const allOdds = bets.filter(b => b.odds_american).map(b => b.odds_american);
  let avgOdds = 0;
  if (allOdds.length > 0) {
    const decArr = allOdds.map(o => o >= 0 ? (o / 100) + 1 : (100 / Math.abs(o)) + 1);
    const avgDec = decArr.reduce((a, b) => a + b, 0) / decArr.length;
    avgOdds = avgDec >= 2 ? Math.round((avgDec - 1) * 100) : Math.round(-100 / (avgDec - 1));
  }

  // By sport
  const sportBreakdown = {};
  for (const bet of bets) {
    const sport = (bet.bet_type === 'parlay' && bet.parlay_legs?.length > 0)
      ? (bet.parlay_legs[0].sport || 'other') : (bet.sport || 'other');
    if (!sportBreakdown[sport]) sportBreakdown[sport] = [];
    sportBreakdown[sport].push(bet);
  }
  const bySport = Object.entries(sportBreakdown)
    .map(([sport, sBets]) => ({ sport, name: SPORT_NAMES[sport] || sport, ...calcStats(sBets) }))
    .filter(s => (s.wins + s.losses) >= 2) // Only sports with 2+ decided bets
    .sort((a, b) => b.winPct - a.winPct);

  const bestSport = bySport.length > 0 ? { name: bySport[0].name, winPct: bySport[0].winPct, record: `${bySport[0].wins}-${bySport[0].losses}` } : { name: '—', winPct: 0, record: '' };
  const worstSport = bySport.length > 1 ? { name: bySport[bySport.length - 1].name, winPct: bySport[bySport.length - 1].winPct, record: `${bySport[bySport.length - 1].wins}-${bySport[bySport.length - 1].losses}` } : { name: '—', winPct: 0, record: '' };

  // Favorite bet type
  const wagerBreakdown = {};
  for (const bet of bets) {
    const wt = bet.bet_type === 'parlay' ? 'parlay' : (bet.wager_type || 'other');
    if (!wagerBreakdown[wt]) wagerBreakdown[wt] = 0;
    wagerBreakdown[wt]++;
  }
  const sortedWagers = Object.entries(wagerBreakdown).sort((a, b) => b[1] - a[1]);
  const favBetType = sortedWagers.length > 0
    ? { name: WAGER_TYPES[sortedWagers[0][0]] || (sortedWagers[0][0] === 'parlay' ? 'Parlay' : sortedWagers[0][0]), count: sortedWagers[0][1] }
    : { name: '—', count: 0 };

  // Streak (current)
  const closedBets = bets.filter(b => ['win', 'loss'].includes(b.status)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  let streakCount = 0, streakType = '';
  if (closedBets.length > 0) {
    streakType = closedBets[0].status;
    for (const b of closedBets) {
      if (b.status === streakType) streakCount++;
      else break;
    }
  }

  // Best/worst streaks (all-time)
  let bestWinStreak = 0, worstLossStreak = 0;
  let currentWin = 0, currentLoss = 0;
  // Sort chronologically for streak calculation
  const chrono = [...closedBets].reverse();
  for (const b of chrono) {
    if (b.status === 'win') {
      currentWin++;
      currentLoss = 0;
      if (currentWin > bestWinStreak) bestWinStreak = currentWin;
    } else if (b.status === 'loss') {
      currentLoss++;
      currentWin = 0;
      if (currentLoss > worstLossStreak) worstLossStreak = currentLoss;
    }
  }

  // Biggest win
  let biggestWin = null;
  for (const b of bets.filter(b => b.status === 'win')) {
    const payout = b.odds_american >= 0
      ? b.units * (b.odds_american / 100)
      : b.units * (100 / Math.abs(b.odds_american));
    if (!biggestWin || payout > biggestWin.payout) {
      biggestWin = {
        payout: Math.round(payout * 100) / 100,
        pick: b.pick || (b.bet_type === 'parlay' && b.parlay_legs ? `${b.parlay_legs.length}-Leg Parlay` : b.slip_number || 'Bet'),
      };
    }
  }

  // Top 5 teams
  const teamCount = {};
  for (const bet of bets) {
    if (bet.bet_type === 'parlay' && bet.parlay_legs?.length > 0) {
      const legCount = bet.parlay_legs.length;
      for (const leg of bet.parlay_legs) {
        if (leg.team_a) addTeam(teamCount, leg.team_a, bet, legCount);
      }
    } else {
      if (bet.team_a) addTeam(teamCount, bet.team_a, bet, 1);
    }
  }
  const topTeams = Object.entries(teamCount)
    .filter(([, t]) => t.count >= 3)
    .map(([team, t]) => {
      const wPct = (t.wins + t.losses) > 0 ? Math.round((t.wins / (t.wins + t.losses)) * 100) : 0;
      return { team, count: t.count, wins: t.wins, losses: t.losses, record: `${t.wins}-${t.losses}`, winPct: wPct, netUnits: t.netUnits };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Get badges
  const badgeList = member ? roleManager.getUserRoleBadges(member) : [];

  // Build stats object for image generator
  const profileStats = {
    ...overall,
    avgOdds,
    bestSport,
    worstSport,
    favBetType,
    streak: { count: streakCount, type: streakType },
    bestStreak: { count: bestWinStreak },
    worstStreak: { count: worstLossStreak },
    biggestWin,
    topTeams,
  };

  const imgBuffer = await generateProfileCardImage({
    displayName: targetDisplayName,
    avatarUrl: targetUser.displayAvatarURL({ size: 256, extension: 'png' }),
    stats: profileStats,
    badges: badgeList,
    memberSince,
  });

  const attachment = new AttachmentBuilder(imgBuffer, { name: 'profile-card.png' });
  await interaction.editReply({ files: [attachment] });
}

// Helper: accumulate team stats (legCount splits parlay units proportionally)
function addTeam(map, team, bet, legCount = 1) {
  if (!team || team.length < 2) return;
  const key = team.toUpperCase().trim();
  if (!map[key]) map[key] = { count: 0, wins: 0, losses: 0, netUnits: 0 };
  map[key].count++;
  if (bet.status === 'win') {
    map[key].wins++;
    const payout = bet.odds_american >= 0
      ? bet.units * (bet.odds_american / 100)
      : bet.units * (100 / Math.abs(bet.odds_american));
    map[key].netUnits += payout / legCount;
  } else if (bet.status === 'loss') {
    map[key].losses++;
    map[key].netUnits -= Number(bet.units) / legCount;
  }
  map[key].netUnits = Math.round(map[key].netUnits * 100) / 100;
}

module.exports = {
  command,
  execute,
};
