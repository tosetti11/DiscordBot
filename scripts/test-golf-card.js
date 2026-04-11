/**
 * Test script: Generate MOCK golf tracker cards and send to Discord
 * Shows what the card looks like mid-round, late-round, and after round completes
 * Usage: node scripts/test-golf-card.js [channel_id]
 */
require('dotenv').config();
const { generateBetCardImage } = require('../src/utils/betCardImage');
const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');

const channelId = process.argv[2] || '1471170078161764578';

function baseBet() {
  return {
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
    parlay_legs: [],
  };
}

async function main() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(process.env.DISCORD_TOKEN);
  console.log('Discord logged in');
  const channel = await client.channels.fetch(channelId);

  // ── Card 1: MID-ROUND (thru 9 holes) ──
  const midRound = baseBet();
  midRound._golfData = {
    playerName: 'Si Woo Kim',
    overallScore: '+5',
    roundNum: 3,
    roundScore: 37,
    roundDisplay: '+1',
    holesCompleted: 9,
    totalHoles: 18,
    holeScores: [],
    tournamentName: 'Masters Tournament',
    roundStatus: 'in',
    position: 38,
  };

  console.log('Generating mid-round card...');
  const img1 = await generateBetCardImage(midRound, 'Tosetti', null);
  await channel.send({
    content: '🏌️ **Example 1: MID-ROUND** — Si Woo Kim thru 9 holes, shooting 37 (+1)\n> The pick is Over 71.5 — currently on pace for ~74 (looking good for the over)',
    files: [new AttachmentBuilder(img1, { name: 'golf-mid-round.png' })],
  });
  console.log('Sent mid-round card');

  // ── Card 2: LATE-ROUND (thru 16 holes) ──
  const lateRound = baseBet();
  lateRound._golfData = {
    playerName: 'Si Woo Kim',
    overallScore: '+8',
    roundNum: 3,
    roundScore: 72,
    roundDisplay: '+4',
    holesCompleted: 16,
    totalHoles: 18,
    holeScores: [],
    tournamentName: 'Masters Tournament',
    roundStatus: 'in',
    position: 52,
  };

  console.log('Generating late-round card...');
  const img2 = await generateBetCardImage(lateRound, 'Tosetti', null);
  await channel.send({
    content: '🏌️ **Example 2: LATE-ROUND** — Thru 16, shooting 72 (+4)\n> On pace for ~73.5 — still looking like the over will hit',
    files: [new AttachmentBuilder(img2, { name: 'golf-late-round.png' })],
  });
  console.log('Sent late-round card');

  // ── Card 3: ROUND COMPLETE (auto-closed as WIN) ──
  const finalRound = baseBet();
  finalRound.status = 'win';
  finalRound._golfData = {
    playerName: 'Si Woo Kim',
    overallScore: '+8',
    roundNum: 3,
    roundScore: 76,
    roundDisplay: '+4',
    holesCompleted: 18,
    totalHoles: 18,
    holeScores: [],
    tournamentName: 'Masters Tournament',
    roundStatus: 'post',
    position: 52,
  };

  console.log('Generating round-complete card...');
  const img3 = await generateBetCardImage(finalRound, 'Tosetti', null);
  await channel.send({
    content: '🏌️ **Example 3: ROUND COMPLETE** — R3 Final: 76 (+4) → **Over 71.5 = WIN** ✅\n> Card status changes to WON, progress bar shows COMPLETE',
    files: [new AttachmentBuilder(img3, { name: 'golf-final.png' })],
  });
  console.log('Sent round-complete card');

  console.log('All 3 demo cards sent!');
  client.destroy();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
