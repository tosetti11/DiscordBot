require('dotenv').config();
const { Client, GatewayIntentBits, Collection, Events, PermissionsBitField } = require('discord.js');

// Import commands
const enterbet = require('./commands/betting/enterbet');
const closebet = require('./commands/betting/closebet');
const mybets = require('./commands/betting/mybets');
const mystats = require('./commands/betting/mystats');
const leaderboard = require('./commands/betting/leaderboard');
const viewbets = require('./commands/betting/viewbets');
const deletebet = require('./commands/betting/deletebet');
const editbet = require('./commands/betting/editbet');
const advancedstats = require('./commands/betting/advancedstats');
const whaledick = require('./commands/betting/whaledick');
const retrobet = require('./commands/betting/retrobet');
const mlblive = require('./commands/betting/mlblive');
const help = require('./commands/general/help');
const convertodds = require('./commands/general/convertodds');
const reminder = require('./commands/general/reminder');
const announce = require('./commands/general/announce');
const follow = require('./commands/general/follow');
const profile = require('./commands/general/profile');
const remindersDb = require('./database/reminders');
const scoreboardDb = require('./database/scoreboards');
const espn = require('./services/espn');
const { generateScoreboardImage } = require('./utils/scoreboardImage');
const { createWebServer, setDiscordClient } = require('./web/server');
const { startBracketUpdater } = require('./services/bracketUpdater');
const roleManager = require('./services/roleManager');
const aiPickService = require('./services/aiPicks');
const golfService = require('./services/golfRoundTotals');
const mlbAnalysis = require('./services/mlbAnalysis');
const streakService = require('./services/streakService');

// ── Scoreboard helpers ──
function findPlayer(players, playerName) {
  if (!players || !playerName) return null;
  const norm = playerName.toLowerCase().replace(/[^a-z ]/g, '').trim();
  // Try exact normalized name match
  if (players[norm]) return players[norm];
  // Try partial match
  for (const key of Object.keys(players)) {
    if (typeof key === 'string' && key.includes(norm)) return players[key];
    if (typeof key === 'string' && norm.includes(key)) return players[key];
  }
  return null;
}

function getStatStatus(direction, line, current, isGameOver) {
  if (direction === 'over') {
    if (current > line) return 'hit';
    if (isGameOver) return 'missed';
    if (current >= line * 0.8) return 'close';
    return 'tracking';
  } else {
    if (isGameOver && current < line) return 'hit';
    if (isGameOver) return 'missed';
    if (current > line) return 'missed';
    if (current >= line * 0.8) return 'close';
    return 'tracking';
  }
}

// Create Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
  ],
});

// Register commands in a collection
client.commands = new Collection();
const commandModules = [enterbet, closebet, mybets, mystats, leaderboard, viewbets, deletebet, editbet, advancedstats, whaledick, retrobet, mlblive, help, convertodds, reminder, announce, follow, profile];
for (const mod of commandModules) {
  client.commands.set(mod.command.name, mod);
}

