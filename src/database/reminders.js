const { supabase } = require('../config/supabase');

/**
 * Create a new reminder
 */
async function createReminder({ guildId, channelId, creatorId, type, message, scheduledAt, repeat }) {
  const { data, error } = await supabase
    .from('reminders')
    .insert({
      guild_id: guildId,
      channel_id: channelId,
      creator_discord_id: creatorId,
      type,
      message,
      scheduled_at: scheduledAt,
      repeat: repeat || 'none',
      is_active: true,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get all due reminders (scheduled_at <= now, still active)
 */
async function getDueReminders() {
  const { data, error } = await supabase
    .from('reminders')
    .select('*')
    .eq('is_active', true)
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Mark a reminder as fired — reschedule or deactivate based on repeat
 */
async function markReminderFired(reminder) {
  if (reminder.repeat === 'none') {
    // One-time: deactivate
    const { error } = await supabase
      .from('reminders')
      .update({ is_active: false, last_fired_at: new Date().toISOString() })
      .eq('id', reminder.id);
    if (error) throw error;
  } else {
    // Repeating: advance scheduled_at
    const next = new Date(reminder.scheduled_at);
    if (reminder.repeat === 'daily') next.setDate(next.getDate() + 1);
    else if (reminder.repeat === 'weekly') next.setDate(next.getDate() + 7);

    const { error } = await supabase
      .from('reminders')
      .update({ scheduled_at: next.toISOString(), last_fired_at: new Date().toISOString() })
      .eq('id', reminder.id);
    if (error) throw error;
  }
}

/**
 * Get upcoming reminders for a guild (for listing)
 */
async function getActiveReminders(guildId, limit = 10) {
  const { data, error } = await supabase
    .from('reminders')
    .select('*')
    .eq('guild_id', guildId)
    .eq('is_active', true)
    .order('scheduled_at', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

/**
 * Delete (cancel) a reminder by ID
 */
async function deleteReminder(id, guildId) {
  const { data, error } = await supabase
    .from('reminders')
    .delete()
    .eq('id', id)
    .eq('guild_id', guildId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

module.exports = {
  createReminder,
  getDueReminders,
  markReminderFired,
  getActiveReminders,
  deleteReminder,
};
