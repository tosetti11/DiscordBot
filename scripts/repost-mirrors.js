/**
 * One-time script to delete existing mirror messages and repost them
 * with tail/fade + Comment buttons.
 * Usage: node scripts/repost-mirrors.js
 */
require('dotenv').config();
const { Client, GatewayIntentBits, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { supabase } = require('../src/config/supabase');
const { generateBetCardImage } = require('../src/utils/betCardImage');

const KING_DISCORD_ID = '1246525685749649441';
const KING_OPEN_CHANNEL = '1477318450618695692';
const COMMUNITY_OPEN_CHANNEL = '1477318238273802480';

(async () => {
  try {
    // Fetch all open bets that have mirror messages
    const { data: bets, error } = await supabase
      .from('bets')
      .select('*, parlay_legs(*)')
      .eq('status', 'open')
      .not('mirror_message_id', 'is', null)
      .not('mirror_channel_id', 'is', null);

    if (error) {
      console.error('DB query error:', error.message);
      process.exit(1);
    }

    if (!bets || bets.length === 0) {
      console.log('No open bets with mirror messages found.');
      process.exit(0);
    }

    console.log(`Found ${bets.length} open bet(s) with mirrors to repost.`);

    // Start Discord client
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    await client.login(process.env.DISCORD_TOKEN);
    console.log('Discord client logged in');

    for (const bet of bets) {
      try {
        console.log(`\nProcessing ${bet.slip_number} (${bet.bet_type})...`);

        // 1. Delete old mirror message
        try {
          const oldChannel = await client.channels.fetch(bet.mirror_channel_id);
          const oldMsg = await oldChannel.messages.fetch(bet.mirror_message_id);
          await oldMsg.delete();
          console.log(`  Deleted old mirror message ${bet.mirror_message_id}`);
        } catch (e) {
          console.warn(`  Could not delete old mirror: ${e.message}`);
        }

        // 2. Resolve display name + avatar
        let displayName = 'Unknown';
        let avatarUrl = null;
        try {
          const guild = client.guilds.cache.first() || await client.guilds.fetch(bet.guild_id);
          const member = guild.members.cache.get(bet.discord_id) || await guild.members.fetch(bet.discord_id);
          displayName = member.displayName;
          avatarUrl = member.user.displayAvatarURL({ size: 128, extension: 'png', forceStatic: true });
        } catch (e) {
          console.warn(`  Could not resolve display name: ${e.message}`);
        }

        // 3. Generate image
        const imgBuffer = await generateBetCardImage(bet, displayName, avatarUrl);
        const attachment = new AttachmentBuilder(imgBuffer, { name: 'bet-card.png' });

        // 4. Determine mirror channel
        const mirrorChannelId = bet.discord_id === KING_DISCORD_ID ? KING_OPEN_CHANNEL : COMMUNITY_OPEN_CHANNEL;
        const mirrorChannel = await client.channels.fetch(mirrorChannelId);

        // 5. Build buttons: Tail, Fade, Comment
        const commentUrl = `https://discord.com/channels/${bet.guild_id}/${bet.channel_id}/${bet.message_id}`;
        const pollRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`tailbet_yes_${bet.id}`).setLabel('Tail').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`tailbet_no_${bet.id}`).setLabel('Fade').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setLabel('Comment').setStyle(ButtonStyle.Link).setURL(commentUrl),
        );

        // 6. Build content
        let content = 'Are You Tailing This Bet?';
        if (bet.share_link) {
          content += `\n\n🔗 **Copy this bet:** <${bet.share_link}>`;
        }

        // 7. Send new mirror
        const mirrorMsg = await mirrorChannel.send({
          files: [attachment],
          components: [pollRow],
          content,
        });
        console.log(`  New mirror message sent: ${mirrorMsg.id}`);

        // 8. Update DB with new mirror message ID
        const { error: updateError } = await supabase
          .from('bets')
          .update({ mirror_message_id: mirrorMsg.id, mirror_channel_id: mirrorChannelId })
          .eq('id', bet.id);

        if (updateError) {
          console.error(`  DB update failed: ${updateError.message}`);
        } else {
          console.log(`  DB updated.`);
        }
      } catch (e) {
        console.error(`  Error processing ${bet.slip_number}: ${e.message}`);
      }
    }

    client.destroy();
    console.log('\nDone!');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
