/**
 * Test script: Generate 5 golf parlay cards at different round stages and post to test channel.
 * 3-leg parlay: Rory McIlroy, Scottie Scheffler, Jordan Spieth — all Under 70.5 R4 Masters
 * Usage: node scripts/test-golf-parlay-stages.js
 */
require('dotenv').config();

const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');

// Monkey-patch the ESPN module BEFORE betCardImage requires it
const espn = require('../src/services/espn');
const originalGetGolfPlayerRound = espn.getGolfPlayerRound;

// 5 stages of mock golf data for each player
const STAGES = [
  // Stage 1: Early — all thru 3-4 holes
  {
    label: '🏌️ Stage 1: Early Round — Thru 3-4 holes',
    players: {
      'Rory McIlroy': { playerName: 'Rory McIlroy', roundStatus: 'in', roundScore: 69, roundNum: 4, holesCompleted: 4, totalHoles: 18, roundDisplay: '-1', position: 'T5', overallScore: '-8' },
      'Scottie Scheffler': { playerName: 'Scottie Scheffler', roundStatus: 'in', roundScore: 70, roundNum: 4, holesCompleted: 3, totalHoles: 18, roundDisplay: 'E', position: '2', overallScore: '-10' },
      'Jordan Spieth': { playerName: 'Jordan Spieth', roundStatus: 'in', roundScore: 68, roundNum: 4, holesCompleted: 4, totalHoles: 18, roundDisplay: '-2', position: 'T8', overallScore: '-6' },
    },
  },
  // Stage 2: Mid-round — mixed progress, thru 8-10
  {
    label: '🏌️ Stage 2: Mid-Round — Thru 8-10 holes',
    players: {
      'Rory McIlroy': { playerName: 'Rory McIlroy', roundStatus: 'in', roundScore: 68, roundNum: 4, holesCompleted: 9, totalHoles: 18, roundDisplay: '-2', position: 'T3', overallScore: '-9' },
      'Scottie Scheffler': { playerName: 'Scottie Scheffler', roundStatus: 'in', roundScore: 67, roundNum: 4, holesCompleted: 10, totalHoles: 18, roundDisplay: '-3', position: '1', overallScore: '-13' },
      'Jordan Spieth': { playerName: 'Jordan Spieth', roundStatus: 'in', roundScore: 71, roundNum: 4, holesCompleted: 8, totalHoles: 18, roundDisplay: '+1', position: 'T12', overallScore: '-3' },
    },
  },
  // Stage 3: Late round — thru 14-16
  {
    label: '🏌️ Stage 3: Late Round — Thru 14-16 holes',
    players: {
      'Rory McIlroy': { playerName: 'Rory McIlroy', roundStatus: 'in', roundScore: 69, roundNum: 4, holesCompleted: 16, totalHoles: 18, roundDisplay: '-1', position: 'T4', overallScore: '-8' },
      'Scottie Scheffler': { playerName: 'Scottie Scheffler', roundStatus: 'in', roundScore: 66, roundNum: 4, holesCompleted: 15, totalHoles: 18, roundDisplay: '-4', position: '1', overallScore: '-14' },
      'Jordan Spieth': { playerName: 'Jordan Spieth', roundStatus: 'in', roundScore: 70, roundNum: 4, holesCompleted: 14, totalHoles: 18, roundDisplay: 'E', position: 'T9', overallScore: '-4' },
    },
  },
  // Stage 4: Mixed — Scheffler done, Rory close, Spieth still playing
  {
    label: '🏌️ Stage 4: Mixed — 1 finished, 2 still playing',
    players: {
      'Rory McIlroy': { playerName: 'Rory McIlroy', roundStatus: 'in', roundScore: 69, roundNum: 4, holesCompleted: 17, totalHoles: 18, roundDisplay: '-1', position: 'T3', overallScore: '-8' },
      'Scottie Scheffler': { playerName: 'Scottie Scheffler', roundStatus: 'post', roundScore: 66, roundNum: 4, holesCompleted: 18, totalHoles: 18, roundDisplay: '-4', position: '1', overallScore: '-14' },
      'Jordan Spieth': { playerName: 'Jordan Spieth', roundStatus: 'in', roundScore: 70, roundNum: 4, holesCompleted: 15, totalHoles: 18, roundDisplay: 'E', position: 'T10', overallScore: '-4' },
    },
  },
  // Stage 5: All finished — final results
  {
    label: '🏌️ Stage 5: All Rounds Complete — Final',
    players: {
      'Rory McIlroy': { playerName: 'Rory McIlroy', roundStatus: 'post', roundScore: 69, roundNum: 4, holesCompleted: 18, totalHoles: 18, roundDisplay: '-1', position: 'T3', overallScore: '-8' },
      'Scottie Scheffler': { playerName: 'Scottie Scheffler', roundStatus: 'post', roundScore: 66, roundNum: 4, holesCompleted: 18, totalHoles: 18, roundDisplay: '-4', position: '1', overallScore: '-14' },
      'Jordan Spieth': { playerName: 'Jordan Spieth', roundStatus: 'post', roundScore: 70, roundNum: 4, holesCompleted: 18, totalHoles: 18, roundDisplay: 'E', position: 'T9', overallScore: '-4' },
    },
  },
];

