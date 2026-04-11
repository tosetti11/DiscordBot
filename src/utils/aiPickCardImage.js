/**
 * AI Pick Card Image Generator
 * Generates premium-styled pick cards, result cards, and monthly recap graphics.
 */
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const { SPORT_NAMES, WAGER_TYPES } = require('../config/constants');
const { formatOdds } = require('./odds');

const FONT_PATH = path.join(__dirname, '..', 'fonts', 'Inter-Variable.ttf');
const EMOJI_FONT_PATH = path.join(__dirname, '..', 'fonts', 'NotoColorEmoji.ttf');
GlobalFonts.registerFromPath(FONT_PATH, 'Inter');
GlobalFonts.registerFromPath(EMOJI_FONT_PATH, 'NotoColorEmoji');
const FF = '"Inter", "NotoColorEmoji", sans-serif';

// ── Colors ──
const C = {
  bg: '#0d1117',
  bgCard: '#161b22',
  bgAccent: '#1a2332',
  gold: '#FFD700',
  goldFaint: 'rgba(255, 215, 0, 0.12)',
  goldBorder: 'rgba(255, 215, 0, 0.3)',
  lockBlue: '#58a6ff',
  lockBlueFaint: 'rgba(88, 166, 255, 0.12)',
  green: '#3fb950',
  greenFaint: 'rgba(63, 185, 80, 0.15)',
  red: '#f85149',
  redFaint: 'rgba(248, 81, 73, 0.15)',
  white: '#ffffff',
  gray: '#8b949e',
  muted: '#484f58',
  divider: 'rgba(255, 215, 0, 0.15)',
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
 * Generate the AI Pick of the Day card
 */
async function generateAiPickCardImage(pick, record, streak, totalUnits, liveScore) {
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

  // Lock badge + pick info section
  y += 16;
  y += 28; // "AI LOCK OF THE DAY"
  y += 8;

  // Sport + Wager pills
  y += 24;
  y += 12;

  // Pick text
  tempCtx.font = `800 24px ${FF}`;
  const pickLines = wrapText(tempCtx, pick.pick || '—', INNER);
  y += pickLines.length * 32;
  y += 6;

  // Matchup
  if (pick.team_a && pick.team_b) y += 22;
  if (pick.player_name) y += 20;
  y += 8;

  // Odds box
  y += 48;
  y += 12;

  // Live score bar (if game is live or final)
  const showLive = liveScore && liveScore.state && liveScore.state !== 'pre';
  if (showLive) y += 32;

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

  // Gold border
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.strokeStyle = C.goldBorder;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Left gold accent bar
  ctx.save();
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.clip();
  ctx.fillStyle = C.gold;
  ctx.fillRect(0, 0, 5, H);
  ctx.restore();

  // ── Header ──
  let curY = 0;
  ctx.save();
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.clip();
  const hdrGrad = ctx.createLinearGradient(0, 0, W, 60);
  hdrGrad.addColorStop(0, 'rgba(255, 215, 0, 0.15)');
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
    ctx.strokeStyle = C.goldBorder;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Header text
  ctx.font = `800 14px ${FF}`;
  ctx.fillStyle = C.gold;
  ctx.fillText('THE GAMBLING KING', logoX + logoSize + 12, 30);
  ctx.font = `600 10px ${FF}`;
  ctx.fillStyle = C.gray;
  ctx.fillText('AI PICK OF THE DAY', logoX + logoSize + 12, 44);

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

  // "🔒 AI LOCK OF THE DAY"
  ctx.font = `900 20px ${FF}`;
  ctx.fillStyle = C.white;
  ctx.fillText('🔒 AI LOCK OF THE DAY', PAD + 5, curY + 22);
  curY += 28;
  curY += 8;

  // Sport + Wager pills
  let tagX = PAD + 5;
  const sportName = SPORT_NAMES[pick.sport] || pick.sport || '';
  if (sportName) {
    const spw = drawPill(ctx, tagX, curY, sportName.toUpperCase(), C.lockBlueFaint, C.lockBlue, 11, 10, 3);
    tagX += spw + 8;
  }
  const wagerLabel = WAGER_TYPES[pick.wager_type] || '';
  if (wagerLabel) {
    const wlw = drawPill(ctx, tagX, curY, wagerLabel.toUpperCase(), C.goldFaint, C.gold, 11, 10, 3);
    tagX += wlw + 8;
  }

  // Streak badge
  if (streak !== 0) {
    const streakText = streak > 0 ? `🔥 ${streak}W STREAK` : `${Math.abs(streak)}L STREAK`;
    const streakBg = streak > 0 ? C.greenFaint : C.redFaint;
    const streakFg = streak > 0 ? C.green : C.red;
    drawPill(ctx, tagX, curY, streakText, streakBg, streakFg, 10, 8, 3);
  }

  curY += 24;
  curY += 12;

  // ── Pick text (big bold) ──
  ctx.font = `800 24px ${FF}`;
  ctx.fillStyle = C.white;
  for (const line of pickLines) {
    ctx.fillText(line, PAD + 5, curY + 22);
    curY += 32;
  }
  curY += 6;

  // Matchup
  if (pick.team_a && pick.team_b) {
    ctx.font = `500 14px ${FF}`;
    ctx.fillStyle = C.gray;
    ctx.fillText(`${pick.team_a} vs ${pick.team_b}`, PAD + 5, curY + 14);
    curY += 22;
  }
  if (pick.player_name) {
    ctx.font = `500 13px ${FF}`;
    ctx.fillStyle = C.gray;
    ctx.fillText(pick.player_name, PAD + 5, curY + 13);
    curY += 20;
  }
  curY += 8;

  // ── Odds box ──
  roundRect(ctx, PAD, curY, INNER, 48, 8);
  ctx.fillStyle = C.bgAccent;
  ctx.fill();
  roundRect(ctx, PAD, curY, INNER, 48, 8);
  ctx.strokeStyle = C.goldBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Odds value (center-left)
  const oddsStr = pick.odds_american ? formatOdds(pick.odds_american) : '—';
  ctx.font = `900 22px ${FF}`;
  ctx.fillStyle = C.gold;
  ctx.fillText(oddsStr, PAD + 16, curY + 32);

  // Event time (right side)
  if (pick.event_start_time) {
    const etStr = new Date(pick.event_start_time).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
    });
    ctx.font = `500 12px ${FF}`;
    ctx.fillStyle = C.muted;
    const etW = ctx.measureText(`⏰ ${etStr} ET`).width;
    ctx.fillText(`⏰ ${etStr} ET`, W - PAD - 16 - etW, curY + 30);
  }

  curY += 48;
  curY += 12;

  // ── Live Score Bar ──
  if (showLive) {
    const isLive = liveScore.state === 'in';
    const scBg = isLive ? 'rgba(63, 185, 80, 0.10)' : 'rgba(128, 128, 128, 0.08)';
    roundRect(ctx, PAD, curY, INNER, 26, 6);
    ctx.fillStyle = scBg;
    ctx.fill();
    roundRect(ctx, PAD, curY, INNER, 26, 6);
    ctx.strokeStyle = isLive ? 'rgba(63, 185, 80, 0.25)' : 'rgba(128, 128, 128, 0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const scoreStr = `${liveScore.awayAbbr} ${liveScore.awayScore}  —  ${liveScore.homeAbbr} ${liveScore.homeScore}`;
    ctx.font = `bold 12px ${FF}`;
    ctx.fillStyle = isLive ? C.green : C.gray;
    ctx.fillText(scoreStr, PAD + 10, curY + 18);

    if (liveScore.detail) {
      const badge = isLive ? '🔴 ' : '';
      const detailStr = `${badge}${liveScore.detail}`;
      ctx.font = `500 10px ${FF}`;
      ctx.fillStyle = isLive ? C.green : C.muted;
      const dw = ctx.measureText(detailStr).width;
      ctx.fillText(detailStr, W - PAD - dw - 8, curY + 17);
    }
    curY += 32;
  }

  // ── Confidence meter ──
  ctx.font = `700 11px ${FF}`;
  ctx.fillStyle = C.gray;
  ctx.fillText('CONFIDENCE', PAD + 5, curY + 12);
  const confPct = pick.confidence || 90;
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

  // Bar fill
  const fillW = (confPct / 100) * barW;
  const barGrad = ctx.createLinearGradient(barX, 0, barX + fillW, 0);
  barGrad.addColorStop(0, '#ff8c00');
  barGrad.addColorStop(0.5, C.gold);
  barGrad.addColorStop(1, '#ffed4a');
  roundRect(ctx, barX, curY, fillW, barH, 5);
  ctx.fillStyle = barGrad;
  ctx.fill();

  curY += barH + 12;

  // ── Reasoning ──
  if (pick.reasoning) {
    roundRect(ctx, PAD, curY, INNER, 0, 6); // placeholder
    ctx.font = `400 13px ${FF}`;
    const reasonLines = wrapText(ctx, pick.reasoning, INNER - 20);
    const reasonH = 12 + reasonLines.length * 18 + 12;

    roundRect(ctx, PAD, curY, INNER, reasonH, 6);
    ctx.fillStyle = 'rgba(88, 166, 255, 0.06)';
    ctx.fill();
    roundRect(ctx, PAD, curY, INNER, reasonH, 6);
    ctx.strokeStyle = 'rgba(88, 166, 255, 0.15)';
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
  const colW = INNER / 4;

  const labels = ['RECORD', 'UNITS', 'STREAK', 'ROI'];
  const recordStr = `${record.wins}-${record.losses}-${record.pushes}`;
  const unitsStr = `${totalUnits >= 0 ? '+' : ''}${totalUnits.toFixed(1)}u`;
  const streakStr = streak > 0 ? `🔥 ${streak}W` : streak < 0 ? `${Math.abs(streak)}L` : '—';
  const totalBets = record.wins + record.losses;
  const roi = totalBets > 0 ? ((totalUnits / totalBets) * 100).toFixed(1) + '%' : '—';
  const values = [recordStr, unitsStr, streakStr, roi];
  const vColors = [C.white, totalUnits >= 0 ? C.green : C.red, streak > 0 ? C.green : streak < 0 ? C.red : C.muted, C.gold];

  for (let i = 0; i < 4; i++) {
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
  ctx.fillText('1u flat bet on every pick', PAD + 5, curY + 22);
  const poweredStr = 'Powered by GPT-4o';
  const pwW = ctx.measureText(poweredStr).width;
  ctx.fillText(poweredStr, W - PAD - pwW, curY + 22);

  return canvas.toBuffer('image/png');
}

/**
 * Generate result card after a pick closes
 */
async function generateAiRecordImage(closedPick, record, streak, totalUnits) {
  const W = 520;
  const H = 280;
  const PAD = 24;
  const INNER = W - PAD * 2;
  const brandLogo = await getBrandLogo();

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  const isWin = closedPick.status === 'win';
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#0d1117');
  bgGrad.addColorStop(1, '#0a0e14');
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.fillStyle = bgGrad;
  ctx.fill();

  // Border
  const borderColor = isWin ? 'rgba(63, 185, 80, 0.4)' : closedPick.status === 'loss' ? 'rgba(248, 81, 73, 0.4)' : 'rgba(255, 215, 0, 0.3)';
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Left bar
  ctx.save();
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.clip();
  ctx.fillStyle = isWin ? C.green : closedPick.status === 'loss' ? C.red : C.gold;
  ctx.fillRect(0, 0, 5, H);
  ctx.restore();

  let curY = 20;

  // Result header
  const statusEmoji = isWin ? '✅' : closedPick.status === 'loss' ? '❌' : '🔄';
  const statusText = isWin ? 'WIN' : closedPick.status === 'loss' ? 'LOSS' : 'PUSH';
  ctx.font = `900 22px ${FF}`;
  ctx.fillStyle = isWin ? C.green : closedPick.status === 'loss' ? C.red : C.gold;
  ctx.fillText(`${statusEmoji} AI PICK RESULT: ${statusText}`, PAD + 5, curY + 22);
  curY += 36;

  // Pick text
  ctx.font = `700 16px ${FF}`;
  ctx.fillStyle = C.white;
  ctx.fillText(closedPick.pick || '—', PAD + 5, curY + 16);
  curY += 24;

  // Result note
  if (closedPick.result_note) {
    ctx.font = `400 13px ${FF}`;
    ctx.fillStyle = C.gray;
    ctx.fillText(closedPick.result_note, PAD + 5, curY + 13);
    curY += 22;
  }

  // Final score
  if (closedPick.final_score) {
    ctx.font = `600 13px ${FF}`;
    ctx.fillStyle = C.muted;
    ctx.fillText(`Final: ${closedPick.final_score}`, PAD + 5, curY + 13);
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

  // Record stats row
  const colW = INNER / 4;
  const labels = ['RECORD', 'UNITS', 'STREAK', 'ROI'];
  const recordStr = `${record.wins}-${record.losses}-${record.pushes}`;
  const unitsStr = `${totalUnits >= 0 ? '+' : ''}${totalUnits.toFixed(1)}u`;
  const streakStr = streak > 0 ? `🔥 ${streak}W` : streak < 0 ? `${Math.abs(streak)}L` : '—';
  const totalBets = record.wins + record.losses;
  const roi = totalBets > 0 ? ((totalUnits / totalBets) * 100).toFixed(1) + '%' : '—';
  const values = [recordStr, unitsStr, streakStr, roi];
  const vColors = [C.white, totalUnits >= 0 ? C.green : C.red, streak > 0 ? C.green : streak < 0 ? C.red : C.muted, C.gold];

  for (let i = 0; i < 4; i++) {
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
  const poweredStr = 'The Gambling King • AI Picks';
  const pwW = ctx.measureText(poweredStr).width;
  ctx.fillText(poweredStr, (W - pwW) / 2, H - 14);

  return canvas.toBuffer('image/png');
}

/**
 * Generate monthly recap infographic
 */
async function generateMonthlyRecapImage(recap, year, month) {
  const W = 520;
  const PAD = 24;
  const INNER = W - PAD * 2;
  const brandLogo = await getBrandLogo();

  const monthName = new Date(year, month - 1).toLocaleString('en-US', { month: 'long' });
  const r = recap.record;
  const totalBets = r.wins + r.losses;
  const roi = totalBets > 0 ? ((r.units / totalBets) * 100).toFixed(1) : '0.0';

  // Calculate height
  const sportCount = Object.keys(recap.sportBreakdown).length;
  const H = 360 + sportCount * 22;

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
  ctx.strokeStyle = C.goldBorder;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Gold top bar
  ctx.save();
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.clip();
  ctx.fillStyle = C.gold;
  ctx.fillRect(0, 0, W, 4);
  ctx.restore();

  let curY = 24;

  // Title
  ctx.font = `900 20px ${FF}`;
  ctx.fillStyle = C.gold;
  ctx.fillText(`📊 ${monthName.toUpperCase()} ${year}`, PAD, curY + 20);
  curY += 28;
  ctx.font = `700 14px ${FF}`;
  ctx.fillStyle = C.white;
  ctx.fillText('AI PICK MONTHLY RECAP', PAD, curY + 14);
  curY += 28;

  // Divider
  ctx.strokeStyle = C.divider;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(16, curY);
  ctx.lineTo(W - 16, curY);
  ctx.stroke();
  ctx.setLineDash([]);
  curY += 12;

  // Big record
  ctx.font = `900 36px ${FF}`;
  ctx.fillStyle = C.white;
  const bigRecord = `${r.wins}-${r.losses}${r.pushes > 0 ? `-${r.pushes}` : ''}`;
  const brW = ctx.measureText(bigRecord).width;
  ctx.fillText(bigRecord, (W - brW) / 2, curY + 36);
  curY += 48;

  // Stats row
  const colW = INNER / 3;
  const labels2 = ['UNITS', 'ROI', 'BEST STREAK'];
  const unitsStr = `${r.units >= 0 ? '+' : ''}${r.units.toFixed(2)}u`;
  const vals2 = [unitsStr, roi + '%', `${recap.maxStreak}W`];
  const vCols2 = [r.units >= 0 ? C.green : C.red, C.gold, C.green];

  for (let i = 0; i < 3; i++) {
    const cx = PAD + colW * i + colW / 2;
    ctx.font = `700 9px ${FF}`;
    ctx.fillStyle = C.muted;
    const lw = ctx.measureText(labels2[i]).width;
    ctx.fillText(labels2[i], cx - lw / 2, curY + 10);
    ctx.font = `800 18px ${FF}`;
    ctx.fillStyle = vCols2[i];
    const vw = ctx.measureText(vals2[i]).width;
    ctx.fillText(vals2[i], cx - vw / 2, curY + 34);
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

  // Best/Worst picks
  if (recap.bestPick) {
    ctx.font = `700 11px ${FF}`;
    ctx.fillStyle = C.green;
    ctx.fillText('BEST PICK', PAD, curY + 11);
    ctx.font = `500 12px ${FF}`;
    ctx.fillStyle = C.white;
    ctx.fillText(`${recap.bestPick.pick} (${formatOdds(recap.bestPick.odds_american)})`, PAD + 80, curY + 11);
    curY += 20;
  }
  if (recap.worstPick) {
    ctx.font = `700 11px ${FF}`;
    ctx.fillStyle = C.red;
    ctx.fillText('WORST PICK', PAD, curY + 11);
    ctx.font = `500 12px ${FF}`;
    ctx.fillStyle = C.white;
    ctx.fillText(`${recap.worstPick.pick} (${formatOdds(recap.worstPick.odds_american)})`, PAD + 80, curY + 11);
    curY += 20;
  }
  curY += 8;

  // Sport breakdown
  if (sportCount > 0) {
    ctx.strokeStyle = C.divider;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(16, curY);
    ctx.lineTo(W - 16, curY);
    ctx.stroke();
    ctx.setLineDash([]);
    curY += 12;

    ctx.font = `700 11px ${FF}`;
    ctx.fillStyle = C.gold;
    ctx.fillText('SPORT BREAKDOWN', PAD, curY + 11);
    curY += 20;

    for (const [sport, stats] of Object.entries(recap.sportBreakdown)) {
      const sName = SPORT_NAMES[sport] || sport.toUpperCase();
      ctx.font = `500 12px ${FF}`;
      ctx.fillStyle = C.gray;
      ctx.fillText(sName, PAD + 8, curY + 12);
      ctx.fillStyle = C.white;
      ctx.fillText(`${stats.wins}-${stats.losses}`, PAD + 160, curY + 12);

      // Mini bar
      const total = stats.wins + stats.losses;
      if (total > 0) {
        const barX2 = PAD + 220;
        const barW2 = INNER - 220;
        roundRect(ctx, barX2, curY + 4, barW2, 6, 3);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.fill();
        const winPct = stats.wins / total;
        if (winPct > 0) {
          roundRect(ctx, barX2, curY + 4, barW2 * winPct, 6, 3);
          ctx.fillStyle = C.green;
          ctx.fill();
        }
      }
      curY += 22;
    }
  }

  // Footer
  ctx.font = `500 10px ${FF}`;
  ctx.fillStyle = C.muted;
  const footStr = 'The Gambling King • AI Picks • 1u flat bet';
  const fW = ctx.measureText(footStr).width;
  ctx.fillText(footStr, (W - fW) / 2, H - 14);

  return canvas.toBuffer('image/png');
}

module.exports = {
  generateAiPickCardImage,
  generateAiRecordImage,
  generateMonthlyRecapImage,
};
