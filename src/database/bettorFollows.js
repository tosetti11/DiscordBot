const { supabase } = require('../config/supabase');

/**
 * Follow a bettor (toggle — if already following, unfollows)
 * Returns { followed: true/false } indicating the new state
 */
async function toggleFollow(followerDiscordId, bettorDiscordId, guildId) {
  // Check if already following
  const { data: existing, error: fetchErr } = await supabase
    .from('bettor_follows')
    .select('id')
    .eq('follower_discord_id', followerDiscordId)
    .eq('bettor_discord_id', bettorDiscordId)
    .eq('guild_id', guildId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;

  if (existing) {
    // Already following — unfollow
    const { error } = await supabase
      .from('bettor_follows')
      .delete()
      .eq('id', existing.id);
    if (error) throw error;
    return { followed: false };
  } else {
    // Not following — follow
    const { error } = await supabase
      .from('bettor_follows')
      .insert({ follower_discord_id: followerDiscordId, bettor_discord_id: bettorDiscordId, guild_id: guildId });
    if (error) throw error;
    return { followed: true };
  }
}

/**
 * Get all followers of a bettor in a guild
 * Returns array of { follower_discord_id }
 */
async function getFollowers(bettorDiscordId, guildId) {
  const { data, error } = await supabase
    .from('bettor_follows')
    .select('follower_discord_id')
    .eq('bettor_discord_id', bettorDiscordId)
    .eq('guild_id', guildId);
  if (error) throw error;
  return data || [];
}

/**
 * Get all bettors a user follows in a guild
 * Returns array of { bettor_discord_id }
 */
async function getFollowing(followerDiscordId, guildId) {
  const { data, error } = await supabase
    .from('bettor_follows')
    .select('bettor_discord_id')
    .eq('follower_discord_id', followerDiscordId)
    .eq('guild_id', guildId);
  if (error) throw error;
  return data || [];
}

/**
 * Check if a user follows a specific bettor
 */
async function isFollowing(followerDiscordId, bettorDiscordId, guildId) {
  const { data, error } = await supabase
    .from('bettor_follows')
    .select('id')
    .eq('follower_discord_id', followerDiscordId)
    .eq('bettor_discord_id', bettorDiscordId)
    .eq('guild_id', guildId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

module.exports = {
  toggleFollow,
  getFollowers,
  getFollowing,
  isFollowing,
};
