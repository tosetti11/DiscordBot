module.exports = {
  // Sport options for dropdowns (max 25 per Discord select menu — use pages if needed)
  SPORTS: [
    // Major US
    { name: 'NFL', value: 'nfl' },
    { name: 'NBA', value: 'nba' },
    { name: 'MLB', value: 'mlb' },
    { name: 'NHL', value: 'nhl' },
    { name: 'WNBA', value: 'wnba' },
    // College
    { name: 'NCAA Football', value: 'ncaa_football' },
    { name: 'NCAA Men\'s Basketball', value: 'ncaa_mbb' },
    { name: 'NCAA Women\'s Basketball', value: 'ncaa_wbb' },
    // Soccer
    { name: 'Soccer - MLS', value: 'mls' },
    { name: 'Soccer - Premier League', value: 'epl' },
    { name: 'Soccer - La Liga', value: 'la_liga' },
    { name: 'Soccer - Serie A', value: 'serie_a' },
    { name: 'Soccer - Bundesliga', value: 'bundesliga' },
    { name: 'Soccer - Ligue 1', value: 'ligue_1' },
    { name: 'Soccer - Champions League', value: 'ucl' },
    { name: 'Soccer - Liga MX', value: 'liga_mx' },
    // Combat
    { name: 'UFC / MMA', value: 'ufc' },
    { name: 'Boxing', value: 'boxing' },
    // Tennis
    { name: 'Tennis - ATP', value: 'tennis_atp' },
    { name: 'Tennis - WTA', value: 'tennis_wta' },
    // Golf
    { name: 'Golf - PGA Tour', value: 'golf_pga' },
    { name: 'Golf - LIV', value: 'golf_liv' },
    { name: 'Golf - DP World Tour', value: 'golf_dp' },
    // Other
    { name: 'NASCAR', value: 'nascar' },
  ],

  // Page 2 sports (shown when user clicks "More Sports")
  SPORTS_PAGE_2: [
    { name: 'Esports', value: 'esports' },
    // International Baseball
    { name: 'Baseball - KBO (Korea)', value: 'kbo' },
    { name: 'Baseball - NPB (Japan)', value: 'npb' },
    { name: 'Baseball - CPBL (Taiwan)', value: 'cpbl' },
    // More Soccer
    { name: 'Soccer - Eredivisie', value: 'eredivisie' },
    { name: 'Soccer - Primeira Liga', value: 'primeira_liga' },
    { name: 'Soccer - World Cup', value: 'world_cup' },
    { name: 'Soccer - Europa League', value: 'europa_league' },
    // More Tennis
    { name: 'Tennis - Grand Slam', value: 'tennis_gs' },
    // More Golf
    { name: 'Golf - LPGA', value: 'golf_lpga' },
    { name: 'Golf - PGA Champions', value: 'golf_champions' },
    // International
    { name: 'Rugby', value: 'rugby' },
    { name: 'Cricket', value: 'cricket' },
    { name: 'F1 Racing', value: 'f1' },
    { name: 'Olympics', value: 'olympics' },
    { name: 'CFL', value: 'cfl' },
    { name: 'XFL / UFL', value: 'xfl' },
    { name: 'Aussie Rules (AFL)', value: 'afl' },
    { name: 'Darts', value: 'darts' },
    { name: 'Table Tennis', value: 'table_tennis' },
    { name: 'Custom / Other', value: 'other' },
  ],

  // Sport display names
  SPORT_NAMES: {
    // Major US
    nfl: 'NFL', nba: 'NBA', mlb: 'MLB', nhl: 'NHL', wnba: 'WNBA',
    // College
    cfb: 'College Football', cbb: 'College Basketball',
    ncaa_football: 'NCAA Football', ncaa_mbb: 'NCAA MBB', ncaa_wbb: 'NCAA WBB',
    // Soccer
    mls: 'MLS', epl: 'Premier League', la_liga: 'La Liga',
    serie_a: 'Serie A', bundesliga: 'Bundesliga', ligue_1: 'Ligue 1',
    ucl: 'Champions League', liga_mx: 'Liga MX',
    eredivisie: 'Eredivisie', primeira_liga: 'Primeira Liga',
    world_cup: 'World Cup', europa_league: 'Europa League',
    // Combat
    mma: 'UFC / MMA', ufc: 'UFC / MMA', boxing: 'Boxing',
    // Tennis
    tennis: 'Tennis', tennis_atp: 'ATP Tennis', tennis_wta: 'WTA Tennis', tennis_gs: 'Grand Slam',
    // Golf
    golf: 'Golf', golf_pga: 'PGA Tour', golf_liv: 'LIV Golf',
    golf_dp: 'DP World Tour', golf_lpga: 'LPGA', golf_champions: 'PGA Champions',
    // International Baseball
    kbo: 'KBO (Korea)', npb: 'NPB (Japan)', cpbl: 'CPBL (Taiwan)',
    // Motorsport
    nascar: 'NASCAR', f1: 'Formula 1',
    // Other
    rugby: 'Rugby', cricket: 'Cricket', olympics: 'Olympics',
    cfl: 'CFL', xfl: 'XFL / UFL', afl: 'AFL',
    darts: 'Darts', table_tennis: 'Table Tennis',
    esports: 'Esports', other: 'Other',
  },

  // Status emojis
  STATUS_EMOJI: {
    open: '🟡',
    win: '✅',
    loss: '❌',
    push: '🔄',
    void: '⛔',
  },

  // Bet type labels
  WAGER_TYPES: {
    moneyline: 'Moneyline',
    spread: 'Spread',
    total: 'Over/Under',
    team_total: 'Team Total',
    prop: 'Player Prop',
    futures: 'Futures',
    nrfi: 'NRFI',
    yrfi: 'YRFI',
  },

  // Period options for totals/spreads
  PERIODS: {
    full_game: 'Full Game',
    '1st_half': '1st Half',
    '2nd_half': '2nd Half',
    '1st_period': '1st Period',
    '2nd_period': '2nd Period',
    '3rd_period': '3rd Period',
    '1st_quarter': '1st Quarter',
    '2nd_quarter': '2nd Quarter',
    '3rd_quarter': '3rd Quarter',
    '4th_quarter': '4th Quarter',
    '1st_set': '1st Set',
    'first_5': 'First 5 Innings',
    '1st_inning': '1st Inning',
    '2nd_inning': '2nd Inning',
    '3rd_inning': '3rd Inning',
    '4th_inning': '4th Inning',
    '5th_inning': '5th Inning',
  },

  // Fight methods for MMA/Boxing
  FIGHT_METHODS: {
    ko_tko: 'KO/TKO',
    submission: 'Submission',
    decision: 'Decision',
    unanimous_decision: 'Unanimous Decision',
    split_decision: 'Split Decision',
    dq: 'Disqualification',
    points: 'Points',
  },

  // Colors for embeds
  COLORS: {
    primary: 0xFFD700,    // Gold
    success: 0x00FF00,    // Green
    danger: 0xFF0000,     // Red
    info: 0x5865F2,       // Discord Blurple
    warning: 0xFF9900,    // Orange
    neutral: 0x808080,    // Gray
  },
};
