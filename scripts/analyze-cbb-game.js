/**
 * One-off CBB game analysis using the same model logic as nbaGamePicks.js
 * Usage: node scripts/analyze-cbb-game.js
 */
require('dotenv').config();

const ESPN_CBB = 'basketball/mens-college-basketball';
const CBB_AVG_PPG = 74.0;
const CBB_AVG_PACE = 68.0;
const HOME_COURT = 2.0; // reduced for tournament/neutral site

// ── CONFIG ──
const AWAY_ID = '113';   // UMass
const HOME_ID = '193';   // Miami (OH) — higher seed / favored
const AWAY_NAME = 'UMass';
const HOME_NAME = 'Miami OH';
const SPREAD_VAL = -7.5; // Miami OH favored by 7.5
const OU_LINE = 165.5;

async function getTeamSchedule(teamId) {
  const season = 2026;
  const url = `https://site.api.espn.com/apis/site/v2/sports/${ESPN_CBB}/teams/${teamId}/schedule?season=${season}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN schedule ${res.status}`);
  const json = await res.json();
  const events = (json.events || []).map(ev => {
    const comp = ev.competitions?.[0];
    if (!comp) return null;
    const home = comp.competitors?.find(c => c.homeAway === 'home');
    const away = comp.competitors?.find(c => c.homeAway === 'away');
    if (!home || !away) return null;
    const isHome = String(home.team?.id) === String(teamId);
    const team = isHome ? home : away;
    const opponent = isHome ? away : home;
    return {
      date: ev.date,
      homeAway: isHome ? 'home' : 'away',
      teamScore: parseInt(team.score) || 0,
      oppScore: parseInt(opponent.score) || 0,
      oppId: opponent.team?.id,
      oppName: opponent.team?.displayName || '',
      oppAbbr: opponent.team?.abbreviation || '',
      won: team.winner === true,
      completed: ev.status?.type?.completed || false,
      state: ev.status?.type?.state || 'pre',
    };
  }).filter(Boolean);
  return events.filter(e => e.completed && e.state === 'post').sort((a, b) => new Date(b.date) - new Date(a.date));
}

async function getTeamStats(teamId) {
  const season = 2026;
  const [recordRes, statsRes] = await Promise.all([
    fetch(`https://site.api.espn.com/apis/site/v2/sports/${ESPN_CBB}/teams/${teamId}`).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch(`https://site.api.espn.com/apis/site/v2/sports/${ESPN_CBB}/teams/${teamId}/statistics?season=${season}`).then(r => r.ok ? r.json() : null).catch(() => null),
  ]);
  const recStats = {};
  for (const s of (recordRes?.team?.record?.items?.[0]?.stats || [])) recStats[s.name] = s.value;
  const totals = {};
  const cats = statsRes?.results?.stats?.categories || statsRes?.statistics?.splits?.categories || [];
  for (const cat of (Array.isArray(cats) ? cats : [])) {
    for (const stat of (cat.stats || [])) {
      const key = (stat.abbreviation || stat.name || '').toLowerCase();
      if (key) totals[key] = stat.value;
    }
  }
  const gp = recStats.gamesPlayed || 30;
  const fga = totals['fga'] || 0;
  const fta = totals['fta'] || 0;
  const orb = totals['or'] || 0;
  const to = totals['to'] || 0;
  const pace = (fga + 0.44 * fta - orb + to) / gp;
  return {
    teamId, gp,
    wins: recStats.wins || 0,
    losses: recStats.losses || 0,
    winPct: recStats.winPercent || 0,
    pace: Math.round(pace * 10) / 10,
    avgPtsFor: recStats.avgPointsFor || 70,
    avgPtsAllowed: recStats.avgPointsAgainst || 70,
    pointDiff: Math.round(((recStats.avgPointsFor || 70) - (recStats.avgPointsAgainst || 70)) * 10) / 10,
    fgPct: totals['fg%'] || 0,
    fg3Pct: totals['3p%'] || 0,
    ftPct: totals['ft%'] || 0,
    toPG: Math.round((totals['to'] || 0) / gp * 10) / 10,
    rebPG: Math.round((totals['reb'] || 0) / gp * 10) / 10,
    astPG: Math.round((totals['ast'] || 0) / gp * 10) / 10,
    fg3PG: Math.round((totals['3pm'] || 0) / gp * 10) / 10,
  };
}

