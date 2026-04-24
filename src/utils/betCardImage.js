const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const { SPORT_NAMES, WAGER_TYPES, PERIODS, FIGHT_METHODS } = require('../config/constants');
const { formatOdds, calculatePayout } = require('./odds');
const { getGameSummary, getGolfPlayerRound, getGolf2BallLive, parsePropDescription, findPlayer, MLB_API_STATS, findMlbGamePk, getMlbPlayerStats, COMPUTED_STATS } = require('../services/espn');

// ── Parse event start time to YYYY-MM-DD date string ────────
const MONTH_MAP = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
function parseEventDate(eventStartTime) {
  const fallback = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  if (!eventStartTime) return fallback;
  // Try ISO parse
  const iso = new Date(eventStartTime);
  if (!isNaN(iso.getTime())) return iso.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  // Parse "Sat Apr 11 9:40 PM ET" format
  const m = String(eventStartTime).match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\b/i);
  if (m) {
    const month = MONTH_MAP[m[1].toLowerCase()];
    if (month) return `${new Date().getFullYear()}-${month}-${m[2].padStart(2, '0')}`;
  }
  return fallback;
}

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
  cashout: { bar: '#5865f2', bgBadge: 'rgba(88, 101, 242, 0.25)', text: '#7289da' },
};

const STATUS_LABELS = { open: 'PENDING', win: 'WON', loss: 'LOST', push: 'PUSH', void: 'VOID', cashout: 'CASHED OUT' };

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

// ── Live score helper ──────────────────────────────────────
async function fetchLiveScore(sport, espnGameId, wagerType) {
  if (!espnGameId || !sport) return null;
  try {
    const summary = await getGameSummary(sport, espnGameId);
    if (!summary || !summary.home) return null;

    const isNrfi = wagerType === 'nrfi' || wagerType === 'yrfi';

    if (isNrfi) {
      // NRFI/YRFI: show only 1st inning runs
      const homeInning1 = summary.linescores?.home?.[0];
      const awayInning1 = summary.linescores?.away?.[0];
      if (!homeInning1 && !awayInning1) {
        // No 1st inning data yet — game hasn't started or no linescore
        return {
          homeAbbr: summary.home.abbreviation || summary.home.name || '',
          awayAbbr: summary.away.abbreviation || summary.away.name || '',
          homeScore: '-',
          awayScore: '-',
          state: summary.state || 'pre',
          detail: summary.detail || '',
          isNrfi: true,
        };
      }
      const homeR1 = parseFloat(homeInning1?.displayValue || homeInning1?.value || '0');
      const awayR1 = parseFloat(awayInning1?.displayValue || awayInning1?.value || '0');
      // Determine if 1st inning is complete (game past inning 1)
      const inning = summary.period || 0;
      const firstInningDone = inning > 1 || summary.state === 'post';
      return {
        homeAbbr: summary.home.abbreviation || summary.home.name || '',
        awayAbbr: summary.away.abbreviation || summary.away.name || '',
        homeScore: homeR1,
        awayScore: awayR1,
        state: summary.state || 'pre',
        detail: firstInningDone ? '1st Inn Complete' : summary.detail || '',
        isNrfi: true,
      };
    }

    return {
      homeAbbr: summary.home.abbreviation || summary.home.name || '',
      awayAbbr: summary.away.abbreviation || summary.away.name || '',
      homeScore: summary.home.score ?? 0,
      awayScore: summary.away.score ?? 0,
      state: summary.state || 'pre',
      detail: summary.detail || '',
    };
  } catch { return null; }
}

// ── Batting line helper (MLB only) ─────────────────────────
async function fetchBattingLine(sport, espnGameId, playerName, teamA, teamB, eventStartTime) {
  if (!espnGameId || !playerName || !['mlb', 'kbo', 'npb'].includes(sport)) return null;
  try {
    // Check game is live/post first
    const summary = await getGameSummary(sport, espnGameId);
    if (!summary || summary.state === 'pre') return null;

    const dateStr = parseEventDate(eventStartTime);
    // Use team names from summary if not provided
    const tA = teamA || summary.home?.name || '';
    const tB = teamB || summary.away?.name || '';
    const gamePk = await findMlbGamePk(espnGameId, dateStr, tA, tB);
    if (!gamePk) return null;

    const stats = await getMlbPlayerStats(gamePk, playerName);
    if (!stats || stats.atBats === undefined) return null;

    // Use the MLB API summary field directly if available (e.g. "0-3 | BB, 2 K")
    if (stats.summary) {
      // Clean up: replace " | " with "  " for cleaner display
      return stats.summary.replace(/\s*\|\s*/g, '  ');
    }

    // Fallback: build manually
    const h = stats.hits || 0;
    const ab = stats.atBats || 0;
    let line = `${h}-${ab}`;
    const parts = [];
    if (stats.homeRuns > 0) parts.push(`${stats.homeRuns} HR`);
    if (stats.doubles > 0) parts.push(`${stats.doubles} 2B`);
    if (stats.triples > 0) parts.push(`${stats.triples} 3B`);
    if (stats.baseOnBalls > 0) parts.push(`${stats.baseOnBalls > 1 ? stats.baseOnBalls + ' ' : ''}BB`);
    if (stats.strikeOuts > 0) parts.push(`${stats.strikeOuts > 1 ? stats.strikeOuts + ' ' : ''}K`);
    if (stats.rbi > 0) parts.push(`${stats.rbi} RBI`);
    if (stats.runs > 0) parts.push(`${stats.runs} R`);
    if (stats.stolenBases > 0) parts.push(`${stats.stolenBases} SB`);
    if (parts.length) line += '  ' + parts.join(', ');
    return line;
  } catch { return null; }
}

