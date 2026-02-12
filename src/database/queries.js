/**
 * Update bet fields (admin edit)
 */
async function updateBetFields(betId, fields) {
  const { data, error } = await supabase
    .from('bets')
    .update(fields)
    .eq('id', betId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
const { supabase } = require('../config/supabase');

/**
 * Generate a slip number like RIC-001 from username
 * First 3 chars of username (uppercased) + ascending number
 */
async function generateSlipNumber(discordId, username) {
  const prefix = username.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase() || 'BET';

  // Count existing bets for this user to determine next number
  const { count, error } = await supabase
    .from('bets')
    .select('*', { count: 'exact', head: true })
    .eq('discord_id', discordId);

  if (error) throw error;

  const nextNum = (count || 0) + 1;
  const padded = String(nextNum).padStart(3, '0');
  return `${prefix}-${padded}`;
}

/**
 * Get or create a user record from Discord info
 */
async function getOrCreateUser(discordUser) {
  // Try to find existing user
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('discord_id', discordUser.id)
    .single();

  if (existing) {
    // Update username/avatar if changed
    if (existing.discord_username !== discordUser.username) {
      await supabase
        .from('users')
        .update({
          discord_username: discordUser.username,
          discord_avatar: discordUser.displayAvatarURL(),
        })
        .eq('id', existing.id);
    }
    return existing;
  }

  // Create new user
  const { data: newUser, error } = await supabase
    .from('users')
    .insert({
      discord_id: discordUser.id,
      discord_username: discordUser.username,
      discord_avatar: discordUser.displayAvatarURL(),
    })
    .select()
    .single();

  if (error) throw error;
  return newUser;
}

/**
 * Create a new bet (auto-generates slip number)
 */
async function createBet(betData, username) {
  const slipNumber = await generateSlipNumber(betData.discord_id, username);

  const { data, error } = await supabase
    .from('bets')
    .insert({ ...betData, slip_number: slipNumber })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Create parlay legs
 */
async function createParlayLegs(legs) {
  const { data, error } = await supabase
    .from('parlay_legs')
    .insert(legs)
    .select();

  if (error) throw error;
  return data;
}

/**
 * Get a bet by ID
 */
async function getBet(betId) {
  const { data, error } = await supabase
    .from('bets')
    .select('*, parlay_legs(*)')
    .eq('id', betId)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get open bets for a user in a guild
 */
async function getOpenBets(discordId, guildId) {
  const { data, error } = await supabase
    .from('bets')
    .select('*, parlay_legs(*)')
    .eq('discord_id', discordId)
    .eq('guild_id', guildId)
    .eq('status', 'open')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Get recent bets for a user
 */
async function getUserBets(discordId, guildId, limit = 10) {
  const { data, error } = await supabase
    .from('bets')
    .select('*, parlay_legs(*)')
    .eq('discord_id', discordId)
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

/**
 * Close a bet (set status to win/loss/push)
 */
async function closeBet(betId, status, resultNote = null) {
  const { data, error } = await supabase
    .from('bets')
    .update({
      status,
      result_note: resultNote,
      closed_at: new Date().toISOString(),
    })
    .eq('id', betId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Update a parlay leg's status
 */
async function updateParlayLegStatus(legId, status) {
  const { data, error } = await supabase
    .from('parlay_legs')
    .update({ status })
    .eq('id', legId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Update bet message_id (after posting embed)
 */
async function updateBetMessageId(betId, messageId) {
  const { error } = await supabase
    .from('bets')
    .update({ message_id: messageId })
    .eq('id', betId);

  if (error) throw error;
}

/**
 * Get user stats from the view
 */
async function getUserStats(discordId) {
  const { data, error } = await supabase
    .from('user_stats')
    .select('*')
    .eq('discord_id', discordId)
    .single();

  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
  return data;
}

/**
 * Get leaderboard (top users by net units)
 */
async function getLeaderboard(guildId, limit = 10) {
  // Get all users who have bets in this guild
  const { data: guildUsers, error: guErr } = await supabase
    .from('bets')
    .select('discord_id')
    .eq('guild_id', guildId)
    .neq('status', 'void');

  if (guErr) throw guErr;

  const uniqueDiscordIds = [...new Set(guildUsers.map(b => b.discord_id))];

  if (uniqueDiscordIds.length === 0) return [];

  const { data, error } = await supabase
    .from('user_stats')
    .select('*')
    .in('discord_id', uniqueDiscordIds)
    .order('net_units', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

/**
 * Get a bet by slip number
 */
async function getBetBySlip(slipNumber, guildId) {
  const { data, error } = await supabase
    .from('bets')
    .select('*, parlay_legs(*)')
    .eq('slip_number', slipNumber.toUpperCase())
    .eq('guild_id', guildId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

/**
 * Get all bets in a guild (with optional filters)
 */
async function getAllBetsInGuild(guildId, { status, discordId, sport, team, minUnits, maxUnits, limit = 25 } = {}) {
  let query = supabase
    .from('bets')
    .select('*, parlay_legs(*)')
    .eq('guild_id', guildId);

  if (status && status !== 'all') {
    query = query.eq('status', status);
  }
  if (discordId) {
    query = query.eq('discord_id', discordId);
  }
  if (sport) {
    query = query.eq('sport', sport);
  }
  if (team) {
    // Search team_a or team_b (case-insensitive via ilike)
    query = query.or(`team_a.ilike.%${team}%,team_b.ilike.%${team}%,player_name.ilike.%${team}%`);
  }
  if (minUnits !== undefined && minUnits !== null) {
    query = query.gte('units', minUnits);
  }
  if (maxUnits !== undefined && maxUnits !== null) {
    query = query.lte('units', maxUnits);
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

/**
 * Delete a bet completely (and its parlay legs via CASCADE)
 */
async function deleteBet(betId, discordId, isAdmin = false) {
  // Verify ownership unless admin
  const { data: bet, error: fetchErr } = await supabase
    .from('bets')
    .select('id, discord_id, message_id, channel_id')
    .eq('id', betId)
    .single();

  if (fetchErr) throw fetchErr;
  if (!bet) return null;
  if (!isAdmin && bet.discord_id !== discordId) return { error: 'not_owner' };

  const { error } = await supabase
    .from('bets')
    .delete()
    .eq('id', betId);

  if (error) throw error;
  return bet;
}

module.exports = {
  getOrCreateUser,
  createBet,
  createParlayLegs,
  getBet,
  getOpenBets,
  getUserBets,
  closeBet,
  updateParlayLegStatus,
  updateBetMessageId,
  getUserStats,
  getLeaderboard,
  getBetBySlip,
  getAllBetsInGuild,
  deleteBet,
  updateBetFields,
};
