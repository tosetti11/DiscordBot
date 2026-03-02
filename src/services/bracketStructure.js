/**
 * NCAA March Madness Bracket Structure
 * UMD module — works in both Node.js and browser.
 * Defines 63-game bracket, game numbering, seed matchups, and scoring.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.BracketStructure = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  const REGIONS = ['East', 'West', 'South', 'Midwest'];

  const ROUND_NAMES = {
    1: 'Round of 64', 2: 'Round of 32', 3: 'Sweet 16',
    4: 'Elite 8', 5: 'Final Four', 6: 'Championship',
  };

  const ROUND_SHORT = { 1: 'R64', 2: 'R32', 3: 'S16', 4: 'E8', 5: 'F4', 6: 'CHAMP' };

  const STANDARD_SCORING = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16, 6: 32 };
  const MAX_SCORE = 192; // 32+32+32+32+32+32

  // Standard NCAA R1 seed matchups (array index = local game 0-7)
  const R1_SEED_MATCHUPS = [
    [1, 16], [8, 9], [5, 12], [4, 13],
    [6, 11], [3, 14], [7, 10], [2, 15],
  ];

  /**
   * Build 63-game bracket structure.
   * Numbering:
   *   East 1-15, West 16-30, South 31-45, Midwest 46-60
   *   Final Four 61-62, Championship 63
   */
  function buildBracketStructure() {
    const games = {};

    for (let r = 0; r < 4; r++) {
      const off = r * 15;
      const region = REGIONS[r];

      // R1: 8 games
      for (let i = 0; i < 8; i++) {
        games[off + i + 1] = {
          gameNumber: off + i + 1, round: 1, region,
          topSeed: R1_SEED_MATCHUPS[i][0], bottomSeed: R1_SEED_MATCHUPS[i][1],
          feederTop: null, feederBottom: null,
          advancesTo: off + 9 + Math.floor(i / 2),
          position: i % 2 === 0 ? 'top' : 'bottom',
        };
      }

      // R2: 4 games
      for (let i = 0; i < 4; i++) {
        games[off + 9 + i] = {
          gameNumber: off + 9 + i, round: 2, region,
          topSeed: null, bottomSeed: null,
          feederTop: off + 1 + i * 2, feederBottom: off + 2 + i * 2,
          advancesTo: off + 13 + Math.floor(i / 2),
          position: i % 2 === 0 ? 'top' : 'bottom',
        };
      }

      // S16: 2 games
      for (let i = 0; i < 2; i++) {
        games[off + 13 + i] = {
          gameNumber: off + 13 + i, round: 3, region,
          topSeed: null, bottomSeed: null,
          feederTop: off + 9 + i * 2, feederBottom: off + 10 + i * 2,
          advancesTo: off + 15,
          position: i === 0 ? 'top' : 'bottom',
        };
      }

      // E8: 1 game
      games[off + 15] = {
        gameNumber: off + 15, round: 4, region,
        topSeed: null, bottomSeed: null,
        feederTop: off + 13, feederBottom: off + 14,
        advancesTo: r < 2 ? 61 : 62,
        position: r % 2 === 0 ? 'top' : 'bottom',
      };
    }

    // Final Four
    games[61] = {
      gameNumber: 61, round: 5, region: null,
      topSeed: null, bottomSeed: null,
      feederTop: 15, feederBottom: 30,
      advancesTo: 63, position: 'top',
    };
    games[62] = {
      gameNumber: 62, round: 5, region: null,
      topSeed: null, bottomSeed: null,
      feederTop: 45, feederBottom: 60,
      advancesTo: 63, position: 'bottom',
    };

    // Championship
    games[63] = {
      gameNumber: 63, round: 6, region: null,
      topSeed: null, bottomSeed: null,
      feederTop: 61, feederBottom: 62,
      advancesTo: null, position: null,
    };

    return games;
  }

  const BRACKET = buildBracketStructure();

  function getRegionGames(region) {
    return Object.values(BRACKET).filter(g => g.region === region).map(g => g.gameNumber).sort((a, b) => a - b);
  }

  function getRoundGames(round) {
    return Object.values(BRACKET).filter(g => g.round === round).map(g => g.gameNumber).sort((a, b) => a - b);
  }

  /** Get all downstream game numbers that depend on this game's winner */
  function getDownstreamGames(gameNumber) {
    const downstream = [];
    let cur = BRACKET[gameNumber]?.advancesTo;
    while (cur) {
      downstream.push(cur);
      cur = BRACKET[cur]?.advancesTo;
    }
    return downstream;
  }

  /** Get the two teams that should appear in a game based on seeding + picks */
  function getTeamsForGame(gameNumber, teamsMap, picks) {
    const g = BRACKET[gameNumber];
    if (!g) return { top: null, bottom: null };

    if (g.round === 1) {
      const top = teamsMap[`${g.region}-${g.topSeed}`] || null;
      const bottom = teamsMap[`${g.region}-${g.bottomSeed}`] || null;
      return { top, bottom };
    }

    const top = picks[g.feederTop] ? teamsMap[`id-${picks[g.feederTop]}`] || null : null;
    const bottom = picks[g.feederBottom] ? teamsMap[`id-${picks[g.feederBottom]}`] || null : null;
    return { top, bottom };
  }

  /**
   * Calculate score for picks against results
   * @param {Object} picks - { gameNumber: teamId }
   * @param {Object} results - { gameNumber: winnerId }
   * @param {Object} scoring - { round: points }
   */
  function calculateScore(picks, results, scoring) {
    scoring = scoring || STANDARD_SCORING;
    let score = 0, correct = 0, total = 0;
    const byRound = {};

    for (const gn of Object.keys(results)) {
      const winnerId = results[gn];
      if (!winnerId) continue;
      const game = BRACKET[gn];
      if (!game) continue;

      total++;
      const pts = scoring[game.round] || 0;
      if (!byRound[game.round]) byRound[game.round] = { correct: 0, total: 0, points: 0 };
      byRound[game.round].total++;

      if (picks[gn] && String(picks[gn]) === String(winnerId)) {
        score += pts;
        correct++;
        byRound[game.round].correct++;
        byRound[game.round].points += pts;
      }
    }
    return { score, correct, total, byRound };
  }

  /** Calculate max possible remaining score */
  function calculateMaxPossible(picks, results, eliminatedIds, scoring) {
    scoring = scoring || STANDARD_SCORING;
    const elim = new Set((eliminatedIds || []).map(String));
    let max = 0;
    for (let gn = 1; gn <= 63; gn++) {
      const game = BRACKET[gn];
      const pts = scoring[game.round] || 0;
      if (results[gn]) {
        if (picks[gn] && String(picks[gn]) === String(results[gn])) max += pts;
      } else {
        if (picks[gn] && !elim.has(String(picks[gn]))) max += pts;
      }
    }
    return max;
  }

  return {
    REGIONS, ROUND_NAMES, ROUND_SHORT, STANDARD_SCORING, MAX_SCORE,
    R1_SEED_MATCHUPS, BRACKET,
    getRegionGames, getRoundGames, getDownstreamGames, getTeamsForGame,
    calculateScore, calculateMaxPossible,
  };
});