// ─── Ready Event ───
client.once(Events.ClientReady, (c) => {
  console.log(`\n👑 GK | Sports Betting Tracker is online!`);
  console.log(`   Logged in as: ${c.user.tag}`);
  console.log(`   Serving ${c.guilds.cache.size} server(s)`);
  console.log(`   Commands: ${client.commands.size} registered\n`);

  // Set bot status
  client.user.setPresence({
    activities: [{ name: '/enterbet to place a bet', type: 3 }], // "Watching"
    status: 'online',
  });

  // ─── Reminder Scheduler ───
  // Check for due reminders every 30 seconds
  setInterval(async () => {
    try {
      const due = await remindersDb.getDueReminders();
      for (const r of due) {
        await reminder.fireReminder(client, r);
      }
    } catch (err) {
      console.error('[Reminder Scheduler] Error:', err.message);
    }
  }, 30_000);
  console.log('   ⏰ Reminder scheduler started (30s interval)');

  // ─── Bracket Auto-Updater ───
  // Polls ESPN every 2 minutes for NCAA tournament results
  startBracketUpdater();

  // ─── Prop Picks Auto-Resolver ───
  // Resolves yesterday's prop picks every 5 minutes (checks ESPN box scores)
  const propPicksDb = require('./database/propPicks');
  const nbaProps = require('./services/nbaProps');

  setInterval(async () => {
    try {
      // Resolve yesterday's picks
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().slice(0, 10);

      const unresolved = await propPicksDb.getUnresolvedPicks(dateStr);
      if (unresolved.length === 0) return;

      const resolutions = await nbaProps.resolvePicksFromESPN(unresolved);
      if (resolutions.length > 0) {
        const result = await propPicksDb.resolvePickBatch(resolutions);
        const count = typeof result === 'object' ? result.resolved : result;
        const dnps = typeof result === 'object' ? result.dnpCount : 0;
        console.log(`[Props Resolver] Resolved ${count}/${unresolved.length} picks for ${dateStr}${dnps ? ` (${dnps} DNP)` : ''}`);
      }
    } catch (err) {
      console.error('[Props Resolver] Error:', err.message);
    }
  }, 5 * 60_000); // 5 minutes
  console.log('   🏀 Prop picks auto-resolver started (5min interval)');

  // ─── Game Picks Auto-Resolver ───
  // Resolves yesterday's game picks every 5 minutes (checks ESPN final scores)
  const gamePicksDb = require('./database/gamePicksDb');
  const nbaGamePicks = require('./services/nbaGamePicks');

  setInterval(async () => {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().slice(0, 10);

      const unresolved = await gamePicksDb.getUnresolvedPicks(dateStr);
      if (unresolved.length === 0) return;

      const resolutions = await nbaGamePicks.resolveGamePicksFromESPN(unresolved);
      if (resolutions.length > 0) {
        const result = await gamePicksDb.resolvePickBatch(resolutions);
        const count = typeof result === 'object' ? result.resolved : result;
        console.log(`[GamePicks Resolver] Resolved ${count}/${unresolved.length} game picks for ${dateStr}`);
      }
    } catch (err) {
      console.error('[GamePicks Resolver] Error:', err.message);
    }
  }, 5 * 60_000); // 5 minutes
  console.log('   🏀 Game picks auto-resolver started (5min interval)');

  // ─── Role Manager ───
  // Setup roles and assign manual roles on startup, then recalculate every 30 min
  const guildId = process.env.DISCORD_GUILD_ID;
  if (guildId) {
    setTimeout(async () => {
      try {
        const guild = await client.guilds.fetch(guildId);
        await roleManager.setupRoles(guild);
        await roleManager.assignManualRoles(guild);
        await roleManager.recalculateRoles(guild);
        console.log('   🏅 Role manager initialized');
      } catch (err) {
        console.error('[RoleManager] Init error:', err.message);
      }
    }, 5000); // 5s delay to let bot fully connect

    setInterval(async () => {
      try {
        const guild = await client.guilds.fetch(guildId);
        await roleManager.recalculateRoles(guild);
      } catch (err) {
        console.error('[RoleManager] Recalculation error:', err.message);
      }
    }, 30 * 60_000); // 30 minutes
  }

  // ─── Live Bet Tracker & Auto-Close System ───
  // Polls ESPN for live game data, auto-resolves bets, sends game start notifications
  const db = require('./database/queries');
  const { generateBetCardImage } = require('./utils/betCardImage');
  const { supabase: supa } = require('./config/supabase');

  // Polling tier intervals
  const FAST_INTERVAL = 30_000;    // 30s — team game bets (NBA, NFL, NHL, etc.)
  const STANDARD_INTERVAL = 30_000; // 30s — player props
  const SLOW_INTERVAL = 30_000;    // 30s — card updates
  const AUTO_CLOSE_DELAY = 60 * 60_000; // 1 hour
  const SITE_OWNER_ID = '1338301556973633577';

  // Parse event_start_time → YYYYMMDD for ESPN scoreboard lookup
  // Handles ISO dates and "Fri Apr 10 9:41 PM ET" human-readable format
  const MONTH_NUM = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
  function eventDateStr(eventStartTime, createdAt) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
    if (!eventStartTime) {
      if (createdAt) {
        const d = new Date(createdAt);
        if (!isNaN(d.getTime())) return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
      }
      return today;
    }
    // Try ISO parse first
    const iso = new Date(eventStartTime);
    if (!isNaN(iso.getTime())) {
      return iso.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
    }
    // Extract month+day directly from "Fri Apr 10 ..." — the date in the text IS the ET date
    const m = eventStartTime.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\b/i);
    if (m) {
      const mon = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
      const month = MONTH_NUM[mon];
      const day = m[2].padStart(2, '0');
      if (month) return `${new Date().getFullYear()}${month}${day}`;
    }
    // Unparseable eventStartTime — fall back to createdAt date, then today
    if (createdAt) {
      const d = new Date(createdAt);
      if (!isNaN(d.getTime())) return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
    }
    return today;
  }

  // Track which bets we've already notified about game start
  const startNotifiedCache = new Set();

  // ── Game Start Notification Poller (every 60s) ──
  setInterval(async () => {
    try {
      // Get all open bets with ESPN game IDs that haven't been start-notified
      const { data: openBets } = await supa
        .from('bets')
        .select('id, discord_id, pick, espn_game_id, sport, start_notified, event_start_time, bet_type, slip_number')
        .eq('status', 'open')
        .eq('start_notified', false)
        .or('espn_game_id.not.is.null,bet_type.eq.parlay');

      if (!openBets?.length) return;

      // Also check parlay legs for games about to start
      const { data: openLegs } = await supa
        .from('parlay_legs')
        .select('id, bet_id, pick, espn_game_id, sport, event_start_time')
        .eq('status', 'open')
        .not('espn_game_id', 'is', null);

      // Collect unique sport/gameId combos to check, with dates
      const gameChecks = new Map();
      for (const bet of openBets) {
        if (bet.espn_game_id && bet.sport) {
          const key = `${bet.sport}:${bet.espn_game_id}`;
          if (!gameChecks.has(key)) gameChecks.set(key, { sport: bet.sport, gameId: bet.espn_game_id, eventStartTime: bet.event_start_time, createdAt: bet.created_at });
        }
      }
      for (const leg of (openLegs || [])) {
        if (leg.espn_game_id && leg.sport) {
          const key = `${leg.sport}:${leg.espn_game_id}`;
          if (!gameChecks.has(key)) gameChecks.set(key, { sport: leg.sport, gameId: leg.espn_game_id, eventStartTime: leg.event_start_time, createdAt: leg.created_at });
        }
      }

      // Batch-fetch scoreboards by sport+date
      const sportDateSet = new Set();
      for (const { sport, eventStartTime, createdAt } of gameChecks.values()) {
        sportDateSet.add(`${sport}:${eventDateStr(eventStartTime, createdAt)}`);
      }
      // Always include today and yesterday ET per sport to handle midnight crossings.
      // Compute offset relative to current ET date (not UTC day) to avoid UTC/ET skew.
      const _etDateN = (offset) => { const [y,m,d] = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).split('-').map(Number); const s = new Date(y, m-1, d+offset); return s.getFullYear()+String(s.getMonth()+1).padStart(2,'0')+String(s.getDate()).padStart(2,'0'); };
      for (const { sport } of gameChecks.values()) {
        if (sport && sport !== 'golf_pga') {
          sportDateSet.add(`${sport}:${_etDateN(0)}`);
          sportDateSet.add(`${sport}:${_etDateN(-1)}`);
        }
      }
      const notifGames = [];
      for (const key of sportDateSet) {
        const [sport, dateStr] = key.split(':');
        try {
          if (sport === 'golf_pga') {
            // Golf events are filtered out by getTodaysGames (no home/away) — fetch directly
            // Check both parent bets AND parlay legs for golf game IDs
            const allGolfItems = [
              ...openBets.filter(b => b.sport === 'golf_pga' && b.espn_game_id),
              ...(openLegs || []).filter(l => l.sport === 'golf_pga' && l.espn_game_id),
            ];
            for (const item of allGolfItems) {
              if (!notifGames.find(g => g.id === item.espn_game_id)) {
                const golfGame = await espn.getGolfEventStatus(item.espn_game_id, dateStr);
                if (golfGame) notifGames.push(golfGame);
              }
            }
          } else {
            const games = await espn.getTodaysGames(sport, dateStr);
            notifGames.push(...games);
          }
        } catch (e) {}
      }

      // Check for games that are now live
      for (const bet of openBets) {
        if (startNotifiedCache.has(bet.id)) continue;
        const game = notifGames.find(g => g.id === bet.espn_game_id);
        if (!game) continue;

        if (game.state === 'in') {
          // Game is LIVE — notify user
          startNotifiedCache.add(bet.id);
          try {
            await supa.from('bets').update({ start_notified: true }).eq('id', bet.id);
            const user = await client.users.fetch(bet.discord_id).catch(() => null);
            if (user) {
              await user.send(`🔴 **LIVE** — Your bet \`${bet.slip_number}\` is in play!\n> ${bet.pick}`).catch(() => {});
            }
          } catch (e) {
            console.error('[LiveTracker] Start notification error:', e.message);
          }
        }
      }

      // Check parlays: if any leg's game is live, mark the parlay as start_notified
      const parlayBets = openBets.filter(b => b.bet_type === 'parlay' && !startNotifiedCache.has(b.id));
      if (parlayBets.length > 0) {
        const parlayIds = parlayBets.map(b => b.id);
        const { data: parlayLegs } = await supa
          .from('parlay_legs')
          .select('bet_id, espn_game_id, sport, event_start_time')
          .in('bet_id', parlayIds)
          .not('espn_game_id', 'is', null);

        // Build map of bet_id → legs
        const legsByBet = {};
        for (const leg of (parlayLegs || [])) {
          if (!legsByBet[leg.bet_id]) legsByBet[leg.bet_id] = [];
          legsByBet[leg.bet_id].push(leg);
        }

        for (const bet of parlayBets) {
          const legs = legsByBet[bet.id] || [];
          let anyLive = false;
          for (const leg of legs) {
            const game = notifGames.find(g => g.id === leg.espn_game_id);
            if (game && (game.state === 'in' || game.state === 'post')) {
              anyLive = true;
              break;
            }
          }
          if (anyLive) {
            startNotifiedCache.add(bet.id);
            try {
              await supa.from('bets').update({ start_notified: true }).eq('id', bet.id);
              const user = await client.users.fetch(bet.discord_id).catch(() => null);
              if (user) {
                await user.send(`🔴 **LIVE** — Your parlay \`${bet.slip_number}\` is in play!`).catch(() => {});
              }
            } catch (e) {
              console.error('[LiveTracker] Parlay start notification error:', e.message);
            }
          }
        }
      }
    } catch (err) {
      console.error('[LiveTracker] Game start check error:', err.message);
    }
  }, 60_000);
  console.log('   🔔 Game start notification poller started (60s interval)');

  // ── Live Card Update Poller (every 5min) ──
  // Refreshes card images for open bets whose games are live
  const cardUpdateTracker = new Map(); // betId → last card hash (to skip no-change edits)
  const cardFinalRendered = new Set(); // betIds that have been rendered in final state — skip forever
  setInterval(async () => {
    try {
      // Get open bets with ESPN game IDs and message IDs (so we can edit)
      // Include both single bets (espn_game_id set) and parlays (espn_game_id on legs)
      const { data: liveBets } = await supa
        .from('bets')
        .select('*, parlay_legs(*)')
        .eq('status', 'open')
        .not('message_id', 'is', null)
        .eq('start_notified', true)
        .or('espn_game_id.not.is.null,bet_type.eq.parlay,match_player_a.not.is.null');

      if (!liveBets?.length) return;

      for (const bet of liveBets) {
        try {
          if (cardFinalRendered.has(bet.id)) continue; // Already rendered in final state
          // Check if game is still live
          const isGolf = bet.sport?.startsWith('golf');
          const isParlay = bet.bet_type === 'parlay';
          let isLive = false;
          let allGamesPost = true; // Track if every game is 'post' (final)

          if (isParlay) {
            // For parlays, check each leg's game status and build a composite hash
            const legs = bet.parlay_legs || [];
            const hashParts = [];
            for (const leg of legs) {
              const legIsGolf = leg.sport === 'golf_pga' || leg.sport?.startsWith('golf');
              const legIs2Ball = legIsGolf && ['2ball', '3ball'].includes(leg.wager_type) && leg.match_player_a && leg.match_player_b;

              // 2ball/3ball parlay legs — get match-play data directly (no espn_game_id needed)
              if (legIs2Ball) {
                try {
                  const mpData = await espn.getGolf2BallLive({
                    playerA: leg.match_player_a, playerA2: leg.match_player_a2 || null,
                    playerB: leg.match_player_b, playerB2: leg.match_player_b2 || null,
                    playerC: leg.match_player_c || null, roundNum: leg.golf_round || null,
                    holeNum: leg.golf_hole || null,
                  });
                  if (mpData && (mpData.overallStatus === 'in' || mpData.overallStatus === 'post')) {
                    if (mpData.overallStatus !== 'post') allGamesPost = false;
                    else allGamesPost = allGamesPost && true;
                    const hashPart = `2ball:${leg.id}:${mpData.maxHoles}:${mpData.groupA.roundScore}:${mpData.groupB.roundScore}:${mpData.matchStatus?.label}:${mpData.holeData?.holeWinner ?? ''}`;
                    hashParts.push(hashPart);
                    if (mpData.overallStatus === 'in') isLive = true;
                  }
                } catch {}
                continue;
              }

              if (!leg.espn_game_id) { allGamesPost = false; continue; }
              const dateStr = eventDateStr(leg.event_start_time || bet.event_start_time, leg.created_at || bet.created_at);
              let game;
              if (legIsGolf) {
                // Golf events are filtered out by getTodaysGames (no home/away) — fetch directly
                game = await espn.getGolfEventStatus(leg.espn_game_id, dateStr);
              } else {
                const games = await espn.getTodaysGames(leg.sport, dateStr);
                game = games.find(g => g.id === leg.espn_game_id);
              }
              if (game && (game.state === 'in' || game.state === 'post')) {
                if (game.state !== 'post') allGamesPost = false;
                let hashPart = `${leg.espn_game_id}:${game.home?.score}:${game.away?.score}:${game.state}`;
                // Golf parlay legs: use player round data for hash (game scores are dummy 0s)
                if (legIsGolf && leg.player_name) {
                  try {
                    const golfData = await espn.getGolfPlayerRound(leg.player_name, leg.golf_round || null);
                    if (golfData) {
                      hashPart = `${leg.espn_game_id}:golf:${golfData.holesCompleted}:${golfData.roundScore}:${golfData.roundStatus}`;
                      if (golfData.roundStatus !== 'post') allGamesPost = false;
                      else allGamesPost = allGamesPost && true;
                    }
                  } catch {}
                }
                // Include prop stat + batting line in hash (non-golf sports only)
                if (!legIsGolf && leg.player_name && leg.espn_game_id) {
                  try {
                    const summary = await espn.getGameSummary(leg.sport, leg.espn_game_id);
                    const player = summary ? espn.findPlayer(summary.players, leg.player_name) : null;
                    if (player?.stats) {
                      // Batting line hash (h + ab changes each AB)
                      if (player.stats['h'] !== undefined) hashPart += `:bl${player.stats['h']}-${player.stats['ab'] || 0}`;
                      // Prop stat hash
                      if (leg.wager_type === 'prop' && leg.prop_description) {
                        const parsed = espn.parsePropDescription(leg.prop_description, leg.sport);
                        if (parsed) {
                          let sv = player.stats[parsed.espnKey];
                          if (typeof sv === 'string' && /^\d+-\d+$/.test(sv)) sv = sv.split('-')[0];
                          hashPart += `:ps${sv ?? ''}`;
                        }
                      }
                    }
                  } catch {}
                }
                hashParts.push(hashPart);
                if (game.state === 'in') isLive = true;
              } else {
                // Game not started yet (pre) or not found — this leg is not finished
                allGamesPost = false;
              }
            }
            if (hashParts.length) {
              const hash = hashParts.join('|');
              if (cardUpdateTracker.get(bet.id) === hash) {
                if (allGamesPost) cardFinalRendered.add(bet.id);
                continue;
              }
              cardUpdateTracker.set(bet.id, hash);
              // At least one game changed — regenerate
            } else {
              continue; // No legs have live/post data yet
            }
          } else if (isGolf) {
            const is2Ball = ['2ball', '3ball'].includes(bet.wager_type) && bet.match_player_a && bet.match_player_b;
            if (is2Ball) {
              // 2ball/3ball matchup bets — use match-play live data
              const mpData = await espn.getGolf2BallLive({
                playerA: bet.match_player_a, playerA2: bet.match_player_a2 || null,
                playerB: bet.match_player_b, playerB2: bet.match_player_b2 || null,
                playerC: bet.match_player_c || null, roundNum: bet.golf_round || null,
                holeNum: bet.golf_hole || null,
              }).catch(() => null);
              if (mpData && (mpData.overallStatus === 'in' || mpData.overallStatus === 'post')) {
                if (mpData.overallStatus !== 'post') allGamesPost = false;
                const hash = `mp:${mpData.maxHoles}:${mpData.groupA.roundScore}:${mpData.groupB.roundScore}:${mpData.matchStatus?.label}:${mpData.overallStatus}:${mpData.holeData?.holeWinner ?? ''}`;
                if (cardUpdateTracker.get(bet.id) === hash) {
                  if (allGamesPost) cardFinalRendered.add(bet.id);
                  continue;
                }
                cardUpdateTracker.set(bet.id, hash);
                isLive = true;
                console.log(`[CardUpdate] ${bet.slip_number} 2ball update: thru ${mpData.maxHoles}, ${mpData.matchStatus?.label}`);
              }
            } else {
              const golfData = await espn.getGolfPlayerRound(bet.player_name, bet.golf_round || null);
              if (golfData && (golfData.roundStatus === 'in' || golfData.roundStatus === 'post')) {
                if (golfData.roundStatus !== 'post') allGamesPost = false;
                // Build a quick hash to avoid re-editing when nothing changed
                const hash = `${golfData.holesCompleted}:${golfData.roundScore}:${golfData.position}`;
                if (cardUpdateTracker.get(bet.id) === hash) {
                  if (allGamesPost) cardFinalRendered.add(bet.id);
                  console.log(`[CardUpdate] ${bet.slip_number} no change (${hash}), skipping`);
                  continue;
                }
                cardUpdateTracker.set(bet.id, hash);
                isLive = true;
                console.log(`[CardUpdate] ${bet.slip_number} golf update: thru ${golfData.holesCompleted}, score ${golfData.roundScore}`);
              }
            }
          } else {
            const dateStr = eventDateStr(bet.event_start_time, bet.created_at);
            const game = await espn.findGameById(bet.sport, bet.espn_game_id, dateStr);
            if (game && (game.state === 'in' || game.state === 'post')) {
              if (game.state !== 'post') allGamesPost = false;
              let hash = `${game.home?.score}:${game.away?.score}:${game.state}:${game.detail || ''}`;
              // Include prop stat + batting line in hash
              if (bet.player_name && bet.espn_game_id) {
                try {
                  const summary = await espn.getGameSummary(bet.sport, bet.espn_game_id);
                  const player = summary ? espn.findPlayer(summary.players, bet.player_name) : null;
                  if (player?.stats) {
                    if (player.stats['h'] !== undefined) hash += `:bl${player.stats['h']}-${player.stats['ab'] || 0}`;
                    if (bet.wager_type === 'prop' && bet.prop_description) {
                      const parsed = espn.parsePropDescription(bet.prop_description, bet.sport);
                      if (parsed) {
                        let sv = player.stats[parsed.espnKey];
                        if (typeof sv === 'string' && /^\d+-\d+$/.test(sv)) sv = sv.split('-')[0];
                        hash += `:ps${sv ?? ''}`;
                      }
                    }
                  }
                } catch {}
              }
              if (cardUpdateTracker.get(bet.id) === hash) {
                if (allGamesPost) cardFinalRendered.add(bet.id);
                continue;
              }
              cardUpdateTracker.set(bet.id, hash);
              isLive = true;
            }
          }

          if (!isLive && !isParlay) continue;

          // Re-generate card image
          const fullBet = await db.getBet(bet.id);
          if (!fullBet || fullBet.status !== 'open') continue;

          const guild = client.guilds.cache.get(bet.guild_id);
          let displayName = bet.discord_id;
          if (guild) {
            const member = await guild.members.fetch(bet.discord_id).catch(() => null);
            displayName = member?.displayName || bet.discord_id;
          }
          const avatar = (await client.users.fetch(bet.discord_id).catch(() => null))?.displayAvatarURL() || '';

          const imgBuffer = await generateBetCardImage(fullBet, displayName, avatar);
          const { AttachmentBuilder } = require('discord.js');
          const attachment = new AttachmentBuilder(imgBuffer, { name: 'bet-card.png' });

          const channel = await client.channels.fetch(bet.channel_id).catch(() => null);
          if (channel && bet.message_id) {
            const msg = await channel.messages.fetch(bet.message_id).catch(() => null);
            if (msg) {
              await msg.edit({ files: [attachment] }).catch((e) => {
                console.error(`[CardUpdate] Discord edit failed for ${bet.slip_number}:`, e.message);
              });
              console.log(`[CardUpdate] ✅ Updated card for ${bet.slip_number}`);
            } else {
              console.log(`[CardUpdate] Could not fetch message ${bet.message_id} for ${bet.slip_number}`);
            }
          } else {
            console.log(`[CardUpdate] Could not fetch channel ${bet.channel_id} for ${bet.slip_number}`);
          }

          // Also update mirror message (king/community open slips)
          if (bet.mirror_channel_id && bet.mirror_message_id) {
            try {
              const mirrorAttachment = new AttachmentBuilder(imgBuffer, { name: 'bet-card.png' });
              const mirrorCh = await client.channels.fetch(bet.mirror_channel_id).catch(() => null);
              if (mirrorCh) {
                const mirrorMsg = await mirrorCh.messages.fetch(bet.mirror_message_id).catch(() => null);
                if (mirrorMsg) {
                  await mirrorMsg.edit({ files: [mirrorAttachment] }).catch((e) => {
                    console.error(`[CardUpdate] Mirror edit failed for ${bet.slip_number}:`, e.message);
                  });
                  console.log(`[CardUpdate] ✅ Updated mirror for ${bet.slip_number}`);
                }
              }
            } catch (e) {}
          }

          // Mark as final-rendered so we stop checking this bet
          if (allGamesPost) {
            cardFinalRendered.add(bet.id);
            console.log(`[CardUpdate] 🏁 ${bet.slip_number} all games final — no more updates`);
          }
        } catch (e) {
          console.error(`[CardUpdate] Error updating ${bet.slip_number}:`, e.message);
        }
      }

      // ── AI Pick of the Day live updates ──
      try {
        const aiPicksDb = require('./database/aiPicks');
        const { generateAiPickCardImage } = require('./utils/aiPickCardImage');
        const pendingPicks = await aiPicksDb.getPendingAiPicks();

        for (const pick of pendingPicks) {
          if (!pick.espn_game_id || !pick.espn_sport || !pick.message_id) continue;

          try {
            const dateStr = eventDateStr(pick.event_start_time || pick.pick_date, pick.created_at);
            const game = await espn.findGameById(pick.espn_sport, pick.espn_game_id, dateStr);
            if (!game || game.state === 'pre') continue;

            // Build live score data
            const liveScore = {
              homeAbbr: game.home?.abbreviation || game.home?.name || '',
              awayAbbr: game.away?.abbreviation || game.away?.name || '',
              homeScore: game.home?.score ?? 0,
              awayScore: game.away?.score ?? 0,
              state: game.state,
              detail: game.detail || '',
            };

            const hash = `ai:${liveScore.awayScore}:${liveScore.homeScore}:${game.state}`;
            if (cardUpdateTracker.get(pick.id) === hash) continue;
            cardUpdateTracker.set(pick.id, hash);

            // Get record data for card
            const record = await aiPicksDb.getAiPickRecord(pick.guild_id);
            const streak = await aiPicksDb.getAiPickStreak(pick.guild_id);
            const totalUnits = await aiPickService.calculateTotalUnits(pick.guild_id);

            const imgBuffer = await generateAiPickCardImage(pick, record, streak, totalUnits, liveScore);
            const { AttachmentBuilder } = require('discord.js');
            const attachment = new AttachmentBuilder(imgBuffer, { name: 'ai-pick.png' });

            // Update original message
            const channel = await client.channels.fetch(pick.channel_id).catch(() => null);
            if (channel && pick.message_id) {
              const msg = await channel.messages.fetch(pick.message_id).catch(() => null);
              if (msg) {
                await msg.edit({ files: [attachment] }).catch((e) => {
                  console.error(`[CardUpdate] AI pick edit failed:`, e.message);
                });
                console.log(`[CardUpdate] ✅ Updated AI pick (${liveScore.awayAbbr} ${liveScore.awayScore}-${liveScore.homeScore} ${liveScore.homeAbbr})`);
              }
            }

            // Update mirror message
            if (pick.mirror_channel_id && pick.mirror_message_id) {
              try {
                const mirrorAttachment = new AttachmentBuilder(imgBuffer, { name: 'ai-pick.png' });
                const mirrorCh = await client.channels.fetch(pick.mirror_channel_id).catch(() => null);
                if (mirrorCh) {
                  const mirrorMsg = await mirrorCh.messages.fetch(pick.mirror_message_id).catch(() => null);
                  if (mirrorMsg) {
                    await mirrorMsg.edit({ files: [mirrorAttachment] }).catch(() => {});
                    console.log(`[CardUpdate] ✅ Updated AI pick mirror`);
                  }
                }
              } catch (e) {}
            }
          } catch (e) {
            console.error(`[CardUpdate] AI pick error:`, e.message);
          }
        }
      } catch (e) {
        console.error('[CardUpdate] AI picks section error:', e.message);
      }
    } catch (err) {
      console.error('[LiveTracker] Card update error:', err.message);
    }
  }, SLOW_INTERVAL);
  console.log('   🖼️  Live card update poller started (30s interval)');

  // ── Auto-Resolve Poller (every 30s) ──
  // Checks finished games, resolves single bets and parlay legs, sets auto-close timer
  setInterval(async () => {
    try {
      // Get open single bets with ESPN game IDs
      const { data: openSingles } = await supa
        .from('bets')
        .select('*')
        .eq('status', 'open')
        .eq('bet_type', 'single')
        .not('espn_game_id', 'is', null)
        .is('auto_close_at', null);

      // Get open parlay legs with ESPN game IDs
      const { data: openLegs } = await supa
        .from('parlay_legs')
        .select('*')
        .eq('status', 'open')
        .not('espn_game_id', 'is', null);

      // Collect unique sport+date combos so we fetch the right scoreboards
      const allItems = [...(openSingles || []), ...(openLegs || [])];
      if (allItems.length === 0) return;

      const sportDateSet = new Set();
      for (const item of allItems) {
        if (!item.sport) continue;
        sportDateSet.add(`${item.sport}:${eventDateStr(item.event_start_time, item.created_at)}`);
      }
      // Always also check today and yesterday ET for every active sport to
      // handle late-night games that cross midnight or have a mismatched date.
      const _etDate = (offset) => { const [y,m,d] = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).split('-').map(Number); const s = new Date(y, m-1, d+offset); return s.getFullYear()+String(s.getMonth()+1).padStart(2,'0')+String(s.getDate()).padStart(2,'0'); };
      const _etToday = _etDate(0), _etYday = _etDate(-1);
      for (const item of allItems) {
        if (!item.sport || item.sport === 'golf_pga') continue;
        sportDateSet.add(`${item.sport}:${_etToday}`);
        sportDateSet.add(`${item.sport}:${_etYday}`);
      }

      // Fetch scoreboards per sport+date
      const allGames = []; // flat array of all fetched games
      for (const key of sportDateSet) {
        const [sport, dateStr] = key.split(':');
        try {
          if (sport === 'golf_pga') {
            // Golf events are filtered out by getTodaysGames (no home/away) — fetch directly
            for (const item of allItems) {
              if (item.sport === 'golf_pga' && item.espn_game_id) {
                const golfGame = await espn.getGolfEventStatus(item.espn_game_id, dateStr);
                if (golfGame && !allGames.find(g => g.id === golfGame.id)) allGames.push(golfGame);
              }
            }
          } else if (sport === 'ufc' || sport === 'mma') {
            // UFC/MMA: getTodaysGames filters out fights (no homeAway labels) — use getUFCFights
            const fights = await espn.getUFCFights(dateStr);
            for (const f of fights) {
              if (!allGames.find(g => g.id === f.id)) allGames.push(f);
            }
          } else {
            const games = await espn.getTodaysGames(sport, dateStr);
            allGames.push(...games);
          }
        } catch (e) {}
      }

      // Cache game summaries (for props/HR resolution)
      const summaryCache = new Map();
      async function getSummary(sport, gameId) {
        const key = `${sport}:${gameId}`;
        if (summaryCache.has(key)) return summaryCache.get(key);
        const summary = await espn.getGameSummary(sport, gameId);
        summaryCache.set(key, summary);
        return summary;
      }

      // Cache MLB Stats API lookups
      const mlbGamePkCache = new Map();
      async function getMlbStats(bet, summary) {
        if (!['mlb', 'kbo', 'npb'].includes(bet.sport)) return summary;
        if (!bet.prop_description) return summary;
        const parsed = espn.parsePropDescription(bet.prop_description, bet.sport);
        if (!parsed || !espn.MLB_API_STATS.has(parsed.espnKey)) return summary;

        // Need MLB data for this prop
        const dateStr = eventDateStr(bet.event_start_time, bet.created_at).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
        const pkKey = `${bet.team_a}:${bet.team_b}:${dateStr}`;
        let gamePk = mlbGamePkCache.get(pkKey);
        if (gamePk === undefined) {
          gamePk = await espn.findMlbGamePk(bet.espn_game_id, dateStr, bet.team_a, bet.team_b);
          mlbGamePkCache.set(pkKey, gamePk);
        }
        if (!gamePk) return summary;

        const mlbStats = await espn.getMlbPlayerStats(gamePk, bet.player_name);
        if (mlbStats && summary) {
          summary._mlbStats = mlbStats;
        }
        return summary;
      }

      // ── Resolve single bets ──
      for (const bet of (openSingles || [])) {
        const game = allGames.find(g => g.id === bet.espn_game_id);
        if (!game) continue;

        // Golf props: resolve when the player's round is complete (not when tournament ends)
        if (bet.sport === 'golf_pga' && bet.wager_type === 'prop') {
          if (game.state === 'pre') continue; // tournament hasn't started
          const parsed = espn.parsePropDescription(bet.prop_description, bet.sport);
          if (!parsed) continue;

          if (espn.GOLF_STATS.has(parsed.espnKey)) {
            // Fetch player's round data (use bet's golf_round so R3 bets check R3, not current round)
            const roundData = await espn.getGolfPlayerRound(bet.player_name, bet.golf_round || null);
            if (!roundData || roundData.roundStatus !== 'post') continue; // round not done yet

            // Build a fake summary with the golf round score injected
            const summary = { players: {}, _golfRoundScore: roundData.roundScore };
            // Add dummy player so findPlayer succeeds
            const normName = bet.player_name.toLowerCase().replace(/[^a-z ]/g, '').trim();
            summary.players[normName] = { name: bet.player_name, stats: {} };

            const result = espn.resolveResult({
              wagerType: bet.wager_type, pick: bet.pick, teamA: bet.team_a, teamB: bet.team_b,
              spreadValue: bet.spread_value, playerName: bet.player_name,
              propDescription: bet.prop_description, sport: bet.sport, game, summary,
              period: bet.period,
            });

            if (result) {
              const autoCloseAt = new Date(Date.now() + AUTO_CLOSE_DELAY).toISOString();
              await supa.from('bets').update({
                auto_close_at: autoCloseAt,
                result_note: `Auto-resolved: ${result} (Golf R${roundData.roundNum}: ${roundData.roundScore} strokes)`,
              }).eq('id', bet.id);

              try {
                const user = await client.users.fetch(bet.discord_id).catch(() => null);
                if (user) {
                  const emoji = result === 'win' ? '✅' : result === 'loss' ? '❌' : '🔄';
                  await user.send(
                    `⛳ **Round Complete** — ${roundData.playerName} shot ${roundData.roundScore} (R${roundData.roundNum})\n${emoji} \`${bet.slip_number}\` looks like a **${result.toUpperCase()}**!\n> ${bet.pick}\n\n⏰ Auto-closing in 1 hour. Close manually with \`/closebet\` to override.`
                  ).catch(() => {});
                }
              } catch (e) {}
              console.log(`[LiveTracker] Golf bet ${bet.slip_number} auto-resolved: ${result} (R${roundData.roundNum}: ${roundData.roundScore})`);
            }
          }
          continue; // Skip normal resolution path for golf
        }

        // NRFI/YRFI can resolve mid-game (after 1st inning); props/totals/mlb_live can resolve when condition met
        const earlyResolveSingle = ['nrfi', 'yrfi', 'prop', 'homerun', 'total', 'team_total', 'mlb_live'].includes(bet.wager_type);
        if (game.state === 'pre') continue; // no games started yet
        if (game.state !== 'post' && !earlyResolveSingle) continue;

        // Get summary if needed for props/HR/mlb_live
        let summary = null;
        if (['prop', 'homerun'].includes(bet.wager_type)) {
          summary = await getSummary(bet.sport, bet.espn_game_id);
          summary = await getMlbStats(bet, summary);
        }

        // Attach MLB play-by-play data for mlb_live AB/pitch bets
        if (bet.wager_type === 'mlb_live' && bet.sport === 'mlb') {
          if (!summary) summary = {};
          const dateStr = eventDateStr(bet.event_start_time, bet.created_at).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
          const pkKey = `${bet.team_a}:${bet.team_b}:${dateStr}`;
          let gamePk = mlbGamePkCache.get(pkKey);
          if (gamePk === undefined) {
            gamePk = await espn.findMlbGamePk(bet.espn_game_id, dateStr, bet.team_a, bet.team_b);
            mlbGamePkCache.set(pkKey, gamePk);
          }
          if (gamePk) {
            const pbp = await espn.getMlbPlayByPlay(gamePk);
            if (pbp) summary._mlbPlayByPlay = pbp;
          }
        }

        const result = espn.resolveResult({
          wagerType: bet.wager_type,
          pick: bet.pick,
          teamA: bet.team_a,
          teamB: bet.team_b,
          spreadValue: bet.spread_value,
          playerName: bet.player_name,
          propDescription: bet.prop_description,
          sport: bet.sport,
          game,
          summary,
          period: bet.period,
          fightRound: bet.fight_round || null,
          fightMethod: bet.fight_method || null,
        });

        if (result) {
          // Set auto-close timer (1 hour from now)
          const autoCloseAt = new Date(Date.now() + AUTO_CLOSE_DELAY).toISOString();
          await supa.from('bets').update({
            auto_close_at: autoCloseAt,
            result_note: `Auto-resolved: ${result} (ESPN ${bet.espn_game_id})`,
          }).eq('id', bet.id);

          // Notify user
          try {
            const user = await client.users.fetch(bet.discord_id).catch(() => null);
            if (user) {
              const emoji = result === 'win' ? '✅' : result === 'loss' ? '❌' : '🔄';
              const scoreText = `${game.away.abbreviation} ${game.away.score} — ${game.home.abbreviation} ${game.home.score}`;
              await user.send(
                `🏁 **Game Over** — ${scoreText}\n${emoji} \`${bet.slip_number}\` looks like a **${result.toUpperCase()}**!\n> ${bet.pick}\n\n⏰ Auto-closing in 1 hour. Close manually with \`/closebet\` to override.`
              ).catch(() => {});
            }
          } catch (e) {}

          console.log(`[LiveTracker] Single bet ${bet.slip_number} auto-resolved: ${result}`);
        }
      }

      // ── Resolve parlay legs ──
      const parlayBetsToCheck = new Set();
      for (const leg of (openLegs || [])) {
        const game = allGames.find(g => g.id === leg.espn_game_id);
        if (!game) continue;

        // Golf parlay leg: resolve when round is complete
        if (leg.sport === 'golf_pga' && leg.wager_type === 'prop') {
          if (game.state === 'pre') continue;
          const parsed = espn.parsePropDescription(leg.prop_description, leg.sport);
          if (parsed && espn.GOLF_STATS.has(parsed.espnKey)) {
            const roundData = await espn.getGolfPlayerRound(leg.player_name, leg.golf_round || null);
            if (!roundData || roundData.roundStatus !== 'post') continue;
            const summary = { players: {}, _golfRoundScore: roundData.roundScore };
            const normName = leg.player_name.toLowerCase().replace(/[^a-z ]/g, '').trim();
            summary.players[normName] = { name: leg.player_name, stats: {} };
            const result = espn.resolveResult({
              wagerType: leg.wager_type, pick: leg.pick, teamA: leg.team_a, teamB: leg.team_b,
              spreadValue: leg.spread_value, playerName: leg.player_name,
              propDescription: leg.prop_description, sport: leg.sport, game, summary, period: leg.period,
            });
            if (result) {
              await db.updateParlayLegStatus(leg.id, result);
              parlayBetsToCheck.add(leg.bet_id);
              console.log(`[LiveTracker] Golf parlay leg ${leg.id} resolved: ${result} (R${roundData.roundNum}: ${roundData.roundScore})`);
            }
          }
          continue;
        }

        // NRFI/YRFI can resolve mid-game (after 1st inning); props/totals/mlb_live can resolve when condition met
        const earlyResolveLeg = ['nrfi', 'yrfi', 'prop', 'homerun', 'total', 'team_total', 'mlb_live'].includes(leg.wager_type);
        if (game.state === 'pre') continue;
        if (game.state !== 'post' && !earlyResolveLeg) continue;

        let summary = null;
        if (['prop', 'homerun'].includes(leg.wager_type)) {
          summary = await getSummary(leg.sport, leg.espn_game_id);
          summary = await getMlbStats(leg, summary);
        }

        // Attach MLB play-by-play data for mlb_live AB/pitch legs
        if (leg.wager_type === 'mlb_live' && leg.sport === 'mlb') {
          if (!summary) summary = {};
          const dateStr = eventDateStr(leg.event_start_time, leg.created_at).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
          const pkKey = `${leg.team_a}:${leg.team_b}:${dateStr}`;
          let gamePk = mlbGamePkCache.get(pkKey);
          if (gamePk === undefined) {
            gamePk = await espn.findMlbGamePk(leg.espn_game_id, dateStr, leg.team_a, leg.team_b);
            mlbGamePkCache.set(pkKey, gamePk);
          }
          if (gamePk) {
            const pbp = await espn.getMlbPlayByPlay(gamePk);
            if (pbp) summary._mlbPlayByPlay = pbp;
          }
        }

        const result = espn.resolveResult({
          wagerType: leg.wager_type,
          pick: leg.pick,
          teamA: leg.team_a,
          teamB: leg.team_b,
          spreadValue: leg.spread_value,
          playerName: leg.player_name,
          propDescription: leg.prop_description,
          sport: leg.sport,
          game,
          summary,
          period: leg.period,
          fightRound: leg.fight_round || null,
          fightMethod: leg.fight_method || null,
        });

        if (result) {
          await db.updateParlayLegStatus(leg.id, result);
          parlayBetsToCheck.add(leg.bet_id);
          console.log(`[LiveTracker] Parlay leg ${leg.id} resolved: ${result}`);
        }
      }

      // ── Resolve 2ball/3ball hole-score single bets ──
      const { data: open2BallSingles } = await supa
        .from('bets')
        .select('*')
        .eq('status', 'open')
        .eq('bet_type', 'single')
        .in('wager_type', ['2ball', '3ball'])
        .not('match_player_a', 'is', null)
        .not('golf_hole', 'is', null)
        .is('auto_close_at', null);

      for (const bet of (open2BallSingles || [])) {
        try {
          const mpData = await espn.getGolf2BallLive({
            playerA: bet.match_player_a, playerA2: bet.match_player_a2 || null,
            playerB: bet.match_player_b, playerB2: bet.match_player_b2 || null,
            playerC: bet.match_player_c || null, roundNum: bet.golf_round || null,
            holeNum: bet.golf_hole || null,
          });
          if (!mpData || mpData.overallStatus !== 'post') continue;

          // Hole-score bet: only resolve when the specific hole is complete
          if (!mpData.holeMode || !mpData.holeData) continue;
          const { holeWinner } = mpData.holeData;
          if (holeWinner === null) continue; // hole not yet complete
          const isTieBet = bet.team_a === 'Tie';
          let result = null;
          if (holeWinner === 'tie') result = isTieBet ? 'win' : 'push';
          else if (!isTieBet && holeWinner === 'A') result = 'win';
          else result = 'loss';

          if (result) {
            const autoCloseAt = new Date(Date.now() + AUTO_CLOSE_DELAY).toISOString();
            const noteHole = bet.golf_hole ? ` (Hole ${bet.golf_hole})` : '';
            await supa.from('bets').update({
              auto_close_at: autoCloseAt,
              result_note: `Auto-resolved: ${result}${noteHole}`,
            }).eq('id', bet.id);
            try {
              const user = await client.users.fetch(bet.discord_id).catch(() => null);
              if (user) {
                const emoji = result === 'win' ? '✅' : result === 'loss' ? '❌' : '🔄';
                const holeLabel = bet.golf_hole ? `Hole ${bet.golf_hole}` : 'Round';
                const scoreA = mpData.holeMode ? mpData.holeData.holeA : mpData.groupA.roundScore;
                const scoreB = mpData.holeMode ? mpData.holeData.holeB : mpData.groupB.roundScore;
                await user.send(
                  `⛳ **${holeLabel} Complete** — ${mpData.groupA.displayName} (${scoreA}) vs ${mpData.groupB.displayName} (${scoreB})\n${emoji} \`${bet.slip_number}\` looks like a **${result.toUpperCase()}**!\n> ${bet.pick}\n\n⏰ Auto-closing in 1 hour.`
                ).catch(() => {});
              }
            } catch {}
            console.log(`[LiveTracker] 2ball/3ball bet ${bet.slip_number} auto-resolved: ${result}`);
          }
        } catch (e) {
          console.error('[LiveTracker] 2ball auto-resolve error:', e.message);
        }
      }

      // ── Resolve 2ball/3ball hole-score parlay legs ──
      const { data: open2BallLegs } = await supa
        .from('parlay_legs')
        .select('*')
        .eq('status', 'open')
        .in('wager_type', ['2ball', '3ball'])
        .not('match_player_a', 'is', null)
        .not('golf_hole', 'is', null);

      for (const leg of (open2BallLegs || [])) {
        try {
          const mpData = await espn.getGolf2BallLive({
            playerA: leg.match_player_a, playerA2: leg.match_player_a2 || null,
            playerB: leg.match_player_b, playerB2: leg.match_player_b2 || null,
            playerC: leg.match_player_c || null, roundNum: leg.golf_round || null,
            holeNum: leg.golf_hole || null,
          });
          if (!mpData || mpData.overallStatus !== 'post') continue;

          // Hole-score leg: only resolve when the specific hole is complete
          if (!mpData.holeMode || !mpData.holeData) continue;
          const { holeWinner } = mpData.holeData;
          if (holeWinner === null) continue;
          const isTieBet = leg.team_a === 'Tie';
          let result = null;
          if (holeWinner === 'tie') result = isTieBet ? 'win' : 'push';
          else if (!isTieBet && holeWinner === 'A') result = 'win';
          else result = 'loss';

          if (result) {
            await db.updateParlayLegStatus(leg.id, result);
            parlayBetsToCheck.add(leg.bet_id);
            console.log(`[LiveTracker] 2ball parlay leg ${leg.id} resolved: ${result}`);
          }
        } catch (e) {
          console.error('[LiveTracker] 2ball parlay leg error:', e.message);
        }
      }

      // ── Resolve 2ball/3ball ROUND-level single bets (no specific hole) ──
      const { data: openRound2BallSingles } = await supa
        .from('bets')
        .select('*')
        .eq('status', 'open')
        .eq('bet_type', 'single')
        .in('wager_type', ['2ball', '3ball'])
        .not('match_player_a', 'is', null)
        .is('golf_hole', null)
        .is('auto_close_at', null);

      for (const bet of (openRound2BallSingles || [])) {
        try {
          const mpData = await espn.getGolf2BallLive({
            playerA: bet.match_player_a, playerA2: bet.match_player_a2 || null,
            playerB: bet.match_player_b, playerB2: bet.match_player_b2 || null,
            playerC: bet.match_player_c || null, roundNum: bet.golf_round || null,
          });
          if (!mpData || mpData.overallStatus !== 'post') continue;

          // Round-level bet: resolve when round is complete using round scores (lower = better)
          const scoreA = mpData.groupA.roundScore;
          const scoreB = mpData.groupB.roundScore;
          if (scoreA == null || scoreB == null) continue;

          const isTieBet = bet.team_a === 'Tie';
          let result = null;
          if (scoreA === scoreB) {
            result = isTieBet ? 'win' : 'push';
          } else if (!isTieBet) {
            if (mpData.is3Ball) {
              const scoreC = mpData.groupC?.roundScore ?? mpData.groupB.roundScore;
              const minScore = Math.min(scoreA, scoreB, scoreC ?? Infinity);
              result = scoreA === minScore ? 'win' : 'loss';
            } else {
              result = scoreA < scoreB ? 'win' : 'loss';
            }
          } else {
            result = 'loss'; // Tie bet but scores differ
          }

          if (result) {
            const autoCloseAt = new Date(Date.now() + AUTO_CLOSE_DELAY).toISOString();
            const roundLabel = bet.golf_round ? `Round ${bet.golf_round}` : 'Round';
            await supa.from('bets').update({
              auto_close_at: autoCloseAt,
              result_note: `Auto-resolved: ${result} (${roundLabel} scores: A=${scoreA}, B=${scoreB})`,
            }).eq('id', bet.id);
            try {
              const user = await client.users.fetch(bet.discord_id).catch(() => null);
              if (user) {
                const emoji = result === 'win' ? '✅' : result === 'loss' ? '❌' : '🔄';
                await user.send(
                  `⛳ **${roundLabel} Complete** — ${mpData.groupA.displayName} (${scoreA > 0 ? '+' : ''}${scoreA}) vs ${mpData.groupB.displayName} (${scoreB > 0 ? '+' : ''}${scoreB})\n${emoji} \`${bet.slip_number}\` looks like a **${result.toUpperCase()}**!\n> ${bet.pick}\n\n⏰ Auto-closing in 1 hour.`
                ).catch(() => {});
              }
            } catch {}
            console.log(`[LiveTracker] Round 2ball/3ball ${bet.slip_number} auto-resolved: ${result}`);
          }
        } catch (e) {
          console.error('[LiveTracker] Round 2ball auto-resolve error:', e.message);
        }
      }

      // ── Resolve 2ball/3ball ROUND-level parlay legs (no specific hole) ──
      const { data: openRound2BallLegs } = await supa
        .from('parlay_legs')
        .select('*')
        .eq('status', 'open')
        .in('wager_type', ['2ball', '3ball'])
        .not('match_player_a', 'is', null)
        .is('golf_hole', null);

      for (const leg of (openRound2BallLegs || [])) {
        try {
          const mpData = await espn.getGolf2BallLive({
            playerA: leg.match_player_a, playerA2: leg.match_player_a2 || null,
            playerB: leg.match_player_b, playerB2: leg.match_player_b2 || null,
            playerC: leg.match_player_c || null, roundNum: leg.golf_round || null,
          });
          if (!mpData || mpData.overallStatus !== 'post') continue;

          const scoreA = mpData.groupA.roundScore;
          const scoreB = mpData.groupB.roundScore;
          if (scoreA == null || scoreB == null) continue;

          const isTieBet = leg.team_a === 'Tie';
          let result = null;
          if (scoreA === scoreB) {
            result = isTieBet ? 'win' : 'push';
          } else if (!isTieBet) {
            if (mpData.is3Ball) {
              const scoreC = mpData.groupC?.roundScore ?? null;
              const minScore = Math.min(scoreA, scoreB, scoreC ?? Infinity);
              result = scoreA === minScore ? 'win' : 'loss';
            } else {
              result = scoreA < scoreB ? 'win' : 'loss';
            }
          } else {
            result = 'loss';
          }

          if (result) {
            await db.updateParlayLegStatus(leg.id, result);
            parlayBetsToCheck.add(leg.bet_id);
            console.log(`[LiveTracker] Round 2ball parlay leg ${leg.id} resolved: ${result}`);
          }
        } catch (e) {
          console.error('[LiveTracker] Round 2ball parlay leg error:', e.message);
        }
      }

      // ── Check if any parlays are fully resolved ──
      for (const betId of parlayBetsToCheck) {
        try {
          const bet = await db.getBet(betId);
          if (!bet || bet.status !== 'open') continue;

          const legs = bet.parlay_legs || [];
          const allResolved = legs.every(l => l.status !== 'open');
          if (!allResolved) continue;

          // Determine overall parlay result
          const hasLoss = legs.some(l => l.status === 'loss');
          const allWinOrPush = legs.every(l => l.status === 'win' || l.status === 'push');
          const allVoid = legs.every(l => l.status === 'void');

          let parlayResult;
          if (hasLoss) parlayResult = 'loss';
          else if (allVoid) parlayResult = 'void';
          else if (allWinOrPush) parlayResult = 'win';
          else parlayResult = 'loss'; // Shouldn't hit but safety

          // Set auto-close timer
          const autoCloseAt = new Date(Date.now() + AUTO_CLOSE_DELAY).toISOString();
          await supa.from('bets').update({
            auto_close_at: autoCloseAt,
            result_note: `Auto-resolved: ${parlayResult} (all ${legs.length} legs resolved)`,
          }).eq('id', betId);

          // Notify user
          try {
            const user = await client.users.fetch(bet.discord_id).catch(() => null);
            if (user) {
              const emoji = parlayResult === 'win' ? '✅' : parlayResult === 'loss' ? '❌' : '🔄';
              const legSummary = legs.map(l => {
                const le = l.status === 'win' ? '✅' : l.status === 'loss' ? '❌' : '🔄';
                return `${le} ${l.pick}`;
              }).join('\n');
              await user.send(
                `🏁 **All Legs Complete** — \`${bet.slip_number}\`\n${emoji} Parlay looks like a **${parlayResult.toUpperCase()}**!\n\n${legSummary}\n\n⏰ Auto-closing in 1 hour. Close manually with \`/closebet\` to override.`
              ).catch(() => {});
            }
          } catch (e) {}

          console.log(`[LiveTracker] Parlay ${bet.slip_number} all legs resolved: ${parlayResult}`);
        } catch (e) {
          console.error('[LiveTracker] Parlay check error:', e.message);
        }
      }
    } catch (err) {
      console.error('[LiveTracker] Auto-resolve error:', err.message);
    }
  }, FAST_INTERVAL);
  console.log('   📡 Live bet tracker & auto-resolve started (30s interval)');

  // ── Auto-Close Timer (every 60s) ──
  // Closes bets whose 1-hour grace period has expired
  setInterval(async () => {
    try {
      const now = new Date().toISOString();
      const { data: pendingBets } = await supa
        .from('bets')
        .select('*, parlay_legs(*)')
        .eq('status', 'open')
        .not('auto_close_at', 'is', null)
        .lte('auto_close_at', now);

      if (!pendingBets?.length) return;

      for (const bet of pendingBets) {
        try {
          let result;
          if (bet.bet_type === 'parlay') {
            const legs = bet.parlay_legs || [];
            const hasLoss = legs.some(l => l.status === 'loss');
            const allWinOrPush = legs.every(l => l.status === 'win' || l.status === 'push');
            const allVoid = legs.every(l => l.status === 'void');
            if (hasLoss) result = 'loss';
            else if (allVoid) result = 'void';
            else if (allWinOrPush) result = 'win';
            else result = 'loss';
          } else {
            // Single bet — parse result from result_note
            const match = bet.result_note?.match(/Auto-resolved: (\w+)/);
            result = match?.[1] || null;
          }

          if (!result) continue;

          // Close the bet
          await db.closeBet(bet.id, result, bet.result_note);

          // Close any remaining open parlay legs with same status
          if (bet.bet_type === 'parlay') {
            for (const leg of (bet.parlay_legs || [])) {
              if (leg.status === 'open') {
                await db.updateParlayLegStatus(leg.id, result);
              }
            }
          }

          // Clear auto_close_at
          await supa.from('bets').update({ auto_close_at: null }).eq('id', bet.id);

          // Update Discord message
          try {
            const fullBet = await db.getBet(bet.id);
            const guild = client.guilds.cache.get(bet.guild_id);
            let displayName = bet.discord_id;
            if (guild) {
              const member = await guild.members.fetch(bet.discord_id).catch(() => null);
              displayName = member?.displayName || bet.discord_id;
            }
            const avatar = (await client.users.fetch(bet.discord_id).catch(() => null))?.displayAvatarURL() || '';

            const imgBuffer = await generateBetCardImage(fullBet, displayName, avatar);
            const { AttachmentBuilder } = require('discord.js');
            const attachment = new AttachmentBuilder(imgBuffer, { name: 'bet-card.png' });

            const channel = await client.channels.fetch(bet.channel_id).catch(() => null);
            if (channel && bet.message_id) {
              const msg = await channel.messages.fetch(bet.message_id).catch(() => null);
              if (msg) {
                if (result === 'win') {
                  // Delete old message, post fresh one
                  await msg.delete().catch(() => {});
                  const newMsg = await channel.send({
                    content: `✅ **AUTO-CLOSED** — ${displayName}'s bet \`${bet.slip_number}\` is a **WIN**!`,
                    files: [attachment],
                  });
                  await db.updateBetMessageId(bet.id, newMsg.id);
                } else {
                  await msg.edit({ files: [attachment], components: [] }).catch(() => {});
                }
              }
            }

            // Delete mirror message if exists
            if (bet.mirror_channel_id && bet.mirror_message_id) {
              try {
                const mirrorChannel = await client.channels.fetch(bet.mirror_channel_id);
                const mirrorMsg = await mirrorChannel.messages.fetch(bet.mirror_message_id);
                await mirrorMsg.delete();
              } catch (e) {}
              await supa.from('bets').update({ mirror_message_id: null }).eq('id', bet.id);
            }
          } catch (e) {
            console.error(`[AutoClose] Discord update error for ${bet.slip_number}:`, e.message);
          }

          // Recalculate roles
          if (bet.guild_id) {
            try {
              const guild = await client.guilds.fetch(bet.guild_id);
              await roleManager.recalculateRoles(guild);
            } catch (e) {}
          }

          // Notify user
          try {
            const user = await client.users.fetch(bet.discord_id).catch(() => null);
            if (user) {
              const emoji = result === 'win' ? '✅' : result === 'loss' ? '❌' : '🔄';
              await user.send(`${emoji} **Auto-closed** \`${bet.slip_number}\` as **${result.toUpperCase()}**`).catch(() => {});
            }
          } catch (e) {}

          // Check for win streak
          if (result === 'win' && bet.guild_id) {
            const fullBetForStreak = await db.getBet(bet.id);
            streakService.checkAndNotifyStreak(client, fullBetForStreak, bet.guild_id).catch(e =>
              console.error('[AutoClose] Streak check error:', e.message)
            );
          }

          console.log(`[AutoClose] Bet ${bet.slip_number} auto-closed as ${result}`);
        } catch (e) {
          console.error(`[AutoClose] Error closing ${bet.slip_number}:`, e.message);
        }
      }
    } catch (err) {
      console.error('[AutoClose] Timer error:', err.message);
    }
  }, 60_000);
  console.log('   ⏰ Auto-close timer started (60s interval, 1hr grace period)');

  // ── ESPN ID Retry Poller (every 15 min) ──
  // Re-attempts ESPN game ID resolution for bets that failed at creation time.
  // This handles advance bets placed before a game appears on ESPN's scoreboard.
  const espnRetryAlerted = new Set(); // tracks bets already owner-alerted (in-memory, resets on restart)
  setInterval(async () => {
    try {
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60_000).toISOString();

      // ── Single bets with no ESPN game ID ──
      const { data: untrackedSingles } = await supa
        .from('bets')
        .select('id, slip_number, sport, bet_category, team_a, team_b, event_start_time, created_at, discord_id, pick')
        .eq('status', 'open')
        .is('espn_game_id', null)
        .neq('bet_category', 'futures');

      for (const bet of (untrackedSingles || [])) {
        if (!espn.ESPN_SUPPORTED.has(bet.sport)) continue;
        try {
          const resolved = await espn.resolveGameId(bet.sport, bet.team_a, bet.team_b, bet.event_start_time);
          if (resolved) {
            await supa.from('bets').update({ espn_game_id: resolved.gameId }).eq('id', bet.id);
            try {
              const user = await client.users.fetch(bet.discord_id).catch(() => null);
              if (user) await user.send(
                `✅ **Now tracking your bet!** — \`${bet.slip_number}\`\nMatched to an ESPN game and will auto-close when it finishes.`
              ).catch(() => {});
            } catch {}
            console.log(`[ESPNRetry] Resolved ${bet.slip_number} → ${resolved.gameId}`);
          } else if (!espnRetryAlerted.has(bet.id) && bet.created_at < fourHoursAgo) {
            // Still untracked after 4+ hours — alert owner once
            espnRetryAlerted.add(bet.id);
            try {
              const owner = await client.users.fetch(SITE_OWNER_ID).catch(() => null);
              if (owner) await owner.send(
                `🚨 **[TRACKING ALERT]** Bet \`${bet.slip_number}\` (${bet.sport}) has no ESPN game ID after 4+ hours.\nUser: <@${bet.discord_id}>\nPick: ${bet.pick}\nCreated: ${new Date(bet.created_at).toLocaleString()}`
              ).catch(() => {});
            } catch {}
          }
        } catch (e) {
          console.error(`[ESPNRetry] Error for ${bet.slip_number}:`, e.message);
        }
      }

      // ── Open parlay legs with no ESPN game ID ──
      const { data: untrackedLegs } = await supa
        .from('parlay_legs')
        .select('id, bet_id, sport, bet_category, team_a, team_b, event_start_time')
        .eq('status', 'open')
        .is('espn_game_id', null)
        .neq('bet_category', 'futures');

      for (const leg of (untrackedLegs || [])) {
        if (!espn.ESPN_SUPPORTED.has(leg.sport)) continue;
        try {
          const resolved = await espn.resolveGameId(leg.sport, leg.team_a, leg.team_b, leg.event_start_time);
          if (resolved) {
            await supa.from('parlay_legs').update({ espn_game_id: resolved.gameId }).eq('id', leg.id);
            console.log(`[ESPNRetry] Resolved parlay leg ${leg.id} → ${resolved.gameId}`);
          }
        } catch (e) {
          console.error(`[ESPNRetry] Parlay leg ${leg.id} error:`, e.message);
        }
      }
    } catch (err) {
      console.error('[ESPNRetry] Poller error:', err.message);
    }
  }, 15 * 60_000);
  console.log('   🔄 ESPN ID retry poller started (15min interval)');

  // ─── Daily Kings Record Scheduler ───
  streakService.startDailyRecordScheduler(client);

  // ─── AI Pick of the Day Scheduler ───
  const AI_GUILD_ID = process.env.DISCORD_GUILD_ID;
  if (AI_GUILD_ID) {
    // Helper: ms until next occurrence of HH:MM ET
    function msUntilET(hour, minute) {
      const now = new Date();
      const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const diffMs = now.getTime() - et.getTime(); // offset from ET
      const target = new Date(et);
      target.setHours(hour, minute, 0, 0);
      if (target <= et) target.setDate(target.getDate() + 1);
      return target.getTime() - et.getTime();
    }

    // 9:30 AM ET — Teaser
    setTimeout(function scheduleTeaser() {
      aiPickService.postTeaser(client).catch(e => console.error('[AI Picks] Teaser error:', e.message));
      setInterval(() => {
        aiPickService.postTeaser(client).catch(e => console.error('[AI Picks] Teaser error:', e.message));
      }, 24 * 60 * 60_000);
    }, msUntilET(9, 30));

    // 10:00 AM ET — Daily pick
    setTimeout(function schedulePick() {
      aiPickService.generateDailyPick(client, AI_GUILD_ID).catch(e => console.error('[AI Picks] Pick error:', e.message));
      setInterval(() => {
        aiPickService.generateDailyPick(client, AI_GUILD_ID).catch(e => console.error('[AI Picks] Pick error:', e.message));
      }, 24 * 60 * 60_000);
    }, msUntilET(10, 0));

    // Auto-close pending picks every 5 minutes
    setInterval(async () => {
      try {
        await aiPickService.autoClosePendingPicks(client);
      } catch (err) {
        console.error('[AI Picks] Auto-close error:', err.message);
      }
    }, 5 * 60_000);

    // Monthly recap — check daily at midnight ET
    setTimeout(function scheduleRecap() {
      (async () => {
        try {
          const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
          if (now.getDate() === 1) {
            const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
            const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
            await aiPickService.postMonthlyRecap(client, AI_GUILD_ID, prevYear, prevMonth);
          }
        } catch (e) { console.error('[AI Picks] Monthly recap error:', e.message); }
      })();
      setInterval(async () => {
        try {
          const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
          if (now.getDate() === 1) {
            const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
            const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
            await aiPickService.postMonthlyRecap(client, AI_GUILD_ID, prevYear, prevMonth);
          }
        } catch (e) { console.error('[AI Picks] Monthly recap error:', e.message); }
      }, 24 * 60 * 60_000);
    }, msUntilET(0, 5));

    console.log('   🤖 AI Pick of the Day scheduler started');

    // Fire today's pick on startup if none exists yet (only after 10 AM ET)
    setTimeout(async () => {
      try {
        const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
        if (nowET.getHours() >= 10) {
          await aiPickService.generateDailyPick(client, AI_GUILD_ID);
        } else {
          console.log('[AI Picks] Startup skipped — before 10 AM ET, will wait for scheduled time.');
        }
      } catch (e) {
        console.error('[AI Picks] Startup pick error:', e.message);
      }
    }, 15_000);

    // ─── Golf H2H Matchup Scheduler (PAUSED — waiting on odds source) ───
    // TODO: Re-enable once we have a working golf odds API
    console.log('   ⛳ Golf H2H Matchup scheduler PAUSED (odds source TBD)');

    // ─── MLB Daily Market Analysis Scheduler ───
    // 9:00 AM ET — Generate NRFI, Strikeout, and HR analyses for all MLB games
    setTimeout(function scheduleMLB() {
      mlbAnalysis.generateAllDailyAnalysis(client, AI_GUILD_ID).catch(e => console.error('[MLB Analysis] Error:', e.message));
      setInterval(() => {
        mlbAnalysis.generateAllDailyAnalysis(client, AI_GUILD_ID).catch(e => console.error('[MLB Analysis] Error:', e.message));
      }, 24 * 60 * 60_000);
    }, msUntilET(9, 0));

    // Auto-resolve MLB analyses every 5 minutes
    setInterval(async () => {
      try {
        await mlbAnalysis.autoResolveAll(client);
      } catch (err) {
        console.error('[MLB Analysis] Auto-resolve error:', err.message);
      }
    }, 5 * 60_000);

    console.log('   ⚾ MLB Daily Analysis scheduler started (NRFI/F5/TT)');

    // Fire MLB analysis on startup if none exists yet (only after 9 AM ET, April-October)
    setTimeout(async () => {
      try {
        const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const month = nowET.getMonth() + 1;
        if (nowET.getHours() >= 9 && month >= 3 && month <= 10) {
          await mlbAnalysis.generateAllDailyAnalysis(client, AI_GUILD_ID);
        }
      } catch (e) {
        console.error('[MLB Analysis] Startup error:', e.message);
      }
    }, 20_000);
  }

  // ─── Lock Open Slips Channels (view + react + buttons only, no sending) ───
  const LOCKED_CHANNELS = [
    '1477318450618695692', // King Open Slips
    '1477318238273802480', // Community Open Slips
    '1485903920906895370', // AI Open Slips
  ];
  setTimeout(async () => {
    try {
      const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
      if (!guild) return;
      for (const chId of LOCKED_CHANNELS) {
        try {
          const ch = await client.channels.fetch(chId);
          if (!ch) continue;
          await ch.permissionOverwrites.edit(guild.roles.everyone, {
            [PermissionsBitField.Flags.ViewChannel]: true,
            [PermissionsBitField.Flags.SendMessages]: false,
            [PermissionsBitField.Flags.AddReactions]: true,
            [PermissionsBitField.Flags.UseExternalEmojis]: true,
            [PermissionsBitField.Flags.ReadMessageHistory]: true,
          });
          console.log(`   🔒 Locked channel ${chId} (view + react + buttons only)`);
        } catch (e) {
          console.error(`[Channel Lock] Error locking ${chId}:`, e.message);
        }
      }
    } catch (e) {
      console.error('[Channel Lock] Guild fetch error:', e.message);
    }
  }, 8000);

  // ─── Web Server ───
  setDiscordClient(client);
  const webApp = createWebServer();
  const WEB_PORT = process.env.WEB_PORT || 3000;
  webApp.listen(WEB_PORT, () => {
    console.log(`   🌐 Bet slip web form running at http://localhost:${WEB_PORT}`);
  });
});

