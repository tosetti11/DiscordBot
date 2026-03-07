/**
 * Role Manager Service
 * 
 * Creates Discord roles with badge icons and auto-assigns them
 * based on betting activity, tailing behavior, streaks, and performance.
 * 
 * Runs on a periodic interval (every 30 min) to recalculate all roles.
 */

const fs = require('fs');
const { supabase } = require('../config/supabase');
const {
  MANUAL_ROLES,
  TIER_ROLES,
  PERFORMANCE_ROLES,
  STREAK_ROLES,
  SOCIAL_ROLES,
  ALL_AUTO_ROLE_KEYS,
} = require('../config/roles');

// Cache: roleKey -> Discord Role ID (populated on setup)
const roleCache = new Map();

// ─── Setup: Create or find all roles in the guild ───
async function setupRoles(guild) {
  console.log('[RoleManager] Setting up roles...');

  const allRoleDefs = [
    ...Object.entries(MANUAL_ROLES).map(([key, def]) => ({ key, ...def })),
    ...TIER_ROLES,
    ...PERFORMANCE_ROLES,
    ...STREAK_ROLES,
    ...SOCIAL_ROLES,
  ];

  const existingRoles = await guild.roles.fetch();
  const botMember = await guild.members.fetchMe();
  const botHighestRole = botMember.roles.highest;

  for (const def of allRoleDefs) {
    try {
      // Check if role already exists by name
      let role = existingRoles.find(r => r.name === def.name);

      if (!role) {
        // Create the role
        const roleData = {
          name: def.name,
          color: def.color,
          hoist: def.hoist || false,
          mentionable: false,
          reason: 'GK Bot auto-role setup',
        };

        // Try to add icon (requires Boost Level 2)
        if (def.icon && fs.existsSync(def.icon)) {
          try {
            roleData.icon = fs.readFileSync(def.icon);
          } catch (iconErr) {
            // Icon read failed, proceed without
          }
        }

        role = await guild.roles.create(roleData);
        console.log(`[RoleManager] Created role: ${def.name}`);
      } else {
        // Update color/hoist if needed
        const updates = {};
        if (role.color !== def.color) updates.color = def.color;
        if (role.hoist !== (def.hoist || false)) updates.hoist = def.hoist || false;

        // Try to set icon if missing and guild supports it
        if (def.icon && !role.icon && fs.existsSync(def.icon)) {
          try {
            updates.icon = fs.readFileSync(def.icon);
          } catch (e) { /* skip */ }
        }

        if (Object.keys(updates).length > 0) {
          try {
            await role.edit(updates);
          } catch (editErr) {
            // Icon upload fails if guild not boosted enough — that's fine
            if (editErr.code === 50101) {
              // Try again without icon
              delete updates.icon;
              if (Object.keys(updates).length > 0) {
                await role.edit(updates);
              }
            }
          }
        }
      }

      roleCache.set(def.key, role.id);
    } catch (err) {
      console.error(`[RoleManager] Failed to setup role ${def.name}:`, err.message);
    }
  }

  console.log(`[RoleManager] Setup complete. ${roleCache.size} roles cached.`);
  return roleCache;
}

// ─── Assign manual roles (TheKing, Whale) ───
async function assignManualRoles(guild) {
  for (const [key, def] of Object.entries(MANUAL_ROLES)) {
    const roleId = roleCache.get(key);
    if (!roleId) continue;

    for (const userId of def.users) {
      try {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
          console.log(`[RoleManager] User ${userId} not found in guild for ${def.name}`);
          continue;
        }
        if (!member.roles.cache.has(roleId)) {
          await member.roles.add(roleId, `Manual role: ${def.name}`);
          console.log(`[RoleManager] Assigned ${def.name} to ${member.user.username}`);
        }
      } catch (err) {
        console.error(`[RoleManager] Failed to assign ${def.name} to ${userId}:`, err.message);
      }
    }
  }
}

