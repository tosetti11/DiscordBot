/**
 * Discord Role Definitions
 * 
 * Manual roles: assigned to specific users by config
 * Auto roles: calculated from betting data (bets, tails, streaks, win rate)
 * 
 * Icon files are in src/assets/role-icons/ (72x72 Twemoji PNGs)
 * Role icons require Server Boost Level 2 — falls back to emoji in name if not boosted
 */

const path = require('path');

const ICON_DIR = path.join(__dirname, '..', 'assets', 'role-icons');

// ─── Manual Roles ───
// Assigned to specific Discord user IDs, never auto-removed
const MANUAL_ROLES = {
  theking: {
    name: '👑 TheKing',
    color: 0xFFD700,     // Gold
    icon: path.join(ICON_DIR, 'crown.png'),
    emoji: '👑',
    hoist: true,         // Show separately in member list
    position: 'top',     // Highest priority
    users: ['1246525685749649441'],
  },
  whale: {
    name: '🐋 Whale',
    color: 0x1E90FF,     // Dodger Blue
    icon: path.join(ICON_DIR, 'whale.png'),
    emoji: '🐋',
    hoist: true,
    position: 'high',
    users: ['1464701160882442271'],
  },
};

// ─── Activity-Based Tier Roles ───
// Based on total closed bet count. Mutually exclusive — highest tier wins.
const TIER_ROLES = [
  {
    key: 'goat',
    name: '🐐 GOAT',
    color: 0xB8860B,     // Dark Goldenrod
    icon: path.join(ICON_DIR, 'goat.png'),
    emoji: '🐐',
    hoist: true,
    // Top 1 on leaderboard by net units (min 20 bets)
    check: (stats) => stats.rank === 1 && stats.totalBets >= 20,
  },
  {
    key: 'shark',
    name: '🦈 Shark',
    color: 0x2C3E50,     // Dark Blue-Gray
    icon: path.join(ICON_DIR, 'shark.png'),
    emoji: '🦈',
    hoist: false,
    check: (stats) => stats.totalBets >= 25,
  },
  {
    key: 'regular',
    name: '🎲 Regular',
    color: 0x27AE60,     // Green
    icon: path.join(ICON_DIR, 'dice.png'),
    emoji: '🎲',
    hoist: false,
    check: (stats) => stats.totalBets >= 10,
  },
  {
    key: 'rookie',
    name: '👶 Rookie',
    color: 0x9B59B6,     // Purple
    icon: path.join(ICON_DIR, 'baby.png'),
    emoji: '👶',
    hoist: false,
    check: (stats) => stats.totalBets >= 1,
  },
];

// ─── Performance Roles ───
// Based on win rate. Can stack with tier roles.
const PERFORMANCE_ROLES = [
  {
    key: 'sharp',
    name: '🎯 Sharp',
    color: 0xDAA520,     // Goldenrod
    icon: path.join(ICON_DIR, 'target.png'),
    emoji: '🎯',
    hoist: false,
    // 55%+ win rate with min 20 closed bets
    check: (stats) => stats.winPct >= 55 && stats.closedBets >= 20,
  },
  {
    key: 'clown',
    name: '🤡 Clown',
    color: 0x8E44AD,     // Purple
    icon: path.join(ICON_DIR, 'clown.png'),
    emoji: '🤡',
    hoist: false,
    // Below 40% win rate with min 15 closed bets
    check: (stats) => stats.winPct < 40 && stats.closedBets >= 15,
  },
];

// ─── Streak Roles ───
// Based on current streak. Mutually exclusive (hot OR cold).
const STREAK_ROLES = [
  {
    key: 'hotstreak',
    name: '🔥 Hot Streak',
    color: 0xE74C3C,     // Red
    icon: path.join(ICON_DIR, 'fire.png'),
    emoji: '🔥',
    hoist: false,
    check: (stats) => stats.streakType === 'win' && stats.streakCount >= 5,
  },
  {
    key: 'coldstreak',
    name: '❄️ Cold Streak',
    color: 0x3498DB,     // Ice Blue
    icon: path.join(ICON_DIR, 'snowflake.png'),
    emoji: '❄️',
    hoist: false,
    check: (stats) => stats.streakType === 'loss' && stats.streakCount >= 5,
  },
];

// ─── Social / Tail Roles ───
// Based on tailing behavior. Can have multiple.
const SOCIAL_ROLES = [
  {
    key: 'loyaltailer',
    name: '🐑 Loyal Tailer',
    color: 0xE67E22,     // Orange
    icon: path.join(ICON_DIR, 'sheep.png'),
    emoji: '🐑',
    hoist: false,
    // 20+ tails (followed bets)
    check: (stats) => stats.tailCount >= 20,
  },
  {
    key: 'contrarian',
    name: '🗿 Contrarian',
    color: 0xC0392B,     // Dark Red
    icon: path.join(ICON_DIR, 'moai.png'),
    emoji: '🗿',
    hoist: false,
    // 10+ fades
    check: (stats) => stats.fadeCount >= 10,
  },
  {
    key: 'ghost',
    name: '👻 Ghost',
    color: 0x95A5A6,     // Gray
    icon: path.join(ICON_DIR, 'ghost.png'),
    emoji: '👻',
    hoist: false,
    // Had bets before but 0 in last 30 days
    check: (stats) => stats.totalBets > 0 && stats.recentBets === 0,
  },
];

// All auto-assignable role keys (for cleanup)
const ALL_AUTO_ROLE_KEYS = [
  ...TIER_ROLES.map(r => r.key),
  ...PERFORMANCE_ROLES.map(r => r.key),
  ...STREAK_ROLES.map(r => r.key),
  ...SOCIAL_ROLES.map(r => r.key),
];

// Full definition lookup by key
const ALL_ROLES = {};
for (const r of Object.values(MANUAL_ROLES)) ALL_ROLES[r.name] = r;
for (const list of [TIER_ROLES, PERFORMANCE_ROLES, STREAK_ROLES, SOCIAL_ROLES]) {
  for (const r of list) ALL_ROLES[r.key] = r;
}

module.exports = {
  MANUAL_ROLES,
  TIER_ROLES,
  PERFORMANCE_ROLES,
  STREAK_ROLES,
  SOCIAL_ROLES,
  ALL_AUTO_ROLE_KEYS,
  ALL_ROLES,
  ICON_DIR,
};
