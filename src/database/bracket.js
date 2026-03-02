/**
 * Bracket Database Queries
 * CRUD for tournaments, teams, games, entries, and email users.
 */
const { supabase } = require('../config/supabase');

// ─── Email Users ───

async function createEmailUser(email, passwordHash, displayName) {
  const { data, error } = await supabase.from('bracket_email_users')
    .insert({ email: email.toLowerCase().trim(), password_hash: passwordHash, display_name: displayName })
    .select().single();
  if (error) throw error;
  return data;
}

async function getEmailUserByEmail(email) {
  const { data, error } = await supabase.from('bracket_email_users')
    .select('*').eq('email', email.toLowerCase().trim()).maybeSingle();
  if (error) throw error;
  return data;
}

async function getEmailUser(id) {
  const { data, error } = await supabase.from('bracket_email_users')
    .select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

// ─── Tournaments ───

async function createTournament(data) {
  const { data: t, error } = await supabase.from('bracket_tournaments')
    .insert(data).select().single();
  if (error) throw error;
  return t;
}

async function getTournament(id) {
  const { data, error } = await supabase.from('bracket_tournaments')
    .select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function getActiveTournament() {
  const { data, error } = await supabase.from('bracket_tournaments')
    .select('*').neq('status', 'completed').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

async function updateTournament(id, updates) {
  const { data, error } = await supabase.from('bracket_tournaments')
    .update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

// ─── Teams ───

async function seedTeams(tournamentId, teams) {
  // Clear existing teams first
  await supabase.from('bracket_teams').delete().eq('tournament_id', tournamentId);
  const rows = teams.map(t => ({ tournament_id: tournamentId, ...t }));
  const { data, error } = await supabase.from('bracket_teams')
    .insert(rows).select().order('region').order('seed');
  if (error) throw error;
  return data;
}

async function getTeams(tournamentId) {
  const { data, error } = await supabase.from('bracket_teams')
    .select('*').eq('tournament_id', tournamentId).order('region').order('seed');
  if (error) throw error;
  return data || [];
}

async function updateTeamElimination(teamId, eliminated) {
  const { data, error } = await supabase.from('bracket_teams')
    .update({ is_eliminated: eliminated }).eq('id', teamId).select().single();
  if (error) throw error;
  return data;
}

// ─── Games ───

async function initializeGames(tournamentId, gamesData) {
  // Clear existing
  await supabase.from('bracket_games').delete().eq('tournament_id', tournamentId);
  const rows = gamesData.map(g => ({ tournament_id: tournamentId, ...g }));
  const { data, error } = await supabase.from('bracket_games')
    .insert(rows).select().order('game_number');
  if (error) throw error;
  return data;
}

async function getGames(tournamentId) {
  const { data, error } = await supabase.from('bracket_games')
    .select('*').eq('tournament_id', tournamentId).order('game_number');
  if (error) throw error;
  return data || [];
}

async function updateGameResult(tournamentId, gameNumber, updates) {
  const { data, error } = await supabase.from('bracket_games')
    .update(updates)
    .eq('tournament_id', tournamentId)
    .eq('game_number', gameNumber)
    .select().single();
  if (error) throw error;
  return data;
}

// ─── Entries ───

async function createEntry(data) {
  const { data: entry, error } = await supabase.from('bracket_entries')
    .insert(data).select().single();
  if (error) throw error;
  return entry;
}

async function getEntryByDiscordId(tournamentId, userId) {
  const { data, error } = await supabase.from('bracket_entries')
    .select('*').eq('tournament_id', tournamentId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function getEntryByEmailUserId(tournamentId, emailUserId) {
  const { data, error } = await supabase.from('bracket_entries')
    .select('*').eq('tournament_id', tournamentId).eq('email_user_id', emailUserId).maybeSingle();
  if (error) throw error;
  return data;
}

async function getEntry(entryId) {
  const { data, error } = await supabase.from('bracket_entries')
    .select('*').eq('id', entryId).maybeSingle();
  if (error) throw error;
  return data;
}

async function getEntries(tournamentId) {
  const { data, error } = await supabase.from('bracket_entries')
    .select('*').eq('tournament_id', tournamentId).order('score', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function updatePicks(entryId, picks, tiebreaker) {
  const updates = { picks, submitted_at: new Date().toISOString() };
  if (tiebreaker !== undefined) updates.tiebreaker = tiebreaker;
  const { data, error } = await supabase.from('bracket_entries')
    .update(updates).eq('id', entryId).select().single();
  if (error) throw error;
  return data;
}

async function updateEntryScore(entryId, score, maxPossible, correctPicks) {
  const { data, error } = await supabase.from('bracket_entries')
    .update({ score, max_possible: maxPossible, correct_picks: correctPicks })
    .eq('id', entryId).select().single();
  if (error) throw error;
  return data;
}

async function updatePayment(entryId, paid) {
  const updates = { paid, paid_at: paid ? new Date().toISOString() : null };
  const { data, error } = await supabase.from('bracket_entries')
    .update(updates).eq('id', entryId).select().single();
  if (error) throw error;
  return data;
}

async function deleteEntry(entryId) {
  const { error } = await supabase.from('bracket_entries').delete().eq('id', entryId);
  if (error) throw error;
}

// ─── Leaderboard ───

async function getLeaderboard(tournamentId) {
  const { data, error } = await supabase.from('bracket_entries')
    .select('id, display_name, auth_type, score, max_possible, correct_picks, tiebreaker, paid, submitted_at')
    .eq('tournament_id', tournamentId)
    .not('submitted_at', 'is', null)
    .order('score', { ascending: false })
    .order('correct_picks', { ascending: false })
    .order('tiebreaker', { ascending: true });
  if (error) throw error;
  return data || [];
}

module.exports = {
  // Email users
  createEmailUser, getEmailUserByEmail, getEmailUser,
  // Tournaments
  createTournament, getTournament, getActiveTournament, updateTournament,
  // Teams
  seedTeams, getTeams, updateTeamElimination,
  // Games
  initializeGames, getGames, updateGameResult,
  // Entries
  createEntry, getEntryByDiscordId, getEntryByEmailUserId, getEntry,
  getEntries, updatePicks, updateEntryScore, updatePayment, deleteEntry,
  // Leaderboard
  getLeaderboard,
};
