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
const scoreboardDb = require('../database/scoreboards');
const { americanToDecimal, decimalToAmerican, formatOdds } = require('../utils/odds');
const { SPORT_NAMES, WAGER_TYPES, STATUS_EMOJI } = require('../config/constants');
const { buildBetEmbed } = require('../utils/embeds');
const { generateBetCardImage } = require('../utils/betCardImage');
const { generateScoreboardImage } = require('../utils/scoreboardImage');
const espn = require('../services/espn');
const nbaProps = require('../services/nbaProps');
const nbaGamePicks = require('../services/nbaGamePicks');
const propPicksDb = require('../database/propPicks');
const gamePicksDb = require('../database/gamePicksDb');
const remindersDb = require('../database/reminders');
const { notifyFollowers } = require('../utils/notifications');

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

// Open bets mirror channels
const KING_DISCORD_ID = '1246525685749649441';
const KING_OPEN_CHANNEL = '1477318450618695692';
const COMMUNITY_OPEN_CHANNEL = '1477318238273802480';

// Helper: build message content with optional share link
function buildContentWithLink(baseContent, shareLink) {
  if (!shareLink) return baseContent;
  return `${baseContent}\n\n🔗 **Copy this bet:** <${shareLink}>`;
}

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
  // Only admin or specific user ID can place whale bets
  if (discordId === '1246525685749649441') return true;
  try {
    const guild = discordClient?.guilds.cache.get(guildId);
    if (!guild) return false;
    const member = await fetchMember(guild, discordId);
    if (member.permissions.has('Administrator')) return true;
    return false;
  } catch (e) {
    return false;
  }
}

