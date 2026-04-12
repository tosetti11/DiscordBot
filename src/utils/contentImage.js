const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');

// ── Register fonts (same as betCardImage) ────────────────────
const FONT_PATH = path.join(__dirname, '..', 'fonts', 'Inter-Variable.ttf');
const EMOJI_FONT_PATH = path.join(__dirname, '..', 'fonts', 'NotoColorEmoji.ttf');
GlobalFonts.registerFromPath(FONT_PATH, 'Inter');
GlobalFonts.registerFromPath(EMOJI_FONT_PATH, 'NotoColorEmoji');
const FF = '"Inter", "NotoColorEmoji", sans-serif';

// ── Theme colors (matches bet cards) ─────────────────────────
const C = {
  bgTop: '#1e1e1e',
  bgBot: '#161616',
  accent: '#FF8732',
  accentFaint: 'rgba(255, 135, 50, 0.12)',
  headerBg: 'rgba(80, 35, 20, 0.55)',
  textPrimary: '#ffffff',
  textSecondary: '#b3b3b3',
  textMuted: '#727272',
  win: '#43b581',
  loss: '#ff4444',
  rowEven: 'rgba(255, 255, 255, 0.03)',
  rowOdd: 'rgba(0, 0, 0, 0.1)',
  border: 'rgba(255, 135, 50, 0.18)',
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Generate a styled table image from structured data.
 * @param {Object} data - { title, subtitle, columns: [{header, align}], rows: [[cell, ...]], footer }
 * @returns {Buffer} PNG image buffer
 */
function generateContentImage(data) {
  const { title, subtitle, columns, rows, footer } = data;
  const PAD = 24;
  const ROW_H = 38;
  const HEADER_ROW_H = 36;
  const WIDTH = 520;

  // ── Measure heights ──
  let totalH = PAD; // top padding
  if (title) totalH += 32;
  if (subtitle) totalH += 20;
  totalH += 16; // gap after header
  totalH += HEADER_ROW_H; // column headers
  totalH += rows.length * ROW_H; // data rows
  if (footer) totalH += 28; // footer
  totalH += PAD; // bottom padding

  const canvas = createCanvas(WIDTH, totalH);
  const ctx = canvas.getContext('2d');

  // ── Background gradient ──
  const bgGrad = ctx.createLinearGradient(0, 0, 0, totalH);
  bgGrad.addColorStop(0, C.bgTop);
  bgGrad.addColorStop(1, C.bgBot);
  ctx.fillStyle = bgGrad;
  roundRect(ctx, 0, 0, WIDTH, totalH, 12);
  ctx.fill();

  // ── Border ──
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  roundRect(ctx, 0, 0, WIDTH, totalH, 12);
  ctx.stroke();

  let curY = PAD;

  // ── Title ──
  if (title) {
    ctx.font = `bold 20px ${FF}`;
    ctx.fillStyle = C.accent;
    ctx.fillText(title, PAD, curY + 18);
    curY += 32;
  }

  // ── Subtitle ──
  if (subtitle) {
    ctx.font = `12px ${FF}`;
    ctx.fillStyle = C.textMuted;
    ctx.fillText(subtitle, PAD, curY + 12);
    curY += 20;
  }

  curY += 16; // gap

  // ── Calculate column widths ──
  const tableW = WIDTH - PAD * 2;
  const colCount = columns.length;

  // Measure text to calculate proportional widths
  ctx.font = `600 13px ${FF}`;
  const colWidths = [];
  for (let c = 0; c < colCount; c++) {
    let maxW = ctx.measureText(columns[c].header).width;
    ctx.font = `14px ${FF}`;
    for (const row of rows) {
      const cellW = ctx.measureText(String(row[c] || '')).width;
      if (cellW > maxW) maxW = cellW;
    }
    colWidths.push(maxW + 24); // padding
    ctx.font = `600 13px ${FF}`;
  }
  // Scale to fit
  const totalColW = colWidths.reduce((a, b) => a + b, 0);
  const scale = tableW / totalColW;
  for (let i = 0; i < colWidths.length; i++) colWidths[i] *= scale;

  // ── Column headers ──
  ctx.fillStyle = C.accentFaint;
  roundRect(ctx, PAD - 4, curY, tableW + 8, HEADER_ROW_H, 6);
  ctx.fill();

  ctx.font = `600 12px ${FF}`;
  ctx.fillStyle = C.accent;
  let colX = PAD;
  for (let c = 0; c < colCount; c++) {
    const align = columns[c].align || 'left';
    const text = columns[c].header.toUpperCase();
    const tw = ctx.measureText(text).width;
    let tx = colX + 8;
    if (align === 'right') tx = colX + colWidths[c] - tw - 8;
    else if (align === 'center') tx = colX + (colWidths[c] - tw) / 2;
    ctx.fillText(text, tx, curY + HEADER_ROW_H / 2 + 5);
    colX += colWidths[c];
  }
  curY += HEADER_ROW_H;

  // ── Data rows ──
  for (let r = 0; r < rows.length; r++) {
    // Alternating row bg
    ctx.fillStyle = r % 2 === 0 ? C.rowEven : C.rowOdd;
    ctx.fillRect(PAD - 4, curY, tableW + 8, ROW_H);

    // Row separator
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(PAD, curY + ROW_H);
    ctx.lineTo(PAD + tableW, curY + ROW_H);
    ctx.stroke();

    colX = PAD;
    for (let c = 0; c < colCount; c++) {
      const cell = String(rows[r][c] || '');
      const align = columns[c].align || 'left';

      // Color coding: green for positive, red for negative, default for rest
      if (cell.startsWith('+')) ctx.fillStyle = C.win;
      else if (cell.startsWith('-') && !isNaN(parseFloat(cell))) ctx.fillStyle = C.loss;
      else if (c === 0) ctx.fillStyle = C.textPrimary;
      else ctx.fillStyle = C.textSecondary;

      ctx.font = c === 0 ? `600 14px ${FF}` : `14px ${FF}`;
      const tw = ctx.measureText(cell).width;
      let tx = colX + 8;
      if (align === 'right') tx = colX + colWidths[c] - tw - 8;
      else if (align === 'center') tx = colX + (colWidths[c] - tw) / 2;
      ctx.fillText(cell, tx, curY + ROW_H / 2 + 5);
      colX += colWidths[c];
    }
    curY += ROW_H;
  }

  // ── Footer ──
  if (footer) {
    curY += 8;
    ctx.font = `11px ${FF}`;
    ctx.fillStyle = C.textMuted;
    ctx.fillText(footer, PAD, curY + 12);
  }

  return canvas.toBuffer('image/png');
}

module.exports = { generateContentImage };
