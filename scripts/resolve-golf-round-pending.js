#!/usr/bin/env node
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

function normalizeName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z ]/g, '').trim();
}

function parseRoundProp(desc) {
  const m = String(desc || '').match(/round\s+(\d+)\s+score\s+(over|under)\s+([0-9]+(?:\.[0-9]+)?)/i);
  if (!m) return null;
  return {
    round: parseInt(m[1], 10),
    side: m[2].toLowerCase(),
    line: parseFloat(m[3]),
  };
}

function parseDateToEspn(dateStr) {
  return String(dateStr || '').replace(/-/g, '');
}

async function fetchScoreboardByDate(dateStr) {
  const ymd = parseDateToEspn(dateStr);
  const url = `https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates=${ymd}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN scoreboard ${res.status}`);
  return res.json();
}

function findEvent(events, tournamentName) {
  if (!events?.length) return null;
  const want = normalizeName(tournamentName);
  return events.find(e => normalizeName(e.name).includes(want) || want.includes(normalizeName(e.name))) || events[0];
}

function buildPlayerRoundMap(event, roundNum) {
  const map = new Map();
  const competitors = event?.competitions?.[0]?.competitors || [];
  for (const c of competitors) {
    const name = c?.athlete?.displayName || c?.athlete?.fullName;
    if (!name) continue;
    const rounds = c.linescores || [];
    const r = rounds[roundNum - 1];
    if (!r) continue;
    const score = Number(r.value);
    if (!Number.isFinite(score)) continue;
    map.set(normalizeName(name), score);
  }
  return map;
}

function resolveStatus(actual, side, line) {
  if (side === 'over') {
    if (actual > line) return 'win';
    if (actual < line) return 'loss';
    return 'push';
  }
  if (actual < line) return 'win';
  if (actual > line) return 'loss';
  return 'push';
}

async function main() {
  const tournament = getArg('--tournament');
  const date = getArg('--date');
  const round = parseInt(getArg('--round') || '0', 10);

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_URL or SUPABASE_SERVICE_KEY missing in environment');
  }
  if (!tournament || !date || !round) {
    throw new Error('Usage: node scripts/resolve-golf-round-pending.js --tournament "Rbc heritage" --date 2026-04-19 --round 4');
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const { data: pending, error } = await supabase
    .from('ai_picks')
    .select('id, player_name, prop_description, pick, pick_date, round_number, tournament_name')
    .eq('pick_type', 'golf_round')
    .eq('status', 'pending')
    .ilike('tournament_name', `%${tournament}%`)
    .eq('round_number', round)
    .eq('pick_date', date)
    .order('created_at', { ascending: true });

  if (error) throw error;

  if (!pending?.length) {
    console.log('No pending matching picks found.');
    return;
  }

  const scoreboard = await fetchScoreboardByDate(date);
  const event = findEvent(scoreboard.events || [], tournament);
  if (!event) throw new Error('No golf event found on that date');

  const playerRoundMap = buildPlayerRoundMap(event, round);
  if (playerRoundMap.size === 0) {
    throw new Error('No player round scores found for that event/round');
  }

  let resolved = 0;
  let skipped = 0;
  let wins = 0;
  let losses = 0;
  let pushes = 0;

  for (const p of pending) {
    const prop = parseRoundProp(p.prop_description);
    if (!prop) {
      skipped++;
      continue;
    }

    const key = normalizeName(p.player_name);
    const actual = playerRoundMap.get(key);
    if (!Number.isFinite(actual)) {
      skipped++;
      continue;
    }

    const status = resolveStatus(actual, prop.side, prop.line);
    const resultNote = `Auto-resolved: ${p.player_name} R${round} score ${actual} (${prop.side.toUpperCase()} ${prop.line})`;

    const { error: upErr } = await supabase
      .from('ai_picks')
      .update({
        status,
        result_note: resultNote,
        final_score: `${p.player_name} R${round}: ${actual}`,
        closed_at: new Date().toISOString(),
      })
      .eq('id', p.id)
      .eq('status', 'pending');

    if (upErr) throw upErr;

    resolved++;
    if (status === 'win') wins++;
    else if (status === 'loss') losses++;
    else pushes++;
  }

  console.log(`Resolved ${resolved}/${pending.length} picks for ${event.name} (R${round}) on ${date}`);
  console.log(`Results: ${wins}W ${losses}L ${pushes}P | Skipped: ${skipped}`);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
