/**
 * March Madness Bracket Challenge — Frontend
 */
(function () {
  'use strict';

  const BS = window.BracketStructure;
  const $ = id => document.getElementById(id);

  /* ─── State ─── */
  let currentUser = null;
  let tournament  = null;
  let teams       = [];
  let teamsMap    = {};   // "East-1" → team ,  "id-42" → team
  let playinPairs = {};   // "West-11" → [team1, team2]  (First Four pairs)
  let ffR1Map     = {};   // R1 game_number → First Four game_number
  let pairRepId   = {};   // "West-11" → representative team ID (first team)
  let repToPairKey = {};  // representative team ID → pair key (e.g. "West-11")
  let games       = [];
  let gamesMap    = {};   // gameNumber → game record
  let myEntry     = null;
  let myPicks     = {};   // gameNumber → teamId
  let currentRegion = 'firstfour';
  let isAdminUser   = false;
  let canEdit       = false;
  let toastTimer;

  /* ═══════════ Init ═══════════ */
  document.addEventListener('DOMContentLoaded', () => {
    $('email-login-form').addEventListener('submit', handleEmailLogin);
    $('email-register-form').addEventListener('submit', handleEmailRegister);
    $('forgot-password-form').addEventListener('submit', handleForgotPassword);
    $('reset-password-form').addEventListener('submit', handleResetPassword);

    // Check for verification or reset tokens in URL
    const params = new URLSearchParams(window.location.search);
    const verifyToken = params.get('verify');
    const resetToken = params.get('reset');

    if (verifyToken) {
      handleVerifyToken(verifyToken);
    } else if (resetToken) {
      showResetPasswordForm(resetToken);
    } else {
      checkAuth();
    }
  });

  /* ═══════════ API helper ═══════════ */
  async function api(url, opts = {}) {
    const cfg = { ...opts, headers: { ...opts.headers } };
    if (opts.body && typeof opts.body === 'object') {
      cfg.headers['Content-Type'] = 'application/json';
      cfg.body = JSON.stringify(opts.body);
    }
    const res  = await fetch(url, cfg);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  /* ═══════════ Toast ═══════════ */
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
  }

  /* ═══════════ Auth ═══════════ */
  async function checkAuth() {
    try {
      currentUser = await api('/api/bracket/auth/me');
      isAdminUser = currentUser.isAdmin;
      $('auth-screen').classList.add('hidden');
      $('bracket-screen').classList.remove('hidden');
      await loadAll();
    } catch {
      $('auth-screen').classList.remove('hidden');
      $('bracket-screen').classList.add('hidden');
    }
  }

  async function handleEmailLogin(e) {
    e.preventDefault();
    try {
      await api('/api/bracket/auth/login', {
        method: 'POST',
        body: { email: $('login-email').value, password: $('login-password').value },
      });
      $('auth-error').classList.add('hidden');
      await checkAuth();
    } catch (err) {
      // Check if needs verification
      if (err.message.includes('verify your email')) {
        showVerifyNotice($('login-email').value);
      } else {
        showAuthError(err.message);
      }
    }
  }

  async function handleEmailRegister(e) {
    e.preventDefault();
    try {
      const result = await api('/api/bracket/auth/register', {
        method: 'POST',
        body: {
          displayName: $('reg-name').value,
          email: $('reg-email').value,
          password: $('reg-password').value,
        },
      });
      $('auth-error').classList.add('hidden');
      if (result.needsVerification) {
        showVerifyNotice($('reg-email').value);
      } else {
        await checkAuth();
      }
    } catch (err) { showAuthError(err.message); }
  }

  async function handleForgotPassword(e) {
    e.preventDefault();
    try {
      const result = await api('/api/bracket/auth/forgot-password', {
        method: 'POST',
        body: { email: $('forgot-email').value },
      });
      $('auth-error').classList.add('hidden');
      showAuthSuccess(result.message || 'If that email is registered, a reset link has been sent.');
    } catch (err) { showAuthError(err.message); }
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    const pw = $('reset-password').value;
    const confirm = $('reset-password-confirm').value;
    if (pw !== confirm) return showAuthError('Passwords do not match');
    try {
      const resetToken = $('reset-password-form').dataset.token;
      const result = await api('/api/bracket/auth/reset-password', {
        method: 'POST',
        body: { token: resetToken, password: pw },
      });
      $('auth-error').classList.add('hidden');
      showAuthSuccess(result.message || 'Password reset! You can now log in.');
      // Clean URL and show login after a delay
      window.history.replaceState({}, '', '/bracket');
      setTimeout(() => showLogin(), 2000);
    } catch (err) { showAuthError(err.message); }
  }

  async function handleVerifyToken(token) {
    try {
      const result = await api(`/api/bracket/auth/verify?token=${encodeURIComponent(token)}`);
      // Clean URL
      window.history.replaceState({}, '', '/bracket');
      toast(result.message || 'Email verified!');
      await checkAuth();
    } catch (err) {
      window.history.replaceState({}, '', '/bracket');
      $('auth-screen').classList.remove('hidden');
      showAuthError(err.message || 'Verification failed');
    }
  }

  function showResetPasswordForm(token) {
    hideAllAuthForms();
    $('reset-password-form').classList.remove('hidden');
    $('reset-password-form').dataset.token = token;
    $('auth-screen').classList.remove('hidden');
    $('bracket-screen').classList.add('hidden');
  }

  let pendingVerifyEmail = '';
  function showVerifyNotice(email) {
    hideAllAuthForms();
    pendingVerifyEmail = email;
    $('verify-notice').classList.remove('hidden');
    $('verify-email-display').textContent = email;
  }

  window.resendVerification = async function () {
    if (!pendingVerifyEmail) return;
    try {
      await api('/api/bracket/auth/resend-verification', {
        method: 'POST',
        body: { email: pendingVerifyEmail },
      });
      toast('Verification email sent! Check your inbox.');
    } catch (err) {
      showAuthError(err.message);
    }
  };

  function hideAllAuthForms() {
    $('email-login-form').classList.add('hidden');
    $('email-register-form').classList.add('hidden');
    $('forgot-password-form').classList.add('hidden');
    $('reset-password-form').classList.add('hidden');
    $('verify-notice').classList.add('hidden');
    $('show-register').classList.add('hidden');
    $('show-login').classList.add('hidden');
    $('auth-error').classList.add('hidden');
  }

  function showAuthError(msg) {
    const el = $('auth-error');
    el.textContent = msg;
    el.style.color = '';
    el.classList.remove('hidden');
  }

  function showAuthSuccess(msg) {
    const el = $('auth-error');
    el.textContent = msg;
    el.style.color = '#4caf50';
    el.classList.remove('hidden');
  }

  /* Exposed via HTML onclick */
  window.showRegister = function () {
    hideAllAuthForms();
    $('email-register-form').classList.remove('hidden');
    $('show-login').classList.remove('hidden');
  };
  window.showLogin = function () {
    hideAllAuthForms();
    $('email-login-form').classList.remove('hidden');
    $('show-register').classList.remove('hidden');
  };
  window.showForgotPassword = function () {
    hideAllAuthForms();
    $('forgot-password-form').classList.remove('hidden');
  };
  window.logout = async function () {
    try { await api('/api/bracket/auth/logout', { method: 'POST' }); } catch {}
    // Server clears both httpOnly cookies (fk_token + bracket_token)
    currentUser = null; tournament = null; myEntry = null; myPicks = {};
    $('auth-screen').classList.remove('hidden');
    $('bracket-screen').classList.add('hidden');
  };

  /* ═══════════ Load All Data ═══════════ */
  async function loadAll() {
    $('user-info').textContent = currentUser.displayName;
    if (isAdminUser) $('admin-btn').classList.remove('hidden');
    else $('admin-btn').classList.add('hidden');

    // Tournament
    try {
      const d = await api('/api/bracket/tournament');
      tournament = d.tournament;
    } catch { tournament = null; }

    if (!tournament) {
      hideMain();
      if (isAdminUser) {
        $('not-open-msg').classList.remove('hidden');
        $('not-open-msg').innerHTML = '<h2>🏀 No Tournament Yet</h2><p>Click <strong>Admin</strong> to create one.</p>';
      } else {
        $('not-open-msg').classList.remove('hidden');
      }
      return;
    }

    // Header
    $('tournament-name').textContent = tournament.name || 'March Madness 2026';
    const se = $('tournament-status');
    se.textContent = tournament.status;
    se.className = 'status-badge status-' + tournament.status;

    // Parallel fetch
    const [tData, gData, eData] = await Promise.all([
      api(`/api/bracket/teams/${tournament.id}`).catch(() => ({ teams: [] })),
      api(`/api/bracket/games/${tournament.id}`).catch(() => ({ games: [] })),
      api(`/api/bracket/my-entry/${tournament.id}`).catch(() => ({ entry: null })),
    ]);
    teams   = tData.teams  || [];
    games   = gData.games  || [];
    myEntry = eData.entry;

    buildTeamsMap();
    buildGamesMap();

    // Can the user still edit picks?
    canEdit = ['open', 'active'].includes(tournament.status)
      && !(tournament.lock_date && new Date() > new Date(tournament.lock_date));

    // Load picks
    if (myEntry && myEntry.picks && Object.keys(myEntry.picks).length) {
      myPicks = {};
      for (const [gn, tid] of Object.entries(myEntry.picks)) myPicks[gn] = tid;
    } else {
      loadDraftPicks();
    }

    resolvePlayinPicks();
    renderBracketUI();
  }

  function hideMain() {
    $('bracket-tabs').classList.add('hidden');
    $('bracket-container').classList.add('hidden');
    $('submit-section').classList.add('hidden');
    $('payment-bar').classList.add('hidden');
  }

  function buildTeamsMap() {
    teamsMap = {};
    playinPairs = {};
    ffR1Map = {};
    pairRepId = {};
    repToPairKey = {};
    for (const t of teams) {
      const key = `${t.region}-${t.seed}`;
      if (t.is_playin) {
        if (!playinPairs[key]) playinPairs[key] = [];
        playinPairs[key].push(t);
      } else {
        teamsMap[key] = t;
      }
      teamsMap[`id-${t.id}`] = t;
    }
    // Build pair representative IDs and reverse map
    for (const [key, pair] of Object.entries(playinPairs)) {
      if (pair.length >= 1) {
        pairRepId[key] = pair[0].id;
        repToPairKey[String(pair[0].id)] = key;
      }
    }
    // Build reverse map: R1 game → First Four game
    for (const ffGn of (BS.FIRST_FOUR_GAMES || [])) {
      const ffDef = BS.BRACKET[ffGn];
      if (ffDef) ffR1Map[ffDef.advancesTo] = ffGn;
    }
  }

  function buildGamesMap() {
    gamesMap = {};
    for (const g of games) gamesMap[g.game_number] = g;
  }

  /** When a First Four game resolves, swap the pair representative ID
   *  with the actual winner's ID throughout the user's picks. */
  function resolvePlayinPicks() {
    let changed = false;
    for (const ffGn of (BS.FIRST_FOUR_GAMES || [])) {
      const ffGame = gamesMap[ffGn];
      if (!ffGame || !ffGame.winner_id) continue;
      const ffDef = BS.BRACKET[ffGn];
      if (!ffDef) continue;
      const pairKey = `${ffDef.region}-${ffDef.topSeed}`;
      const repId = pairRepId[pairKey];
      if (!repId) continue;
      // If winner is not the representative, swap all occurrences
      if (String(ffGame.winner_id) !== String(repId)) {
        for (const [gn, tid] of Object.entries(myPicks)) {
          if (String(tid) === String(repId)) {
            myPicks[gn] = ffGame.winner_id;
            changed = true;
          }
        }
      }
      // Clean up: remove this pair from the rep maps so it's treated as a normal team
      delete repToPairKey[String(repId)];
    }
    if (changed) saveDraftPicks();
  }

  /* ─── Draft picks in localStorage ─── */
  function saveDraftPicks() {
    if (tournament) localStorage.setItem(`bracket-draft-${tournament.id}`, JSON.stringify(myPicks));
  }
  function loadDraftPicks() {
    if (!tournament) return;
    try {
      const s = localStorage.getItem(`bracket-draft-${tournament.id}`);
      if (s) myPicks = JSON.parse(s);
    } catch {}
  }
  function clearDraftPicks() {
    if (tournament) localStorage.removeItem(`bracket-draft-${tournament.id}`);
  }

  /* ═══════════ Render Bracket UI ═══════════ */
  function renderBracketUI() {
    if (teams.length === 0) {
      hideMain();
      $('not-open-msg').classList.remove('hidden');
      $('not-open-msg').innerHTML = "<h2>🏀 Coming Soon</h2><p>Teams haven't been seeded yet. Check back after Selection Sunday!</p>";
      return;
    }

    $('not-open-msg').classList.add('hidden');

    // User hasn't joined yet
    if (!myEntry && ['open', 'active'].includes(tournament.status)) {
      hideMain();
      $('bracket-container').classList.remove('hidden');
      $('bracket-container').innerHTML = `
        <div class="center-msg">
          <h2>🏀 Join the Pool!</h2>
          <p style="margin-bottom:16px">Entry fee: <strong>$${tournament.entry_fee || 0}</strong></p>
          ${tournament.prize_description ? `<p style="margin-bottom:16px;color:var(--gold)">${esc(tournament.prize_description)}</p>` : ''}
          <button onclick="joinTournament()" class="btn btn-primary btn-lg">Join & Fill Bracket</button>
        </div>`;
      return;
    }

    // Show bracket
    $('bracket-tabs').classList.remove('hidden');
    $('bracket-container').classList.remove('hidden');

    // Submit section visible only when editable
    if (canEdit && myEntry) {
      $('submit-section').classList.remove('hidden');
      // Update submit button text
      $('submit-btn').textContent = myEntry.submitted_at ? 'Update Bracket' : 'Submit Bracket';
    } else {
      $('submit-section').classList.add('hidden');
    }

    // Submitted indicator / score display
    if (myEntry && myEntry.submitted_at && !canEdit) {
      $('payment-bar').classList.remove('hidden');
      // show score if available
      let scoreHtml = '';
      if (typeof myEntry.score === 'number') {
        scoreHtml = ` | <strong style="color:var(--green)">Score: ${myEntry.score}</strong> (${myEntry.correct_picks || 0} correct)`;
        if (typeof myEntry.max_possible === 'number') scoreHtml += ` | Max possible: ${myEntry.max_possible}`;
      }
      $('payment-bar').innerHTML = `<span>✅ Bracket submitted</span>${scoreHtml}`;
    } else {
      renderPaymentBar();
    }

    renderCurrentRegion();
    updatePickCount();

    if (myEntry && myEntry.tiebreaker && $('tiebreaker-input')) $('tiebreaker-input').value = myEntry.tiebreaker;
  }

  function renderPaymentBar() {
    if (!tournament || !myEntry || !tournament.entry_fee) {
      $('payment-bar').classList.add('hidden');
      return;
    }
    $('payment-bar').classList.remove('hidden');
    $('entry-fee-display').textContent = '$' + tournament.entry_fee;
    const venmo = tournament.venmo_username || '';
    if (venmo) {
      const isUrl = venmo.startsWith('http');
      const link = isUrl ? venmo : `https://venmo.com/${venmo}`;
      $('venmo-display').innerHTML = `<a href="${esc(link)}" target="_blank" style="color:var(--accent)">💸 Pay via Venmo</a>`;
    } else {
      $('venmo-display').innerHTML = '';
    }
    const userName = currentUser?.displayName || currentUser?.email || '';
    $('payment-status-display').innerHTML = myEntry.paid
      ? '<span class="paid">✓ Paid</span>'
      : `<span class="unpaid">✗ Not Paid</span><span style="font-size:12px;color:var(--text-secondary);margin-left:8px">⚠️ Put your <strong>Discord username</strong> or <strong>signup email</strong> in the Venmo message so we know who paid!${userName ? ' (e.g. "' + esc(userName) + '")' : ''}</span>`;
  }

  /* ═══════════ Region Tabs ═══════════ */
  window.switchRegion = function (region) {
    currentRegion = region;
    document.querySelectorAll('.bracket-tabs .tab').forEach(t => {
      t.classList.toggle('active', t.dataset.region === region);
    });
    renderCurrentRegion();
  };

  function renderCurrentRegion() {
    if (currentRegion === 'finalfour') renderFinalFour();
    else if (currentRegion === 'firstfour') renderFirstFour();
    else renderRegionBracket(currentRegion);
  }

  /* ═══════════ Region Bracket ═══════════ */
  function renderRegionBracket(region) {
    const ri  = BS.REGIONS.indexOf(region);
    if (ri === -1) return;
    const off = ri * 15;
    const container = $('bracket-container');
    container.innerHTML = '';

    const bracket = document.createElement('div');
    bracket.className = 'region-bracket';

    const rounds = [
      { label: 'R64', nums: [1,2,3,4,5,6,7,8].map(i => off + i) },
      { label: 'R32', nums: [9,10,11,12].map(i => off + i) },
      { label: 'S16', nums: [13,14].map(i => off + i) },
      { label: 'E8',  nums: [off + 15] },
    ];

    rounds.forEach((rd, idx) => {
      // Round column
      const col = document.createElement('div');
      col.className = 'bracket-round';

      const lbl = document.createElement('div');
      lbl.className = 'round-label';
      lbl.textContent = rd.label;
      col.appendChild(lbl);

      for (const gn of rd.nums) col.appendChild(buildMatchup(gn));
      bracket.appendChild(col);

      // Connector column (except after last round)
      if (idx < rounds.length - 1) {
        const conn = document.createElement('div');
        conn.className = 'connector-col';
        const nextLen = rounds[idx + 1].nums.length;
        for (let i = 0; i < nextLen; i++) {
          const p = document.createElement('div');
          p.className = 'connector-pair';
          conn.appendChild(p);
        }
        bracket.appendChild(conn);
      }
    });

    container.appendChild(bracket);
  }

  /* ═══════════ First Four ═══════════ */
  function renderFirstFour() {
    const container = $('bracket-container');
    container.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'final-four-bracket';

    const heading = document.createElement('h2');
    heading.style.cssText = 'text-align:center;margin-bottom:16px;color:var(--gold)';
    heading.textContent = '🏀 First Four Play-In Games';
    wrap.appendChild(heading);

    const desc = document.createElement('p');
    desc.style.cssText = 'text-align:center;margin-bottom:24px;color:var(--text-secondary);font-size:14px';
    desc.textContent = 'Winners advance to their seed slot in the main bracket.';
    wrap.appendChild(desc);

    const row = document.createElement('div');
    row.className = 'ff-row';
    row.style.flexWrap = 'wrap';

    const ffGames = (BS.FIRST_FOUR_GAMES || []);
    for (const gn of ffGames) {
      const g = BS.BRACKET[gn];
      if (!g) continue;

      const gr = gamesMap[gn];
      const regionLabel = g.region || '';
      const seedLabel = g.topSeed || '';
      let statusText = '';
      if (gr && gr.status === 'final') {
        const winner = gr.winner_id ? teamsMap[`id-${gr.winner_id}`] : null;
        statusText = winner ? `✅ ${winner.short_name || winner.team_name} wins` : '✅ Final';
      } else if (gr && gr.status === 'live') {
        statusText = '🟢 LIVE';
      } else {
        statusText = '⏳ Pending';
      }

      const mWrap = document.createElement('div');
      mWrap.className = 'ff-matchup';
      const lbl = document.createElement('div');
      lbl.className = 'ff-label';
      lbl.innerHTML = `${esc(regionLabel)} • ${seedLabel} seed <span style="font-size:12px;color:var(--text-secondary);margin-left:8px">${statusText}</span>`;
      mWrap.appendChild(lbl);
      mWrap.appendChild(buildMatchup(gn));

      const advGame = g.advancesTo;
      if (advGame) {
        const advNote = document.createElement('div');
        advNote.style.cssText = 'text-align:center;font-size:11px;color:var(--text-secondary);margin-top:4px';
        advNote.textContent = `Winner → Game ${advGame} (${regionLabel} R64)`;
        mWrap.appendChild(advNote);
      }
      row.appendChild(mWrap);
    }

    wrap.appendChild(row);
    container.appendChild(wrap);
  }

  /* ═══════════ Final Four ═══════════ */
  function renderFinalFour() {
    const container = $('bracket-container');
    container.innerHTML = '';

    const ff = document.createElement('div');
    ff.className = 'final-four-bracket';

    // Semis
    const row = document.createElement('div');
    row.className = 'ff-row';

    [
      { gn: 61, label: 'Semifinal 1 — East vs West' },
      { gn: 62, label: 'Semifinal 2 — South vs Midwest' },
    ].forEach(s => {
      const wrap = document.createElement('div');
      wrap.className = 'ff-matchup';
      const lbl = document.createElement('div');
      lbl.className = 'ff-label';
      lbl.textContent = s.label;
      wrap.appendChild(lbl);
      wrap.appendChild(buildMatchup(s.gn));
      row.appendChild(wrap);
    });
    ff.appendChild(row);

    // Championship
    const cWrap = document.createElement('div');
    cWrap.className = 'ff-matchup';
    const cLbl = document.createElement('div');
    cLbl.className = 'ff-label';
    cLbl.textContent = '🏆 Championship';
    cWrap.appendChild(cLbl);
    cWrap.appendChild(buildMatchup(63));
    ff.appendChild(cWrap);

    // Champion display
    const champId = myPicks[63];
    if (champId) {
      const team = teamsMap[`id-${champId}`];
      if (team) {
        const cd = document.createElement('div');
        cd.className = 'champion-display';
        const champLogo = team.logo_url ? `<img class="champion-logo" src="${esc(team.logo_url)}" alt="">` : '';
        cd.innerHTML = `<h3>🏆 YOUR CHAMPION</h3>${champLogo}<div class="champion-team">(${team.seed}) ${esc(team.team_name)}</div>`;
        ff.appendChild(cd);
      }
    }

    // Tiebreaker — directly under championship
    if (canEdit && myEntry) {
      const existingVal = myEntry?.tiebreaker || '';
      const tbDiv = document.createElement('div');
      tbDiv.className = 'tiebreaker-inline';
      tbDiv.innerHTML = `
        <div class="tiebreaker-heading">⚠️ TIEBREAKER <span class="tiebreaker-required">(REQUIRED)</span></div>
        <div class="tiebreaker-desc">Predict the <strong>total combined score</strong> of the Championship game</div>
        <input type="number" id="tiebreaker-input" min="0" max="500" placeholder="e.g. 145" value="${existingVal}">
      `;
      ff.appendChild(tbDiv);
    }

    container.appendChild(ff);
  }

  /* ═══════════ Build Matchup ═══════════ */
  function buildMatchup(gameNumber) {
    const g  = BS.BRACKET[gameNumber];
    const el = document.createElement('div');
    el.className = 'matchup';
    el.id = 'game-' + gameNumber;

    const { top, bottom } = getTeamsForDisplay(gameNumber);
    el.appendChild(buildTeamSlot(gameNumber, top, 'top', g));
    el.appendChild(buildTeamSlot(gameNumber, bottom, 'bottom', g));
    return el;
  }

  function getTeamsForDisplay(gameNumber) {
    const g = BS.BRACKET[gameNumber];
    if (g.round === 0) {
      // First Four: both seeds are the same, use game record team IDs
      const gr = gamesMap[gameNumber];
      return {
        top:    gr?.top_team_id  ? (teamsMap[`id-${gr.top_team_id}`]  || null) : null,
        bottom: gr?.bottom_team_id ? (teamsMap[`id-${gr.bottom_team_id}`] || null) : null,
      };
    }
    if (g.round === 1) {
      const top = teamsMap[`${g.region}-${g.topSeed}`] || null;
      let bottom = teamsMap[`${g.region}-${g.bottomSeed}`] || null;
      // For play-in seed slots: check if First Four game is resolved
      const ffGn = ffR1Map[gameNumber];
      if (ffGn) {
        const ffGame = gamesMap[ffGn];
        if (ffGame && ffGame.winner_id) {
          bottom = teamsMap[`id-${ffGame.winner_id}`] || null;
        } else {
          // Not resolved — return a synthetic pair team for display
          const ffDef = BS.BRACKET[ffGn];
          const pairKey = `${ffDef.region}-${ffDef.topSeed}`;
          const pair = playinPairs[pairKey];
          if (pair && pair.length === 2) {
            bottom = { _isPair: true, pairKey, id: pairRepId[pairKey], seed: pair[0].seed, pair };
          } else {
            bottom = null;
          }
        }
      }
      return { top, bottom };
    }
    // Later rounds — teams come from picks (user's bracket)
    const tId = myPicks[g.feederTop];
    const bId = myPicks[g.feederBottom];
    return {
      top:    tId ? resolvePickTeam(tId) : null,
      bottom: bId ? resolvePickTeam(bId) : null,
    };
  }

  /** Resolve a picked team ID: if it's a pair representative and FF not resolved, return pair object */
  function resolvePickTeam(teamId) {
    const pairKey = repToPairKey[String(teamId)];
    if (pairKey) {
      // Check if the First Four for this pair is resolved
      const ffGn = (BS.FIRST_FOUR_GAMES || []).find(gn => {
        const d = BS.BRACKET[gn];
        return d && `${d.region}-${d.topSeed}` === pairKey;
      });
      if (ffGn) {
        const ffGame = gamesMap[ffGn];
        if (ffGame && ffGame.winner_id) {
          // Resolved — return the actual winner team
          return teamsMap[`id-${ffGame.winner_id}`] || null;
        }
      }
      // Not resolved — return pair object
      const pair = playinPairs[pairKey];
      if (pair && pair.length === 2) {
        return { _isPair: true, pairKey, id: pairRepId[pairKey], seed: pair[0].seed, pair };
      }
    }
    return teamsMap[`id-${teamId}`] || null;
  }

  function buildTeamSlot(gameNumber, team, position, game) {
    const slot = document.createElement('div');
    slot.className = 'team-slot';

    if (!team) {
      slot.classList.add('empty');
      if (game.round <= 1) {
        slot.innerHTML = '<span class="team-name">TBD</span>';
      } else {
        const feeder = position === 'top' ? game.feederTop : game.feederBottom;
        slot.innerHTML = `<span class="team-name">Winner of #${feeder}</span>`;
      }
      return slot;
    }

    // Handle play-in pair display
    if (team._isPair) {
      const names = team.pair.map(t => esc(t.short_name || t.team_name)).join('/');
      const pickedId = myPicks[gameNumber];
      const isPicked = pickedId != null && String(pickedId) === String(team.id);
      if (isPicked) slot.classList.add('picked');
      if (canEdit && myEntry) {
        const gr = gamesMap[gameNumber];
        if (!(gr && gr.winner_id)) {
          attachPickHandlers(slot, gameNumber, team.id);
        } else { slot.classList.add('locked'); }
      } else { slot.classList.add('locked'); }
      slot.innerHTML = `<span class="seed">${team.seed}</span><span class="team-name playin-pair">${names}</span>`;
      return slot;
    }

    const pickedId  = myPicks[gameNumber];
    const isPicked  = pickedId != null && String(pickedId) === String(team.id);
    if (isPicked) slot.classList.add('picked');

    // Overlay actual result
    const gr = gamesMap[gameNumber];
    if (gr && gr.winner_id) {
      if (isPicked && String(gr.winner_id) === String(team.id))  slot.classList.add('correct');
      if (isPicked && String(gr.winner_id) !== String(team.id))  slot.classList.add('incorrect');
    }

    if (team.is_eliminated) slot.classList.add('eliminated');

    // Clickable only when editable, game not decided, and not a First Four game
    if (canEdit && myEntry && !(gr && gr.winner_id) && game.round !== 0) {
      attachPickHandlers(slot, gameNumber, team.id);
    } else {
      slot.classList.add('locked');
    }

    const logoHtml = team.logo_url ? `<img class="team-logo" src="${esc(team.logo_url)}" alt="" onerror="this.style.display='none'">` : '';
    slot.innerHTML = `<span class="seed">${team.seed}</span>${logoHtml}<span class="team-name">${esc(team.short_name || team.team_name)}</span>`;
    return slot;
  }

  /* ═══════════ Pick Handling ═══════════ */
  let _clickTimer = null;
  function attachPickHandlers(slot, gameNumber, teamId) {
    slot.addEventListener('click', () => {
      clearTimeout(_clickTimer);
      _clickTimer = setTimeout(() => pickTeam(gameNumber, teamId), 220);
    });
    slot.addEventListener('dblclick', (e) => {
      e.preventDefault();
      clearTimeout(_clickTimer);
      unpickTeam(gameNumber);
    });
  }

  function unpickTeam(gameNumber) {
    const pick = myPicks[gameNumber];
    if (pick == null) return;
    // Clear this pick and all downstream picks of the same team
    const downstream = BS.getDownstreamGames(gameNumber);
    for (const gn of downstream) {
      if (myPicks[gn] != null && String(myPicks[gn]) === String(pick)) {
        delete myPicks[gn];
      }
    }
    delete myPicks[gameNumber];
    saveDraftPicks();
    renderCurrentRegion();
    updatePickCount();
  }

  function pickTeam(gameNumber, teamId) {
    const oldPick = myPicks[gameNumber];
    if (oldPick != null && String(oldPick) === String(teamId)) return; // no-op

    // Clear downstream picks for the eliminated team
    if (oldPick != null) {
      const downstream = BS.getDownstreamGames(gameNumber);
      for (const gn of downstream) {
        if (myPicks[gn] != null && String(myPicks[gn]) === String(oldPick)) {
          delete myPicks[gn];
        }
      }
    }

    myPicks[gameNumber] = teamId;
    saveDraftPicks();
    renderCurrentRegion();
    updatePickCount();
  }

  function updatePickCount() {
    const count = Object.keys(myPicks).length;
    $('picks-count').textContent = `${count}/63 picks`;
    $('submit-btn').disabled = count < 63;
  }

  /* ═══════════ Join ═══════════ */
  window.joinTournament = async function () {
    try {
      const d = await api('/api/bracket/entry', { method: 'POST' });
      myEntry = d.entry;
      toast('Welcome to the pool! Fill out your bracket.');
      renderBracketUI();
    } catch (err) { toast(err.message); }
  };

  /* ═══════════ Submit ═══════════ */
  window.submitBracket = async function () {
    if (!myEntry) return;
    const count = Object.keys(myPicks).length;
    if (count < 63) { toast(`Need all 63 picks — you have ${count}`); return; }

    const tbInput = $('tiebreaker-input');
    const tiebreaker = tbInput ? parseInt(tbInput.value) : 0;
    if (!tiebreaker || tiebreaker <= 0) {
      toast('\u26A0\uFE0F Tiebreaker is required! Go to Final Four tab and enter a total score prediction.');
      switchRegion('finalfour');
      return;
    }
    try {
      await api('/api/bracket/picks', {
        method: 'POST',
        body: { entryId: myEntry.id, picks: myPicks, tiebreaker },
      });
      clearDraftPicks();
      toast('🏀 Bracket submitted! Good luck!');
      const eData = await api(`/api/bracket/my-entry/${tournament.id}`);
      myEntry = eData.entry;
      renderBracketUI();
    } catch (err) { toast(err.message); }
  };

  /* ═══════════ Leaderboard ═══════════ */
  window.showLeaderboard = async function () {
    if (!tournament) return;
    $('leaderboard-modal').classList.remove('hidden');
    $('leaderboard-body').innerHTML = '<p style="text-align:center;padding:20px">Loading…</p>';

    try {
      const d = await api(`/api/bracket/leaderboard/${tournament.id}`);
      renderLeaderboard(d.leaderboard || []);
    } catch (err) {
      $('leaderboard-body').innerHTML = `<p style="padding:20px">${esc(err.message)}</p>`;
    }
  };

  function renderLeaderboard(entries) {
    if (!entries.length) {
      $('leaderboard-body').innerHTML = '<p style="text-align:center;padding:20px">No entries yet.</p>';
      return;
    }

    let html = `<table class="lb-table"><thead><tr>
      <th>#</th><th>Name</th><th>Score</th><th>Correct</th><th>Max</th><th>TB</th>
    </tr></thead><tbody>`;

    entries.forEach((e, i) => {
      const r = i + 1;
      const rc = r === 1 ? 'lb-first' : r === 2 ? 'lb-second' : r === 3 ? 'lb-third' : '';
      html += `<tr>
        <td class="lb-rank ${rc}">${r}</td>
        <td>${esc(e.display_name || 'Unknown')}</td>
        <td class="lb-score">${e.score ?? 0}</td>
        <td>${e.correct_picks ?? 0}</td>
        <td>${e.max_possible ?? '–'}</td>
        <td>${e.tiebreaker ?? '–'}</td>
      </tr>`;
    });

    html += '</tbody></table>';
    $('leaderboard-body').innerHTML = html;
  }

  /* ═══════════ Admin Panel ═══════════ */
  let currentAdminTab = 'setup';

  window.showAdmin = function () {
    if (!isAdminUser) return;
    $('admin-modal').classList.remove('hidden');
    switchAdminTabInner('setup');
  };

  window.switchAdminTab = function (tab) { switchAdminTabInner(tab); };

  function switchAdminTabInner(tab) {
    currentAdminTab = tab;
    const tabs = document.querySelectorAll('.admin-tab');
    const map  = ['setup', 'teams', 'entries', 'results'];
    tabs.forEach((t, i) => t.classList.toggle('active', map[i] === tab));

    switch (tab) {
      case 'setup':   renderSetupTab();   break;
      case 'teams':   renderTeamsTab();   break;
      case 'entries': renderRosterTab();  break;
      case 'results': renderResultsTab(); break;
    }
  }

  /* ─ Tournament Setup ─ */
  function renderSetupTab() {
    const t = tournament || {};
    $('admin-content').innerHTML = `
      <form id="setup-form" class="admin-form">
        <div class="admin-row"><label>Name</label>
          <input id="t-name" value="${esc(t.name || 'March Madness 2026')}" /></div>
        <div class="admin-row"><label>Year</label>
          <input id="t-year" type="number" value="${t.year || 2026}" /></div>
        <div class="admin-row"><label>Entry Fee ($)</label>
          <input id="t-fee" type="number" value="${t.entry_fee || 0}" min="0" /></div>
        <div class="admin-row"><label>Venmo Username</label>
          <input id="t-venmo" value="${esc(t.venmo_username || '')}" placeholder="Full Venmo link or username" style="min-width:300px" /></div>
        <div class="admin-row"><label>Prize Description</label>
          <textarea id="t-prize">${esc(t.prize_description || '')}</textarea></div>
        <div class="admin-row"><label>Lock Date</label>
          <input id="t-lock" type="datetime-local" value="${t.lock_date ? new Date(t.lock_date).toISOString().slice(0,16) : ''}" /></div>
        <div class="admin-row"><label>Status</label>
          <select id="t-status">
            ${['setup','open','locked','active','completed'].map(s =>
              `<option value="${s}" ${t.status===s?'selected':''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`).join('')}
          </select></div>
        <button type="submit" class="btn btn-primary">${tournament ? 'Update Tournament' : 'Create Tournament'}</button>
      </form>`;

    $('setup-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        name: $('t-name').value,
        year: parseInt($('t-year').value),
        entryFee: parseFloat($('t-fee').value),
        venmoUsername: $('t-venmo').value,
        prizeDescription: $('t-prize').value,
        lockDate: $('t-lock').value || null,
        status: $('t-status').value,
      };
      try {
        if (tournament) {
          await api(`/api/bracket/tournament/${tournament.id}`, { method: 'PUT', body });
          toast('Tournament updated');
        } else {
          await api('/api/bracket/tournament', { method: 'POST', body });
          toast('Tournament created');
        }
        await loadAll();
      } catch (err) { toast(err.message); }
    });
  }

  /* ─ Seed Teams ─ */
  function renderTeamsTab() {
    let html = '<div class="seed-grid">';
    for (const region of BS.REGIONS) {
      html += `<div class="seed-region"><h4>${region}</h4>`;
      for (let s = 1; s <= 16; s++) {
        const ex = teamsMap[`${region}-${s}`];
        html += `<div class="seed-row">
          <span class="seed-num">${s}</span>
          <input id="team-${region}-${s}" placeholder="Team name" value="${ex ? esc(ex.team_name) : ''}" />
        </div>`;
      }
      html += '</div>';
    }
    html += '</div>';
    html += '<div style="margin-top:16px"><button onclick="saveTeams()" class="btn btn-primary">Save All 64 Teams</button></div>';
    $('admin-content').innerHTML = html;
  }

  window.saveTeams = async function () {
    if (!tournament) { toast('Create tournament first'); return; }
    const list = [];
    for (const region of BS.REGIONS) {
      for (let s = 1; s <= 16; s++) {
        const name = document.getElementById(`team-${region}-${s}`).value.trim();
        if (!name) { toast(`Missing team: ${region} #${s}`); return; }
        list.push({
          seed: s, region, team_name: name,
          short_name: name.length > 14 ? name.substring(0, 14) : name,
          abbreviation: name.substring(0, 4).toUpperCase(),
        });
      }
    }
    try {
      await api(`/api/bracket/teams/${tournament.id}`, { method: 'POST', body: { teams: list } });
      toast('64 teams seeded + 63 games initialized!');
      await loadAll();
    } catch (err) { toast(err.message); }
  };

  /* ─ Roster / Payment ─ */
  async function renderRosterTab() {
    if (!tournament) { $('admin-content').innerHTML = '<p>No tournament.</p>'; return; }
    try {
      const d = await api(`/api/bracket/admin/entries/${tournament.id}`);
      const entries = d.entries || [];
      if (!entries.length) { $('admin-content').innerHTML = '<p>No entries yet.</p>'; return; }

      const paidCount = entries.filter(e => e.paid).length;
      let html = `<p style="margin-bottom:12px">${entries.length} entries · ${paidCount} paid</p>`;
      html += `<table class="roster-table"><thead><tr>
        <th>Name</th><th>Auth</th><th>Submitted</th><th>Paid</th><th>Actions</th>
      </tr></thead><tbody>`;

      for (const e of entries) {
        html += `<tr>
          <td>${esc(e.display_name || e.email || 'Unknown')}</td>
          <td>${e.auth_type}</td>
          <td>${e.submitted_at ? '✓' : '—'}</td>
          <td><span class="paid-badge ${e.paid ? 'paid-yes' : 'paid-no'}">${e.paid ? 'PAID' : 'UNPAID'}</span></td>
          <td>
            <button onclick="togglePayment('${e.id}', ${!e.paid})" class="btn btn-sm ${e.paid ? 'btn-outline' : 'btn-green'}">${e.paid ? 'Mark Unpaid' : 'Mark Paid'}</button>
            <button onclick="removeEntry('${e.id}')" class="btn btn-sm btn-danger">Remove</button>
          </td>
        </tr>`;
      }
      html += '</tbody></table>';
      $('admin-content').innerHTML = html;
    } catch (err) { $('admin-content').innerHTML = `<p>Error: ${esc(err.message)}</p>`; }
  }

  window.togglePayment = async function (id, paid) {
    try {
      await api(`/api/bracket/admin/payment/${id}`, { method: 'POST', body: { paid } });
      toast(paid ? 'Marked as paid' : 'Marked as unpaid');
      renderRosterTab();
    } catch (err) { toast(err.message); }
  };

  window.removeEntry = async function (id) {
    if (!confirm('Remove this entry from the pool?')) return;
    try {
      await api(`/api/bracket/admin/entry/${id}`, { method: 'DELETE' });
      toast('Entry removed');
      renderRosterTab();
    } catch (err) { toast(err.message); }
  };

  /* ─ Results ─ */
  function renderResultsTab() {
    if (!tournament) { $('admin-content').innerHTML = '<p>No tournament.</p>'; return; }
    if (!teams.length) { $('admin-content').innerHTML = '<p>Seed teams first.</p>'; return; }

    let html = '';
    for (let round = 0; round <= 6; round++) {
      const rGames = BS.getRoundGames(round);
      html += `<h4 style="margin:16px 0 8px;color:var(--accent)">${BS.ROUND_NAMES[round]}</h4>`;
      html += '<div style="display:flex;flex-direction:column;gap:6px">';

      for (const gn of rGames) {
        const gr = gamesMap[gn];
        const topT = gr?.top_team_id  ? teamsMap[`id-${gr.top_team_id}`]  : null;
        const botT = gr?.bottom_team_id ? teamsMap[`id-${gr.bottom_team_id}`] : null;
        const decided = gr?.winner_id;
        const winner  = decided ? teamsMap[`id-${gr.winner_id}`] : null;

        html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-card);border-radius:6px;flex-wrap:wrap">
          <span style="color:var(--text-secondary);font-size:12px;min-width:28px">#${gn}</span>`;

        if (!topT || !botT) {
          html += '<span style="color:var(--text-secondary);font-size:13px">Waiting for results…</span>';
        } else {
          const topWon = decided && String(gr.winner_id) === String(topT.id);
          const botWon = decided && String(gr.winner_id) === String(botT.id);
          html += `
            <button onclick="postResult(${gn},'${topT.id}')" class="btn btn-sm ${topWon ? 'btn-green' : 'btn-outline'}" ${decided ? 'disabled' : ''}>
              (${topT.seed}) ${esc(topT.short_name || topT.team_name)}
            </button>
            <span style="color:var(--text-secondary);font-size:12px">vs</span>
            <button onclick="postResult(${gn},'${botT.id}')" class="btn btn-sm ${botWon ? 'btn-green' : 'btn-outline'}" ${decided ? 'disabled' : ''}>
              (${botT.seed}) ${esc(botT.short_name || botT.team_name)}
            </button>`;
          if (decided) {
            html += `<span style="color:var(--green);font-size:12px;margin-left:auto">✓ ${esc(winner?.short_name || winner?.team_name || '')}</span>`;
          }
        }
        html += '</div>';
      }
      html += '</div>';
    }
    $('admin-content').innerHTML = html;
  }

  window.postResult = async function (gameNumber, winnerId) {
    if (!confirm('Set this team as the winner? This advances them and recalculates all scores.')) return;
    try {
      await api(`/api/bracket/games/${tournament.id}/${gameNumber}/result`, {
        method: 'POST', body: { winnerId },
      });
      toast('Result saved!');
      // Reload games + teams (elimination flags may change)
      const [gData, tData] = await Promise.all([
        api(`/api/bracket/games/${tournament.id}`),
        api(`/api/bracket/teams/${tournament.id}`),
      ]);
      games = gData.games || [];
      teams = tData.teams || [];
      buildTeamsMap();
      buildGamesMap();
      renderResultsTab();
    } catch (err) { toast(err.message); }
  };

  /* ═══════════ Modal ═══════════ */
  window.closeModal = function (id) { $(id).classList.add('hidden'); };

  /* ═══════════ Util ═══════════ */
  function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
})();
