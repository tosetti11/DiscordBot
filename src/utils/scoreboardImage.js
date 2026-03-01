/**
 * Scoreboard Image Generator
 * Renders an ESPN-style "score bug" as a PNG image using @napi-rs/canvas.
 * 
 * Layout (ESPN score bug style):
 * ┌─────────────────────────────────────────────────────────┐
 * │ ▌ AWAY TEAM        SCORE │ Q3  4:32 │         │
 * │ ▌ HOME TEAM        SCORE │  LIVE    │  props  │
 * └─────────────────────────────────────────────────────────┘
 */
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const { SPORT_NAMES } = require('../config/constants');

// ── Fonts (reuse from betCardImage) ──
const FONT_PATH = path.join(__dirname, '..', 'fonts', 'Inter-Variable.ttf');
const EMOJI_FONT_PATH = path.join(__dirname, '..', 'fonts', 'NotoColorEmoji.ttf');
try { GlobalFonts.registerFromPath(FONT_PATH, 'Inter'); } catch {}
try { GlobalFonts.registerFromPath(EMOJI_FONT_PATH, 'NotoColorEmoji'); } catch {}
const FF = '"Inter", "NotoColorEmoji", sans-serif';

// ── Colors ──
const C = {
  bg: '#1a1a2e',
  bgDark: '#0f0f1a',
  bgPanel: '#16213e',
  bgRow: '#1a1a2e',
  bgRowAlt: '#1e2640',
  divider: 'rgba(255, 255, 255, 0.08)',
  accent: '#FF8732',
  live: '#ff4444',
  liveGlow: 'rgba(255, 68, 68, 0.3)',
  pre: '#5865F2',
  post: '#43b581',
  textWhite: '#ffffff',
  textLight: '#e0e0e0',
  textMuted: '#8899aa',
  textDim: '#556677',
  scoreWhite: '#ffffff',
  scoreDim: '#667788',
  propHit: '#43b581',
  propClose: '#f0a830',
  propTracking: '#8899aa',
  propMissed: '#ff4444',
};

// ── Sport-specific period labels ──
const PERIOD_LABELS = {
  nba: { name: 'QTR', labels: ['Q1', 'Q2', 'Q3', 'Q4', 'OT'] },
  nfl: { name: 'QTR', labels: ['Q1', 'Q2', 'Q3', 'Q4', 'OT'] },
  nhl: { name: 'PER', labels: ['P1', 'P2', 'P3', 'OT', 'SO'] },
  mlb: { name: 'INN', labels: null },  // uses "Top 3rd", "Bot 7th" etc.
  cfb: { name: 'QTR', labels: ['Q1', 'Q2', 'Q3', 'Q4', 'OT'] },
  cbb: { name: 'HALF', labels: ['1H', '2H', 'OT'] },
  ncaa_football: { name: 'QTR', labels: ['Q1', 'Q2', 'Q3', 'Q4', 'OT'] },
  ncaa_mbb: { name: 'HALF', labels: ['1H', '2H', 'OT'] },
  ncaa_wbb: { name: 'QTR', labels: ['Q1', 'Q2', 'Q3', 'Q4', 'OT'] },
  mma: { name: 'RND', labels: ['R1', 'R2', 'R3', 'R4', 'R5'] },
  wnba: { name: 'QTR', labels: ['Q1', 'Q2', 'Q3', 'Q4', 'OT'] },
};

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

function drawTeamColorBar(ctx, x, y, w, h, color) {
  ctx.fillStyle = color || '#555';
  ctx.fillRect(x, y, w, h);
}

/**
 * Get formatted period text
 */
function getPeriodText(game) {
  if (game.state === 'pre') return '';
  if (game.state === 'post') return 'FINAL';

  const sportPeriods = PERIOD_LABELS[game.sport];
  if (!sportPeriods) return game.detail || '';

  if (game.sport === 'mlb') {
    return game.detail || `Inning ${game.period}`;
  }

  const period = game.period || 1;
  if (sportPeriods.labels && period <= sportPeriods.labels.length) {
    return sportPeriods.labels[period - 1];
  }
  return `${sportPeriods.name} ${period}`;
}

/**
 * Get game start time in ET
 */
function getStartTimeET(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/New_York',
    }) + ' ET';
  } catch {
    return '';
  }
}

