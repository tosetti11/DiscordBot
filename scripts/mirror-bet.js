/**
 * One-time script to mirror an existing bet to the open bets channel.
 * Usage: node scripts/mirror-bet.js GAM-047
 */
require('dotenv').config();
const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const { supabase } = require('../src/config/supabase');
const { generateBetCardImage } = require('../src/utils/betCardImage');

const KING_DISCORD_ID = '1246525685749649441';
const KING_OPEN_CHANNEL = '1477318450618695692';
const COMMUNITY_OPEN_CHANNEL = '1477318238273802480';

const slipNumber = process.argv[2];
if (!slipNumber) {
  console.error('Usage: node scripts/mirror-bet.js <SLIP_NUMBER>');
  process.exit(1);
}

(async () => {
  try {
    // Fetch bet from Supabase
    const { data: bet, error } = await supabase
      .from('bets')
      .select('*, parlay_legs(*)')
      .eq('slip_number', slipNumber.toUpperCase())
      .single();

    if (error || !bet) {
      console.error('Bet not found:', error?.message || 'No data');
      process.exit(1);
    }

    if (bet.status !== 'open') {
      console.error(`Bet ${slipNumber} is already closed (${bet.status}). Skipping.`);
      process.exit(1);
    }

    if (bet.mirror_message_id) {
      console.error(`Bet ${slipNumber} already has a mirror message. Skipping.`);
      process.exit(1);
    }

    console.log(`Found bet: ${bet.slip_number} by ${bet.discord_id} (${bet.bet_type})`);

    // Start Discord client
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    await client.login(process.env.DISCORD_TOKEN);
    console.log('Discord client logged in');

    // Resolve display name
    let displayName = 'Unknown';
    try {
      const guild = client.guilds.cache.first() || await client.guilds.fetch(bet.guild_id);
      const member = guild.members.cache.get(bet.discord_id) || await guild.members.fetch(bet.discord_id);
      displayName = member.displayName;
    } catch (e) {
      console.warn('Could not resolve display name:', e.message);
    }

    // Generate image
    const imgBuffer = await generateBetCardImage(bet, displayName, null);
    const attachment = new AttachmentBuilder(imgBuffer, { name: 'bet-card.png' });

    // Determine channel
    const mirrorChannelId = bet.discord_id === KING_DISCORD_ID ? KING_OPEN_CHANNEL : COMMUNITY_OPEN_CHANNEL;
    const mirrorChannel = await client.channels.fetch(mirrorChannelId);

    // Send
    const mirrorMsg = await mirrorChannel.send({ files: [attachment] });
    console.log(`Mirror message sent: ${mirrorMsg.id} to channel ${mirrorChannelId}`);

    // Update DB
    const { error: updateError } = await supabase
      .from('bets')
      .update({ mirror_message_id: mirrorMsg.id, mirror_channel_id: mirrorChannelId })
      .eq('id', bet.id);

    if (updateError) {
      console.error('Failed to update DB:', updateError.message);
    } else {
      console.log('Database updated with mirror_message_id');
    }

    client.destroy();
    console.log('Done!');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
