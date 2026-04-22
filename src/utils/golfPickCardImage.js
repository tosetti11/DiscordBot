/**
 * Golf H2H Matchup Card Image Generator
 * Green accent theme for golf tournament matchup picks, result cards, and weekly recaps.
 */
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const { formatOdds } = require('./odds');

const FONT_PATH = path.join(__dirname, '..', 'fonts', 'Inter-Variable.ttf');
const EMOJI_FONT_PATH = path.join(__dirname, '..', 'fonts', 'NotoColorEmoji.ttf');
GlobalFonts.registerFromPath(FONT_PATH, 'Inter');
GlobalFonts.registerFromPath(EMOJI_FONT_PATH, 'NotoColorEmoji');
const FF = '"Inter", "NotoColorEmoji", sans-serif';

// ── Colors (green accent theme) ──
const C = {
  bg: '#0d1117',
  bgCard: '#161b22',
  bgAccent: '#1a2a1e',
  green: '#3fb950',
  greenFaint: 'rgba(63, 185, 80, 0.12)',
  greenBorder: 'rgba(63, 185, 80, 0.3)',
  fairwayGreen: '#2ea043',
  fairwayGreenFaint: 'rgba(46, 160, 67, 0.12)',
  white: '#ffffff',
  gray: '#8b949e',
  muted: '#484f58',
  divider: 'rgba(63, 185, 80, 0.15)',
  red: '#f85149',
  redFaint: 'rgba(248, 81, 73, 0.15)',
  gold: '#FFD700',
};

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

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawPill(ctx, x, y, text, bg, fg, fontSize = 11, padX = 10, padY = 4) {
  ctx.font = `700 ${fontSize}px ${FF}`;
  const m = ctx.measureText(text);
  const pw = padX * 2 + m.width;
  const ph = padY * 2 + fontSize;
  roundRect(ctx, x, y, pw, ph, 4);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.fillText(text, x + padX, y + padY + fontSize - 2);
  return pw;
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
 * Generate a golf H2H matchup pick card (green theme)
 */
async function generateGolfPickCardImage(pick, record, pickNum, totalPicks) {
  const brandLogo = await getBrandLogo();
  const W = 520;
  const PAD = 24;
  const INNER = W - PAD * 2;

  // Pre-calculate height
  const tempCanvas = createCanvas(W, 800);
  const tempCtx = tempCanvas.getContext('2d');
  let y = 0;

  // Header
  y += 60;
  y += 1; // divider

  // Title section
  y += 16;
  y += 28; // "GOLF H2H MATCHUP"
  y += 8;

  // Pills (tournament + bookmaker)
  y += 24;
  y += 12;

  // Matchup display: "PLAYER A  vs  PLAYER B"
  y += 52; // matchup box
  y += 12;

  // Pick highlight — "Picking: PLAYER_NAME"
  y += 32;
  y += 8;

  // Odds box
  y += 48;
  y += 12;

  // Confidence meter
  y += 40;
  y += 12;

  // Reasoning
  if (pick.reasoning) {
    tempCtx.font = `400 13px ${FF}`;
    const reasonLines = wrapText(tempCtx, pick.reasoning, INNER - 20);
    y += 12 + reasonLines.length * 18 + 12;
  }

  y += 1; // divider

  // Record bar
  y += 52;
  y += 1;

  // Footer
  y += 36;

  const H = y + 8;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // ── Background ──
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#0d1117');
  bgGrad.addColorStop(1, '#0a0e14');
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.fillStyle = bgGrad;
  ctx.fill();

  // Green border
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.strokeStyle = C.greenBorder;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Left green accent bar
  ctx.save();
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.clip();
  ctx.fillStyle = C.green;
  ctx.fillRect(0, 0, 5, H);
  ctx.restore();

  // ── Header ──
  let curY = 0;
  ctx.save();
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.clip();
  const hdrGrad = ctx.createLinearGradient(0, 0, W, 60);
  hdrGrad.addColorStop(0, 'rgba(63, 185, 80, 0.15)');
  hdrGrad.addColorStop(1, 'rgba(13, 17, 23, 0.8)');
  ctx.fillStyle = hdrGrad;
  ctx.fillRect(5, 0, W - 5, 60);
  ctx.restore();

  // Logo
  const logoSize = 32;
  const logoX = PAD + 5;
  const logoY = (60 - logoSize) / 2;
  if (brandLogo) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(brandLogo, logoX, logoY, logoSize, logoSize);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2 + 1, 0, Math.PI * 2);
    ctx.strokeStyle = C.greenBorder;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Header text
  ctx.font = `800 14px ${FF}`;
  ctx.fillStyle = C.green;
  ctx.fillText('THE GAMBLING KING', logoX + logoSize + 12, 30);
  ctx.font = `600 10px ${FF}`;
  ctx.fillStyle = C.gray;
  ctx.fillText(`GOLF PICK ${pickNum}/${totalPicks}`, logoX + logoSize + 12, 44);

  // Date (right side)
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
  ctx.font = `600 11px ${FF}`;
  ctx.fillStyle = C.muted;
  const dateW = ctx.measureText(dateStr).width;
  ctx.fillText(dateStr, W - PAD - dateW, 36);

  curY = 60;

  // Divider
  ctx.strokeStyle = C.divider;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(16, curY);
  ctx.lineTo(W - 16, curY);
  ctx.stroke();
  ctx.setLineDash([]);
  curY += 1;

  // ── Body ──
  curY += 16;

  // "\u26f3 GOLF H2H MATCHUP"
  ctx.font = `900 20px ${FF}`;
  ctx.fillStyle = C.white;
  ctx.fillText('\u26f3 GOLF H2H MATCHUP', PAD + 5, curY + 22);
  curY += 28;
  curY += 8;

  // Tournament + Bookmaker pills
  let tagX = PAD + 5;
  if (pick.tournament_name) {
    const tw = drawPill(ctx, tagX, curY, pick.tournament_name.toUpperCase(), C.fairwayGreenFaint, C.fairwayGreen, 10, 8, 3);
    tagX += tw + 8;
  }
  if (pick.prop_description) {
    // Extract bookmaker from prop_description (e.g. "Tournament Matchup \u2022 DraftKings")
    const bkMatch = pick.prop_description.match(/\u2022\s*(.+)/);
    if (bkMatch) {
      const rw = drawPill(ctx, tagX, curY, bkMatch[1].toUpperCase(), C.greenFaint, C.green, 10, 8, 3);
      tagX += rw + 8;
    }
  }
  curY += 24;
  curY += 12;

  // ── Matchup Box: "PLAYER A  vs  PLAYER B" ──
  roundRect(ctx, PAD, curY, INNER, 52, 8);
  ctx.fillStyle = 'rgba(63, 185, 80, 0.06)';
  ctx.fill();
  roundRect(ctx, PAD, curY, INNER, 52, 8);
  ctx.strokeStyle = C.greenBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  const playerA = pick.team_a || pick.player_name || '—';
  const playerB = pick.team_b || '—';
  const vsText = 'vs';

  ctx.font = `800 16px ${FF}`;
  const aWidth = ctx.measureText(playerA).width;
  ctx.font = `600 12px ${FF}`;
  const vsWidth = ctx.measureText(vsText).width;
  ctx.font = `800 16px ${FF}`;
  const bWidth = ctx.measureText(playerB).width;

  const totalTextW = aWidth + vsWidth + bWidth + 24; // 12px gap each side of "vs"
  let textStartX = PAD + (INNER - totalTextW) / 2;

  const boxCenterY = curY + 30;

  // Player A (the pick) — highlighted green
  ctx.font = `800 16px ${FF}`;
  ctx.fillStyle = C.green;
  ctx.fillText(playerA, textStartX, boxCenterY);
  textStartX += aWidth + 12;

  // "vs"
  ctx.font = `600 12px ${FF}`;
  ctx.fillStyle = C.muted;
  ctx.fillText(vsText, textStartX, boxCenterY);
  textStartX += vsWidth + 12;

  // Player B
  ctx.font = `800 16px ${FF}`;
  ctx.fillStyle = C.gray;
  ctx.fillText(playerB, textStartX, boxCenterY);

  curY += 52;
  curY += 12;

  // ── Pick highlight ──
  ctx.font = `700 14px ${FF}`;
  ctx.fillStyle = C.green;
  ctx.fillText(`\ud83c\udfc6 Picking: ${pick.player_name || '—'}`, PAD + 5, curY + 18);
  curY += 32;
  curY += 8;

  // ── Odds box ──
  roundRect(ctx, PAD, curY, INNER, 48, 8);
  ctx.fillStyle = C.bgAccent;
  ctx.fill();
  roundRect(ctx, PAD, curY, INNER, 48, 8);
  ctx.strokeStyle = C.greenBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Odds value (left)
  const oddsStr = pick.odds_american ? formatOdds(pick.odds_american) : '\u2014';
  ctx.font = `900 22px ${FF}`;
  ctx.fillStyle = C.green;
  ctx.fillText(oddsStr, PAD + 16, curY + 32);

  // "MONEYLINE" label (right)
  ctx.font = `800 12px ${FF}`;
  ctx.fillStyle = C.muted;
  const mlLabel = 'MONEYLINE';
  const mlW = ctx.measureText(mlLabel).width;
  ctx.fillText(mlLabel, W - PAD - 16 - mlW, curY + 30);

  curY += 48;
  curY += 12;

  // ── Confidence meter ──
  ctx.font = `700 11px ${FF}`;
  ctx.fillStyle = C.gray;
  ctx.fillText('CONFIDENCE', PAD + 5, curY + 12);
  const confPct = pick.confidence || 80;
  ctx.fillStyle = C.white;
  ctx.font = `800 11px ${FF}`;
  const pctStr = `${confPct}%`;
  const pctW = ctx.measureText(pctStr).width;
  ctx.fillText(pctStr, W - PAD - pctW, curY + 12);
  curY += 18;

  // Bar background
  const barX = PAD + 5;
  const barW = INNER - 10;
  const barH = 10;
  roundRect(ctx, barX, curY, barW, barH, 5);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.fill();

  // Bar fill (green gradient)
  const fillW = (confPct / 100) * barW;
  const barGrad = ctx.createLinearGradient(barX, 0, barX + fillW, 0);
  barGrad.addColorStop(0, '#196c2e');
  barGrad.addColorStop(0.5, C.green);
  barGrad.addColorStop(1, '#56d364');
  roundRect(ctx, barX, curY, fillW, barH, 5);
  ctx.fillStyle = barGrad;
  ctx.fill();

  curY += barH + 12;

  // ── Reasoning ──
  if (pick.reasoning) {
    ctx.font = `400 13px ${FF}`;
    const reasonLines = wrapText(ctx, pick.reasoning, INNER - 20);
    const reasonH = 12 + reasonLines.length * 18 + 12;

    roundRect(ctx, PAD, curY, INNER, reasonH, 6);
    ctx.fillStyle = 'rgba(63, 185, 80, 0.06)';
    ctx.fill();
    roundRect(ctx, PAD, curY, INNER, reasonH, 6);
    ctx.strokeStyle = 'rgba(63, 185, 80, 0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = C.gray;
    let ry = curY + 14;
    for (const rl of reasonLines) {
      ctx.fillText(rl, PAD + 10, ry + 10);
      ry += 18;
    }
    curY += reasonH;
  }

  // Divider
  ctx.strokeStyle = C.divider;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(16, curY);
  ctx.lineTo(W - 16, curY);
  ctx.stroke();
  ctx.setLineDash([]);
  curY += 1;

  // ── Record bar ──
  const rY = curY;
  const colW = INNER / 3;
  const labels = ['GOLF RECORD', 'WINS', 'LOSSES'];
  const recordStr = `${record.wins}-${record.losses}-${record.pushes}`;
  const values = [recordStr, String(record.wins), String(record.losses)];
  const vColors = [C.white, C.green, C.red];

  for (let i = 0; i < 3; i++) {
    const cx = PAD + colW * i + colW / 2;
    ctx.font = `700 9px ${FF}`;
    ctx.fillStyle = C.muted;
    const lw = ctx.measureText(labels[i]).width;
    ctx.fillText(labels[i], cx - lw / 2, rY + 18);
    ctx.font = `800 14px ${FF}`;
    ctx.fillStyle = vColors[i];
    const vw = ctx.measureText(values[i]).width;
    ctx.fillText(values[i], cx - vw / 2, rY + 38);
  }

  curY = rY + 52;

  // Footer divider
  ctx.strokeStyle = C.divider;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(16, curY);
  ctx.lineTo(W - 16, curY);
  ctx.stroke();
  ctx.setLineDash([]);
  curY += 1;

  // Footer
  ctx.font = `500 10px ${FF}`;
  ctx.fillStyle = C.muted;
  ctx.fillText('1u flat bet per pick', PAD + 5, curY + 22);
  const poweredStr = 'Powered by GPT-4o \u2022 Real DK/FD Odds';
  const pwW = ctx.measureText(poweredStr).width;
  ctx.fillText(poweredStr, W - PAD - pwW, curY + 22);

  return canvas.toBuffer('image/png');
}

