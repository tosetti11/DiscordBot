/**
 * Streak & Daily Record Service
 * 
 * - Detects win/loss streaks after bet closings
 * - Posts streak notifications to a designated channel
 * - Posts daily "Kings Weekly Record" at 8 AM ET
 */
const { supabase } = require('../config/supabase');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const { SPORT_NAMES, STATUS_EMOJI } = require('../config/constants');
const { formatOdds } = require('../utils/odds');

// ── Config ──
const STREAK_CHANNEL_ID = '1494664726532325507';
const KINGS_USER_ID = '1246525685749649441';
const KINGS_RECORD_CHANNEL_ID = '1465192261628330283';

// ── Fonts ──
const FONT_PATH = path.join(__dirname, '..', 'fonts', 'Inter-Variable.ttf');
const EMOJI_FONT_PATH = path.join(__dirname, '..', 'fonts', 'NotoColorEmoji.ttf');
try { GlobalFonts.registerFromPath(FONT_PATH, 'Inter'); } catch (e) {}
try { GlobalFonts.registerFromPath(EMOJI_FONT_PATH, 'NotoColorEmoji'); } catch (e) {}
const FF = '"Inter", "NotoColorEmoji", sans-serif';

const C = {
  bgMain: '#111214',
  bgCard: '#1a1b1e',
  bgSection: '#232428',
  accent: '#FF8732',
  accentFaint: 'rgba(255, 135, 50, 0.15)',
  win: '#43b581',
  loss: '#ff4444',
  push: '#aaa',
  gold: '#F5C518',
  textPrimary: '#ffffff',
  textSecondary: '#b3b3b3',
  textMuted: '#72767d',
};

