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
  // Find the highest slip number for this user and increment
  const { data, error } = await supabase
    .from('bets')
    .select('slip_number')
    .eq('discord_id', discordId);
  if (error) throw error;
  let maxNum = 0;
  if (data && data.length) {
    for (const bet of data) {
      const match = bet.slip_number && bet.slip_number.startsWith(prefix + '-') && bet.slip_number.match(/-(\d{3})$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
  }
  const nextNum = maxNum + 1;
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
  let attempt = 0;
  let slipNumber;
  let lastError;
  while (attempt < 5) {
    slipNumber = await generateSlipNumber(betData.discord_id, username);
    const { data, error } = await supabase
      .from('bets')
      .insert({ ...betData, slip_number: slipNumber })
      .select()
      .single();
    if (!error) return data;
    if (error.message && error.message.includes('duplicate key value')) {
      attempt++;
      continue;
    }
    lastError = error;
    break;
  }
  throw lastError || new Error('Failed to generate unique slip number after 5 attempts');
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
 * Update arbitrary fields on a parlay leg
 */
async function updateParlayLegFields(legId, fields) {
  const { data, error } = await supabase
    .from('parlay_legs')
    .update(fields)
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
 * Update bet mirror_message_id (after posting to open bets channel)
 */
async function updateBetMirrorMessageId(betId, mirrorMessageId, mirrorChannelId) {
  const { error } = await supabase
    .from('bets')
    .update({ mirror_message_id: mirrorMessageId, mirror_channel_id: mirrorChannelId })
    .eq('id', betId);

  if (error) throw error;
}

/**
 * Update bet scoreboard placeholder message ID
 */
async function updateBetScoreboardMsgId(betId, scoreboardMsgId) {
  const { error } = await supabase
    .from('bets')
    .update({ mirror_scoreboard_msg_id: scoreboardMsgId })
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
 * Get whale-only stats for a user (computed from bets table)
 */
async function getWhaleStats(discordId) {
  const { data, error } = await supabase
    .from('bets')
    .select('status, units, odds_american')
    .eq('discord_id', discordId)
    .eq('is_whale', true)
    .neq('status', 'void');

  if (error) throw error;
  if (!data || data.length === 0) return null;

  const closed = data.filter(b => ['win', 'loss', 'push'].includes(b.status));
  const wins = closed.filter(b => b.status === 'win').length;
  const losses = closed.filter(b => b.status === 'loss').length;
  const pushes = closed.filter(b => b.status === 'push').length;
  const open = data.filter(b => b.status === 'open').length;

  let netUnits = 0;
  for (const b of closed) {
    if (b.status === 'win') {
      netUnits += b.odds_american >= 0
        ? b.units * (b.odds_american / 100)
        : b.units * (100 / Math.abs(b.odds_american));
    } else if (b.status === 'loss') {
      netUnits -= b.units;
    }
  }

  const winPct = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0;

  return {
    total_bets: data.length,
    open_bets: open,
    wins,
    losses,
    pushes,
    win_pct: winPct,
    net_units: Math.round(netUnits * 100) / 100,
  };
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
async function getAllBetsInGuild(guildId, { status, statusIn, discordId, sport, team, minUnits, maxUnits, limit = 25 } = {}) {
  let query = supabase
    .from('bets')
    .select('*, parlay_legs(*)')
    .eq('guild_id', guildId);

  if (statusIn && Array.isArray(statusIn)) {
    query = query.in('status', statusIn);
  } else if (status && status !== 'all') {
    query = query.eq('status', status);
  }
  if (discordId) {
    query = query.eq('discord_id', discordId);
  }
  if (sport) {
    query = query.eq('sport', sport);
  }
  if (team) {
    // Sanitize search input — strip PostgREST special chars to prevent filter injection
    const safeTeam = team.replace(/[%,\.()]/g, '');
    if (safeTeam.length > 0) {
      query = query.or(`team_a.ilike.%${safeTeam}%,team_b.ilike.%${safeTeam}%,player_name.ilike.%${safeTeam}%,pick.ilike.%${safeTeam}%,bet_note.ilike.%${safeTeam}%`);
    }
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
 * Reopen a closed bet (set status back to open, clear result)
 */
async function reopenBet(betId) {
  const { data, error } = await supabase
    .from('bets')
    .update({
      status: 'open',
      result_note: null,
      closed_at: null,
    })
    .eq('id', betId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Delete a bet completely (and its parlay legs via CASCADE)
 */
async function deleteBet(betId, discordId, isAdmin = false) {
  // Verify ownership unless admin
  const { data: bet, error: fetchErr } = await supabase
    .from('bets')
    .select('id, discord_id, message_id, channel_id, mirror_message_id, mirror_channel_id')
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
  updateParlayLegFields,
  updateBetMessageId,
  updateBetMirrorMessageId,
  updateBetScoreboardMsgId,
  getUserStats,
  getWhaleStats,
  getLeaderboard,
  getBetBySlip,
  getAllBetsInGuild,
  deleteBet,
  reopenBet,
  updateBetFields,
};
