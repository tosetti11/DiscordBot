/**
 * Test: Player prop card with live stat tracking at different stages.
 * Shows Total Bases prop + Strikeouts prop at multiple game states.
 * Posts all cards to test channel.
 */
require('dotenv').config();

const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const espn = require('../src/services/espn');
const originalGetGameSummary = espn.getGameSummary;

let CURRENT_MOCK = null;
espn.getGameSummary = async function(sport, gameId) {
  if (gameId === '401814900' && CURRENT_MOCK) return CURRENT_MOCK;
  return originalGetGameSummary(sport, gameId);
};

// Mock out MLB Stats API for totalBases (since it's an MLB_API_STATS key)
const originalFindMlbGamePk = espn.findMlbGamePk;
const originalGetMlbPlayerStats = espn.getMlbPlayerStats;
let CURRENT_MLB_STATS = null;
espn.findMlbGamePk = async function(espnGameId, dateStr) {
  if (espnGameId === '401814900') return 12345;
  return originalFindMlbGamePk(espnGameId, dateStr);
};
espn.getMlbPlayerStats = async function(gamePk, playerName) {
  if (gamePk === 12345 && CURRENT_MLB_STATS) return CURRENT_MLB_STATS;
  return originalGetMlbPlayerStats(gamePk, playerName);
};

const { generateBetCardImage } = require('../src/utils/betCardImage');
const TEST_CHANNEL = '1471170078161764578';

function makePlayerStats(stats) {
  const norm = 'aaron judge';
  return {
    [norm]: { name: 'Aaron Judge', id: '12345', stats },
  };
}

function makePitcherStats(stats) {
  const norm = 'gerrit cole';
  return {
    [norm]: { name: 'Gerrit Cole', id: '67890', stats },
  };
}

// ─── TOTAL BASES PROP (batter) ───
const TB_STAGES = [
  {
    label: '1️⃣ TB Prop — Pre-Game',
    mock: {
      home: { abbreviation: 'NYY', name: 'Yankees', score: 0 },
      away: { abbreviation: 'BOS', name: 'Red Sox', score: 0 },
      state: 'pre', period: 0, detail: '7:05 PM EDT',
      players: {}, linescores: { home: [], away: [] },
    },
    mlbStats: null,
  },
  {
    label: '2️⃣ TB Prop — Top 3rd, 0 TB (0-1, no hits yet)',
    mock: {
      home: { abbreviation: 'NYY', name: 'Yankees', score: 1 },
      away: { abbreviation: 'BOS', name: 'Red Sox', score: 0 },
      state: 'in', period: 3, detail: 'Top 3rd',
      players: makePlayerStats({ ab: '1', h: '0', hr: '0', rbi: '0' }),
      linescores: { home: [{ displayValue: '1' }, { displayValue: '0' }], away: [{ displayValue: '0' }, { displayValue: '0' }, { displayValue: '0' }] },
    },
    mlbStats: { totalBases: 0, stolenBases: 0, doubles: 0, triples: 0 },
  },
  {
    label: '3️⃣ TB Prop — Bot 5th, 1 TB (1-2, single)',
    mock: {
      home: { abbreviation: 'NYY', name: 'Yankees', score: 3 },
      away: { abbreviation: 'BOS', name: 'Red Sox', score: 2 },
      state: 'in', period: 5, detail: 'Bot 5th',
      players: makePlayerStats({ ab: '2', h: '1', hr: '0', rbi: '0' }),
      linescores: {
        home: [{ displayValue: '1' }, { displayValue: '0' }, { displayValue: '2' }, { displayValue: '0' }],
        away: [{ displayValue: '0' }, { displayValue: '0' }, { displayValue: '1' }, { displayValue: '0' }, { displayValue: '1' }],
      },
    },
    mlbStats: { totalBases: 1, stolenBases: 0, doubles: 0, triples: 0 },
  },
  {
    label: '4️⃣ TB Prop — Top 7th, 3 TB (2-3, single + HR = HITTING!) 🔥',
    mock: {
      home: { abbreviation: 'NYY', name: 'Yankees', score: 5 },
      away: { abbreviation: 'BOS', name: 'Red Sox', score: 2 },
      state: 'in', period: 7, detail: 'Top 7th',
      players: makePlayerStats({ ab: '3', h: '2', hr: '1', rbi: '2' }),
      linescores: {
        home: [{ displayValue: '1' }, { displayValue: '0' }, { displayValue: '2' }, { displayValue: '0' }, { displayValue: '0' }, { displayValue: '2' }],
        away: [{ displayValue: '0' }, { displayValue: '0' }, { displayValue: '1' }, { displayValue: '0' }, { displayValue: '1' }, { displayValue: '0' }, { displayValue: '0' }],
      },
    },
    mlbStats: { totalBases: 5, stolenBases: 0, doubles: 1, triples: 0 },
  },
  {
    label: '5️⃣ TB Prop — Final, 3 TB (2-4, ended with single + HR)',
    mock: {
      home: { abbreviation: 'NYY', name: 'Yankees', score: 6 },
      away: { abbreviation: 'BOS', name: 'Red Sox', score: 3 },
      state: 'post', period: 9, detail: 'Final',
      players: makePlayerStats({ ab: '4', h: '2', hr: '1', rbi: '2' }),
      linescores: {
        home: [{ displayValue: '1' }, { displayValue: '0' }, { displayValue: '2' }, { displayValue: '0' }, { displayValue: '0' }, { displayValue: '2' }, { displayValue: '0' }, { displayValue: '1' }, { displayValue: '0' }],
        away: [{ displayValue: '0' }, { displayValue: '0' }, { displayValue: '1' }, { displayValue: '0' }, { displayValue: '1' }, { displayValue: '0' }, { displayValue: '1' }, { displayValue: '0' }, { displayValue: '0' }],
      },
    },
    mlbStats: { totalBases: 5, stolenBases: 0, doubles: 1, triples: 0 },
  },
];