// ─── Fetch all user stats from the database ───
async function fetchAllUserStats(guildId) {
  const userStats = new Map(); // discordId -> stats object

  // 1. Get all bets for this guild with status
  const { data: bets, error: betsErr } = await supabase
    .from('bets')
    .select('discord_id, status, units, odds_american, created_at')
    .eq('guild_id', guildId);

  if (betsErr) {
    console.error('[RoleManager] Failed to fetch bets:', betsErr.message);
    return userStats;
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Build per-user stats from bets
  for (const bet of (bets || [])) {
    if (!userStats.has(bet.discord_id)) {
      userStats.set(bet.discord_id, {
        discordId: bet.discord_id,
        totalBets: 0,
        closedBets: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
        winPct: 0,
        netUnits: 0,
        recentBets: 0,
        streakType: '',
        streakCount: 0,
        tailCount: 0,
        fadeCount: 0,
        rank: 999,
        betsChronological: [],
      });
    }

    const s = userStats.get(bet.discord_id);
    s.totalBets++;

    if (['win', 'loss', 'push'].includes(bet.status)) {
      s.closedBets++;
      if (bet.status === 'win') s.wins++;
      if (bet.status === 'loss') s.losses++;
      if (bet.status === 'push') s.pushes++;

      // Net units calculation
      const units = Number(bet.units) || 1;
      if (bet.status === 'win') {
        const odds = bet.odds_american || -110;
        s.netUnits += odds >= 0
          ? units * (odds / 100)
          : units * (100 / Math.abs(odds));
      } else if (bet.status === 'loss') {
        s.netUnits -= units;
      }

      // For streak calculation
      s.betsChronological.push({
        status: bet.status,
        date: bet.created_at,
      });
    }

    // Recent activity (last 30 days)
    if (new Date(bet.created_at) >= thirtyDaysAgo) {
      s.recentBets++;
    }
  }

  // 2. Calculate win % and streaks
  for (const [, s] of userStats) {
    // Win percentage
    const decided = s.wins + s.losses;
    s.winPct = decided > 0 ? Math.round((s.wins / decided) * 1000) / 10 : 0;
    s.netUnits = Math.round(s.netUnits * 100) / 100;

    // Streak (sort by date descending)
    s.betsChronological.sort((a, b) => new Date(b.date) - new Date(a.date));
    if (s.betsChronological.length > 0) {
      const first = s.betsChronological.find(b => b.status === 'win' || b.status === 'loss');
      if (first) {
        s.streakType = first.status;
        s.streakCount = 0;
        for (const b of s.betsChronological) {
          if (b.status === s.streakType) s.streakCount++;
          else if (b.status === 'win' || b.status === 'loss') break;
          // skip pushes
        }
      }
    }

    // Cleanup temp field
    delete s.betsChronological;
  }

  // 3. Rank by net units (for GOAT role)
  const ranked = [...userStats.values()]
    .filter(s => s.closedBets >= 20)
    .sort((a, b) => b.netUnits - a.netUnits);
  ranked.forEach((s, i) => { s.rank = i + 1; });

  // 4. Get tail/fade counts
  const { data: tails, error: tailErr } = await supabase
    .from('tailed_bets')
    .select('tailer_discord_id, tailed, bets!inner(guild_id)')
    .eq('bets.guild_id', guildId);

  if (!tailErr && tails) {
    for (const t of tails) {
      const id = t.tailer_discord_id;
      if (!userStats.has(id)) {
        userStats.set(id, {
          discordId: id,
          totalBets: 0,
          closedBets: 0,
          wins: 0,
          losses: 0,
          pushes: 0,
          winPct: 0,
          netUnits: 0,
          recentBets: 0,
          streakType: '',
          streakCount: 0,
          tailCount: 0,
          fadeCount: 0,
          rank: 999,
        });
      }
      const s = userStats.get(id);
      if (t.tailed) s.tailCount++;
      else s.fadeCount++;
    }
  }

  return userStats;
}

// ─── Recalculate and assign/remove auto roles for all users ───
async function recalculateRoles(guild) {
  const startTime = Date.now();
  const guildId = guild.id;

  // Ensure roles are set up
  if (roleCache.size === 0) {
    await setupRoles(guild);
  }

  // Fetch all stats
  const userStats = await fetchAllUserStats(guildId);
  if (userStats.size === 0) {
    console.log('[RoleManager] No user stats found, skipping recalculation.');
    return;
  }

  let assigned = 0, removed = 0, errors = 0;

  // Collect all role keys we manage
  const tierKeys = TIER_ROLES.map(r => r.key);
  const streakKeys = STREAK_ROLES.map(r => r.key);

  for (const [discordId, stats] of userStats) {
    try {
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) continue;

      // ─── Tier roles (mutually exclusive — highest tier wins) ───
      let assignedTier = null;
      for (const tierDef of TIER_ROLES) {
        if (tierDef.check(stats)) {
          assignedTier = tierDef.key;
          break;
        }
      }

      for (const tierDef of TIER_ROLES) {
        const roleId = roleCache.get(tierDef.key);
        if (!roleId) continue;

        if (tierDef.key === assignedTier) {
          if (!member.roles.cache.has(roleId)) {
            await member.roles.add(roleId, `Auto-tier: ${tierDef.name}`);
            assigned++;
          }
        } else {
          if (member.roles.cache.has(roleId)) {
            await member.roles.remove(roleId, `Auto-tier changed`);
            removed++;
          }
        }
      }

      // ─── Performance roles (can stack) ───
      for (const perfDef of PERFORMANCE_ROLES) {
        const roleId = roleCache.get(perfDef.key);
        if (!roleId) continue;

        if (perfDef.check(stats)) {
          if (!member.roles.cache.has(roleId)) {
            await member.roles.add(roleId, `Auto-performance: ${perfDef.name}`);
            assigned++;
          }
        } else {
          if (member.roles.cache.has(roleId)) {
            await member.roles.remove(roleId, `Performance check no longer met`);
            removed++;
          }
        }
      }

      // ─── Streak roles (mutually exclusive — hot OR cold) ───
      let assignedStreak = null;
      for (const streakDef of STREAK_ROLES) {
        if (streakDef.check(stats)) {
          assignedStreak = streakDef.key;
          break;
        }
      }

      for (const streakDef of STREAK_ROLES) {
        const roleId = roleCache.get(streakDef.key);
        if (!roleId) continue;

        if (streakDef.key === assignedStreak) {
          if (!member.roles.cache.has(roleId)) {
            await member.roles.add(roleId, `Auto-streak: ${streakDef.name}`);
            assigned++;
          }
        } else {
          if (member.roles.cache.has(roleId)) {
            await member.roles.remove(roleId, `Streak ended`);
            removed++;
          }
        }
      }

      // ─── Social roles (can stack) ───
      for (const socialDef of SOCIAL_ROLES) {
        const roleId = roleCache.get(socialDef.key);
        if (!roleId) continue;

        if (socialDef.check(stats)) {
          if (!member.roles.cache.has(roleId)) {
            await member.roles.add(roleId, `Auto-social: ${socialDef.name}`);
            assigned++;
          }
        } else {
          if (member.roles.cache.has(roleId)) {
            await member.roles.remove(roleId, `Social check no longer met`);
            removed++;
          }
        }
      }

    } catch (err) {
      errors++;
      if (err.code !== 10007) { // Ignore "Unknown Member" errors
        console.error(`[RoleManager] Error processing ${discordId}:`, err.message);
      }
    }
  }

  const elapsed = Date.now() - startTime;
  console.log(`[RoleManager] Recalculation done in ${elapsed}ms — assigned: ${assigned}, removed: ${removed}, errors: ${errors}`);
}