// ─── Slash Command Handler ───
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    console.log(`[InteractionCreate] type=${interaction.type} customId=${interaction.customId || 'N/A'} commandName=${interaction.commandName || 'N/A'} user=${interaction.user?.username}`);

    // Slash commands
    if (interaction.isChatInputCommand()) {
      const cmd = client.commands.get(interaction.commandName);
      if (!cmd) return;

      console.log(`[CMD] /${interaction.commandName} by ${interaction.user.username} in #${interaction.channel?.name}`);
      await cmd.execute(interaction);
      return;
    }

    // String select menus
    if (interaction.isStringSelectMenu()) {
      await handleSelectMenu(interaction);
      return;
    }

    // Buttons
    if (interaction.isButton()) {
      await handleButton(interaction);
      return;
    }

    // Modal submits
    if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction);
      return;
    }
  } catch (error) {
    console.error(`[ERROR] Interaction handler:`, error);

    const content = '❌ An error occurred. Please try again.';
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content, ephemeral: true });
      } else {
        await interaction.reply({ content, ephemeral: true });
      }
    } catch (e) {
      // Interaction may have timed out
      console.error('[ERROR] Could not send error reply:', e.message);
    }
  }
});

// ─── Select Menu Router ───
async function handleSelectMenu(interaction) {
  const id = interaction.customId;
  console.log('[SelectMenu] Received interaction:', {
    customId: id,
    values: interaction.values,
    user: interaction.user?.id,
    guild: interaction.guildId,
    channel: interaction.channelId
  });

  if (id === 'enterbet_type') {
    console.log('[SelectMenu] Routing to handleBetTypeSelect');
    return enterbet.handleBetTypeSelect(interaction);
  }
  if (id === 'enterbet_parlay_count') {
    console.log('[SelectMenu] Routing to handleParlayCountSelect');
    return enterbet.handleParlayCountSelect(interaction);
  }
  if (id === 'enterbet_category') {
    console.log('[SelectMenu] Routing to handleCategorySelect');
    return enterbet.handleCategorySelect(interaction);
  }
  if (id === 'enterbet_sport') {
    console.log('[SelectMenu] Routing to handleSportSelect');
    return enterbet.handleSportSelect(interaction);
  }
  if (id === 'enterbet_wager_type') {
    console.log('[SelectMenu] Routing to handleWagerTypeSelect');
    return enterbet.handleWagerTypeSelect(interaction);
  }
  if (id === 'enterbet_over_under') {
    console.log('[SelectMenu] Routing to handleOverUnderSelect');
    return enterbet.handleOverUnderSelect(interaction);
  }
  if (id === 'enterbet_period') {
    console.log('[SelectMenu] Routing to handlePeriodSelect');
    return enterbet.handlePeriodSelect(interaction);
  }
  if (id === 'closebet_select') {
    console.log('[SelectMenu] Routing to closebet.handleBetSelect');
    return closebet.handleBetSelect(interaction);
  }
  if (id === 'closebet_leg_select') {
    console.log('[SelectMenu] Routing to closebet.handleLegSelect');
    return closebet.handleLegSelect(interaction);
  }
  if (id === 'deletebet_select') {
    console.log('[SelectMenu] Routing to deletebet.handleDeleteSelect');
    return deletebet.handleDeleteSelect(interaction);
  }
  if (id === 'editbet2_select' || id.startsWith('editbet2_status_')) {
    console.log('[SelectMenu] Routing to editbet.handleEditBetSelect');
    return editbet.handleEditBetSelect(interaction);
  }
  // MLB Live select menus
  if (id === 'mlblive_type') {
    return mlblive.handleTypeSelect(interaction);
  }
  if (id === 'mlblive_next_pitch_ab') {
    return mlblive.handleNextPitchABSelect(interaction);
  }
  if (id === 'mlblive_next_pitch_outcome') {
    return mlblive.handleNextPitchOutcomeSelect(interaction);
  }
  if (id === 'mlblive_ab_number') {
    return mlblive.handleABNumberSelect(interaction);
  }
  if (id === 'mlblive_ab_market') {
    return mlblive.handleABMarketSelect(interaction);
  }
  if (id === 'mlblive_ab_direction') {
    return mlblive.handleABDirectionSelect(interaction);
  }
  if (id === 'mlblive_ab_outcome') {
    return mlblive.handleABOutcomeSelect(interaction);
  }
  if (id === 'mlblive_ab_pitch_count_exact') {
    return mlblive.handleABPitchCountExactSelect(interaction);
  }
  if (id === 'mlblive_inning_number') {
    return mlblive.handleInningNumberSelect(interaction);
  }
  if (id === 'mlblive_inning_market') {
    return mlblive.handleInningMarketSelect(interaction);
  }
  if (id === 'mlblive_inning_direction') {
    return mlblive.handleInningDirectionSelect(interaction);
  }
  // Log unhandled select menu
  console.warn('[SelectMenu] Unhandled select menu:', id);
  try {
    await interaction.reply({ content: '❌ This select menu is not handled by the bot.', ephemeral: true });
  } catch (e) {
    console.error('[SelectMenu] Failed to reply to unhandled select menu:', e);
  }
}

