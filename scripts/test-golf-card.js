/**
 * Test script: Generate golf tracker card and send to Discord
 * Usage: node scripts/test-golf-card.js <channel_id>
 */
require('dotenv').config();
const { generateBetCardImage } = require('../src/utils/betCardImage');
const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');

const channelId = process.argv[2] || '1471170078161764578';

async function main() {
  // ── Mock bet that looks like THE-064 ──
  const mockBet = {
    id: 'test-golf-demo',
    slip_number: 'THE-064',
    sport: 'golf_pga',
    bet_type: 'single',
    bet_category: 'player_prop',
    wager_type: 'prop',
    pick: 'Over 71.5 Round Score (R3)',
    player_name: 'Si Woo Kim',
    team_a: null,
    team_b: null,
    odds_american: -115,
    odds_decimal: 1.87,
    units: 1,
    status: 'open',
    is_whale: false,
    is_retro: false,
    golf_round: 3,
    golf_hole: null,
    period: 'full_game',
    event_start_time: 'Sat Apr 11 2:00 PM ET',
    espn_game_id: '401811941',
    bet_note: null,
    created_at: new Date().toISOString(),
    display_name: 'Tosetti',
    parlay_legs: [],
  };

  console.log('Generating card image (fetching LIVE ESPN data)...');
  const imgBuffer = await generateBetCardImage(mockBet, 'Tosetti', null);
  console.log('Card generated');

  // Send to Discord
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(process.env.DISCORD_TOKEN);
  console.log('Discord logged in');

  const channel = await client.channels.fetch(channelId);
  const attachment = new AttachmentBuilder(imgBuffer, { name: 'golf-tracker-demo.png' });
  await channel.send({
    content: '🏌️ **Golf Tracker Demo** — Here\'s what THE-064 looks like with live round tracking.\nThis card pulls real-time data from ESPN for Si Woo Kim\'s current round:',
    files: [attachment],
  });
  console.log('Sent to Discord channel', channelId);

  client.destroy();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
