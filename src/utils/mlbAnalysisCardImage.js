/**
 * MLB Analysis Card Image Generators
 * Creates premium styled slate-view cards for NRFI, Strikeout, and HR analyses.
 */
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');

const FONT_PATH = path.join(__dirname, '..', 'fonts', 'Inter-Variable.ttf');
const EMOJI_FONT_PATH = path.join(__dirname, '..', 'fonts', 'NotoColorEmoji.ttf');
GlobalFonts.registerFromPath(FONT_PATH, 'Inter');
GlobalFonts.registerFromPath(EMOJI_FONT_PATH, 'NotoColorEmoji');
const FF = '"Inter", "NotoColorEmoji", sans-serif';

// ── Color Themes ──
const THEMES = {
  nrfi: {
    accent: '#3fb950',
    accentFaint: 'rgba(63, 185, 80, 0.12)',
    accentBorder: 'rgba(63, 185, 80, 0.3)',
    icon: '⚾',
    title: 'NRFI DAILY ANALYSIS',
    yes: '#3fb950',
    no: '#f85149',
  },
  strikeout: {
    accent: '#f85149',
    accentFaint: 'rgba(248, 81, 73, 0.12)',
    accentBorder: 'rgba(248, 81, 73, 0.3)',
    icon: '🔥',
    title: 'STRIKEOUT O/U DAILY',
    yes: '#f85149',
    no: '#58a6ff',
  },
  homerun: {
    accent: '#a855f7',
    accentFaint: 'rgba(168, 85, 247, 0.12)',
    accentBorder: 'rgba(168, 85, 247, 0.3)',
    icon: '💣',
    title: 'HOME RUN DAILY',
    yes: '#a855f7',
    no: '#58a6ff',
  },
};

const C = {
  bg: '#0d1117',
  bgCard: '#161b22',
  bgRow: '#1a2332',
  bgRowAlt: '#151d28',
  white: '#ffffff',
  gray: '#8b949e',
  muted: '#484f58',
  divider: 'rgba(255,255,255,0.06)',
  green: '#3fb950',
  greenFaint: 'rgba(63, 185, 80, 0.15)',
  red: '#f85149',
  redFaint: 'rgba(248, 81, 73, 0.15)',
  gold: '#FFD700',
  goldFaint: 'rgba(255, 215, 0, 0.12)',
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

function drawPill(ctx, x, y, text, bg, fg, fontSize = 10, padX = 8, padY = 3) {
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

function truncate(text, maxLen) {
  if (!text) return '';
  return text.length > maxLen ? text.substring(0, maxLen - 1) + '…' : text;
}

function formatTime(isoStr) {
  if (!isoStr) return '';
  try {
    return new Date(isoStr).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
    });
  } catch { return ''; }
}

function statusIcon(status) {
  if (status === 'hit') return '✅';
  if (status === 'miss') return '❌';
  if (status === 'push') return '🔄';
  if (status === 'postponed') return '⏸️';
  return '⏳';
}

// ══════════════════════════════════════════
// NRFI Card
// ══════════════════════════════════════════

