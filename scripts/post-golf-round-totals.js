/**
 * Golf Round Totals — Screenshot-to-Picks Script
 *
 * Reads DraftKings screenshot images from scripts/golf-screenshots/,
 * sends them to GPT-4o Vision to extract round score O/U lines,
 * picks top 10 bets ranked by confidence with detailed analysis,
 * generates card images, and posts them to Discord.
 *
 * Usage:
 *   node scripts/post-golf-round-totals.js
 *   node scripts/post-golf-round-totals.js --dry-run      (preview without posting)
 *   node scripts/post-golf-round-totals.js --tournament "Cognizant Classic"
 *   node scripts/post-golf-round-totals.js --round "Round 1"
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { generateGolfRoundOUCardImage } = require('../src/utils/golfPickCardImage');
const aiPicksDb = require('../src/database/aiPicks');

const AI_PICKS_CHANNEL_ID = '1483720217044713674';
const GOLF_CHANNEL_ID = '1485903920906895370'; // AI Open Slips
const SCREENSHOTS_DIR = path.join(__dirname, 'golf-screenshots');

// Parse CLI args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

function getArgValue(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

const tournamentArg = getArgValue('--tournament') || 'PGA Tournament';
const roundArg = getArgValue('--round') || 'Round 1';

async function main() {
  console.log('⛳ Golf Round Totals — Screenshot-to-Picks');
  console.log(`   Tournament: ${tournamentArg}`);
  console.log(`   Round: ${roundArg}`);
  console.log(`   Dry run: ${dryRun}`);
  console.log('');

  // ── Step 1: Read screenshot images ──
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    console.error(`❌ Screenshots folder not found: ${SCREENSHOTS_DIR}`);
    console.log('   Create this folder and add your DraftKings screenshot images (.jpg, .png, .webp)');
    process.exit(1);
  }

  const imageExts = ['.jpg', '.jpeg', '.png', '.webp'];
  const imageFiles = fs.readdirSync(SCREENSHOTS_DIR)
    .filter(f => imageExts.includes(path.extname(f).toLowerCase()))
    .sort();

  if (imageFiles.length === 0) {
    console.error('❌ No image files found in', SCREENSHOTS_DIR);
    process.exit(1);
  }

  console.log(`📸 Found ${imageFiles.length} screenshot(s):`);
  imageFiles.forEach(f => console.log(`   • ${f}`));
  console.log('');

  // ── Step 2: Encode images as base64 for Vision API ──
  const imagePayloads = imageFiles.map(f => {
    const filePath = path.join(SCREENSHOTS_DIR, f);
    const data = fs.readFileSync(filePath);
    const ext = path.extname(f).toLowerCase().replace('.', '');
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : 'image/webp';
    return {
      type: 'image_url',
      image_url: { url: `data:${mime};base64,${data.toString('base64')}` },
    };
  });

  // ── Step 3: Send to GPT-4o Vision ──
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not set in .env');
    process.exit(1);
  }

  console.log('🤖 Sending screenshots to GPT-4o Vision for analysis...');

  const prompt = `You are an elite golf handicapper AI. I'm showing you ${imageFiles.length} screenshots from DraftKings containing golf round score over/under lines for the ${tournamentArg} (${roundArg}).

TASK:
1. Extract ALL player round score over/under lines visible in these screenshots
2. From all the lines, select the TOP 10 best bets ranked by confidence (highest confidence first)
3. For each pick, include a DETAILED analysis paragraph

For your analysis of each pick, include:
- Course analysis (how the course layout, conditions, length, and setup favor/disfavor this player's game)
- Current form (recent tournament results, scoring trends, momentum)
- Play style fit (driving accuracy/distance, iron play, short game, putting — how it matches course demands)
- Historical performance at this course or similar tracks
- Any relevant factors: weather, tee times, course position after prior rounds, injury/fatigue

Return a JSON array with exactly 10 picks, ranked by confidence (highest first):
[
  {
    "player_name": "<full name exactly as shown>",
    "line": <the over/under number, e.g. 69.5>,
    "pick_side": "Over" or "Under",
    "odds_american": <American odds integer, e.g. -115>,
    "confidence": <number 70-95>,
    "reasoning": "<4-6 sentence detailed analysis covering course analysis, current form, play style fit, and historical context. Be specific with stats and facts.>"
  }
]

IMPORTANT RULES:
- Return ONLY valid JSON array. No markdown, no explanation outside the JSON.
- Extract the exact odds shown in the screenshots (convert to American if shown as decimal)
- Player names must match exactly as displayed in the screenshots
- Confidence must range from 70-95 (no pick should be below 70 or above 95)
- Each reasoning must be substantial (4-6 sentences minimum)`;

  const oaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...imagePayloads,
        ],
      }],
      temperature: 0.7,
      max_tokens: 4000,
    }),
  });

  const oaiData = await oaiRes.json();
  if (oaiData.error) {
    console.error('❌ OpenAI error:', oaiData.error.message || oaiData.error);
    process.exit(1);
  }

  const content = oaiData.choices?.[0]?.message?.content?.trim();
  if (!content) {
    console.error('❌ Empty OpenAI response');
    process.exit(1);
  }

  // Parse JSON (strip markdown fences if present)
  const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  let picks;
  try {
    picks = JSON.parse(jsonStr);
  } catch (e) {
    console.error('❌ Failed to parse GPT response as JSON:');
    console.error(jsonStr.substring(0, 500));
    process.exit(1);
  }

  if (!Array.isArray(picks) || picks.length === 0) {
    console.error('❌ GPT returned invalid picks format');
    process.exit(1);
  }

  console.log(`\n✅ GPT-4o returned ${picks.length} picks:\n`);
  picks.forEach((p, i) => {
    console.log(`   ${i + 1}. ${p.player_name} — ${p.pick_side} ${p.line} (${p.odds_american > 0 ? '+' : ''}${p.odds_american})  [${p.confidence}%]`);
  });
  console.log('');

  if (dryRun) {
    console.log('🏁 DRY RUN — Not posting to Discord.');
    console.log('\nFull analysis:');
    picks.forEach((p, i) => {
      console.log(`\n--- Pick ${i + 1}: ${p.player_name} ${p.pick_side} ${p.line} ---`);
      console.log(p.reasoning);
    });
    process.exit(0);
  }

  // ── Step 4: Start Discord client and post picks ──
  console.log('🔌 Connecting to Discord...');
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(process.env.DISCORD_TOKEN);

  // Wait for client to be ready
  await new Promise(resolve => {
    if (client.isReady()) return resolve();
    client.once('ready', resolve);
  });
  console.log('✅ Discord connected\n');

  // Get guild ID from the channel
  const channel = await client.channels.fetch(AI_PICKS_CHANNEL_ID);
  if (!channel) {
    console.error('❌ Could not fetch AI Picks channel');
    client.destroy();
    process.exit(1);
  }
  const guildId = channel.guildId;
  const record = await aiPicksDb.getGolfRecord(guildId);

  const totalPicks = picks.length;

  for (let i = 0; i < totalPicks; i++) {
    const p = picks[i];
    const pickStr = `${p.player_name} ${p.pick_side} ${p.line}`;

    // Enrich pick object for card generation
    const pickForCard = {
      player_name: p.player_name,
      line: p.line,
      pick_side: p.pick_side,
      odds_american: p.odds_american,
      confidence: p.confidence,
      reasoning: p.reasoning,
      tournament_name: tournamentArg,
      round_label: roundArg,
    };

    // Save to database
    const aiPick = await aiPicksDb.createAiPick({
      guild_id: guildId,
      channel_id: AI_PICKS_CHANNEL_ID,
      sport: 'golf_pga',
      bet_category: 'total',
      wager_type: 'over_under',
      pick: pickStr,
      player_name: p.player_name,
      prop_description: `${roundArg} Score ${p.pick_side} ${p.line}`,
      odds_american: p.odds_american,
      reasoning: p.reasoning,
      confidence: p.confidence,
      espn_sport: 'golf_pga',
      record_wins: record.wins,
      record_losses: record.losses,
      record_pushes: record.pushes,
      record_units: 0,
      streak: 0,
      pick_type: 'golf_round',
      tournament_name: tournamentArg,
      round_number: parseInt(roundArg.replace(/\D/g, '')) || 1,
    });

    // Generate card image
    const imgBuffer = await generateGolfRoundOUCardImage(pickForCard, record, i + 1, totalPicks);
    const attachment = new AttachmentBuilder(imgBuffer, { name: `golf-round-pick-${i + 1}.png` });

    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`aipick_tail_${aiPick.id}`)
        .setLabel('\u26f3 Tail (0)')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`aipick_fade_${aiPick.id}`)
        .setLabel('Fade (0)')
        .setStyle(ButtonStyle.Danger),
    );

    // Role ping on first pick only
    let msgContent = `\u26f3 **GOLF ROUND TOTALS** — Pick ${i + 1}/${totalPicks}`;
    if (i === 0) {
      const guild = client.guilds.cache.get(guildId);
      if (guild) {
        const role = guild.roles.cache.find(r => r.name === 'AI Picks');
        if (role) msgContent = `${role} ${msgContent}`;
      }
    }

    // Post to AI Picks channel
    const message = await channel.send({
      content: msgContent,
      files: [attachment],
      components: [buttonRow],
    });

    await aiPicksDb.updateAiPickMessage(aiPick.id, message.id);
    console.log(`✅ Posted pick ${i + 1}/${totalPicks}: ${pickStr}`);

    // Cross-post to AI Open Slips
    try {
      const slipsChannel = await client.channels.fetch(GOLF_CHANNEL_ID);
      if (slipsChannel) {
        const mirrorImg = new AttachmentBuilder(imgBuffer, { name: `golf-round-pick-${i + 1}.png` });
        const mirrorRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`aipick_tail_${aiPick.id}`)
            .setLabel('\u26f3 Tail (0)')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`aipick_fade_${aiPick.id}`)
            .setLabel('Fade (0)')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setLabel('Comment')
            .setStyle(ButtonStyle.Link)
            .setURL(`https://discord.com/channels/${guildId}/${AI_PICKS_CHANNEL_ID}/${message.id}`),
        );
        const mirrorMsg = await slipsChannel.send({
          content: `\u26f3 **GOLF ROUND TOTALS** — Pick ${i + 1}/${totalPicks}`,
          files: [mirrorImg],
          components: [mirrorRow],
        });
        await aiPicksDb.updateAiPickMirrorMessage(aiPick.id, mirrorMsg.id, GOLF_CHANNEL_ID);
        console.log(`   ↳ Cross-posted to AI Open Slips`);
      }
    } catch (e) {
      console.error(`   ⚠ Cross-post failed: ${e.message}`);
    }

    // Small delay between posts to avoid rate limiting
    if (i < totalPicks - 1) await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`\n🏁 Done! Posted ${totalPicks} golf round total picks.`);
  client.destroy();
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
