/**
 * MLB Daily Analysis Database Module
 * CRUD operations for mlb_daily_analysis and mlb_analysis_messages tables.
 */
const { supabase } = require('../config/supabase');

// ── Analysis Entries ──

async function createAnalysisEntries(entries) {
  const { data, error } = await supabase
    .from('mlb_daily_analysis')
    .upsert(entries, { onConflict: 'analysis_date,market_type,espn_game_id' })
    .select();
  if (error) throw error;
  return data;
}

async function getAnalysisByDate(date, marketType, guildId) {
  const { data, error } = await supabase
    .from('mlb_daily_analysis')
    .select('*')
    .eq('analysis_date', date)
    .eq('market_type', marketType)
    .eq('guild_id', guildId)
    .order('event_start_time', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function getPendingAnalysis(marketType) {
  const { data, error } = await supabase
    .from('mlb_daily_analysis')
    .select('*')
    .eq('market_type', marketType)
    .eq('status', 'pending')
    .order('analysis_date', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function closeAnalysisEntry(id, status, actualResult) {
  const { data, error } = await supabase
    .from('mlb_daily_analysis')
    .update({
      status,
      actual_result: actualResult || null,
      closed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getRecord(marketType, guildId) {
  const { data, error } = await supabase
    .from('mlb_daily_analysis')
    .select('status')
    .eq('market_type', marketType)
    .eq('guild_id', guildId)
    .in('status', ['hit', 'miss', 'push']);
  if (error) throw error;
  const record = { hits: 0, misses: 0, pushes: 0 };
  for (const r of (data || [])) {
    if (r.status === 'hit') record.hits++;
    else if (r.status === 'miss') record.misses++;
    else if (r.status === 'push') record.pushes++;
  }
  return record;
}

async function getTodayRecord(marketType, guildId, date) {
  const { data, error } = await supabase
    .from('mlb_daily_analysis')
    .select('status')
    .eq('market_type', marketType)
    .eq('guild_id', guildId)
    .eq('analysis_date', date)
    .in('status', ['hit', 'miss', 'push']);
  if (error) throw error;
  const record = { hits: 0, misses: 0, pushes: 0 };
  for (const r of (data || [])) {
    if (r.status === 'hit') record.hits++;
    else if (r.status === 'miss') record.misses++;
    else if (r.status === 'push') record.pushes++;
  }
  return record;
}

async function getStreak(marketType, guildId) {
  const { data, error } = await supabase
    .from('mlb_daily_analysis')
    .select('status')
    .eq('market_type', marketType)
    .eq('guild_id', guildId)
    .in('status', ['hit', 'miss'])
    .order('closed_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  if (!data || data.length === 0) return 0;
  const first = data[0].status;
  let streak = 0;
  for (const r of data) {
    if (r.status === first) streak++;
    else break;
  }
  return first === 'hit' ? streak : -streak;
}

async function hasAnalysisForToday(marketType, guildId, date) {
  const { data, error } = await supabase
    .from('mlb_daily_analysis')
    .select('id')
    .eq('market_type', marketType)
    .eq('guild_id', guildId)
    .eq('analysis_date', date)
    .limit(1);
  if (error) throw error;
  return data && data.length > 0;
}

// ── Message Tracking ──

async function saveMessage(guildId, channelId, messageId, date, marketType) {
  const { data, error } = await supabase
    .from('mlb_analysis_messages')
    .upsert({
      guild_id: guildId,
      channel_id: channelId,
      message_id: messageId,
      analysis_date: date,
      market_type: marketType,
    }, { onConflict: 'analysis_date,market_type,guild_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getMessage(date, marketType, guildId) {
  const { data, error } = await supabase
    .from('mlb_analysis_messages')
    .select('*')
    .eq('analysis_date', date)
    .eq('market_type', marketType)
    .eq('guild_id', guildId)
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function deleteAnalysisForToday(marketType, guildId, date) {
  // Delete analysis entries
  const { error: entryErr } = await supabase
    .from('mlb_daily_analysis')
    .delete()
    .eq('market_type', marketType)
    .eq('guild_id', guildId)
    .eq('analysis_date', date);
  if (entryErr) throw entryErr;

  // Delete message record so it re-posts
  const { error: msgErr } = await supabase
    .from('mlb_analysis_messages')
    .delete()
    .eq('market_type', marketType)
    .eq('guild_id', guildId)
    .eq('analysis_date', date);
  if (msgErr) throw msgErr;

  console.log(`[MLB DB] Deleted ${marketType} entries + message for ${date} / ${guildId}`);
}

module.exports = {
  createAnalysisEntries,
  getAnalysisByDate,
  getPendingAnalysis,
  closeAnalysisEntry,
  getRecord,
  getTodayRecord,
  getStreak,
  hasAnalysisForToday,
  saveMessage,
  getMessage,
  deleteAnalysisForToday,
};
