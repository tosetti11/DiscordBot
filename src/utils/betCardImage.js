const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const { SPORT_NAMES, WAGER_TYPES } = require('../config/constants');
const { formatOdds, calculatePayout } = require('./odds');

// ── Register bundled fonts ───────────────────────────────────
const FONT_PATH = path.join(__dirname, '..', 'fonts', 'Inter-Variable.ttf');
const EMOJI_FONT_PATH = path.join(__dirname, '..', 'fonts', 'NotoColorEmoji.ttf');
GlobalFonts.registerFromPath(FONT_PATH, 'Inter');
GlobalFonts.registerFromPath(EMOJI_FONT_PATH, 'NotoColorEmoji');
const FF = '"Inter", "NotoColorEmoji", sans-serif';  // font-family used everywhere
const FF_MONO = '"Courier New", "Inter", monospace';

// ── Colors ──────────────────────────────────────────────────
const C = {
  bgTop: '#1e1e1e',
  bgBot: '#161616',
  headerBgStart: 'rgba(80, 35, 20, 0.55)',
  headerBgEnd: 'rgba(30, 30, 30, 0.8)',
  accent: '#FF8732',
  accentFaint: 'rgba(255, 135, 50, 0.12)',
  accentDivider: 'rgba(255, 135, 50, 0.18)',
  win: '#43b581',
  loss: '#ff4444',
  lossBorder: '#D62300',
  push: '#aaa',
  pushBorder: '#808080',
  voidCol: '#888',
  voidBorder: '#555',
  textPrimary: '#ffffff',
  textSecondary: '#b3b3b3',
  textMuted: '#727272',
  payout: '#43b581',
  whaleGold: '#F5C518',
  retroOrange: '#FF9900',
  cardBorder: 'rgba(255, 135, 50, 0.15)',
  legBorder: 'rgba(255, 135, 50, 0.25)',
};

const STATUS_COLORS = {
  open: { bar: '#FF8732', bgBadge: 'rgba(255, 135, 50, 0.25)', text: '#FF8732' },
  win: { bar: '#43b581', bgBadge: 'rgba(67, 181, 129, 0.25)', text: '#43b581' },
  loss: { bar: '#D62300', bgBadge: 'rgba(214, 35, 0, 0.25)', text: '#ff4444' },
  push: { bar: '#808080', bgBadge: 'rgba(128, 128, 128, 0.25)', text: '#aaa' },
  void: { bar: '#555', bgBadge: 'rgba(85, 85, 85, 0.25)', text: '#888' },
};

const STATUS_LABELS = { open: 'PENDING', win: 'WON', loss: 'LOST', push: 'PUSH', void: 'VOID' };

/** Format a unit value */
function fmtU(v) {
  const n = Number(v);
  return Number.isFinite(n) ? parseFloat(n.toFixed(2)) : v;
}

// ── Preload brand logo once ──
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

function drawPill(ctx, x, y, text, bgColor, textColor, fontSize = 11, fontWeight = '700', paddingX = 10, paddingY = 4) {
  ctx.font = `${fontWeight} ${fontSize}px ${FF}`;
  const m = ctx.measureText(text);
  const pw = paddingX * 2 + m.width;
  const ph = paddingY * 2 + fontSize;
  roundRect(ctx, x, y, pw, ph, 4);
  ctx.fillStyle = bgColor;
  ctx.fill();
  ctx.fillStyle = textColor;
  ctx.fillText(text, x + paddingX, y + paddingY + fontSize - 2);
  return pw;
}

