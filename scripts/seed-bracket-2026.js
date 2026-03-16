/**
 * Seed script: Creates a tournament with 2026 NCAA bracket teams
 * Teams pulled from ESPN API (groups=100 NCAA tournament).
 * Run on EC2: node scripts/seed-bracket-2026.js
 */
const { supabase } = require('../src/config/supabase');
const bracketDb = require('../src/database/bracket');
const { BRACKET } = require('../src/services/bracketStructure');

const KING_DISCORD_ID = '1246525685749649441';

// 2026 NCAA Tournament teams by region (from ESPN API)
// First Four play-in slots show one team; bracket updater fills winner.
const TEAMS_2026 = {
  East: [
    { seed: 1,  team_name: 'Duke',              short_name: 'Duke',        espn_id: '150' },
    { seed: 2,  team_name: 'UConn',             short_name: 'UConn',       espn_id: '41' },
    { seed: 3,  team_name: 'Michigan State',    short_name: 'Michigan St', espn_id: '127' },
    { seed: 4,  team_name: 'Kansas',            short_name: 'Kansas',      espn_id: '2305' },
    { seed: 5,  team_name: "St. John's",        short_name: "St. John's",  espn_id: '2599' },
    { seed: 6,  team_name: 'Louisville',        short_name: 'Louisville',  espn_id: '97' },
    { seed: 7,  team_name: 'UCLA',              short_name: 'UCLA',        espn_id: '26' },
    { seed: 8,  team_name: 'Ohio State',        short_name: 'Ohio State',  espn_id: '194' },
    { seed: 9,  team_name: 'TCU',               short_name: 'TCU',         espn_id: '2628' },
    { seed: 10, team_name: 'UCF',               short_name: 'UCF',         espn_id: '2116' },
    { seed: 11, team_name: 'South Florida',     short_name: 'USF',         espn_id: '58' },
    { seed: 12, team_name: 'Northern Iowa',     short_name: 'N Iowa',      espn_id: '2460' },
    { seed: 13, team_name: 'California Baptist', short_name: 'Cal Baptist', espn_id: '2856' },
    { seed: 14, team_name: 'North Dakota State', short_name: 'NDSU',       espn_id: '2449' },
    { seed: 15, team_name: 'Furman',            short_name: 'Furman',      espn_id: '231' },
    { seed: 16, team_name: 'Siena',             short_name: 'Siena',       espn_id: '2561' },
  ],
  West: [
    { seed: 1,  team_name: 'Arizona',           short_name: 'Arizona',     espn_id: '12' },
    { seed: 2,  team_name: 'Purdue',            short_name: 'Purdue',      espn_id: '2509' },
    { seed: 3,  team_name: 'Gonzaga',           short_name: 'Gonzaga',     espn_id: '2250' },
    { seed: 4,  team_name: 'Arkansas',          short_name: 'Arkansas',    espn_id: '8' },
    { seed: 5,  team_name: 'Wisconsin',         short_name: 'Wisconsin',   espn_id: '275' },
    { seed: 6,  team_name: 'BYU',               short_name: 'BYU',         espn_id: '252' },
    { seed: 7,  team_name: 'Miami',             short_name: 'Miami',       espn_id: '2390' },
    { seed: 8,  team_name: 'Villanova',         short_name: 'Villanova',   espn_id: '222' },
    { seed: 9,  team_name: 'Utah State',        short_name: 'Utah State',  espn_id: '328' },
    { seed: 10, team_name: 'Missouri',          short_name: 'Missouri',    espn_id: '142' },
    { seed: 11, team_name: 'NC State',          short_name: 'NC State',    espn_id: '152' },
    { seed: 12, team_name: 'High Point',        short_name: 'High Point',  espn_id: '2272' },
    { seed: 13, team_name: "Hawai'i",           short_name: "Hawai'i",     espn_id: '62' },
    { seed: 14, team_name: 'Kennesaw State',    short_name: 'Kennesaw St', espn_id: '338' },
    { seed: 15, team_name: 'Queens University', short_name: 'Queens',      espn_id: '2511' },
    { seed: 16, team_name: 'Long Island',       short_name: 'LIU',         espn_id: '112358' },
  ],
  South: [
    { seed: 1,  team_name: 'Florida',           short_name: 'Florida',     espn_id: '57' },
    { seed: 2,  team_name: 'Houston',           short_name: 'Houston',     espn_id: '248' },
    { seed: 3,  team_name: 'Illinois',          short_name: 'Illinois',    espn_id: '356' },
    { seed: 4,  team_name: 'Nebraska',          short_name: 'Nebraska',    espn_id: '158' },
    { seed: 5,  team_name: 'Vanderbilt',        short_name: 'Vanderbilt',  espn_id: '238' },
    { seed: 6,  team_name: 'North Carolina',    short_name: 'UNC',         espn_id: '153' },
    { seed: 7,  team_name: "Saint Mary's",      short_name: "Saint Mary's", espn_id: '2608' },
    { seed: 8,  team_name: 'Clemson',           short_name: 'Clemson',     espn_id: '228' },
    { seed: 9,  team_name: 'Iowa',              short_name: 'Iowa',        espn_id: '2294' },
    { seed: 10, team_name: 'Texas A&M',         short_name: 'Texas A&M',   espn_id: '245' },
    { seed: 11, team_name: 'VCU',               short_name: 'VCU',         espn_id: '2670' },
    { seed: 12, team_name: 'McNeese',           short_name: 'McNeese',     espn_id: '2377' },
    { seed: 13, team_name: 'Troy',              short_name: 'Troy',        espn_id: '2653' },
    { seed: 14, team_name: 'Pennsylvania',      short_name: 'Penn',        espn_id: '219' },
    { seed: 15, team_name: 'Idaho',             short_name: 'Idaho',       espn_id: '70' },
    { seed: 16, team_name: 'Lehigh',            short_name: 'Lehigh',      espn_id: '2329' },
  ],
  Midwest: [
    { seed: 1,  team_name: 'Michigan',          short_name: 'Michigan',    espn_id: '130' },
    { seed: 2,  team_name: 'Iowa State',        short_name: 'Iowa State',  espn_id: '66' },
    { seed: 3,  team_name: 'Virginia',          short_name: 'Virginia',    espn_id: '258' },
    { seed: 4,  team_name: 'Alabama',           short_name: 'Alabama',     espn_id: '333' },
    { seed: 5,  team_name: 'Texas Tech',        short_name: 'Texas Tech',  espn_id: '2641' },
    { seed: 6,  team_name: 'Tennessee',         short_name: 'Tennessee',   espn_id: '2633' },
    { seed: 7,  team_name: 'Kentucky',          short_name: 'Kentucky',    espn_id: '96' },
    { seed: 8,  team_name: 'Georgia',           short_name: 'Georgia',     espn_id: '61' },
    { seed: 9,  team_name: 'Saint Louis',       short_name: 'Saint Louis', espn_id: '139' },
    { seed: 10, team_name: 'Santa Clara',       short_name: 'Santa Clara', espn_id: '2541' },
    { seed: 11, team_name: 'SMU',               short_name: 'SMU',         espn_id: '2567' },
    { seed: 12, team_name: 'Akron',             short_name: 'Akron',       espn_id: '2006' },
    { seed: 13, team_name: 'Hofstra',           short_name: 'Hofstra',     espn_id: '2275' },
    { seed: 14, team_name: 'Wright State',      short_name: 'Wright St',   espn_id: '2750' },
    { seed: 15, team_name: 'Tennessee State',   short_name: 'Tenn State',  espn_id: '2634' },
    { seed: 16, team_name: 'Howard',            short_name: 'Howard',      espn_id: '47' },
  ],
};

