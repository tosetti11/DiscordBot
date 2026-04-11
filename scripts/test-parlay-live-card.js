/**
 * Test script: Generate a parlay card with mock live scores and post to test channel.
 * Usage: node scripts/test-parlay-live-card.js
 * Requires .env to be loaded (run on EC2 or set env vars locally).
 */
require('dotenv').config();

const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');

// Monkey-patch the ESPN module BEFORE betCardImage requires it
const espn = require('../src/services/espn');
const originalGetGameSummary = espn.getGameSummary;

// Mock live scores for the 4 NRFI legs (using actual ESPN game IDs from THE-065)
const MOCK_SCORES = {
  // MIA @ DET — Top 3rd, 0-0 (NRFI looking good)
  '401814895': {
    home: { abbreviation: 'DET', name: 'Tigers', score: 0 },
    away: { abbreviation: 'MIA', name: 'Marlins', score: 0 },
    state: 'in',
    detail: 'Top 3rd',
  },
  // PIT @ CHC — Bot 5th, 2-1 (NRFI already resolved, run scored in 3rd)
  '401814901': {
    home: { abbreviation: 'CHC', name: 'Cubs', score: 2 },
    away: { abbreviation: 'PIT', name: 'Pirates', score: 1 },
    state: 'in',
    detail: 'Bot 5th',
  },
  // MIN @ TOR — Top 1st (just started)
  '401814896': {
    home: { abbreviation: 'TOR', name: 'Blue Jays', score: 0 },
    away: { abbreviation: 'MIN', name: 'Twins', score: 0 },
    state: 'in',
    detail: 'Top 1st',
  },
  // ARI @ PHI — Final 3-2 
  '401814892': {
    home: { abbreviation: 'PHI', name: 'Phillies', score: 3 },
    away: { abbreviation: 'ARI', name: 'D-backs', score: 2 },
    state: 'post',
    detail: 'Final',
  },
};

// Override getGameSummary to return mock data
espn.getGameSummary = async function(sport, gameId) {
  if (MOCK_SCORES[gameId]) return MOCK_SCORES[gameId];
  return originalGetGameSummary(sport, gameId);
};

const { generateBetCardImage } = require('../src/utils/betCardImage');
const { supabase } = require('../src/config/supabase');

const TEST_CHANNEL = '1471170078161764578';

(async () => {
  try {
    // Fetch THE-065 from DB
    const { data: bet, error } = await supabase
      .from('bets')
      .select('*, parlay_legs(*)')
      .eq('slip_number', 'THE-065')
      .single();

    if (error || !bet) {
      console.error('Could not find THE-065:', error?.message);
      process.exit(1);
    }

    console.log(`Found ${bet.slip_number}: ${bet.parlay_legs.length} legs, status=${bet.status}`);
    for (const leg of bet.parlay_legs) {
      console.log(`  Leg: ${leg.pick} | espn_game_id=${leg.espn_game_id} | status=${leg.status}`);
    }

    // Generate card with mock live scores
    const imgBuffer = await generateBetCardImage(bet, 'TestUser', '');
    console.log(`Card generated: ${imgBuffer.length} bytes`);

    // Post to test channel via Discord
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });

    await client.login(process.env.DISCORD_TOKEN);
    console.log('Logged in to Discord');

    const channel = await client.channels.fetch(TEST_CHANNEL);
    const attachment = new AttachmentBuilder(imgBuffer, { name: 'parlay-live-test.png' });
    await channel.send({
      content: '🧪 **Test: Parlay card with multiple live games**\nMock data: 1 game 0-0 (3rd), 1 game 2-1 (5th), 1 game just started (1st), 1 game final.',
      files: [attachment],
    });

    console.log('✅ Posted test card to test channel');
    client.destroy();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