// ─── Button Router ───
async function handleButton(interaction) {
  const id = interaction.customId;

  if (id.startsWith('closebet_leg_') || id.startsWith('closebet_legs_')) {
    return closebet.handleLegResultButton(interaction);
  }
  if (id === 'closebet_close_whole') {
    return closebet.handleCloseWhole(interaction);
  }
  if (id === 'closebet_done') {
    return closebet.handleDone(interaction);
  }
  if (id.startsWith('closebet_result_')) {
    return closebet.handleResultButton(interaction);
  }
  if (id === 'enterbet_parlay_final_btn') {
    return enterbet.handleParlayFinalButton(interaction);
  }
  if (id === 'enterbet_confirm') {
    return enterbet.handleBetConfirm(interaction);
  }
  if (id === 'enterbet_cancel') {
    return enterbet.handleBetCancel(interaction);
  }
  if (id === 'enterbet_details_btn') {
    return enterbet.handleDetailsButton(interaction);
  }
  if (id === 'enterbet_skip_details') {
    return enterbet.handleSkipDetails(interaction);
  }
  if (id.startsWith('enterbet_retro_')) {
    return enterbet.handleRetroResult(interaction);
  }
  if (id.startsWith('tailbet_')) {
    return enterbet.handleTailPoll(interaction);
  }
  if (id.startsWith('aipick_tail_') || id.startsWith('aipick_fade_')) {
    return aiPickService.handleTailFade(interaction);
  }
  // MLB Live buttons
  if (id === 'mlblive_confirm') {
    return mlblive.handleConfirm(interaction);
  }
  if (id === 'mlblive_cancel') {
    return mlblive.handleCancel(interaction);
  }
}

