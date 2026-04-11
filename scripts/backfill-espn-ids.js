/**
 * Backfill ESPN game IDs for all open bets and parlay legs.
 * Run once after deploying the live tracker feature.
 *
 * Usage: node scripts/backfill-espn-ids.js
 */
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const espn = require('../src/services/espn');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function backfill() {
  console.log('=== Backfilling ESPN Game IDs for Open Bets ===\n');

  // ── 1. Single bets (non-parlay) without ESPN game ID ──
  const { data: singles, error: sErr } = await supabase
    .from('bets')
    .select('id, sport, team_a, team_b, event_start_time, bet_category, wager_type')
    .eq('status', 'open')
    .eq('bet_type', 'single')
    .is('espn_game_id', null);

  if (sErr) { console.error('Error fetching singles:', sErr); return; }
  console.log(`Found ${singles.length} open single bets without ESPN game IDs`);

  let singleUpdated = 0;
  for (const bet of singles) {
    if (bet.bet_category === 'futures' || !bet.sport) {
      console.log(`  [skip] Bet ${bet.id} — ${bet.bet_category || 'no sport'}`);
      continue;
    }
    try {
      const resolved = await espn.resolveGameId(
        bet.sport, bet.team_a, bet.team_b, bet.event_start_time
      );
      if (resolved) {
        const { error: uErr } = await supabase
          .from('bets')
          .update({ espn_game_id: resolved.gameId })
          .eq('id', bet.id);
        if (uErr) {
          console.error(`  [error] Bet ${bet.id}:`, uErr.message);
        } else {
          console.log(`  [ok] Bet ${bet.id} → ${resolved.gameId} (${bet.team_a} vs ${bet.team_b})`);
          singleUpdated++;
        }
      } else {
        console.log(`  [miss] Bet ${bet.id} — no ESPN match for ${bet.team_a} vs ${bet.team_b} (${bet.sport})`);
      }
    } catch (e) {
      console.error(`  [error] Bet ${bet.id}:`, e.message);
    }
  }
  console.log(`\nSingle bets updated: ${singleUpdated}/${singles.length}\n`);

  // ── 2. Parlay bets — also set espn_game_id on the parent if single-game parlay ──
  const { data: parlayLegs, error: plErr } = await supabase
    .from('parlay_legs')
    .select('id, bet_id, sport, team_a, team_b, event_start_time, bet_category')
    .is('espn_game_id', null)
    .in('status', ['open', 'pending']);

  if (plErr) { console.error('Error fetching parlay legs:', plErr); return; }
  console.log(`Found ${parlayLegs.length} parlay legs without ESPN game IDs`);

  let legUpdated = 0;
  for (const leg of parlayLegs) {
    if (leg.bet_category === 'futures' || !leg.sport) {
      console.log(`  [skip] Leg ${leg.id} — ${leg.bet_category || 'no sport'}`);
      continue;
    }
    try {
      const resolved = await espn.resolveGameId(
        leg.sport, leg.team_a, leg.team_b, leg.event_start_time
      );
      if (resolved) {
        const { error: uErr } = await supabase
          .from('parlay_legs')
          .update({ espn_game_id: resolved.gameId })
          .eq('id', leg.id);
        if (uErr) {
          console.error(`  [error] Leg ${leg.id}:`, uErr.message);
        } else {
          console.log(`  [ok] Leg ${leg.id} (bet ${leg.bet_id}) → ${resolved.gameId} (${leg.team_a} vs ${leg.team_b})`);
          legUpdated++;
        }
      } else {
        console.log(`  [miss] Leg ${leg.id} — no ESPN match for ${leg.team_a} vs ${leg.team_b} (${leg.sport})`);
      }
    } catch (e) {
      console.error(`  [error] Leg ${leg.id}:`, e.message);
    }
  }
  console.log(`\nParlay legs updated: ${legUpdated}/${parlayLegs.length}\n`);

  console.log('=== Backfill complete ===');
}

backfill().catch(console.error);
