const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { COLORS } = require('../../config/constants');

const ADMIN_ROLES = ['admin', 'the king'];

const command = new SlashCommandBuilder()
  .setName('announce')
  .setDescription('Send a DM announcement to a user or all server members (Admin only)')
  .addStringOption(opt =>
    opt.setName('message')
      .setDescription('The message to send')
      .setRequired(true)
  )
  .addUserOption(opt =>
    opt.setName('user')
      .setDescription('Send to a specific user (leave empty for all members)')
      .setRequired(false)
  )
  .addStringOption(opt =>
    opt.setName('link')
      .setDescription('Optional link to include in the message')
      .setRequired(false)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

async function execute(interaction) {
  // Admin role check
  const member = interaction.member;
  const roleNames = member.roles.cache.map(r => r.name.toLowerCase());
  const isAdmin = member.permissions.has('Administrator') || ADMIN_ROLES.some(r => roleNames.includes(r));
  if (!isAdmin) {
    return interaction.reply({ content: '❌ Only admins can use this command.', flags: 64 });
  }

  const message = interaction.options.getString('message');
  const targetUser = interaction.options.getUser('user');
  const link = interaction.options.getString('link');

  // Build embed
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('👑 TheGamblingKing')
    .setDescription(message)
    .setThumbnail('https://thegamblingkingapp.com/TheGamblingKing.jpg')
    .setTimestamp()
    .setFooter({ text: 'TheGamblingKing • thegamblingkingapp.com' });

  if (link) {
    embed.addFields({ name: '🔗 Link', value: link });
  }

  if (targetUser) {
    // Send to single user
    try {
      const dm = await targetUser.createDM();
      await dm.send({ embeds: [embed] });
      return interaction.reply({ content: `✅ DM sent to **${targetUser.username}**`, flags: 64 });
    } catch (err) {
      return interaction.reply({ content: `❌ Could not DM **${targetUser.username}** — they may have DMs disabled.`, flags: 64 });
    }
  } else {
    // Send to all members
    await interaction.reply({ content: '📤 Sending DMs to all server members...', flags: 64 });

    const guild = interaction.guild;
    const members = await guild.members.fetch();
    const nonBots = members.filter(m => !m.user.bot);

    let sent = 0;
    let failed = 0;

    for (const [, member] of nonBots) {
      try {
        const dm = await member.createDM();
        await dm.send({ embeds: [embed] });
        sent++;
      } catch (err) {
        failed++;
      }
      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 500));
    }

    await interaction.followUp({
      content: `✅ Done! Sent: **${sent}** | Failed (DMs disabled): **${failed}**`,
      flags: 64,
    });
  }
}

module.exports = { command, execute };
