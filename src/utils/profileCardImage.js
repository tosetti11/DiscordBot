/**
 * Profile Card Image Generator
 * 
 * Generates a Discord-style profile card as a PNG image.
 * Shows record, ROI, streaks, badges, best/worst sport, top teams, etc.
 */

const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const { SPORT_NAMES, WAGER_TYPES } = require('../config/constants');

// ── Font setup (shared with betCardImage) ──
const FONT_PATH = path.join(__dirname, '..', 'fonts', 'Inter-Variable.ttf');
const EMOJI_FONT_PATH = path.join(__dirname, '..', 'fonts', 'NotoColorEmoji.ttf');
try { GlobalFonts.registerFromPath(FONT_PATH, 'Inter'); } catch (e) {}
try { GlobalFonts.registerFromPath(EMOJI_FONT_PATH, 'NotoColorEmoji'); } catch (e) {}
const FF = '"Inter", "NotoColorEmoji", sans-serif';

// ── Colors ──
const C = {
  bgMain: '#111214',
  bgCard: '#1a1b1e',
  bgBanner: '#232428',
  bgSection: '#232428',
  bgDarker: '#111214',
  accent: '#FF8732',
  accentFaint: 'rgba(255, 135, 50, 0.15)',
  win: '#43b581',
  loss: '#ff4444',
  push: '#aaa',
  gold: '#F5C518',
  textPrimary: '#ffffff',
  textSecondary: '#b3b3b3',
  textMuted: '#72767d',
  divider: 'rgba(255, 255, 255, 0.06)',
  badgeBg: 'rgba(255, 255, 255, 0.06)',
};

// ── Preload brand logo ──
let brandLogoPromise = null;
function getBrandLogo() {
  if (!brandLogoPromise) {
    const logoPath = path.join(__dirname, '..', 'web', 'public', 'TheGamblingKing.jpg');
    brandLogoPromise = loadImage(logoPath).catch(() => null);
  }
  return brandLogoPromise;
}

// ── Drawing helpers ──

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

function drawPill(ctx, x, y, text, bgColor, textColor, fontSize = 11, paddingX = 8, paddingY = 3) {
  ctx.font = `600 ${fontSize}px ${FF}`;
  const m = ctx.measureText(text);
  const pw = paddingX * 2 + m.width;
  const ph = paddingY * 2 + fontSize;
  roundRect(ctx, x, y, pw, ph, ph / 2);
  ctx.fillStyle = bgColor;
  ctx.fill();
  ctx.fillStyle = textColor;
  ctx.fillText(text, x + paddingX, y + paddingY + fontSize - 2);
  return pw;
}

function drawStatBox(ctx, x, y, w, h, label, value, valueColor = C.textPrimary) {
  // Background
  roundRect(ctx, x, y, w, h, 8);
  ctx.fillStyle = C.bgSection;
  ctx.fill();

  // Value
  ctx.font = `800 18px ${FF}`;
  ctx.fillStyle = valueColor;
  ctx.textAlign = 'center';
  ctx.fillText(value, x + w / 2, y + 28);

  // Label
  ctx.font = `500 10px ${FF}`;
  ctx.fillStyle = C.textMuted;
  ctx.fillText(label, x + w / 2, y + 44);

  ctx.textAlign = 'left';
}

function drawBarSection(ctx, x, y, w, label, value, maxValue, barColor, textColor = C.textSecondary) {
  // Label
  ctx.font = `500 11px ${FF}`;
  ctx.fillStyle = C.textMuted;
  ctx.fillText(label, x, y + 12);

  // Value
  ctx.textAlign = 'right';
  ctx.fillStyle = textColor;
  ctx.font = `600 11px ${FF}`;
  ctx.fillText(value, x + w, y + 12);
  ctx.textAlign = 'left';

  // Bar background
  const barY = y + 18;
  const barH = 6;
  roundRect(ctx, x, barY, w, barH, 3);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fill();

  // Bar fill
  const pct = maxValue > 0 ? Math.min(1, Math.max(0, Number(value.replace(/[^0-9.-]/g, '')) / maxValue)) : 0;
  if (pct > 0) {
    roundRect(ctx, x, barY, Math.max(6, w * pct), barH, 3);
    ctx.fillStyle = barColor;
    ctx.fill();
  }

  return barY + barH + 8;
}

/**
 * Generate a profile card image
 * @param {Object} opts
 * @param {string} opts.displayName
 * @param {string} opts.avatarUrl - Discord avatar URL
 * @param {Object} opts.stats - stats from the API
 * @param {Array}  opts.badges - [{emoji, name}]
 * @param {string} [opts.memberSince] - join date string
 * @returns {Promise<Buffer>} PNG buffer
 */
