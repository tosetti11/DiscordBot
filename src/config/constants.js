module.exports = {
  // Sport options for dropdowns
  SPORTS: [
    { name: 'NFL', value: 'nfl' },
    { name: 'NBA', value: 'nba' },
    { name: 'MLB', value: 'mlb' },
    { name: 'NHL', value: 'nhl' },
    { name: 'NCAA Football', value: 'ncaa_football' },
    { name: 'NCAA Men\'s Basketball', value: 'ncaa_mbb' },
    { name: 'NCAA Women\'s Basketball', value: 'ncaa_wbb' },
    { name: 'Soccer - MLS', value: 'mls' },
    { name: 'Soccer - Premier League', value: 'epl' },
    { name: 'Soccer - La Liga', value: 'la_liga' },
    { name: 'Soccer - Champions League', value: 'ucl' },
    { name: 'UFC / MMA', value: 'ufc' },
    { name: 'Boxing', value: 'boxing' },
    { name: 'Tennis', value: 'tennis' },
    { name: 'Golf', value: 'golf' },
    { name: 'NASCAR', value: 'nascar' },
    { name: 'WNBA', value: 'wnba' },
    { name: 'Esports', value: 'esports' },
    { name: 'Other', value: 'other' },
  ],

  // Sport display names
  SPORT_NAMES: {
    nfl: 'NFL',
    nba: 'NBA',
    mlb: 'MLB',
    nhl: 'NHL',
    cfb: 'College Football',
    cbb: 'College Basketball',
    ncaa_football: 'NCAA Football',
    ncaa_mbb: 'NCAA Men\'s Basketball',
    ncaa_wbb: 'NCAA Women\'s Basketball',
    mma: 'UFC / MMA',
    mls: 'MLS',
    epl: 'Premier League',
    la_liga: 'La Liga',
    ucl: 'Champions League',
    ufc: 'UFC / MMA',
    boxing: 'Boxing',
    tennis: 'Tennis',
    golf: 'Golf',
    nascar: 'NASCAR',
    wnba: 'WNBA',
    esports: 'Esports',
    other: 'Other',
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
    prop: 'Player Prop',
    futures: 'Futures',
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
