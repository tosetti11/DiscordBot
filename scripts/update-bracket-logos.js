/**
 * Update bracket teams with ESPN logo URLs
 * ESPN CDN pattern: https://a.espncdn.com/i/teamlogos/ncaa/500/{espn_id}.png
 * Run: node -e "require('dotenv').config(); require('./scripts/update-bracket-logos.js')"
 */
const { supabase } = require('../src/config/supabase');

// ESPN team ID mapping for 2025 NCAA tournament teams
const ESPN_IDS = {
  // East
  'East-1':  { id: '150',  name: 'Duke' },
  'East-2':  { id: '333',  name: 'Alabama' },
  'East-3':  { id: '275',  name: 'Wisconsin' },
  'East-4':  { id: '12',   name: 'Arizona' },
  'East-5':  { id: '2483', name: 'Oregon' },
  'East-6':  { id: '252',  name: 'BYU' },
  'East-7':  { id: '2599', name: "St. John's" },
  'East-8':  { id: '41',   name: 'UConn' },
  'East-9':  { id: '201',  name: 'Oklahoma' },
  'East-10': { id: '8',    name: 'Arkansas' },
  'East-11': { id: '2181', name: 'Drake' },
  'East-12': { id: '2335', name: 'Liberty' },
  'East-13': { id: '43',   name: 'Yale' },
  'East-14': { id: '288',  name: 'Lipscomb' },
  'East-15': { id: '149',  name: 'Montana' },
  'East-16': { id: '44',   name: 'American' },

  // West
  'West-1':  { id: '57',   name: 'Florida' },
  'West-2':  { id: '127',  name: 'Michigan State' },
  'West-3':  { id: '2641', name: 'Texas Tech' },
  'West-4':  { id: '120',  name: 'Maryland' },
  'West-5':  { id: '235',  name: 'Memphis' },
  'West-6':  { id: '142',  name: 'Missouri' },
  'West-7':  { id: '2305', name: 'Kansas' },
  'West-8':  { id: '41',   name: 'UConn' },
  'West-9':  { id: '156',  name: 'Creighton' },
  'West-10': { id: '167',  name: 'New Mexico' },
  'West-11': { id: '36',   name: 'Colorado State' },
  'West-12': { id: '2377', name: 'McNeese' },
  'West-13': { id: '2253', name: 'Grand Canyon' },
  'West-14': { id: '350',  name: 'UNC Wilmington' },
  'West-15': { id: '155',  name: 'North Dakota' },
  'West-16': { id: '2450', name: 'Norfolk State' },

  // South
  'South-1':  { id: '2',    name: 'Auburn' },
  'South-2':  { id: '66',   name: 'Iowa State' },
  'South-3':  { id: '269',  name: 'Marquette' },
  'South-4':  { id: '245',  name: 'Texas A&M' },
  'South-5':  { id: '228',  name: 'Clemson' },
  'South-6':  { id: '356',  name: 'Illinois' },
  'South-7':  { id: '26',   name: 'UCLA' },
  'South-8':  { id: '2250', name: 'Gonzaga' },
  'South-9':  { id: '61',   name: 'Georgia' },
  'South-10': { id: '238',  name: 'Vanderbilt' },
  'South-11': { id: '2670', name: 'VCU' },
  'South-12': { id: '5765', name: 'UC San Diego' },
  'South-13': { id: '261',  name: 'Vermont' },
  'South-14': { id: '2653', name: 'Troy' },
  'South-15': { id: '2437', name: 'Omaha' },
  'South-16': { id: '2011', name: 'Alabama State' },

  // Midwest
  'Midwest-1':  { id: '248',  name: 'Houston' },
  'Midwest-2':  { id: '2633', name: 'Tennessee' },
  'Midwest-3':  { id: '96',   name: 'Kentucky' },
  'Midwest-4':  { id: '2509', name: 'Purdue' },
  'Midwest-5':  { id: '130',  name: 'Michigan' },
  'Midwest-6':  { id: '145',  name: 'Ole Miss' },
  'Midwest-7':  { id: '344',  name: 'Mississippi State' },
  'Midwest-8':  { id: '97',   name: 'Louisville' },
  'Midwest-9':  { id: '239',  name: 'Baylor' },
  'Midwest-10': { id: '251',  name: 'Texas' },
  'Midwest-11': { id: '21',   name: 'San Diego State' },
  'Midwest-12': { id: '2168', name: 'Dayton' },
  'Midwest-13': { id: '2314', name: 'High Point' },
  'Midwest-14': { id: '2523', name: 'Robert Morris' },
  'Midwest-15': { id: '2571', name: 'South Dakota State' },
  'Midwest-16': { id: '2565', name: 'SIU Edwardsville' },
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