function getRecentForm(schedule, n = 10) {
  const recent = schedule.slice(0, n);
  if (!recent.length) return null;
  const wins = recent.filter(g => g.won).length;
  const avgPtsFor = recent.reduce((s, g) => s + g.teamScore, 0) / recent.length;
  const avgPtsAllowed = recent.reduce((s, g) => s + g.oppScore, 0) / recent.length;
  let streakType = recent[0]?.won ? 'W' : 'L';
  let streakCount = 0;
  for (const g of recent) {
    if ((g.won && streakType === 'W') || (!g.won && streakType === 'L')) streakCount++;
    else break;
  }
  const totalPoints = recent.map(g => g.teamScore + g.oppScore);
  const avgTotal = totalPoints.reduce((a, b) => a + b, 0) / totalPoints.length;
  return {
    games: recent.length, wins, losses: recent.length - wins,
    winPct: Math.round((wins / recent.length) * 100),
    avgPtsFor: Math.round(avgPtsFor * 10) / 10,
    avgPtsAllowed: Math.round(avgPtsAllowed * 10) / 10,
    avgMargin: Math.round((avgPtsFor - avgPtsAllowed) * 10) / 10,
    avgTotal: Math.round(avgTotal * 10) / 10,
    streak: `${streakType}${streakCount}`,
    scores: recent.map(g => ({ pts: g.teamScore, opp: g.oppScore, total: g.teamScore + g.oppScore, won: g.won })),
  };
}

function getHomeAwaySplits(schedule) {
  function calc(games) {
    if (!games.length) return { wins: 0, losses: 0, winPct: 0, avgPtsFor: 0, avgPtsAllowed: 0 };
    const w = games.filter(g => g.won).length;
    return {
      wins: w, losses: games.length - w,
      winPct: Math.round((w / games.length) * 100),
      avgPtsFor: Math.round(games.reduce((s, g) => s + g.teamScore, 0) / games.length * 10) / 10,
      avgPtsAllowed: Math.round(games.reduce((s, g) => s + g.oppScore, 0) / games.length * 10) / 10,
    };
  }
  return {
    home: calc(schedule.filter(g => g.homeAway === 'home')),
    away: calc(schedule.filter(g => g.homeAway === 'away')),
  };
}

function getH2H(schedule, oppId) {
  const games = schedule.filter(g => String(g.oppId) === String(oppId));
  if (!games.length) return null;
  return {
    games: games.length,
    wins: games.filter(g => g.won).length,
    losses: games.filter(g => !g.won).length,
    avgMargin: Math.round(games.reduce((s, g) => s + (g.teamScore - g.oppScore), 0) / games.length * 10) / 10,
    avgTotal: Math.round(games.reduce((s, g) => s + g.teamScore + g.oppScore, 0) / games.length * 10) / 10,
    results: games.map(g => ({ pts: g.teamScore, opp: g.oppScore, won: g.won, homeAway: g.homeAway, date: g.date })),
  };
}

function detectRest(teamSched, oppSched) {
  const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const today = new Date(todayET);
  function getDays(s) {
    if (!s.length) return null;
    return Math.max(0, Math.floor((today - new Date(s[0].date)) / 86400000) - 1);
  }
  const t = getDays(teamSched);
  const o = getDays(oppSched);
  return { teamDays: t, oppDays: o, isB2B: t === 0, oppIsB2B: o === 0, advantage: t !== null && o !== null ? t - o : 0 };
}