// ─── STRIKEOUTS PROP (pitcher — uses ESPN stats) ───
const K_STAGES = [
  {
    label: '6️⃣ K Prop — Bot 3rd, 3 K (on pace!)',
    mock: {
      home: { abbreviation: 'NYY', name: 'Yankees', score: 1 },
      away: { abbreviation: 'BOS', name: 'Red Sox', score: 0 },
      state: 'in', period: 3, detail: 'Bot 3rd',
      players: makePitcherStats({ ip: '2.2', k: '3', h: '1', er: '0', bb: '0', pitching_k: '3', pitching_ip: '2.2' }),
      linescores: { home: [{ displayValue: '1' }, { displayValue: '0' }], away: [{ displayValue: '0' }, { displayValue: '0' }, { displayValue: '0' }] },
    },
    mlbStats: null,
  },
  {
    label: '7️⃣ K Prop — Top 6th, 7 K (CRUSHING IT) 🔥',
    mock: {
      home: { abbreviation: 'NYY', name: 'Yankees', score: 4 },
      away: { abbreviation: 'BOS', name: 'Red Sox', score: 1 },
      state: 'in', period: 6, detail: 'Top 6th',
      players: makePitcherStats({ ip: '5.0', k: '7', h: '3', er: '1', bb: '1', pitching_k: '7', pitching_ip: '5.0' }),
      linescores: {
        home: [{ displayValue: '1' }, { displayValue: '0' }, { displayValue: '2' }, { displayValue: '0' }, { displayValue: '1' }],
        away: [{ displayValue: '0' }, { displayValue: '0' }, { displayValue: '1' }, { displayValue: '0' }, { displayValue: '0' }, { displayValue: '0' }],
      },
    },
    mlbStats: null,
  },
];

// Single prop bet objects
const tbBet = {
  id: 'test-prop-tb',
  slip_number: 'THE-TB1',
  bet_type: 'single',
  wager_type: 'prop',
  sport: 'mlb',
  pick: 'Aaron Judge Over 1.5 Total Bases',
  team_a: 'BOS Red Sox',
  team_b: 'NYY Yankees',
  player_name: 'Aaron Judge',
  prop_description: 'Over 1.5 Total Bases',
  odds_american: -130,
  odds_decimal: 1.77,
  units: 1.5,
  status: 'open',
  espn_game_id: '401814900',
  event_start_time: 'Sat Jun 14 7:05 PM ET',
  is_whale: false,
  is_retro: false,
  discord_id: '123456789',
  guild_id: '123',
  created_at: new Date().toISOString(),
};

const kBet = {
  id: 'test-prop-k',
  slip_number: 'THE-K01',
  bet_type: 'single',
  wager_type: 'prop',
  sport: 'mlb',
  pick: 'Gerrit Cole Over 5.5 Strikeouts',
  team_a: 'BOS Red Sox',
  team_b: 'NYY Yankees',
  player_name: 'Gerrit Cole',
  prop_description: 'Over 5.5 Strikeouts',
  odds_american: -115,
  odds_decimal: 1.87,
  units: 2,
  status: 'open',
  espn_game_id: '401814900',
  event_start_time: 'Sat Jun 14 7:05 PM ET',
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

  // Post Total Bases stages
  for (const stage of TB_STAGES) {
    CURRENT_MOCK = stage.mock;
    CURRENT_MLB_STATS = stage.mlbStats;
    const imgBuffer = await generateBetCardImage(tbBet, 'TheKing', '');
    console.log(`${stage.label} — ${imgBuffer.length} bytes`);
    const attachment = new AttachmentBuilder(imgBuffer, { name: 'prop-card.png' });
    await channel.send({ content: stage.label, files: [attachment] });
  }

  // Post Strikeouts stages
  for (const stage of K_STAGES) {
    CURRENT_MOCK = stage.mock;
    CURRENT_MLB_STATS = stage.mlbStats;
    const imgBuffer = await generateBetCardImage(kBet, 'TheKing', '');
    console.log(`${stage.label} — ${imgBuffer.length} bytes`);
    const attachment = new AttachmentBuilder(imgBuffer, { name: 'prop-card.png' });
    await channel.send({ content: stage.label, files: [attachment] });
  }

  console.log('✅ All 7 prop cards posted');
  client.destroy();
  process.exit(0);
})();