/**
 * Generate result card for a closed golf H2H pick
 */
async function generateGolfRecapImage(closedPick, record) {
  const W = 520;
  const H = 240;
  const PAD = 24;
  const INNER = W - PAD * 2;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const isWin = closedPick.status === 'win';
  const isPush = closedPick.status === 'push';

  // Background
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#0d1117');
  bgGrad.addColorStop(1, '#0a0e14');
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.fillStyle = bgGrad;
  ctx.fill();

  // Border
  const borderColor = isWin ? 'rgba(63, 185, 80, 0.4)' : isPush ? 'rgba(255, 215, 0, 0.3)' : 'rgba(248, 81, 73, 0.4)';
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Left bar
  ctx.save();
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.clip();
  ctx.fillStyle = isWin ? C.green : isPush ? C.gold : C.red;
  ctx.fillRect(0, 0, 5, H);
  ctx.restore();

  let curY = 20;

  // Result header
  const statusEmoji = isWin ? '\u2705' : isPush ? '\ud83d\udd04' : '\u274c';
  const statusText = isWin ? 'WIN' : isPush ? 'PUSH' : 'LOSS';
  ctx.font = `900 20px ${FF}`;
  ctx.fillStyle = isWin ? C.green : isPush ? C.gold : C.red;
  ctx.fillText(`${statusEmoji} GOLF H2H: ${statusText}`, PAD + 5, curY + 20);
  curY += 32;

  // Pick text
  ctx.font = `700 16px ${FF}`;
  ctx.fillStyle = C.white;
  ctx.fillText(closedPick.pick || '\u2014', PAD + 5, curY + 16);
  curY += 24;

  // Result note
  if (closedPick.result_note) {
    ctx.font = `400 13px ${FF}`;
    ctx.fillStyle = C.gray;
    ctx.fillText(closedPick.result_note, PAD + 5, curY + 13);
    curY += 22;
  }

  // Final score (matchup info)
  if (closedPick.final_score) {
    ctx.font = `600 13px ${FF}`;
    ctx.fillStyle = C.muted;
    ctx.fillText(closedPick.final_score, PAD + 5, curY + 13);
    curY += 22;
  }

  curY += 8;

  // Divider
  ctx.strokeStyle = C.divider;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(16, curY);
  ctx.lineTo(W - 16, curY);
  ctx.stroke();
  ctx.setLineDash([]);
  curY += 12;

  // Record stats
  const colW = INNER / 3;
  const labels = ['GOLF RECORD', 'WINS', 'LOSSES'];
  const recordStr = `${record.wins}-${record.losses}-${record.pushes}`;
  const values = [recordStr, String(record.wins), String(record.losses)];
  const vColors = [C.white, C.green, C.red];

  for (let i = 0; i < 3; i++) {
    const cx = PAD + colW * i + colW / 2;
    ctx.font = `700 9px ${FF}`;
    ctx.fillStyle = C.muted;
    const lw = ctx.measureText(labels[i]).width;
    ctx.fillText(labels[i], cx - lw / 2, curY + 10);
    ctx.font = `800 16px ${FF}`;
    ctx.fillStyle = vColors[i];
    const vw = ctx.measureText(values[i]).width;
    ctx.fillText(values[i], cx - vw / 2, curY + 32);
  }

  // Footer
  ctx.font = `500 10px ${FF}`;
  ctx.fillStyle = C.muted;
  const poweredStr = 'The Gambling King \u2022 Golf H2H Picks';
  const pwW = ctx.measureText(poweredStr).width;
  ctx.fillText(poweredStr, (W - pwW) / 2, H - 14);

  return canvas.toBuffer('image/png');
}