async function seed() {
  try {
    console.log('Creating 2026 tournament...');
    const t = await bracketDb.createTournament({
      name: 'March Madness 2026',
      year: 2026,
      entry_fee: 50,
      prize_description: '1st: 70%, 2nd: 20%, 3rd: 10%',
      lock_date: '2026-03-20T12:00:00Z',
      venmo_username: 'YourVenmo',
      created_by: KING_DISCORD_ID,
    });
    console.log('Tournament created:', t.id);

    // Build 64 team objects with ESPN IDs and logos
    const teamsList = [];
    for (const region of ['East', 'West', 'South', 'Midwest']) {
      for (const tm of TEAMS_2026[region]) {
        teamsList.push({
          seed: tm.seed,
          region,
          team_name: tm.team_name,
          short_name: tm.short_name,
          abbreviation: tm.short_name.substring(0, 4).toUpperCase(),
          espn_team_id: tm.espn_id,
          logo_url: `https://a.espncdn.com/i/teamlogos/ncaa/500/${tm.espn_id}.png`,
        });
      }
    }

    console.log('Seeding 64 teams...');
    const saved = await bracketDb.seedTeams(t.id, teamsList);
    console.log('Teams seeded:', saved.length);

    // Initialize 63 games
    const gamesData = [];
    for (let gn = 1; gn <= 63; gn++) {
      const g = BRACKET[gn];
      const gameRow = { game_number: gn, round: g.round, region: g.region };
      if (g.round === 1) {
        const topTeam = saved.find(tm => tm.region === g.region && tm.seed === g.topSeed);
        const bottomTeam = saved.find(tm => tm.region === g.region && tm.seed === g.bottomSeed);
        gameRow.top_team_id = topTeam?.id || null;
        gameRow.bottom_team_id = bottomTeam?.id || null;
      }
      gamesData.push(gameRow);
    }
    console.log('Initializing 63 games...');
    await bracketDb.initializeGames(t.id, gamesData);

    // Set status to open
    await bracketDb.updateTournament(t.id, { status: 'open' });
    console.log('Tournament set to OPEN!');
    console.log('\nDone! Go to /bracket and fill out your bracket.');
    process.exit(0);
  } catch (err) {
    console.error('Seed error:', err);
    process.exit(1);
  }
}

seed();