/**
 * Logo cache to avoid re-downloading
 */
const logoCache = new Map();

async function loadLogo(url, size = 32) {
  if (!url) return null;
  const key = `${url}:${size}`;
  if (logoCache.has(key)) return logoCache.get(key);

  try {
    const img = await loadImage(url);
    logoCache.set(key, img);
    return img;
  } catch {
    logoCache.set(key, null);
    return null;
  }
}

// ── Preload brand logo ──
let brandLogoPromise = null;
function getBrandLogo() {
  if (!brandLogoPromise) {
    const logoPath = path.join(__dirname, '..', 'web', 'public', 'TheGamblingKing.jpg');
    brandLogoPromise = loadImage(logoPath).catch(() => null);
  }
  return brandLogoPromise;
}

/**
 * Generate an ESPN-style score bug image
 * 
 * @param {Object} game - Game data from ESPN service
 * @param {Array} [props] - Optional player prop bets to track
 *   Each: { playerName, propDescription, direction, line, currentStat, status }
 * @param {Object} [options] - Optional rendering options
 * @returns {Buffer} PNG image buffer
 */
async function generateScoreboardImage(game, props = [], options = {}) {
  const W = 480;
  const ROW_H = 44;
  const TEAM_ROWS = 2;  // away + home
  const COLOR_BAR_W = 5;
  const PAD = 14;
  const LOGO_SIZE = 28;
  const STATUS_W = 90;

  // ── Calculate height ──
  let H = 0;
  const HEADER_H = 28;   // sport label bar
  H += HEADER_H;
  H += ROW_H * TEAM_ROWS; // team rows

  // Props section
  const hasProps = props.length > 0;
  if (hasProps) {
    H += 1;  // divider
    H += 24; // "YOUR PROPS" header
    H += props.length * 24; // prop rows
    H += 8;  // bottom padding
  }

  const FOOTER_H = 20;
  H += FOOTER_H;

  // ── Create canvas ──
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // ── Background ──
  roundRect(ctx, 0, 0, W, H, 10);
  ctx.fillStyle = C.bg;
  ctx.fill();
  ctx.save();
  ctx.clip();

  // ── Header bar (sport + broadcast) ──
  ctx.fillStyle = C.bgDark;
  ctx.fillRect(0, 0, W, HEADER_H);

  const sportLabel = (SPORT_NAMES[game.sport] || game.sport || '').toUpperCase();
  ctx.font = '700 10px ' + FF;
  ctx.fillStyle = C.accent;
  ctx.fillText(sportLabel, PAD, 17);

  // State indicator on right
  const stateLabel = game.state === 'in' ? '● LIVE' : game.state === 'post' ? 'FINAL' : getStartTimeET(game.startTime);
  ctx.font = '700 10px ' + FF;
  if (game.state === 'in') {
    ctx.fillStyle = C.live;
  } else if (game.state === 'post') {
    ctx.fillStyle = C.post;
  } else {
    ctx.fillStyle = C.textMuted;
  }
  const stateW = ctx.measureText(stateLabel).width;
  ctx.fillText(stateLabel, W - PAD - stateW, 17);

  // Broadcast info
  if (game.broadcast) {
    ctx.font = '10px ' + FF;
    ctx.fillStyle = C.textDim;
    const broadcastW = ctx.measureText(game.broadcast).width;
    ctx.fillText(game.broadcast, W - PAD - stateW - broadcastW - 10, 17);
  }

  let curY = HEADER_H;

  // ── Load logos ──
  const [awayLogo, homeLogo] = await Promise.all([
    loadLogo(game.away?.logo),
    loadLogo(game.home?.logo),
  ]);

  // ── Team rows ──
  const teams = [
    { data: game.away, logo: awayLogo, isHome: false },
    { data: game.home, logo: homeLogo, isHome: true },
  ];

  for (let i = 0; i < teams.length; i++) {
    const { data, logo, isHome } = teams[i];
    const rowY = curY;

    // Row background
    ctx.fillStyle = i % 2 === 0 ? C.bgRow : C.bgRowAlt;
    ctx.fillRect(0, rowY, W, ROW_H);

    // Team color bar (left edge)
    drawTeamColorBar(ctx, 0, rowY, COLOR_BAR_W, ROW_H, data.color);

    // Divider line between rows
    if (i > 0) {
      ctx.strokeStyle = C.divider;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, rowY);
      ctx.lineTo(W, rowY);
      ctx.stroke();
    }

    let x = COLOR_BAR_W + PAD;

    // Team logo
    if (logo) {
      try {
        ctx.drawImage(logo, x, rowY + (ROW_H - LOGO_SIZE) / 2, LOGO_SIZE, LOGO_SIZE);
      } catch {}
    }
    x += LOGO_SIZE + 10;

    // Team abbreviation
    ctx.font = '700 18px ' + FF;
    ctx.fillStyle = C.textWhite;
    ctx.fillText(data.abbreviation || data.shortName || '', x, rowY + 28);

    // Record (smaller, next to name)
    if (data.record) {
      const abbrW = ctx.measureText(data.abbreviation || data.shortName || '').width;
      ctx.font = '11px ' + FF;
      ctx.fillStyle = C.textDim;
      ctx.fillText(`(${data.record})`, x + abbrW + 8, rowY + 27);
    }

    // Score
    const score = data.score != null ? String(data.score) : '—';
    const isWinning = game.state !== 'pre' &&
      ((isHome && game.home.score > game.away.score) ||
       (!isHome && game.away.score > game.home.score));

    ctx.font = '700 24px ' + FF;
    ctx.fillStyle = isWinning || game.state === 'pre' ? C.scoreWhite : C.scoreDim;
    const scoreW = ctx.measureText(score).width;

    // Score position — right-aligned before status section
    const scoreX = W - STATUS_W - PAD - scoreW;
    ctx.fillText(score, scoreX, rowY + 30);

    // Status section (period/clock) — on first row only
    if (i === 0 && game.state === 'in') {
      const periodText = getPeriodText(game);
      const clockText = game.clock || '';

      // Period
      ctx.font = '700 11px ' + FF;
      ctx.fillStyle = C.textMuted;
      const periodTextW = ctx.measureText(periodText).width;
      const statusX = W - STATUS_W / 2 - periodTextW / 2;
      ctx.fillText(periodText, W - STATUS_W / 2 - periodTextW / 2, rowY + 18);

      // Clock
      if (clockText) {
        ctx.font = '700 14px ' + FF;
        ctx.fillStyle = C.textWhite;
        const clockW = ctx.measureText(clockText).width;
        ctx.fillText(clockText, W - STATUS_W / 2 - clockW / 2, rowY + 36);
      }
    } else if (i === 0 && game.state === 'post') {
      ctx.font = '700 14px ' + FF;
      ctx.fillStyle = C.post;
      const finalW = ctx.measureText('FINAL').width;
      ctx.fillText('FINAL', W - STATUS_W / 2 - finalW / 2, rowY + 28);
    } else if (i === 0 && game.state === 'pre') {
      const timeStr = getStartTimeET(game.startTime);
      if (timeStr) {
        ctx.font = '11px ' + FF;
        ctx.fillStyle = C.textMuted;
        const timeW = ctx.measureText(timeStr).width;
        ctx.fillText(timeStr, W - STATUS_W / 2 - timeW / 2, rowY + 28);
      }
    }

    // Vertical divider before status area (spanning both rows)
    if (i === 0) {
      ctx.strokeStyle = C.divider;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(W - STATUS_W, rowY);
      ctx.lineTo(W - STATUS_W, rowY + ROW_H * 2);
      ctx.stroke();
    }

    curY += ROW_H;
  }

  // ── Props section ──
  if (hasProps) {
    // Divider
    ctx.fillStyle = C.bgDark;
    ctx.fillRect(0, curY, W, 1);
    curY += 1;

    // Props header
    ctx.fillStyle = C.bgDark;
    ctx.fillRect(0, curY, W, 24);
    ctx.font = '700 9px ' + FF;
    ctx.fillStyle = C.accent;
    ctx.fillText('📊  YOUR PROPS', PAD, curY + 16);
    curY += 24;

    // Prop rows
    for (let i = 0; i < props.length; i++) {
      const prop = props[i];
      const propY = curY;

      ctx.fillStyle = i % 2 === 0 ? C.bgRow : C.bgRowAlt;
      ctx.fillRect(0, propY, W, 24);

      // Status icon
      let icon = '⏳';
      let iconColor = C.propTracking;
      if (prop.status === 'hit') { icon = '✅'; iconColor = C.propHit; }
      else if (prop.status === 'close') { icon = '🔥'; iconColor = C.propClose; }
      else if (prop.status === 'missed') { icon = '❌'; iconColor = C.propMissed; }

      ctx.font = '12px ' + FF;
      ctx.fillText(icon, PAD, propY + 17);

      // Player name
      ctx.font = '600 11px ' + FF;
      ctx.fillStyle = C.textLight;
      const playerName = truncateName(prop.playerName || '', 14);
      ctx.fillText(playerName, PAD + 22, propY + 16);

      // Current stat value
      const statStr = prop.currentStat != null ? String(prop.currentStat) : '—';
      ctx.font = '700 12px ' + FF;
      ctx.fillStyle = iconColor;
      const statX = 190;
      ctx.fillText(statStr, statX, propY + 16);

      // Prop line (e.g. "O 25.5 PTS")
      const dir = (prop.direction || '').charAt(0).toUpperCase();
      const lineStr = `${dir} ${prop.line} ${(prop.stat || '').toUpperCase().slice(0, 5)}`;
      ctx.font = '10px ' + FF;
      ctx.fillStyle = C.textMuted;
      const lineW = ctx.measureText(lineStr).width;
      ctx.fillText(lineStr, W - PAD - lineW, propY + 16);

      curY += 24;
    }

    curY += 8;
  }

  // ── Footer ──
  ctx.fillStyle = C.bgDark;
  ctx.fillRect(0, curY, W, FOOTER_H);

  // Brand
  const brandLogo = await getBrandLogo();
  if (brandLogo) {
    try {
      ctx.drawImage(brandLogo, PAD - 2, curY + 2, 16, 16);
    } catch {}
  }
  ctx.font = '700 8px ' + FF;
  ctx.fillStyle = C.accent;
  ctx.fillText('THE GAMBLING KING', PAD + 18, curY + 13);

  // Update time
  const now = new Date();
  const updateStr = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'America/New_York',
  }) + ' ET';
  ctx.font = '8px ' + FF;
  ctx.fillStyle = C.textDim;
  const updateW = ctx.measureText(updateStr).width;
  ctx.fillText(updateStr, W - PAD - updateW, curY + 13);

  ctx.restore();

  // ── Rounded border ──
  roundRect(ctx, 0, 0, W, H, 10);
  ctx.strokeStyle = 'rgba(255, 135, 50, 0.2)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