/**
 * Generate weekly tournament recap image
 */
async function generateGolfTournamentRecapImage(picks, tournamentName, record) {
  const W = 520;
  const PAD = 24;
  const INNER = W - PAD * 2;

  const pickCount = picks.length;
  const H = 260 + pickCount * 28;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#0d1117');
  bgGrad.addColorStop(1, '#0a0e14');
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.fillStyle = bgGrad;
  ctx.fill();

  roundRect(ctx, 0, 0, W, H, 16);
  ctx.strokeStyle = C.greenBorder;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Green top bar
  ctx.save();
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.clip();
  ctx.fillStyle = C.green;
  ctx.fillRect(0, 0, W, 4);
  ctx.restore();

  let curY = 24;

  // Title
  ctx.font = `900 18px ${FF}`;
  ctx.fillStyle = C.green;
  ctx.fillText('\u26f3 WEEKLY RECAP', PAD, curY + 18);
  curY += 26;
  ctx.font = `600 13px ${FF}`;
  ctx.fillStyle = C.gray;
  ctx.fillText(tournamentName || 'PGA Tournament', PAD, curY + 13);
  curY += 24;

  // Divider
  ctx.strokeStyle = C.divider;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(16, curY);
  ctx.lineTo(W - 16, curY);
  ctx.stroke();
  ctx.setLineDash([]);
  curY += 12;

  // This week's results summary
  const wins = picks.filter(p => p.status === 'win').length;
  const losses = picks.filter(p => p.status === 'loss').length;
  const pushes = picks.filter(p => p.status === 'push').length;

  const colW = INNER / 3;
  const summaryLabels = ['THIS WEEK', 'WINS', 'LOSSES'];
  const summaryValues = [`${wins}-${losses}-${pushes}`, String(wins), String(losses)];
  const sColors = [C.white, C.green, C.red];

  for (let i = 0; i < 3; i++) {
    const cx = PAD + colW * i + colW / 2;
    ctx.font = `700 9px ${FF}`;
    ctx.fillStyle = C.muted;
    const lw = ctx.measureText(summaryLabels[i]).width;
    ctx.fillText(summaryLabels[i], cx - lw / 2, curY + 10);
    ctx.font = `800 18px ${FF}`;
    ctx.fillStyle = sColors[i];
    const vw = ctx.measureText(summaryValues[i]).width;
    ctx.fillText(summaryValues[i], cx - vw / 2, curY + 34);
  }
  curY += 50;

  // Divider
  ctx.strokeStyle = C.divider;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(16, curY);
  ctx.lineTo(W - 16, curY);
  ctx.stroke();
  ctx.setLineDash([]);
  curY += 12;

  // Individual pick results
  for (const pick of picks) {
    const emoji = pick.status === 'win' ? '\u2705' : pick.status === 'loss' ? '\u274c' : '\ud83d\udd04';
    const statusColor = pick.status === 'win' ? C.green : pick.status === 'loss' ? C.red : C.gold;

    ctx.font = `600 13px ${FF}`;
    ctx.fillStyle = statusColor;
    ctx.fillText(emoji, PAD + 5, curY + 13);

    ctx.fillStyle = C.white;
    ctx.fillText(pick.pick || '\u2014', PAD + 28, curY + 13);

    if (pick.final_score) {
      ctx.font = `500 11px ${FF}`;
      ctx.fillStyle = C.muted;
      const fsW = ctx.measureText(pick.final_score).width;
      ctx.fillText(pick.final_score, W - PAD - fsW, curY + 13);
    }
    curY += 28;
  }

  curY += 8;

  // Divider
  ctx.strokeStyle = C.divider;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(16, curY);
  ctx.lineTo(W - 16, curY);
  ctx.stroke();
  ctx.setLineDash([]);
  curY += 12;

  // Overall record
  ctx.font = `700 11px ${FF}`;
  ctx.fillStyle = C.muted;
  ctx.fillText('OVERALL GOLF RECORD', PAD + 5, curY + 11);
  ctx.font = `800 16px ${FF}`;
  ctx.fillStyle = C.white;
  const overallStr = `${record.wins}-${record.losses}-${record.pushes}`;
  const ow = ctx.measureText(overallStr).width;
  ctx.fillText(overallStr, W - PAD - ow, curY + 11);

  // Footer
  ctx.font = `500 10px ${FF}`;
  ctx.fillStyle = C.muted;
  const poweredStr = 'The Gambling King \u2022 Golf H2H Picks';
  const pwW = ctx.measureText(poweredStr).width;
  ctx.fillText(poweredStr, (W - pwW) / 2, H - 14);

  return canvas.toBuffer('image/png');
}

