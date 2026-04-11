/**
 * Test: MLB moneyline card at 5 different game stages.
 * Posts all 5 to test channel.
 */
require('dotenv').config();

const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const espn = require('../src/services/espn');
const originalGetGameSummary = espn.getGameSummary;

let CURRENT_MOCK = null;
espn.getGameSummary = async function(sport, gameId) {
  if (gameId === '401814897' && CURRENT_MOCK) return CURRENT_MOCK;
  return originalGetGameSummary(sport, gameId);
};

const { generateBetCardImage } = require('../src/utils/betCardImage');
const TEST_CHANNEL = '1471170078161764578';

// 5 stages of NYY vs TB
const STAGES = [
  {
    label: '1️⃣ Pre-Game (card just created)',
    mock: {
      home: { abbreviation: 'NYY', name: 'Yankees', score: 0 },
      away: { abbreviation: 'TB', name: 'Rays', score: 0 },
      state: 'pre',
      period: 0,
      detail: '6:10 PM EDT',
      linescores: { home: [], away: [] },
    },
  },
  {
    label: '2️⃣ Early Game — Top 2nd, 0-0',
    mock: {
      home: { abbreviation: 'NYY', name: 'Yankees', score: 0 },
      away: { abbreviation: 'TB', name: 'Rays', score: 0 },
      state: 'in',
      period: 2,
      detail: 'Top 2nd',
      linescores: {
        home: [{ displayValue: '0' }],
        away: [{ displayValue: '0' }, { displayValue: '0' }],
      },
    },
  },
  {
    label: '3️⃣ Mid Game — Bot 5th, NYY leads 3-1',
    mock: {
      home: { abbreviation: 'NYY', name: 'Yankees', score: 3 },
      away: { abbreviation: 'TB', name: 'Rays', score: 1 },
      state: 'in',
      period: 5,
      detail: 'Bot 5th',
      linescores: {
        home: [{ displayValue: '0' }, { displayValue: '2' }, { displayValue: '0' }, { displayValue: '1' }],
        away: [{ displayValue: '1' }, { displayValue: '0' }, { displayValue: '0' }, { displayValue: '0' }, { displayValue: '0' }],
      },
    },
  },
  {
    label: '4️⃣ Late Game — Top 9th, NYY 4-3 (close game!)',
    mock: {
      home: { abbreviation: 'NYY', name: 'Yankees', score: 4 },
      away: { abbreviation: 'TB', name: 'Rays', score: 3 },
      state: 'in',
      period: 9,
      detail: 'Top 9th',
      linescores: {
        home: [{ displayValue: '0' }, { displayValue: '2' }, { displayValue: '0' }, { displayValue: '1' }, { displayValue: '0' }, { displayValue: '0' }, { displayValue: '0' }, { displayValue: '1' }],
        away: [{ displayValue: '1' }, { displayValue: '0' }, { displayValue: '0' }, { displayValue: '0' }, { displayValue: '0' }, { displayValue: '2' }, { displayValue: '0' }, { displayValue: '0' }, { displayValue: '0' }],
      },
    },
  },
  {
    label: '5️⃣ Final — NYY wins 4-3',
    mock: {
      home: { abbreviation: 'NYY', name: 'Yankees', score: 4 },
      away: { abbreviation: 'TB', name: 'Rays', score: 3 },
      state: 'post',
      period: 9,
      detail: 'Final',
      linescores: {
        home: [{ displayValue: '0' }, { displayValue: '2' }, { displayValue: '0' }, { displayValue: '1' }, { displayValue: '0' }, { displayValue: '0' }, { displayValue: '0' }, { displayValue: '1' }, { displayValue: '0' }],
        away: [{ displayValue: '1' }, { displayValue: '0' }, { displayValue: '0' }, { displayValue: '0' }, { displayValue: '0' }, { displayValue: '2' }, { displayValue: '0' }, { displayValue: '0' }, { displayValue: '0' }],
      },
    },
  },
];

// Fake bet object (moneyline NYY)
const fakeBet = {
  id: 'test-ml-001',
  slip_number: 'THE-999',
  bet_type: 'single',
  wager_type: 'moneyline',
  sport: 'mlb',
  pick: 'NYY Yankees ML -135',
  team_a: 'TB Rays',
  team_b: 'NYY Yankees',
  odds_american: -135,
  odds_decimal: 1.74,
  units: 2,
  status: 'open',
  espn_game_id: '401814897',
  event_start_time: 'Fri Apr 11 6:10 PM ET',
  is_whale: false,
  is_retro: false,
  discord_id: '123456789',
  guild_id: '123',
  created_at: new Date().toISOString(),
};

(async () => {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(process.env.DISCORD_TOKEN);
  console.log('Logged in');

  const channel = await client.channels.fetch(TEST_CHANNEL);

  for (const stage of STAGES) {
    CURRENT_MOCK = stage.mock;
    const imgBuffer = await generateBetCardImage(fakeBet, 'TheKing', '');
    console.log(`${stage.label} — ${imgBuffer.length} bytes`);
    const attachment = new AttachmentBuilder(imgBuffer, { name: 'ml-card.png' });
    await channel.send({ content: stage.label, files: [attachment] });
  }

  console.log('✅ All 5 cards posted');
  client.destroy();
  process.exit(0);
})();