/**
 * Truncate a name to fit
 */
function truncateName(name, maxLen) {
  if (name.length <= maxLen) return name;
  // Try "F. Lastname" format
  const parts = name.split(' ');
  if (parts.length >= 2) {
    const short = `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
    if (short.length <= maxLen) return short;
  }
  return name.slice(0, maxLen - 1) + '…';
}

/**
 * Generate a multi-game scoreboard (multiple score bugs stacked)
 * Used for "Today's Games" overview
 */
async function generateMultiScoreboardImage(games, sport) {
  if (!games?.length) return null;

  const W = 480;
  const GAME_H = 100; // approximate per-game height
  const GAP = 8;
  const HEADER_H = 30;
  
  // For now, generate individual images — can optimize later
  const images = [];
  for (const game of games.slice(0, 8)) { // max 8 games
    const buf = await generateScoreboardImage(game);
    const img = await loadImage(buf);
    images.push(img);
  }

  const totalH = HEADER_H + images.reduce((sum, img) => sum + img.height + GAP, 0);
  const canvas = createCanvas(W, totalH);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = C.bgDark;
  ctx.fillRect(0, 0, W, totalH);

  // Header
  const sportLabel = (SPORT_NAMES[sport] || sport || '').toUpperCase();
  ctx.font = '700 12px ' + FF;
  ctx.fillStyle = C.accent;
  ctx.fillText(`${sportLabel} — TODAY'S GAMES`, 14, 20);

  let curY = HEADER_H;
  for (const img of images) {
    ctx.drawImage(img, 0, curY, W, img.height);
    curY += img.height + GAP;
  }

  return canvas.toBuffer('image/png');
}

module.exports = {
  generateScoreboardImage,
  generateMultiScoreboardImage,
};
