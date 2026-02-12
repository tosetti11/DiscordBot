const { supabase } = require('../config/supabase');

/**
 * Add a tailed bet entry
 */
async function addTailedBet(betId, tailerDiscordId, tailed) {
  const { data, error } = await supabase
    .from('tailed_bets')
    .upsert({ bet_id: betId, tailer_discord_id: tailerDiscordId, tailed }, { onConflict: ['bet_id', 'tailer_discord_id'] })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Get tailed bet stats for a user
 */
async function getTailedBetsForUser(discordId) {
  const { data, error } = await supabase
    .from('tailed_bets')
    .select('*')
    .eq('tailer_discord_id', discordId);
  if (error) throw error;
  return data || [];
}

module.exports = {
  addTailedBet,
  getTailedBetsForUser,
};