async function generateNrfiCardImage(entries, record, streak) {
  const theme = THEMES.nrfi;
  const W = 560;
  const PAD = 20;
  const INNER = W - PAD * 2;
  const ROW_H = 72;
  const HEADER_H = 70;
  const FOOTER_H = 50;

  const H = HEADER_H + entries.length * ROW_H + FOOTER_H + 8;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  roundRect(ctx, 0, 0, W, H, 14);
  ctx.fillStyle = C.bg;
  ctx.fill();
  roundRect(ctx, 0, 0, W, H, 14);
  ctx.strokeStyle = theme.accentBorder;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Left accent bar
  ctx.save();
  roundRect(ctx, 0, 0, W, H, 14);
  ctx.clip();
  ctx.fillStyle = theme.accent;
  ctx.fillRect(0, 0, 4, H);
  ctx.restore();

  // ── Header ──
  let y = 0;
  ctx.save();
  roundRect(ctx, 0, 0, W, H, 14);
  ctx.clip();
  const hdrGrad = ctx.createLinearGradient(0, 0, W, HEADER_H);
  hdrGrad.addColorStop(0, theme.accentFaint);
  hdrGrad.addColorStop(1, 'rgba(13, 17, 23, 0.8)');
  ctx.fillStyle = hdrGrad;
  ctx.fillRect(4, 0, W - 4, HEADER_H);
  ctx.restore();

  ctx.font = `900 18px ${FF}`;
  ctx.fillStyle = theme.accent;
  ctx.fillText(`${theme.icon} ${theme.title}`, PAD + 4, 28);

  // Date
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
  ctx.font = `600 11px ${FF}`;
  ctx.fillStyle = C.muted;
  const dateW = ctx.measureText(dateStr).width;
  ctx.fillText(dateStr, W - PAD - dateW, 26);

  // Record bar
  const recStr = `Record: ${record.hits}-${record.misses}${record.pushes ? `-${record.pushes}` : ''}`;
  const total = record.hits + record.misses;
  const pct = total > 0 ? ((record.hits / total) * 100).toFixed(1) + '%' : '—';
  ctx.font = `600 11px ${FF}`;
  ctx.fillStyle = C.gray;
  ctx.fillText(recStr, PAD + 4, 50);

  ctx.fillStyle = record.hits >= record.misses ? C.green : C.red;
  ctx.fillText(pct, PAD + 4 + ctx.measureText(recStr + '  ').width, 50);

  if (streak !== 0) {
    const sText = streak > 0 ? `🔥 ${streak}W` : `${Math.abs(streak)}L`;
    ctx.fillStyle = streak > 0 ? C.green : C.red;
    ctx.font = `700 10px ${FF}`;
    const sW = ctx.measureText(sText).width;
    ctx.fillText(sText, W - PAD - sW, 50);
  }

  // Divider
  ctx.strokeStyle = C.divider;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(12, HEADER_H - 1);
  ctx.lineTo(W - 12, HEADER_H - 1);
  ctx.stroke();

  y = HEADER_H;

  // ── Game Rows ──
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const rowY = y;
    const isAlt = i % 2 === 1;

    // Row background
    ctx.fillStyle = isAlt ? C.bgRowAlt : C.bgRow;
    if (i === 0) {
      // First row - clip to card border
      ctx.fillRect(4, rowY, W - 4, ROW_H);
    } else if (i === entries.length - 1) {
      // Last row
      ctx.fillRect(4, rowY, W - 4, ROW_H);
    } else {
      ctx.fillRect(4, rowY, W - 4, ROW_H);
    }

    // Status icon
    const sIcon = statusIcon(e.status);
    ctx.font = `400 14px ${FF}`;
    ctx.fillText(sIcon, PAD, rowY + 25);

    // Matchup
    ctx.font = `700 13px ${FF}`;
    ctx.fillStyle = C.white;
    const matchup = `${e.away_abbr} @ ${e.home_abbr}`;
    ctx.fillText(matchup, PAD + 24, rowY + 20);

    // Game number for doubleheaders
    if (e.game_number > 1) {
      ctx.font = `600 9px ${FF}`;
      ctx.fillStyle = C.gold;
      ctx.fillText(`GM ${e.game_number}`, PAD + 24 + ctx.measureText(matchup + ' ').width, rowY + 20);
    }

    // Time
    const time = formatTime(e.event_start_time);
    ctx.font = `500 10px ${FF}`;
    ctx.fillStyle = C.muted;
    if (time) {
      const tW = ctx.measureText(time + ' ET').width;
      ctx.fillText(time + ' ET', W - PAD - tW, rowY + 20);
    }

    // Pitchers
    const pitcherStr = `${truncate(e.away_pitcher, 14)} vs ${truncate(e.home_pitcher, 14)}`;
    ctx.font = `400 11px ${FF}`;
    ctx.fillStyle = C.gray;
    ctx.fillText(pitcherStr, PAD + 24, rowY + 38);

    // Suggestion pill
    const isNrfi = e.suggestion === 'NRFI';
    const pillBg = isNrfi ? C.greenFaint : C.redFaint;
    const pillFg = isNrfi ? C.green : C.red;
    drawPill(ctx, PAD + 24, rowY + 46, e.suggestion, pillBg, pillFg, 10, 8, 3);

    // Confidence
    const confX = PAD + 24 + (isNrfi ? 60 : 55);
    ctx.font = `700 10px ${FF}`;
    ctx.fillStyle = e.confidence >= 75 ? C.green : e.confidence >= 60 ? C.gold : C.gray;
    ctx.fillText(`${e.confidence}%`, confX, rowY + 57);

    // Odds
    if (e.odds) {
      ctx.font = `500 10px ${FF}`;
      ctx.fillStyle = C.muted;
      ctx.fillText(e.odds, confX + 40, rowY + 57);
    }

    // Result text (if resolved)
    if (e.actual_result && e.status !== 'pending') {
      ctx.font = `500 10px ${FF}`;
      ctx.fillStyle = e.status === 'hit' ? C.green : C.red;
      const rW = ctx.measureText(e.actual_result).width;
      const maxRW = 180;
      const resultText = rW > maxRW ? truncate(e.actual_result, 30) : e.actual_result;
      const rtW = ctx.measureText(resultText).width;
      ctx.fillText(resultText, W - PAD - rtW, rowY + 57);
    }

    y += ROW_H;

    // Row divider
    if (i < entries.length - 1) {
      ctx.strokeStyle = C.divider;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD, y - 1);
      ctx.lineTo(W - PAD, y - 1);
      ctx.stroke();
    }
  }

  // ── Footer ──
  ctx.strokeStyle = C.divider;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(12, y);
  ctx.lineTo(W - 12, y);
  ctx.stroke();

  const nrfiCount = entries.filter(e => e.suggestion === 'NRFI').length;
  ctx.font = `600 10px ${FF}`;
  ctx.fillStyle = C.gray;
  ctx.fillText(`${nrfiCount} NRFI | ${entries.length - nrfiCount} YRFI | ${entries.length} games`, PAD + 4, y + 24);

  ctx.fillStyle = C.muted;
  const pwStr = 'Powered by GPT-4o + ESPN';
  const pwW = ctx.measureText(pwStr).width;
  ctx.fillText(pwStr, W - PAD - pwW, y + 24);

  return canvas.toBuffer('image/png');
}

