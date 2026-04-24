/**
 * Test script: Generate a 2-ball/team parlay card with mock match-play data
 * and post it to the test channel. Simulates THE-086 (Zurich Classic R2).
 * Usage: node scripts/test-2ball-parlay-card.js [channelId]
 */
require('dotenv').config();

const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');

// Monkey-patch getGolf2BallLive BEFORE betCardImage requires it
const espn = require('../src/services/espn');
const originalGetGolf2BallLive = espn.getGolf2BallLive;

// Mid-round mock data for each of the 3 legs (Zurich Classic R2, thru 11 holes)
const MOCK_MATCHUPS = {
  // Leg 1: Hossler/Ryder vs Watney/Hoffman — Group A leading by 2
  'Hossler': {
    tournamentName: 'Zurich Classic of New Orleans',
    roundNum: 2,
    overallStatus: 'in',
    isTeamFormat: true,
    is3Ball: false,
    maxHoles: 11,
    groupA: {
      displayName: 'Hossler / Ryder',
      player1: { name: 'Beau Hossler', roundScore: -3, holesCompleted: 11, roundStatus: 'in', overallScore: '-5', roundDisplay: '-3' },
      player2: { name: 'Sam Ryder', roundScore: -4, holesCompleted: 11, roundStatus: 'in', overallScore: '-6', roundDisplay: '-4' },
      roundScore: -7,
      holesCompleted: 11,
    },
    groupB: {
      displayName: 'Watney / Hoffman',
      player1: { name: 'Nick Watney', roundScore: -2, holesCompleted: 11, roundStatus: 'in', overallScore: '-3', roundDisplay: '-2' },
      player2: { name: 'Charley Hoffman', roundScore: -3, holesCompleted: 11, roundStatus: 'in', overallScore: '-4', roundDisplay: '-3' },
      roundScore: -5,
      holesCompleted: 11,
    },
    groupC: null,
    matchStatus: { up: 2, label: '2 Up', ahead: true },
    matchStatusVsC: null,
  },
  // Leg 2: Svensson/Nyholm vs Capan/Goodwin — All Square
  'Svensson': {
    tournamentName: 'Zurich Classic of New Orleans',
    roundNum: 2,
    overallStatus: 'in',
    isTeamFormat: true,
    is3Ball: false,
    maxHoles: 9,
    groupA: {
      displayName: 'Svensson / Nyholm',
      player1: { name: 'Henrik Norlander', roundScore: -2, holesCompleted: 9, roundStatus: 'in', overallScore: '-3', roundDisplay: '-2' },
      player2: { name: 'Jesper Svensson', roundScore: -1, holesCompleted: 9, roundStatus: 'in', overallScore: '-2', roundDisplay: '-1' },
      roundScore: -3,
      holesCompleted: 9,
    },
    groupB: {
      displayName: 'Capan / Goodwin',
      player1: { name: 'Erik Capan', roundScore: -2, holesCompleted: 9, roundStatus: 'in', overallScore: '-3', roundDisplay: '-2' },
      player2: { name: 'Pierceson Coody', roundScore: -1, holesCompleted: 9, roundStatus: 'in', overallScore: '-2', roundDisplay: '-1' },
      roundScore: -3,
      holesCompleted: 9,
    },
    groupC: null,
    matchStatus: { label: 'AS', ahead: null },
    matchStatusVsC: null,
  },
  // Leg 3: Olesen/Neergaard-Petersen vs Shipley/Lamprecht — Group A trailing by 1
  'Olesen': {
    tournamentName: 'Zurich Classic of New Orleans',
    roundNum: 2,
    overallStatus: 'in',
    isTeamFormat: true,
    is3Ball: false,
    maxHoles: 13,
    groupA: {
      displayName: 'Olesen / Neergaard-Petersen',
      player1: { name: 'Thorbjorn Olesen', roundScore: -2, holesCompleted: 13, roundStatus: 'in', overallScore: '-4', roundDisplay: '-2' },
      player2: { name: 'Rasmus Neergaard-Petersen', roundScore: -1, holesCompleted: 13, roundStatus: 'in', overallScore: '-2', roundDisplay: '-1' },
      roundScore: -3,
      holesCompleted: 13,
    },
    groupB: {
      displayName: 'Shipley / Lamprecht',
      player1: { name: 'Barclay Brown', roundScore: -3, holesCompleted: 13, roundStatus: 'in', overallScore: '-5', roundDisplay: '-3' },
      player2: { name: 'Aldrich Potgieter', roundScore: -1, holesCompleted: 13, roundStatus: 'in', overallScore: '-3', roundDisplay: '-1' },
      roundScore: -4,
      holesCompleted: 13,
    },
    groupC: null,
    matchStatus: { down: 1, label: '1 Dn', ahead: false },
    matchStatusVsC: null,
  },
};

