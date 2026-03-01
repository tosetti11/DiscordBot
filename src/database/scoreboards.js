/**
 * Database queries for live scoreboards
 */
const { supabase } = require('../config/supabase');

/**
 * Create a new live scoreboard entry
 */
async function createScoreboard({ guildId, channelId, messageId, discordId, sport, espnGameId, homeTeam, awayTeam, betIds }) {
  const { data, error } = await supabase
    .from('live_scoreboards')
    .insert({
      guild_id: guildId,
      channel_id: channelId,
      message_id: messageId,
      discord_id: discordId,
      sport,
      espn_game_id: espnGameId,
      home_team: homeTeam,
      away_team: awayTeam,
      bet_ids: betIds || [],
      status: 'active',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get all active scoreboards
 */
async function getActiveScoreboards() {
  const { data, error } = await supabase
    .from('live_scoreboards')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Get active scoreboards for a guild
 */
async function getActiveScoreboardsForGuild(guildId) {
  const { data, error } = await supabase
    .from('live_scoreboards')
    .select('*')
    .eq('guild_id', guildId)
    .eq('status', 'active')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Update a scoreboard's message ID
 */
async function updateScoreboardMessageId(id, messageId) {
  const { error } = await supabase
    .from('live_scoreboards')
    .update({ message_id: messageId, last_updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
}

/**
 * Update scoreboard timestamp
 */
async function touchScoreboard(id) {
  const { error } = await supabase
    .from('live_scoreboards')
    .update({ last_updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
}

/**
 * End a scoreboard
 */
async function endScoreboard(id) {
  const { error } = await supabase
    .from('live_scoreboards')
    .update({
      status: 'ended',
      ended_at: new Date().toISOString(),
      last_updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw error;
}

/**
 * End all active scoreboards for a specific ESPN game
 */
async function endScoreboardsByGame(espnGameId) {
  const { error } = await supabase
    .from('live_scoreboards')
    .update({
      status: 'ended',
      ended_at: new Date().toISOString(),
    })
    .eq('espn_game_id', espnGameId)
    .eq('status', 'active');

  if (error) throw error;
}

/**
 * Get scoreboard by ID
 */
async function getScoreboard(id) {
  const { data, error } = await supabase
    .from('live_scoreboards')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Clean up stale scoreboards (active > 6 hours)
 */
async function cleanupStaleScoreboards() {
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from('live_scoreboards')
    .update({
      status: 'ended',
      ended_at: new Date().toISOString(),
    })
    .eq('status', 'active')
    .lt('created_at', sixHoursAgo);

  if (error) console.error('[Scoreboard] Cleanup error:', error.message);
}

/**
 * Get active scoreboard for a specific bet
 */
async function getScoreboardByBet(betId) {
  const { data, error } = await supabase
    .from('live_scoreboards')
    .select('*')
    .eq('status', 'active')
    .contains('bet_ids', [betId])
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * End all active scoreboards that include a specific bet
 */
async function endScoreboardsByBet(betId) {
  // First find them
  const { data: scoreboards, error: findErr } = await supabase
    .from('live_scoreboards')
    .select('id')
    .eq('status', 'active')
    .contains('bet_ids', [betId]);

  if (findErr) throw findErr;
  if (!scoreboards?.length) return;

  for (const sb of scoreboards) {
    await endScoreboard(sb.id);
  }
}

module.exports = {
  createScoreboard,
  getActiveScoreboards,
  getActiveScoreboardsForGuild,
  updateScoreboardMessageId,
  touchScoreboard,
  endScoreboard,
  endScoreboardsByGame,
  endScoreboardsByBet,
  getScoreboard,
  getScoreboardByBet,
  cleanupStaleScoreboards,
};