// ══════════════════════════════════════════
// Strikeout Card
// ══════════════════════════════════════════

async function generateStrikeoutCardImage(entries, record, streak) {
  const theme = THEMES.strikeout;
  const W = 560;
  const PAD = 20;
  const INNER = W - PAD * 2;
  const ROW_H = 80;
  const HEADER_H = 70;
  const FOOTER_H = 50;

  const H = HEADER_H + entries.length * ROW_H + FOOTER_H + 8;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  roundRect(ctx, 0, 0, W, H, 14);
  ctx.fillStyle = C.bg;
  ctx.fill();
  roundRect(ctx, 0, 0, W, H, 14);
  ctx.strokeStyle = theme.accentBorder;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.save();
  roundRect(ctx, 0, 0, W, H, 14);
  ctx.clip();
  ctx.fillStyle = theme.accent;
  ctx.fillRect(0, 0, 4, H);
  ctx.restore();

  // Header
  let y = 0;
  ctx.save();
  roundRect(ctx, 0, 0, W, H, 14);
  ctx.clip();
  const hdrGrad = ctx.createLinearGradient(0, 0, W, HEADER_H);
  hdrGrad.addColorStop(0, theme.accentFaint);
  hdrGrad.addColorStop(1, 'rgba(13, 17, 23, 0.8)');
  ctx.fillStyle = hdrGrad;
  ctx.fillRect(4, 0, W - 4, HEADER_H);
  ctx.restore();

  ctx.font = `900 18px ${FF}`;
  ctx.fillStyle = theme.accent;
  ctx.fillText(`${theme.icon} ${theme.title}`, PAD + 4, 28);

  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
  ctx.font = `600 11px ${FF}`;
  ctx.fillStyle = C.muted;
  const dateW = ctx.measureText(dateStr).width;
  ctx.fillText(dateStr, W - PAD - dateW, 26);

  const recStr = `Record: ${record.hits}-${record.misses}${record.pushes ? `-${record.pushes}` : ''}`;
  const total = record.hits + record.misses;
  const pct = total > 0 ? ((record.hits / total) * 100).toFixed(1) + '%' : '—';
  ctx.font = `600 11px ${FF}`;
  ctx.fillStyle = C.gray;
  ctx.fillText(recStr, PAD + 4, 50);
  ctx.fillStyle = record.hits >= record.misses ? C.green : C.red;
  ctx.fillText(pct, PAD + 4 + ctx.measureText(recStr + '  ').width, 50);

  if (streak !== 0) {
    const sText = streak > 0 ? `🔥 ${streak}W` : `${Math.abs(streak)}L`;
    ctx.fillStyle = streak > 0 ? C.green : C.red;
    ctx.font = `700 10px ${FF}`;
    const sW = ctx.measureText(sText).width;
    ctx.fillText(sText, W - PAD - sW, 50);
  }

  ctx.strokeStyle = C.divider;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(12, HEADER_H - 1);
  ctx.lineTo(W - 12, HEADER_H - 1);
  ctx.stroke();

  y = HEADER_H;

  // Game Rows
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const rowY = y;
    const isAlt = i % 2 === 1;

    ctx.fillStyle = isAlt ? C.bgRowAlt : C.bgRow;
    ctx.fillRect(4, rowY, W - 4, ROW_H);

    // Status icon
    ctx.font = `400 14px ${FF}`;
    ctx.fillText(statusIcon(e.status), PAD, rowY + 22);

    // Matchup
    ctx.font = `700 13px ${FF}`;
    ctx.fillStyle = C.white;
    ctx.fillText(`${e.away_abbr} @ ${e.home_abbr}`, PAD + 24, rowY + 18);

    // Time
    const time = formatTime(e.event_start_time);
    if (time) {
      ctx.font = `500 10px ${FF}`;
      ctx.fillStyle = C.muted;
      const tW = ctx.measureText(time + ' ET').width;
      ctx.fillText(time + ' ET', W - PAD - tW, rowY + 18);
    }

    // Both pitchers with their analysis
    const homeAnalysis = e.home_pitcher_stats?.analysis;
    const awayAnalysis = e.away_pitcher_stats?.analysis;

    // Away pitcher line
    ctx.font = `500 11px ${FF}`;
    ctx.fillStyle = C.gray;
    const awayLabel = truncate(e.away_pitcher, 16);
    ctx.fillText(awayLabel, PAD + 24, rowY + 36);

    if (awayAnalysis) {
      const aDir = awayAnalysis.suggestion === 'Over';
      const aPillBg = aDir ? C.redFaint : 'rgba(88, 166, 255, 0.12)';
      const aPillFg = aDir ? C.red : '#58a6ff';
      const aPillText = `${awayAnalysis.suggestion} ${awayAnalysis.line} K`;
      const aPillX = PAD + 24 + ctx.measureText(awayLabel + '  ').width;
      drawPill(ctx, aPillX, rowY + 26, aPillText, aPillBg, aPillFg, 9, 6, 2);

      ctx.font = `700 9px ${FF}`;
      ctx.fillStyle = awayAnalysis.confidence >= 70 ? C.green : C.gold;
      ctx.fillText(`${awayAnalysis.confidence}%`, aPillX + ctx.measureText(aPillText).width + 28, rowY + 35);
    }

    // Home pitcher line
    ctx.font = `500 11px ${FF}`;
    ctx.fillStyle = C.gray;
    const homeLabel = truncate(e.home_pitcher, 16);
    ctx.fillText(homeLabel, PAD + 24, rowY + 52);

    if (homeAnalysis) {
      const hDir = homeAnalysis.suggestion === 'Over';
      const hPillBg = hDir ? C.redFaint : 'rgba(88, 166, 255, 0.12)';
      const hPillFg = hDir ? C.red : '#58a6ff';
      const hPillText = `${homeAnalysis.suggestion} ${homeAnalysis.line} K`;
      const hPillX = PAD + 24 + ctx.measureText(homeLabel + '  ').width;
      drawPill(ctx, hPillX, rowY + 42, hPillText, hPillBg, hPillFg, 9, 6, 2);

      ctx.font = `700 9px ${FF}`;
      ctx.fillStyle = homeAnalysis.confidence >= 70 ? C.green : C.gold;
      ctx.fillText(`${homeAnalysis.confidence}%`, hPillX + ctx.measureText(hPillText).width + 28, rowY + 51);
    }

    // Best pick highlight
    ctx.font = `600 10px ${FF}`;
    ctx.fillStyle = theme.accent;
    const bestStr = `⭐ ${truncate(e.suggestion, 30)}`;
    ctx.fillText(bestStr, PAD + 24, rowY + 68);

    // Result
    if (e.actual_result && e.status !== 'pending') {
      ctx.font = `500 9px ${FF}`;
      ctx.fillStyle = e.status === 'hit' ? C.green : C.red;
      const rText = truncate(e.actual_result, 28);
      const rW = ctx.measureText(rText).width;
      ctx.fillText(rText, W - PAD - rW, rowY + 68);
    }

    y += ROW_H;

    if (i < entries.length - 1) {
      ctx.strokeStyle = C.divider;
      ctx.beginPath();
      ctx.moveTo(PAD, y - 1);
      ctx.lineTo(W - PAD, y - 1);
      ctx.stroke();
    }
  }

  // Footer
  ctx.strokeStyle = C.divider;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(12, y);
  ctx.lineTo(W - 12, y);
  ctx.stroke();

  const overCount = entries.filter(e => e.suggestion.includes('Over')).length;
  ctx.font = `600 10px ${FF}`;
  ctx.fillStyle = C.gray;
  ctx.fillText(`${overCount} Overs | ${entries.length - overCount} Unders | ${entries.length} matchups`, PAD + 4, y + 24);

  ctx.fillStyle = C.muted;
  const pwStr = 'Powered by GPT-4o + ESPN';
  const pwW = ctx.measureText(pwStr).width;
  ctx.fillText(pwStr, W - PAD - pwW, y + 24);

  return canvas.toBuffer('image/png');
}