// Current stage index (will be swapped before each card render)
let currentStage = 0;

// Override getGolfPlayerRound to return mock data
espn.getGolfPlayerRound = async function(playerName, roundNum) {
  const stage = STAGES[currentStage];
  if (stage && stage.players[playerName]) {
    return stage.players[playerName];
  }
  return originalGetGolfPlayerRound(playerName, roundNum);
};

const { generateBetCardImage } = require('../src/utils/betCardImage');

const TEST_CHANNEL = '1471170078161764578';

// Mock bet object — no DB needed
function createMockBet(stage) {
  // For the final stage, mark all legs as won
  const allFinal = Object.values(stage.players).every(p => p.roundStatus === 'post');
  const allUnder = Object.values(stage.players).every(p => p.roundScore < 70.5);
  
  // Determine leg statuses
  const legStatus = (player) => {
    const p = stage.players[player];
    if (p.roundStatus === 'post') return p.roundScore < 70.5 ? 'win' : 'loss';
    return 'open';
  };

  const parentStatus = allFinal ? (allUnder ? 'win' : 'loss') : 'open';

  return {
    id: 'test-golf-parlay-001',
    slip_number: 'TEST-GP1',
    bet_type: 'parlay',
    sport: null,
    status: parentStatus,
    pick: '3-Leg Parlay',
    units: 2,
    odds_american: '+550',
    odds_decimal: '6.50',
    team_a: null,
    team_b: null,
    player_name: null,
    created_at: new Date().toISOString(),
    is_whale: false,
    bet_note: 'Masters R4 Under props — all 3 going at once',
    parlay_legs: [
      {
        id: 'leg-rory',
        sport: 'golf_pga',
        wager_type: 'prop',
        pick: 'Rory McIlroy Under 70.5',
        player_name: 'Rory McIlroy',
        team_a: null,
        team_b: null,
        prop_description: 'Round Score',
        golf_round: 4,
        golf_hole: null,
        espn_game_id: '401811941',
        odds_american: '-115',
        status: legStatus('Rory McIlroy'),
        event_start_time: 'Sun 2:00 PM',
      },
      {
        id: 'leg-scottie',
        sport: 'golf_pga',
        wager_type: 'prop',
        pick: 'Scottie Scheffler Under 70.5',
        player_name: 'Scottie Scheffler',
        team_a: null,
        team_b: null,
        prop_description: 'Round Score',
        golf_round: 4,
        golf_hole: null,
        espn_game_id: '401811941',
        odds_american: '-110',
        status: legStatus('Scottie Scheffler'),
        event_start_time: 'Sun 2:00 PM',
      },
      {
        id: 'leg-spieth',
        sport: 'golf_pga',
        wager_type: 'prop',
        pick: 'Jordan Spieth Under 70.5',
        player_name: 'Jordan Spieth',
        team_a: null,
        team_b: null,
        prop_description: 'Round Score',
        golf_round: 4,
        golf_hole: null,
        espn_game_id: '401811941',
        odds_american: '+100',
        status: legStatus('Jordan Spieth'),
        event_start_time: 'Sun 2:00 PM',
      },
    ],
  };
}

(async () => {
  try {
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    await client.login(process.env.DISCORD_TOKEN);
    console.log('Logged in to Discord');

    const channel = await client.channels.fetch(TEST_CHANNEL);

    for (let i = 0; i < STAGES.length; i++) {
      currentStage = i;
      const stage = STAGES[i];
      const bet = createMockBet(stage);

      console.log(`Generating card ${i + 1}/5: ${stage.label}`);
      const imgBuffer = await generateBetCardImage(bet, 'TheGamblingKing', '');
      console.log(`  Card ${i + 1}: ${imgBuffer.length} bytes`);

      const attachment = new AttachmentBuilder(imgBuffer, { name: `golf-parlay-stage-${i + 1}.png` });
      await channel.send({
        content: `🧪 **Test: Golf Parlay Card ${i + 1}/5**\n${stage.label}`,
        files: [attachment],
      });
      console.log(`  ✅ Posted stage ${i + 1}`);
    }

    console.log('\n✅ All 5 golf parlay test cards posted!');
    client.destroy();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
