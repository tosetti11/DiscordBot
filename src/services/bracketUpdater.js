/**
 * Bracket Auto-Updater
 * Polls ESPN API for NCAA tournament game results and automatically
 * updates the bracket: game results, team advancement, eliminations, and scores.
 *
 * Runs on a configurable interval (default: every 2 minutes during tournament).
 */
const bracketDb = require('../database/bracket');
const { BRACKET, calculateScore, calculateMaxPossible, STANDARD_SCORING } = require('./bracketStructure');

const ESPN_CBB_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard';
const POLL_INTERVAL = 2 * 60 * 1000; // 2 minutes

let pollTimer = null;
let isRunning = false;

/**
 * Fetch NCAA tournament games from ESPN for a given date range.
 * If no dates given, fetches today's games.
 * Groups=100 returns NCAA tournament games.
 */
async function fetchESPNTournamentGames(dateStr) {
  const today = dateStr || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
  const url = `${ESPN_CBB_SCOREBOARD}?groups=100&limit=200&dates=${today}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN API ${res.status}`);
    const data = await res.json();
    return (data.events || []).map(event => {
      const comp = event.competitions?.[0];
      if (!comp) return null;
      const teams = comp.competitors || [];
      const status = event.status?.type || {};
      return {
        espnGameId: event.id,
        state: status.state || 'pre',         // pre, in, post
        completed: status.completed || false,
        detail: status.shortDetail || '',
        teams: teams.map(t => ({
          espnTeamId: t.team?.id,
          name: t.team?.displayName || '',
          score: parseInt(t.score) || 0,
          winner: t.winner || false,
          homeAway: t.homeAway,
        })),
      };
    }).filter(Boolean);
  } catch (err) {
    console.error('[BracketUpdater] ESPN fetch error:', err.message);
    return [];
  }
}

/**
 * Match an ESPN game to a bracket game by comparing ESPN team IDs.
 * Returns { bracketGame, espnGame, winnerTeam, loserTeam, topScore, bottomScore } or null.
 */
function matchGame(espnGame, bracketGames, teams) {
  if (!espnGame.completed) return null;

  const espnTeam1 = espnGame.teams[0];
  const espnTeam2 = espnGame.teams[1];
  if (!espnTeam1 || !espnTeam2) return null;

  // Find which bracket teams these ESPN teams correspond to
  const bracketTeam1 = teams.find(t => t.espn_team_id === espnTeam1.espnTeamId);
  const bracketTeam2 = teams.find(t => t.espn_team_id === espnTeam2.espnTeamId);
  if (!bracketTeam1 || !bracketTeam2) return null;

  // Find the bracket game where these two teams are playing
  const bracketGame = bracketGames.find(g =>
    g.status !== 'final' && (
      (g.top_team_id === bracketTeam1.id && g.bottom_team_id === bracketTeam2.id) ||
      (g.top_team_id === bracketTeam2.id && g.bottom_team_id === bracketTeam1.id)
    )
  );
  if (!bracketGame) return null;

  const winnerEspn = espnGame.teams.find(t => t.winner);
  const loserEspn = espnGame.teams.find(t => !t.winner);
  if (!winnerEspn) return null;

  const winnerTeam = teams.find(t => t.espn_team_id === winnerEspn.espnTeamId);
  const loserTeam = teams.find(t => t.espn_team_id === loserEspn.espnTeamId);
  if (!winnerTeam || !loserTeam) return null;

  // Figure out which ESPN team is top/bottom in our bracket
  const topIsTeam1 = bracketGame.top_team_id === bracketTeam1.id;
  const topScore = topIsTeam1 ? espnTeam1.score : espnTeam2.score;
  const bottomScore = topIsTeam1 ? espnTeam2.score : espnTeam1.score;

  return { bracketGame, winnerTeam, loserTeam, topScore, bottomScore };
}

/**
 * Mark live games (in-progress) in the bracket.
 */
async function updateLiveGames(espnGames, bracketGames, teams, tournamentId) {
  let updated = 0;
  for (const eg of espnGames) {
    if (eg.state !== 'in') continue;

    const espnTeam1 = eg.teams[0];
    const espnTeam2 = eg.teams[1];
    if (!espnTeam1 || !espnTeam2) continue;

    const bt1 = teams.find(t => t.espn_team_id === espnTeam1.espnTeamId);
    const bt2 = teams.find(t => t.espn_team_id === espnTeam2.espnTeamId);
    if (!bt1 || !bt2) continue;

    const bg = bracketGames.find(g =>
      g.status !== 'final' && (
        (g.top_team_id === bt1.id && g.bottom_team_id === bt2.id) ||
        (g.top_team_id === bt2.id && g.bottom_team_id === bt1.id)
      )
    );
    if (!bg || bg.status === 'live') continue;

    await bracketDb.updateGameResult(tournamentId, bg.game_number, { status: 'live' });
    console.log(`[BracketUpdater] Game ${bg.game_number} is now LIVE`);
    updated++;
  }
  return updated;
}