// ══════════════════════════════════════════
// Home Run Card
// ══════════════════════════════════════════

async function generateHomerunCardImage(entries, record, streak) {
  const theme = THEMES.homerun;
  const W = 560;
  const PAD = 20;
  const INNER = W - PAD * 2;
  const ROW_H = 72;
  const HEADER_H = 70;
  const FOOTER_H = 50;

  const H = HEADER_H + entries.length * ROW_H + FOOTER_H + 8;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  roundRect(ctx, 0, 0, W, H, 14);
  ctx.fillStyle = C.bg;
  ctx.fill();
  roundRect(ctx, 0, 0, W, H, 14);
  ctx.strokeStyle = theme.accentBorder;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.save();
  roundRect(ctx, 0, 0, W, H, 14);
  ctx.clip();
  ctx.fillStyle = theme.accent;
  ctx.fillRect(0, 0, 4, H);
  ctx.restore();

  // Header
  let y = 0;
  ctx.save();
  roundRect(ctx, 0, 0, W, H, 14);
  ctx.clip();
  const hdrGrad = ctx.createLinearGradient(0, 0, W, HEADER_H);
  hdrGrad.addColorStop(0, theme.accentFaint);
  hdrGrad.addColorStop(1, 'rgba(13, 17, 23, 0.8)');
  ctx.fillStyle = hdrGrad;
  ctx.fillRect(4, 0, W - 4, HEADER_H);
  ctx.restore();

  ctx.font = `900 18px ${FF}`;
  ctx.fillStyle = theme.accent;
  ctx.fillText(`${theme.icon} ${theme.title}`, PAD + 4, 28);

  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
  ctx.font = `600 11px ${FF}`;
  ctx.fillStyle = C.muted;
  const dateW = ctx.measureText(dateStr).width;
  ctx.fillText(dateStr, W - PAD - dateW, 26);

  const recStr = `Record: ${record.hits}-${record.misses}${record.pushes ? `-${record.pushes}` : ''}`;
  const total = record.hits + record.misses;
  const pct = total > 0 ? ((record.hits / total) * 100).toFixed(1) + '%' : '—';
  ctx.font = `600 11px ${FF}`;
  ctx.fillStyle = C.gray;
  ctx.fillText(recStr, PAD + 4, 50);
  ctx.fillStyle = record.hits >= record.misses ? C.green : C.red;
  ctx.fillText(pct, PAD + 4 + ctx.measureText(recStr + '  ').width, 50);

  if (streak !== 0) {
    const sText = streak > 0 ? `🔥 ${streak}W` : `${Math.abs(streak)}L`;
    ctx.fillStyle = streak > 0 ? C.green : C.red;
    ctx.font = `700 10px ${FF}`;
    const sW = ctx.measureText(sText).width;
    ctx.fillText(sText, W - PAD - sW, 50);
  }

  ctx.strokeStyle = C.divider;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(12, HEADER_H - 1);
  ctx.lineTo(W - 12, HEADER_H - 1);
  ctx.stroke();

  y = HEADER_H;

  // Game Rows
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const rowY = y;
    const isAlt = i % 2 === 1;

    ctx.fillStyle = isAlt ? C.bgRowAlt : C.bgRow;
    ctx.fillRect(4, rowY, W - 4, ROW_H);

    // Status
    ctx.font = `400 14px ${FF}`;
    ctx.fillText(statusIcon(e.status), PAD, rowY + 25);

    // Matchup
    ctx.font = `700 13px ${FF}`;
    ctx.fillStyle = C.white;
    ctx.fillText(`${e.away_abbr} @ ${e.home_abbr}`, PAD + 24, rowY + 20);

    // Time
    const time = formatTime(e.event_start_time);
    if (time) {
      ctx.font = `500 10px ${FF}`;
      ctx.fillStyle = C.muted;
      const tW = ctx.measureText(time + ' ET').width;
      ctx.fillText(time + ' ET', W - PAD - tW, rowY + 20);
    }

    // Pitchers
    ctx.font = `400 11px ${FF}`;
    ctx.fillStyle = C.gray;
    ctx.fillText(`${truncate(e.away_pitcher, 14)} vs ${truncate(e.home_pitcher, 14)}`, PAD + 24, rowY + 38);

    // Suggestion pill
    const isLikely = e.suggestion === 'HR Likely';
    const pillBg = isLikely ? theme.accentFaint : 'rgba(88, 166, 255, 0.12)';
    const pillFg = isLikely ? theme.accent : '#58a6ff';
    drawPill(ctx, PAD + 24, rowY + 46, e.suggestion, pillBg, pillFg, 10, 8, 3);

    // Confidence
    const confX = PAD + 24 + (isLikely ? 90 : 100);
    ctx.font = `700 10px ${FF}`;
    ctx.fillStyle = e.confidence >= 75 ? C.green : e.confidence >= 60 ? C.gold : C.gray;
    ctx.fillText(`${e.confidence}%`, confX, rowY + 57);

    // HR Watch candidate (extracted from reasoning)
    const hrMatch = e.reasoning?.match(/🎯 HR Watch: (.+)/);
    if (hrMatch) {
      ctx.font = `600 10px ${FF}`;
      ctx.fillStyle = C.gold;
      ctx.fillText(`🎯 ${hrMatch[1]}`, confX + 38, rowY + 57);
    }

    // Result
    if (e.actual_result && e.status !== 'pending') {
      ctx.font = `500 10px ${FF}`;
      ctx.fillStyle = e.status === 'hit' ? C.green : C.red;
      const rText = truncate(e.actual_result, 35);
      const rW = ctx.measureText(rText).width;
      ctx.fillText(rText, W - PAD - rW, rowY + 57);
    }

    y += ROW_H;

    if (i < entries.length - 1) {
      ctx.strokeStyle = C.divider;
      ctx.beginPath();
      ctx.moveTo(PAD, y - 1);
      ctx.lineTo(W - PAD, y - 1);
      ctx.stroke();
    }
  }

  // Footer
  ctx.strokeStyle = C.divider;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(12, y);
  ctx.lineTo(W - 12, y);
  ctx.stroke();

  const likelyCount = entries.filter(e => e.suggestion === 'HR Likely').length;
  ctx.font = `600 10px ${FF}`;
  ctx.fillStyle = C.gray;
  ctx.fillText(`${likelyCount} HR Likely | ${entries.length - likelyCount} Low HR | ${entries.length} games`, PAD + 4, y + 24);

  ctx.fillStyle = C.muted;
  const pwStr = 'Powered by GPT-4o + ESPN';
  const pwW = ctx.measureText(pwStr).width;
  ctx.fillText(pwStr, W - PAD - pwW, y + 24);

  return canvas.toBuffer('image/png');
}

module.exports = {
  generateNrfiCardImage,
  generateStrikeoutCardImage,
  generateHomerunCardImage,
};
