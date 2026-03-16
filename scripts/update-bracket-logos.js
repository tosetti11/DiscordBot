/**
 * Update bracket teams with ESPN logo URLs
 * ESPN CDN pattern: https://a.espncdn.com/i/teamlogos/ncaa/500/{espn_id}.png
 * Run: node -e "require('dotenv').config(); require('./scripts/update-bracket-logos.js')"
 */
const { supabase } = require('../src/config/supabase');

// ESPN team ID mapping for 2026 NCAA tournament teams
const ESPN_IDS = {
  // East
  'East-1':  { id: '150',    name: 'Duke' },
  'East-2':  { id: '41',     name: 'UConn' },
  'East-3':  { id: '127',    name: 'Michigan State' },
  'East-4':  { id: '2305',   name: 'Kansas' },
  'East-5':  { id: '2599',   name: "St. John's" },
  'East-6':  { id: '97',     name: 'Louisville' },
  'East-7':  { id: '26',     name: 'UCLA' },
  'East-8':  { id: '194',    name: 'Ohio State' },
  'East-9':  { id: '2628',   name: 'TCU' },
  'East-10': { id: '2116',   name: 'UCF' },
  'East-11': { id: '58',     name: 'South Florida' },
  'East-12': { id: '2460',   name: 'Northern Iowa' },
  'East-13': { id: '2856',   name: 'California Baptist' },
  'East-14': { id: '2449',   name: 'North Dakota State' },
  'East-15': { id: '231',    name: 'Furman' },
  'East-16': { id: '2561',   name: 'Siena' },

  // West
  'West-1':  { id: '12',     name: 'Arizona' },
  'West-2':  { id: '2509',   name: 'Purdue' },
  'West-3':  { id: '2250',   name: 'Gonzaga' },
  'West-4':  { id: '8',      name: 'Arkansas' },
  'West-5':  { id: '275',    name: 'Wisconsin' },
  'West-6':  { id: '252',    name: 'BYU' },
  'West-7':  { id: '2390',   name: 'Miami' },
  'West-8':  { id: '222',    name: 'Villanova' },
  'West-9':  { id: '328',    name: 'Utah State' },
  'West-10': { id: '142',    name: 'Missouri' },
  'West-11': { id: '152',    name: 'NC State' },
  'West-12': { id: '2272',   name: 'High Point' },
  'West-13': { id: '62',     name: "Hawai'i" },
  'West-14': { id: '338',    name: 'Kennesaw State' },
  'West-15': { id: '2511',   name: 'Queens University' },
  'West-16': { id: '112358', name: 'Long Island' },

  // South
  'South-1':  { id: '57',    name: 'Florida' },
  'South-2':  { id: '248',   name: 'Houston' },
  'South-3':  { id: '356',   name: 'Illinois' },
  'South-4':  { id: '158',   name: 'Nebraska' },
  'South-5':  { id: '238',   name: 'Vanderbilt' },
  'South-6':  { id: '153',   name: 'North Carolina' },
  'South-7':  { id: '2608',  name: "Saint Mary's" },
  'South-8':  { id: '228',   name: 'Clemson' },
  'South-9':  { id: '2294',  name: 'Iowa' },
  'South-10': { id: '245',   name: 'Texas A&M' },
  'South-11': { id: '2670',  name: 'VCU' },
  'South-12': { id: '2377',  name: 'McNeese' },
  'South-13': { id: '2653',  name: 'Troy' },
  'South-14': { id: '219',   name: 'Pennsylvania' },
  'South-15': { id: '70',    name: 'Idaho' },
  'South-16': { id: '2329',  name: 'Lehigh' },

  // Midwest
  'Midwest-1':  { id: '130',  name: 'Michigan' },
  'Midwest-2':  { id: '66',   name: 'Iowa State' },
  'Midwest-3':  { id: '258',  name: 'Virginia' },
  'Midwest-4':  { id: '333',  name: 'Alabama' },
  'Midwest-5':  { id: '2641', name: 'Texas Tech' },
  'Midwest-6':  { id: '2633', name: 'Tennessee' },
  'Midwest-7':  { id: '96',   name: 'Kentucky' },
  'Midwest-8':  { id: '61',   name: 'Georgia' },
  'Midwest-9':  { id: '139',  name: 'Saint Louis' },
  'Midwest-10': { id: '2541', name: 'Santa Clara' },
  'Midwest-11': { id: '2567', name: 'SMU' },
  'Midwest-12': { id: '2006', name: 'Akron' },
  'Midwest-13': { id: '2275', name: 'Hofstra' },
  'Midwest-14': { id: '2750', name: 'Wright State' },
  'Midwest-15': { id: '2634', name: 'Tennessee State' },
  'Midwest-16': { id: '47',   name: 'Howard' },
};

async function updateLogos() {
  // Get all teams
  const { data: teams, error } = await supabase
    .from('bracket_teams')
    .select('id, region, seed, team_name');
  
  if (error) { console.error('Fetch error:', error); process.exit(1); }
  console.log(`Found ${teams.length} teams`);

  let updated = 0;
  for (const team of teams) {
    const key = `${team.region}-${team.seed}`;
    const espn = ESPN_IDS[key];
    if (!espn) { console.log(`No ESPN ID for ${key} (${team.team_name})`); continue; }
    
    const logo_url = `https://a.espncdn.com/i/teamlogos/ncaa/500/${espn.id}.png`;
    const { error: ue } = await supabase
      .from('bracket_teams')
      .update({ logo_url, espn_team_id: espn.id })
      .eq('id', team.id);
    
    if (ue) console.error(`Error updating ${team.team_name}:`, ue);
    else updated++;
  }
  console.log(`Updated ${updated} teams with logos`);
  process.exit(0);
}

updateLogos();
