/**
 * Seed script: Creates a tournament with 2025 NCAA bracket teams
 * Run on EC2: node scripts/seed-bracket-2025.js
 */
const { supabase } = require('../src/config/supabase');
const bracketDb = require('../src/database/bracket');
const { BRACKET } = require('../src/services/bracketStructure');

const KING_DISCORD_ID = '1246525685749649441';

// 2025 NCAA Tournament teams by region
const TEAMS_2025 = {
  East: [
    { seed: 1,  team_name: 'Duke',           short_name: 'Duke' },
    { seed: 2,  team_name: 'Alabama',        short_name: 'Alabama' },
    { seed: 3,  team_name: 'Wisconsin',      short_name: 'Wisconsin' },
    { seed: 4,  team_name: 'Arizona',        short_name: 'Arizona' },
    { seed: 5,  team_name: 'Oregon',         short_name: 'Oregon' },
    { seed: 6,  team_name: 'BYU',            short_name: 'BYU' },
    { seed: 7,  team_name: 'St. John\'s',    short_name: "St. John's" },
    { seed: 8,  team_name: 'UConn',          short_name: 'UConn' },
    { seed: 9,  team_name: 'Oklahoma',       short_name: 'Oklahoma' },
    { seed: 10, team_name: 'Arkansas',       short_name: 'Arkansas' },
    { seed: 11, team_name: 'Drake',          short_name: 'Drake' },
    { seed: 12, team_name: 'Liberty',        short_name: 'Liberty' },
    { seed: 13, team_name: 'Yale',           short_name: 'Yale' },
    { seed: 14, team_name: 'Lipscomb',       short_name: 'Lipscomb' },
    { seed: 15, team_name: 'Montana',        short_name: 'Montana' },
    { seed: 16, team_name: 'American',       short_name: 'American' },
  ],
  West: [
    { seed: 1,  team_name: 'Florida',        short_name: 'Florida' },
    { seed: 2,  team_name: 'Michigan State', short_name: 'Michigan St' },
    { seed: 3,  team_name: 'Texas Tech',     short_name: 'Texas Tech' },
    { seed: 4,  team_name: 'Maryland',       short_name: 'Maryland' },
    { seed: 5,  team_name: 'Memphis',        short_name: 'Memphis' },
    { seed: 6,  team_name: 'Missouri',       short_name: 'Missouri' },
    { seed: 7,  team_name: 'Kansas',         short_name: 'Kansas' },
    { seed: 8,  team_name: 'UConn',          short_name: 'UConn' },
    { seed: 9,  team_name: 'Creighton',      short_name: 'Creighton' },
    { seed: 10, team_name: 'New Mexico',     short_name: 'New Mexico' },
    { seed: 11, team_name: 'Colorado State', short_name: 'Colorado St' },
    { seed: 12, team_name: 'McNeese',        short_name: 'McNeese' },
    { seed: 13, team_name: 'Grand Canyon',   short_name: 'Grand Canyon' },
    { seed: 14, team_name: 'UNC Wilmington', short_name: 'UNCW' },
    { seed: 15, team_name: 'North Dakota',   short_name: 'North Dakota' },
    { seed: 16, team_name: 'Norfolk State',  short_name: 'Norfolk St' },
  ],
  South: [
    { seed: 1,  team_name: 'Auburn',         short_name: 'Auburn' },
    { seed: 2,  team_name: 'Iowa State',     short_name: 'Iowa State' },
    { seed: 3,  team_name: 'Marquette',      short_name: 'Marquette' },
    { seed: 4,  team_name: 'Texas A&M',      short_name: 'Texas A&M' },
    { seed: 5,  team_name: 'Clemson',        short_name: 'Clemson' },
    { seed: 6,  team_name: 'Illinois',       short_name: 'Illinois' },
    { seed: 7,  team_name: 'UCLA',           short_name: 'UCLA' },
    { seed: 8,  team_name: 'Gonzaga',        short_name: 'Gonzaga' },
    { seed: 9,  team_name: 'Georgia',        short_name: 'Georgia' },
    { seed: 10, team_name: 'Vanderbilt',     short_name: 'Vanderbilt' },
    { seed: 11, team_name: 'VCU',            short_name: 'VCU' },
    { seed: 12, team_name: 'UC San Diego',   short_name: 'UC San Diego' },
    { seed: 13, team_name: 'Vermont',        short_name: 'Vermont' },
    { seed: 14, team_name: 'Troy',           short_name: 'Troy' },
    { seed: 15, team_name: 'Omaha',          short_name: 'Omaha' },
    { seed: 16, team_name: 'Alabama State',  short_name: 'Alabama St' },
  ],
  Midwest: [
    { seed: 1,  team_name: 'Houston',        short_name: 'Houston' },
    { seed: 2,  team_name: 'Tennessee',      short_name: 'Tennessee' },
    { seed: 3,  team_name: 'Kentucky',       short_name: 'Kentucky' },
    { seed: 4,  team_name: 'Purdue',         short_name: 'Purdue' },
    { seed: 5,  team_name: 'Michigan',       short_name: 'Michigan' },
    { seed: 6,  team_name: 'Ole Miss',       short_name: 'Ole Miss' },
    { seed: 7,  team_name: 'Mississippi State', short_name: 'Miss State' },
    { seed: 8,  team_name: 'Louisville',     short_name: 'Louisville' },
    { seed: 9,  team_name: 'Baylor',         short_name: 'Baylor' },
    { seed: 10, team_name: 'Texas',          short_name: 'Texas' },
    { seed: 11, team_name: 'San Diego State', short_name: 'SDSU' },
    { seed: 12, team_name: 'Dayton',         short_name: 'Dayton' },
    { seed: 13, team_name: 'High Point',     short_name: 'High Point' },
    { seed: 14, team_name: 'Robert Morris',  short_name: 'Robert Morris' },
    { seed: 15, team_name: 'South Dakota State', short_name: 'S Dakota St' },
    { seed: 16, team_name: 'SIU Edwardsville', short_name: 'SIUE' },
  ],
};

async function seed() {
  try {
    console.log('Creating tournament...');
    const t = await bracketDb.createTournament({
      name: 'March Madness 2025 (Preview)',
      year: 2025,
      entry_fee: 50,
      prize_description: '1st: 60%, 2nd: 25%, 3rd: 15%',
      lock_date: '2026-03-20T12:00:00Z',
      venmo_username: 'YourVenmo',
      created_by: KING_DISCORD_ID,
    });
    console.log('Tournament created:', t.id);

    // Build 64 team objects
    const teamsList = [];
    for (const region of ['East', 'West', 'South', 'Midwest']) {
      for (const tm of TEAMS_2025[region]) {
        teamsList.push({
          seed: tm.seed,
          region,
          team_name: tm.team_name,
          short_name: tm.short_name,
          abbreviation: tm.team_name.substring(0, 4).toUpperCase(),
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
