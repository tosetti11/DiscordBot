/**
 * One-time script: Cross-post today's AI pick to AI Open Slips channel.
 * Usage: node scripts/crosspost-todays-ai-pick.js
 */
require('dotenv').config();
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { supabase } = require('../src/config/supabase');
const { generateAiPickCardImage } = require('../src/utils/aiPickCardImage');
const aiPicksDb = require('../src/database/aiPicks');

const AI_CHANNEL_ID = '1483720217044713674';
const AI_OPEN_SLIPS_CHANNEL_ID = '1485903920906895370';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    // Get today's AI pick
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const { data: picks, error } = await supabase
      .from('ai_picks')
      .select('*')
      .eq('pick_type', 'daily')
      .gte('created_at', `${today}T00:00:00`)
      .lt('created_at', `${today}T23:59:59`)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) throw error;
    if (!picks || picks.length === 0) {
      console.log('No AI pick found for today.');
      process.exit(0);
    }

    const pick = picks[0];
    console.log(`Found pick: ${pick.id} — ${pick.pick}`);

    if (pick.mirror_message_id) {
      console.log('Pick already has a mirror message, skipping.');
      process.exit(0);
    }

    const guildId = process.env.DISCORD_GUILD_ID;

    // Generate card image
    const record = await aiPicksDb.getAiPickRecord(guildId);
    const streak = await aiPicksDb.getAiPickStreak(guildId);
    const imgBuffer = await generateAiPickCardImage(pick, record, streak, 0);
    const attachment = new AttachmentBuilder(imgBuffer, { name: 'ai-pick.png' });

    // Build buttons with Comment link
    const counts = await aiPicksDb.getTailFadeCounts(pick.id);
    const tailLabel = counts.totalUnits > 0
      ? `🔒 Tail (${counts.tails}) ${counts.totalUnits}u`
      : `🔒 Tail (${counts.tails})`;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`aipick_tail_${pick.id}`)
        .setLabel(tailLabel)
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`aipick_fade_${pick.id}`)
        .setLabel(`Fade (${counts.fades})`)
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setLabel('Comment')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/channels/${guildId}/${AI_CHANNEL_ID}/${pick.message_id}`),
    );

    const slipsChannel = await client.channels.fetch(AI_OPEN_SLIPS_CHANNEL_ID);
    const mirrorMsg = await slipsChannel.send({
      content: '🔒 **AI LOCK OF THE DAY** 🔒',
      files: [attachment],
      components: [row],
    });

    await aiPicksDb.updateAiPickMirrorMessage(pick.id, mirrorMsg.id, AI_OPEN_SLIPS_CHANNEL_ID);
    console.log(`✅ Cross-posted pick ${pick.id} to AI Open Slips (mirror: ${mirrorMsg.id})`);
  } catch (err) {
    console.error('Error:', err);
  }
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