async function generateProfileCardImage(opts) {
  const { displayName, avatarUrl, stats, badges = [], memberSince } = opts;

  const W = 480;
  const PAD = 20;
  const INNER = W - PAD * 2;

  // Load assets
  const [brandLogo, avatar] = await Promise.all([
    getBrandLogo(),
    avatarUrl ? loadImage(avatarUrl).catch(() => null) : null,
  ]);

  // ── Pre-calculate height ──
  let totalH = 0;

  // Banner
  const BANNER_H = 80;
  totalH += BANNER_H;

  // Avatar area (overlapping banner)
  const AVATAR_SIZE = 80;
  const AVATAR_OVERLAP = 40;
  totalH += AVATAR_SIZE - AVATAR_OVERLAP + 10; // name spacing

  // Name + badges
  totalH += 32; // name
  if (badges.length > 0) totalH += 26; // badge row
  totalH += 12; // gap

  // Member since
  if (memberSince) totalH += 18;
  totalH += 16; // gap

  // Divider
  totalH += 1;

  // ── Stats Grid (2 rows of 4) ──
  totalH += 16; // top padding
  totalH += 52; // row 1
  totalH += 8;  // gap
  totalH += 52; // row 2
  totalH += 16; // bottom padding

  // Divider
  totalH += 1;

  // ── Best/Worst sport + Favorite bet type section ──
  totalH += 16;
  totalH += 20; // 'PERFORMANCE' header
  totalH += 8;
  totalH += 28 * 3; // 3 stat rows (best sport, worst sport, fav bet type)
  totalH += 16;

  // Divider
  totalH += 1;

  // ── Top Teams ──
  const topTeams = stats.topTeams || [];
  if (topTeams.length > 0) {
    totalH += 16;
    totalH += 20; // header
    totalH += 8;
    totalH += topTeams.length * 28;
    totalH += 16;
    totalH += 1; // divider
  }

  // ── Streaks & Biggest Win ──
  totalH += 16;
  totalH += 20; // 'HIGHLIGHTS' header
  totalH += 8;
  totalH += 28; // Current streak
  totalH += 28; // Best streak
  totalH += 28; // Worst streak
  totalH += 28; // Biggest win
  totalH += 16;

  // Footer
  totalH += 34;

  // ── Create canvas ──
  const canvas = createCanvas(W, totalH);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = C.bgCard;
  roundRect(ctx, 0, 0, W, totalH, 16);
  ctx.fill();
  ctx.save();
  roundRect(ctx, 0, 0, W, totalH, 16);
  ctx.clip();

  let y = 0;

  // ── Banner ──
  const bannerGrad = ctx.createLinearGradient(0, 0, W, BANNER_H);
  bannerGrad.addColorStop(0, '#4a2c17');
  bannerGrad.addColorStop(0.5, '#8B4513');
  bannerGrad.addColorStop(1, '#4a2c17');
  ctx.fillStyle = bannerGrad;
  ctx.fillRect(0, 0, W, BANNER_H);

  // Subtle pattern overlay
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(0, 0, W, BANNER_H);

  // Brand watermark on banner
  if (brandLogo) {
    ctx.globalAlpha = 0.12;
    ctx.drawImage(brandLogo, W - 80, 10, 60, 60);
    ctx.globalAlpha = 1;
  }

  y = BANNER_H;

  // ── Avatar ──
  const avatarX = PAD;
  const avatarY = y - AVATAR_OVERLAP;

  // Avatar border
  ctx.beginPath();
  ctx.arc(avatarX + AVATAR_SIZE / 2, avatarY + AVATAR_SIZE / 2, AVATAR_SIZE / 2 + 4, 0, Math.PI * 2);
  ctx.fillStyle = C.bgCard;
  ctx.fill();

  // Avatar image
  if (avatar) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + AVATAR_SIZE / 2, avatarY + AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatar, avatarX, avatarY, AVATAR_SIZE, AVATAR_SIZE);
    ctx.restore();
  } else {
    // Default avatar circle
    ctx.beginPath();
    ctx.arc(avatarX + AVATAR_SIZE / 2, avatarY + AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#36393f';
    ctx.fill();
    ctx.font = `800 28px ${FF}`;
    ctx.fillStyle = C.textPrimary;
    ctx.textAlign = 'center';
    ctx.fillText(displayName.charAt(0).toUpperCase(), avatarX + AVATAR_SIZE / 2, avatarY + AVATAR_SIZE / 2 + 10);
    ctx.textAlign = 'left';
  }

  // Online indicator dot
  ctx.beginPath();
  ctx.arc(avatarX + AVATAR_SIZE - 4, avatarY + AVATAR_SIZE - 4, 10, 0, Math.PI * 2);
  ctx.fillStyle = C.bgCard;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(avatarX + AVATAR_SIZE - 4, avatarY + AVATAR_SIZE - 4, 7, 0, Math.PI * 2);
  ctx.fillStyle = C.win;
  ctx.fill();

  y = avatarY + AVATAR_SIZE + 10;

  // ── Name ──
  ctx.font = `800 22px ${FF}`;
  ctx.fillStyle = C.textPrimary;
  const nameText = displayName.length > 22 ? displayName.substring(0, 20) + '…' : displayName;
  ctx.fillText(nameText, PAD, y + 18);
  y += 32;

  // ── Badge row ──
  if (badges.length > 0) {
    let bx = PAD;
    for (const badge of badges) {
      const pillW = drawPill(ctx, bx, y, `${badge.emoji} ${badge.name.replace(/^[^\w\s]+\s*/, '')}`, C.badgeBg, C.accent, 10, 6, 3);
      bx += pillW + 4;
      if (bx > W - PAD - 50) break; // don't overflow
    }
    y += 26;
  }

  y += 12;

  // Member since
  if (memberSince) {
    ctx.font = `500 11px ${FF}`;
    ctx.fillStyle = C.textMuted;
    ctx.fillText(`Member since ${memberSince}`, PAD, y + 11);
    y += 18;
  }

  y += 16;

  // ── Divider ──
  ctx.fillStyle = C.divider;
  ctx.fillRect(PAD, y, INNER, 1);
  y += 1;

  // ── Stats Grid ──
  y += 16;
  const boxW = (INNER - 24) / 4; // 4 boxes per row, 8px gaps
  const boxH = 52;

  const record = `${stats.wins || 0}-${stats.losses || 0}`;
  const roi = stats.roi != null ? `${stats.roi > 0 ? '+' : ''}${stats.roi}%` : '0%';
  const winPct = stats.winPct != null ? `${stats.winPct}%` : '0%';
  const netUnits = stats.netUnits != null ? `${stats.netUnits > 0 ? '+' : ''}${parseFloat(stats.netUnits.toFixed(2))}u` : '0u';

  // Row 1: Record, Win%, ROI, Net Units
  drawStatBox(ctx, PAD, y, boxW, boxH, 'RECORD', record, C.textPrimary);
  drawStatBox(ctx, PAD + boxW + 8, y, boxW, boxH, 'WIN %', winPct, stats.winPct >= 55 ? C.win : stats.winPct < 45 ? C.loss : C.textPrimary);
  drawStatBox(ctx, PAD + (boxW + 8) * 2, y, boxW, boxH, 'ROI', roi, stats.roi > 0 ? C.win : stats.roi < 0 ? C.loss : C.textPrimary);
  drawStatBox(ctx, PAD + (boxW + 8) * 3, y, boxW, boxH, 'UNITS', netUnits, stats.netUnits > 0 ? C.win : stats.netUnits < 0 ? C.loss : C.textPrimary);
  y += boxH + 8;

  // Row 2: Total Bets, Avg Odds, Pushes, Open
  const avgOddsStr = stats.avgOdds ? (stats.avgOdds > 0 ? `+${stats.avgOdds}` : `${stats.avgOdds}`) : '—';
  drawStatBox(ctx, PAD, y, boxW, boxH, 'TOTAL BETS', String(stats.total || 0), C.textPrimary);
  drawStatBox(ctx, PAD + boxW + 8, y, boxW, boxH, 'AVG ODDS', avgOddsStr, C.textSecondary);
  drawStatBox(ctx, PAD + (boxW + 8) * 2, y, boxW, boxH, 'PUSHES', String(stats.pushes || 0), C.push);
  drawStatBox(ctx, PAD + (boxW + 8) * 3, y, boxW, boxH, 'OPEN', String(stats.open || 0), C.accent);
  y += boxH + 16;

  // ── Divider ──
  ctx.fillStyle = C.divider;
  ctx.fillRect(PAD, y, INNER, 1);
  y += 1;

  // ── Performance Section ──
  y += 16;
  ctx.font = `800 11px ${FF}`;
  ctx.fillStyle = C.textMuted;
  ctx.fillText('PERFORMANCE', PAD, y + 11);
  y += 20 + 8;

  // Best sport
  const bestSport = stats.bestSport || { name: '—', winPct: 0, record: '—' };
  const worstSport = stats.worstSport || { name: '—', winPct: 0, record: '—' };
  const favBetType = stats.favBetType || { name: '—', count: 0 };

  // Performance rows
  const perfRows = [
    { label: '🏆 Best Sport', value: `${bestSport.name}  ${bestSport.record || ''}  (${bestSport.winPct}%)`, color: C.win },
    { label: '💀 Worst Sport', value: `${worstSport.name}  ${worstSport.record || ''}  (${worstSport.winPct}%)`, color: C.loss },
    { label: '🎯 Favorite Bet', value: `${favBetType.name}  (${favBetType.count} bets)`, color: C.accent },
  ];

  for (const row of perfRows) {
    ctx.font = `500 12px ${FF}`;
    ctx.fillStyle = C.textMuted;
    ctx.fillText(row.label, PAD, y + 16);

    ctx.textAlign = 'right';
    ctx.font = `600 12px ${FF}`;
    ctx.fillStyle = row.color;
    ctx.fillText(row.value, W - PAD, y + 16);
    ctx.textAlign = 'left';

    y += 28;
  }
  y += 16;

  // ── Divider ──
  ctx.fillStyle = C.divider;
  ctx.fillRect(PAD, y, INNER, 1);
  y += 1;

  // ── Top Teams ──
  if (topTeams.length > 0) {
    y += 16;
    ctx.font = `800 11px ${FF}`;
    ctx.fillStyle = C.textMuted;
    ctx.fillText('TOP TEAMS', PAD, y + 11);
    y += 20 + 8;

    for (let i = 0; i < topTeams.length; i++) {
      const t = topTeams[i];
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;

      ctx.font = `500 12px ${FF}`;
      ctx.fillStyle = C.textSecondary;
      ctx.fillText(`${medal}  ${t.team}`, PAD, y + 16);

      ctx.textAlign = 'right';
      ctx.font = `600 12px ${FF}`;
      ctx.fillStyle = t.netUnits >= 0 ? C.win : C.loss;
      ctx.fillText(`${t.record}  |  ${t.netUnits > 0 ? '+' : ''}${parseFloat(t.netUnits.toFixed(2))}u`, W - PAD, y + 16);
      ctx.textAlign = 'left';

      y += 28;
    }
    y += 16;

    ctx.fillStyle = C.divider;
    ctx.fillRect(PAD, y, INNER, 1);
    y += 1;
  }

  // ── Highlights Section ──
  y += 16;
  ctx.font = `800 11px ${FF}`;
  ctx.fillStyle = C.textMuted;
  ctx.fillText('HIGHLIGHTS', PAD, y + 11);
  y += 20 + 8;

  const streak = stats.streak || { count: 0, type: '' };
  const currentStreakText = streak.count > 0
    ? `${streak.type === 'win' ? '🔥' : '❄️'} ${streak.count} ${streak.type === 'win' ? 'W' : 'L'} streak`
    : '— No streak';

  const bestStreak = stats.bestStreak || { count: 0 };
  const worstStreak = stats.worstStreak || { count: 0 };
  const biggestWin = stats.biggestWin || null;

  const highlightRows = [
    { label: '📊 Current Streak', value: currentStreakText, color: streak.type === 'win' ? C.win : streak.type === 'loss' ? C.loss : C.textSecondary },
    { label: '🔥 Best Win Streak', value: bestStreak.count > 0 ? `${bestStreak.count}W` : '—', color: C.win },
    { label: '❄️ Worst Loss Streak', value: worstStreak.count > 0 ? `${worstStreak.count}L` : '—', color: C.loss },
    { label: '💰 Biggest Win', value: biggestWin ? `+${parseFloat(biggestWin.payout.toFixed(2))}u  (${biggestWin.pick || 'Bet'})` : '—', color: C.gold },
  ];

  for (const row of highlightRows) {
    ctx.font = `500 12px ${FF}`;
    ctx.fillStyle = C.textMuted;
    ctx.fillText(row.label, PAD, y + 16);

    ctx.textAlign = 'right';
    ctx.font = `600 12px ${FF}`;
    ctx.fillStyle = row.color;
    const valText = row.value.length > 32 ? row.value.substring(0, 30) + '…' : row.value;
    ctx.fillText(valText, W - PAD, y + 16);
    ctx.textAlign = 'left';

    y += 28;
  }
  y += 16;

  // ── Footer ──
  ctx.fillStyle = C.bgDarker;
  roundRect(ctx, 0, y, W, 34, 0);
  ctx.fill();

  ctx.font = `500 10px ${FF}`;
  ctx.fillStyle = C.textMuted;
  ctx.textAlign = 'center';
  ctx.fillText('thegamblingkingapp.com', W / 2, y + 20);
  ctx.textAlign = 'left';

  ctx.restore();

  // Card border
  roundRect(ctx, 0, 0, W, totalH, 16);
  ctx.strokeStyle = 'rgba(255, 135, 50, 0.15)';
  ctx.lineWidth = 1;
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

module.exports = { generateProfileCardImage };
