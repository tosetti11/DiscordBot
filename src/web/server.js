/**
 * Express web server for the bet slip form
 * - Discord OAuth2 login
 * - Spotify-style bet slip form
 * - API to save bets + post to Discord channel
 */
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const path = require('path');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { supabase } = require('../config/supabase');
const db = require('../database/queries');
const tailedBetsDb = require('../database/tailedBets');
const { americanToDecimal, decimalToAmerican, formatOdds } = require('../utils/odds');
const { SPORT_NAMES, WAGER_TYPES, STATUS_EMOJI } = require('../config/constants');
const { buildBetEmbed, buildWhaleBetEmbed } = require('../utils/embeds');
const remindersDb = require('../database/reminders');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Exiting.');
  process.exit(1);
}
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = `${BASE_URL}/auth/callback`;

let discordClient = null; // Will be set from index.js

const WHALE_ROLES = ['sharp', 'admin', 'the king'];
const ADMIN_ROLES = ['admin', 'the king'];
const SITE_OWNER_ID = '1338301556973633577'; // Only this Discord user can view analytics

function setDiscordClient(client) {
  discordClient = client;
}

/**
 * Get a guild member, using cache first to avoid API calls
 */
async function fetchMember(guild, discordId) {
  return guild.members.cache.get(discordId) || await guild.members.fetch(discordId);
}

/**
 * Get a member's role names (lowercase) in a guild
 */
async function getMemberRoles(guildId, discordId) {
  try {
    const guild = discordClient?.guilds.cache.get(guildId);
    if (!guild) return [];
    const member = await fetchMember(guild, discordId);
    return member.roles.cache.map(r => r.name.toLowerCase());
  } catch (e) {
    return [];
  }
}

/**
 * Check if a member has admin-level perms (Admin role, The King role, or server Administrator)
 */
async function isAdminInGuild(guildId, discordId) {
  try {
    const guild = discordClient?.guilds.cache.get(guildId);
    if (!guild) return false;
    const member = await fetchMember(guild, discordId);
    if (member.permissions.has('Administrator')) return true;
    const roleNames = member.roles.cache.map(r => r.name.toLowerCase());
    return ADMIN_ROLES.some(r => roleNames.includes(r));
  } catch (e) {
    return false;
  }
}

/**
 * Check if a member can place whale bets
 */
async function canPlaceWhale(guildId, discordId) {
  try {
    const guild = discordClient?.guilds.cache.get(guildId);
    if (!guild) return false;
    const member = await fetchMember(guild, discordId);
    if (member.permissions.has('Administrator')) return true;
    const roleNames = member.roles.cache.map(r => r.name.toLowerCase());
    return WHALE_ROLES.some(r => roleNames.includes(r));
  } catch (e) {
    return false;
  }
}