// ─── Modal Submit Router ───
async function handleModalSubmit(interaction) {
  const id = interaction.customId;

  if (id === 'enterbet_team_modal') {
    return enterbet.handleTeamModalSubmit(interaction);
  }
  if (id === 'enterbet_prop_modal') {
    return enterbet.handlePropModalSubmit(interaction);
  }
  if (id === 'enterbet_futures_modal') {
    return enterbet.handleFuturesModalSubmit(interaction);
  }
  if (id === 'enterbet_details_modal') {
    return enterbet.handleDetailsModalSubmit(interaction);
  }
  if (id === 'enterbet_parlay_final') {
    return enterbet.handleParlayFinalSubmit(interaction);
  }
  // MLB Live modals
  if (id === 'mlblive_next_pitch_modal') {
    return mlblive.handleNextPitchModalSubmit(interaction);
  }
  if (id === 'mlblive_ab_modal') {
    return mlblive.handleABModalSubmit(interaction);
  }
  if (id === 'mlblive_inning_modal') {
    return mlblive.handleInningModalSubmit(interaction);
  }
  if (id === 'mlblive_pitch_modal') {
    return mlblive.handlePitchModalSubmit(interaction);
  }
  if (id === 'deletebet_confirm_modal') {
    return deletebet.handleDeleteConfirmModal(interaction);
  }
  if (id.startsWith('editbet2_modal_')) {
    return editbet.handleEditBetModal(interaction);
  }
  if (id.startsWith('tailbet_units_')) {
    return enterbet.handleTailUnitsModal(interaction);
  }
  if (id.startsWith('aipick_tail_units_')) {
    return aiPickService.handleTailUnitsModal(interaction);
  }
}

