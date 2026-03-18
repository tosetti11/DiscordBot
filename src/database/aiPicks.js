/**
 * AI Picks Database Module
 * Manages the ai_picks and ai_pick_tails tables.
 */
const { supabase } = require('../config/supabase');

async function createAiPick(pickData) {
  const { data, error } = await supabase
    .from('ai_picks')
    .insert(pickData)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getAiPick(pickId) {
  const { data, error } = await supabase
    .from('ai_picks')
    .select('*')
    .eq('id', pickId)
    .single();
  if (error) throw error;
  return data;
}

async function getPendingAiPicks() {
  const { data, error } = await supabase
    .from('ai_picks')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function closeAiPick(pickId, status, resultNote, finalScore) {
  const { data, error } = await supabase
    .from('ai_picks')
    .update({
      status,
      result_note: resultNote || null,
      final_score: finalScore || null,
      closed_at: new Date().toISOString(),
    })
    .eq('id', pickId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateAiPickMessage(pickId, messageId) {
  const { error } = await supabase
    .from('ai_picks')
    .update({ message_id: messageId })
    .eq('id', pickId);
  if (error) throw error;
}

async function updateAiPickTailCount(pickId, tailCount, fadeCount) {
  const { error } = await supabase
    .from('ai_picks')
    .update({ tail_count: tailCount, fade_count: fadeCount })
    .eq('id', pickId);
  if (error) throw error;
}

async function getAiPickRecord(guildId) {
  const { data, error } = await supabase
    .from('ai_picks')
    .select('status')
    .eq('guild_id', guildId)
    .in('status', ['win', 'loss', 'push']);
  if (error) throw error;
  const record = { wins: 0, losses: 0, pushes: 0 };
  for (const p of (data || [])) {
    if (p.status === 'win') record.wins++;
    else if (p.status === 'loss') record.losses++;
    else if (p.status === 'push') record.pushes++;
  }
  return record;
}

async function getAiPickFullRecord(guildId) {
  const { data, error } = await supabase
    .from('ai_picks')
    .select('*')
    .eq('guild_id', guildId)
    .in('status', ['win', 'loss', 'push'])
    .order('pick_date', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getAiPickStreak(guildId) {
  const { data, error } = await supabase
    .from('ai_picks')
    .select('status')
    .eq('guild_id', guildId)
    .in('status', ['win', 'loss'])
    .order('pick_date', { ascending: false })
    .limit(50);
  if (error) throw error;
  if (!data || data.length === 0) return 0;
  const first = data[0].status;
  let streak = 0;
  for (const p of data) {
    if (p.status === first) streak++;
    else break;
  }
  return first === 'win' ? streak : -streak;
}

async function getAiPicksByMonth(guildId, year, month) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const end = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;
  
  const { data, error } = await supabase
    .from('ai_picks')
    .select('*')
    .eq('guild_id', guildId)
    .gte('pick_date', start)
    .lt('pick_date', end)
    .order('pick_date', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getAllAiPicks(guildId) {
  const { data, error } = await supabase
    .from('ai_picks')
    .select('*')
    .eq('guild_id', guildId)
    .order('pick_date', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getTodaysAiPick(guildId) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const { data, error } = await supabase
    .from('ai_picks')
    .select('*')
    .eq('guild_id', guildId)
    .eq('pick_date', today)
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

// Tail/Fade per-user tracking
async function getUserTailFade(pickId, discordId) {
  const { data, error } = await supabase
    .from('ai_pick_tails')
    .select('*')
    .eq('pick_id', pickId)
    .eq('discord_id', discordId)
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function recordTailFade(pickId, discordId, action, units = 1) {
  const { data, error } = await supabase
    .from('ai_pick_tails')
    .upsert({ pick_id: pickId, discord_id: discordId, action, units }, { onConflict: 'pick_id,discord_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function removeTailFade(pickId, discordId) {
  const { error } = await supabase
    .from('ai_pick_tails')
    .delete()
    .eq('pick_id', pickId)
    .eq('discord_id', discordId);
  if (error) throw error;
}

async function getTailFadeCounts(pickId) {
  const { data, error } = await supabase
    .from('ai_pick_tails')
    .select('action, units')
    .eq('pick_id', pickId);
  if (error) throw error;
  let tails = 0, fades = 0, totalUnits = 0;
  for (const r of (data || [])) {
    if (r.action === 'tail') { tails++; totalUnits += Number(r.units) || 0; }
    else fades++;
  }
  return { tails, fades, totalUnits };
}

async function getTailLeaderboard(guildId) {
  // Get all picks for this guild that are closed
  const { data: picks, error: pickErr } = await supabase
    .from('ai_picks')
    .select('id, status')
    .eq('guild_id', guildId)
    .in('status', ['win', 'loss', 'push']);
  if (pickErr) throw pickErr;
  if (!picks || picks.length === 0) return [];

  const pickMap = {};
  for (const p of picks) pickMap[p.id] = p.status;
  const pickIds = picks.map(p => p.id);

  // Get all tail/fade actions for these picks
  const { data: actions, error: actErr } = await supabase
    .from('ai_pick_tails')
    .select('discord_id, pick_id, action')
    .in('pick_id', pickIds);
  if (actErr) throw actErr;

  // Calculate per-user stats
  const userStats = {};
  for (const a of (actions || [])) {
    if (!userStats[a.discord_id]) {
      userStats[a.discord_id] = { discordId: a.discord_id, correct: 0, wrong: 0, total: 0 };
    }
    const result = pickMap[a.pick_id];
    if (result === 'push') continue;
    userStats[a.discord_id].total++;
    const userPickedRight = (a.action === 'tail' && result === 'win') || (a.action === 'fade' && result === 'loss');
    if (userPickedRight) userStats[a.discord_id].correct++;
    else userStats[a.discord_id].wrong++;
  }

  return Object.values(userStats)
    .filter(u => u.total >= 3)
    .sort((a, b) => (b.correct / b.total) - (a.correct / a.total) || b.total - a.total);
}

async function getMonthlyRecap(guildId, year, month) {
  const picks = await getAiPicksByMonth(guildId, year, month);
  const record = { wins: 0, losses: 0, pushes: 0, units: 0 };
  let bestPick = null, worstPick = null;
  const sportBreakdown = {};
  let streak = 0, maxStreak = 0, currentStreakType = null;

  for (const p of picks.slice().reverse()) {
    if (p.status === 'win') {
      record.wins++;
      const payout = p.odds_american > 0 ? p.odds_american / 100 : 100 / Math.abs(p.odds_american);
      record.units += payout;
      if (!bestPick || payout > (bestPick._payout || 0)) { bestPick = p; bestPick._payout = payout; }
    } else if (p.status === 'loss') {
      record.losses++;
      record.units -= 1;
      if (!worstPick) worstPick = p;
    } else if (p.status === 'push') {
      record.pushes++;
    }

    // Sport breakdown
    sportBreakdown[p.sport] = sportBreakdown[p.sport] || { wins: 0, losses: 0 };
    if (p.status === 'win') sportBreakdown[p.sport].wins++;
    if (p.status === 'loss') sportBreakdown[p.sport].losses++;

    // Streak tracking
    if (p.status === 'win' || p.status === 'loss') {
      if (p.status === currentStreakType) streak++;
      else { streak = 1; currentStreakType = p.status; }
      if (currentStreakType === 'win' && streak > maxStreak) maxStreak = streak;
    }
  }

  return { record, bestPick, worstPick, sportBreakdown, maxStreak, picks };
}

module.exports = {
  createAiPick,
  getAiPick,
  getPendingAiPicks,
  closeAiPick,
  updateAiPickMessage,
  updateAiPickTailCount,
  getAiPickRecord,
  getAiPickFullRecord,
  getAiPickStreak,
  getAiPicksByMonth,
  getAllAiPicks,
  getTodaysAiPick,
  getUserTailFade,
  recordTailFade,
  removeTailFade,
  getTailFadeCounts,
  getTailLeaderboard,
  getMonthlyRecap,
};
