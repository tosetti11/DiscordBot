require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

(async () => {
  const { data: all, error } = await sb.from('prop_picks').select('*');
  if (error) { console.error('Error:', error.message); return; }

  const resolved = all.filter(p => p.hit !== null && !p.dnp);
  const hits = resolved.filter(p => p.hit === true);
  const dnpPicks = all.filter(p => p.dnp === true);
  const unresolved = all.filter(p => p.hit === null && !p.dnp);

  console.log('=== OVERALL ===');
  console.log('Total picks:', all.length, '| Resolved:', resolved.length, '| DNPs:', dnpPicks.length, '| Unresolved:', unresolved.length);
  console.log('Hits:', hits.length, '| Misses:', resolved.length - hits.length);
  console.log('Hit Rate:', resolved.length ? (hits.length / resolved.length * 100).toFixed(1) + '%' : 'N/A');

  const overs = resolved.filter(p => p.direction === 'over');
  const unders = resolved.filter(p => p.direction === 'under');
  console.log('\n=== OVER vs UNDER ===');
  console.log('OVER:', overs.filter(p => p.hit).length + '/' + overs.length, overs.length ? '(' + (overs.filter(p => p.hit).length / overs.length * 100).toFixed(1) + '%)' : '');
  console.log('UNDER:', unders.filter(p => p.hit).length + '/' + unders.length, unders.length ? '(' + (unders.filter(p => p.hit).length / unders.length * 100).toFixed(1) + '%)' : '');

  console.log('\n=== BY CONFIDENCE ===');
  for (const c of ['high', 'medium', 'low']) {
    const cp = resolved.filter(p => p.confidence === c);
    if (cp.length) console.log(c + ':', cp.filter(p => p.hit).length + '/' + cp.length, '(' + (cp.filter(p => p.hit).length / cp.length * 100).toFixed(1) + '%)');
  }

  console.log('\n=== BY STAT ===');
  for (const s of ['pts', 'reb', 'ast', 'fg3']) {
    const sp = resolved.filter(p => p.stat_key === s);
    if (sp.length) console.log(s + ':', sp.filter(p => p.hit).length + '/' + sp.length, '(' + (sp.filter(p => p.hit).length / sp.length * 100).toFixed(1) + '%)');
  }

  console.log('\n=== BY PROBABILITY ===');
  for (const [lo, hi, label] of [[50, 55, '50-55%'], [55, 60, '55-60%'], [60, 65, '60-65%'], [65, 70, '65-70%'], [70, 101, '70+%']]) {
    const bp = resolved.filter(p => p.probability >= lo && p.probability < hi);
    if (bp.length) console.log(label + ':', bp.filter(p => p.hit).length + '/' + bp.length, '(' + (bp.filter(p => p.hit).length / bp.length * 100).toFixed(1) + '%)', '[avg pred:', (bp.reduce((s, p) => s + p.probability, 0) / bp.length).toFixed(1) + '%]');
  }

  console.log('\n=== DAILY BREAKDOWN ===');
  const days = {};
  resolved.forEach(p => {
    if (!days[p.generated_date]) days[p.generated_date] = { h: 0, t: 0 };
    days[p.generated_date].t++;
    if (p.hit) days[p.generated_date].h++;
  });
  Object.keys(days).sort().forEach(d => {
    const r = days[d];
    console.log(d + ':', r.h + '/' + r.t, '(' + (r.h / r.t * 100).toFixed(0) + '%)');
  });

  console.log('\n=== CALIBRATION (predicted vs actual) ===');
  for (const [lo, hi, label] of [[50, 55, '50-55%'], [55, 60, '55-60%'], [60, 65, '60-65%'], [65, 70, '65-70%'], [70, 101, '70+%']]) {
    const bp = resolved.filter(p => p.probability >= lo && p.probability < hi);
    if (bp.length) {
      const avgPred = (bp.reduce((s, p) => s + p.probability, 0) / bp.length).toFixed(1);
      const actualRate = (bp.filter(p => p.hit).length / bp.length * 100).toFixed(1);
      console.log(label + ': predicted=' + avgPred + '% actual=' + actualRate + '% (n=' + bp.length + ') gap=' + (actualRate - avgPred).toFixed(1));
    }
  }

  console.log('\n=== BY VOLATILITY ===');
  for (const [lo, hi, label] of [[0, 0.15, 'Very Stable'], [0.15, 0.30, 'Stable'], [0.30, 0.50, 'Moderate'], [0.50, 2.0, 'High Vol']]) {
    const vp = resolved.filter(p => p.volatility !== null && parseFloat(p.volatility) >= lo && parseFloat(p.volatility) < hi);
    if (vp.length) console.log(label + ':', vp.filter(p => p.hit).length + '/' + vp.length, '(' + (vp.filter(p => p.hit).length / vp.length * 100).toFixed(1) + '%)');
  }

  let roi = 0;
  resolved.forEach(p => roi += p.hit ? 0.909 : -1);
  console.log('\n=== ROI (flat -110) ===');
  console.log('Units:', roi.toFixed(2), '| ROI:', resolved.length ? (roi / resolved.length * 100).toFixed(2) + '%' : 'N/A');

  console.log('\n=== MISS MARGIN ANALYSIS ===');
  const misses = resolved.filter(p => !p.hit && p.actual_value !== null);
  const margins = misses.map(p => {
    const diff = p.direction === 'over'
      ? parseFloat(p.prop_line) - parseFloat(p.actual_value)
      : parseFloat(p.actual_value) - parseFloat(p.prop_line);
    return { player: p.player_name, stat: p.stat_key, line: parseFloat(p.prop_line), actual: parseFloat(p.actual_value), dir: p.direction, margin: diff, prob: p.probability };
  }).sort((a, b) => a.margin - b.margin);

  const close = margins.filter(m => m.margin <= 2);
  console.log('Close misses (within 2):', close.length + '/' + misses.length);
  close.forEach(m => console.log('  ' + m.player + ' ' + m.stat + ' ' + m.dir + ' ' + m.line + ' -> actual ' + m.actual + ' (by ' + m.margin.toFixed(1) + ') prob=' + m.prob + '%'));

  console.log('\nBig misses (>5):');
  margins.filter(m => m.margin > 5).forEach(m => console.log('  ' + m.player + ' ' + m.stat + ' ' + m.dir + ' ' + m.line + ' -> actual ' + m.actual + ' (by ' + m.margin.toFixed(1) + ') prob=' + m.prob + '%'));

  console.log('\n=== LINE SOURCE ===');
  const gen = resolved.filter(p => !p.line_source || p.line_source === 'generated');
  const real = resolved.filter(p => p.line_source && p.line_source !== 'generated');
  console.log('Generated lines:', gen.filter(p => p.hit).length + '/' + gen.length, gen.length ? '(' + (gen.filter(p => p.hit).length / gen.length * 100).toFixed(1) + '%)' : '');
  console.log('Real sportsbook lines:', real.filter(p => p.hit).length + '/' + real.length, real.length ? '(' + (real.filter(p => p.hit).length / real.length * 100).toFixed(1) + '%)' : '');

  // Over/Under by stat
  console.log('\n=== DIRECTION BY STAT ===');
  for (const s of ['pts', 'reb', 'ast', 'fg3']) {
    const sOver = resolved.filter(p => p.stat_key === s && p.direction === 'over');
    const sUnder = resolved.filter(p => p.stat_key === s && p.direction === 'under');
    if (sOver.length) console.log(s + ' OVER:', sOver.filter(p => p.hit).length + '/' + sOver.length, '(' + (sOver.filter(p => p.hit).length / sOver.length * 100).toFixed(1) + '%)');
    if (sUnder.length) console.log(s + ' UNDER:', sUnder.filter(p => p.hit).length + '/' + sUnder.length, '(' + (sUnder.filter(p => p.hit).length / sUnder.length * 100).toFixed(1) + '%)');
  }

  // Rank distribution
  console.log('\n=== BY RANK (1=best pick) ===');
  for (let r = 1; r <= 5; r++) {
    const rp = resolved.filter(p => p.rank === r);
    if (rp.length) console.log('Rank ' + r + ':', rp.filter(p => p.hit).length + '/' + rp.length, '(' + (rp.filter(p => p.hit).length / rp.length * 100).toFixed(1) + '%)');
  }

  process.exit(0);
})();