// ─── Login ───
if (!process.env.DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKEN not found in .env file!');
  console.error('   Copy .env.example to .env and fill in your values.');
  process.exit(1);
}

// ─── Welcome DM on Member Join ───
const { supabase } = require('./config/supabase');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const WELCOME_CHANNEL_ID = '1478661003792351384';
const LOGO_URL = 'https://thegamblingkingapp.com/TheGamblingKing.jpg';
const BET_SLIP_URL = 'https://thegamblingkingapp.com/#slip';
const INVITE_URL = 'https://discord.gg/VKmkdSrk';

const DEFAULT_WELCOME_FIELDS = [
  { name: '🎰 Place Bets', value: 'Use `/enterbet` in any channel or visit the web app to submit your picks with our sleek bet slip.' },
  { name: '🔗 Tail Bets', value: 'When someone posts a pick, hit **Yes** or **No** on the poll to tail or fade their bet.' },
  { name: '🏆 Leaderboards', value: 'Use `/leaderboard` to see who\'s on top, or check the web dashboard for full stats.' },
  { name: '📊 Your Stats', value: 'Use `/mystats` to see your record, ROI, streaks, and more.' },
  { name: '🌐 Web Dashboard', value: '**[thegamblingkingapp.com](https://thegamblingkingapp.com)**\nLog in with Discord to place bets, view stats, set reminders, and more — all from your browser or phone.' },
  { name: '📱 Get the App', value: 'Visit the web dashboard and tap **📱 App** in the nav to install it on your phone for instant access.' },
];

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    // Check if welcome is enabled and get custom message
    const { data: settings } = await supabase
      .from('guild_settings')
      .select('*')
      .eq('guild_id', member.guild.id)
      .single();

    // If explicitly disabled, skip
    if (settings && settings.welcome_enabled === false) return;

    const wm = settings?.welcome_message || {};
    const title = wm.title || '👑 Welcome to TheGamblingKing!';
    const description = wm.description || `Hey **${member.displayName}**, welcome to the server! Here's everything you need to get started:`;
    const fields = wm.fields || DEFAULT_WELCOME_FIELDS;

    // ─── Send DM ───
    try {
      const dm = await member.createDM();
      await dm.send({
        embeds: [{
          color: 0xf5c518,
          title,
          description: description.replace('{user}', member.displayName),
          fields,
          thumbnail: { url: LOGO_URL },
          footer: { text: 'TheGamblingKing • Good luck out there 🎲' },
        }],
      });
      console.log(`[Welcome] Sent DM to ${member.user.username}`);
    } catch (dmErr) {
      console.log(`[Welcome] Could not DM ${member.user.username}: ${dmErr.message}`);
    }

    // ─── Post welcome embed to #new-members-welcome channel ───
    try {
      const welcomeChannel = await client.channels.fetch(WELCOME_CHANNEL_ID).catch(() => null);
      if (!welcomeChannel) return;

      const welcomeEmbed = new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle(`👑 Welcome to TheGamblingKing, ${member.displayName}!`)
        .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
        .setImage(LOGO_URL)
        .setDescription([
          `What's good **${member.displayName}**! You just joined the sharpest sports betting community on Discord. Here's how we roll:`,
          '',
          '**#JMM — Just Make Money** 💰',
          'That\'s the motto. That\'s the mission. Every pick, every play — we\'re here to win.',
        ].join('\n'))
        .addFields(
          {
            name: '🎰 Place Your Bets',
            value: [
              '• Head to the **bet channels** (Daily Action, Parlay Mania, Over Under, etc.)',
              '• Use the **[Bet Slip](https://thegamblingkingapp.com/#slip)** on the website or type `/enterbet` in Discord',
              '• Post your picks for the community to see — don\'t be shy!',
            ].join('\n'),
          },
          {
            name: '✅ Close & Track Bets',
            value: 'When your bet hits (or misses), bets get closed and your **record, ROI, and streaks** update automatically. Check your stats anytime with `/mystats` or on the web dashboard.',
          },
          {
            name: '📊 Stats & Leaderboard',
            value: 'Use `/leaderboard` to see who\'s running the server. Use `/advancedstats` for deep breakdowns by sport, bet type, and more. Everything is tracked — your record speaks for itself.',
          },
          {
            name: '🐋 The Whales',
            value: 'Keep an eye out for **Whale Bets** 🐋 — these are high-confidence plays from top bettors. When a whale drops a pick, pay attention. You can **tail** (follow) or **fade** (go against) any bet.',
          },
          {
            name: '🤝 Community Betting',
            value: 'This isn\'t a solo game. **Follow your favorite bettors** with `/follow` to get notified when they post a pick. React to bets to tail or fade. Talk trash. Share wins. We\'re all in this together.',
          },
          {
            name: '📱 Get the App',
            value: 'Visit **[thegamblingkingapp.com](https://thegamblingkingapp.com)** and add it to your home screen for instant access. Log in with Discord — your bets, stats, and leaderboard are all there.',
          },
          {
            name: '⚠️ Bet Responsibly',
            value: '**Only bet what you can afford to lose.** This is entertainment first. Set a unit size, stick to your bankroll, and never chase losses. We\'re here to have fun and make smart plays — not go broke.',
          },
          {
            name: '📣 Spread the Word',
            value: [
              'Know someone who loves betting? Bring them in!',
              '🔗 `https://discord.gg/VKmkdSrk`',
              '🔗 `https://thegamblingkingapp.com`',
            ].join('\n'),
          },
        )
        .setFooter({ text: 'TheGamblingKing • Just Make Money #JMM 🏀🔥' })
        .setTimestamp();

      const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🎟️  PLACE A BET NOW')
          .setStyle(ButtonStyle.Link)
          .setURL(BET_SLIP_URL),
      );

      await welcomeChannel.send({
        content: `Welcome <@${member.id}>! 🎉`,
        embeds: [welcomeEmbed],
        components: [buttonRow],
      });
      console.log(`[Welcome] Posted channel welcome for ${member.user.username}`);
    } catch (chErr) {
      console.log(`[Welcome] Could not post channel welcome for ${member.user.username}: ${chErr.message}`);
    }

  } catch (err) {
    console.log(`[Welcome] Error for ${member.user.username}: ${err.message}`);
  }
});

client.login(process.env.DISCORD_TOKEN);