/**
 * Generate a golf Round Score O/U pick card (green theme)
 * pick shape: { player_name, line, pick_side ('Over'|'Under'), odds_american, confidence, reasoning, tournament_name, round_label }
 */
/**
 * @param {object} result  Optional — when provided, overlays a WIN/LOSS/PUSH stamp.
 *                         { status: 'win'|'loss'|'push', playerScore: number, note: string }
 */
async function generateGolfRoundOUCardImage(pick, record, pickNum, totalPicks, result = null) {
  const brandLogo = await getBrandLogo();
  const W = 520;
  const PAD = 24;
  const INNER = W - PAD * 2;

  // When showing result, swap accent colour
  const resultColor = result
    ? (result.status === 'win' ? C.green : result.status === 'loss' ? C.red : C.gold)
    : null;

  // Pre-calculate height
  const tempCanvas = createCanvas(W, 1200);
  const tempCtx = tempCanvas.getContext('2d');

  let y = 0;
  y += 60;  // header
  y += 1;   // divider
  y += 16;
  y += 28;  // title "GOLF ROUND TOTALS"
  y += 8;
  y += 24;  // pills
  y += 12;

  // Player name box
  y += 48;
  y += 12;

  // O/U pick box
  y += 52;
  y += 12;

  // Confidence meter
  y += 40;
  y += 12;

  // Reasoning (longer for round O/U — user wants full paragraphs)
  let reasonH = 0;
  if (pick.reasoning) {
    tempCtx.font = `400 13px ${FF}`;
    const reasonLines = wrapText(tempCtx, pick.reasoning, INNER - 20);
    reasonH = 12 + reasonLines.length * 18 + 12;
    y += reasonH;
  }

  y += 1;  // divider
  y += 52; // record bar
  y += 1;
  y += 36; // footer

  const H = y + 8;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // ── Background ──
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#0d1117');
  bgGrad.addColorStop(1, '#0a0e14');
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.fillStyle = bgGrad;
  ctx.fill();

  // Border (result colour when resolved, else green)
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.strokeStyle = result
    ? (result.status === 'win' ? 'rgba(63, 185, 80, 0.5)' : result.status === 'loss' ? 'rgba(248, 81, 73, 0.5)' : 'rgba(255, 215, 0, 0.4)')
    : C.greenBorder;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Left accent bar (result colour when resolved, else green)
  ctx.save();
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.clip();
  ctx.fillStyle = resultColor || C.green;
  ctx.fillRect(0, 0, 5, H);
  ctx.restore();

  // ── Header ──
  let curY = 0;
  ctx.save();
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.clip();
  const hdrGrad = ctx.createLinearGradient(0, 0, W, 60);
  hdrGrad.addColorStop(0, 'rgba(63, 185, 80, 0.15)');
  hdrGrad.addColorStop(1, 'rgba(13, 17, 23, 0.8)');
  ctx.fillStyle = hdrGrad;
  ctx.fillRect(5, 0, W - 5, 60);
  ctx.restore();

  // Logo
  const logoSize = 32;
  const logoX = PAD + 5;
  const logoY = (60 - logoSize) / 2;
  if (brandLogo) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(brandLogo, logoX, logoY, logoSize, logoSize);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2 + 1, 0, Math.PI * 2);
    ctx.strokeStyle = C.greenBorder;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Header text
  ctx.font = `800 14px ${FF}`;
  ctx.fillStyle = C.green;
  ctx.fillText('THE GAMBLING KING', logoX + logoSize + 12, 30);
  ctx.font = `600 10px ${FF}`;
  ctx.fillStyle = C.gray;
  ctx.fillText(`GOLF PICK ${pickNum}/${totalPicks}`, logoX + logoSize + 12, 44);

  // Date
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
  ctx.font = `600 11px ${FF}`;
  ctx.fillStyle = C.muted;
  const dateW = ctx.measureText(dateStr).width;
  ctx.fillText(dateStr, W - PAD - dateW, 36);

  curY = 60;

  // Divider
  ctx.strokeStyle = C.divider;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(16, curY);
  ctx.lineTo(W - 16, curY);
  ctx.stroke();
  ctx.setLineDash([]);
  curY += 1;

  // ── Body ──
  curY += 16;

  // "⛳ GOLF ROUND TOTALS"
  ctx.font = `900 20px ${FF}`;
  ctx.fillStyle = C.white;
  ctx.fillText('\u26f3 GOLF ROUND TOTALS', PAD + 5, curY + 22);
  curY += 28;
  curY += 8;

  // Tournament + Round pills
  let tagX = PAD + 5;
  if (pick.tournament_name) {
    const tw = drawPill(ctx, tagX, curY, pick.tournament_name.toUpperCase(), C.fairwayGreenFaint, C.fairwayGreen, 10, 8, 3);
    tagX += tw + 8;
  }
  if (pick.round_label) {
    const rw = drawPill(ctx, tagX, curY, pick.round_label.toUpperCase(), C.greenFaint, C.green, 10, 8, 3);
    tagX += rw + 8;
  }
  curY += 24;
  curY += 12;

  // ── Player Name Box ──
  roundRect(ctx, PAD, curY, INNER, 48, 8);
  ctx.fillStyle = 'rgba(63, 185, 80, 0.06)';
  ctx.fill();
  roundRect(ctx, PAD, curY, INNER, 48, 8);
  ctx.strokeStyle = C.greenBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = `800 18px ${FF}`;
  ctx.fillStyle = C.white;
  const nameStr = pick.player_name || '—';
  const nameW = ctx.measureText(nameStr).width;
  ctx.fillText(nameStr, PAD + (INNER - nameW) / 2, curY + 31);
  curY += 48;
  curY += 12;

  // ── O/U Pick Box ──
  const isOver = (pick.pick_side || '').toLowerCase().startsWith('over');
  const sideColor = isOver ? C.green : C.red;
  const sideFaint = isOver ? C.greenFaint : C.redFaint;

  roundRect(ctx, PAD, curY, INNER, 52, 8);
  ctx.fillStyle = C.bgAccent;
  ctx.fill();
  roundRect(ctx, PAD, curY, INNER, 52, 8);
  ctx.strokeStyle = sideColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Side label (left): "OVER" or "UNDER"
  ctx.font = `900 20px ${FF}`;
  ctx.fillStyle = sideColor;
  ctx.fillText((pick.pick_side || 'OVER').toUpperCase(), PAD + 16, curY + 33);

  // Line (center-ish)
  const lineStr = String(pick.line || '—');
  ctx.font = `800 22px ${FF}`;
  ctx.fillStyle = C.white;
  const lineW = ctx.measureText(lineStr).width;
  ctx.fillText(lineStr, PAD + (INNER / 2) - (lineW / 2), curY + 33);

  // Odds (right)
  const oddsStr = pick.odds_american ? formatOdds(pick.odds_american) : '—';
  ctx.font = `800 18px ${FF}`;
  ctx.fillStyle = C.gray;
  const oddsW = ctx.measureText(oddsStr).width;
  ctx.fillText(oddsStr, W - PAD - 16 - oddsW, curY + 33);

  curY += 52;
  curY += 12;

  // ── Confidence meter OR Result bar ──
  if (result) {
    // Result replaces confidence section
    const resColor = resultColor;
    const resFaint = result.status === 'win' ? 'rgba(63, 185, 80, 0.12)' : result.status === 'loss' ? 'rgba(248, 81, 73, 0.12)' : 'rgba(255, 215, 0, 0.1)';
    const resBorder = result.status === 'win' ? 'rgba(63, 185, 80, 0.4)' : result.status === 'loss' ? 'rgba(248, 81, 73, 0.4)' : 'rgba(255, 215, 0, 0.35)';
    const resEmoji = result.status === 'win' ? '✅' : result.status === 'loss' ? '❌' : '🔄';
    const resLabel = result.status === 'win' ? 'WIN' : result.status === 'loss' ? 'LOSS' : 'PUSH';
    const scoreLabel = result.playerScore != null ? `Shot ${result.playerScore}` : '';

    roundRect(ctx, PAD, curY, INNER, 40, 8);
    ctx.fillStyle = resFaint;
    ctx.fill();
    roundRect(ctx, PAD, curY, INNER, 40, 8);
    ctx.strokeStyle = resBorder;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Result label centred
    const resStr = `${resEmoji} ${resLabel}${scoreLabel ? `  •  ${scoreLabel}` : ''}`;
    ctx.font = `900 16px ${FF}`;
    ctx.fillStyle = resColor;
    const rsW = ctx.measureText(resStr).width;
    ctx.fillText(resStr, PAD + (INNER - rsW) / 2, curY + 27);

    curY += 40 + 12;
  } else {
    ctx.font = `700 11px ${FF}`;
    ctx.fillStyle = C.gray;
    ctx.fillText('CONFIDENCE', PAD + 5, curY + 12);
    const confPct = pick.confidence || 80;
    ctx.fillStyle = C.white;
    ctx.font = `800 11px ${FF}`;
    const pctStr = `${confPct}%`;
    const pctW = ctx.measureText(pctStr).width;
    ctx.fillText(pctStr, W - PAD - pctW, curY + 12);
    curY += 18;

    const barX = PAD + 5;
    const barW = INNER - 10;
    const barH = 10;
    roundRect(ctx, barX, curY, barW, barH, 5);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fill();

    const fillW = (confPct / 100) * barW;
    const barGrad = ctx.createLinearGradient(barX, 0, barX + fillW, 0);
    barGrad.addColorStop(0, '#196c2e');
    barGrad.addColorStop(0.5, C.green);
    barGrad.addColorStop(1, '#56d364');
    roundRect(ctx, barX, curY, fillW, barH, 5);
    ctx.fillStyle = barGrad;
    ctx.fill();

    curY += barH + 12;
  }

  // ── Reasoning ──
  if (pick.reasoning) {
    ctx.font = `400 13px ${FF}`;
    const reasonLines = wrapText(ctx, pick.reasoning, INNER - 20);
    const rH = 12 + reasonLines.length * 18 + 12;

    roundRect(ctx, PAD, curY, INNER, rH, 6);
    ctx.fillStyle = 'rgba(63, 185, 80, 0.06)';
    ctx.fill();
    roundRect(ctx, PAD, curY, INNER, rH, 6);
    ctx.strokeStyle = 'rgba(63, 185, 80, 0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = C.gray;
    let ry = curY + 14;
    for (const rl of reasonLines) {
      ctx.fillText(rl, PAD + 10, ry + 10);
      ry += 18;
    }
    curY += rH;
  }

  // Divider
  ctx.strokeStyle = C.divider;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(16, curY);
  ctx.lineTo(W - 16, curY);
  ctx.stroke();
  ctx.setLineDash([]);
  curY += 1;

  // ── Record bar ──
  const rY = curY;
  const colW = INNER / 3;
  const labels = ['GOLF RECORD', 'WINS', 'LOSSES'];
  const recordStr = `${record.wins}-${record.losses}-${record.pushes}`;
  const values = [recordStr, String(record.wins), String(record.losses)];
  const vColors = [C.white, C.green, C.red];

  for (let i = 0; i < 3; i++) {
    const cx = PAD + colW * i + colW / 2;
    ctx.font = `700 9px ${FF}`;
    ctx.fillStyle = C.muted;
    const lw = ctx.measureText(labels[i]).width;
    ctx.fillText(labels[i], cx - lw / 2, rY + 18);
    ctx.font = `800 14px ${FF}`;
    ctx.fillStyle = vColors[i];
    const vw = ctx.measureText(values[i]).width;
    ctx.fillText(values[i], cx - vw / 2, rY + 38);
  }

  curY = rY + 52;

  // Footer divider
  ctx.strokeStyle = C.divider;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(16, curY);
  ctx.lineTo(W - 16, curY);
  ctx.stroke();
  ctx.setLineDash([]);
  curY += 1;

  // Footer
  ctx.font = `500 10px ${FF}`;
  ctx.fillStyle = C.muted;
  ctx.fillText('1u flat bet per pick', PAD + 5, curY + 22);
  const poweredStr = 'Powered by GPT-4o \u2022 DraftKings Lines';
  const pwW = ctx.measureText(poweredStr).width;
  ctx.fillText(poweredStr, W - PAD - pwW, curY + 22);

  return canvas.toBuffer('image/png');
}

module.exports = {
  generateGolfPickCardImage,
  generateGolfRecapImage,
  generateGolfTournamentRecapImage,
  generateGolfRoundOUCardImage,
};