/**
 * Core update function — called on each poll interval.
 * Fetches ESPN results, matches to bracket games, updates DB.
 */
async function pollAndUpdate() {
  if (isRunning) return;
  isRunning = true;

  try {
    const tournament = await bracketDb.getActiveTournament();
    if (!tournament || !['active', 'locked'].includes(tournament.status)) {
      isRunning = false;
      return;
    }

    const teams = await bracketDb.getTeams(tournament.id);
    let bracketGames = await bracketDb.getGames(tournament.id);

    const pendingOrLive = bracketGames.filter(g => g.status !== 'final');
    if (pendingOrLive.length === 0) {
      console.log('[BracketUpdater] All 63 games are final — tournament complete!');
      await bracketDb.updateTournament(tournament.id, { status: 'completed' });
      isRunning = false;
      return;
    }

    // Fetch ESPN games for multiple days (tournament spans ~3 weeks)
    // Check today and the last 2 days to catch any games we missed
    const dates = [];
    for (let d = 0; d < 3; d++) {
      const dt = new Date();
      dt.setDate(dt.getDate() - d);
      dates.push(dt.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, ''));
    }

    const allEspnGames = [];
    const seen = new Set();
    for (const dateStr of dates) {
      const games = await fetchESPNTournamentGames(dateStr);
      for (const g of games) {
        if (!seen.has(g.espnGameId)) {
          seen.add(g.espnGameId);
          allEspnGames.push(g);
        }
      }
    }

    if (allEspnGames.length === 0) {
      isRunning = false;
      return;
    }

    // Update live game statuses
    await updateLiveGames(allEspnGames, bracketGames, teams, tournament.id);

    // Process completed games
    let updatedCount = 0;
    const completedEspn = allEspnGames.filter(g => g.completed);

    for (const espnGame of completedEspn) {
      const match = matchGame(espnGame, bracketGames, teams);
      if (!match) continue;

      const { bracketGame, winnerTeam, loserTeam, topScore, bottomScore } = match;

      // Update game result
      await bracketDb.updateGameResult(tournament.id, bracketGame.game_number, {
        winner_id: winnerTeam.id,
        top_score: topScore,
        bottom_score: bottomScore,
        status: 'final',
      });

      // Auto-advance winner to next game
      const structure = BRACKET[bracketGame.game_number];
      if (structure.advancesTo) {
        const update = {};
        if (structure.position === 'top') update.top_team_id = winnerTeam.id;
        else update.bottom_team_id = winnerTeam.id;
        await bracketDb.updateGameResult(tournament.id, structure.advancesTo, update);
      }

      // Mark loser as eliminated
      await bracketDb.updateTeamElimination(loserTeam.id, true);

      console.log(`[BracketUpdater] Game ${bracketGame.game_number} (R${bracketGame.round}): ${winnerTeam.team_name} def. ${loserTeam.team_name} ${topScore}-${bottomScore}`);
      updatedCount++;
    }

    // Recalculate all entry scores if any games were updated
    if (updatedCount > 0) {
      // Refresh games data after updates
      bracketGames = await bracketDb.getGames(tournament.id);
      const entries = await bracketDb.getEntries(tournament.id);
      const scoring = tournament.scoring || STANDARD_SCORING;

      const results = {};
      for (const g of bracketGames) {
        if (g.winner_id) results[g.game_number] = g.winner_id;
      }
      const elimIds = teams.filter(t => t.is_eliminated).map(t => t.id);

      for (const entry of entries) {
        if (!entry.picks || !entry.submitted_at) continue;
        const { score, correct } = calculateScore(entry.picks, results, scoring);
        const maxPossible = calculateMaxPossible(entry.picks, results, elimIds, scoring);
        await bracketDb.updateEntryScore(entry.id, score, maxPossible, correct);
      }

      const finalCount = bracketGames.filter(g => g.status === 'final').length;
      console.log(`[BracketUpdater] Updated ${updatedCount} game(s). ${finalCount}/63 complete. Scores recalculated for ${entries.length} entries.`);

      // Check if tournament is now complete
      if (finalCount === 63) {
        await bracketDb.updateTournament(tournament.id, { status: 'completed' });
        console.log('[BracketUpdater] 🏆 Tournament complete!');
      }
    }
  } catch (err) {
    console.error('[BracketUpdater] Poll error:', err.message);
  } finally {
    isRunning = false;
  }
}

/**
 * Start the bracket updater polling loop.
 */
function startBracketUpdater() {
  if (pollTimer) return;
  pollTimer = setInterval(pollAndUpdate, POLL_INTERVAL);
  console.log(`   🏀 Bracket auto-updater started (${POLL_INTERVAL / 1000}s interval)`);
  // Run once immediately
  pollAndUpdate();
}

/**
 * Stop the bracket updater.
 */
function stopBracketUpdater() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log('[BracketUpdater] Stopped');
  }
}

module.exports = { startBracketUpdater, stopBracketUpdater, pollAndUpdate };