function createWebServer() {
  const app = express();

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Trust nginx reverse proxy (needed for rate limiting behind proxy)
  app.set('trust proxy', 1);

  // ─── Security Headers (helmet) ───
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "https://cdn.discordapp.com", "data:"],
        connectSrc: ["'self'"],
      },
    },
  }));

  // ─── Rate Limiting ───
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
  });
  const postLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10, // 10 writes per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please slow down' },
  });
  const authLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10, // 10 login attempts per 5 min
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts, please try again later' },
  });
  app.use('/api/', apiLimiter);
  app.use('/auth/', authLimiter);

  app.use(express.static(path.join(__dirname, 'public')));

  // ─── Auth Middleware ───
  function authMiddleware(req, res, next) {
    const token = req.cookies.fk_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
      req.user = decoded;
      next();
    } catch (e) {
      res.clearCookie('fk_token');
      return res.status(401).json({ error: 'Session expired' });
    }
  }

  // ─── OAuth2 Routes ───

  // Redirect to Discord OAuth2
  app.get('/auth/login', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('oauth_state', state, { httpOnly: true, maxAge: 300000, sameSite: 'lax', secure: BASE_URL.startsWith('https') });
    const params = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      redirect_uri: DISCORD_REDIRECT_URI,
      response_type: 'code',
      scope: 'identify guilds',
      state,
    });
    res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
  });

  // OAuth2 callback
  app.get('/auth/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code) return res.redirect('/?error=no_code');

    // Verify OAuth state to prevent CSRF
    const savedState = req.cookies.oauth_state;
    res.clearCookie('oauth_state');
    if (!state || !savedState || state !== savedState) {
      return res.redirect('/?error=invalid_state');
    }

    try {
      // Exchange code for token
      const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: DISCORD_CLIENT_ID,
          client_secret: DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: DISCORD_REDIRECT_URI,
        }),
      });

      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) return res.redirect('/?error=token_failed');

      // Get user info
      const userRes = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const userData = await userRes.json();

      // Get user's guilds to find ones the bot is also in
      const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const userGuilds = await guildsRes.json();

      // Filter to guilds the bot is in
      const botGuildIds = discordClient ? [...discordClient.guilds.cache.keys()] : [];
      const sharedGuilds = (userGuilds || []).filter(g => botGuildIds.includes(g.id));

      // Create JWT
      const avatar = userData.avatar
        ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/${parseInt(userData.discriminator || '0') % 5}.png`;

      const jwtPayload = {
        discordId: userData.id,
        username: userData.username,
        displayName: userData.global_name || userData.username,
        avatar,
        guilds: sharedGuilds.map(g => ({ id: g.id, name: g.name, icon: g.icon })),
      };

      const token = jwt.sign(jwtPayload, JWT_SECRET, { expiresIn: '7d' });

      res.cookie('fk_token', token, {
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production' || BASE_URL.startsWith('https'),
      });

      // Log login event for analytics
      try {
        await supabase.from('web_analytics').insert({
          discord_id: userData.id,
          discord_username: userData.username,
          display_name: userData.global_name || userData.username,
          avatar,
          event_type: 'login',
          user_agent: req.headers['user-agent'] || null,
          ip_address: req.ip || null,
        });
      } catch (analyticsErr) {
        console.error('[Analytics] Failed to log login:', analyticsErr);
      }

      res.redirect('/');
    } catch (err) {
      console.error('[OAuth2] Error:', err);
      res.redirect('/?error=auth_failed');
    }
  });

  // Get current user info
  app.get('/api/me', authMiddleware, (req, res) => {
    res.json(req.user);
  });

  // Logout
  app.get('/auth/logout', (req, res) => {
    res.clearCookie('fk_token');
    res.redirect('/');
  });

  // ─── API Routes ───

  // Get channels for a guild (text channels the bot can post to)
  app.get('/api/guilds/:guildId/channels', authMiddleware, async (req, res) => {
    try {
      const guild = discordClient?.guilds.cache.get(req.params.guildId);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });

      // Verify user is in this guild
      const userGuild = req.user.guilds.find(g => g.id === req.params.guildId);
      if (!userGuild) return res.status(403).json({ error: 'Not in this guild' });

      const channels = guild.channels.cache
        .filter(c => c.isTextBased() && !c.isThread() && !c.isVoiceBased())
        .map(c => ({ id: c.id, name: c.name, category: c.parent?.name || null }))
        .sort((a, b) => a.name.localeCompare(b.name));

      res.json(channels);
    } catch (err) {
      console.error('[API] Channels error:', err);
      res.status(500).json({ error: 'Failed to fetch channels' });
    }
  });

  // Get user's roles/permissions in a guild
  app.get('/api/guilds/:guildId/roles', authMiddleware, async (req, res) => {
    try {
      const { guildId } = req.params;
      const userGuild = req.user.guilds.find(g => g.id === guildId);
      if (!userGuild) return res.status(403).json({ error: 'Not in this guild' });

      const guild = discordClient?.guilds.cache.get(guildId);
      if (!guild) return res.json({ roles: [], isAdmin: false, canWhale: false });

      try {
        const member = await fetchMember(guild, req.user.discordId);
        const roleNames = member.roles.cache
          .filter(r => r.name !== '@everyone')
          .map(r => r.name);
        const roleNamesLower = roleNames.map(r => r.toLowerCase());
        const hasAdmin = member.permissions.has('Administrator') || ADMIN_ROLES.some(r => roleNamesLower.includes(r));
        const hasWhale = member.permissions.has('Administrator') || WHALE_ROLES.some(r => roleNamesLower.includes(r));

        res.json({ roles: roleNames, isAdmin: hasAdmin, canWhale: hasWhale });
      } catch (e) {
        res.json({ roles: [], isAdmin: false, canWhale: false });
      }
    } catch (err) {
      console.error('[API] Roles error:', err);
      res.status(500).json({ error: 'Failed to fetch roles' });
    }
  });

  // Get guild members (admin only) for user picker
  app.get('/api/guilds/:guildId/members', authMiddleware, async (req, res) => {
    try {
      const { guildId } = req.params;
      const userGuild = req.user.guilds.find(g => g.id === guildId);
      if (!userGuild) return res.status(403).json({ error: 'Not in this guild' });

      const admin = await isAdminInGuild(guildId, req.user.discordId);
      if (!admin) return res.status(403).json({ error: 'Admin only' });

      const guild = discordClient?.guilds.cache.get(guildId);
      if (!guild) return res.json([]);

      // Use cache (populated by GuildMembers intent) instead of fetching all from API
      const members = guild.members.cache;
      const memberList = members
        .filter(m => !m.user.bot)
        .map(m => ({
          id: m.id,
          displayName: m.displayName,
          username: m.user.username,
          avatar: m.user.displayAvatarURL({ size: 64 }),
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));

      res.json(memberList);
    } catch (err) {
      console.error('[API] Members error:', err);
      res.status(500).json({ error: 'Failed to fetch members' });
    }
  });

  // Get server emojis
  app.get('/api/guilds/:guildId/emojis', authMiddleware, async (req, res) => {
    try {
      const { guildId } = req.params;
      const userGuild = req.user.guilds.find(g => g.id === guildId);
      if (!userGuild) return res.status(403).json({ error: 'Not in this guild' });

      const guild = discordClient?.guilds.cache.get(guildId);
      if (!guild) return res.json([]);

      const emojis = guild.emojis.cache.map(e => ({
        id: e.id,
        name: e.name,
        animated: e.animated,
        url: e.imageURL({ size: 32 }),
        formatted: e.animated ? `<a:${e.name}:${e.id}>` : `<:${e.name}:${e.id}>`,
      }));

      res.json(emojis);
    } catch (err) {
      console.error('[API] Emojis error:', err);
      res.status(500).json({ error: 'Failed to fetch emojis' });
    }
  });

  // ─── Stats Helper ───
  function calcStats(bets) {
    const total = bets.length;
    const open = bets.filter(b => b.status === 'open').length;
    const wins = bets.filter(b => b.status === 'win').length;
    const losses = bets.filter(b => b.status === 'loss').length;
    const pushes = bets.filter(b => b.status === 'push').length;
    const closed = bets.filter(b => ['win', 'loss', 'push'].includes(b.status));
    const winPct = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0;

    let netUnits = 0;
    let unitsWagered = 0;
    for (const b of closed) {
      unitsWagered += Number(b.units);
      if (b.status === 'win') {
        netUnits += b.odds_american >= 0
          ? b.units * (b.odds_american / 100)
          : b.units * (100 / Math.abs(b.odds_american));
      } else if (b.status === 'loss') {
        netUnits -= Number(b.units);
      }
    }

    const roi = unitsWagered > 0 ? Math.round((netUnits / unitsWagered) * 1000) / 10 : 0;
    return { total, open, wins, losses, pushes, winPct, netUnits: Math.round(netUnits * 100) / 100, unitsWagered: Math.round(unitsWagered * 100) / 100, roi };
  }

  function getDateRange(period) {
    const now = new Date();
    let start;
    switch (period) {
      case 'last24h': start = new Date(now.getTime() - 86400000); break;
      case 'today': start = new Date(now); start.setHours(0,0,0,0); break;
      case 'week': start = new Date(now); start.setDate(start.getDate() - start.getDay()); start.setHours(0,0,0,0); break;
      case 'month': start = new Date(now.getFullYear(), now.getMonth(), 1); break;
      case 'year': start = new Date(now.getFullYear(), 0, 1); break;
      default: return null;
    }
    return start.toISOString();
  }

  // ─── Stats API ───

  // Get stats for a user in a guild
  app.get('/api/guilds/:guildId/stats', authMiddleware, async (req, res) => {
    try {
      const { guildId } = req.params;
      const { period = 'all', userId } = req.query;
      // If userId is specified and it's not the current user, require admin
      let targetDiscordId = req.user.discordId;
      if (userId && userId !== req.user.discordId) {
        const admin = await isAdminInGuild(guildId, req.user.discordId);
        if (!admin) return res.status(403).json({ error: 'Only admins can view other users\' stats' });
        targetDiscordId = userId;
      }

      // Build query
      let query = supabase
        .from('bets')
        .select('*, parlay_legs(*)')
        .eq('discord_id', targetDiscordId)
        .eq('guild_id', guildId)
        .neq('status', 'void');

      const dateStart = getDateRange(period);
      if (dateStart) query = query.gte('created_at', dateStart);

      const { data: bets, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;

      // If user has no bets, check if they have tail stats
      if (!bets || bets.length === 0) {
        let tailStats = null;
        try { tailStats = await tailedBetsDb.getTailStatsInGuild(targetDiscordId, guildId); } catch (e) {}
        if (tailStats) {
          // Return tail-only stats
          return res.json({
            tailOnly: true,
            overview: { total: 0, open: 0, wins: 0, losses: 0, pushes: 0, winPct: 0, netUnits: 0, unitsWagered: 0, roi: 0 },
            tailStats,
          });
        }
        return res.json({ empty: true });
      }

      // Overview
      const overall = calcStats(bets);
      const singles = calcStats(bets.filter(b => b.bet_type === 'single'));
      const parlays = calcStats(bets.filter(b => b.bet_type === 'parlay'));

      // By sport
      const sportBreakdown = {};
      for (const bet of bets) {
        const sport = (bet.bet_type === 'parlay' && bet.parlay_legs?.length > 0)
          ? (bet.parlay_legs[0].sport || 'other') : (bet.sport || 'other');
        if (!sportBreakdown[sport]) sportBreakdown[sport] = [];
        sportBreakdown[sport].push(bet);
      }
      const bySport = Object.entries(sportBreakdown)
        .map(([sport, bets]) => ({ sport, name: SPORT_NAMES[sport] || sport, ...calcStats(bets) }))
        .sort((a, b) => b.total - a.total);

      // By wager type
      const wagerBreakdown = {};
      for (const bet of bets) {
        const wt = bet.bet_type === 'parlay' ? 'parlay' : (bet.wager_type || 'other');
        if (!wagerBreakdown[wt]) wagerBreakdown[wt] = [];
        wagerBreakdown[wt].push(bet);
      }
      const byWager = Object.entries(wagerBreakdown)
        .map(([w, bets]) => ({ wager: w, name: WAGER_TYPES[w] || (w === 'parlay' ? 'Parlay' : w), ...calcStats(bets) }))
        .sort((a, b) => b.total - a.total);

      // Whale bets
      const whaleBets = bets.filter(b => b.is_whale === true);
      const whaleStats = whaleBets.length > 0 ? calcStats(whaleBets) : null;
      const normalStats = calcStats(bets.filter(b => !b.is_whale));

      // Streak
      const closedBets = bets.filter(b => ['win', 'loss'].includes(b.status)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      let streak = 0;
      let streakType = '';
      if (closedBets.length > 0) {
        streakType = closedBets[0].status;
        for (const b of closedBets) {
          if (b.status === streakType) streak++;
          else break;
        }
      }

      // Best / worst bet
      let bestBet = null, worstBet = null;
      const closedAll = bets.filter(b => ['win', 'loss'].includes(b.status));
      for (const b of closedAll) {
        let payout = 0;
        if (b.status === 'win') {
          payout = b.odds_american >= 0
            ? b.units * (b.odds_american / 100)
            : b.units * (100 / Math.abs(b.odds_american));
        } else {
          payout = -b.units;
        }
        b._payout = Math.round(payout * 100) / 100;
        if (!bestBet || payout > bestBet._payout) bestBet = b;
        if (!worstBet || payout < worstBet._payout) worstBet = b;
      }

      // Daily P&L (last 30 days)
      const dailyPnL = {};
      for (const b of bets.filter(b => ['win', 'loss', 'push'].includes(b.status))) {
        const day = new Date(b.created_at).toISOString().split('T')[0];
        if (!dailyPnL[day]) dailyPnL[day] = { date: day, net: 0, bets: 0, wins: 0, losses: 0 };
        dailyPnL[day].bets++;
        if (b.status === 'win') {
          dailyPnL[day].wins++;
          dailyPnL[day].net += b.odds_american >= 0
            ? b.units * (b.odds_american / 100)
            : b.units * (100 / Math.abs(b.odds_american));
        } else if (b.status === 'loss') {
          dailyPnL[day].losses++;
          dailyPnL[day].net -= b.units;
        }
        dailyPnL[day].net = Math.round(dailyPnL[day].net * 100) / 100;
      }

      // Avg odds
      const allOdds = bets.filter(b => b.odds_american).map(b => b.odds_american);
      const avgOdds = allOdds.length > 0 ? Math.round(allOdds.reduce((a, b) => a + b, 0) / allOdds.length) : 0;

      // Avg units
      const allUnits = bets.map(b => Number(b.units));
      const avgUnits = allUnits.length > 0 ? Math.round((allUnits.reduce((a, b) => a + b, 0) / allUnits.length) * 100) / 100 : 0;

      // Tail stats (guild-scoped)
      let tailStats = null;
      try { tailStats = await tailedBetsDb.getTailStatsInGuild(targetDiscordId, guildId); } catch (e) {}

      // Recent bets (last 10)
      const recentBets = bets.slice(0, 10).map(b => ({
        id: b.id,
        slipNumber: b.slip_number,
        sport: SPORT_NAMES[b.sport] || b.sport,
        pick: b.pick,
        odds: b.odds_american,
        units: b.units,
        status: b.status,
        betType: b.bet_type,
        createdAt: b.created_at,
        isWhale: b.is_whale,
        legs: b.parlay_legs?.length || 0,
      }));

      res.json({
        overview: overall,
        singles,
        parlays,
        bySport,
        byWager,
        whaleStats,
        normalStats,
        streak: { count: streak, type: streakType },
        bestBet: bestBet ? { pick: bestBet.pick, payout: bestBet._payout, odds: bestBet.odds_american, units: bestBet.units, sport: SPORT_NAMES[bestBet.sport] || bestBet.sport } : null,
        worstBet: worstBet ? { pick: worstBet.pick, payout: worstBet._payout, odds: worstBet.odds_american, units: worstBet.units, sport: SPORT_NAMES[worstBet.sport] || worstBet.sport } : null,
        dailyPnL: Object.values(dailyPnL).sort((a, b) => a.date.localeCompare(b.date)),
        avgOdds,
        avgUnits,
        tailStats,
        recentBets,
        totalBets: bets.length,
      });
    } catch (err) {
      console.error('[API] Stats error:', err);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  // Get leaderboard for a guild
  app.get('/api/guilds/:guildId/leaderboard', authMiddleware, async (req, res) => {
    try {
      const { guildId } = req.params;

      // Verify user is in guild
      const userGuild = req.user.guilds.find(g => g.id === guildId);
      if (!userGuild) return res.status(403).json({ error: 'Not in this guild' });

      const leaderboard = await db.getLeaderboard(guildId, 25);

      // Resolve display names from guild
      const guild = discordClient?.guilds.cache.get(guildId);
      if (guild) {
        for (const entry of leaderboard) {
          try {
            const member = await fetchMember(guild, entry.discord_id);
            entry.discord_username = member.displayName;
          } catch (e) {}
        }
      }

      res.json(leaderboard);
    } catch (err) {
      console.error('[API] Leaderboard error:', err);
      res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
  });

  // Get list of users in a guild (for user picker)
  app.get('/api/guilds/:guildId/users', authMiddleware, async (req, res) => {
    try {
      const { guildId } = req.params;
      const userGuild = req.user.guilds.find(g => g.id === guildId);
      if (!userGuild) return res.status(403).json({ error: 'Not in this guild' });

      // Get unique discord IDs who have bets in this guild
      const { data, error } = await supabase
        .from('bets')
        .select('discord_id')
        .eq('guild_id', guildId);

      if (error) throw error;
      const betUserIds = [...new Set((data || []).map(b => b.discord_id))];

      // Also get tailers in this guild (users who tailed but may not have placed bets)
      let tailerIds = [];
      try {
        tailerIds = await tailedBetsDb.getTailersInGuild(guildId);
      } catch (e) {}

      // Merge unique IDs
      const uniqueIds = [...new Set([...betUserIds, ...tailerIds])];

      const guild = discordClient?.guilds.cache.get(guildId);
      const users = [];
      for (const id of uniqueIds) {
        let name = id;
        try {
          if (guild) {
            const member = await fetchMember(guild, id);
            name = member.displayName;
          }
        } catch (e) {}
        users.push({ id, name });
      }
      users.sort((a, b) => a.name.localeCompare(b.name));

      res.json(users);
    } catch (err) {
      console.error('[API] Users error:', err);
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  });

  // ─── My Bets API ───

  // Get bets user is tailing in a guild
  app.get('/api/guilds/:guildId/tailed-bets', authMiddleware, async (req, res) => {
    try {
      const { guildId } = req.params;
      const { status } = req.query;
      const userGuild = req.user.guilds.find(g => g.id === guildId);
      if (!userGuild) return res.status(403).json({ error: 'Not in this guild' });

      // Get all tailed_bets rows for this user in this guild
      const { data: tailRows, error: tailErr } = await supabase
        .from('tailed_bets')
        .select('*, bets!inner(*, parlay_legs(*))')
        .eq('tailer_discord_id', req.user.discordId)
        .eq('tailed', true)
        .eq('bets.guild_id', guildId);

      if (tailErr) throw tailErr;
      if (!tailRows || tailRows.length === 0) return res.json([]);

      // Extract the bet objects, sorted newest first
      let bets = tailRows.map(t => t.bets).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      // Filter by status if requested
      if (status && status !== 'all') {
        bets = bets.filter(b => b.status === status);
      }

      // Resolve display names for bet owners
      const guild = discordClient?.guilds.cache.get(guildId);
      const nameCache = {};
      for (const bet of bets) {
        if (!nameCache[bet.discord_id]) {
          try {
            if (guild) {
              const member = await fetchMember(guild, bet.discord_id);
              nameCache[bet.discord_id] = member.displayName;
            }
          } catch (e) {}
          if (!nameCache[bet.discord_id]) nameCache[bet.discord_id] = bet.discord_id;
        }
      }

      res.json(bets.map(b => formatBetForApi(b, nameCache[b.discord_id])));
    } catch (err) {
      console.error('[API] Tailed bets error:', err);
      res.status(500).json({ error: 'Failed to fetch tailed bets' });
    }
  });

  // Get bets for a user (filterable) — admins can view all or specific users
  app.get('/api/guilds/:guildId/bets', authMiddleware, async (req, res) => {
    try {
      const { guildId } = req.params;
      const { status, sport, team, search, minUnits, maxUnits, limit = 50, userId, slip, viewAll } = req.query;

      // If viewAll=true, admin can see all bets in guild; if userId set, see that user
      let targetId = req.user.discordId;
      if (viewAll === 'true' || userId) {
        const admin = await isAdminInGuild(guildId, req.user.discordId);
        if (admin) {
          targetId = userId || null; // null = all users
        }
      }

      const userGuild = req.user.guilds.find(g => g.id === guildId);
      if (!userGuild) return res.status(403).json({ error: 'Not in this guild' });

      // Slip lookup
      if (slip) {
        const bet = await db.getBetBySlip(slip, guildId);
        if (!bet) return res.json([]);
        return res.json([formatBetForApi(bet)]);
      }

      const bets = await db.getAllBetsInGuild(guildId, {
        status: status === 'all' ? undefined : status,
        discordId: targetId,
        sport,
        team: team || search,
        minUnits: minUnits ? parseFloat(minUnits) : undefined,
        maxUnits: maxUnits ? parseFloat(maxUnits) : undefined,
        limit: parseInt(limit),
      });

      // Resolve display names
      const guild = discordClient?.guilds.cache.get(guildId);
      const nameCache = {};
      for (const bet of bets) {
        if (!nameCache[bet.discord_id]) {
          try {
            if (guild) {
              const member = await fetchMember(guild, bet.discord_id);
              nameCache[bet.discord_id] = member.displayName;
            }
          } catch (e) {}
          if (!nameCache[bet.discord_id]) nameCache[bet.discord_id] = bet.discord_id;
        }
      }

      res.json(bets.map(b => formatBetForApi(b, nameCache[b.discord_id])));
    } catch (err) {
      console.error('[API] Bets error:', err);
      res.status(500).json({ error: 'Failed to fetch bets' });
    }
  });

  function formatBetForApi(bet, displayName) {
    return {
      id: bet.id,
      slipNumber: bet.slip_number,
      discordId: bet.discord_id,
      displayName: displayName || bet.discord_id,
      betType: bet.bet_type,
      sport: bet.sport,
      sportName: SPORT_NAMES[bet.sport] || bet.sport,
      betCategory: bet.bet_category,
      wagerType: bet.wager_type,
      teamA: bet.team_a,
      teamB: bet.team_b,
      playerName: bet.player_name,
      propDescription: bet.prop_description,
      pick: bet.pick,
      oddsAmerican: bet.odds_american,
      units: bet.units,
      status: bet.status,
      betNote: bet.bet_note,
      eventStartTime: bet.event_start_time,
      isWhale: bet.is_whale,
      isRetro: bet.is_retro,
      createdAt: bet.created_at,
      messageId: bet.message_id,
      channelId: bet.channel_id,
      legs: (bet.parlay_legs || []).map(l => ({
        id: l.id,
        legNumber: l.leg_number,
        sport: l.sport,
        sportName: SPORT_NAMES[l.sport] || l.sport,
        teamA: l.team_a,
        teamB: l.team_b,
        pick: l.pick,
        wagerType: l.wager_type,
        status: l.status,
        eventStartTime: l.event_start_time,
      })),
    };
  }

  // Close a single parlay leg
  app.post('/api/bets/:betId/legs/:legId/close', authMiddleware, async (req, res) => {
    try {
      const { betId, legId } = req.params;
      const { status } = req.body;

      if (!['win', 'loss', 'push', 'void'].includes(status)) {
        return res.status(400).json({ error: 'Status must be win, loss, push, or void' });
      }

      const bet = await db.getBet(betId);
      if (!bet) return res.status(404).json({ error: 'Bet not found' });

      // Allow admins to close others' legs
      const isOwner = bet.discord_id === req.user.discordId;
      const admin = await isAdminInGuild(bet.guild_id, req.user.discordId);
      if (!isOwner && !admin) return res.status(403).json({ error: 'Not your bet' });
      if (bet.bet_type !== 'parlay') return res.status(400).json({ error: 'Not a parlay' });

      const leg = (bet.parlay_legs || []).find(l => l.id === legId);
      if (!leg) return res.status(404).json({ error: 'Leg not found' });
      if (leg.status !== 'open') return res.status(400).json({ error: 'Leg is already closed' });

      await db.updateParlayLegStatus(legId, status);

      // Update Discord message with new leg statuses
      if (bet.message_id && bet.channel_id) {
        try {
          const channel = await discordClient.channels.fetch(bet.channel_id);
          const message = await channel.messages.fetch(bet.message_id);
          const updatedBet = await db.getBet(betId);
          const embedFn = bet.is_whale ? buildWhaleBetEmbed : buildBetEmbed;
          const embed = embedFn(updatedBet, null, null);
          await message.edit({ embeds: [embed] });
        } catch (e) {}
      }

      res.json({ success: true });
    } catch (err) {
      console.error('[API] Close leg error:', err);
      res.status(500).json({ error: 'Failed to close leg' });
    }
  });

  // Close a bet
  app.post('/api/bets/:betId/close', authMiddleware, async (req, res) => {
    try {
      const { betId } = req.params;
      const { status, resultNote } = req.body; // status: 'win', 'loss', 'push'

      if (!['win', 'loss', 'push'].includes(status)) {
        return res.status(400).json({ error: 'Status must be win, loss, or push' });
      }

      const bet = await db.getBet(betId);
      if (!bet) return res.status(404).json({ error: 'Bet not found' });

      // Allow admins to close others' bets
      const isOwner = bet.discord_id === req.user.discordId;
      const admin = await isAdminInGuild(bet.guild_id, req.user.discordId);
      if (!isOwner && !admin) return res.status(403).json({ error: 'Not your bet' });
      if (bet.status !== 'open') return res.status(400).json({ error: 'Bet is already closed' });

      await db.closeBet(betId, status, resultNote || null);

      // Close all parlay legs too if parlay
      if (bet.bet_type === 'parlay' && bet.parlay_legs) {
        for (const leg of bet.parlay_legs) {
          if (leg.status === 'open') {
            await db.updateParlayLegStatus(leg.id, status);
          }
        }
      }

      // Update Discord message
      if (bet.message_id && bet.channel_id) {
        try {
          const channel = await discordClient.channels.fetch(bet.channel_id);
          const message = await channel.messages.fetch(bet.message_id);
          const updatedBet = await db.getBet(betId);
          const embed = buildBetEmbed(updatedBet, null, null);
          await message.edit({ embeds: [embed], components: [] });
        } catch (e) {}
      }

      res.json({ success: true });
    } catch (err) {
      console.error('[API] Close bet error:', err);
      res.status(500).json({ error: 'Failed to close bet' });
    }
  });

  // Edit a bet
  app.patch('/api/bets/:betId', authMiddleware, async (req, res) => {
    try {
      const { betId } = req.params;
      const { oddsAmerican, units, pick, betNote } = req.body;

      const bet = await db.getBet(betId);
      if (!bet) return res.status(404).json({ error: 'Bet not found' });

      // Allow admins to edit others' bets
      const isOwner = bet.discord_id === req.user.discordId;
      const admin = await isAdminInGuild(bet.guild_id, req.user.discordId);
      if (!isOwner && !admin) return res.status(403).json({ error: 'Not your bet' });

      const fields = {};
      if (oddsAmerican !== undefined) fields.odds_american = parseInt(oddsAmerican);
      if (units !== undefined) fields.units = parseFloat(units);
      if (pick !== undefined) fields.pick = pick;
      if (betNote !== undefined) fields.bet_note = betNote;

      if (Object.keys(fields).length === 0) return res.status(400).json({ error: 'No fields to update' });

      await db.updateBetFields(betId, fields);

      // Update Discord message
      const updatedBet = await db.getBet(betId);
      if (updatedBet.message_id && updatedBet.channel_id) {
        try {
          const channel = await discordClient.channels.fetch(updatedBet.channel_id);
          const message = await channel.messages.fetch(updatedBet.message_id);
          const embed = buildBetEmbed(updatedBet, null, null);
          await message.edit({ embeds: [embed] });
        } catch (e) {}
      }

      res.json({ success: true, bet: formatBetForApi(updatedBet) });
    } catch (err) {
      console.error('[API] Edit bet error:', err);
      res.status(500).json({ error: 'Failed to edit bet' });
    }
  });

  // Delete a bet
  app.delete('/api/bets/:betId', authMiddleware, async (req, res) => {
    try {
      const { betId } = req.params;

      const bet = await db.getBet(betId);
      if (!bet) return res.status(404).json({ error: 'Bet not found' });

      // Allow admins to delete others' bets
      const isOwner = bet.discord_id === req.user.discordId;
      const admin = await isAdminInGuild(bet.guild_id, req.user.discordId);
      if (!isOwner && !admin) return res.status(403).json({ error: 'Not your bet' });

      // Delete Discord message
      if (bet.message_id && bet.channel_id) {
        try {
          const channel = await discordClient.channels.fetch(bet.channel_id);
          const message = await channel.messages.fetch(bet.message_id);
          await message.delete();
        } catch (e) {}
      }

      await db.deleteBet(betId, req.user.discordId, admin);
      res.json({ success: true });
    } catch (err) {
      console.error('[API] Delete bet error:', err);
      res.status(500).json({ error: 'Failed to delete bet' });
    }
  });

  // ─── Reminders API ───

  app.get('/api/guilds/:guildId/reminders', authMiddleware, async (req, res) => {
    try {
      const { guildId } = req.params;
      const userGuild = req.user.guilds.find(g => g.id === guildId);
      if (!userGuild) return res.status(403).json({ error: 'Not in this guild' });

      const reminders = await remindersDb.getActiveReminders(guildId, 50);

      // Get channel names
      const guild = discordClient?.guilds.cache.get(guildId);
      const result = reminders.map(r => ({
        id: r.id,
        type: r.type,
        message: r.message,
        channelId: r.channel_id,
        channelName: guild?.channels.cache.get(r.channel_id)?.name || r.channel_id,
        scheduledAt: r.scheduled_at,
        repeat: r.repeat,
        creatorId: r.creator_discord_id,
      }));

      res.json(result);
    } catch (err) {
      console.error('[API] Reminders list error:', err);
      res.status(500).json({ error: 'Failed to fetch reminders' });
    }
  });

  app.post('/api/guilds/:guildId/reminders', authMiddleware, postLimiter, async (req, res) => {
    try {
      const { guildId } = req.params;

      // Admin-only check
      const admin = await isAdminInGuild(guildId, req.user.discordId);
      if (!admin) return res.status(403).json({ error: 'Only admins can create reminders' });

      const { type, message, scheduledAt, channelId, repeat } = req.body;

      if (!type || !message || !scheduledAt || !channelId) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const schedDate = new Date(scheduledAt);
      if (isNaN(schedDate.getTime()) || schedDate.getTime() <= Date.now()) {
        return res.status(400).json({ error: 'Schedule time must be in the future' });
      }

      const reminder = await remindersDb.createReminder({
        guildId,
        channelId,
        creatorId: req.user.discordId,
        type,
        message,
        scheduledAt: schedDate.toISOString(),
        repeat: repeat || 'none',
      });

      res.json({ success: true, reminder });
    } catch (err) {
      console.error('[API] Create reminder error:', err);
      res.status(500).json({ error: 'Failed to create reminder' });
    }
  });

  app.delete('/api/guilds/:guildId/reminders/:reminderId', authMiddleware, async (req, res) => {
    try {
      const { guildId, reminderId } = req.params;

      // Admin-only check
      const admin = await isAdminInGuild(guildId, req.user.discordId);
      if (!admin) return res.status(403).json({ error: 'Only admins can cancel reminders' });

      // Exact ID match only (no partial matching to prevent unintended deletions)
      const reminders = await remindersDb.getActiveReminders(guildId, 100);
      const match = reminders.find(r => r.id === reminderId);

      if (!match) return res.status(404).json({ error: 'Reminder not found' });

      await remindersDb.deleteReminder(match.id, guildId);
      res.json({ success: true });
    } catch (err) {
      console.error('[API] Delete reminder error:', err);
      res.status(500).json({ error: 'Failed to delete reminder' });
    }
  });

  // Edit a reminder
  app.patch('/api/guilds/:guildId/reminders/:reminderId', authMiddleware, async (req, res) => {
    try {
      const { guildId, reminderId } = req.params;

      // Admin-only check
      const admin = await isAdminInGuild(guildId, req.user.discordId);
      if (!admin) return res.status(403).json({ error: 'Only admins can edit reminders' });

      const { type, message, scheduledAt, channelId, repeat } = req.body;

      const fields = {};
      if (type) fields.type = type;
      if (message) fields.message = message;
      if (scheduledAt) {
        const schedDate = new Date(scheduledAt);
        if (isNaN(schedDate.getTime())) return res.status(400).json({ error: 'Invalid schedule time' });
        fields.scheduledAt = schedDate.toISOString();
      }
      if (channelId) fields.channelId = channelId;
      if (repeat) fields.repeat = repeat;

      const updated = await remindersDb.updateReminder(reminderId, guildId, fields);
      if (!updated) return res.status(400).json({ error: 'No changes provided' });

      res.json({ success: true, reminder: updated });
    } catch (err) {
      console.error('[API] Edit reminder error:', err);
      res.status(500).json({ error: 'Failed to edit reminder' });
    }
  });

  // ─── Announce / DM API ───

  // Send DM to one user or all members (admin only)
  app.post('/api/announce', authMiddleware, postLimiter, async (req, res) => {
    try {
      const { guildId, message, link, targetUserId } = req.body;
      if (!guildId || !message) {
        return res.status(400).json({ error: 'Guild and message are required' });
      }

      // Admin check for this guild
      const admin = await isAdminInGuild(guildId, req.user.discordId);
      if (!admin) return res.status(403).json({ error: 'Admin only' });

      const guild = discordClient?.guilds.cache.get(guildId);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });

      // Build embed
      const { EmbedBuilder } = require('discord.js');
      const embed = new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle('👑 TheGamblingKing')
        .setDescription(message.slice(0, 2000))
        .setThumbnail('https://thegamblingkingapp.com/TheGamblingKing.jpg')
        .setTimestamp()
        .setFooter({ text: 'TheGamblingKing • thegamblingkingapp.com' });

      if (link) {
        embed.addFields({ name: '🔗 Link', value: link.slice(0, 500) });
      }

      if (targetUserId && targetUserId !== 'all') {
        // Single user
        try {
          const member = await fetchMember(guild, targetUserId);
          const dm = await member.createDM();
          await dm.send({ embeds: [embed] });
          return res.json({ success: true, sent: 1, failed: 0 });
        } catch (err) {
          return res.json({ success: false, sent: 0, failed: 1, error: 'Could not DM user — DMs may be disabled' });
        }
      } else {
        // All members — run async, respond immediately
        const members = await guild.members.fetch();
        const nonBots = members.filter(m => !m.user.bot);

        let sent = 0;
        let failed = 0;

        // Send response immediately with count
        res.json({ success: true, sending: true, totalMembers: nonBots.size });

        // Send DMs in background
        for (const [, member] of nonBots) {
          try {
            const dm = await member.createDM();
            await dm.send({ embeds: [embed] });
            sent++;
          } catch (err) {
            failed++;
          }
          // Rate limit delay
          await new Promise(r => setTimeout(r, 500));
        }
        console.log(`[Announce] Sent: ${sent}, Failed: ${failed}`);
      }
    } catch (err) {
      console.error('[API] Announce error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to send announcement' });
      }
    }
  });

  // Preview endpoint — returns the embed as JSON for preview rendering
  app.post('/api/announce/preview', authMiddleware, async (req, res) => {
    const { guildId } = req.body;
    if (guildId) {
      const admin = await isAdminInGuild(guildId, req.user.discordId);
      if (!admin) return res.status(403).json({ error: 'Admin only' });
    }
    const { message, link } = req.body;
    res.json({
      title: '👑 TheGamblingKing',
      description: (message || '').slice(0, 2000),
      link: link || null,
      color: '#FFD700',
      thumbnail: 'https://thegamblingkingapp.com/TheGamblingKing.jpg',
      footer: 'TheGamblingKing • thegamblingkingapp.com',
      timestamp: new Date().toISOString(),
    });
  });

  // ─── Analytics API ───

  // Get welcome message settings for a guild
  app.get('/api/guilds/:guildId/welcome', authMiddleware, async (req, res) => {
    try {
      const admin = await isAdminInGuild(req.params.guildId, req.user.discordId);
      if (!admin) return res.status(403).json({ error: 'Admin only' });

      const { data } = await supabase
        .from('guild_settings')
        .select('*')
        .eq('guild_id', req.params.guildId)
        .single();

      const defaults = {
        welcome_enabled: true,
        welcome_message: {
          title: '👑 Welcome to TheGamblingKing!',
          description: 'Hey **{user}**, welcome to the server! Here\'s everything you need to get started:',
          fields: [
            { name: '🎰 Place Bets', value: 'Use `/enterbet` in any channel or visit the web app to submit your picks with our sleek bet slip.' },
            { name: '🔗 Tail Bets', value: 'When someone posts a pick, hit **Yes** or **No** on the poll to tail or fade their bet.' },
            { name: '🏆 Leaderboards', value: 'Use `/leaderboard` to see who\'s on top, or check the web dashboard for full stats.' },
            { name: '📊 Your Stats', value: 'Use `/mystats` to see your record, ROI, streaks, and more.' },
            { name: '🌐 Web Dashboard', value: '**[thegamblingkingapp.com](https://thegamblingkingapp.com)**\\nLog in with Discord to place bets, view stats, set reminders, and more — all from your browser or phone.' },
            { name: '📱 Get the App', value: 'Visit the web dashboard and tap **📱 App** in the nav to install it on your phone for instant access.' },
          ],
        },
      };

      res.json(data || defaults);
    } catch (err) {
      console.error('[API] Welcome settings error:', err);
      res.status(500).json({ error: 'Failed to load welcome settings' });
    }
  });

  // Update welcome message settings
  app.put('/api/guilds/:guildId/welcome', authMiddleware, postLimiter, async (req, res) => {
    try {
      const admin = await isAdminInGuild(req.params.guildId, req.user.discordId);
      if (!admin) return res.status(403).json({ error: 'Admin only' });

      const { welcome_enabled, welcome_message } = req.body;

      // Validate
      if (welcome_message) {
        if (welcome_message.title && welcome_message.title.length > 256) {
          return res.status(400).json({ error: 'Title too long (max 256)' });
        }
        if (welcome_message.description && welcome_message.description.length > 2000) {
          return res.status(400).json({ error: 'Description too long (max 2000)' });
        }
        if (welcome_message.fields && welcome_message.fields.length > 10) {
          return res.status(400).json({ error: 'Too many fields (max 10)' });
        }
      }

      const { error } = await supabase
        .from('guild_settings')
        .upsert({
          guild_id: req.params.guildId,
          welcome_enabled: welcome_enabled !== false,
          welcome_message: welcome_message || {},
          updated_at: new Date().toISOString(),
        }, { onConflict: 'guild_id' });

      if (error) throw error;
      res.json({ success: true });
    } catch (err) {
      console.error('[API] Update welcome error:', err);
      res.status(500).json({ error: 'Failed to update welcome settings' });
    }
  });

  // Send test welcome DM to yourself
  app.post('/api/guilds/:guildId/welcome/test', authMiddleware, postLimiter, async (req, res) => {
    try {
      const admin = await isAdminInGuild(req.params.guildId, req.user.discordId);
      if (!admin) return res.status(403).json({ error: 'Admin only' });

      const { welcome_message } = req.body;
      const wm = welcome_message || {};

      const guild = discordClient?.guilds.cache.get(req.params.guildId);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });

      const member = await fetchMember(guild, req.user.discordId);
      const title = wm.title || '👑 Welcome to TheGamblingKing!';
      const description = (wm.description || 'Hey **{user}**, welcome to the server!')
        .replace('{user}', member.displayName);

      const dm = await member.createDM();
      await dm.send({
        embeds: [{
          color: 0xf5c518,
          title,
          description,
          fields: wm.fields || [],
          thumbnail: { url: 'https://thegamblingkingapp.com/TheGamblingKing.jpg' },
          footer: { text: 'TheGamblingKing • Good luck out there 🎲' },
        }],
      });

      res.json({ success: true });
    } catch (err) {
      console.error('[API] Test welcome error:', err);
      res.status(500).json({ error: 'Failed to send test DM — DMs may be disabled' });
    }
  });

  // Log PWA install event
  app.post('/api/analytics/pwa-install', authMiddleware, postLimiter, async (req, res) => {
    try {
      await supabase.from('web_analytics').insert({
        discord_id: req.user.discordId,
        discord_username: req.user.username,
        display_name: req.user.displayName,
        avatar: req.user.avatar,
        event_type: 'pwa_install',
        user_agent: req.headers['user-agent'] || null,
        ip_address: req.ip || null,
      });
      res.json({ success: true });
    } catch (err) {
      console.error('[Analytics] PWA install log error:', err);
      res.status(500).json({ error: 'Failed to log install' });
    }
  });

  // Get analytics data (site owner only)
  app.get('/api/analytics', authMiddleware, async (req, res) => {
    try {
      // Hardcoded owner check — only the site owner can view analytics
      if (req.user.discordId !== SITE_OWNER_ID) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Fetch all analytics events, most recent first
      const { data: events, error } = await supabase
        .from('web_analytics')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);

      if (error) throw error;

      // Build summary
      const uniqueLogins = new Map();
      const uniqueInstalls = new Map();
      (events || []).forEach(e => {
        if (e.event_type === 'login') {
          if (!uniqueLogins.has(e.discord_id)) {
            uniqueLogins.set(e.discord_id, e);
          }
        } else if (e.event_type === 'pwa_install') {
          if (!uniqueInstalls.has(e.discord_id)) {
            uniqueInstalls.set(e.discord_id, e);
          }
        }
      });

      res.json({
        totalLogins: events.filter(e => e.event_type === 'login').length,
        totalInstalls: events.filter(e => e.event_type === 'pwa_install').length,
        uniqueUsers: uniqueLogins.size,
        uniqueInstallers: uniqueInstalls.size,
        events,
      });
    } catch (err) {
      console.error('[API] Analytics error:', err);
      res.status(500).json({ error: 'Failed to fetch analytics' });
    }
  });

  // ─── Odds Converter API ───

  app.post('/api/convert-odds', authMiddleware, (req, res) => {
    const { format, odds } = req.body;
    const val = parseFloat(odds);
    if (isNaN(val)) return res.status(400).json({ error: 'Invalid odds value' });

    if (format === 'american') {
      const decimal = americanToDecimal(val);
      const impliedProb = val < 0
        ? Math.round((Math.abs(val) / (Math.abs(val) + 100)) * 1000) / 10
        : Math.round((100 / (val + 100)) * 1000) / 10;
      res.json({ american: formatOdds(val), decimal, impliedProbability: impliedProb });
    } else {
      const american = decimalToAmerican(val);
      const impliedProb = Math.round((1 / val) * 1000) / 10;
      res.json({ american: formatOdds(american), decimal: val, impliedProbability: impliedProb });
    }
  });

  // Submit a bet
  app.post('/api/bets', authMiddleware, postLimiter, async (req, res) => {
    try {
      const {
        guildId, channelId, betType, sport, betCategory, wagerType,
        teamA, teamB, pick, playerName, propDescription,
        futuresMarket, futuresSelection,
        spreadValue, oddsAmerican, units, betNote,
        eventStartTime, isWhale, overUnder,
        onBehalfOf, // admin placing bet for another user
        // Parlay fields
        legs,
      } = req.body;

      if (!guildId || !channelId || !betType || !sport) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // ─── Server-side input validation ───
      const MAX_LEN = 500;
      const truncate = (s, max = MAX_LEN) => (typeof s === 'string' ? s.slice(0, max) : s);
      const safePick = truncate(pick);
      const safeBetNote = truncate(betNote);
      const safeTeamA = truncate(teamA, 200);
      const safeTeamB = truncate(teamB, 200);
      const safePlayerName = truncate(playerName, 200);
      const safePropDesc = truncate(propDescription);
      const safeFuturesMarket = truncate(futuresMarket, 200);
      const safeFuturesSelection = truncate(futuresSelection, 200);

      // Validate numeric inputs
      const parsedUnits = parseFloat(units);
      const parsedOdds = parseInt(oddsAmerican);
      if (isNaN(parsedUnits) || parsedUnits <= 0 || parsedUnits > 10000) {
        return res.status(400).json({ error: 'Units must be between 0 and 10,000' });
      }
      if (isNaN(parsedOdds) || parsedOdds < -100000 || parsedOdds > 100000 || (parsedOdds > -100 && parsedOdds < 100 && parsedOdds !== 0)) {
        return res.status(400).json({ error: 'Invalid odds value' });
      }

      if (legs && legs.length > 25) {
        return res.status(400).json({ error: 'Maximum 25 parlay legs allowed' });
      }

      // Whale role check
      if (isWhale) {
        const whaleAllowed = await canPlaceWhale(guildId, req.user.discordId);
        if (!whaleAllowed) {
          return res.status(403).json({ error: 'Only Sharp, Admin, or The King roles can place whale bets' });
        }
      }

      // Determine target user (admin placing for someone else)
      let targetDiscordId = req.user.discordId;
      let targetUsername = req.user.username;
      let targetAvatar = req.user.avatar;
      let targetDisplayName = req.user.displayName;

      if (onBehalfOf && onBehalfOf !== req.user.discordId) {
        const admin = await isAdminInGuild(guildId, req.user.discordId);
        if (!admin) {
          return res.status(403).json({ error: 'Only admins can place bets for other users' });
        }
        targetDiscordId = onBehalfOf;

        const guild = discordClient?.guilds.cache.get(guildId);
        if (guild) {
          try {
            const member = await fetchMember(guild, onBehalfOf);
            targetUsername = member.user.username;
            targetAvatar = member.user.displayAvatarURL({ size: 128 });
            targetDisplayName = member.displayName || member.user.username;
          } catch (e) {}
        }
      }

      const oddsDecimal = parsedOdds ? americanToDecimal(parsedOdds) : null;

      // Get or create user in DB
      const discordUser = {
        id: targetDiscordId,
        username: targetUsername,
        displayAvatarURL: () => targetAvatar,
      };
      const user = await db.getOrCreateUser(discordUser);

      // Get display name from guild
      const guild = discordClient?.guilds.cache.get(guildId);
      let displayName = targetDisplayName;
      if (guild && !onBehalfOf) {
        try {
          const member = await fetchMember(guild, targetDiscordId);
          displayName = member.displayName || displayName;
        } catch (e) { /* use default */ }
      }

      if (betType === 'parlay' && legs?.length > 0) {
        // ── Parlay bet ──
        const bet = await db.createBet({
          user_id: user.id,
          discord_id: targetDiscordId,
          guild_id: guildId,
          channel_id: channelId,
          bet_type: 'parlay',
          odds_american: parsedOdds,
          odds_decimal: oddsDecimal,
          units: parsedUnits,
          bet_note: safeBetNote || null,
          is_whale: isWhale || false,
          is_retro: false,
          status: 'open',
        }, displayName);

        const legRecords = legs.map((leg, i) => {
          let legPick = truncate(leg.pick);
          if (leg.betCategory === 'futures') {
            legPick = `${truncate(leg.futuresMarket, 200)}: ${truncate(leg.futuresSelection, 200)}`;
          } else if (leg.betCategory === 'team_game') {
            if (leg.wagerType === 'moneyline') {
              legPick = `${truncate(leg.teamA, 200)} ML`;
            } else if (leg.wagerType === 'spread') {
              const sv = parseFloat(leg.spreadValue);
              legPick = `${truncate(leg.teamA, 200)} ${sv > 0 ? '+' : ''}${sv}`;
            } else if (leg.wagerType === 'total') {
              const sv = parseFloat(leg.spreadValue);
              legPick = `${leg.overUnder || 'Over'} ${Math.abs(sv)}`;
            }
          } else {
            legPick = truncate(leg.propDescription) || truncate(leg.pick);
          }

          return {
            bet_id: bet.id,
            leg_number: i + 1,
            sport: leg.sport,
            bet_category: leg.betCategory,
            team_a: truncate(leg.teamA, 200) || null,
            team_b: truncate(leg.teamB, 200) || null,
            player_name: truncate(leg.playerName, 200) || null,
            prop_description: truncate(leg.propDescription) || null,
            pick: legPick,
            wager_type: leg.wagerType,
            spread_value: leg.spreadValue ? parseFloat(leg.spreadValue) : null,
            odds_american: leg.oddsAmerican ? parseInt(leg.oddsAmerican) : null,
            odds_decimal: leg.oddsAmerican ? americanToDecimal(parseInt(leg.oddsAmerican)) : null,
            event_start_time: leg.eventStartTime || null,
            status: 'open',
          };
        });

        await db.createParlayLegs(legRecords);
        const fullBet = await db.getBet(bet.id);

        // Post to Discord
        const embed = isWhale
          ? buildWhaleBetEmbed(fullBet, displayName, req.user.avatar)
          : buildBetEmbed(fullBet, displayName, req.user.avatar);

        const channel = await discordClient.channels.fetch(channelId);
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

        const pollRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`tailbet_yes_${bet.id}`).setLabel('Yes').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`tailbet_no_${bet.id}`).setLabel('No').setStyle(ButtonStyle.Danger),
        );

        const whaleContent = '🚨🐋 **WHALE DICK ALERT** 🐋🚨\nAre You Tailing This Bet?';
        const message = await channel.send({
          embeds: [embed],
          components: [pollRow],
          content: isWhale ? whaleContent : 'Are You Tailing This Bet?',
        });
        await db.updateBetMessageId(bet.id, message.id);

        return res.json({ success: true, slipNumber: bet.slip_number, betId: bet.id });

      } else {
        // ── Single bet ──
        let finalPick = safePick;
        if (betCategory === 'futures') {
          finalPick = `${safeFuturesMarket}: ${safeFuturesSelection}`;
        } else if (betCategory === 'team_game') {
          if (wagerType === 'moneyline') {
            finalPick = `${safeTeamA} ML`;
          } else if (wagerType === 'spread') {
            const sv = parseFloat(spreadValue);
            finalPick = `${safeTeamA} ${sv > 0 ? '+' : ''}${sv}`;
          } else if (wagerType === 'total') {
            const sv = parseFloat(spreadValue);
            finalPick = `${overUnder || 'Over'} ${Math.abs(sv)}`;
          }
        } else {
          finalPick = safePropDesc || safePick;
        }

        const betData = {
          user_id: user.id,
          discord_id: targetDiscordId,
          guild_id: guildId,
          channel_id: channelId,
          bet_type: 'single',
          sport,
          bet_category: betCategory,
          team_a: safeTeamA || null,
          team_b: safeTeamB || null,
          player_name: safePlayerName || null,
          prop_description: safePropDesc || null,
          pick: finalPick,
          wager_type: wagerType,
          spread_value: spreadValue ? parseFloat(spreadValue) : null,
          odds_american: parsedOdds,
          odds_decimal: oddsDecimal,
          units: parsedUnits,
          bet_note: safeBetNote || null,
          event_start_time: eventStartTime || null,
          is_whale: isWhale || false,
          is_retro: false,
          status: 'open',
        };

        const bet = await db.createBet(betData, displayName);

        // Post to Discord
        const embed = isWhale
          ? buildWhaleBetEmbed(bet, displayName, req.user.avatar)
          : buildBetEmbed(bet, displayName, req.user.avatar);

        const channel = await discordClient.channels.fetch(channelId);
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

        const pollRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`tailbet_yes_${bet.id}`).setLabel('Yes').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`tailbet_no_${bet.id}`).setLabel('No').setStyle(ButtonStyle.Danger),
        );

        const whaleContent = '🚨🐋 **WHALE DICK ALERT** 🐋🚨\nAre You Tailing This Bet?';
        const message = await channel.send({
          embeds: [embed],
          components: [pollRow],
          content: isWhale ? whaleContent : 'Are You Tailing This Bet?',
        });
        await db.updateBetMessageId(bet.id, message.id);

        return res.json({ success: true, slipNumber: bet.slip_number, betId: bet.id });
      }
    } catch (err) {
      console.error('[API] Submit bet error:', err);
      res.status(500).json({ error: 'Failed to save bet' });
    }
  });

  // Fallback — serve index.html for SPA
  app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  return app;
}

module.exports = { createWebServer, setDiscordClient };
