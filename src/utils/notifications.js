const followsDb = require('../database/bettorFollows');

/**
 * Send DM notifications to all followers when a bettor posts a new bet.
 * Fails silently (users may have DMs disabled).
 *
 * @param {Client} client - Discord client
 * @param {string} bettorDiscordId - Discord ID of the bettor
 * @param {string} guildId - Guild ID
 * @param {object} bet - The bet object
 * @param {string} displayName - Bettor's display name
 * @param {boolean} isRetro - Whether the bet is retro
 */
async function notifyFollowers(client, bettorDiscordId, guildId, bet, displayName, isRetro) {
  // Don't notify for retro bets
  if (isRetro) return;

  try {
    const followers = await followsDb.getFollowers(bettorDiscordId, guildId);
    if (!followers.length) return;

    // Build a summary of the bet
    const betType = bet.bet_type === 'parlay' ? 'Parlay' : 'Single';
    const pick = bet.bet_type === 'parlay'
      ? `${(bet.parlay_legs || []).length}-leg parlay`
      : (bet.pick || 'Unknown pick');
    const odds = bet.odds_american >= 0 ? `+${bet.odds_american}` : `${bet.odds_american}`;
    const units = bet.units || '?';
    const isWhale = bet.is_whale ? '🐋 WHALE ' : '';

    // Get guild name
    let guildName = 'a server';
    try {
      const guild = await client.guilds.fetch(guildId);
      guildName = guild.name;
    } catch (e) { /* ignore */ }

    const dmContent = [
      `🔔 **${displayName}** just posted a new ${isWhale}bet!`,
      `**${betType}:** ${pick} at ${odds} (${units}u)`,
      `In **${guildName}**`,
    ].join('\n');

    // Send DMs in parallel
    const dmPromises = followers.map(async (f) => {
      try {
        const user = await client.users.fetch(f.follower_discord_id);
        await user.send(dmContent);
      } catch (e) {
        // User has DMs disabled or left the server — silently skip
      }
    });

    await Promise.allSettled(dmPromises);
  } catch (err) {
    console.error('[FollowNotify] Error sending follower DMs:', err.message);
  }
}

/**
 * Send a DM to the bet owner when someone tails their bet.
 *
 * @param {Client} client - Discord client
 * @param {string} bettorDiscordId - bet owner's Discord ID
 * @param {string} tailerDisplayName - display name of the person tailing
 * @param {string} action - 'tailed' or 'faded'
 * @param {object} bet - partial bet object (needs pick, odds_american)
 */
async function notifyBetOwner(client, bettorDiscordId, tailerDisplayName, action, bet) {
  try {
    const emoji = action === 'tailed' ? '👍' : '👎';
    const pick = bet.pick || 'your bet';
    const odds = bet.odds_american != null
      ? (bet.odds_american >= 0 ? ` at +${bet.odds_american}` : ` at ${bet.odds_american}`)
      : '';

    const dmContent = `${emoji} **${tailerDisplayName}** just ${action} your bet!\n**${pick}**${odds}`;

    const user = await client.users.fetch(bettorDiscordId);
    await user.send(dmContent);
  } catch (e) {
    // User has DMs disabled — silently skip
  }
}

module.exports = { notifyFollowers, notifyBetOwner };