function drawDashedLine(ctx, x1, y1, x2, dashLen = 6, gapLen = 4) {
  ctx.strokeStyle = C.accentDivider;
  ctx.lineWidth = 1;
  ctx.setLineDash([dashLen, gapLen]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y1);
  ctx.stroke();
  ctx.setLineDash([]);
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';
  for (const word of words) {
    const testLine = currentLine ? currentLine + ' ' + word : word;
    if (ctx.measureText(testLine).width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

// ── Main generator ──

/**
 * Generate a bet card image buffer (PNG)
 * @param {Object} bet - Bet data object
 * @param {string} username - Display name
 * @param {string} [avatarUrl] - Avatar URL (unused currently, using brand logo)
 * @returns {Promise<Buffer>} PNG image buffer
 */
async function generateBetCardImage(bet, username, avatarUrl) {
  const brandLogo = await getBrandLogo();
  const displayName = username || bet.display_name || 'Unknown';

  const W = 500; // card width
  const PAD = 20; // horizontal padding
  const INNER = W - PAD * 2;
  const isParlay = bet.bet_type === 'parlay' && bet.parlay_legs?.length > 0;

  const sportName = SPORT_NAMES[bet.sport] || bet.sport || '';
  const wagerLabel = WAGER_TYPES[bet.wager_type] || '';
  const status = bet.status || 'open';
  const sc = STATUS_COLORS[status] || STATUS_COLORS.open;
  const statusLabel = STATUS_LABELS[status] || 'PENDING';

  // ── Pre-calculate height ──
  // We'll draw to a tall canvas first, then crop
  const tempCanvas = createCanvas(W, 1200);
  const tempCtx = tempCanvas.getContext('2d');
  let y = 0;

  // Header height
  const isWhale = bet.is_whale || false;
  const HEADER_H = isWhale ? 72 : 48;
  y += HEADER_H;
  y += 1; // divider

  // Body
  y += 14; // top padding
  y += 20; // sport row
  y += 10; // gap

  // Pick text
  tempCtx.font = 'bold 20px ' + FF;
  let pickText = bet.pick || (isParlay ? `${bet.parlay_legs.length}-Leg Parlay` : '—');
  if (bet.bet_category === 'futures' && !isParlay) {
    const parts = bet.pick ? bet.pick.split(': ') : [bet.pick];
    pickText = parts.length > 1 ? parts.slice(1).join(': ') : bet.pick;
  }
  const pickLines = wrapText(tempCtx, pickText || '—', INNER);
  y += pickLines.length * 26;
  y += 4;

  // Matchup / player (singles)
  if (!isParlay) {
    if (bet.team_a && bet.team_b) y += 18;
    if (bet.player_name) y += 18;
    if (bet.event_start_time) y += 18;
  }

  // Parlay legs (always expanded)
  if (isParlay) {
    y += 6;
    for (const leg of bet.parlay_legs) {
      y += 6; // gap between legs
      y += 16; // leg header (status + sport)
      tempCtx.font = 'bold 13px ' + FF;
      const legPickLines = wrapText(tempCtx, leg.pick || '—', INNER - 24);
      y += legPickLines.length * 17;
      if (leg.team_a && leg.team_b) y += 15;
      if (leg.player_name) y += 15;
      if (leg.event_start_time) y += 15;
      if (leg.odds_american) y += 15; // odds line
      y += 6; // bottom padding
    }
  }

  y += 14; // bottom padding body
  y += 1; // divider

  // Stats row
  const STATS_H = 52;
  y += STATS_H;
  y += 1; // divider

  // Note (if exists)
  if (bet.bet_note) {
    tempCtx.font = '12px ' + FF;
    const noteLines = wrapText(tempCtx, bet.bet_note, INNER - 20);
    y += 10 + noteLines.length * 16 + 10;
    y += 1; // divider
  }

  // Footer
  const FOOTER_H = 38;
  y += FOOTER_H;

  // Whale bottom decoration
  const WHALE_BOTTOM_H = isWhale ? 30 : 0;
  y += WHALE_BOTTOM_H;

  const H = y + 4; // small bottom padding
  const LEFT_BAR = 5; // status accent bar width

  // ── Create final canvas ──
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // ── Background gradient ──
  const bgGrad = ctx.createLinearGradient(0, 0, W * 0.3, H);
  bgGrad.addColorStop(0, C.bgTop);
  bgGrad.addColorStop(1, C.bgBot);
  roundRect(ctx, 0, 0, W, H, 14);
  ctx.fillStyle = bgGrad;
  ctx.fill();

  // ── Card border ──
  roundRect(ctx, 0, 0, W, H, 14);
  ctx.strokeStyle = C.cardBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  // ── Left accent bar ──
  roundRect(ctx, 0, 0, LEFT_BAR, H, 0);
  // clip to left side within the card border-radius
  ctx.save();
  roundRect(ctx, 0, 0, W, H, 14);
  ctx.clip();
  ctx.fillStyle = sc.bar;
  ctx.fillRect(0, 0, LEFT_BAR, H);
  ctx.restore();

  // ── Header ──
  let curY = 0;
  ctx.save();
  roundRect(ctx, 0, 0, W, H, 14);
  ctx.clip();
  const hdrGrad = ctx.createLinearGradient(0, 0, W, HEADER_H);
  hdrGrad.addColorStop(0, 'rgba(80, 35, 20, 0.55)');
  hdrGrad.addColorStop(1, 'rgba(30, 30, 30, 0.8)');
  ctx.fillStyle = hdrGrad;
  ctx.fillRect(LEFT_BAR, 0, W - LEFT_BAR, HEADER_H);
  ctx.restore();

  // Brand logo — position within top 48px of header
  const HDR_CONTENT = 48;
  const logoSize = 28;
  const logoX = LEFT_BAR + PAD;
  const logoY = (HDR_CONTENT - logoSize) / 2;
  if (brandLogo) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(brandLogo, logoX, logoY, logoSize, logoSize);
    ctx.restore();
    // Logo border
    ctx.beginPath();
    ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2 + 1, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 135, 50, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Separator │
  const sepX = logoX + logoSize + 8;
  ctx.font = '300 18px ' + FF;
  ctx.fillStyle = 'rgba(255, 135, 50, 0.3)';
  ctx.fillText('│', sepX, HDR_CONTENT / 2 + 6);

  // Username
  const nameX = sepX + 14;
  ctx.font = 'bold 13px ' + FF;
  ctx.fillStyle = C.textSecondary;
  const truncName = displayName.length > 20 ? displayName.slice(0, 18) + '…' : displayName;
  ctx.fillText(truncName, nameX, HDR_CONTENT / 2 + 5);

  // Status badge (right side)
  const badgeText = statusLabel;
  ctx.font = '800 11px ' + FF;
  const badgeW = ctx.measureText(badgeText).width + 20;
  const badgeH = 22;
  const badgeX = W - PAD - badgeW;
  const badgeY = (HDR_CONTENT - badgeH) / 2;
  roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 4);
  ctx.fillStyle = sc.bgBadge;
  ctx.fill();
  ctx.fillStyle = sc.text;
  ctx.font = '800 11px ' + FF;
  ctx.fillText(badgeText, badgeX + 10, badgeY + 15);

  // Whale decoration row (header)
  if (isWhale) {
    const decoText = '\u{1F6A8}\u{1F6A8}\u{1F40B}\u{1F346}\u{1F40B}\u{1F346}\u{1F40B}\u{1F346}\u{1F346}\u{1F40B}\u{1F346}\u{1F40B}\u{1F346}\u{1F40B}\u{1F6A8}\u{1F6A8}';
    ctx.font = '14px ' + FF;
    const decoW = ctx.measureText(decoText).width;
    ctx.fillStyle = C.whaleGold;
    ctx.fillText(decoText, (W - decoW) / 2, HEADER_H - 10);
  }

  curY = HEADER_H;

  // ── Divider ──
  drawDashedLine(ctx, LEFT_BAR + 14, curY, W - 14);
  curY += 1;

  // ── Body ──
  curY += 14; // top padding

  // Sport row
  let tagX = LEFT_BAR + PAD;
  if (sportName) {
    const sportPillW = drawPill(ctx, tagX, curY, sportName.toUpperCase(), C.accentFaint, C.accent, 11, '700', 10, 3);
    tagX += sportPillW + 8;
  }

  if (!isParlay && wagerLabel) {
    ctx.font = '600 11px ' + FF;
    ctx.fillStyle = C.textMuted;
    ctx.fillText(wagerLabel.toUpperCase(), tagX, curY + 14);
    tagX += ctx.measureText(wagerLabel.toUpperCase()).width + 10;
  }

  if (isParlay) {
    ctx.font = '600 11px ' + FF;
    ctx.fillStyle = C.textMuted;
    ctx.fillText('PARLAY', tagX, curY + 14);
    tagX += ctx.measureText('PARLAY').width + 10;
  }

  if (bet.is_whale) {
    drawPill(ctx, tagX, curY, '🐋 WHALE', 'rgba(245, 197, 24, 0.15)', C.whaleGold, 10, '700', 7, 3);
    tagX += ctx.measureText('🐋 WHALE').width + 24;
  }
  if (bet.is_retro) {
    drawPill(ctx, tagX, curY, 'RETRO', 'rgba(255, 153, 0, 0.15)', C.retroOrange, 10, '700', 7, 3);
  }

  curY += 20;
  curY += 10; // gap

  // ── Pick text (big bold) ──
  ctx.font = 'bold 20px ' + FF;
  ctx.fillStyle = C.textPrimary;
  for (const line of pickLines) {
    ctx.fillText(line, LEFT_BAR + PAD, curY + 18);
    curY += 26;
  }
  curY += 4;

  // ── Single bet details ──
  if (!isParlay) {
    if (bet.team_a && bet.team_b) {
      ctx.font = '13px ' + FF;
      ctx.fillStyle = C.textMuted;
      ctx.fillText(`${bet.team_a} vs ${bet.team_b}`, LEFT_BAR + PAD, curY + 13);
      curY += 18;
    }
    if (bet.player_name) {
      ctx.font = '13px ' + FF;
      ctx.fillStyle = C.textSecondary;
      ctx.fillText(bet.player_name, LEFT_BAR + PAD, curY + 13);
      curY += 18;
    }
    if (bet.event_start_time) {
      ctx.font = '12px ' + FF;
      ctx.fillStyle = C.textMuted;
      ctx.fillText(`⏰ ${bet.event_start_time}`, LEFT_BAR + PAD, curY + 13);
      curY += 18;
    }
  }

  // ── Parlay legs (all expanded) ──
  if (isParlay) {
    curY += 6;
    for (let i = 0; i < bet.parlay_legs.length; i++) {
      const leg = bet.parlay_legs[i];
      const legX = LEFT_BAR + PAD + 12;
      const legInner = INNER - 24;

      curY += 6;

      // Left border for leg
      ctx.strokeStyle = C.legBorder;
      ctx.lineWidth = 2;
      const legStartY = curY;

      // Leg header: status emoji + sport
      const legSport = (SPORT_NAMES[leg.sport] || leg.sport || '').toUpperCase();
      const legStatusMap = { open: '🟡', win: '✅', loss: '❌', push: '🔄', void: '⛔' };
      const legEmoji = legStatusMap[leg.status] || '🟡';

      ctx.font = '13px ' + FF;
      ctx.fillStyle = C.textPrimary;
      ctx.fillText(legEmoji, legX, curY + 13);
      ctx.font = '600 10px ' + FF;
      ctx.fillStyle = C.textMuted;
      ctx.fillText(legSport, legX + 22, curY + 12);
      curY += 16;

      // Leg pick
      ctx.font = 'bold 13px ' + FF;
      ctx.fillStyle = C.textPrimary;
      const legPickLines = wrapText(ctx, leg.pick || '—', legInner);
      for (const lp of legPickLines) {
        ctx.fillText(lp, legX, curY + 13);
        curY += 17;
      }

      // Matchup
      if (leg.team_a && leg.team_b) {
        ctx.font = '11px ' + FF;
        ctx.fillStyle = C.textMuted;
        ctx.fillText(`${leg.team_a} vs ${leg.team_b}`, legX, curY + 12);
        curY += 15;
      }

      // Player
      if (leg.player_name) {
        ctx.font = '11px ' + FF;
        ctx.fillStyle = C.textSecondary;
        ctx.fillText(leg.player_name, legX, curY + 12);
        curY += 15;
      }

      // Event time
      if (leg.event_start_time) {
        ctx.font = '11px ' + FF;
        ctx.fillStyle = C.textMuted;
        ctx.fillText(`⏰ ${leg.event_start_time}`, legX, curY + 12);
        curY += 15;
      }

      // Leg odds
      if (leg.odds_american) {
        ctx.font = '11px ' + FF;
        ctx.fillStyle = C.textSecondary;
        ctx.fillText(`Odds: ${formatOdds(leg.odds_american)}`, legX, curY + 12);
        curY += 15;
      }

      curY += 6;

      // Draw left accent border for this leg
      ctx.strokeStyle = C.legBorder;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(legX - 6, legStartY);
      ctx.lineTo(legX - 6, curY);
      ctx.stroke();
    }
  }

  curY += 14; // bottom body padding

  // ── Divider ──
  drawDashedLine(ctx, LEFT_BAR + 14, curY, W - 14);
  curY += 1;

  // ── Stats row: ODDS | WAGER | TO WIN ──
  const statsY = curY;
  const colW = (W - LEFT_BAR - PAD * 2) / 3;

  // Labels
  ctx.font = '700 10px ' + FF;
  const labels = ['ODDS', 'WAGER', 'TO WIN'];
  const oddsStr = bet.odds_american ? `${formatOdds(bet.odds_american)} (${bet.odds_decimal})` : '—';
  const unitsStr = `${fmtU(bet.units)}u`;
  let toWinStr = '—';
  if (bet.odds_american) {
    toWinStr = `+${calculatePayout(bet.odds_american, bet.units)}u`;
  }
  const values = [oddsStr, unitsStr, toWinStr];
  const valueColors = [C.textPrimary, C.textPrimary, C.payout];

  for (let i = 0; i < 3; i++) {
    const cx = LEFT_BAR + PAD + colW * i + colW / 2;

    // Label
    ctx.fillStyle = C.textMuted;
    ctx.font = '700 10px ' + FF;
    const lw = ctx.measureText(labels[i]).width;
    ctx.fillText(labels[i], cx - lw / 2, statsY + 18);

    // Value
    ctx.fillStyle = valueColors[i];
    ctx.font = '800 16px ' + FF;
    const vw = ctx.measureText(values[i]).width;
    ctx.fillText(values[i], cx - vw / 2, statsY + 38);
  }

  curY = statsY + STATS_H;

  // ── Note (if exists) ──
  if (bet.bet_note) {
    drawDashedLine(ctx, LEFT_BAR + 14, curY, W - 14);
    curY += 1;
    curY += 10;
    ctx.font = 'italic 12px ' + FF;
    ctx.fillStyle = C.textMuted;
    const noteLines = wrapText(ctx, `📝 ${bet.bet_note}`, INNER - 20);
    for (const nl of noteLines) {
      ctx.fillText(nl, LEFT_BAR + PAD + 10, curY + 12);
      curY += 16;
    }
    curY += 10;
  }

  // ── Divider ──
  drawDashedLine(ctx, LEFT_BAR + 14, curY, W - 14);
  curY += 1;

  // ── Footer: slip # | date ──
  const slipStr = bet.slip_number ? `#${bet.slip_number}` : `#${(bet.id || '').slice(0, 8)}`;
  const dateStr = bet.created_at
    ? new Date(bet.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      + ' ' + new Date(bet.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '';

  ctx.font = '11px ' + FF_MONO;
  ctx.fillStyle = C.textMuted;
  ctx.fillText(slipStr, LEFT_BAR + PAD, curY + 24);

  ctx.font = '11px ' + FF;
  ctx.fillStyle = C.textMuted;
  const dateW = ctx.measureText(dateStr).width;
  ctx.fillText(dateStr, W - PAD - dateW, curY + 24);

  // Whale bottom decoration row
  if (isWhale) {
    const decoText = '\u{1F6A8}\u{1F6A8}\u{1F40B}\u{1F346}\u{1F40B}\u{1F346}\u{1F40B}\u{1F346}\u{1F346}\u{1F40B}\u{1F346}\u{1F40B}\u{1F346}\u{1F40B}\u{1F6A8}\u{1F6A8}';
    ctx.font = '14px ' + FF;
    const decoW = ctx.measureText(decoText).width;
    ctx.fillStyle = C.whaleGold;
    ctx.fillText(decoText, (W - decoW) / 2, curY + FOOTER_H + 18);
  }

  // ── Export PNG ──
  return canvas.toBuffer('image/png');
}

module.exports = { generateBetCardImage };