let brandLogoPromise = null;
function getBrandLogo() {
  if (!brandLogoPromise) {
    const logoPath = path.join(__dirname, '..', 'web', 'public', 'TheGamblingKing.jpg');
    brandLogoPromise = loadImage(logoPath).catch(() => null);
  }
  return brandLogoPromise;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ─────────────────────────────────────────────────────────────
// Streak Detection
// ─────────────────────────────────────────────────────────────

/**
 * Calculate current win streak for a user.
 * Looks at their most recent closed bets (excluding void/push) and counts
 * consecutive wins from the most recent backward.
 */
async function getWinStreak(discordId, guildId) {
  const { data: bets, error } = await supabase
    .from('bets')
    .select('id, status, slip_number, pick, sport, odds_american, units, bet_type, closed_at, parlay_legs(pick)')
    .eq('discord_id', discordId)
    .eq('guild_id', guildId)
    .in('status', ['win', 'loss'])
    .order('closed_at', { ascending: false })
    .limit(50);

  if (error || !bets?.length) return { streak: 0, bets: [] };

  let streak = 0;
  const streakBets = [];
  for (const bet of bets) {
    if (bet.status === 'win') {
      streak++;
      streakBets.push(bet);
    } else {
      break;
    }
  }

  return { streak, bets: streakBets };
}

/**
 * Check for streak and send notification after a bet is closed as a win.
 * Called from closebet.handleResultButton and the auto-close timer.
 */
async function checkAndNotifyStreak(client, bet, guildId) {
  if (bet.status !== 'win') return;

  try {
    const { streak, bets: streakBets } = await getWinStreak(bet.discord_id, guildId);

    if (streak < 3) return;

    const isHeater = streak >= 5;
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    let displayName = bet.discord_id;
    if (guild) {
      const member = await guild.members.fetch(bet.discord_id).catch(() => null);
      displayName = member?.displayName || bet.discord_id;
    }

    // Build streak image
    const imgBuffer = await generateStreakCardImage(displayName, streak, streakBets, isHeater);
    const { AttachmentBuilder } = require('discord.js');
    const attachment = new AttachmentBuilder(imgBuffer, { name: 'streak-card.png' });

    // Post to streak channel
    const streakChannel = await client.channels.fetch(STREAK_CHANNEL_ID).catch(() => null);
    if (streakChannel) {
      const emoji = isHeater ? '🔥🔥🔥' : '🔥';
      const heaterTag = isHeater ? ' **HEATER ALERT!**' : '';
      await streakChannel.send({
        content: `${emoji} **${displayName}** is on a **${streak}-WIN STREAK**!${heaterTag}`,
        files: [attachment],
      });
    }

    // Notify all users in the guild (via announcement to the streak channel)
    // For heaters (5+), also DM followers
    if (isHeater && guild) {
      try {
        const members = await guild.members.fetch();
        const dmPromises = members
          .filter(m => !m.user.bot && m.id !== bet.discord_id)
          .map(async (m) => {
            try {
              await m.user.send(
                `🔥🔥🔥 **HEATER ALERT** — **${displayName}** is on a **${streak}-WIN STREAK** in **${guild.name}**! They can't be stopped!`
              );
            } catch (e) { /* DMs disabled */ }
          });
        await Promise.allSettled(dmPromises);
      } catch (e) {
        console.warn('[Streak] Could not send heater DMs:', e.message);
      }
    }

    console.log(`[Streak] ${displayName} is on a ${streak}-win streak${isHeater ? ' (HEATER)' : ''}`);
  } catch (err) {
    console.error('[Streak] Error checking streak:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────
// Streak Card Image
// ─────────────────────────────────────────────────────────────

async function generateStreakCardImage(displayName, streak, streakBets, isHeater) {
  const W = 500;
  const headerH = 80;
  const betRowH = 36;
  const listPad = 16;
  const maxBetsShown = Math.min(streakBets.length, 10);
  const listH = maxBetsShown * betRowH + listPad * 2;
  const H = headerH + listH + 30;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = C.bgMain;
  ctx.fillRect(0, 0, W, H);

  // Header banner
  const bannerGrad = ctx.createLinearGradient(0, 0, W, 0);
  if (isHeater) {
    bannerGrad.addColorStop(0, 'rgba(255, 80, 0, 0.4)');
    bannerGrad.addColorStop(1, 'rgba(255, 180, 0, 0.15)');
  } else {
    bannerGrad.addColorStop(0, 'rgba(67, 181, 129, 0.3)');
    bannerGrad.addColorStop(1, 'rgba(67, 181, 129, 0.05)');
  }
  ctx.fillStyle = bannerGrad;
  ctx.fillRect(0, 0, W, headerH);

  // Fire emoji area
  const fireEmoji = isHeater ? '🔥🔥🔥' : '🔥';
  ctx.font = `800 28px ${FF}`;
  ctx.fillStyle = isHeater ? '#FF6600' : C.win;
  ctx.fillText(fireEmoji, 16, 38);

  // Title
  ctx.font = `800 22px ${FF}`;
  ctx.fillStyle = C.textPrimary;
  const title = isHeater ? 'HEATER ALERT' : 'WIN STREAK';
  ctx.fillText(title, isHeater ? 105 : 50, 36);

  // Subtitle
  ctx.font = `600 14px ${FF}`;
  ctx.fillStyle = C.textSecondary;
  ctx.fillText(`${displayName} — ${streak} wins in a row`, isHeater ? 105 : 50, 58);

  // Brand logo
  const logo = await getBrandLogo();
  if (logo) {
    const logoSize = 40;
    ctx.save();
    roundRect(ctx, W - logoSize - 16, 20, logoSize, logoSize, 8);
    ctx.clip();
    ctx.drawImage(logo, W - logoSize - 16, 20, logoSize, logoSize);
    ctx.restore();
  }

  // Divider
  ctx.fillStyle = isHeater ? 'rgba(255, 120, 0, 0.3)' : 'rgba(67, 181, 129, 0.2)';
  ctx.fillRect(16, headerH, W - 32, 2);

  // Bet list
  const listY = headerH + listPad;
  for (let i = 0; i < maxBetsShown; i++) {
    const bet = streakBets[i];
    const rowY = listY + i * betRowH;

    // Row background (alternating)
    if (i % 2 === 0) {
      roundRect(ctx, 16, rowY, W - 32, betRowH - 4, 6);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.fill();
    }

    // Win indicator
    ctx.fillStyle = C.win;
    ctx.font = `700 12px ${FF}`;
    ctx.fillText('✅', 24, rowY + 22);

    // Slip number
    ctx.fillStyle = C.textMuted;
    ctx.font = `600 11px ${FF}`;
    ctx.fillText(bet.slip_number, 48, rowY + 22);

    // Pick
    ctx.fillStyle = C.textPrimary;
    ctx.font = `600 12px ${FF}`;
    let pickText = bet.bet_type === 'parlay'
      ? `${bet.parlay_legs?.length || '?'}-Leg Parlay`
      : (bet.pick || 'Unknown');
    if (pickText.length > 35) pickText = pickText.substring(0, 35) + '...';
    ctx.fillText(pickText, 120, rowY + 22);

    // Odds + Units
    const odds = bet.odds_american >= 0 ? `+${bet.odds_american}` : `${bet.odds_american}`;
    ctx.fillStyle = C.textSecondary;
    ctx.font = `500 11px ${FF}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${odds} | ${bet.units}u`, W - 24, rowY + 22);
    ctx.textAlign = 'left';
  }

  // Streak count badge
  const badgeW = 120;
  const badgeH = 30;
  const badgeX = W / 2 - badgeW / 2;
  const badgeY = H - 24;
  roundRect(ctx, badgeX, badgeY - badgeH, badgeW, badgeH, badgeH / 2);
  ctx.fillStyle = isHeater ? 'rgba(255, 100, 0, 0.3)' : 'rgba(67, 181, 129, 0.2)';
  ctx.fill();
  ctx.strokeStyle = isHeater ? '#FF6600' : C.win;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.font = `800 14px ${FF}`;
  ctx.fillStyle = isHeater ? '#FF6600' : C.win;
  ctx.textAlign = 'center';
  ctx.fillText(`${streak}W STREAK`, W / 2, badgeY - 8);
  ctx.textAlign = 'left';

  return canvas.toBuffer('image/png');
}

// ─────────────────────────────────────────────────────────────
// Daily Kings Weekly Record
// ─────────────────────────────────────────────────────────────

/**
 * Get the weekly record for a user (Sunday–Saturday or current rolling 7 days).
 */
async function getWeeklyRecord(discordId, guildId) {
  const now = new Date();
  // Start of this week (Sunday)
  const weekStart = new Date(now);
  const day = weekStart.getDay();
  weekStart.setDate(weekStart.getDate() - day);
  weekStart.setHours(0, 0, 0, 0);

  const { data: bets, error } = await supabase
    .from('bets')
    .select('id, status, pick, sport, odds_american, units, bet_type, closed_at, slip_number, parlay_legs(pick)')
    .eq('discord_id', discordId)
    .eq('guild_id', guildId)
    .in('status', ['win', 'loss', 'push'])
    .gte('closed_at', weekStart.toISOString())
    .order('closed_at', { ascending: true });

  if (error) { console.error('[DailyRecord] Query error:', error.message); return null; }
  if (!bets?.length) return null;

  const wins = bets.filter(b => b.status === 'win').length;
  const losses = bets.filter(b => b.status === 'loss').length;
  const pushes = bets.filter(b => b.status === 'push').length;

  let netUnits = 0;
  for (const b of bets) {
    if (b.status === 'win') {
      netUnits += b.odds_american >= 0
        ? b.units * (b.odds_american / 100)
        : b.units * (100 / Math.abs(b.odds_american));
    } else if (b.status === 'loss') {
      netUnits -= b.units;
    }
  }

  const winPct = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0;

  return { wins, losses, pushes, netUnits: parseFloat(netUnits.toFixed(2)), winPct, bets, weekStart };
}

/**
 * Generate weekly record card image.
 */
async function generateWeeklyRecordImage(displayName, record) {
  const W = 500;
  const headerH = 90;
  const statsH = 80;
  const betRowH = 32;
  const maxBets = Math.min(record.bets.length, 15);
  const listH = maxBets * betRowH + 24;
  const H = headerH + statsH + listH + 30;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = C.bgMain;
  ctx.fillRect(0, 0, W, H);

  // Header
  const hGrad = ctx.createLinearGradient(0, 0, W, 0);
  hGrad.addColorStop(0, 'rgba(255, 135, 50, 0.25)');
  hGrad.addColorStop(1, 'rgba(255, 135, 50, 0.05)');
  ctx.fillStyle = hGrad;
  ctx.fillRect(0, 0, W, headerH);

  // Brand logo
  const logo = await getBrandLogo();
  if (logo) {
    const logoSize = 50;
    ctx.save();
    roundRect(ctx, 16, 20, logoSize, logoSize, 10);
    ctx.clip();
    ctx.drawImage(logo, 16, 20, logoSize, logoSize);
    ctx.restore();
  }

  // Title
  ctx.font = `800 22px ${FF}`;
  ctx.fillStyle = C.textPrimary;
  ctx.fillText(`${displayName}'s Weekly Record`, 80, 42);

  // Date range
  const weekEnd = new Date(record.weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  ctx.font = `500 13px ${FF}`;
  ctx.fillStyle = C.textSecondary;
  ctx.fillText(`${fmt(record.weekStart)} — ${fmt(weekEnd)}`, 80, 62);

  // Divider 
  ctx.fillStyle = 'rgba(255, 135, 50, 0.2)';
  ctx.fillRect(16, headerH, W - 32, 2);

  // Stats row
  const statY = headerH + 16;
  const statBoxW = (W - 64) / 4;
  const stats = [
    { label: 'RECORD', value: `${record.wins}-${record.losses}${record.pushes ? `-${record.pushes}` : ''}`, color: C.textPrimary },
    { label: 'WIN %', value: `${record.winPct}%`, color: record.winPct >= 50 ? C.win : C.loss },
    { label: 'NET UNITS', value: `${record.netUnits >= 0 ? '+' : ''}${record.netUnits}u`, color: record.netUnits >= 0 ? C.win : C.loss },
    { label: 'TOTAL BETS', value: `${record.bets.length}`, color: C.textPrimary },
  ];

  stats.forEach((s, i) => {
    const sx = 16 + i * (statBoxW + 8);
    roundRect(ctx, sx, statY, statBoxW, 52, 8);
    ctx.fillStyle = C.bgSection;
    ctx.fill();

    ctx.font = `800 18px ${FF}`;
    ctx.fillStyle = s.color;
    ctx.textAlign = 'center';
    ctx.fillText(s.value, sx + statBoxW / 2, statY + 26);

    ctx.font = `500 9px ${FF}`;
    ctx.fillStyle = C.textMuted;
    ctx.fillText(s.label, sx + statBoxW / 2, statY + 42);
    ctx.textAlign = 'left';
  });

  // Bet list
  const listY = headerH + statsH + 8;
  for (let i = 0; i < maxBets; i++) {
    const bet = record.bets[i];
    const rowY = listY + i * betRowH;

    if (i % 2 === 0) {
      roundRect(ctx, 16, rowY, W - 32, betRowH - 2, 5);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.fill();
    }

    // Status emoji
    const emoji = bet.status === 'win' ? '✅' : bet.status === 'loss' ? '❌' : '🔄';
    ctx.font = `600 11px ${FF}`;
    ctx.fillStyle = C.textPrimary;
    ctx.fillText(emoji, 24, rowY + 20);

    // Slip
    ctx.fillStyle = C.textMuted;
    ctx.font = `600 10px ${FF}`;
    ctx.fillText(bet.slip_number, 48, rowY + 20);

    // Pick
    ctx.fillStyle = C.textPrimary;
    ctx.font = `600 11px ${FF}`;
    let pick = bet.bet_type === 'parlay'
      ? `${bet.parlay_legs?.length || '?'}-Leg Parlay`
      : (bet.pick || 'Unknown');
    if (pick.length > 32) pick = pick.substring(0, 32) + '...';
    ctx.fillText(pick, 115, rowY + 20);

    // Result / odds
    const odds = bet.odds_american >= 0 ? `+${bet.odds_american}` : `${bet.odds_american}`;
    ctx.fillStyle = C.textSecondary;
    ctx.font = `500 10px ${FF}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${odds} | ${bet.units}u`, W - 24, rowY + 20);
    ctx.textAlign = 'left';
  }

  return canvas.toBuffer('image/png');
}

/**
 * Post the Kings daily record to the designated channel.
 */
async function postDailyKingsRecord(client) {
  try {
    const guild = client.guilds.cache.first(); // Primary guild
    if (!guild) return;

    const record = await getWeeklyRecord(KINGS_USER_ID, guild.id);
    if (!record) {
      console.log('[DailyRecord] No bets this week for the King');
      return;
    }

    let displayName = 'The Gambling King';
    try {
      const member = await guild.members.fetch(KINGS_USER_ID);
      displayName = member.displayName;
    } catch (e) {}

    const imgBuffer = await generateWeeklyRecordImage(displayName, record);
    const { AttachmentBuilder } = require('discord.js');
    const attachment = new AttachmentBuilder(imgBuffer, { name: 'weekly-record.png' });

    const channel = await client.channels.fetch(KINGS_RECORD_CHANNEL_ID).catch(() => null);
    if (!channel) {
      console.warn('[DailyRecord] Channel not found:', KINGS_RECORD_CHANNEL_ID);
      return;
    }

    const netSign = record.netUnits >= 0 ? '+' : '';
    await channel.send({
      content: `👑 **Daily Update — ${displayName}'s Weekly Record**\n📊 **${record.wins}-${record.losses}** | ${record.winPct}% | ${netSign}${record.netUnits}u`,
      files: [attachment],
    });

    console.log(`[DailyRecord] Posted Kings weekly record: ${record.wins}-${record.losses}`);
  } catch (err) {
    console.error('[DailyRecord] Error posting record:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────
// Daily 8 AM ET Scheduler
// ─────────────────────────────────────────────────────────────

let lastDailyPostDate = null;

/**
 * Get current hour/minute in America/New_York using reliable Intl API.
 * Works correctly on UTC servers.
 */
function getETComponents() {
  const now = new Date();
  // Use Intl.DateTimeFormat to get reliable ET components (handles DST)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: 'numeric', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);

  const get = type => parts.find(p => p.type === type)?.value;
  return {
    hour: parseInt(get('hour'), 10),
    minute: parseInt(get('minute'), 10),
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

/**
 * Start the daily record scheduler. Checks every 60s if it's 8 AM ET.
 */
function startDailyRecordScheduler(client) {
  setInterval(() => {
    const { hour, minute, dateKey } = getETComponents();

    // Fire at 8:00 AM ET, once per day
    if (hour === 8 && minute === 0 && lastDailyPostDate !== dateKey) {
      lastDailyPostDate = dateKey;
      postDailyKingsRecord(client).catch(err =>
        console.error('[DailyRecord] Scheduler error:', err.message)
      );
    }
  }, 60_000);

  console.log('   👑 Daily Kings record scheduler started (8 AM ET)');
}

module.exports = {
  getWinStreak,
  checkAndNotifyStreak,
  generateStreakCardImage,
  getWeeklyRecord,
  generateWeeklyRecordImage,
  postDailyKingsRecord,
  startDailyRecordScheduler,
  STREAK_CHANNEL_ID,
  KINGS_USER_ID,
  KINGS_RECORD_CHANNEL_ID,
};
