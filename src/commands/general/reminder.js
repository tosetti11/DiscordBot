const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const remindersDb = require('../../database/reminders');
const { COLORS } = require('../../config/constants');

// ─── Reminder types with display info ───
const REMINDER_TYPES = {
  game: { label: '🏟️ Game Reminder', emoji: '🏟️', color: 0x3498DB },
  whale: { label: '🐋 Whale Dick Alert', emoji: '🐋', color: 0xFF00FF },
  lock: { label: '🔒 Lock of the Day', emoji: '🔒', color: 0xFFD700 },
  window: { label: '⏰ Betting Window', emoji: '⏰', color: 0xFF9900 },
  recap: { label: '📊 Daily Recap', emoji: '📊', color: 0x00FF00 },
  promo: { label: '🎉 Promo / Announcement', emoji: '🎉', color: 0xE91E63 },
  custom: { label: '📝 Custom', emoji: '📝', color: 0x5865F2 },
};

const command = new SlashCommandBuilder()
  .setName('reminder')
  .setDescription('Schedule automated messages')
  .addSubcommand(sub =>
    sub
      .setName('create')
      .setDescription('Create a new scheduled reminder')
      .addStringOption(opt =>
        opt.setName('type')
          .setDescription('Type of reminder')
          .setRequired(true)
          .addChoices(
            { name: '🏟️ Game Reminder', value: 'game' },
            { name: '🐋 Whale Dick Alert', value: 'whale' },
            { name: '🔒 Lock of the Day', value: 'lock' },
            { name: '⏰ Betting Window', value: 'window' },
            { name: '📊 Daily Recap', value: 'recap' },
            { name: '🎉 Promo / Announcement', value: 'promo' },
            { name: '📝 Custom', value: 'custom' },
          )
      )
      .addStringOption(opt =>
        opt.setName('message')
          .setDescription('The message to send')
          .setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName('time')
          .setDescription('When to send (e.g. "in 2h", "in 30m", "2026-02-14 15:00", "tomorrow 9pm")')
          .setRequired(true)
      )
      .addChannelOption(opt =>
        opt.setName('channel')
          .setDescription('Channel to post in (defaults to current)')
          .addChannelTypes(ChannelType.GuildText)
      )
      .addStringOption(opt =>
        opt.setName('repeat')
          .setDescription('Repeat schedule')
          .addChoices(
            { name: 'One-time', value: 'none' },
            { name: 'Daily', value: 'daily' },
            { name: 'Weekly', value: 'weekly' },
          )
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('list')
      .setDescription('View all upcoming reminders')
  )
  .addSubcommand(sub =>
    sub
      .setName('cancel')
      .setDescription('Cancel a scheduled reminder')
      .addStringOption(opt =>
        opt.setName('id')
          .setDescription('Reminder ID (from /reminder list)')
          .setRequired(true)
      )
  );

/**
 * Parse flexible time input into a Date object
 * Supports:
 *   "in 30m", "in 2h", "in 1h30m", "in 3d"
 *   "tomorrow 9pm", "tomorrow 14:00"
 *   "2026-02-14 15:00"
 *   "today 8pm", "today 20:00"
 */
function parseTime(input) {
  const raw = input.trim().toLowerCase();

  // Relative: "in 30m", "in 2h", "in 1h30m", "in 3d"
  const relMatch = raw.match(/^in\s+(?:(\d+)\s*d(?:ays?)?)?\s*(?:(\d+)\s*h(?:ours?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?$/i);
  if (relMatch) {
    const days = parseInt(relMatch[1]) || 0;
    const hours = parseInt(relMatch[2]) || 0;
    const minutes = parseInt(relMatch[3]) || 0;
    if (days === 0 && hours === 0 && minutes === 0) return null;
    const ms = ((days * 24 + hours) * 60 + minutes) * 60 * 1000;
    return new Date(Date.now() + ms);
  }

  // "tomorrow 9pm", "today 8pm", "tomorrow 14:00"
  const dayTimeMatch = raw.match(/^(today|tomorrow)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (dayTimeMatch) {
    const d = new Date();
    if (dayTimeMatch[1] === 'tomorrow') d.setDate(d.getDate() + 1);

    let hour = parseInt(dayTimeMatch[2]);
    const min = parseInt(dayTimeMatch[3]) || 0;
    const ampm = dayTimeMatch[4]?.toLowerCase();

    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;

    d.setHours(hour, min, 0, 0);
    return d;
  }

  // Absolute: "2026-02-14 15:00" or "2026-02-14T15:00"
  const absMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})$/);
  if (absMatch) {
    const d = new Date(`${absMatch[1]}-${absMatch[2]}-${absMatch[3]}T${absMatch[4]}:${absMatch[5]}:00`);
    if (!isNaN(d.getTime())) return d;
  }

  // Shorthand relative: "30m", "2h", "1d"
  const shortMatch = raw.match(/^(?:(\d+)\s*d)?\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/);
  if (shortMatch && (shortMatch[1] || shortMatch[2] || shortMatch[3])) {
    const days = parseInt(shortMatch[1]) || 0;
    const hours = parseInt(shortMatch[2]) || 0;
    const minutes = parseInt(shortMatch[3]) || 0;
    const ms = ((days * 24 + hours) * 60 + minutes) * 60 * 1000;
    return new Date(Date.now() + ms);
  }

  return null;
}

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'create') {
    // Only admins can create reminders
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Only admins can create reminders.', ephemeral: true });
    }

    const type = interaction.options.getString('type');
    const message = interaction.options.getString('message');
    const timeInput = interaction.options.getString('time');
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const repeat = interaction.options.getString('repeat') || 'none';

    // Parse time
    const scheduledAt = parseTime(timeInput);
    if (!scheduledAt) {
      return interaction.reply({
        content: '❌ Invalid time format. Examples:\n• `in 2h` — 2 hours from now\n• `in 30m` — 30 minutes from now\n• `in 1h30m` — 1 hour 30 minutes\n• `tomorrow 9pm` — tomorrow at 9 PM\n• `today 20:00` — today at 8 PM\n• `2026-02-14 15:00` — specific date/time',
        ephemeral: true,
      });
    }

    if (scheduledAt.getTime() <= Date.now()) {
      return interaction.reply({ content: '❌ Scheduled time must be in the future.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const reminder = await remindersDb.createReminder({
      guildId: interaction.guildId,
      channelId: channel.id,
      creatorId: interaction.user.id,
      type,
      message,
      scheduledAt: scheduledAt.toISOString(),
      repeat,
    });

    const typeInfo = REMINDER_TYPES[type] || REMINDER_TYPES.custom;
    const repeatLabel = repeat === 'none' ? 'One-time' : repeat === 'daily' ? 'Daily' : 'Weekly';
    const discordTimestamp = `<t:${Math.floor(scheduledAt.getTime() / 1000)}:F>`;
    const relativeTimestamp = `<t:${Math.floor(scheduledAt.getTime() / 1000)}:R>`;

    const embed = new EmbedBuilder()
      .setColor(typeInfo.color)
      .setTitle(`${typeInfo.emoji} Reminder Scheduled`)
      .addFields(
        { name: 'Type', value: typeInfo.label, inline: true },
        { name: 'Channel', value: `<#${channel.id}>`, inline: true },
        { name: 'Repeat', value: repeatLabel, inline: true },
        { name: 'Scheduled For', value: `${discordTimestamp}\n${relativeTimestamp}`, inline: false },
        { name: 'Message', value: message.length > 1024 ? message.slice(0, 1021) + '...' : message, inline: false },
      )
      .setFooter({ text: `ID: ${reminder.id.slice(0, 8)}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

  } else if (sub === 'list') {
    await interaction.deferReply({ ephemeral: true });

    const reminders = await remindersDb.getActiveReminders(interaction.guildId, 15);

    if (reminders.length === 0) {
      return interaction.editReply({ content: '📭 No upcoming reminders scheduled.' });
    }

    const embed = new EmbedBuilder()
      .setColor(COLORS.info)
      .setTitle('⏰ Upcoming Reminders')
      .setTimestamp();

    let description = '';
    for (const r of reminders) {
      const typeInfo = REMINDER_TYPES[r.type] || REMINDER_TYPES.custom;
      const ts = `<t:${Math.floor(new Date(r.scheduled_at).getTime() / 1000)}:R>`;
      const repeatLabel = r.repeat === 'none' ? '' : ` (${r.repeat})`;
      const msgPreview = r.message.length > 60 ? r.message.slice(0, 57) + '...' : r.message;
      description += `${typeInfo.emoji} **${msgPreview}**\n\u2003${ts} in <#${r.channel_id}>${repeatLabel}\n\u2003ID: \`${r.id.slice(0, 8)}\`\n\n`;
    }

    embed.setDescription(description);
    await interaction.editReply({ embeds: [embed] });

  } else if (sub === 'cancel') {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Only admins can cancel reminders.', ephemeral: true });
    }

    const idInput = interaction.options.getString('id').trim();
    await interaction.deferReply({ ephemeral: true });

    // Try to find the reminder by partial ID match
    const reminders = await remindersDb.getActiveReminders(interaction.guildId, 50);
    const match = reminders.find(r => r.id.startsWith(idInput));

    if (!match) {
      return interaction.editReply({ content: `❌ No active reminder found with ID starting with \`${idInput}\`. Use \`/reminder list\` to see IDs.` });
    }

    await remindersDb.deleteReminder(match.id, interaction.guildId);

    const typeInfo = REMINDER_TYPES[match.type] || REMINDER_TYPES.custom;
    await interaction.editReply({
      content: `✅ Cancelled ${typeInfo.emoji} reminder: "${match.message.length > 80 ? match.message.slice(0, 77) + '...' : match.message}"`,
    });
  }
}