// ── Live prop stat helper ──────────────────────────────────
async function fetchLivePropStat(sport, espnGameId, playerName, propDescription, eventStartTime) {
  if (!espnGameId || !sport || !playerName || !propDescription) return null;
  try {
    const parsed = parsePropDescription(propDescription, sport);
    if (!parsed) return null;

    const summary = await getGameSummary(sport, espnGameId);
    if (!summary || !summary.state || summary.state === 'pre') return null;

    let statVal = null;

    // Try ESPN box score first
    const playerData = findPlayer(summary.players, playerName);
    if (playerData) {
      const rawStat = playerData.stats?.[parsed.espnKey];
      if (typeof rawStat === 'string' && rawStat.includes('-') && /^\d+-\d+$/.test(rawStat)) {
        statVal = parseFloat(rawStat.split('-')[0]) || 0;
      } else if (rawStat !== undefined) {
        statVal = parseFloat(rawStat) || 0;
      }
      // Try computed stats (e.g. hockey points = G+A, anytime TD)
      if ((statVal === null || statVal === 0) && COMPUTED_STATS[parsed.espnKey] && playerData.stats) {
        const computed = COMPUTED_STATS[parsed.espnKey](playerData.stats);
        if (computed !== null) statVal = computed;
      }
    }

    // For MLB API stats (totalBases, stolenBases, etc.), use MLB Stats API
    if ((statVal === null || statVal === 0) && MLB_API_STATS.has(parsed.espnKey) && ['mlb', 'kbo', 'npb'].includes(sport)) {
      try {
        const dateStr = parseEventDate(eventStartTime);
        const gamePk = await findMlbGamePk(espnGameId, dateStr, summary.home?.name, summary.away?.name);
        if (gamePk) {
          const mlbStats = await getMlbPlayerStats(gamePk, playerName);
          if (mlbStats) {
            statVal = parseFloat(mlbStats[parsed.espnKey]) || 0;
          }
        }
      } catch { /* MLB API unavailable, keep ESPN value */ }
    }

    if (statVal === null) return null;

    // Build a friendly label from the prop description stat portion
    const label = parsed.stat.replace(/\b\w/g, c => c.toUpperCase());

    return {
      label,           // e.g. "Total Bases", "Strikeouts"
      current: statVal, // e.g. 2
      line: parsed.line, // e.g. 1.5
      direction: parsed.direction, // 'over' or 'under'
    };
  } catch { return null; }
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

  // ── Fetch live score data ──
  let singleLiveScore = null;
  let legLiveScores = [];
  let golfData = null;
  let legGolfData = [];
  let matchPlayData = null;

  const isGolf = bet.sport?.startsWith('golf');
  const is2Ball = isGolf && (bet.wager_type === '2ball' || bet.wager_type === '3ball') && bet.match_player_a && bet.match_player_b;

  if (!isParlay && bet.espn_game_id) {
    if (is2Ball) {
      matchPlayData = await getGolf2BallLive({
        playerA: bet.match_player_a, playerA2: bet.match_player_a2,
        playerB: bet.match_player_b, playerB2: bet.match_player_b2,
        playerC: bet.match_player_c, roundNum: bet.golf_round || null
      });
    } else if (isGolf && bet.player_name) {
      golfData = bet._golfData || await getGolfPlayerRound(bet.player_name, bet.golf_round || null);
    } else {
      singleLiveScore = bet._liveScore || await fetchLiveScore(bet.sport, bet.espn_game_id, bet.wager_type);
    }
  } else if (!isParlay && is2Ball) {
    // No espn_game_id yet for 2ball — still try to fetch live data
    matchPlayData = await getGolf2BallLive({
      playerA: bet.match_player_a, playerA2: bet.match_player_a2,
      playerB: bet.match_player_b, playerB2: bet.match_player_b2,
      playerC: bet.match_player_c, roundNum: bet.golf_round || null
    }).catch(() => null);
  }
  if (isParlay && bet.parlay_legs?.length) {
    legLiveScores = await Promise.all(
      bet.parlay_legs.map(leg => {
        if (!leg.espn_game_id) return null;
        if (leg.sport?.startsWith('golf') && leg.player_name) return null; // handled by legGolfData
        return fetchLiveScore(leg.sport, leg.espn_game_id, leg.wager_type);
      })
    );
    legGolfData = await Promise.all(
      bet.parlay_legs.map(leg => {
        if (!leg.espn_game_id || !leg.sport?.startsWith('golf') || !leg.player_name) return null;
        return getGolfPlayerRound(leg.player_name, leg.golf_round || null);
      })
    );
  }

  // ── Fetch live prop stat data ──
  let singlePropStat = null;
  let legPropStats = [];

  if (!isParlay && bet.wager_type === 'prop' && bet.espn_game_id && bet.player_name && bet.prop_description) {
    singlePropStat = bet._propStat || await fetchLivePropStat(bet.sport, bet.espn_game_id, bet.player_name, bet.prop_description, bet.event_start_time);
  }
  if (isParlay && bet.parlay_legs?.length) {
    legPropStats = await Promise.all(
      bet.parlay_legs.map(leg => {
        if (leg.wager_type !== 'prop' || !leg.espn_game_id || !leg.player_name || !leg.prop_description) return null;
        return fetchLivePropStat(leg.sport, leg.espn_game_id, leg.player_name, leg.prop_description, leg.event_start_time || bet.event_start_time);
      })
    );
  }

  // ── Fetch batting line data (MLB only) ──
  let singleBattingLine = null;
  let legBattingLines = [];

  if (!isParlay && bet.espn_game_id && bet.player_name && ['mlb', 'kbo', 'npb'].includes(bet.sport)) {
    singleBattingLine = await fetchBattingLine(bet.sport, bet.espn_game_id, bet.player_name, null, null, bet.event_start_time);
  }
  if (isParlay && bet.parlay_legs?.length) {
    legBattingLines = await Promise.all(
      bet.parlay_legs.map(leg => {
        if (!leg.espn_game_id || !leg.player_name || !['mlb', 'kbo', 'npb'].includes(leg.sport)) return null;
        return fetchBattingLine(leg.sport, leg.espn_game_id, leg.player_name, null, null, leg.event_start_time || bet.event_start_time);
      })
    );
  }

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
  let futuresMarket = null;
  if (bet.bet_category === 'futures' && !isParlay) {
    const parts = bet.pick ? bet.pick.split(': ') : [bet.pick];
    if (parts.length > 1) {
      futuresMarket = parts[0]; // e.g. "Outright Winner"
      pickText = parts.slice(1).join(': ');
    }
  }
  const pickLines = wrapText(tempCtx, pickText || '—', INNER);
  y += pickLines.length * 26;
  y += 4;

  // Matchup / player (singles)
  if (!isParlay) {
    if (futuresMarket) y += 18; // futures market subtitle
    if (bet.team_a && bet.team_b) y += 18;
    if (bet.player_name) y += 18;
    if (bet.event_start_time) y += 18;
    if (bet.espn_game_id) y += 16;
    if (golfData && golfData.roundStatus !== 'pre') y += 52; // golf tracker
    else if (matchPlayData && matchPlayData.overallStatus !== 'pre') y += 80; // 2ball/3ball tracker
    else if (singleLiveScore && singleLiveScore.state !== 'pre') y += 30;
    if (singlePropStat) y += 24; // prop stat progress
    if (singleBattingLine) y += 16; // batting line
  }

  // DK-style deduplicated matchup header for parlays (only for same-game parlays)
  let parlayMatchups = [];
  const parlayMatchupKeys = new Set();
  if (isParlay) {
    for (const leg of bet.parlay_legs) {
      if (leg.team_a && leg.team_b) {
        const key = [leg.team_a, leg.team_b].sort().join('|');
        if (!parlayMatchupKeys.has(key)) {
          parlayMatchupKeys.add(key);
          parlayMatchups.push(`${leg.team_a} vs ${leg.team_b}`);
        }
      }
    }
    // Only show header if it's a same-game parlay (1 unique matchup)
    // For multi-game parlays, show matchup per-leg instead
    if (parlayMatchups.length > 1) {
      parlayMatchups = [];
      parlayMatchupKeys.clear();
    }
    if (parlayMatchups.length > 0) {
      tempCtx.font = '13px ' + FF;
      const matchupText = parlayMatchups.join(' • ');
      const matchupLines = wrapText(tempCtx, matchupText, INNER);
      y += matchupLines.length * 17 + 4;
    }
  }

  // Parlay legs (always expanded)
  if (isParlay) {
    y += 6;
    for (let li = 0; li < bet.parlay_legs.length; li++) {
      const leg = bet.parlay_legs[li];
      y += 6; // gap between legs
      y += 16; // leg header (status + sport)
      tempCtx.font = 'bold 13px ' + FF;
      const legPickLines = wrapText(tempCtx, leg.pick || '—', INNER - 24);
      y += legPickLines.length * 17;
      // Add matchup height per leg (skipped only for same-game parlays where header shows it)
      if (leg.team_a && leg.team_b) {
        const legKey = [leg.team_a, leg.team_b].sort().join('|');
        if (!parlayMatchupKeys.has(legKey)) y += 15;
      }
      if (leg.player_name) y += 15;
      if (leg.event_start_time) y += 15;
      if (leg.espn_game_id) y += 14;
      const legScoreData = legLiveScores[li];
      if (legScoreData && legScoreData.state !== 'pre') y += 20;
      const legGdPre = legGolfData[li];
      if (legGdPre && legGdPre.roundStatus !== 'pre') y += 42; // golf tracker
      if (legPropStats[li]) y += 18; // prop stat progress
      if (legBattingLines[li]) y += 16; // batting line
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
  const singleIsLive = !isParlay && singleLiveScore && singleLiveScore.state === 'in' && status === 'open';
  const golfIsLive = !isParlay && golfData && golfData.roundStatus === 'in' && status === 'open';
  const matchPlayIsLive = !isParlay && matchPlayData && matchPlayData.overallStatus === 'in' && status === 'open';
  const betIsLive = singleIsLive || golfIsLive || matchPlayIsLive;
  const badgeText = betIsLive ? '● LIVE' : statusLabel;
  ctx.font = '800 11px ' + FF;
  const badgeW = ctx.measureText(badgeText).width + 20;
  const badgeH = 22;
  const badgeX = W - PAD - badgeW;
  const badgeY = (HDR_CONTENT - badgeH) / 2;
  roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 4);
  ctx.fillStyle = betIsLive ? 'rgba(255, 50, 50, 0.25)' : sc.bgBadge;
  ctx.fill();
  if (betIsLive) {
    roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 4);
    ctx.strokeStyle = 'rgba(255, 50, 50, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillStyle = betIsLive ? '#FF5555' : sc.text;
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

  // Period pill (non-full_game)
  if (!isParlay && bet.period && bet.period !== 'full_game') {
    const periodLabel = (PERIODS[bet.period] || bet.period).toUpperCase();
    const ppw = drawPill(ctx, tagX, curY, periodLabel, 'rgba(100, 180, 255, 0.15)', '#64B4FF', 10, '700', 7, 3);
    tagX += ppw + 6;
  }

  // Fight details pill
  if (!isParlay && ['ufc', 'boxing'].includes(bet.sport)) {
    const fParts = [];
    if (bet.fight_round) fParts.push(`RD ${bet.fight_round}`);
    if (bet.fight_method) fParts.push((FIGHT_METHODS[bet.fight_method] || bet.fight_method).toUpperCase());
    if (fParts.length) {
      const fpw = drawPill(ctx, tagX, curY, fParts.join(' • '), 'rgba(255, 80, 80, 0.15)', '#FF6B6B', 10, '700', 7, 3);
      tagX += fpw + 6;
    }
  }

  // Golf details pill
  if (!isParlay && bet.sport?.startsWith('golf')) {
    const gParts = [];
    if (bet.golf_round) gParts.push(`R${bet.golf_round}`);
    if (bet.golf_hole) gParts.push(`HOLE ${bet.golf_hole}`);
    if (gParts.length) {
      const gpw = drawPill(ctx, tagX, curY, gParts.join(' • '), 'rgba(80, 200, 80, 0.15)', '#50C850', 10, '700', 7, 3);
      tagX += gpw + 6;
    }
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
    if (futuresMarket) {
      const sportEmojis = {
        nfl: '🏈', cfb: '🏈', ncaa_football: '🏈', cfl: '🏈', xfl: '🏈',
        nba: '🏀', wnba: '🏀', cbb: '🏀', ncaa_mbb: '🏀', ncaa_wbb: '🏀',
        mlb: '⚾', kbo: '⚾', npb: '⚾', cpbl: '⚾',
        nhl: '🏒',
        mls: '⚽', epl: '⚽', la_liga: '⚽', serie_a: '⚽', bundesliga: '⚽',
        ligue_1: '⚽', ucl: '⚽', liga_mx: '⚽', eredivisie: '⚽',
        primeira_liga: '⚽', world_cup: '⚽', europa_league: '⚽',
        mma: '🥊', ufc: '🥊', boxing: '🥊',
        tennis: '🎾', tennis_atp: '🎾', tennis_wta: '🎾', tennis_gs: '🎾',
        golf: '⛳', golf_pga: '⛳', golf_liv: '⛳', golf_dp: '⛳',
        golf_lpga: '⛳', golf_champions: '⛳',
        nascar: '🏎️', f1: '🏎️',
      };
      const emoji = sportEmojis[bet.sport] || '🏆';
      ctx.font = '13px ' + FF;
      ctx.fillStyle = C.textMuted;
      ctx.fillText(`${emoji} ${futuresMarket}`, LEFT_BAR + PAD, curY + 13);
      curY += 18;
    }
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
    // ESPN game ID
    if (bet.espn_game_id) {
      ctx.font = '10px ' + FF;
      ctx.fillStyle = C.textMuted;
      ctx.fillText(`ESPN #${bet.espn_game_id}`, LEFT_BAR + PAD, curY + 11);
      curY += 16;
    }
    // Live score
    if (golfData && golfData.roundStatus !== 'pre') {
      // ── Golf tracker ──
      const gIsLive = golfData.roundStatus === 'in';
      const gIsFinal = golfData.roundStatus === 'post';
      const gcBg = gIsLive ? 'rgba(67, 181, 129, 0.08)' : 'rgba(128, 128, 128, 0.06)';
      roundRect(ctx, LEFT_BAR + PAD - 2, curY + 2, INNER + 4, 46, 6);
      ctx.fillStyle = gcBg;
      ctx.fill();
      // Border
      ctx.strokeStyle = gIsLive ? 'rgba(67, 181, 129, 0.25)' : 'rgba(128, 128, 128, 0.15)';
      ctx.lineWidth = 1;
      roundRect(ctx, LEFT_BAR + PAD - 2, curY + 2, INNER + 4, 46, 6);
      ctx.stroke();

      const gx = LEFT_BAR + PAD + 6;
      // Top line: "⛳ Thru 14  ·  Score: 70 (+1)"  or  "⛳ R3 Final: 73 (+1)"
      ctx.font = 'bold 11px ' + FF;
      ctx.fillStyle = gIsLive ? C.win : C.textSecondary;
      let gTopText;
      if (gIsFinal) {
        gTopText = `⛳ R${golfData.roundNum} Final: ${golfData.roundScore || '—'} (${golfData.roundDisplay || 'E'})`;
      } else {
        gTopText = `⛳ Thru ${golfData.holesCompleted}  ·  Score: ${golfData.roundScore || '—'} (${golfData.roundDisplay || 'E'})`;
      }
      ctx.fillText(gTopText, gx, curY + 16);

      // Right side: overall position + overall score  
      const gPosText = golfData.position ? `T${golfData.position}` : '';
      const gOverall = `${gPosText} (${golfData.overallScore})`.trim();
      ctx.font = '10px ' + FF;
      ctx.fillStyle = C.textMuted;
      const gow = ctx.measureText(gOverall).width;
      ctx.fillText(gOverall, W - PAD - gow - 4, curY + 16);

      // Progress bar: holes completed
      const barX = gx;
      const barY = curY + 26;
      const barW = INNER - 16;
      const barH = 12;
      const pct = golfData.holesCompleted / golfData.totalHoles;

      // BG track
      roundRect(ctx, barX, barY, barW, barH, 4);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.fill();

      // Filled portion
      if (pct > 0) {
        const fillW = Math.max(8, barW * pct);
        roundRect(ctx, barX, barY, fillW, barH, 4);
        ctx.fillStyle = gIsLive ? 'rgba(67, 181, 129, 0.5)' : 'rgba(128, 128, 128, 0.35)';
        ctx.fill();
      }

      // Progress text centered in bar
      const gBarText = gIsFinal ? 'COMPLETE' : `${golfData.holesCompleted} / ${golfData.totalHoles} holes`;
      ctx.font = 'bold 8px ' + FF;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      const gbtW = ctx.measureText(gBarText).width;
      ctx.fillText(gBarText, barX + (barW - gbtW) / 2, barY + 9);

      curY += 52;
    } else if (matchPlayData && matchPlayData.overallStatus !== 'pre') {
      // ── 2-Ball / 3-Ball match play tracker ──
      const mpIsLive = matchPlayData.overallStatus === 'in';
      const mpBg = mpIsLive ? 'rgba(67, 181, 129, 0.08)' : 'rgba(128, 128, 128, 0.06)';
      const mpBorderColor = mpIsLive ? 'rgba(67, 181, 129, 0.25)' : 'rgba(128, 128, 128, 0.15)';
      roundRect(ctx, LEFT_BAR + PAD - 2, curY + 2, INNER + 4, 76, 6);
      ctx.fillStyle = mpBg; ctx.fill();
      ctx.strokeStyle = mpBorderColor; ctx.lineWidth = 1;
      roundRect(ctx, LEFT_BAR + PAD - 2, curY + 2, INNER + 4, 76, 6); ctx.stroke();

      const fmtScore = (s) => { if (s == null) return '-'; const n = parseInt(s); if (isNaN(n)) return '-'; if (n === 0) return 'E'; return n > 0 ? `+${n}` : `${n}`; };
      const mpX = LEFT_BAR + PAD + 6;
      const mp = matchPlayData;

      // Group A row
      ctx.font = '600 11px ' + FF;
      ctx.fillStyle = C.textSecondary;
      ctx.fillText(mp.groupA?.displayName || '—', mpX, curY + 16);
      ctx.font = '700 11px ' + FF;
      ctx.fillStyle = mpIsLive ? '#4ade80' : C.textSecondary;
      const gAScore = fmtScore(mp.groupA?.roundScore) + (mp.groupA?.holesCompleted != null ? ` thru ${mp.groupA.holesCompleted}` : '');
      const gAW = ctx.measureText(gAScore).width;
      ctx.fillText(gAScore, W - PAD - gAW - 4, curY + 16);

      // Match status badge (center)
      if (mp.matchStatus) {
        const badge = mp.matchStatus.label;
        ctx.font = '800 13px ' + FF;
        const isBadgeAhead = mp.matchStatus.ahead;
        ctx.fillStyle = badge === 'AS' ? C.textMuted : (isBadgeAhead ? '#4ade80' : '#f87171');
        const bw = ctx.measureText(badge).width;
        ctx.fillText(badge, LEFT_BAR + PAD + INNER / 2 - bw / 2, curY + 16);
      }

      // Group B row
      ctx.font = '600 11px ' + FF;
      ctx.fillStyle = C.textSecondary;
      ctx.fillText(mp.groupB?.displayName || '—', mpX, curY + 34);
      ctx.font = '700 11px ' + FF;
      ctx.fillStyle = C.textSecondary;
      const gBScore = fmtScore(mp.groupB?.roundScore) + (mp.groupB?.holesCompleted != null ? ` thru ${mp.groupB.holesCompleted}` : '');
      const gBW = ctx.measureText(gBScore).width;
      ctx.fillText(gBScore, W - PAD - gBW - 4, curY + 34);

      // Tournament + round
      ctx.font = '10px ' + FF;
      ctx.fillStyle = C.textMuted;
      const mpTournLabel = `⛳ ${mp.tournamentName || 'Golf'} — R${mp.roundNum || ''}${mpIsLive ? ' LIVE' : (matchPlayData.overallStatus === 'post' ? ' FINAL' : '')}`;
      ctx.fillText(mpTournLabel, mpX, curY + 52);

      // Group C (3-ball)
      if (mp.groupC) {
        ctx.font = '600 10px ' + FF; ctx.fillStyle = C.textMuted;
        const gcLabel = `C: ${mp.groupC.displayName} ${fmtScore(mp.groupC.roundScore)}`;
        ctx.fillText(gcLabel, mpX, curY + 66);
      }

      curY += 80;
    } else if (singleLiveScore && singleLiveScore.state !== 'pre') {
      const isLive = singleLiveScore.state === 'in';
      const scBg = isLive ? 'rgba(67, 181, 129, 0.10)' : 'rgba(128, 128, 128, 0.08)';
      roundRect(ctx, LEFT_BAR + PAD - 2, curY + 2, INNER + 4, 24, 5);
      ctx.fillStyle = scBg;
      ctx.fill();
      const prefix = singleLiveScore.isNrfi ? '1st: ' : '';
      const scoreStr = `${prefix}${singleLiveScore.awayAbbr} ${singleLiveScore.awayScore}  —  ${singleLiveScore.homeAbbr} ${singleLiveScore.homeScore}`;
      ctx.font = 'bold 12px ' + FF;
      ctx.fillStyle = isLive ? C.win : C.textSecondary;
      ctx.fillText(scoreStr, LEFT_BAR + PAD + 6, curY + 18);
      if (singleLiveScore.detail) {
        ctx.font = '10px ' + FF;
        ctx.fillStyle = isLive ? C.win : C.textMuted;
        const dw = ctx.measureText(singleLiveScore.detail).width;
        ctx.fillText(singleLiveScore.detail, W - PAD - dw - 4, curY + 17);
      }
      curY += 30;
    }
    // Prop stat progress (single bet)
    if (singlePropStat) {
      const pIsLive = singleLiveScore && singleLiveScore.state === 'in';
      const pBg = pIsLive ? 'rgba(255, 135, 50, 0.08)' : 'rgba(128, 128, 128, 0.06)';
      roundRect(ctx, LEFT_BAR + PAD - 2, curY + 2, INNER + 4, 18, 4);
      ctx.fillStyle = pBg;
      ctx.fill();
      // "📊 Total Bases: 2 / Over 1.5"
      const dirLabel = singlePropStat.direction === 'over' ? 'O' : 'U';
      const propText = `📊 ${singlePropStat.label}: ${singlePropStat.current}  ·  ${dirLabel} ${singlePropStat.line}`;
      ctx.font = 'bold 11px ' + FF;
      const hitting = (singlePropStat.direction === 'over' && singlePropStat.current > singlePropStat.line) ||
                      (singlePropStat.direction === 'under' && singlePropStat.current < singlePropStat.line);
      ctx.fillStyle = hitting ? C.win : C.accent;
      ctx.fillText(propText, LEFT_BAR + PAD + 6, curY + 15);
      curY += 24;
    }
    // Batting line (single bet, MLB only)
    if (singleBattingLine) {
      ctx.font = '600 10px ' + FF;
      ctx.fillStyle = '#8BA3C7';
      ctx.fillText(`🏏 ${singleBattingLine}`, LEFT_BAR + PAD + 6, curY + 12);
      curY += 16;
    }
  }

  // ── DK-style matchup header for parlays ──
  if (isParlay && parlayMatchups.length > 0) {
    ctx.font = '13px ' + FF;
    ctx.fillStyle = C.textMuted;
    const matchupText = parlayMatchups.join(' • ');
    const matchupLines = wrapText(ctx, matchupText, INNER);
    for (const ml of matchupLines) {
      ctx.fillText(ml, LEFT_BAR + PAD, curY + 13);
      curY += 17;
    }
    curY += 4;
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

      // Leg header: status indicator + sport
      const legSport = (SPORT_NAMES[leg.sport] || leg.sport || '').toUpperCase();
      const legLsData = legLiveScores[i];
      const legGd = legGolfData[i];
      const legIsLive = leg.status === 'open' && (
        (legLsData && legLsData.state === 'in') ||
        (legGd && legGd.roundStatus === 'in')
      );

      // Draw status indicator
      if (legIsLive) {
        // 🔴 LIVE badge instead of yellow dot
        const badgeX = legX;
        const badgeY = curY + 2;
        const badgeW = 38;
        const badgeH = 14;
        roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 3);
        ctx.fillStyle = 'rgba(255, 50, 50, 0.25)';
        ctx.fill();
        roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 3);
        ctx.strokeStyle = 'rgba(255, 50, 50, 0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();
        // Red dot
        ctx.beginPath();
        ctx.arc(badgeX + 8, badgeY + badgeH / 2, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#FF3232';
        ctx.fill();
        // LIVE text
        ctx.font = 'bold 8px ' + FF;
        ctx.fillStyle = '#FF5555';
        ctx.fillText('LIVE', badgeX + 14, badgeY + 10);
      } else {
        const legStatusMap = { open: '🟡', win: '✅', loss: '❌', push: '🔄', void: '⛔' };
        const legEmoji = legStatusMap[leg.status] || '🟡';
        ctx.font = '13px ' + FF;
        ctx.fillStyle = C.textPrimary;
        ctx.fillText(legEmoji, legX, curY + 13);
      }
      ctx.font = '600 10px ' + FF;
      ctx.fillStyle = C.textMuted;
      let legTagX = legIsLive ? legX + 44 : legX + 22;
      ctx.fillText(legSport, legTagX, curY + 12);
      legTagX += ctx.measureText(legSport).width + 6;

      // Period tag on leg
      if (leg.period && leg.period !== 'full_game') {
        const lPeriodLabel = (PERIODS[leg.period] || leg.period).toUpperCase();
        ctx.fillStyle = '#64B4FF';
        ctx.fillText(lPeriodLabel, legTagX, curY + 12);
        legTagX += ctx.measureText(lPeriodLabel).width + 6;
      }

      // Fight tag on leg
      if (['ufc', 'boxing'].includes(leg.sport)) {
        const lfParts = [];
        if (leg.fight_round) lfParts.push(`RD ${leg.fight_round}`);
        if (leg.fight_method) lfParts.push((FIGHT_METHODS[leg.fight_method] || leg.fight_method).toUpperCase());
        if (lfParts.length) {
          ctx.fillStyle = '#FF6B6B';
          const lfText = lfParts.join(' • ');
          ctx.fillText(lfText, legTagX, curY + 12);
          legTagX += ctx.measureText(lfText).width + 6;
        }
      }

      // Golf tag on leg
      if (leg.sport?.startsWith('golf')) {
        const lgParts = [];
        if (leg.golf_round) lgParts.push(`R${leg.golf_round}`);
        if (leg.golf_hole) lgParts.push(`HOLE ${leg.golf_hole}`);
        if (lgParts.length) {
          ctx.fillStyle = '#50C850';
          const lgText = lgParts.join(' • ');
          ctx.fillText(lgText, legTagX, curY + 12);
        }
      }
      curY += 16;

      // Leg pick
      ctx.font = 'bold 13px ' + FF;
      ctx.fillStyle = C.textPrimary;
      const legPickLines = wrapText(ctx, leg.pick || '—', legInner);
      for (const lp of legPickLines) {
        ctx.fillText(lp, legX, curY + 13);
        curY += 17;
      }

      // Matchup (skip only for same-game parlays where header already shows it)
      if (leg.team_a && leg.team_b) {
        const legKey = [leg.team_a, leg.team_b].sort().join('|');
        if (!parlayMatchupKeys.has(legKey)) {
          ctx.font = '11px ' + FF;
          ctx.fillStyle = C.textMuted;
          ctx.fillText(`${leg.team_a} vs ${leg.team_b}`, legX, curY + 12);
          curY += 15;
        }
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

      // ESPN game ID
      if (leg.espn_game_id) {
        ctx.font = '9px ' + FF;
        ctx.fillStyle = C.textMuted;
        ctx.fillText(`ESPN #${leg.espn_game_id}`, legX, curY + 10);
        curY += 14;
      }
      // Leg live score
      const legLs = legLiveScores[i];
      if (legLs && legLs.state !== 'pre') {
        const isLegLive = legLs.state === 'in';
        const prefix = legLs.isNrfi ? '1st: ' : '';
        const legScoreStr = `${prefix}${legLs.awayAbbr} ${legLs.awayScore} — ${legLs.homeAbbr} ${legLs.homeScore}  ${legLs.detail || ''}`;
        ctx.font = 'bold 10px ' + FF;
        ctx.fillStyle = isLegLive ? C.win : C.textMuted;
        ctx.fillText(legScoreStr, legX, curY + 12);
        curY += 20;
      }
      // Leg golf tracker
      if (legGd && legGd.roundStatus !== 'pre') {
        const gLive = legGd.roundStatus === 'in';
        const gFinal = legGd.roundStatus === 'post';
        const gBg = gLive ? 'rgba(67, 181, 129, 0.08)' : 'rgba(128, 128, 128, 0.06)';
        roundRect(ctx, legX - 2, curY + 2, legInner + 4, 36, 5);
        ctx.fillStyle = gBg;
        ctx.fill();
        ctx.strokeStyle = gLive ? 'rgba(67, 181, 129, 0.25)' : 'rgba(128, 128, 128, 0.15)';
        ctx.lineWidth = 1;
        roundRect(ctx, legX - 2, curY + 2, legInner + 4, 36, 5);
        ctx.stroke();
        const gx = legX + 4;
        ctx.font = 'bold 10px ' + FF;
        ctx.fillStyle = gLive ? C.win : C.textSecondary;
        let gText;
        if (gFinal) {
          gText = `⛳ R${legGd.roundNum} Final: ${legGd.roundScore || '—'} (${legGd.roundDisplay || 'E'})`;
        } else {
          gText = `⛳ Thru ${legGd.holesCompleted}  ·  Score: ${legGd.roundScore || '—'} (${legGd.roundDisplay || 'E'})`;
        }
        ctx.fillText(gText, gx, curY + 14);
        // Mini progress bar
        const bx = gx;
        const by = curY + 20;
        const bw = legInner - 12;
        const bh = 10;
        const pct = legGd.holesCompleted / (legGd.totalHoles || 18);
        roundRect(ctx, bx, by, bw, bh, 3);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.fill();
        if (pct > 0) {
          roundRect(ctx, bx, by, Math.max(6, bw * pct), bh, 3);
          ctx.fillStyle = gLive ? 'rgba(67, 181, 129, 0.5)' : 'rgba(128, 128, 128, 0.35)';
          ctx.fill();
        }
        const bText = gFinal ? 'COMPLETE' : `${legGd.holesCompleted} / ${legGd.totalHoles || 18} holes`;
        ctx.font = 'bold 7px ' + FF;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        const btw = ctx.measureText(bText).width;
        ctx.fillText(bText, bx + (bw - btw) / 2, by + 7);
        curY += 42;
      }
      // Leg prop stat progress
      const legPs = legPropStats[i];
      if (legPs) {
        const dirLabel = legPs.direction === 'over' ? 'O' : 'U';
        const lpText = `📊 ${legPs.label}: ${legPs.current} · ${dirLabel} ${legPs.line}`;
        ctx.font = 'bold 9px ' + FF;
        const legHitting = (legPs.direction === 'over' && legPs.current > legPs.line) ||
                           (legPs.direction === 'under' && legPs.current < legPs.line);
        ctx.fillStyle = legHitting ? C.win : C.accent;
        ctx.fillText(lpText, legX, curY + 12);
        curY += 18;
      }

      // Leg batting line (MLB only)
      const legBl = legBattingLines[i];
      if (legBl) {
        ctx.font = '600 9px ' + FF;
        ctx.fillStyle = '#8BA3C7';
        ctx.fillText(`🏏 ${legBl}`, legX, curY + 11);
        curY += 16;
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

  // ── Stats row: ODDS | WAGER | TO WIN (or CASHED OUT) ──
  const statsY = curY;
  const colW = (W - LEFT_BAR - PAD * 2) / 3;

  // Labels
  ctx.font = '700 10px ' + FF;
  const isCashout = bet.status === 'cashout' && bet.cash_out_amount != null;
  const labels = ['ODDS', 'WAGER', isCashout ? 'CASHED OUT' : 'TO WIN'];
  const oddsStr = bet.odds_american ? `${formatOdds(bet.odds_american)} (${bet.odds_decimal})` : '—';
  const unitsStr = `${fmtU(bet.units)}u`;
  let toWinStr = '—';
  if (isCashout) {
    const net = parseFloat(bet.cash_out_amount) - parseFloat(bet.units);
    toWinStr = net >= 0 ? `+${fmtU(net)}u` : `${fmtU(net)}u`;
  } else if (bet.odds_american) {
    toWinStr = `+${calculatePayout(bet.odds_american, bet.units)}u`;
  }
  const values = [oddsStr, unitsStr, toWinStr];
  const valueColors = [C.textPrimary, C.textPrimary, isCashout ? '#5865f2' : C.payout];

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
    ? new Date(bet.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
      + ' ' + new Date(bet.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
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