function createWebServer() {
  const app = express();

  // In-memory active users (heartbeat-based, no DB)
  const activeUsers = new Map();
  const HEARTBEAT_TIMEOUT = 60000; // 60s — offline if no ping

  // Global JSON parser – skip the share endpoint so its own larger parser handles it
  const globalJsonParser = express.json({ limit: '100kb' });
  app.use((req, res, next) => {
    if (req.path === '/api/share-to-discord' || req.path === '/api/ocr-slip') return next();
    globalJsonParser(req, res, next);
  });

  // Larger limit specifically for image share endpoint
  const imageJsonParser = express.json({ limit: '10mb' });
  app.use(cookieParser());

  // Trust nginx reverse proxy (needed for rate limiting behind proxy)
  app.set('trust proxy', 1);

  // ─── Security Headers (helmet) ───
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "https://cdn.discordapp.com", "https://media.giphy.com", "https://media0.giphy.com", "https://media1.giphy.com", "https://media2.giphy.com", "https://media3.giphy.com", "https://media4.giphy.com", "https://a.espncdn.com", "data:"],
        connectSrc: ["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
        frameSrc: ["'self'", "https://e.widgetbot.io", "https://widgetbot.io", "https://discord.com"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
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

  // Serve service-worker.js with no-cache so browser always checks for updates
  app.get('/service-worker.js', (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Service-Worker-Allowed', '/');
    res.sendFile(path.join(__dirname, 'public', 'service-worker.js'));
  });

  app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
      // Never let the browser serve stale JS/CSS/HTML
      if (filePath.endsWith('.js') || filePath.endsWith('.css') || filePath.endsWith('.html')) {
        res.set('Cache-Control', 'no-cache, must-revalidate');
      }
    }
  }));

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

  // Owner-only middleware (must follow authMiddleware)
  function ownerMiddleware(req, res, next) {
    if (req.user.discordId !== SITE_OWNER_ID) {
      return res.status(403).json({ error: 'Access denied' });
    }
    next();
  }

  // ─── OAuth2 Routes ───

  // Redirect to Discord OAuth2
  app.get('/auth/login', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('oauth_state', state, { httpOnly: true, maxAge: 300000, sameSite: 'lax', secure: BASE_URL.startsWith('https') });
    // Save redirect destination so callback can return user to the right page
    if (req.query.redirect) {
      res.cookie('oauth_redirect', req.query.redirect, { httpOnly: true, maxAge: 300000, sameSite: 'lax', secure: BASE_URL.startsWith('https') });
    }
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
        : `https://cdn.discordapp.com/embed/avatars/${(BigInt(userData.id) >> 22n) % 6n}.png`;

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

      // Redirect to saved destination or default to /
      const redirectTo = req.cookies.oauth_redirect || '/';
      res.clearCookie('oauth_redirect');
      res.redirect(redirectTo);
    } catch (err) {
      console.error('[OAuth2] Error:', err);
      res.redirect('/?error=auth_failed');
    }
  });

  // Get current user info
  app.get('/api/me', authMiddleware, async (req, res) => {
    const user = { ...req.user };
    // Refresh avatar from Discord bot cache if available
    if (discordClient) {
      try {
        const dUser = await discordClient.users.fetch(user.discordId).catch(() => null);
        if (dUser) {
          user.avatar = dUser.displayAvatarURL({ size: 128, extension: 'png', forceStatic: true });
        }
      } catch (e) {}
    }
    // Provide a proxied avatar URL so browsers don't cache stale CDN images
    user.avatarProxy = `/api/avatar/${user.discordId}`;
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json(user);
  });

  // Proxy avatar image through our server to avoid CDN cache issues
  app.get('/api/avatar/:discordId', async (req, res) => {
    try {
      let avatarUrl = null;
      if (discordClient) {
        const dUser = await discordClient.users.fetch(req.params.discordId).catch(() => null);
        if (dUser) {
          avatarUrl = dUser.displayAvatarURL({ size: 128, extension: 'png', forceStatic: true });
        }
      }
      if (!avatarUrl) {
        // Default Discord avatar
        const index = Number((BigInt(req.params.discordId) >> 22n) % 6n);
        avatarUrl = `https://cdn.discordapp.com/embed/avatars/${index}.png`;
      }
      const response = await fetch(avatarUrl);
      if (!response.ok) throw new Error('Failed to fetch avatar');
      res.set('Content-Type', response.headers.get('content-type') || 'image/png');
      res.set('Cache-Control', 'no-cache, must-revalidate');
      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
    } catch (e) {
      res.redirect(`https://cdn.discordapp.com/embed/avatars/0.png`);
    }
  });

  // Logout
  app.get('/auth/logout', (req, res) => {
    res.clearCookie('fk_token', { path: '/', sameSite: 'lax' });
    res.clearCookie('bracket_token', { path: '/', sameSite: 'lax' });
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

      // If ?sendable=1, only return channels where the bot can send messages
      if (req.query.sendable === '1') {
        const botMember = guild.members.me;
        const sendable = channels.filter(ch => {
          const dc = guild.channels.cache.get(ch.id);
          return dc && botMember && dc.permissionsFor(botMember)?.has(['SendMessages', 'EmbedLinks']);
        });
        return res.json(sendable);
      }

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
        const hasWhale = member.permissions.has('Administrator') || req.user.discordId === '1246525685749649441';

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

      // Fetch members using REST API (paginated, avoids gateway rate limits)
      const allMembers = [];
      let after = '0';
      while (true) {
        const batch = await guild.members.list({ limit: 1000, after });
        if (batch.size === 0) break;
        batch.forEach(m => allMembers.push(m));
        after = batch.lastKey();
        if (batch.size < 1000) break;
      }

      const memberList = allMembers
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

  // ─── Chat Channel ID (for Widgetbot embed) ───
  app.get('/api/guilds/:guildId/chat-channel', authMiddleware, async (req, res) => {
    try {
      const guild = discordClient?.guilds.cache.get(req.params.guildId);
      if (!guild) return res.json({ channelId: null });

      // Look for the preferred chat channel
      const preferred = ["the-king\u2019s-money-printer", "the-king's-money-printer", 'the-kings-money-printer', 'the-crackhouse', 'daily-action-chat', 'general'];
      const textChannels = guild.channels.cache.filter(c => c.isTextBased() && !c.isThread() && !c.isVoiceBased());

      for (const name of preferred) {
        const ch = textChannels.find(c => c.name === name);
        if (ch) return res.json({ channelId: ch.id, channelName: ch.name });
      }

      // Fallback to first text channel
      const first = textChannels.first();
      res.json({ channelId: first?.id || null, channelName: first?.name || null });
    } catch (err) {
      console.error('[API] Chat channel error:', err);
      res.json({ channelId: null });
    }
  });

  // ─── Online Members (excludes bots) ───
  app.get('/api/guilds/:guildId/online-members', authMiddleware, async (req, res) => {
    try {
      const guild = discordClient?.guilds.cache.get(req.params.guildId);
      if (!guild) return res.json({ members: [] });

      const members = guild.members.cache
        .filter(m => !m.user.bot && m.presence && m.presence.status !== 'offline')
        .map(m => ({
          discordId: m.user.id,
          displayName: m.displayName || m.user.username,
          status: m.presence.status,
          avatar: m.user.displayAvatarURL({ size: 32, extension: 'png', forceStatic: true }),
        }))
        .sort((a, b) => {
          const order = { online: 0, idle: 1, dnd: 2 };
          return (order[a.status] ?? 3) - (order[b.status] ?? 3);
        });

      res.json({ members });
    } catch (err) {
      console.error('[API] Online members error:', err);
      res.json({ members: [] });
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

  function addTeamStat(map, team, bet, legCount = 1) {
    if (!team || team.length < 2) return;
    const key = team.toUpperCase().trim();
    if (!map[key]) map[key] = { count: 0, wins: 0, losses: 0, netUnits: 0 };
    map[key].count++;
    if (bet.status === 'win') {
      map[key].wins++;
      const p = bet.odds_american >= 0 ? bet.units * (bet.odds_american / 100) : bet.units * (100 / Math.abs(bet.odds_american));
      map[key].netUnits += p / legCount;
    } else if (bet.status === 'loss') {
      map[key].losses++;
      map[key].netUnits -= Number(bet.units) / legCount;
    }
    map[key].netUnits = Math.round(map[key].netUnits * 100) / 100;
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

      // Avg odds (convert to decimal, average, convert back to American)
      const allOdds = bets.filter(b => b.odds_american).map(b => b.odds_american);
      let avgOdds = 0;
      if (allOdds.length > 0) {
        const decArr = allOdds.map(o => o >= 0 ? (o / 100) + 1 : (100 / Math.abs(o)) + 1);
        const avgDec = decArr.reduce((a, b) => a + b, 0) / decArr.length;
        avgOdds = avgDec >= 2 ? Math.round((avgDec - 1) * 100) : Math.round(-100 / (avgDec - 1));
      }

      // Avg units
      const allUnits = bets.map(b => Number(b.units));
      const avgUnits = allUnits.length > 0 ? Math.round((allUnits.reduce((a, b) => a + b, 0) / allUnits.length) * 100) / 100 : 0;

      // Tail stats (guild-scoped)
      let tailStats = null;
      try { tailStats = await tailedBetsDb.getTailStatsInGuild(targetDiscordId, guildId); } catch (e) {}

      // Recent bets (last 10) — full format for ticket rendering
      const recentBets = bets.slice(0, 10).map(b => formatBetForApi(b));

      res.json({
        overview: overall,
        singles,
        parlays,
        bySport,
        byWager,
        whaleStats,
        normalStats,
        streak: { count: streak, type: streakType },
        bestBet: bestBet ? { pick: bestBet.pick || (bestBet.bet_type === 'parlay' && bestBet.parlay_legs ? `${bestBet.parlay_legs.length}-Leg Parlay` : bestBet.slip_number || 'Bet'), payout: bestBet._payout, odds: bestBet.odds_american, units: bestBet.units, sport: SPORT_NAMES[bestBet.sport] || bestBet.sport } : null,
        worstBet: worstBet ? { pick: worstBet.pick || (worstBet.bet_type === 'parlay' && worstBet.parlay_legs ? `${worstBet.parlay_legs.length}-Leg Parlay` : worstBet.slip_number || 'Bet'), payout: worstBet._payout, odds: worstBet.odds_american, units: worstBet.units, sport: SPORT_NAMES[worstBet.sport] || worstBet.sport } : null,
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

  // ─── Profile API ───
  // Returns full profile data for any user (badges, streaks, top teams, etc.)
  app.get('/api/guilds/:guildId/profile/:discordId', authMiddleware, async (req, res) => {
    try {
      const { guildId, discordId } = req.params;

      // Fetch all bets
      const { data: bets, error: betsErr } = await supabase
        .from('bets')
        .select('*, parlay_legs(*)')
        .eq('discord_id', discordId)
        .eq('guild_id', guildId)
        .neq('status', 'void')
        .order('created_at', { ascending: false });

      if (betsErr) throw betsErr;

      if (!bets || bets.length === 0) {
        return res.json({ empty: true });
      }

      const overall = calcStats(bets);

      // Avg odds
      const allOdds = bets.filter(b => b.odds_american).map(b => b.odds_american);
      let avgOdds = 0;
      if (allOdds.length > 0) {
        const decArr = allOdds.map(o => o >= 0 ? (o / 100) + 1 : (100 / Math.abs(o)) + 1);
        const avgDec = decArr.reduce((a, b) => a + b, 0) / decArr.length;
        avgOdds = avgDec >= 2 ? Math.round((avgDec - 1) * 100) : Math.round(-100 / (avgDec - 1));
      }

      // By sport breakdown
      const sportBreakdown = {};
      for (const bet of bets) {
        const sport = (bet.bet_type === 'parlay' && bet.parlay_legs?.length > 0)
          ? (bet.parlay_legs[0].sport || 'other') : (bet.sport || 'other');
        if (!sportBreakdown[sport]) sportBreakdown[sport] = [];
        sportBreakdown[sport].push(bet);
      }
      const bySport = Object.entries(sportBreakdown)
        .map(([sport, sBets]) => ({ sport, name: SPORT_NAMES[sport] || sport, ...calcStats(sBets) }))
        .filter(s => (s.wins + s.losses) >= 2)
        .sort((a, b) => b.winPct - a.winPct);

      const bestSport = bySport.length > 0 ? { name: bySport[0].name, winPct: bySport[0].winPct, record: `${bySport[0].wins}-${bySport[0].losses}` } : { name: '—', winPct: 0, record: '' };
      const worstSport = bySport.length > 1 ? { name: bySport[bySport.length - 1].name, winPct: bySport[bySport.length - 1].winPct, record: `${bySport[bySport.length - 1].wins}-${bySport[bySport.length - 1].losses}` } : { name: '—', winPct: 0, record: '' };

      // Favorite bet type
      const wagerBreakdown = {};
      for (const bet of bets) {
        const wt = bet.bet_type === 'parlay' ? 'parlay' : (bet.wager_type || 'other');
        if (!wagerBreakdown[wt]) wagerBreakdown[wt] = 0;
        wagerBreakdown[wt]++;
      }
      const sortedWagers = Object.entries(wagerBreakdown).sort((a, b) => b[1] - a[1]);
      const favBetType = sortedWagers.length > 0
        ? { name: WAGER_TYPES[sortedWagers[0][0]] || (sortedWagers[0][0] === 'parlay' ? 'Parlay' : sortedWagers[0][0]), count: sortedWagers[0][1] }
        : { name: '—', count: 0 };

      // Streaks
      const closedBets = bets.filter(b => ['win', 'loss'].includes(b.status)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      let streakCount = 0, streakType = '';
      if (closedBets.length > 0) {
        streakType = closedBets[0].status;
        for (const b of closedBets) {
          if (b.status === streakType) streakCount++;
          else break;
        }
      }

      let bestWinStreak = 0, worstLossStreak = 0;
      let cw = 0, cl = 0;
      const chrono = [...closedBets].reverse();
      for (const b of chrono) {
        if (b.status === 'win') { cw++; cl = 0; if (cw > bestWinStreak) bestWinStreak = cw; }
        else if (b.status === 'loss') { cl++; cw = 0; if (cl > worstLossStreak) worstLossStreak = cl; }
      }

      // Biggest win
      let biggestWin = null;
      for (const b of bets.filter(b => b.status === 'win')) {
        const payout = b.odds_american >= 0
          ? b.units * (b.odds_american / 100)
          : b.units * (100 / Math.abs(b.odds_american));
        if (!biggestWin || payout > biggestWin.payout) {
          biggestWin = { payout: Math.round(payout * 100) / 100, pick: b.pick || (b.bet_type === 'parlay' && b.parlay_legs ? `${b.parlay_legs.length}-Leg Parlay` : b.slip_number || 'Bet') };
        }
      }

      // Top 5 teams (parlay legs included, units split proportionally)
      const teamMap = {};
      for (const bet of bets) {
        if (bet.bet_type === 'parlay' && bet.parlay_legs?.length > 0) {
          const legCount = bet.parlay_legs.length;
          for (const leg of bet.parlay_legs) { if (leg.team_a) addTeamStat(teamMap, leg.team_a, bet, legCount); }
        } else {
          if (bet.team_a) addTeamStat(teamMap, bet.team_a, bet, 1);
        }
      }
      const topTeams = Object.entries(teamMap)
        .filter(([, t]) => t.count >= 3)
        .map(([team, t]) => ({ team, count: t.count, wins: t.wins, losses: t.losses, record: `${t.wins}-${t.losses}`, netUnits: t.netUnits }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      // Badges (from Discord roles)
      let badges = [];
      if (discordClient) {
        try {
          const roleManagerMod = require('../services/roleManager');
          const guild = discordClient.guilds.cache.get(guildId);
          if (guild) {
            const member = await fetchMember(guild, discordId);
            badges = roleManagerMod.getUserRoleBadges(member);
          }
        } catch (e) {}
      }

      // Resolve display name and avatar
      let displayName = 'Unknown', avatar = null, memberSince = null;
      if (discordClient) {
        try {
          const guild = discordClient.guilds.cache.get(guildId);
          if (guild) {
            const member = await fetchMember(guild, discordId);
            displayName = member.displayName;
            avatar = member.user.displayAvatarURL({ size: 256, extension: 'png' });
            memberSince = member.joinedAt ? member.joinedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
          }
        } catch (e) {}
      }

      res.json({
        displayName,
        avatar,
        avatarProxy: `/api/avatar/${discordId}`,
        memberSince,
        badges,
        ...overall,
        avgOdds,
        bestSport,
        worstSport,
        favBetType,
        bySport,
        streak: { count: streakCount, type: streakType },
        bestStreak: { count: bestWinStreak },
        worstStreak: { count: worstLossStreak },
        biggestWin,
        topTeams,
      });
    } catch (err) {
      console.error('[API] Profile error:', err);
      res.status(500).json({ error: 'Failed to fetch profile' });
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

  // Full leaderboard with categories
  app.get('/api/guilds/:guildId/leaderboard/full', authMiddleware, async (req, res) => {
    try {
      const { guildId } = req.params;
      const userGuild = req.user.guilds.find(g => g.id === guildId);
      if (!userGuild) return res.status(403).json({ error: 'Not in this guild' });

      // Personal bets leaderboard
      const allBets = await db.getAllBetsInGuild(guildId, { limit: 10000 });
      const guild = discordClient?.guilds.cache.get(guildId);

      // Build per-user stats from bets
      const userMap = {};
      for (const b of allBets) {
        if (b.status === 'void' || b.status === 'open') continue;
        if (!userMap[b.discord_id]) {
          userMap[b.discord_id] = { discordId: b.discord_id, displayName: b.discord_id, wins: 0, losses: 0, pushes: 0, netUnits: 0, unitsWagered: 0, totalBets: 0 };
        }
        const u = userMap[b.discord_id];
        u.totalBets++;
        u.unitsWagered += Number(b.units) || 0;
        if (b.status === 'win') {
          u.wins++;
          const odds = Number(b.odds_american);
          u.netUnits += odds >= 0 ? (b.units * odds / 100) : (b.units * 100 / Math.abs(odds));
        } else if (b.status === 'loss') {
          u.losses++;
          u.netUnits -= Number(b.units);
        } else if (b.status === 'push') {
          u.pushes++;
        }
      }

      // Resolve display names
      for (const uid of Object.keys(userMap)) {
        try {
          if (guild) {
            const member = await fetchMember(guild, uid);
            userMap[uid].displayName = member.displayName;
          }
        } catch (e) {}
      }

      // Compute derived fields
      const users = Object.values(userMap).map(u => {
        u.netUnits = Math.round(u.netUnits * 100) / 100;
        u.unitsWagered = Math.round(u.unitsWagered * 100) / 100;
        const decided = u.wins + u.losses;
        u.winPct = decided > 0 ? Math.round((u.wins / decided) * 1000) / 10 : 0;
        u.roi = u.unitsWagered > 0 ? Math.round((u.netUnits / u.unitsWagered) * 1000) / 10 : 0;
        return u;
      }).filter(u => u.totalBets >= 1);

      // Tail leaderboard
      let tailUsers = [];
      try {
        const tailedBetsDb = require('../database/tailedBets');
        // Use the proper getTailersInGuild which joins through bets table
        const tailUserIds = await tailedBetsDb.getTailersInGuild(guildId);
        for (const tid of tailUserIds) {
          try {
            const ts = await tailedBetsDb.getTailStatsInGuild(tid, guildId);
            if (ts && ts.total_tails > 0) {
              let dname = tid;
              try {
                if (guild) { const m = await fetchMember(guild, tid); dname = m.displayName; }
              } catch (e) {}
              tailUsers.push({
                discordId: tid,
                displayName: dname,
                wins: ts.tail_wins,
                losses: ts.tail_losses,
                pushes: ts.tail_pushes,
                netUnits: ts.tail_net_units,
                unitsWagered: ts.tail_units_wagered,
                totalBets: ts.total_tails,
                winPct: ts.tail_win_pct,
                roi: ts.tail_roi,
              });
            }
          } catch (e) {}
        }
      } catch (e) {
        console.error('[API] Tail leaderboard error:', e.message);
      }

      // Whale 🐋 leaderboard (from bets with is_whale = true)
      const whaleMap = {};
      for (const b of allBets) {
        if (!b.is_whale || b.status === 'void' || b.status === 'open') continue;
        if (!whaleMap[b.discord_id]) {
          whaleMap[b.discord_id] = { discordId: b.discord_id, displayName: userMap[b.discord_id]?.displayName || b.discord_id, wins: 0, losses: 0, pushes: 0, netUnits: 0, unitsWagered: 0, totalBets: 0 };
        }
        const w = whaleMap[b.discord_id];
        w.totalBets++;
        w.unitsWagered += Number(b.units) || 0;
        if (b.status === 'win') {
          w.wins++;
          const odds = Number(b.odds_american);
          w.netUnits += odds >= 0 ? (b.units * odds / 100) : (b.units * 100 / Math.abs(odds));
        } else if (b.status === 'loss') {
          w.losses++;
          w.netUnits -= Number(b.units);
        } else if (b.status === 'push') {
          w.pushes++;
        }
      }
      const whaleUsers = Object.values(whaleMap).map(w => {
        w.netUnits = Math.round(w.netUnits * 100) / 100;
        w.unitsWagered = Math.round(w.unitsWagered * 100) / 100;
        const decided = w.wins + w.losses;
        w.winPct = decided > 0 ? Math.round((w.wins / decided) * 1000) / 10 : 0;
        w.roi = w.unitsWagered > 0 ? Math.round((w.netUnits / w.unitsWagered) * 1000) / 10 : 0;
        return w;
      }).filter(w => w.totalBets >= 1);

      res.json({ users, tailUsers, whaleUsers });
    } catch (err) {
      console.error('[API] Full leaderboard error:', err);
      res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
  });

  // ─── Follow / Unfollow ───
  const followsDb = require('../database/bettorFollows');

  // Toggle follow on a bettor
  app.post('/api/guilds/:guildId/follow', authMiddleware, async (req, res) => {
    try {
      const { guildId } = req.params;
      const { bettorDiscordId } = req.body;
      const followerDiscordId = req.user.discordId;

      if (!bettorDiscordId) return res.status(400).json({ error: 'Missing bettorDiscordId' });
      if (bettorDiscordId === followerDiscordId) return res.status(400).json({ error: 'Cannot follow yourself' });

      const userGuild = req.user.guilds.find(g => g.id === guildId);
      if (!userGuild) return res.status(403).json({ error: 'Not in this guild' });

      const result = await followsDb.toggleFollow(followerDiscordId, bettorDiscordId, guildId);
      res.json(result);
    } catch (err) {
      console.error('[API] Follow toggle error:', err);
      res.status(500).json({ error: 'Failed to toggle follow' });
    }
  });

  // Get who the current user follows in a guild (with display names)
  app.get('/api/guilds/:guildId/following', authMiddleware, async (req, res) => {
    try {
      const { guildId } = req.params;
      const userGuild = req.user.guilds.find(g => g.id === guildId);
      if (!userGuild) return res.status(403).json({ error: 'Not in this guild' });

      const following = await followsDb.getFollowing(req.user.discordId, guildId);
      const guild = discordClient?.guilds.cache.get(guildId);

      // Resolve display names + avatars
      const detailed = await Promise.all(following.map(async (f) => {
        let displayName = f.bettor_discord_id;
        let avatar = null;
        try {
          if (guild) {
            const member = await fetchMember(guild, f.bettor_discord_id);
            displayName = member.displayName || member.user.username;
            avatar = member.user.displayAvatarURL({ size: 64 });
          }
        } catch (e) {}
        return { discordId: f.bettor_discord_id, displayName, avatar };
      }));

      res.json({ following: detailed.map(d => d.discordId), details: detailed });
    } catch (err) {
      console.error('[API] Get following error:', err);
      res.status(500).json({ error: 'Failed to get following' });
    }
  });

  const GAMBLING_KING_ID = '1246525685749649441';

  // Get all guild members with follow status (for The Inner Circle page)
  app.get('/api/guilds/:guildId/circle-members', authMiddleware, async (req, res) => {
    try {
      const { guildId } = req.params;
      const userGuild = req.user.guilds.find(g => g.id === guildId);
      if (!userGuild) return res.status(403).json({ error: 'Not in this guild' });

      const guild = discordClient?.guilds.cache.get(guildId);
      if (!guild) {
        try {
          const fetchedGuild = await discordClient?.guilds.fetch(guildId);
          if (!fetchedGuild) return res.json({ members: [], followingIds: [] });
          await fetchedGuild.members.fetch();
          const members = fetchedGuild.members.cache
            .filter(m => !m.user.bot)
            .filter(m => m.id !== req.user.discordId)
            .map(m => ({
              discordId: m.id,
              displayName: m.displayName || m.user.username,
              username: m.user.username,
              avatar: m.user.displayAvatarURL({ size: 64 }),
              isKing: m.id === GAMBLING_KING_ID,
            }));
          const following = await followsDb.getFollowing(req.user.discordId, guildId);
          const followingIds = following.map(f => f.bettor_discord_id);
          return res.json({ members, followingIds });
        } catch (e) {
          console.error('[Circle] Fallback fetch failed:', e.message);
          return res.json({ members: [], followingIds: [] });
        }
      }

      // Use paginated list to avoid gateway rate limits
      const allMembers = [];
      let after = '0';
      while (true) {
        const batch = await guild.members.list({ limit: 1000, after });
        if (batch.size === 0) break;
        batch.forEach(m => allMembers.push(m));
        after = batch.lastKey();
        if (batch.size < 1000) break;
      }

      const members = allMembers
        .filter(m => !m.user.bot)
        .filter(m => m.id !== req.user.discordId)
        .map(m => ({
          discordId: m.id,
          displayName: m.displayName || m.user.username,
          username: m.user.username,
          avatar: m.user.displayAvatarURL({ size: 64 }),
          isKing: m.id === GAMBLING_KING_ID,
        }));

      const following = await followsDb.getFollowing(req.user.discordId, guildId);
      const followingIds = following.map(f => f.bettor_discord_id);

      res.json({ members, followingIds });
    } catch (err) {
      console.error('[API] Circle members error:', err.message);
      res.status(500).json({ error: 'Failed to fetch members' });
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

      // Extract the bet objects, sorted newest first, and include tailed_units
      let bets = tailRows.map(t => {
        const bet = { ...t.bets };
        if (t.tailed_units != null) bet.tailed_units = t.tailed_units;
        return bet;
      }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

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
      spreadValue: bet.spread_value,
      units: bet.units,
      status: bet.status,
      betNote: bet.bet_note,
      shareLink: bet.share_link || null,
      eventStartTime: bet.event_start_time,
      isWhale: bet.is_whale,
      isRetro: bet.is_retro,
      createdAt: bet.created_at,
      messageId: bet.message_id,
      channelId: bet.channel_id,
      mirrorChannelId: bet.mirror_channel_id || null,
      mirrorScoreboardMsgId: bet.mirror_scoreboard_msg_id || null,
      period: bet.period || 'full_game',
      fightRound: bet.fight_round || null,
      fightMethod: bet.fight_method || null,
      golfHole: bet.golf_hole || null,
      golfRound: bet.golf_round || null,
      legs: (bet.parlay_legs || []).map(l => ({
        id: l.id,
        legNumber: l.leg_number,
        sport: l.sport,
        sportName: SPORT_NAMES[l.sport] || l.sport,
        betCategory: l.bet_category,
        wagerType: l.wager_type,
        teamA: l.team_a,
        teamB: l.team_b,
        playerName: l.player_name,
        propDescription: l.prop_description,
        pick: l.pick,
        oddsAmerican: l.odds_american,
        spreadValue: l.spread_value,
        status: l.status,
        eventStartTime: l.event_start_time,
        period: l.period || 'full_game',
        fightRound: l.fight_round || null,
        fightMethod: l.fight_method || null,
        golfHole: l.golf_hole || null,
        golfRound: l.golf_round || null,
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

      // Generate updated bet card image
      const updatedBet = await db.getBet(betId);
      const { AttachmentBuilder: ABLeg } = require('discord.js');
      let imgBuffer;
      try {
        imgBuffer = await generateBetCardImage(updatedBet, null, null);
      } catch (e) {
        console.warn('Could not generate bet card image for leg close:', e.message);
      }

      // Update Discord message with new leg statuses
      if (imgBuffer && bet.message_id && bet.channel_id) {
        try {
          const channel = await discordClient.channels.fetch(bet.channel_id);
          const message = await channel.messages.fetch(bet.message_id);
          const attachment = new ABLeg(imgBuffer, { name: 'bet-card.png' });
          const legEditPayload = { files: [attachment], embeds: [], attachments: [] };
          if (updatedBet.share_link) legEditPayload.content = buildContentWithLink('', updatedBet.share_link);
          await message.edit(legEditPayload);
        } catch (e) {
          console.warn('Could not update primary parlay message:', e.message);
        }
      }

      // Update mirror message in open slips channel (independent of primary)
      if (imgBuffer && bet.mirror_message_id && bet.mirror_channel_id) {
        try {
          const mirrorChannel = await discordClient.channels.fetch(bet.mirror_channel_id);
          const mirrorMsg = await mirrorChannel.messages.fetch(bet.mirror_message_id);
          const mirrorAttachment = new ABLeg(imgBuffer, { name: 'bet-card.png' });
          const mirrorLegPayload = { files: [mirrorAttachment], embeds: [], attachments: [] };
          if (mirrorMsg.components?.length) mirrorLegPayload.components = mirrorMsg.components;
          if (updatedBet.share_link) mirrorLegPayload.content = buildContentWithLink('', updatedBet.share_link);
          await mirrorMsg.edit(mirrorLegPayload);
        } catch (e) {
          console.warn('Could not update mirror parlay leg:', e.message);
        }
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
      const { status, resultNote, communityMessage, gifUrl } = req.body;

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

      // Delete mirror message from open bets channel
      if (bet.mirror_message_id && bet.mirror_channel_id) {
        try {
          const mirrorChannel = await discordClient.channels.fetch(bet.mirror_channel_id);
          const mirrorMsg = await mirrorChannel.messages.fetch(bet.mirror_message_id);
          await mirrorMsg.delete();

          // Also delete scoreboard placeholder
          if (bet.mirror_scoreboard_msg_id) {
            try {
              const sbMsg = await mirrorChannel.messages.fetch(bet.mirror_scoreboard_msg_id);
              await sbMsg.delete();
            } catch (e2) {}
          }
        } catch (e) {
          console.error('[API] Mirror message delete error:', e.message);
        }
      }

      // End any active scoreboard for this bet
      if (bet.id) {
        try {
          await scoreboardDb.endScoreboardsByBet(bet.id);
        } catch (e) {}
      }

      // Delete original Discord message and post a fresh one with the result (wins only)
      // For losses/push/void, just edit the existing message in place
      if (bet.message_id && bet.channel_id) {
        try {
          const channel = await discordClient.channels.fetch(bet.channel_id);

          // Build the updated embed/image
          const updatedBet = await db.getBet(betId);

          // Resolve the ORIGINAL bettor's display name (not the admin closing it)
          let bettorDisplayName = 'Unknown';
          try {
            const guild = discordClient.guilds.cache.get(bet.guild_id);
            if (guild) {
              const member = await fetchMember(guild, bet.discord_id);
              bettorDisplayName = member.displayName;
            }
          } catch (e) {}

          // Resolve closing user's display name for the announcement text
          let closerDisplayName = req.user.displayName || req.user.username || 'Unknown';
          try {
            const guild = discordClient.guilds.cache.get(bet.guild_id);
            if (guild) {
              const member = await fetchMember(guild, req.user.discordId);
              closerDisplayName = member.displayName;
            }
          } catch (e) {}

          const resultEmoji = status === 'win' ? '✅' : status === 'loss' ? '❌' : '🔄';
          let content = `${resultEmoji} **${closerDisplayName}** closed a bet as **${status.toUpperCase()}**`;

          // Append the user's community message
          if (communityMessage && communityMessage.trim()) {
            content += `\n\n${communityMessage.trim()}`;
          }

          const { AttachmentBuilder: ABClose } = require('discord.js');
          const imgBuffer = await generateBetCardImage(updatedBet, bettorDisplayName, null);
          const attachment = new ABClose(imgBuffer, { name: 'bet-card.png' });

          if (status === 'win') {
            // WIN: Delete old message, post a fresh one
            try {
              const oldMsg = await channel.messages.fetch(bet.message_id);
              await oldMsg.delete();
            } catch (e) {} // Original may already be deleted

            let sendPayload = { content, files: [attachment] };
            if (gifUrl && gifUrl.trim()) {
              sendPayload.content += `\n${gifUrl.trim()}`;
            }

            const newMsg = await channel.send(sendPayload);
            await db.updateBetMessageId(betId, newMsg.id);
          } else {
            // LOSS/PUSH/VOID: Edit the existing message in place
            try {
              const oldMsg = await channel.messages.fetch(bet.message_id);
              let editPayload = { content, files: [attachment], embeds: [], components: [] };
              if (gifUrl && gifUrl.trim()) {
                editPayload.content += `\n${gifUrl.trim()}`;
              }
              await oldMsg.edit(editPayload);
            } catch (e) {
              // If edit fails (message deleted), post a new one
              let sendPayload = { content, files: [attachment] };
              if (gifUrl && gifUrl.trim()) {
                sendPayload.content += `\n${gifUrl.trim()}`;
              }
              const newMsg = await channel.send(sendPayload);
              await db.updateBetMessageId(betId, newMsg.id);
            }
          }
        } catch (e) {
          console.error('[API] Close bet Discord update error:', e);
        }
      }

      res.json({ success: true });

      // Trigger role update for the bettor (non-blocking)
      try {
        const roleManager = require('../services/roleManager');
        if (discordClient && bet.guild_id && bet.discord_id) {
          const guild = discordClient.guilds.cache.get(bet.guild_id);
          if (guild) roleManager.updateUserRoles(guild, bet.discord_id).catch(() => {});
        }
      } catch (e) { /* role manager not critical */ }
    } catch (err) {
      console.error('[API] Close bet error:', err);
      res.status(500).json({ error: 'Failed to close bet' });
    }
  });

  // Reopen a closed bet (admin only)
  app.post('/api/bets/:betId/reopen', authMiddleware, async (req, res) => {
    try {
      const { betId } = req.params;
      const bet = await db.getBet(betId);
      if (!bet) return res.status(404).json({ error: 'Bet not found' });

      const admin = await isAdminInGuild(bet.guild_id, req.user.discordId);
      if (!admin) return res.status(403).json({ error: 'Only admins can reopen bets' });
      if (bet.status === 'open') return res.status(400).json({ error: 'Bet is already open' });

      await db.reopenBet(betId);

      // Reopen all parlay legs too
      if (bet.bet_type === 'parlay' && bet.parlay_legs) {
        for (const leg of bet.parlay_legs) {
          if (['win', 'loss', 'push', 'void'].includes(leg.status)) {
            await db.updateParlayLegStatus(leg.id, 'open');
          }
        }
      }

      // Update Discord message
      if (bet.message_id && bet.channel_id) {
        try {
          const channel = await discordClient.channels.fetch(bet.channel_id);
          const message = await channel.messages.fetch(bet.message_id);
          const updatedBet = await db.getBet(betId);
          const { AttachmentBuilder: ABReopen } = require('discord.js');
          const imgBuffer = await generateBetCardImage(updatedBet, null, null);
          const attachment = new ABReopen(imgBuffer, { name: 'bet-card.png' });
          await message.edit({ files: [attachment], embeds: [], attachments: [], components: [] });
        } catch (e) {}
      }

      res.json({ success: true });
    } catch (err) {
      console.error('[API] Reopen bet error:', err);
      res.status(500).json({ error: 'Failed to reopen bet' });
    }
  });

  // Get a single bet by ID
  app.get('/api/bets/:betId', authMiddleware, async (req, res) => {
    try {
      const bet = await db.getBet(req.params.betId);
      if (!bet) return res.status(404).json({ error: 'Bet not found' });
      res.json(formatBetForApi(bet));
    } catch (err) {
      console.error('[API] Get bet error:', err);
      res.status(500).json({ error: 'Failed to fetch bet' });
    }
  });

  // Edit a bet
  app.patch('/api/bets/:betId', authMiddleware, async (req, res) => {
    try {
      const { betId } = req.params;
      const { oddsAmerican, units, pick, betNote, sport, wagerType, teamA, teamB,
              eventStartTime, playerName, propDescription, betCategory, spreadValue,
              shareLink, legs, period, fightRound, fightMethod, golfHole, golfRound } = req.body;

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
      if (sport !== undefined) fields.sport = sport;
      if (wagerType !== undefined) fields.wager_type = wagerType;
      if (teamA !== undefined) fields.team_a = teamA;
      if (teamB !== undefined) fields.team_b = teamB;
      if (eventStartTime !== undefined) fields.event_start_time = eventStartTime || null;
      if (playerName !== undefined) fields.player_name = playerName;
      if (propDescription !== undefined) fields.prop_description = propDescription;
      if (betCategory !== undefined) fields.bet_category = betCategory;
      if (spreadValue !== undefined) fields.spread_value = spreadValue ? parseFloat(spreadValue) : null;
      if (shareLink !== undefined) fields.share_link = (typeof shareLink === 'string' ? shareLink.slice(0, 500) : shareLink) || null;
      if (period !== undefined) fields.period = period || 'full_game';
      if (fightRound !== undefined) fields.fight_round = fightRound ? parseInt(fightRound) : null;
      if (fightMethod !== undefined) fields.fight_method = fightMethod || null;
      if (golfHole !== undefined) fields.golf_hole = golfHole ? parseInt(golfHole) : null;
      if (golfRound !== undefined) fields.golf_round = golfRound ? parseInt(golfRound) : null;

      if (Object.keys(fields).length > 0) {
        // Reconstruct `pick` from edited field values + existing bet data
        const mergedBet = { ...bet, ...fields };
        const cat = mergedBet.bet_category || bet.bet_category;
        const wt = mergedBet.wager_type || bet.wager_type;
        const EDIT_PERIOD_LABELS = { '1st_half': '1H', '2nd_half': '2H', '1st_quarter': '1Q', '2nd_quarter': '2Q', '3rd_quarter': '3Q', '4th_quarter': '4Q', '1st_period': '1P', '2nd_period': '2P', '3rd_period': '3P', '1st_set': '1S' };
        const EDIT_FIGHT_METHOD_LABELS = { ko_tko: 'KO/TKO', submission: 'Sub', decision: 'Dec', unanimous_decision: 'UD', split_decision: 'SD', dq: 'DQ', points: 'Pts' };
        const editPeriod = mergedBet.period && mergedBet.period !== 'full_game' ? ` (${EDIT_PERIOD_LABELS[mergedBet.period] || mergedBet.period})` : '';
        if (cat === 'futures') {
          // pick comes pre-built from client for futures (market: selection)
          if (!fields.pick && bet.pick) fields.pick = bet.pick;
        } else if (cat === 'team_game') {
          const tA = mergedBet.team_a || '';
          if (wt === 'moneyline') fields.pick = `${tA} ML${editPeriod}`;
          else if (wt === 'spread') {
            const sv = parseFloat(mergedBet.spread_value || 0);
            fields.pick = `${tA} ${sv > 0 ? '+' : ''}${sv}${editPeriod}`;
          } else if (wt === 'total') {
            const sv = parseFloat(mergedBet.spread_value || 0);
            fields.pick = `Over ${Math.abs(sv)}${editPeriod}`;
          }
        } else if (cat === 'player_prop') {
          fields.pick = mergedBet.prop_description || mergedBet.pick || bet.pick;
        }
        // Append fight context
        if (['ufc', 'boxing'].includes(mergedBet.sport) && fields.pick) {
          const fParts = [];
          if (mergedBet.fight_round) fParts.push(`Rd ${mergedBet.fight_round}`);
          if (mergedBet.fight_method) fParts.push(EDIT_FIGHT_METHOD_LABELS[mergedBet.fight_method] || mergedBet.fight_method);
          if (fParts.length) fields.pick += ` (${fParts.join(', ')})`;
        }
        // Append golf context
        if (mergedBet.sport === 'golf' && fields.pick) {
          const gParts = [];
          if (mergedBet.golf_round) gParts.push(`R${mergedBet.golf_round}`);
          if (mergedBet.golf_hole) gParts.push(`Hole ${mergedBet.golf_hole}`);
          if (gParts.length) fields.pick += ` (${gParts.join(', ')})`;
        }

        await db.updateBetFields(betId, fields);
      }

      // Update parlay legs if provided
      if (legs && Array.isArray(legs) && bet.bet_type === 'parlay') {
        for (const leg of legs) {
          if (!leg.id) continue;
          const legFields = {};
          if (leg.sport !== undefined) legFields.sport = leg.sport;
          if (leg.betCategory !== undefined) legFields.bet_category = leg.betCategory;
          if (leg.wagerType !== undefined) legFields.wager_type = leg.wagerType;
          if (leg.teamA !== undefined) legFields.team_a = leg.teamA;
          if (leg.teamB !== undefined) legFields.team_b = leg.teamB;
          if (leg.playerName !== undefined) legFields.player_name = leg.playerName;
          if (leg.propDescription !== undefined) legFields.prop_description = leg.propDescription;
          if (leg.oddsAmerican !== undefined) legFields.odds_american = leg.oddsAmerican ? parseInt(leg.oddsAmerican) : null;
          if (leg.spreadValue !== undefined) legFields.spread_value = leg.spreadValue ? parseFloat(leg.spreadValue) : null;
          if (leg.eventStartTime !== undefined) legFields.event_start_time = leg.eventStartTime || null;
          if (leg.period !== undefined) legFields.period = leg.period || 'full_game';
          if (leg.fightRound !== undefined) legFields.fight_round = leg.fightRound ? parseInt(leg.fightRound) : null;
          if (leg.fightMethod !== undefined) legFields.fight_method = leg.fightMethod || null;
          if (leg.golfHole !== undefined) legFields.golf_hole = leg.golfHole ? parseInt(leg.golfHole) : null;
          if (leg.golfRound !== undefined) legFields.golf_round = leg.golfRound ? parseInt(leg.golfRound) : null;

          // Reconstruct leg pick
          const lCat = leg.betCategory || 'team_game';
          const lWt = leg.wagerType || 'moneyline';
          const LEG_PERIOD_LABELS = { '1st_half': '1H', '2nd_half': '2H', '1st_quarter': '1Q', '2nd_quarter': '2Q', '3rd_quarter': '3Q', '4th_quarter': '4Q', '1st_period': '1P', '2nd_period': '2P', '3rd_period': '3P', '1st_set': '1S' };
          const LEG_FIGHT_LABELS = { ko_tko: 'KO/TKO', submission: 'Sub', decision: 'Dec', unanimous_decision: 'UD', split_decision: 'SD', dq: 'DQ', points: 'Pts' };
          const lPeriod = leg.period && leg.period !== 'full_game' ? ` (${LEG_PERIOD_LABELS[leg.period] || leg.period})` : '';
          if (lCat === 'futures') {
            // pick comes pre-built from client for futures legs
            if (leg.pick) legFields.pick = leg.pick;
          } else if (lCat === 'team_game') {
            const lTeamA = leg.teamA || '';
            if (lWt === 'moneyline') legFields.pick = `${lTeamA} ML${lPeriod}`;
            else if (lWt === 'spread') {
              const sv = parseFloat(leg.spreadValue || 0);
              legFields.pick = `${lTeamA} ${sv > 0 ? '+' : ''}${sv}${lPeriod}`;
            } else if (lWt === 'total') {
              const sv = parseFloat(leg.spreadValue || 0);
              legFields.pick = `${leg.overUnder || 'Over'} ${Math.abs(sv)}${lPeriod}`;
            }
          } else if (lCat === 'player_prop') {
            legFields.pick = leg.propDescription || '';
          }
          // Append fight context to leg pick
          if (['ufc', 'boxing'].includes(leg.sport) && legFields.pick) {
            const fParts = [];
            if (leg.fightRound) fParts.push(`Rd ${leg.fightRound}`);
            if (leg.fightMethod) fParts.push(LEG_FIGHT_LABELS[leg.fightMethod] || leg.fightMethod);
            if (fParts.length) legFields.pick += ` (${fParts.join(', ')})`;
          }
          // Append golf context to leg pick
          if (leg.sport === 'golf' && legFields.pick) {
            const gParts = [];
            if (leg.golfRound) gParts.push(`R${leg.golfRound}`);
            if (leg.golfHole) gParts.push(`Hole ${leg.golfHole}`);
            if (gParts.length) legFields.pick += ` (${gParts.join(', ')})`;
          }

          if (Object.keys(legFields).length > 0) {
            await db.updateParlayLegFields(leg.id, legFields);
          }
        }
      }

      if (Object.keys(fields).length === 0 && (!legs || !Array.isArray(legs))) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      // Update Discord message
      const updatedBet = await db.getBet(betId);
      if (updatedBet.message_id && updatedBet.channel_id) {
        try {
          // Resolve display name for the embed
          let embedName = req.user.displayName || req.user.username || 'Unknown';
          let embedAvatar = req.user.avatar || null;
          if (updatedBet.discord_id !== req.user.discordId && discordClient) {
            // Admin editing someone else's bet — get the original user's info
            const guild = discordClient.guilds.cache.get(updatedBet.guild_id);
            if (guild) {
              const member = await guild.members.fetch(updatedBet.discord_id).catch(() => null);
              if (member) {
                embedName = member.displayName || member.user.username;
                embedAvatar = member.user.displayAvatarURL({ size: 128, extension: 'png', forceStatic: true });
              }
            }
          } else if (discordClient) {
            const dUser = await discordClient.users.fetch(req.user.discordId).catch(() => null);
            if (dUser) {
              embedAvatar = dUser.displayAvatarURL({ size: 128, extension: 'png', forceStatic: true });
            }
          }
          const channel = await discordClient.channels.fetch(updatedBet.channel_id);
          const message = await channel.messages.fetch(updatedBet.message_id);
          const { AttachmentBuilder: ABEdit } = require('discord.js');
          const imgBuffer = await generateBetCardImage(updatedBet, embedName, embedAvatar);
          const attachment = new ABEdit(imgBuffer, { name: 'bet-card.png' });
          const editPayload = { files: [attachment], embeds: [], attachments: [] };
          if (updatedBet.share_link) editPayload.content = buildContentWithLink('', updatedBet.share_link);
          else editPayload.content = '';
          await message.edit(editPayload);
        } catch (e) {
          console.error('[API] Discord message update failed:', e.message);
        }
      }

      // Update mirror message in open bets channel
      if (updatedBet.mirror_message_id && updatedBet.mirror_channel_id) {
        try {
          let mirrorName = req.user.displayName || req.user.username || 'Unknown';
          let mirrorAvatar = req.user.avatar || null;
          if (updatedBet.discord_id !== req.user.discordId && discordClient) {
            const guild = discordClient.guilds.cache.get(updatedBet.guild_id);
            if (guild) {
              const member = await guild.members.fetch(updatedBet.discord_id).catch(() => null);
              if (member) {
                mirrorName = member.displayName || member.user.username;
                mirrorAvatar = member.user.displayAvatarURL({ size: 128, extension: 'png', forceStatic: true });
              }
            }
          } else if (discordClient) {
            const dUser = await discordClient.users.fetch(req.user.discordId).catch(() => null);
            if (dUser) {
              mirrorAvatar = dUser.displayAvatarURL({ size: 128, extension: 'png', forceStatic: true });
            }
          }
          const mirrorChannel = await discordClient.channels.fetch(updatedBet.mirror_channel_id);
          const mirrorMsg = await mirrorChannel.messages.fetch(updatedBet.mirror_message_id);
          const { AttachmentBuilder: ABMirrorEdit } = require('discord.js');
          const mirrorImgBuffer = await generateBetCardImage(updatedBet, mirrorName, mirrorAvatar);
          const mirrorAttachment = new ABMirrorEdit(mirrorImgBuffer, { name: 'bet-card.png' });
          const mirrorEditPayload = { files: [mirrorAttachment], embeds: [], attachments: [] };
          if (mirrorMsg.components?.length) mirrorEditPayload.components = mirrorMsg.components;
          if (updatedBet.share_link) mirrorEditPayload.content = buildContentWithLink('', updatedBet.share_link);
          else mirrorEditPayload.content = '';
          await mirrorMsg.edit(mirrorEditPayload);
        } catch (e) {
          console.error('[API] Mirror message update failed:', e.message);
        }
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

      // Delete mirror message from open bets channel
      if (bet.mirror_message_id && bet.mirror_channel_id) {
        try {
          const mirrorChannel = await discordClient.channels.fetch(bet.mirror_channel_id);
          const mirrorMsg = await mirrorChannel.messages.fetch(bet.mirror_message_id);
          await mirrorMsg.delete();

          // Also delete scoreboard placeholder
          if (bet.mirror_scoreboard_msg_id) {
            try {
              const sbMsg = await mirrorChannel.messages.fetch(bet.mirror_scoreboard_msg_id);
              await sbMsg.delete();
            } catch (e2) {}
          }
        } catch (e) {}
      }

      // End any active scoreboard for this bet
      try {
        await scoreboardDb.endScoreboardsByBet(betId);
      } catch (e) {}

      await db.deleteBet(betId, req.user.discordId, admin);
      res.json({ success: true });
    } catch (err) {
      console.error('[API] Delete bet error:', err);
      res.status(500).json({ error: 'Failed to delete bet' });
    }
  });

  // ─── GIPHY Search Proxy ───
  const GIPHY_API_KEY = process.env.GIPHY_API_KEY;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  app.get('/api/giphy-search', authMiddleware, apiLimiter, async (req, res) => {
    try {
      if (!GIPHY_API_KEY) {
        return res.status(503).json({ error: 'GIPHY not configured', results: [] });
      }
      const q = (req.query.q || '').trim();
      if (!q) return res.json({ results: [] });

      const url = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(GIPHY_API_KEY)}&q=${encodeURIComponent(q)}&limit=20&rating=r`;
      const response = await fetch(url);
      const data = await response.json();

      const results = (data.data || []).map(g => ({
        url: g.images?.original?.url || g.url,
        preview: g.images?.fixed_width?.url || g.images?.fixed_width_small?.url,
        title: g.title,
      }));
      res.json({ results });
    } catch (err) {
      console.error('[API] GIPHY search error:', err);
      res.status(500).json({ error: 'GIPHY search failed', results: [] });
    }
  });

  // ─── Share to Discord API ───

  // ─── OCR Bet Slip (OpenAI Vision) ───
  const ocrJsonParser = express.json({ limit: '20mb' });

  app.post('/api/ocr-slip', authMiddleware, ocrJsonParser, postLimiter, async (req, res) => {
    try {
      if (!OPENAI_API_KEY) {
        return res.status(503).json({ error: 'OCR not configured. OPENAI_API_KEY missing.' });
      }

      const { imageData, imageDatas } = req.body;
      const images = imageDatas || (imageData ? [imageData] : []);
      if (!images.length) return res.status(400).json({ error: 'No image data provided' });

      const validSports = ['nfl','nba','mlb','nhl','ncaa_football','ncaa_mbb','ncaa_wbb','mls','epl','la_liga','ucl','ufc','boxing','tennis','golf','nascar','wnba','esports','other'];

      const prompt = `You are an expert at reading sports betting slips/screenshots from sportsbooks like DraftKings, FanDuel, BetMGM, Caesars, Kalshi, ESPN Bet, etc.

Analyze this bet slip image and extract the bet details. Return a JSON object with this exact structure:

For a SINGLE bet:
{
  "betType": "single",
  "sport": "<one of: ${validSports.join(', ')}>",
  "betCategory": "<one of: team_game, player_prop, futures>",
  "wagerType": "<one of: moneyline, spread, total, prop, futures>",
  "teamA": "<your pick team or null>",
  "teamB": "<opponent team or null>",
  "spreadValue": "<spread or total line value like -1.5, 220.5, or null>",
  "overUnder": "<Over or Under or null>",
  "playerName": "<player name or null>",
  "propDescription": "<full prop like 'Over 25.5 Points' or null>",
  "futuresMarket": "<market name or null>",
  "futuresSelection": "<selection or null>",
  "oddsAmerican": "<American odds like -110, +150>",
  "wagerAmount": "<dollar wager/stake amount as a number, or null if not visible>",
  "eventStartTime": "<game date and time in format like 'Thu Mar 5 7:00 PM ET', or null>",
  "period": "<one of: full_game, 1st_half, 2nd_half, 1st_quarter, 2nd_quarter, 3rd_quarter, 4th_quarter, 1st_period, 2nd_period, 3rd_period, 1st_set — default full_game>",
  "fightRound": "<round number 1-12 for UFC/Boxing bets, or null>",
  "fightMethod": "<one of: ko_tko, submission, decision, unanimous_decision, split_decision, dq, points — or null>",
  "golfRound": "<tournament round 1-4 for golf bets, or null>",
  "golfHole": "<hole number 1-18 for golf bets, or null>"
}

For a PARLAY (multiple legs):
{
  "betType": "parlay",
  "oddsAmerican": "<total parlay odds in American format>",
  "wagerAmount": "<dollar wager/stake amount as a number, or null if not visible>",
  "legs": [
    {
      "sport": "<sport value>",
      "betCategory": "<team_game, player_prop, or futures>",
      "wagerType": "<moneyline, spread, total, prop, or futures>",
      "teamA": "<pick team or null>",
      "teamB": "<opponent or null>",
      "spreadValue": "<spread/line or null>",
      "overUnder": "<Over or Under or null>",
      "playerName": "<player name or null>",
      "propDescription": "<prop description or null>",
      "futuresMarket": "<market or null>",
      "futuresSelection": "<selection or null>",
      "eventStartTime": "<game date and time in format like 'Thu Mar 5 7:00 PM ET', or null>",
      "period": "<period value — default full_game>",
      "fightRound": "<round number or null>",
      "fightMethod": "<method value or null>",
      "golfRound": "<round 1-4 or null>",
      "golfHole": "<hole 1-18 or null>"
    }
  ]
}

Rules:
- American odds: negative for favorites (e.g. -110), positive for underdogs (e.g. +150)
- If odds shown are decimal, convert to American format
- For spreads, include the +/- sign (e.g. "-3.5", "+7")
- For over/under, set overUnder to "Over" or "Under" and put the line number in spreadValue
- For over/under and total bets, ALWAYS include teamA and teamB from the game the total belongs to. Look at the matchup header above the bet (e.g. "OKC Thunder @ DET Pistons") and use those teams. Never leave teamA/teamB null for total bets.
- In parlays, if a total/over-under leg appears under the same game header as a moneyline or spread leg, use that game's teams for the total leg too.
- For player props, set betCategory to "player_prop", wagerType to "prop"
- For player props, keep the EXACT prop description as shown on the slip. If the slip says "10+ Rebounds", use "10+ Rebounds" as propDescription (do NOT convert to "Over 10 Rebounds"). If it says "Over 25.5 Points", keep it as "Over 25.5 Points". Preserve the original format.
- For player props, ALWAYS include teamA and teamB from the game the player is in. Look at the matchup header (e.g. "NYK Knicks @ MIL Bucks") and fill in both teams. Never leave teamA/teamB null for player props.
- For over/under totals (team_game with wagerType "total"), the spreadValue should always end in .5 (e.g. 220.5, 45.5). If the line is a whole number, add .5.
- For futures, set betCategory to "futures", wagerType to "futures"
- teamA should be the team/side being bet ON (the pick). For totals, teamA is the first-listed team in the matchup.
- If you can detect the wager/stake amount in dollars, put it in wagerAmount (just the number, no $ sign)
- If the slip has multiple bets/legs, return as parlay
- Map the sport to the closest value from the valid sports list
- For eventStartTime, ALWAYS format as "Day Mon DD H:MM AM/PM ET" (e.g. "Thu Mar 5 7:00 PM ET"). If only a time is visible (e.g. "7:00 PM"), assume today's date and use the full format. If no time is visible, use null.
- IMPORTANT: Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}. Games on betting slips are almost always within the next 1-7 days from today. Use the CURRENT month and year when constructing dates. Do NOT guess old or future months — the event is happening very soon.
- PERIOD DETECTION: If the bet is for a specific half, quarter, or period (e.g. "1st Half Over 110.5", "3rd Period ML", "1Q Spread -2.5"), set the period field accordingly. Look for indicators like "1H", "2H", "1st Half", "2nd Half", "1Q", "2Q", "3Q", "4Q", "1st Quarter", "1st Period", "2P", "3P", "1st Set". Default to "full_game" if no period is specified.
- FIGHT BETS (UFC/Boxing): If the bet mentions a specific round (e.g. "Round 3", "Rd 1-2", "goes the distance"), extract fightRound as the round number. If a method of victory is specified (e.g. "by KO/TKO", "by Submission", "by Decision", "by Points"), set fightMethod to the matching value (ko_tko, submission, decision, unanimous_decision, split_decision, dq, points).
- GOLF BETS: If the bet involves a specific hole (e.g. "Hole 4 Birdie", "Hole-in-one #7"), extract golfHole. If it mentions a specific tournament round (e.g. "Round 1", "R3"), extract golfRound. Common golf props include birdies, eagles, bogeys, hole-in-one on specific holes/rounds.
- Return ONLY valid JSON, no markdown or explanation`;

      // Process each image through OpenAI Vision
      const results = [];
      for (const imgData of images) {
        const oaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: prompt },
                  { type: 'image_url', image_url: { url: imgData, detail: 'high' } },
                ],
              },
            ],
            max_tokens: 2000,
            temperature: 0.1,
          }),
        });

        const oaiData = await oaiRes.json();

        if (oaiData.error) {
          console.error('[API] OpenAI error:', oaiData.error);
          return res.status(500).json({ error: 'AI analysis failed: ' + (oaiData.error.message || 'Unknown error') });
        }

        const content = oaiData.choices?.[0]?.message?.content;
        if (!content) {
          return res.status(500).json({ error: 'No response from AI' });
        }

        // Parse JSON from response (strip markdown code fences if present)
        let parsed;
        try {
          const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          parsed = JSON.parse(jsonStr);
        } catch (e) {
          console.error('[API] Failed to parse OCR response:', content);
          return res.status(500).json({ error: 'Could not parse bet details from image. Try a clearer screenshot.' });
        }

        results.push(parsed);
      }

      // Post-process: fix obviously wrong dates from OCR hallucinations
      const fixEventDate = (timeStr) => {
        if (!timeStr) return timeStr;
        // Parse "Day Mon DD H:MM AM/PM TZ" format
        const dateRx = /^(\w{3})\s+(\w{3})\s+(\d{1,2})\s+(.+)$/;
        const m = timeStr.match(dateRx);
        if (!m) return timeStr;

        const [, dayName, monthStr, dayNum, rest] = m;
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const parsedMonth = months.indexOf(monthStr);
        if (parsedMonth === -1) return timeStr;

        const now = new Date();
        const currentMonth = now.getMonth(); // 0-based

        // If the OCR date is more than 2 months away from now, it's likely wrong
        // Replace with current month and recalculate the day-of-week
        const monthDiff = Math.abs(parsedMonth - currentMonth);
        if (monthDiff > 2 && monthDiff < 10) {
          // Use current month/year, keep the day number and time
          const correctedDate = new Date(now.getFullYear(), currentMonth, parseInt(dayNum));
          const correctedDayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][correctedDate.getDay()];
          const correctedMonth = months[currentMonth];
          const fixed = `${correctedDayName} ${correctedMonth} ${dayNum} ${rest}`;
          console.log(`[OCR] Fixed hallucinated date: "${timeStr}" → "${fixed}"`);
          return fixed;
        }
        return timeStr;
      };

      for (const result of results) {
        if (result.eventStartTime) result.eventStartTime = fixEventDate(result.eventStartTime);
        if (result.legs) {
          for (const leg of result.legs) {
            if (leg.eventStartTime) leg.eventStartTime = fixEventDate(leg.eventStartTime);
          }
        }
      }

      // Return single result or array for multi-image
      res.json({ success: true, data: results.length === 1 ? results[0] : results });
    } catch (err) {
      console.error('[API] OCR slip error:', err);
      res.status(500).json({ error: 'Failed to analyze bet slip' });
    }
  });

  app.post('/api/share-to-discord', authMiddleware, imageJsonParser, postLimiter, async (req, res) => {
    try {
      const { guildId, channelId, pageType, imageData, userName, periodLabel } = req.body;
      if (!guildId || !channelId || !pageType || !imageData) {
        const missing = [];
        if (!guildId) missing.push('guildId');
        if (!channelId) missing.push('channelId');
        if (!pageType) missing.push('pageType');
        if (!imageData) missing.push('imageData');
        return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
      }

      // Validate base64 image (PNG or JPEG)
      const match = imageData.match(/^data:image\/(png|jpeg);base64,(.+)$/);
      if (!match) {
        return res.status(400).json({ error: 'Invalid image data format' });
      }

      const imgFormat = match[1]; // 'png' or 'jpeg'
      const imgBuffer = Buffer.from(match[2], 'base64');
      // Limit to 8MB (Discord file size limit)
      if (imgBuffer.length > 8 * 1024 * 1024) {
        return res.status(400).json({ error: 'Image too large (max 8MB)' });
      }

      // Verify user is in guild
      const userGuild = req.user.guilds.find(g => g.id === guildId);
      if (!userGuild) return res.status(403).json({ error: 'Not in this guild' });

      const guild = discordClient?.guilds.cache.get(guildId);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });

      const channel = await discordClient.channels.fetch(channelId);
      if (!channel) return res.status(404).json({ error: 'Channel not found' });

      // Resolve display name
      let displayName = req.user.displayName || req.user.username || 'Unknown';
      try {
        const member = await fetchMember(guild, req.user.discordId);
        displayName = member.displayName;
      } catch (e) {}

      const { EmbedBuilder, AttachmentBuilder } = require('discord.js');

      const ext = imgFormat === 'jpeg' ? 'jpg' : 'png';
      const filename = pageType === 'stats' ? `stats.${ext}` : `leaderboard.${ext}`;
      const attachment = new AttachmentBuilder(imgBuffer, { name: filename });

      // Build a dynamic message
      const safeName = (userName || displayName || 'someone').replace(/[*_~`|]/g, '');
      const safePeriod = (periodLabel || '').replace(/[*_~`|]/g, '');
      let messageText;
      if (pageType === 'stats') {
        messageText = `Hey Boys! Check out **${safeName}'s** stats for **${safePeriod || 'All Time'}**! 💰`;
      } else {
        messageText = `Hey Boys! Check out the **${safeName}** leaderboard${safePeriod ? ' — **' + safePeriod + '**' : ''}! 💰`;
      }

      const title = pageType === 'stats' ? '� Statistics' : '💰 Rankings';
      const embed = new EmbedBuilder()
        .setColor(0xF5C518)
        .setTitle(title)
        .setImage(`attachment://${filename}`)
        .setTimestamp()
        .setFooter({ text: `Shared by ${displayName} • TheGamblingKing` });

      await channel.send({ content: messageText, embeds: [embed], files: [attachment] });

      res.json({ success: true });
    } catch (err) {
      console.error('[API] Share to Discord error:', err);
      if (err.code === 50001) {
        return res.status(403).json({ error: 'Bot doesn\'t have access to that channel. Check channel permissions.' });
      }
      if (err.code === 50013) {
        return res.status(403).json({ error: 'Bot is missing "Send Messages" or "Embed Links" permission in that channel.' });
      }
      res.status(500).json({ error: 'Failed to share to Discord' });
    }
  });

  // ─── Reminders API ───

  app.get('/api/guilds/:guildId/reminders', authMiddleware, async (req, res) => {
    try {
      const { guildId } = req.params;
      const userGuild = req.user.guilds.find(g => g.id === guildId);
      if (!userGuild) return res.status(403).json({ error: 'Not in this guild' });

      const admin = await isAdminInGuild(guildId, req.user.discordId);
      if (!admin) return res.status(403).json({ error: 'Admin only' });

      const reminders = await remindersDb.getActiveReminders(guildId, 50);

      // Get channel names
      const guild = discordClient?.guilds.cache.get(guildId);
      const result = reminders.map(r => {
        const channelIds = r.channel_ids && r.channel_ids.length ? r.channel_ids : [r.channel_id];
        const channelNames = channelIds.map(cid => guild?.channels.cache.get(cid)?.name || cid);
        return {
          id: r.id,
          type: r.type,
          message: r.message,
          channelId: r.channel_id,
          channelIds,
          channelNames,
          channelName: channelNames[0],
          scheduledAt: r.scheduled_at,
          repeat: r.repeat,
          creatorId: r.creator_discord_id,
          links: r.links || [],
        };
      });

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

      const { type, message, scheduledAt, channelId, channelIds, repeat, links } = req.body;

      const resolvedChannelIds = channelIds && channelIds.length ? channelIds : (channelId ? [channelId] : []);
      if (!type || !message || !scheduledAt || !resolvedChannelIds.length) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const schedDate = new Date(scheduledAt);
      if (isNaN(schedDate.getTime()) || schedDate.getTime() <= Date.now()) {
        return res.status(400).json({ error: 'Schedule time must be in the future' });
      }

      const reminder = await remindersDb.createReminder({
        guildId,
        channelId: resolvedChannelIds[0],
        channelIds: resolvedChannelIds,
        creatorId: req.user.discordId,
        type,
        message,
        scheduledAt: schedDate.toISOString(),
        repeat: repeat || 'none',
        links: Array.isArray(links) ? links : [],
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

      const { type, message, scheduledAt, channelId, channelIds, repeat, links } = req.body;

      const fields = {};
      if (type) fields.type = type;
      if (message) fields.message = message;
      if (scheduledAt) {
        const schedDate = new Date(scheduledAt);
        if (isNaN(schedDate.getTime())) return res.status(400).json({ error: 'Invalid schedule time' });
        fields.scheduledAt = schedDate.toISOString();
      }
      if (channelIds && channelIds.length) {
        fields.channelIds = channelIds;
        fields.channelId = channelIds[0];
      } else if (channelId) {
        fields.channelId = channelId;
        fields.channelIds = [channelId];
      }
      if (repeat) fields.repeat = repeat;
      if (links !== undefined) fields.links = Array.isArray(links) ? links : [];

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
    if (!guildId) return res.status(400).json({ error: 'Guild ID required' });
    const admin = await isAdminInGuild(guildId, req.user.discordId);
    if (!admin) return res.status(403).json({ error: 'Admin only' });
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

  // Generic activity tracking endpoint
  const ALLOWED_EVENTS = ['page_view', 'bet_placed', 'view_leaderboard', 'view_stats', 'view_bets', 'view_tools', 'view_reminders', 'pwa_launch'];
  app.post('/api/analytics/track', authMiddleware, async (req, res) => {
    try {
      const { event, metadata } = req.body;
      if (!event || !ALLOWED_EVENTS.includes(event)) {
        return res.status(400).json({ error: 'Invalid event type' });
      }
      await supabase.from('web_analytics').insert({
        discord_id: req.user.discordId,
        discord_username: req.user.username,
        display_name: req.user.displayName,
        avatar: req.user.avatar,
        event_type: event,
        user_agent: req.headers['user-agent'] || null,
        ip_address: req.ip || null,
      });
      res.json({ success: true });
    } catch (err) {
      // Silent fail — don't block user experience for analytics
      res.json({ success: true });
    }
  });

  // Heartbeat — clients ping every 30s
  app.post('/api/heartbeat', authMiddleware, (req, res) => {
    activeUsers.set(req.user.discordId, {
      discordId: req.user.discordId,
      username: req.user.username,
      displayName: req.user.displayName,
      avatar: req.user.avatar,
      lastSeen: Date.now(),
    });
    res.json({ ok: true });
  });

  // Get online users (owner only)
  app.get('/api/analytics/online', authMiddleware, (req, res) => {
    if (req.user.discordId !== SITE_OWNER_ID) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const now = Date.now();
    const online = [];
    for (const [id, u] of activeUsers) {
      if (now - u.lastSeen < HEARTBEAT_TIMEOUT) {
        online.push(u);
      } else {
        activeUsers.delete(id);
      }
    }
    res.json({ count: online.length, users: online });
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
        .limit(2000);

      if (error) throw error;

      // Build summary
      const uniqueLogins = new Map();
      const uniqueInstalls = new Map();
      let betsPlaced = 0;
      let leaderboardViews = 0;
      let pageViews = 0;

      (events || []).forEach(e => {
        if (e.event_type === 'login') {
          if (!uniqueLogins.has(e.discord_id)) {
            uniqueLogins.set(e.discord_id, e);
          }
        } else if (e.event_type === 'pwa_install' || e.event_type === 'pwa_launch') {
          if (!uniqueInstalls.has(e.discord_id)) {
            uniqueInstalls.set(e.discord_id, e);
          }
        } else if (e.event_type === 'bet_placed') {
          betsPlaced++;
        } else if (e.event_type === 'view_leaderboard') {
          leaderboardViews++;
        } else {
          pageViews++;
        }
      });

      res.json({
        totalLogins: events.filter(e => e.event_type === 'login').length,
        totalInstalls: events.filter(e => e.event_type === 'pwa_install' || e.event_type === 'pwa_launch').length,
        uniqueUsers: uniqueLogins.size,
        uniqueInstallers: uniqueInstalls.size,
        betsPlaced,
        leaderboardViews,
        pageViews,
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

  // ══════════════════════════════════════════════════════════════
  // NBA Player Props Analysis Routes
  // ══════════════════════════════════════════════════════════════

  // Get today's NBA games
  app.get('/api/props/games', authMiddleware, ownerMiddleware, async (req, res) => {
    try {
      const games = await nbaProps.getTodaysNBAGames();
      res.json(games);
    } catch (err) {
      console.error('[Props API] games error:', err);
      res.status(500).json({ error: 'Failed to fetch games' });
    }
  });

  // Get roster for a team
  app.get('/api/props/roster/:teamId', authMiddleware, ownerMiddleware, async (req, res) => {
    try {
      const roster = await nbaProps.getTeamRoster(req.params.teamId);
      res.json(roster);
    } catch (err) {
      console.error('[Props API] roster error:', err);
      res.status(500).json({ error: 'Failed to fetch roster' });
    }
  });

  // Analyze a player: auto-generate lines based on season averages (uses real sportsbook lines + matchup context)
  app.get('/api/props/analyze/:playerId', authMiddleware, ownerMiddleware, async (req, res) => {
    try {
      const { playerId } = req.params;
      const { opponentId, playerName, playerTeamId, homeAway, overUnder, spread } = req.query;
      if (!opponentId) return res.status(400).json({ error: 'opponentId query param required' });
      const gameCtx = {
        playerTeamId: playerTeamId || null,
        homeAway: homeAway || null,
        odds: (overUnder || spread) ? { overUnder: overUnder || null, spread: spread || null } : null,
      };
      const result = await nbaProps.autoAnalyzePlayer(playerId, opponentId, playerName || null, gameCtx);
      if (result.error) return res.status(404).json(result);
      res.json(result);
    } catch (err) {
      console.error('[Props API] analyze error:', err);
      res.status(500).json({ error: 'Failed to analyze player' });
    }
  });

  // Analyze a player with custom prop lines
  app.post('/api/props/analyze', authMiddleware, ownerMiddleware, async (req, res) => {
    try {
      const { playerId, opponentId, propLines } = req.body;
      if (!playerId || !opponentId) return res.status(400).json({ error: 'playerId and opponentId required' });
      const result = await nbaProps.analyzePlayerForGame(playerId, opponentId, propLines || {});
      if (result.error) return res.status(404).json(result);
      res.json(result);
    } catch (err) {
      console.error('[Props API] custom analyze error:', err);
      res.status(500).json({ error: 'Failed to analyze player' });
    }
  });

  // Generate top 5 OVER and top 5 UNDER picks across all today's games
  app.get('/api/props/top-picks', authMiddleware, ownerMiddleware, async (req, res) => {
    try {
      const result = await nbaProps.generateTopPicks();
      res.json(result);

      // Fire-and-forget: save picks to DB for tracking
      try {
        await propPicksDb.savePicks(result.overs, 'over');
        await propPicksDb.savePicks(result.unders, 'under');
      } catch (e) {
        console.error('[Props] Failed to save picks to DB:', e.message);
      }
    } catch (err) {
      console.error('[Props API] top-picks error:', err);
      res.status(500).json({ error: 'Failed to generate top picks' });
    }
  });

  // Get pick accuracy stats
  app.get('/api/props/accuracy', authMiddleware, ownerMiddleware, async (req, res) => {
    try {
      const stats = await propPicksDb.getAccuracyStats();
      res.json(stats || { totalPicks: 0 });
    } catch (err) {
      console.error('[Props API] accuracy error:', err);
      res.status(500).json({ error: 'Failed to fetch accuracy stats' });
    }
  });

  // Resolve yesterday's picks by checking ESPN box scores
  app.post('/api/props/resolve', authMiddleware, ownerMiddleware, async (req, res) => {
    try {
      // Get yesterday's date in Eastern time (or provided date)
      const date = req.body.date || (() => {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      })();

      const unresolved = await propPicksDb.getUnresolvedPicks(date);
      if (!unresolved.length) {
        return res.json({ message: 'No unresolved picks for ' + date, resolved: 0, unresolved: 0 });
      }

      const resolutions = await nbaProps.resolvePicksFromESPN(unresolved);
      const result = await propPicksDb.resolvePickBatch(resolutions);

      res.json({ date, unresolved: unresolved.length, resolved: result.resolved, dnpCount: result.dnpCount });
    } catch (err) {
      console.error('[Props API] resolve error:', err);
      res.status(500).json({ error: 'Failed to resolve picks' });
    }
  });

  // Get picks for a specific date
  app.get('/api/props/history/:date', authMiddleware, ownerMiddleware, async (req, res) => {
    try {
      const picks = await propPicksDb.getPicksByDate(req.params.date);
      res.json(picks);
    } catch (err) {
      console.error('[Props API] history error:', err);
      res.status(500).json({ error: 'Failed to fetch pick history' });
    }
  });

  // Get all picks grouped by day with daily stats
  app.get('/api/props/daily-history', authMiddleware, ownerMiddleware, async (req, res) => {
    try {
      const days = await propPicksDb.getDailyHistory();
      res.json(days);
    } catch (err) {
      console.error('[Props API] daily-history error:', err);
      res.status(500).json({ error: 'Failed to fetch daily history' });
    }
  });

  // ─── NBA Game Picks (ML, Spread, O/U) ───

  // Generate top game picks for today's NBA slate
  app.get('/api/game-picks/top', authMiddleware, ownerMiddleware, async (req, res) => {
    try {
      const result = await nbaGamePicks.generateTopGamePicks();
      res.json(result);

      // Fire-and-forget: save picks to DB for tracking
      try {
        await gamePicksDb.savePicks(result.moneyline || [], 'ml');
        await gamePicksDb.savePicks(result.spread || [], 'spread');
        await gamePicksDb.savePicks(result.overUnder || [], 'ou');
      } catch (e) {
        console.error('[GamePicks] Failed to save picks to DB:', e.message);
      }
    } catch (err) {
      console.error('[GamePicks API] top picks error:', err);
      res.status(500).json({ error: 'Failed to generate game picks' });
    }
  });

  // Analyze a single game
  app.get('/api/game-picks/analyze/:gameId', authMiddleware, ownerMiddleware, async (req, res) => {
    try {
      const games = await nbaGamePicks.getTodaysGames();
      const game = games.find(g => g.id === req.params.gameId);
      if (!game) return res.status(404).json({ error: 'Game not found' });
      const analysis = await nbaGamePicks.analyzeGame(game);
      res.json(analysis);
    } catch (err) {
      console.error('[GamePicks API] analyze error:', err);
      res.status(500).json({ error: 'Failed to analyze game' });
    }
  });

  // Game picks accuracy stats
  app.get('/api/game-picks/accuracy', authMiddleware, ownerMiddleware, async (req, res) => {
    try {
      const stats = await gamePicksDb.getAccuracyStats();
      res.json(stats || { totalPicks: 0 });
    } catch (err) {
      console.error('[GamePicks API] accuracy error:', err);
      res.status(500).json({ error: 'Failed to fetch accuracy stats' });
    }
  });

  // Resolve yesterday's game picks by checking ESPN final scores
  app.post('/api/game-picks/resolve', authMiddleware, ownerMiddleware, async (req, res) => {
    try {
      const date = req.body?.date || (() => {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      })();

      const unresolved = await gamePicksDb.getUnresolvedPicks(date);
      if (!unresolved.length) {
        return res.json({ message: 'No unresolved game picks for ' + date, resolved: 0, unresolved: 0 });
      }

      const resolutions = await nbaGamePicks.resolveGamePicksFromESPN(unresolved);
      const result = await gamePicksDb.resolvePickBatch(resolutions);

      res.json({ date, unresolved: unresolved.length, resolved: result.resolved });
    } catch (err) {
      console.error('[GamePicks API] resolve error:', err);
      res.status(500).json({ error: 'Failed to resolve game picks' });
    }
  });

  // Get game picks for a specific date
  app.get('/api/game-picks/history/:date', authMiddleware, ownerMiddleware, async (req, res) => {
    try {
      const picks = await gamePicksDb.getPicksByDate(req.params.date);
      res.json(picks);
    } catch (err) {
      console.error('[GamePicks API] history error:', err);
      res.status(500).json({ error: 'Failed to fetch game pick history' });
    }
  });

  // Get all game picks grouped by day with daily stats
  app.get('/api/game-picks/daily-history', authMiddleware, ownerMiddleware, async (req, res) => {
    try {
      const days = await gamePicksDb.getDailyHistory();
      res.json(days);
    } catch (err) {
      console.error('[GamePicks API] daily-history error:', err);
      res.status(500).json({ error: 'Failed to fetch daily history' });
    }
  });

  // Submit a bet
  app.post('/api/bets', authMiddleware, postLimiter, async (req, res) => {
    try {
      const {
        guildId, channelId, betType, sport, betCategory, wagerType,
        teamA, teamB, pick, playerName, propDescription,
        futuresMarket, futuresSelection,
        spreadValue, oddsAmerican, units, betNote, shareLink,
        eventStartTime, isWhale, overUnder,
        period, fightRound, fightMethod, golfHole, golfRound,
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
      const safeShareLink = truncate(shareLink);
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
          share_link: safeShareLink || null,
          is_whale: isWhale || false,
          is_retro: false,
          status: 'open',
        }, displayName);

        const PERIOD_LABELS_P = { '1st_half': '1H', '2nd_half': '2H', '1st_quarter': '1Q', '2nd_quarter': '2Q', '3rd_quarter': '3Q', '4th_quarter': '4Q', '1st_period': '1P', '2nd_period': '2P', '3rd_period': '3P', '1st_set': '1S' };
        const FIGHT_METHOD_LABELS_P = { ko_tko: 'KO/TKO', submission: 'Sub', decision: 'Dec', unanimous_decision: 'UD', split_decision: 'SD', dq: 'DQ', points: 'Pts' };

        const legRecords = legs.map((leg, i) => {
          const legPeriod = leg.period && leg.period !== 'full_game' ? ` (${PERIOD_LABELS_P[leg.period] || leg.period})` : '';
          let legPick = truncate(leg.pick);
          if (leg.betCategory === 'futures') {
            legPick = `${truncate(leg.futuresMarket, 200)}: ${truncate(leg.futuresSelection, 200)}`;
          } else if (leg.betCategory === 'team_game') {
            if (leg.wagerType === 'moneyline') {
              legPick = `${truncate(leg.teamA, 200)} ML${legPeriod}`;
            } else if (leg.wagerType === 'spread') {
              const sv = parseFloat(leg.spreadValue);
              legPick = `${truncate(leg.teamA, 200)} ${sv > 0 ? '+' : ''}${sv}${legPeriod}`;
            } else if (leg.wagerType === 'total') {
              const sv = parseFloat(leg.spreadValue);
              legPick = `${leg.overUnder || 'Over'} ${Math.abs(sv)}${legPeriod}`;
            }
          } else {
            legPick = truncate(leg.propDescription) || truncate(leg.pick);
          }

          // Append fight/golf context
          if (['ufc', 'boxing'].includes(leg.sport)) {
            const parts = [];
            if (leg.fightRound) parts.push(`Rd ${leg.fightRound}`);
            if (leg.fightMethod) parts.push(FIGHT_METHOD_LABELS_P[leg.fightMethod] || leg.fightMethod);
            if (parts.length) legPick += ` (${parts.join(', ')})`;
          }
          if (leg.sport === 'golf') {
            const parts = [];
            if (leg.golfRound) parts.push(`R${leg.golfRound}`);
            if (leg.golfHole) parts.push(`Hole ${leg.golfHole}`);
            if (parts.length) legPick += ` (${parts.join(', ')})`;
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
            period: leg.period || 'full_game',
            fight_round: leg.fightRound ? parseInt(leg.fightRound) : null,
            fight_method: leg.fightMethod || null,
            golf_hole: leg.golfHole ? parseInt(leg.golfHole) : null,
            golf_round: leg.golfRound ? parseInt(leg.golfRound) : null,
          };
        });

        await db.createParlayLegs(legRecords);
        const fullBet = await db.getBet(bet.id);

        // Post to Discord
        const channel = await discordClient.channels.fetch(channelId);
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder: AB } = require('discord.js');

        const imgBuffer = await generateBetCardImage(fullBet, displayName, req.user.avatar);
        const attachment = new AB(imgBuffer, { name: 'bet-card.png' });
        const sendPayload = { files: [attachment] };

        const pollRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`tailbet_yes_${bet.id}`).setLabel('Yes').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`tailbet_no_${bet.id}`).setLabel('No').setStyle(ButtonStyle.Danger),
        );

        const whaleContent = `🚨🚨🐋🍆🐋🍆🐋🍆 <@${targetDiscordId}> JUST SUBMITTED A MF'ING WHALE DICK BET! 🍆🐋🍆🐋🍆🐋🚨🚨\n\nARE YOU READY TO MAKE SOME MF'ING MONEY. #JMM`;
        sendPayload.components = [pollRow];
        sendPayload.content = buildContentWithLink(isWhale ? whaleContent : 'Are You Tailing This Bet?', fullBet.share_link);
        const message = await channel.send(sendPayload);
        await db.updateBetMessageId(bet.id, message.id);

        // Mirror to open bets channel
        try {
          const mirrorChannelId = targetDiscordId === KING_DISCORD_ID ? KING_OPEN_CHANNEL : COMMUNITY_OPEN_CHANNEL;
          const mirrorChannel = await discordClient.channels.fetch(mirrorChannelId);
          const mirrorImgBuffer = await generateBetCardImage(fullBet, displayName, req.user.avatar);
          const { AttachmentBuilder: ABMirror } = require('discord.js');
          const mirrorAttachment = new ABMirror(mirrorImgBuffer, { name: 'bet-card.png' });

          const mirrorPollRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`tailbet_yes_${bet.id}`).setLabel('Tail').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`tailbet_no_${bet.id}`).setLabel('Fade').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setLabel('Comment').setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${guildId}/${channelId}/${message.id}`),
          );

          const mirrorPayload2 = { files: [mirrorAttachment], components: [mirrorPollRow] };
          if (bet.share_link) mirrorPayload2.content = buildContentWithLink('', bet.share_link);
          const mirrorMsg = await mirrorChannel.send(mirrorPayload2);
          await db.updateBetMirrorMessageId(bet.id, mirrorMsg.id, mirrorChannelId);

          // [SCOREBOARD DISABLED] Placeholder posting disabled — feature dormant
          // To re-enable: uncomment below and the matching code in single bet section (~line 2687)
          // try {
          //   const placeholderMsg = await mirrorChannel.send({ content: '📡 *Scoreboard will appear here when game starts*', flags: [4096] });
          //   await db.updateBetScoreboardMsgId(bet.id, placeholderMsg.id);
          // } catch (phErr) {
          //   console.error('[API] Scoreboard placeholder error (parlay):', phErr.message);
          // }
        } catch (mirrorErr) {
          console.error('[API] Mirror post error (parlay):', mirrorErr);
        }

        // Notify followers
        notifyFollowers(discordClient, targetDiscordId, guildId, fullBet, displayName, false);

        return res.json({ success: true, slipNumber: bet.slip_number, betId: bet.id });

      } else {
        // ── Single bet ──
        const PERIOD_LABELS = { '1st_half': '1H', '2nd_half': '2H', '1st_quarter': '1Q', '2nd_quarter': '2Q', '3rd_quarter': '3Q', '4th_quarter': '4Q', '1st_period': '1P', '2nd_period': '2P', '3rd_period': '3P', '1st_set': '1S' };
        const FIGHT_METHOD_LABELS = { ko_tko: 'KO/TKO', submission: 'Sub', decision: 'Dec', unanimous_decision: 'UD', split_decision: 'SD', dq: 'DQ', points: 'Pts' };
        const periodTag = period && period !== 'full_game' ? ` (${PERIOD_LABELS[period] || period})` : '';

        let finalPick = safePick;
        if (betCategory === 'futures') {
          finalPick = `${safeFuturesMarket}: ${safeFuturesSelection}`;
        } else if (betCategory === 'team_game') {
          if (wagerType === 'moneyline') {
            finalPick = `${safeTeamA} ML${periodTag}`;
          } else if (wagerType === 'spread') {
            const sv = parseFloat(spreadValue);
            finalPick = `${safeTeamA} ${sv > 0 ? '+' : ''}${sv}${periodTag}`;
          } else if (wagerType === 'total') {
            const sv = parseFloat(spreadValue);
            finalPick = `${overUnder || 'Over'} ${Math.abs(sv)}${periodTag}`;
          }
        } else {
          finalPick = safePropDesc || safePick;
        }

        // Append fight/golf context to pick text
        if (['ufc', 'boxing'].includes(sport)) {
          const parts = [];
          if (fightRound) parts.push(`Rd ${fightRound}`);
          if (fightMethod) parts.push(FIGHT_METHOD_LABELS[fightMethod] || fightMethod);
          if (parts.length) finalPick += ` (${parts.join(', ')})`;
        }
        if (sport === 'golf') {
          const parts = [];
          if (golfRound) parts.push(`R${golfRound}`);
          if (golfHole) parts.push(`Hole ${golfHole}`);
          if (parts.length) finalPick += ` (${parts.join(', ')})`;
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
          share_link: safeShareLink || null,
          event_start_time: eventStartTime || null,
          is_whale: isWhale || false,
          is_retro: false,
          status: 'open',
          period: period || 'full_game',
          fight_round: fightRound ? parseInt(fightRound) : null,
          fight_method: fightMethod || null,
          golf_hole: golfHole ? parseInt(golfHole) : null,
          golf_round: golfRound ? parseInt(golfRound) : null,
        };

        const bet = await db.createBet(betData, displayName);

        // Post to Discord
        const channel = await discordClient.channels.fetch(channelId);
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder: AB2 } = require('discord.js');

        const imgBuffer = await generateBetCardImage(bet, displayName, req.user.avatar);
        const attachment = new AB2(imgBuffer, { name: 'bet-card.png' });
        const sendPayload = { files: [attachment] };

        const pollRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`tailbet_yes_${bet.id}`).setLabel('Yes').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`tailbet_no_${bet.id}`).setLabel('No').setStyle(ButtonStyle.Danger),
        );

        const whaleContent = `🚨🚨🐋🍆🐋🍆🐋🍆 <@${targetDiscordId}> JUST SUBMITTED A MF'ING WHALE DICK BET! 🍆🐋🍆🐋🍆🐋🚨🚨\n\nARE YOU READY TO MAKE SOME MF'ING MONEY. #JMM`;
        sendPayload.components = [pollRow];
        sendPayload.content = buildContentWithLink(isWhale ? whaleContent : 'Are You Tailing This Bet?', bet.share_link);
        const message = await channel.send(sendPayload);
        await db.updateBetMessageId(bet.id, message.id);

        // Mirror to open bets channel
        try {
          const mirrorChannelId = targetDiscordId === KING_DISCORD_ID ? KING_OPEN_CHANNEL : COMMUNITY_OPEN_CHANNEL;
          const mirrorChannel = await discordClient.channels.fetch(mirrorChannelId);
          const mirrorImgBuffer = await generateBetCardImage(bet, displayName, req.user.avatar);
          const { AttachmentBuilder: ABMirror2 } = require('discord.js');
          const mirrorAttachment = new ABMirror2(mirrorImgBuffer, { name: 'bet-card.png' });

          const mirrorPollRow2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`tailbet_yes_${bet.id}`).setLabel('Tail').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`tailbet_no_${bet.id}`).setLabel('Fade').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setLabel('Comment').setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${guildId}/${channelId}/${message.id}`),
          );

          const mirrorPayload = { files: [mirrorAttachment], components: [mirrorPollRow2] };
          if (bet.share_link) mirrorPayload.content = buildContentWithLink('', bet.share_link);
          const mirrorMsg = await mirrorChannel.send(mirrorPayload);
          await db.updateBetMirrorMessageId(bet.id, mirrorMsg.id, mirrorChannelId);

          // [SCOREBOARD DISABLED] Placeholder posting disabled — feature dormant
          // To re-enable: uncomment below and the matching code in parlay section (~line 2596)
          // try {
          //   const placeholderMsg = await mirrorChannel.send({ content: '📡 *Scoreboard will appear here when game starts*', flags: [4096] });
          //   await db.updateBetScoreboardMsgId(bet.id, placeholderMsg.id);
          // } catch (phErr) {
          //   console.error('[API] Scoreboard placeholder error (single):', phErr.message);
          // }
        } catch (mirrorErr) {
          console.error('[API] Mirror post error (single):', mirrorErr);
        }

        // Notify followers
        notifyFollowers(discordClient, targetDiscordId, guildId, bet, displayName, false);

        return res.json({ success: true, slipNumber: bet.slip_number, betId: bet.id });
      }
    } catch (err) {
      console.error('[API] Submit bet error:', err);
      res.status(500).json({ error: 'Failed to save bet' });
    }
  });

  // ─── LIVE SCOREBOARD ENDPOINTS ───

  // Get today's games for a sport
  app.get('/api/scoreboard/games/:sport', authMiddleware, async (req, res) => {
    try {
      const { sport } = req.params;
      const games = await espn.getTodaysGames(sport);
      res.json({ games });
    } catch (err) {
      console.error('[API] Scoreboard games error:', err);
      res.status(500).json({ error: 'Failed to fetch games' });
    }
  });

  // Get today's games for ALL sports
  app.get('/api/scoreboard/games', authMiddleware, async (req, res) => {
    try {
      const allGames = await espn.getAllTodaysGames();
      // Convert array to object keyed by sport
      const sportsObj = {};
      for (const { sport, games } of allGames) {
        sportsObj[sport] = games;
      }
      res.json({ sports: sportsObj });
    } catch (err) {
      console.error('[API] Scoreboard all games error:', err);
      res.status(500).json({ error: 'Failed to fetch games' });
    }
  });

  // Activate scoreboard for a specific bet (edits the placeholder under the mirror slip)
  app.post('/api/scoreboard/activate/:betId', authMiddleware, async (req, res) => {
    try {
      const bet = await db.getBet(req.params.betId);
      if (!bet) return res.status(404).json({ error: 'Bet not found' });

      // Only bet owner or admin
      const isOwner = bet.discord_id === req.user.discordId;
      const admin = await isAdminInGuild(bet.guild_id, req.user.discordId);
      if (!isOwner && !admin) return res.status(403).json({ error: 'Not your bet' });

      if (!bet.mirror_channel_id) {
        return res.status(400).json({ error: 'This bet has no mirror channel — it may have been created before mirroring was enabled.' });
      }

      // If no placeholder message exists yet (bet created before scoreboard feature), create one now
      if (!bet.mirror_scoreboard_msg_id) {
        try {
          const placeholderChannel = await discordClient.channels.fetch(bet.mirror_channel_id);
          const placeholderMsg = await placeholderChannel.send('📡 *Scoreboard will appear here when activated*');
          await db.updateBetScoreboardMsgId(bet.id, placeholderMsg.id);
          bet.mirror_scoreboard_msg_id = placeholderMsg.id;
        } catch (phErr) {
          console.error('[API] Failed to create scoreboard placeholder:', phErr);
          return res.status(500).json({ error: 'Failed to create scoreboard placeholder in mirror channel' });
        }
      }

      if (bet.status !== 'open') {
        return res.status(400).json({ error: 'Bet is already closed' });
      }

      // Try to match this bet to an ESPN game
      const sport = bet.sport;
      if (!sport) return res.status(400).json({ error: 'No sport on this bet' });

      const games = await espn.getTodaysGames(sport);
      const game = espn.matchTeamToGame(bet.team_a, games) || espn.matchTeamToGame(bet.team_b, games);

      if (!game) {
        return res.status(404).json({ error: `No matching game found today for ${bet.team_a || bet.player_name || 'this bet'}. The game may not be scheduled today.` });
      }

      // Check if already tracking this bet
      const existing = await scoreboardDb.getScoreboardByBet(bet.id);
      if (existing) {
        return res.status(400).json({ error: 'Scoreboard already active for this bet' });
      }

      // Build prop tracking data
      const props = [];
      if (bet.bet_category === 'player_prop' && bet.player_name && bet.prop_description) {
        const parsed = espn.parsePropDescription(bet.prop_description);
        if (parsed) {
          props.push({
            playerName: bet.player_name,
            direction: parsed.direction,
            line: parsed.line,
            stat: parsed.stat,
            espnKey: parsed.espnKey,
            currentStat: null,
            status: 'tracking',
          });
        }
      }
      // Parlay legs
      if (bet.parlay_legs) {
        for (const leg of bet.parlay_legs) {
          if (leg.bet_category === 'player_prop' && leg.player_name && leg.prop_description) {
            const parsed = espn.parsePropDescription(leg.prop_description);
            if (parsed) {
              props.push({
                playerName: leg.player_name,
                direction: parsed.direction,
                line: parsed.line,
                stat: parsed.stat,
                espnKey: parsed.espnKey,
                currentStat: null,
                status: 'tracking',
              });
            }
          }
        }
      }

      // Generate scoreboard image
      const imgBuffer = await generateScoreboardImage(game, props);
      const { AttachmentBuilder: ABScore } = require('discord.js');
      const attachment = new ABScore(imgBuffer, { name: 'scoreboard.png' });

      // Edit the placeholder message in the mirror channel
      const mirrorChannel = await discordClient.channels.fetch(bet.mirror_channel_id);
      const placeholderMsg = await mirrorChannel.messages.fetch(bet.mirror_scoreboard_msg_id);
      await placeholderMsg.edit({
        content: '',
        files: [attachment],
      });

      // Save to scoreboard tracking table
      const scoreboard = await scoreboardDb.createScoreboard({
        guildId: bet.guild_id,
        channelId: bet.mirror_channel_id,
        messageId: bet.mirror_scoreboard_msg_id,
        discordId: bet.discord_id,
        sport,
        espnGameId: game.id,
        homeTeam: game.home.name,
        awayTeam: game.away.name,
        betIds: [bet.id],
      });

      res.json({ success: true, scoreboardId: scoreboard.id, game: `${game.away.abbreviation} @ ${game.home.abbreviation}`, props: props.length });
    } catch (err) {
      console.error('[API] Scoreboard activate error:', err);
      res.status(500).json({ error: 'Failed to activate scoreboard' });
    }
  });

  // Deactivate scoreboard for a bet (revert to placeholder)
  app.post('/api/scoreboard/deactivate/:betId', authMiddleware, async (req, res) => {
    try {
      const bet = await db.getBet(req.params.betId);
      if (!bet) return res.status(404).json({ error: 'Bet not found' });

      const isOwner = bet.discord_id === req.user.discordId;
      const admin = await isAdminInGuild(bet.guild_id, req.user.discordId);
      if (!isOwner && !admin) return res.status(403).json({ error: 'Not your bet' });

      const scoreboard = await scoreboardDb.getScoreboardByBet(bet.id);
      if (!scoreboard) return res.status(404).json({ error: 'No active scoreboard for this bet' });

      await scoreboardDb.endScoreboard(scoreboard.id);

      // Revert to placeholder text
      if (bet.mirror_channel_id && bet.mirror_scoreboard_msg_id) {
        try {
          const mirrorChannel = await discordClient.channels.fetch(bet.mirror_channel_id);
          const msg = await mirrorChannel.messages.fetch(bet.mirror_scoreboard_msg_id);
          await msg.edit({ content: '📡 *Scoreboard stopped*', files: [] });
        } catch (e) {}
      }

      res.json({ success: true });
    } catch (err) {
      console.error('[API] Scoreboard deactivate error:', err);
      res.status(500).json({ error: 'Failed to deactivate scoreboard' });
    }
  });

  // Check scoreboard status for a bet
  app.get('/api/scoreboard/status/:betId', authMiddleware, async (req, res) => {
    try {
      const scoreboard = await scoreboardDb.getScoreboardByBet(req.params.betId);
      res.json({ active: !!scoreboard, scoreboard: scoreboard || null });
    } catch (err) {
      res.json({ active: false, scoreboard: null });
    }
  });

  // Get active scoreboards for a guild
  app.get('/api/guilds/:guildId/scoreboards', authMiddleware, async (req, res) => {
    try {
      const scoreboards = await scoreboardDb.getActiveScoreboardsForGuild(req.params.guildId);
      res.json({ scoreboards });
    } catch (err) {
      console.error('[API] Scoreboards list error:', err);
      res.status(500).json({ error: 'Failed to fetch scoreboards' });
    }
  });

  // Preview a scoreboard image (no Discord post)
  app.get('/api/scoreboard/preview/:sport/:gameId', authMiddleware, async (req, res) => {
    try {
      const { sport, gameId } = req.params;
      const games = await espn.getTodaysGames(sport);
      const game = games.find(g => g.id === gameId);
      if (!game) return res.status(404).json({ error: 'Game not found' });

      const imgBuffer = await generateScoreboardImage(game);
      res.set('Content-Type', 'image/png');
      res.send(imgBuffer);
    } catch (err) {
      console.error('[API] Scoreboard preview error:', err);
      res.status(500).json({ error: 'Failed to generate preview' });
    }
  });

  // ─── Bracket Challenge Routes ───
  require('./bracketRoutes')(app, { jwt, JWT_SECRET, discordClient, path });

  // Fallback — serve index.html for SPA
  app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // Cleanup stale heartbeats every 30s
  setInterval(() => {
    const now = Date.now();
    for (const [id, u] of activeUsers) {
      if (now - u.lastSeen >= HEARTBEAT_TIMEOUT) activeUsers.delete(id);
    }
  }, 30000);

  return app;
}

module.exports = { createWebServer, setDiscordClient };