/**
 * Fire a reminder — sends the styled message to the channel
 */
async function fireReminder(client, reminder) {
  try {
    // Resolve target channels (multi-channel support)
    const channelIds = reminder.channel_ids && reminder.channel_ids.length
      ? reminder.channel_ids
      : [reminder.channel_id];

    const typeInfo = REMINDER_TYPES[reminder.type] || REMINDER_TYPES.custom;

    const embed = new EmbedBuilder()
      .setColor(typeInfo.color)
      .setTitle(`${typeInfo.emoji} ${typeInfo.label}`)
      .setDescription(reminder.message)
      .setTimestamp()
      .setFooter({ text: 'GK | Scheduled Reminder' });

    // Add clickable links to the embed
    const links = reminder.links || [];
    if (links.length === 1) {
      embed.addFields({ name: '🔗 Link', value: links[0] });
    } else if (links.length > 1) {
      const linkList = links.map((l, i) => `[Link ${i + 1}](${l})`).join(' | ');
      embed.addFields({ name: '🔗 Links', value: linkList });
    }

    // Add flair based on type
    let content = null;
    if (reminder.type === 'whale') {
      content = '🐋🚨 **WHALE DICK ALERT** 🚨🐋';
    } else if (reminder.type === 'lock') {
      content = '🔒🔥 **LOCK OF THE DAY** 🔥🔒';
    } else if (reminder.type === 'game') {
      content = '🏟️ **GAME TIME**';
    } else if (reminder.type === 'window') {
      content = '⏰ **LINES ARE CLOSING SOON**';
    } else if (reminder.type === 'recap') {
      content = '📊 **DAILY RECAP**';
    } else if (reminder.type === 'promo') {
      content = '🎉 **ANNOUNCEMENT**';
    }

    // Send to all target channels
    const channelNameList = [];
    for (const chId of channelIds) {
      try {
        const channel = await client.channels.fetch(chId);
        if (channel) {
          await channel.send({ content, embeds: [embed] });
          channelNameList.push(`#${channel.name}`);
        }
      } catch (chErr) {
        console.error(`[Reminder] Failed to send to channel ${chId}:`, chErr.message);
      }
    }

    // Mark as fired (handles repeat scheduling)
    await remindersDb.markReminderFired(reminder);

    const repeatNote = reminder.repeat !== 'none' ? ` (next: ${reminder.repeat})` : ' (done)';
    console.log(`[Reminder] Fired "${reminder.message.slice(0, 40)}..." in ${channelNameList.join(', ')}${repeatNote}`);
  } catch (err) {
    console.error(`[Reminder] Error firing reminder ${reminder.id}:`, err.message);
  }
}

module.exports = {
  command,
  execute,
  fireReminder,
  REMINDER_TYPES,
};