// ─── Quick role update for a single user (called after bet close, tail, etc.) ───
async function updateUserRoles(guild, discordId) {
  if (roleCache.size === 0) return; // Not set up yet

  try {
    const userStats = await fetchAllUserStats(guild.id);
    const stats = userStats.get(discordId);
    if (!stats) return;

    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) return;

    // Same logic as recalculate but for single user
    // Tier
    let assignedTier = null;
    for (const tierDef of TIER_ROLES) {
      if (tierDef.check(stats)) { assignedTier = tierDef.key; break; }
    }
    for (const tierDef of TIER_ROLES) {
      const roleId = roleCache.get(tierDef.key);
      if (!roleId) continue;
      if (tierDef.key === assignedTier) {
        if (!member.roles.cache.has(roleId)) await member.roles.add(roleId);
      } else {
        if (member.roles.cache.has(roleId)) await member.roles.remove(roleId);
      }
    }

    // Performance
    for (const perfDef of PERFORMANCE_ROLES) {
      const roleId = roleCache.get(perfDef.key);
      if (!roleId) continue;
      if (perfDef.check(stats)) {
        if (!member.roles.cache.has(roleId)) await member.roles.add(roleId);
      } else {
        if (member.roles.cache.has(roleId)) await member.roles.remove(roleId);
      }
    }

    // Streak
    let assignedStreak = null;
    for (const streakDef of STREAK_ROLES) {
      if (streakDef.check(stats)) { assignedStreak = streakDef.key; break; }
    }
    for (const streakDef of STREAK_ROLES) {
      const roleId = roleCache.get(streakDef.key);
      if (!roleId) continue;
      if (streakDef.key === assignedStreak) {
        if (!member.roles.cache.has(roleId)) await member.roles.add(roleId);
      } else {
        if (member.roles.cache.has(roleId)) await member.roles.remove(roleId);
      }
    }

    // Social
    for (const socialDef of SOCIAL_ROLES) {
      const roleId = roleCache.get(socialDef.key);
      if (!roleId) continue;
      if (socialDef.check(stats)) {
        if (!member.roles.cache.has(roleId)) await member.roles.add(roleId);
      } else {
        if (member.roles.cache.has(roleId)) await member.roles.remove(roleId);
      }
    }
  } catch (err) {
    console.error(`[RoleManager] updateUserRoles error for ${discordId}:`, err.message);
  }
}

// ─── Get role summary for a user (for display purposes) ───
function getUserRoleBadges(member) {
  if (!member || roleCache.size === 0) return [];

  const badges = [];
  const allDefs = [
    ...Object.entries(MANUAL_ROLES).map(([key, def]) => ({ key, ...def })),
    ...TIER_ROLES,
    ...PERFORMANCE_ROLES,
    ...STREAK_ROLES,
    ...SOCIAL_ROLES,
  ];

  for (const def of allDefs) {
    const roleId = roleCache.get(def.key);
    if (roleId && member.roles.cache.has(roleId)) {
      badges.push({ key: def.key, name: def.name, emoji: def.emoji, color: def.color });
    }
  }

  return badges;
}

module.exports = {
  setupRoles,
  assignManualRoles,
  recalculateRoles,
  updateUserRoles,
  getUserRoleBadges,
  roleCache,
};