function calcPower(stats, form, splits, side) {
  if (!stats) return 50;
  let r = 50;
  r += (stats.winPct - 0.5) * 25;
  r += Math.min(10, Math.max(-10, stats.pointDiff));
  if (form) r += ((form.winPct / 100) - 0.5) * 20;
  if (side === 'home' && splits.home.wins + splits.home.losses > 0) {
    r += (splits.home.winPct / 100 - 0.5) * 10;
  } else if (side === 'away' && splits.away.wins + splits.away.losses > 0) {
    r += (splits.away.winPct / 100 - 0.5) * 10;
  }
  if (stats.avgPtsFor > CBB_AVG_PPG) r += Math.min(3, (stats.avgPtsFor - CBB_AVG_PPG) * 0.3);
  else r -= Math.min(3, (CBB_AVG_PPG - stats.avgPtsFor) * 0.3);
  if (stats.avgPtsAllowed < CBB_AVG_PPG) r += Math.min(3, (CBB_AVG_PPG - stats.avgPtsAllowed) * 0.3);
  else r -= Math.min(3, (stats.avgPtsAllowed - CBB_AVG_PPG) * 0.3);
  return Math.round(Math.min(90, Math.max(10, r)) * 10) / 10;
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log(`  ${AWAY_NAME} vs ${HOME_NAME}`);
  console.log(`  Line: ${HOME_NAME} ${SPREAD_VAL} | O/U ${OU_LINE}`);
  console.log('═══════════════════════════════════════════\n');

  console.log('Fetching data from ESPN...\n');

  const [homeSched, awaySched, homeStats, awayStats] = await Promise.all([
    getTeamSchedule(HOME_ID),
    getTeamSchedule(AWAY_ID),
    getTeamStats(HOME_ID),
    getTeamStats(AWAY_ID),
  ]);

  // ── Team Profiles ──
  console.log(`── ${HOME_NAME} Season: ${homeStats.wins}-${homeStats.losses} (${(homeStats.winPct * 100).toFixed(0)}%) ──`);
  console.log(`   PPG: ${homeStats.avgPtsFor} | Opp PPG: ${homeStats.avgPtsAllowed} | Diff: ${homeStats.pointDiff > 0 ? '+' : ''}${homeStats.pointDiff}`);
  console.log(`   Pace: ${homeStats.pace} | FG%: ${homeStats.fgPct.toFixed(1)} | 3P%: ${homeStats.fg3Pct.toFixed(1)} | FT%: ${homeStats.ftPct.toFixed(1)}`);
  console.log(`   RPG: ${homeStats.rebPG} | APG: ${homeStats.astPG} | TOPG: ${homeStats.toPG}`);

  console.log(`\n── ${AWAY_NAME} Season: ${awayStats.wins}-${awayStats.losses} (${(awayStats.winPct * 100).toFixed(0)}%) ──`);
  console.log(`   PPG: ${awayStats.avgPtsFor} | Opp PPG: ${awayStats.avgPtsAllowed} | Diff: ${awayStats.pointDiff > 0 ? '+' : ''}${awayStats.pointDiff}`);
  console.log(`   Pace: ${awayStats.pace} | FG%: ${awayStats.fgPct.toFixed(1)} | 3P%: ${awayStats.fg3Pct.toFixed(1)} | FT%: ${awayStats.ftPct.toFixed(1)}`);
  console.log(`   RPG: ${awayStats.rebPG} | APG: ${awayStats.astPG} | TOPG: ${awayStats.toPG}`);

  const homeForm = getRecentForm(homeSched, 10);
  const awayForm = getRecentForm(awaySched, 10);
  const homeForm5 = getRecentForm(homeSched, 5);
  const awayForm5 = getRecentForm(awaySched, 5);
  const homeSplits = getHomeAwaySplits(homeSched);
  const awaySplits = getHomeAwaySplits(awaySched);
  const h2h = getH2H(homeSched, AWAY_ID);
  const rest = detectRest(homeSched, awaySched);

  console.log(`\n── L10 Form ──`);
  if (homeForm) console.log(`   ${HOME_NAME}: ${homeForm.wins}-${homeForm.losses} (${homeForm.streak}) | ${homeForm.avgPtsFor} PPG, ${homeForm.avgPtsAllowed} opp | margin ${homeForm.avgMargin > 0 ? '+' : ''}${homeForm.avgMargin} | avg total ${homeForm.avgTotal}`);
  else console.log(`   ${HOME_NAME}: No data`);
  if (awayForm) console.log(`   ${AWAY_NAME}: ${awayForm.wins}-${awayForm.losses} (${awayForm.streak}) | ${awayForm.avgPtsFor} PPG, ${awayForm.avgPtsAllowed} opp | margin ${awayForm.avgMargin > 0 ? '+' : ''}${awayForm.avgMargin} | avg total ${awayForm.avgTotal}`);
  else console.log(`   ${AWAY_NAME}: No data`);

  console.log(`\n── L5 Form ──`);
  if (homeForm5) console.log(`   ${HOME_NAME}: ${homeForm5.wins}-${homeForm5.losses} | ${homeForm5.avgPtsFor} PPG, margin ${homeForm5.avgMargin > 0 ? '+' : ''}${homeForm5.avgMargin} | avg total ${homeForm5.avgTotal}`);
  else console.log(`   ${HOME_NAME}: No data`);
  if (awayForm5) console.log(`   ${AWAY_NAME}: ${awayForm5.wins}-${awayForm5.losses} | ${awayForm5.avgPtsFor} PPG, margin ${awayForm5.avgMargin > 0 ? '+' : ''}${awayForm5.avgMargin} | avg total ${awayForm5.avgTotal}`);
  else console.log(`   ${AWAY_NAME}: No data`);

  if (h2h) {
    console.log(`\n── H2H (this season) ──`);
    console.log(`   ${HOME_NAME} ${h2h.wins}-${h2h.losses} | avg margin ${h2h.avgMargin > 0 ? '+' : ''}${h2h.avgMargin} | avg total ${h2h.avgTotal}`);
    for (const r of h2h.results) {
      console.log(`   → ${HOME_NAME} ${r.pts} - ${AWAY_NAME} ${r.opp} (${r.won ? HOME_NAME + ' W' : AWAY_NAME + ' W'})`);
    }
  } else {
    console.log(`\n── H2H: No meetings this season ──`);
  }

  console.log(`\n── Rest ──`);
  console.log(`   ${HOME_NAME}: ${rest.teamDays === 0 ? 'B2B' : rest.teamDays + ' days rest'} | ${AWAY_NAME}: ${rest.oppDays === 0 ? 'B2B' : rest.oppDays + ' days rest'}`);

  // ── Power Ratings ──
  const homePower = calcPower(homeStats, homeForm, homeSplits, 'home');
  const awayPower = calcPower(awayStats, awayForm, awaySplits, 'away');
  const powerDiff = homePower - awayPower;

  console.log(`\n── Power Ratings ──`);
  console.log(`   ${HOME_NAME}: ${homePower} | ${AWAY_NAME}: ${awayPower} | Edge: ${powerDiff > 0 ? HOME_NAME : AWAY_NAME} +${Math.abs(powerDiff).toFixed(1)}`);

  // ══════════════════════════════
  //  MONEYLINE
  // ══════════════════════════════
  let homeProb = 0, tw = 0;

  // 1. Power (30)
  homeProb += Math.min(0.85, Math.max(0.15, 0.5 + (powerDiff / 100) * 0.5)) * 30;
  tw += 30;

  // 2. L10 Form (20)
  if (homeForm && awayForm) {
    homeProb += Math.min(0.8, Math.max(0.2, 0.5 + ((homeForm.winPct - awayForm.winPct) / 100) * 0.3)) * 20;
    tw += 20;
  }

  // 3. Splits (15)
  const mH = homeSplits.home, uA = awaySplits.away;
  if (mH.wins + mH.losses > 3 && uA.wins + uA.losses > 3) {
    homeProb += Math.min(0.75, Math.max(0.25, 0.5 + ((mH.winPct - uA.winPct) / 100) * 0.25)) * 15;
    tw += 15;
  }

  // 4. Margin (10)
  if (homeStats && awayStats) {
    homeProb += Math.min(0.75, Math.max(0.25, 0.5 + ((homeStats.pointDiff - awayStats.pointDiff) / 30) * 0.3)) * 10;
    tw += 10;
  }

  // 5. H2H (10)
  if (h2h && h2h.games >= 1) {
    homeProb += Math.min(0.8, Math.max(0.2, h2h.wins / h2h.games)) * 10;
    tw += 10;
  }

  // 6. Rest (8)
  let restSig = 0.5;
  if (rest.isB2B && !rest.oppIsB2B) restSig = 0.38;
  else if (!rest.isB2B && rest.oppIsB2B) restSig = 0.62;
  else if (rest.advantage >= 2) restSig = 0.58;
  else if (rest.advantage <= -2) restSig = 0.42;
  homeProb += restSig * 8;
  tw += 8;

  homeProb = tw > 0 ? homeProb / tw : 0.5;
  homeProb = Math.min(0.85, homeProb + HOME_COURT * 0.01);
  const awayProb = 1 - homeProb;

  const mlPick = homeProb >= 0.5 ? HOME_NAME : AWAY_NAME;
  const mlProb = homeProb >= 0.5 ? homeProb : awayProb;
  const mlConf = mlProb >= 0.70 ? 'HIGH' : mlProb >= 0.60 ? 'MEDIUM' : 'LOW';

  console.log('\n══════════════════════════════════');
  console.log('  MONEYLINE ANALYSIS');
  console.log('══════════════════════════════════');
  console.log(`  ${HOME_NAME} win prob: ${Math.round(homeProb * 100)}%`);
  console.log(`  ${AWAY_NAME} win prob: ${Math.round(awayProb * 100)}%`);
  console.log(`  ➤ PICK: ${mlPick} ML (${Math.round(mlProb * 100)}% | ${mlConf} confidence)`);

  // ══════════════════════════════
  //  SPREAD
  // ══════════════════════════════
  const homeSpread = SPREAD_VAL;
  let projMargin = 0;
  tw = 0;

  // 1. Power (30)
  projMargin += (powerDiff * 0.4) * 30;
  tw += 30;

  // 2. Season margin (20)
  if (homeStats && awayStats) {
    projMargin += ((homeStats.pointDiff - awayStats.pointDiff) / 2) * 20;
    tw += 20;
  }

  // 3. L10 margin (25)
  if (homeForm && awayForm) {
    projMargin += ((homeForm.avgMargin - awayForm.avgMargin) / 2) * 25;
    tw += 25;
  }

  // 4. Splits margin (15)
  if (mH.wins + mH.losses > 3 && uA.wins + uA.losses > 3) {
    const hm = mH.avgPtsFor - mH.avgPtsAllowed;
    const am = uA.avgPtsFor - uA.avgPtsAllowed;
    projMargin += ((hm - am) / 2) * 15;
    tw += 15;
  }

  // 5. H2H margin (10)
  if (h2h && h2h.games >= 1) {
    projMargin += h2h.avgMargin * 10;
    tw += 10;
  }

  projMargin = tw > 0 ? projMargin / tw : 0;
  projMargin += HOME_COURT;

  // Rest adjustments
  if (rest.isB2B && !rest.oppIsB2B) projMargin -= 2.5;
  else if (!rest.isB2B && rest.oppIsB2B) projMargin += 2.5;
  else if (rest.advantage >= 2) projMargin += 1.0;
  else if (rest.advantage <= -2) projMargin -= 1.0;

  projMargin = Math.round(projMargin * 10) / 10;

  const coverMargin = projMargin + homeSpread;
  const homeCover = Math.min(0.82, Math.max(0.18, 0.5 + coverMargin * 0.05));
  const awayCover = 1 - homeCover;
  const spreadPickHome = homeCover >= 0.5;
  const spreadProb = spreadPickHome ? homeCover : awayCover;
  const spreadConf = spreadProb >= 0.68 ? 'HIGH' : spreadProb >= 0.58 ? 'MEDIUM' : 'LOW';

  console.log('\n══════════════════════════════════');
  console.log('  SPREAD ANALYSIS');
  console.log('══════════════════════════════════');
  console.log(`  Projected margin (${HOME_NAME} perspective): ${projMargin > 0 ? '+' : ''}${projMargin}`);
  console.log(`  Line: ${HOME_NAME} ${homeSpread}`);
  console.log(`  Cover margin: ${coverMargin.toFixed(1)}`);
  if (spreadPickHome) {
    console.log(`  ➤ PICK: ${HOME_NAME} ${homeSpread} (${Math.round(spreadProb * 100)}% | ${spreadConf} confidence)`);
  } else {
    console.log(`  ➤ PICK: ${AWAY_NAME} +${Math.abs(homeSpread)} (${Math.round(spreadProb * 100)}% | ${spreadConf} confidence)`);
  }

  // ══════════════════════════════
  //  OVER/UNDER
  // ══════════════════════════════
  let projTotal = 0;
  tw = 0;

  // 1. Season averages (25)
  if (homeStats && awayStats) {
    const raw = homeStats.avgPtsFor + awayStats.avgPtsFor;
    const defAdj = ((homeStats.avgPtsAllowed - CBB_AVG_PPG) + (awayStats.avgPtsAllowed - CBB_AVG_PPG)) * 0.3;
    projTotal += (raw + defAdj) * 25;
    tw += 25;
  }

  // 2. L10 scoring (30)
  if (homeForm && awayForm) {
    const rt = homeForm.avgPtsFor + awayForm.avgPtsFor;
    const rd = ((homeForm.avgPtsAllowed - CBB_AVG_PPG) + (awayForm.avgPtsAllowed - CBB_AVG_PPG)) * 0.3;
    projTotal += (rt + rd) * 30;
    tw += 30;
  }

  // 3. L5 scoring (15)
  if (homeForm5 && awayForm5) {
    const l5t = homeForm5.avgPtsFor + awayForm5.avgPtsFor;
    const l5d = ((homeForm5.avgPtsAllowed - CBB_AVG_PPG) + (awayForm5.avgPtsAllowed - CBB_AVG_PPG)) * 0.2;
    projTotal += (l5t + l5d) * 15;
    tw += 15;
  }

  // 4. Pace matchup (15) — use efficiency × pace, not PPG × pace (avoids double-counting)
  if (homeStats && awayStats) {
    const gamePace = (homeStats.pace + awayStats.pace) / 2;
    const homeEfficiency = homeStats.pace > 0 ? homeStats.avgPtsFor / homeStats.pace : 1.0;
    const awayEfficiency = awayStats.pace > 0 ? awayStats.avgPtsFor / awayStats.pace : 1.0;
    const paceAdjTotal = (homeEfficiency + awayEfficiency) * gamePace;
    projTotal += paceAdjTotal * 15;
    tw += 15;
  }

  // 5. Splits totals (10)
  if (mH.wins + mH.losses > 3 && uA.wins + uA.losses > 3) {
    const st = (mH.avgPtsFor + mH.avgPtsAllowed + uA.avgPtsFor + uA.avgPtsAllowed) / 2;
    projTotal += st * 10;
    tw += 10;
  }

  // 6. H2H total (5)
  if (h2h && h2h.games >= 1) {
    projTotal += h2h.avgTotal * 5;
    tw += 5;
  }

  projTotal = tw > 0 ? projTotal / tw : OU_LINE;
  if (rest.isB2B) projTotal -= 2;
  if (rest.oppIsB2B) projTotal -= 2;
  projTotal = Math.round(projTotal * 10) / 10;

  const ouDiff = projTotal - OU_LINE;
  const overProb = Math.min(0.82, Math.max(0.18, 0.5 + ouDiff * 0.04));
  const underProb = 1 - overProb;
  const pickOver = overProb >= 0.5;
  const ouProb = pickOver ? overProb : underProb;
  const ouConf = ouProb >= 0.68 ? 'HIGH' : ouProb >= 0.58 ? 'MEDIUM' : 'LOW';

  console.log('\n══════════════════════════════════');
  console.log('  OVER/UNDER ANALYSIS');
  console.log('══════════════════════════════════');
  console.log(`  Projected total: ${projTotal}`);
  console.log(`  Line: ${OU_LINE}`);
  console.log(`  Difference: ${ouDiff > 0 ? '+' : ''}${ouDiff.toFixed(1)}`);
  console.log(`  ➤ PICK: ${pickOver ? 'OVER' : 'UNDER'} ${OU_LINE} (${Math.round(ouProb * 100)}% | ${ouConf} confidence)`);

  // ── Recent scores ──
  console.log('\n── Recent Game Totals ──');
  if (homeForm5) console.log(`  ${HOME_NAME} L5: ${homeForm5.scores.map(s => `${s.pts}-${s.opp} (${s.total})`).join(', ')}`);
  if (awayForm5) console.log(`  ${AWAY_NAME} L5: ${awayForm5.scores.map(s => `${s.pts}-${s.opp} (${s.total})`).join(', ')}`);

  // ── Summary ──
  console.log('\n═══════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════');
  console.log(`  ML:     ${mlPick} (${Math.round(mlProb * 100)}% | ${mlConf})`);
  if (spreadPickHome) {
    console.log(`  Spread: ${HOME_NAME} ${homeSpread} (${Math.round(spreadProb * 100)}% | ${spreadConf})`);
  } else {
    console.log(`  Spread: ${AWAY_NAME} +${Math.abs(homeSpread)} (${Math.round(spreadProb * 100)}% | ${spreadConf})`);
  }
  console.log(`  O/U:    ${pickOver ? 'OVER' : 'UNDER'} ${OU_LINE} (${Math.round(ouProb * 100)}% | ${ouConf})`);
  console.log('═══════════════════════════════════════════');
}

main().catch(console.error);
