/**
 * Bracket Challenge API Routes
 * Mounted on the Express app from server.js
 */
const bcrypt = require('bcryptjs');
const bracketDb = require('../database/bracket');
const { BRACKET, ROUND_NAMES, REGIONS, STANDARD_SCORING, MAX_SCORE,
  R1_SEED_MATCHUPS, calculateScore, calculateMaxPossible } = require('../services/bracketStructure');

const KING_DISCORD_ID = '1246525685749649441';

module.exports = function mountBracketRoutes(app, { jwt, JWT_SECRET, discordClient, path }) {

  // ─── Bracket Auth Middleware ───
  // Accepts either Discord JWT (fk_token) or email JWT (bracket_token)
  function bracketAuth(req, res, next) {
    const discordToken = req.cookies.fk_token;
    if (discordToken) {
      try {
        const decoded = jwt.verify(discordToken, JWT_SECRET, { algorithms: ['HS256'] });
        req.user = { ...decoded, authType: 'discord' };
        return next();
      } catch (e) {}
    }
    const emailToken = req.cookies.bracket_token;
    if (emailToken) {
      try {
        const decoded = jwt.verify(emailToken, JWT_SECRET, { algorithms: ['HS256'] });
        req.user = { ...decoded, authType: 'email' };
        return next();
      } catch (e) {}
    }
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Optional auth — sets req.user if present but doesn't block
  function optionalAuth(req, res, next) {
    const discordToken = req.cookies.fk_token;
    if (discordToken) {
      try {
        const decoded = jwt.verify(discordToken, JWT_SECRET, { algorithms: ['HS256'] });
        req.user = { ...decoded, authType: 'discord' };
      } catch (e) {}
    }
    if (!req.user) {
      const emailToken = req.cookies.bracket_token;
      if (emailToken) {
        try {
          const decoded = jwt.verify(emailToken, JWT_SECRET, { algorithms: ['HS256'] });
          req.user = { ...decoded, authType: 'email' };
        } catch (e) {}
      }
    }
    next();
  }

  function isAdmin(user) {
    return user?.authType === 'discord' && user?.discordId === KING_DISCORD_ID;
  }

  // ─── Serve bracket.html ───
  app.get('/bracket', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'bracket.html'));
  });

  // Serve the shared bracket structure module to the browser
  app.get('/bracketStructure.js', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'services', 'bracketStructure.js'));
  });

  // ─── Email Auth ───
  app.post('/api/bracket/auth/register', async (req, res) => {
    try {
      const { email, password, displayName } = req.body;
      if (!email || !password || !displayName) return res.status(400).json({ error: 'Email, password, and display name required' });
      if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

      const existing = await bracketDb.getEmailUserByEmail(email);
      if (existing) return res.status(409).json({ error: 'Email already registered' });

      const hash = await bcrypt.hash(password, 10);
      const user = await bracketDb.createEmailUser(email, hash, displayName.trim());

      const token = jwt.sign({ emailUserId: user.id, email: user.email, displayName: user.display_name, authType: 'email' }, JWT_SECRET, { expiresIn: '30d' });
      res.cookie('bracket_token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
      res.json({ success: true, user: { id: user.id, email: user.email, displayName: user.display_name, authType: 'email' } });
    } catch (err) {
      console.error('[Bracket] Register error:', err);
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  app.post('/api/bracket/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

      const user = await bracketDb.getEmailUserByEmail(email);
      if (!user) return res.status(401).json({ error: 'Invalid email or password' });

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

      const token = jwt.sign({ emailUserId: user.id, email: user.email, displayName: user.display_name, authType: 'email' }, JWT_SECRET, { expiresIn: '30d' });
      res.cookie('bracket_token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
      res.json({ success: true, user: { id: user.id, email: user.email, displayName: user.display_name, authType: 'email' } });
    } catch (err) {
      console.error('[Bracket] Login error:', err);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  app.post('/api/bracket/auth/logout', (req, res) => {
    res.clearCookie('bracket_token');
    res.json({ success: true });
  });

  app.get('/api/bracket/auth/me', bracketAuth, (req, res) => {
    const u = req.user;
    res.json({
      authType: u.authType,
      discordId: u.discordId || null,
      emailUserId: u.emailUserId || null,
      displayName: u.displayName || u.username || u.email,
      avatar: u.avatar || null,
      isAdmin: isAdmin(u),
    });
  });

  // ─── Tournament ───
  app.get('/api/bracket/tournament', optionalAuth, async (req, res) => {
    try {
      const t = await bracketDb.getActiveTournament();
      if (!t) return res.json({ tournament: null });
      // Non-admin users can't see setup-status tournaments
      if (t.status === 'setup' && !isAdmin(req.user)) return res.json({ tournament: null });
      res.json({ tournament: t });
    } catch (err) {
      console.error('[Bracket] Tournament fetch error:', err);
      res.status(500).json({ error: 'Failed to fetch tournament' });
    }
  });

  app.post('/api/bracket/tournament', bracketAuth, async (req, res) => {
    try {
      if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
      const { name, year, entryFee, prizeDescription, lockDate, venmoUsername } = req.body;
      const t = await bracketDb.createTournament({
        name: name || 'March Madness 2026',
        year: year || 2026,
        entry_fee: entryFee || 0,
        prize_description: prizeDescription || '',
        lock_date: lockDate || null,
        venmo_username: venmoUsername || '',
        created_by: req.user.discordId,
      });
      res.json({ success: true, tournament: t });
    } catch (err) {
      console.error('[Bracket] Create tournament error:', err);
      res.status(500).json({ error: 'Failed to create tournament' });
    }
  });

  app.put('/api/bracket/tournament/:id', bracketAuth, async (req, res) => {
    try {
      if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
      const updates = {};
      const allowed = ['name', 'entry_fee', 'prize_description', 'status', 'lock_date', 'venmo_username', 'scoring'];
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      // Also allow camelCase
      if (req.body.entryFee !== undefined) updates.entry_fee = req.body.entryFee;
      if (req.body.prizeDescription !== undefined) updates.prize_description = req.body.prizeDescription;
      if (req.body.lockDate !== undefined) updates.lock_date = req.body.lockDate;
      if (req.body.venmoUsername !== undefined) updates.venmo_username = req.body.venmoUsername;

      const t = await bracketDb.updateTournament(req.params.id, updates);
      res.json({ success: true, tournament: t });
    } catch (err) {
      console.error('[Bracket] Update tournament error:', err);
      res.status(500).json({ error: 'Failed to update tournament' });
    }
  });

  // ─── Teams ───
  app.get('/api/bracket/teams/:tournamentId', optionalAuth, async (req, res) => {
    try {
      const teams = await bracketDb.getTeams(req.params.tournamentId);
      res.json({ teams });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch teams' });
    }
  });

  app.post('/api/bracket/teams/:tournamentId', bracketAuth, async (req, res) => {
    try {
      if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
      const { teams } = req.body; // Array of { seed, region, team_name, short_name, abbreviation }
      if (!teams || !Array.isArray(teams) || teams.length !== 64) {
        return res.status(400).json({ error: 'Must provide exactly 64 teams' });
      }
      const saved = await bracketDb.seedTeams(req.params.tournamentId, teams);

      // Initialize the 63 games
      const gamesData = [];
      for (let gn = 1; gn <= 63; gn++) {
        const g = BRACKET[gn];
        const gameRow = { game_number: gn, round: g.round, region: g.region };

        // For R1, assign teams from seeding
        if (g.round === 1) {
          const topTeam = saved.find(t => t.region === g.region && t.seed === g.topSeed);
          const bottomTeam = saved.find(t => t.region === g.region && t.seed === g.bottomSeed);
          gameRow.top_team_id = topTeam?.id || null;
          gameRow.bottom_team_id = bottomTeam?.id || null;
        }
        gamesData.push(gameRow);
      }
      await bracketDb.initializeGames(req.params.tournamentId, gamesData);

      res.json({ success: true, teams: saved });
    } catch (err) {
      console.error('[Bracket] Seed teams error:', err);
      res.status(500).json({ error: 'Failed to seed teams' });
    }
  });

  // ─── Games (results) ───
  app.get('/api/bracket/games/:tournamentId', optionalAuth, async (req, res) => {
    try {
      const games = await bracketDb.getGames(req.params.tournamentId);
      res.json({ games });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch games' });
    }
  });

  // Admin: set game result
  app.post('/api/bracket/games/:tournamentId/:gameNumber/result', bracketAuth, async (req, res) => {
    try {
      if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
      const { tournamentId, gameNumber } = req.params;
      const gn = parseInt(gameNumber);
      const { winnerId, topScore, bottomScore } = req.body;

      // Update game result
      const game = await bracketDb.updateGameResult(tournamentId, gn, {
        winner_id: winnerId,
        top_score: topScore ?? null,
        bottom_score: bottomScore ?? null,
        status: 'final',
      });

      // Auto-advance winner to next game
      const structure = BRACKET[gn];
      if (structure.advancesTo) {
        const nextGame = BRACKET[structure.advancesTo];
        const update = {};
        if (structure.position === 'top') update.top_team_id = winnerId;
        else update.bottom_team_id = winnerId;
        await bracketDb.updateGameResult(tournamentId, structure.advancesTo, update);
      }

      // Mark losing team as eliminated
      const teams = await bracketDb.getTeams(tournamentId);
      const gameData = await bracketDb.getGames(tournamentId);
      const thisGame = gameData.find(g => g.game_number === gn);
      if (thisGame) {
        const loserId = thisGame.top_team_id === winnerId ? thisGame.bottom_team_id : thisGame.top_team_id;
        if (loserId) await bracketDb.updateTeamElimination(loserId, true);
      }

      // Recalculate all entry scores
      await recalculateScores(tournamentId);

      res.json({ success: true, game });
    } catch (err) {
      console.error('[Bracket] Game result error:', err);
      res.status(500).json({ error: 'Failed to update game result' });
    }
  });

  // ─── Entries ───
  app.post('/api/bracket/entry', bracketAuth, async (req, res) => {
    try {
      const tournament = await bracketDb.getActiveTournament();
      if (!tournament) return res.status(404).json({ error: 'No active tournament' });
      if (!['open', 'active'].includes(tournament.status)) {
        return res.status(400).json({ error: 'Tournament is not accepting entries' });
      }

      const u = req.user;
      let existing;
      if (u.authType === 'discord') {
        // Look up user_id from users table
        const { supabase } = require('../config/supabase');
        const { data: dbUser } = await supabase.from('users').select('id').eq('discord_id', u.discordId).maybeSingle();
        existing = dbUser ? await bracketDb.getEntryByDiscordId(tournament.id, dbUser.id) : null;
        if (existing) return res.json({ entry: existing, existing: true });

        const entry = await bracketDb.createEntry({
          tournament_id: tournament.id,
          user_id: dbUser?.id || null,
          display_name: u.displayName || u.username,
          auth_type: 'discord',
        });
        res.json({ entry, existing: false });
      } else {
        existing = await bracketDb.getEntryByEmailUserId(tournament.id, u.emailUserId);
        if (existing) return res.json({ entry: existing, existing: true });

        const entry = await bracketDb.createEntry({
          tournament_id: tournament.id,
          email_user_id: u.emailUserId,
          display_name: u.displayName,
          email: u.email,
          auth_type: 'email',
        });
        res.json({ entry, existing: false });
      }
    } catch (err) {
      console.error('[Bracket] Create entry error:', err);
      res.status(500).json({ error: 'Failed to create entry' });
    }
  });

  app.get('/api/bracket/my-entry/:tournamentId', bracketAuth, async (req, res) => {
    try {
      const u = req.user;
      let entry;
      if (u.authType === 'discord') {
        const { supabase } = require('../config/supabase');
        const { data: dbUser } = await supabase.from('users').select('id').eq('discord_id', u.discordId).maybeSingle();
        entry = dbUser ? await bracketDb.getEntryByDiscordId(req.params.tournamentId, dbUser.id) : null;
      } else {
        entry = await bracketDb.getEntryByEmailUserId(req.params.tournamentId, u.emailUserId);
      }
      res.json({ entry: entry || null });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch entry' });
    }
  });

  app.post('/api/bracket/picks', bracketAuth, async (req, res) => {
    try {
      const { entryId, picks, tiebreaker } = req.body;
      if (!entryId || !picks) return res.status(400).json({ error: 'Entry ID and picks required' });

      const entry = await bracketDb.getEntry(entryId);
      if (!entry) return res.status(404).json({ error: 'Entry not found' });

      // Verify ownership
      const u = req.user;
      if (u.authType === 'discord') {
        const { supabase } = require('../config/supabase');
        const { data: dbUser } = await supabase.from('users').select('id').eq('discord_id', u.discordId).maybeSingle();
        if (!dbUser || entry.user_id !== dbUser.id) return res.status(403).json({ error: 'Not your entry' });
      } else {
        if (entry.email_user_id !== u.emailUserId) return res.status(403).json({ error: 'Not your entry' });
      }

      // Check tournament is still accepting picks
      const tournament = await bracketDb.getTournament(entry.tournament_id);
      if (!tournament || tournament.status === 'locked' || tournament.status === 'completed') {
        return res.status(400).json({ error: 'Picks are locked' });
      }
      if (tournament.lock_date && new Date() > new Date(tournament.lock_date)) {
        return res.status(400).json({ error: 'Picks deadline has passed' });
      }

      // Validate picks: should have 63 entries, all valid team IDs
      const pickCount = Object.keys(picks).length;
      if (pickCount !== 63) return res.status(400).json({ error: `Need exactly 63 picks, got ${pickCount}` });

      const updated = await bracketDb.updatePicks(entryId, picks, tiebreaker);
      res.json({ success: true, entry: updated });
    } catch (err) {
      console.error('[Bracket] Submit picks error:', err);
      res.status(500).json({ error: 'Failed to submit picks' });
    }
  });

  // ─── Leaderboard (public) ───
  app.get('/api/bracket/leaderboard/:tournamentId', optionalAuth, async (req, res) => {
    try {
      const lb = await bracketDb.getLeaderboard(req.params.tournamentId);
      res.json({ leaderboard: lb });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
  });

  // ─── Admin ───
  app.get('/api/bracket/admin/entries/:tournamentId', bracketAuth, async (req, res) => {
    try {
      if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
      const entries = await bracketDb.getEntries(req.params.tournamentId);
      res.json({ entries });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch entries' });
    }
  });

  app.post('/api/bracket/admin/payment/:entryId', bracketAuth, async (req, res) => {
    try {
      if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
      const { paid } = req.body;
      const entry = await bracketDb.updatePayment(req.params.entryId, !!paid);
      res.json({ success: true, entry });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update payment' });
    }
  });

  app.delete('/api/bracket/admin/entry/:entryId', bracketAuth, async (req, res) => {
    try {
      if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
      await bracketDb.deleteEntry(req.params.entryId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete entry' });
    }
  });

  // ─── Score Recalculation ───
  async function recalculateScores(tournamentId) {
    const games = await bracketDb.getGames(tournamentId);
    const teams = await bracketDb.getTeams(tournamentId);
    const entries = await bracketDb.getEntries(tournamentId);
    const tournament = await bracketDb.getTournament(tournamentId);
    const scoring = tournament?.scoring || STANDARD_SCORING;

    // Build results map { gameNumber: winnerId }
    const results = {};
    for (const g of games) {
      if (g.winner_id) results[g.game_number] = g.winner_id;
    }

    const elimIds = teams.filter(t => t.is_eliminated).map(t => t.id);

    for (const entry of entries) {
      if (!entry.picks || !entry.submitted_at) continue;
      const { score, correct } = calculateScore(entry.picks, results, scoring);
      const maxPossible = calculateMaxPossible(entry.picks, results, elimIds, scoring);
      await bracketDb.updateEntryScore(entry.id, score, maxPossible, correct);
    }
  }
};