// Patch espn.getGolf2BallLive to return mock data by playerA name
espn.getGolf2BallLive = async ({ playerA }) => {
  // Find mock data by matching playerA first name / last name
  for (const [key, data] of Object.entries(MOCK_MATCHUPS)) {
    if (playerA && playerA.toLowerCase().includes(key.toLowerCase())) return data;
  }
  return null;
};

const { generateBetCardImage } = require('../src/utils/betCardImage');

const channelId = process.argv[2] || '1471170078161764578';

// The parlay bet structure matching THE-086
const BET = {
  id: '8a490615-39ff-45c7-91c8-06fb3570d56b',
  slip_number: 'THE-086',
  sport: 'golf_pga',
  bet_type: 'parlay',
  bet_category: 'team_game',
  wager_type: 'moneyline',
  pick: '3-Leg Parlay',
  player_name: null,
  team_a: null,
  team_b: null,
  odds_american: 413,
  odds_decimal: 5.13,
  units: 0.8,
  status: 'open',
  is_whale: false,
  is_retro: false,
  golf_round: null,
  period: 'full_game',
  event_start_time: null,
  espn_game_id: null,
  bet_note: 'Actual odds are +343. Used a 20% boost so limited to $20.',
  created_at: new Date().toISOString(),
  parlay_legs: [
    {
      id: 'leg-1-hossler-ryder',
      sport: 'golf_pga',
      bet_category: 'team_game',
      wager_type: '2ball',
      pick: 'Hossler / Ryder ML',
      team_a: 'Hossler / Ryder',
      team_b: 'Watney / Hoffman',
      player_name: null,
      odds_american: -140,
      golf_round: 2,
      golf_hole: null,
      period: 'full_game',
      event_start_time: null,
      espn_game_id: '401811943',
      status: 'open',
      match_player_a: 'Hossler',
      match_player_a2: 'Ryder',
      match_player_b: 'Watney',
      match_player_b2: 'Hoffman',
      match_player_c: null,
    },
    {
      id: 'leg-2-svensson-nyholm',
      sport: 'golf_pga',
      bet_category: 'team_game',
      wager_type: '2ball',
      pick: 'Svensson / Nyholm ML',
      team_a: 'Svensson / Nyholm',
      team_b: 'Capan / Goodwin',
      player_name: null,
      odds_american: -130,
      golf_round: 2,
      golf_hole: null,
      period: 'full_game',
      event_start_time: null,
      espn_game_id: '401811943',
      status: 'open',
      match_player_a: 'Svensson',
      match_player_a2: 'Nyholm',
      match_player_b: 'Capan',
      match_player_b2: 'Goodwin',
      match_player_c: null,
    },
    {
      id: 'leg-3-olesen-NP',
      sport: 'golf_pga',
      bet_category: 'team_game',
      wager_type: '2ball',
      pick: 'Olesen / Neergaard-Petersen ML',
      team_a: 'Olesen / Neergaard-Petersen',
      team_b: 'Shipley / Lamprecht',
      player_name: null,
      odds_american: -150,
      golf_round: 2,
      golf_hole: null,
      period: 'full_game',
      event_start_time: null,
      espn_game_id: '401811943',
      status: 'open',
      match_player_a: 'Olesen',
      match_player_a2: 'Neergaard-Petersen',
      match_player_b: 'Shipley',
      match_player_b2: 'Lamprecht',
      match_player_c: null,
    },
  ],
};

async function main() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(process.env.DISCORD_TOKEN);
  console.log('Discord logged in');
  const channel = await client.channels.fetch(channelId);

  console.log('Generating 2-ball parlay card for THE-086...');
  const imgBuffer = await generateBetCardImage(BET, 'TheGamblingKing', '');
  const attachment = new AttachmentBuilder(imgBuffer, { name: 'the-086-2ball-parlay.png' });
  await channel.send({
    content: '📊 **THE-086 — 2-Ball Parlay Card Test** (Zurich Classic R2, mid-round mock data)',
    files: [attachment],
  });
  console.log('Card sent!');
  await client.destroy();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
