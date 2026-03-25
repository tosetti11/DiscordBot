/**
 * Test script: Send a mock golf H2H matchup pick card to a test channel.
 * Usage: node scripts/test-golf-card.js
 */
require('dotenv').config();
const { Client, GatewayIntentBits, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { generateGolfPickCardImage, generateGolfRecapImage, generateGolfTournamentRecapImage } = require('../src/utils/golfPickCardImage');

const TEST_CHANNEL = '1471170078161764578';

const mockPick = {
  id: 'test-001',
  pick: 'Scottie Scheffler over Rory McIlroy',
  team_a: 'Scottie Scheffler',
  team_b: 'Rory McIlroy',
  player_name: 'Scottie Scheffler',
  odds_american: -125,
  confidence: 82,
  tournament_name: 'Houston Open',
  prop_description: 'Tournament Matchup \u2022 DraftKings',
  reasoning: 'Scheffler has 3 top-5 finishes in his last 5 starts and leads the tour in strokes gained tee-to-green. McIlroy has struggled on Bermuda greens this season with a 71.2 scoring avg on similar surfaces.',
  status: 'pending',
};

const mockClosedPick = {
  ...mockPick,
  id: 'test-002',
  status: 'win',
  result_note: 'Scheffler finished T3 (-12), McIlroy T18 (-6)',
  final_score: 'Scheffler -12 vs McIlroy -6',
};

const mockRecord = { wins: 7, losses: 4, pushes: 1 };

const recapPicks = [
  { pick: 'Scheffler over McIlroy', status: 'win', final_score: '-12 vs -6' },
  { pick: 'Hovland over Rahm', status: 'loss', final_score: '-8 vs -10' },
  { pick: 'Clark over Morikawa', status: 'win', final_score: '-9 vs -7' },
];

async function run() {
  console.log('Generating images...');

  // Generate all 3 card types
  const [pickCard, recapCard, tournamentRecap] = await Promise.all([
    generateGolfPickCardImage(mockPick, mockRecord, 1, 3),
    generateGolfRecapImage(mockClosedPick, mockRecord),
    generateGolfTournamentRecapImage(recapPicks, 'Houston Open', mockRecord),
  ]);

  console.log('Images generated. Connecting to Discord...');

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    try {
      const channel = await client.channels.fetch(TEST_CHANNEL);

      // 1) Pick card
      await channel.send({
        content: '\u26f3 **GOLF H2H MATCHUP** — Pick 1/3 (TEST)',
        files: [new AttachmentBuilder(pickCard, { name: 'golf-pick-test.png' })],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('test_tail').setLabel('\u26f3 Tail (0)').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('test_fade').setLabel('Fade (0)').setStyle(ButtonStyle.Danger),
          ),
        ],
      });
      console.log('Sent pick card');

      // 2) Result card
      await channel.send({
        content: '\u2705 **GOLF H2H RESULT** (TEST)',
        files: [new AttachmentBuilder(recapCard, { name: 'golf-recap-test.png' })],
      });
      console.log('Sent recap card');

      // 3) Tournament recap
      await channel.send({
        content: '\u26f3 **WEEKLY GOLF RECAP** — Houston Open (TEST)',
        files: [new AttachmentBuilder(tournamentRecap, { name: 'golf-tournament-recap-test.png' })],
      });
      console.log('Sent tournament recap');

      console.log('All 3 cards sent! Check the test channel.');
    } catch (e) {
      console.error('Error:', e);
    }
    client.destroy();
    process.exit(0);
  });

  await client.login(process.env.DISCORD_TOKEN);
}

run().catch(console.error);
