/* ═══════════════════════════════════════════════
   TheGamblingKing Bet Slip — Frontend JavaScript
   ═══════════════════════════════════════════════ */

const SPORTS = [
  { name: 'NFL', value: 'nfl' },
  { name: 'NBA', value: 'nba' },
  { name: 'MLB', value: 'mlb' },
  { name: 'NHL', value: 'nhl' },
  { name: 'NCAA Football', value: 'ncaa_football' },
  { name: "NCAA Men's Basketball", value: 'ncaa_mbb' },
  { name: "NCAA Women's Basketball", value: 'ncaa_wbb' },
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
];

let currentUser = null;

// ── Format datetime-local value into readable string ──
function formatDateTimePretty(datetimeStr) {
  if (!datetimeStr) return '';
  const dt = new Date(datetimeStr);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = days[dt.getDay()];
  const month = months[dt.getMonth()];
  const date = dt.getDate();
  let hours = dt.getHours();
  const minutes = dt.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;

  // Detect user timezone abbreviation
  const tz = Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(dt)
    .find(p => p.type === 'timeZoneName')?.value || '';

  return `${day} ${month} ${date} ${hours}:${minutes} ${ampm} ${tz}`.trim();
}

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('/api/me');
    if (res.ok) {
      currentUser = await res.json();
      showApp();
    } else {
      showLogin();
    }
  } catch (e) {
    showLogin();
  }
});

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-screen').classList.add('hidden');
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');

  // Set user info
  document.getElementById('user-avatar').src = currentUser.avatar;
  document.getElementById('user-name').textContent = currentUser.displayName;

  // Populate guilds
  const guildSelect = document.getElementById('guild-select');
  currentUser.guilds.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.name;
    guildSelect.appendChild(opt);
  });

  // Populate sports
  const sportSelect = document.getElementById('sport-select');
  SPORTS.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.value;
    opt.textContent = s.name;
    sportSelect.appendChild(opt);
  });

  // Event listeners
  setupEventListeners();
}

function setupEventListeners() {
  const guildSelect = document.getElementById('guild-select');
  const channelSelect = document.getElementById('channel-select');
  const betType = document.getElementById('bet-type');
  const betCategory = document.getElementById('bet-category');
  const wagerType = document.getElementById('wager-type');
  const form = document.getElementById('bet-form');

  // Guild change → load channels
  guildSelect.addEventListener('change', async () => {
    channelSelect.innerHTML = '<option value="" disabled selected>Loading...</option>';
    channelSelect.disabled = true;

    try {
      const res = await fetch(`/api/guilds/${guildSelect.value}/channels`);
      const channels = await res.json();

      channelSelect.innerHTML = '<option value="" disabled selected>Select channel</option>';
      
      // Group by category
      const grouped = {};
      channels.forEach(c => {
        const cat = c.category || 'General';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(c);
      });

      Object.entries(grouped).forEach(([cat, chs]) => {
        const group = document.createElement('optgroup');
        group.label = cat;
        chs.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.id;
          opt.textContent = `#${c.name}`;
          group.appendChild(opt);
        });
        channelSelect.appendChild(group);
      });

      channelSelect.disabled = false;
    } catch (e) {
      channelSelect.innerHTML = '<option value="" disabled selected>Error loading channels</option>';
      showToast('Failed to load channels');
    }
  });

  // Bet type change
  betType.addEventListener('change', () => {
    const isParlay = betType.value === 'parlay';
    document.getElementById('parlay-count-row').classList.toggle('hidden', !isParlay);
    document.getElementById('single-fields').classList.toggle('hidden', isParlay);
    document.getElementById('parlay-legs-container').classList.toggle('hidden', !isParlay);
    document.getElementById('parlay-totals').classList.toggle('hidden', !isParlay);

    if (isParlay) {
      buildParlayLegs();
    }
  });

  // Parlay legs count change
  document.getElementById('parlay-legs-count').addEventListener('change', buildParlayLegs);

  // Bet category change (single)
  betCategory.addEventListener('change', () => {
    updateCategoryFields(betCategory.value);
  });

  // Wager type change (single)
  wagerType.addEventListener('change', () => {
    updateWagerFields(wagerType.value);
  });

  // Over/Under toggles
  document.querySelectorAll('#over-under-row .toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#over-under-row .toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Single bet datetime picker
  const singlePicker = document.getElementById('event-time-picker');
  singlePicker.addEventListener('change', () => {
    document.getElementById('event-time').value = formatDateTimePretty(singlePicker.value);
    singlePicker.value = '';
  });

  // Form submit
  form.addEventListener('submit', handleSubmit);
}

// ── Category / Wager Field Visibility ──
function updateCategoryFields(category) {
  document.getElementById('team-fields').classList.add('hidden');
  document.getElementById('prop-fields').classList.add('hidden');
  document.getElementById('futures-fields').classList.add('hidden');

  const wagerGroup = document.getElementById('wager-type-group');

  if (category === 'team_game') {
    document.getElementById('team-fields').classList.remove('hidden');
    wagerGroup.classList.remove('hidden');
    document.getElementById('wager-type').required = true;
  } else if (category === 'player_prop') {
    document.getElementById('prop-fields').classList.remove('hidden');
    wagerGroup.classList.add('hidden');
    document.getElementById('wager-type').required = false;
    document.getElementById('over-under-row').classList.add('hidden');
    document.getElementById('spread-line-row').classList.add('hidden');
  } else if (category === 'futures') {
    document.getElementById('futures-fields').classList.remove('hidden');
    wagerGroup.classList.add('hidden');
    document.getElementById('wager-type').required = false;
    document.getElementById('over-under-row').classList.add('hidden');
    document.getElementById('spread-line-row').classList.add('hidden');
  }
}

function updateWagerFields(wager) {
  const spreadRow = document.getElementById('spread-line-row');
  const ouRow = document.getElementById('over-under-row');
  const spreadLabel = document.getElementById('spread-label');

  if (wager === 'spread') {
    spreadRow.classList.remove('hidden');
    ouRow.classList.add('hidden');
    spreadLabel.textContent = 'Spread';
    document.getElementById('spread-value').placeholder = 'e.g. -1.5, +3, -7';
  } else if (wager === 'total') {
    spreadRow.classList.remove('hidden');
    ouRow.classList.remove('hidden');
    spreadLabel.textContent = 'Total Line';
    document.getElementById('spread-value').placeholder = 'e.g. 220.5, 48.5';
  } else {
    spreadRow.classList.add('hidden');
    ouRow.classList.add('hidden');
  }
}

// ── Parlay Leg Builder ──
function buildParlayLegs() {
  const count = parseInt(document.getElementById('parlay-legs-count').value);
  const container = document.getElementById('parlay-legs-container');
  container.innerHTML = '';

  for (let i = 1; i <= count; i++) {
    const card = document.createElement('div');
    card.className = 'parlay-leg-card';
    card.innerHTML = `
      <div class="leg-header">
        <span class="leg-number">${i}</span>
        Leg ${i}
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>Sport</label>
          <select class="leg-sport" data-leg="${i}" required>
            <option value="" disabled selected>Select sport</option>
            ${SPORTS.map(s => `<option value="${s.value}">${s.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Category</label>
          <select class="leg-category" data-leg="${i}" required>
            <option value="" disabled selected>Select category</option>
            <option value="team_game">🏟️ Team Game</option>
            <option value="player_prop">🏀 Player Prop</option>
            <option value="futures">🏆 Futures</option>
          </select>
        </div>
      </div>

      <!-- Wager type (shown for team game) -->
      <div class="form-row leg-wager-row-${i} hidden">
        <div class="form-group">
          <label>Wager Type</label>
          <select class="leg-wager-type" data-leg="${i}">
            <option value="moneyline">💰 Moneyline</option>
            <option value="spread">📊 Spread</option>
            <option value="total">🔢 Over/Under</option>
          </select>
        </div>
      </div>

      <!-- Over/Under toggle -->
      <div class="form-row leg-ou-row-${i} hidden">
        <div class="form-group">
          <label>Direction</label>
          <div class="toggle-group">
            <button type="button" class="toggle-btn leg-ou-btn active" data-leg="${i}" data-value="Over">⬆️ Over</button>
            <button type="button" class="toggle-btn leg-ou-btn" data-leg="${i}" data-value="Under">⬇️ Under</button>
          </div>
        </div>
      </div>

      <!-- Team fields -->
      <div class="leg-team-fields-${i} hidden">
        <div class="form-row">
          <div class="form-group">
            <label>Team A (your pick)</label>
            <input type="text" class="leg-team-a" data-leg="${i}" placeholder="e.g. Duke" maxlength="100">
          </div>
          <div class="form-group">
            <label>Team B (opponent)</label>
            <input type="text" class="leg-team-b" data-leg="${i}" placeholder="e.g. UNC" maxlength="100">
          </div>
        </div>
        <div class="form-row leg-spread-row-${i} hidden">
          <div class="form-group">
            <label class="leg-spread-label-${i}">Spread</label>
            <input type="text" class="leg-spread-value" data-leg="${i}" placeholder="e.g. -1.5" maxlength="10">
          </div>
        </div>
      </div>

      <!-- Prop fields -->
      <div class="leg-prop-fields-${i} hidden">
        <div class="form-row">
          <div class="form-group">
            <label>Player Name</label>
            <input type="text" class="leg-player-name" data-leg="${i}" placeholder="e.g. LeBron James" maxlength="100">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group full-width">
            <label>Prop Description</label>
            <input type="text" class="leg-prop-desc" data-leg="${i}" placeholder="e.g. Over 25.5 Points" maxlength="200">
          </div>
        </div>
      </div>

      <!-- Futures fields -->
      <div class="leg-futures-fields-${i} hidden">
        <div class="form-row">
          <div class="form-group">
            <label>Market</label>
            <input type="text" class="leg-futures-market" data-leg="${i}" placeholder="e.g. Super Bowl LIX Winner" maxlength="200">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Selection / Pick</label>
            <input type="text" class="leg-futures-selection" data-leg="${i}" placeholder="e.g. Chiefs" maxlength="100">
          </div>
        </div>
      </div>

      <!-- Game time -->
      <div class="form-row">
        <div class="form-group">
          <label>Game Start Time <span class="optional">(optional)</span></label>
          <div class="datetime-input-wrap">
            <input type="text" class="leg-event-time" data-leg="${i}" placeholder="e.g. Sun 1:00 PM ET" maxlength="50">
            <input type="datetime-local" class="datetime-picker-hidden leg-event-picker" data-leg="${i}">
            <button type="button" class="btn-calendar" data-leg="${i}" title="Pick date & time">📅</button>
          </div>
        </div>
      </div>
    `;
    container.appendChild(card);

    // Wire up category change for this leg
    card.querySelector('.leg-category').addEventListener('change', (e) => {
      const leg = e.target.dataset.leg;
      const cat = e.target.value;

      document.querySelector(`.leg-team-fields-${leg}`).classList.toggle('hidden', cat !== 'team_game');
      document.querySelector(`.leg-prop-fields-${leg}`).classList.toggle('hidden', cat !== 'player_prop');
      document.querySelector(`.leg-futures-fields-${leg}`).classList.toggle('hidden', cat !== 'futures');
      document.querySelector(`.leg-wager-row-${leg}`).classList.toggle('hidden', cat !== 'team_game');
      document.querySelector(`.leg-ou-row-${leg}`).classList.add('hidden');
      document.querySelector(`.leg-spread-row-${leg}`).classList.add('hidden');
    });

    // Wire up wager type for this leg
    card.querySelector('.leg-wager-type').addEventListener('change', (e) => {
      const leg = e.target.dataset.leg;
      const wager = e.target.value;

      const spreadRow = document.querySelector(`.leg-spread-row-${leg}`);
      const ouRow = document.querySelector(`.leg-ou-row-${leg}`);
      const spreadLabel = document.querySelector(`.leg-spread-label-${leg}`);

      if (wager === 'spread') {
        spreadRow.classList.remove('hidden');
        ouRow.classList.add('hidden');
        spreadLabel.textContent = 'Spread';
      } else if (wager === 'total') {
        spreadRow.classList.remove('hidden');
        ouRow.classList.remove('hidden');
        spreadLabel.textContent = 'Total Line';
      } else {
        spreadRow.classList.add('hidden');
        ouRow.classList.add('hidden');
      }
    });

    // Wire up over/under toggles
    card.querySelectorAll('.leg-ou-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const leg = btn.dataset.leg;
        card.querySelectorAll(`.leg-ou-btn[data-leg="${leg}"]`).forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Wire up calendar picker for this leg
    const legCalBtn = card.querySelector(`.btn-calendar[data-leg="${i}"]`);
    const legPicker = card.querySelector(`.leg-event-picker[data-leg="${i}"]`);
    const legTimeInput = card.querySelector(`.leg-event-time[data-leg="${i}"]`);

    legCalBtn.addEventListener('click', () => legPicker.showPicker());
    legPicker.addEventListener('change', () => {
      legTimeInput.value = formatDateTimePretty(legPicker.value);
      legPicker.value = '';
    });
  }
}

// ── Form Submit ──
async function handleSubmit(e) {
  e.preventDefault();

  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;
  submitBtn.querySelector('.btn-text').classList.add('hidden');
  submitBtn.querySelector('.btn-loading').classList.remove('hidden');

  try {
    const betTypeVal = document.getElementById('bet-type').value;
    const guildId = document.getElementById('guild-select').value;
    const channelId = document.getElementById('channel-select').value;
    const isWhale = document.getElementById('is-whale').checked;

    if (!guildId || !channelId) {
      throw new Error('Please select a server and channel');
    }

    let body;

    if (betTypeVal === 'parlay') {
      // Build parlay data
      const count = parseInt(document.getElementById('parlay-legs-count').value);
      const legs = [];

      for (let i = 1; i <= count; i++) {
        const sport = document.querySelector(`.leg-sport[data-leg="${i}"]`).value;
        const category = document.querySelector(`.leg-category[data-leg="${i}"]`).value;

        if (!sport || !category) throw new Error(`Leg ${i}: Select sport and category`);

        const leg = {
          sport,
          betCategory: category,
          eventStartTime: document.querySelector(`.leg-event-time[data-leg="${i}"]`)?.value || null,
        };

        if (category === 'team_game') {
          const wager = document.querySelector(`.leg-wager-type[data-leg="${i}"]`).value;
          leg.wagerType = wager;
          leg.teamA = document.querySelector(`.leg-team-a[data-leg="${i}"]`)?.value;
          leg.teamB = document.querySelector(`.leg-team-b[data-leg="${i}"]`)?.value;
          if (!leg.teamA || !leg.teamB) throw new Error(`Leg ${i}: Enter both teams`);

          if (wager === 'spread' || wager === 'total') {
            leg.spreadValue = document.querySelector(`.leg-spread-value[data-leg="${i}"]`)?.value;
            if (!leg.spreadValue) throw new Error(`Leg ${i}: Enter ${wager === 'spread' ? 'spread' : 'total line'}`);
          }
          if (wager === 'total') {
            const activeOU = document.querySelector(`.leg-ou-btn[data-leg="${i}"].active`);
            leg.overUnder = activeOU ? activeOU.dataset.value : 'Over';
          }
        } else if (category === 'player_prop') {
          leg.wagerType = 'prop';
          leg.playerName = document.querySelector(`.leg-player-name[data-leg="${i}"]`)?.value;
          leg.propDescription = document.querySelector(`.leg-prop-desc[data-leg="${i}"]`)?.value;
          if (!leg.playerName || !leg.propDescription) throw new Error(`Leg ${i}: Enter player name and prop`);
        } else if (category === 'futures') {
          leg.wagerType = 'futures';
          leg.futuresMarket = document.querySelector(`.leg-futures-market[data-leg="${i}"]`)?.value;
          leg.futuresSelection = document.querySelector(`.leg-futures-selection[data-leg="${i}"]`)?.value;
          if (!leg.futuresMarket || !leg.futuresSelection) throw new Error(`Leg ${i}: Enter market and selection`);
        }

        legs.push(leg);
      }

      const parlayOdds = document.getElementById('parlay-odds').value;
      const parlayUnits = document.getElementById('parlay-units').value;
      if (!parlayOdds || !parlayUnits) throw new Error('Enter parlay total odds and units');

      body = {
        guildId,
        channelId,
        betType: 'parlay',
        sport: legs[0].sport,
        oddsAmerican: parlayOdds,
        units: parlayUnits,
        betNote: document.getElementById('parlay-note').value || null,
        isWhale,
        legs,
      };
    } else {
      // Single bet
      const sport = document.getElementById('sport-select').value;
      const category = document.getElementById('bet-category').value;
      if (!sport || !category) throw new Error('Select sport and category');

      body = {
        guildId,
        channelId,
        betType: 'single',
        sport,
        betCategory: category,
        isWhale,
        eventStartTime: document.getElementById('event-time').value || null,
        betNote: document.getElementById('bet-note').value || null,
      };

      if (category === 'team_game') {
        const wager = document.getElementById('wager-type').value;
        body.wagerType = wager;
        body.teamA = document.getElementById('team-a').value;
        body.teamB = document.getElementById('team-b').value;
        if (!body.teamA || !body.teamB) throw new Error('Enter both teams');

        if (wager === 'spread' || wager === 'total') {
          body.spreadValue = document.getElementById('spread-value').value;
          if (!body.spreadValue) throw new Error(`Enter ${wager === 'spread' ? 'spread' : 'total line'}`);
        }
        if (wager === 'total') {
          const activeOU = document.querySelector('#over-under-row .toggle-btn.active');
          body.overUnder = activeOU ? activeOU.dataset.value : 'Over';
        }
      } else if (category === 'player_prop') {
        body.wagerType = 'prop';
        body.playerName = document.getElementById('player-name').value;
        body.propDescription = document.getElementById('prop-desc').value;
        if (!body.playerName || !body.propDescription) throw new Error('Enter player name and prop');
      } else if (category === 'futures') {
        body.wagerType = 'futures';
        body.futuresMarket = document.getElementById('futures-market').value;
        body.futuresSelection = document.getElementById('futures-selection').value;
        if (!body.futuresMarket || !body.futuresSelection) throw new Error('Enter market and selection');
      }

      body.oddsAmerican = document.getElementById('odds').value;
      body.units = document.getElementById('units').value;
      if (!body.oddsAmerican || !body.units) throw new Error('Enter odds and units');
    }

    const res = await fetch('/api/bets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Failed to place bet');

    // Show success
    document.getElementById('bet-form').classList.add('hidden');
    document.getElementById('success-msg').classList.remove('hidden');
    document.getElementById('success-detail').textContent = `Slip ${data.slipNumber} has been posted to Discord!`;

  } catch (err) {
    showToast(err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.querySelector('.btn-text').classList.remove('hidden');
    submitBtn.querySelector('.btn-loading').classList.add('hidden');
  }
}

// ── Reset Form ──
function resetForm() {
  document.getElementById('bet-form').reset();
  document.getElementById('bet-form').classList.remove('hidden');
  document.getElementById('success-msg').classList.add('hidden');

  // Reset dynamic fields
  document.getElementById('team-fields').classList.add('hidden');
  document.getElementById('prop-fields').classList.add('hidden');
  document.getElementById('futures-fields').classList.add('hidden');
  document.getElementById('spread-line-row').classList.add('hidden');
  document.getElementById('over-under-row').classList.add('hidden');
  document.getElementById('parlay-count-row').classList.add('hidden');
  document.getElementById('single-fields').classList.remove('hidden');
  document.getElementById('parlay-legs-container').classList.add('hidden');
  document.getElementById('parlay-totals').classList.add('hidden');
  document.getElementById('wager-type-group').classList.remove('hidden');
}

// ── Toast ──
function showToast(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 4000);
}

// ═══════════════════════════════════════════════
//  Page Navigation
// ═══════════════════════════════════════════════

function switchPage(page) {
  // Toggle nav links
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.querySelector(`.nav-link[data-page="${page}"]`).classList.add('active');

  // All pages
  const pages = {
    slip: document.getElementById('slip-page'),
    stats: document.getElementById('stats-page'),
    bets: document.getElementById('bets-page'),
    reminders: document.getElementById('reminders-page'),
    tools: document.getElementById('tools-page'),
  };

  // Hide all, show selected
  Object.entries(pages).forEach(([key, el]) => {
    if (!el) return;
    if (key === page) el.classList.remove('hidden');
    else el.classList.add('hidden');
  });

  // Lazy init
  if (page === 'stats') initStatsPage();
  if (page === 'bets') initBetsPage();
  if (page === 'reminders') initRemindersPage();
}

// ═══════════════════════════════════════════════
//  Stats Dashboard
// ═══════════════════════════════════════════════

let statsInitialized = false;

function initStatsPage() {
  if (statsInitialized) return;
  statsInitialized = true;

  // Populate guild dropdown (reuse from currentUser)
  const statsGuild = document.getElementById('stats-guild');
  currentUser.guilds.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.name;
    statsGuild.appendChild(opt);
  });

  // Auto-select first guild
  if (currentUser.guilds.length > 0) {
    statsGuild.value = currentUser.guilds[0].id;
    loadStatsUsers(currentUser.guilds[0].id);
    loadStats();
    loadLeaderboard();
  }

  // Events
  statsGuild.addEventListener('change', () => {
    loadStatsUsers(statsGuild.value);
    loadStats();
    loadLeaderboard();
  });

  document.getElementById('stats-period').addEventListener('change', loadStats);
  document.getElementById('stats-user').addEventListener('change', loadStats);
}

async function loadStatsUsers(guildId) {
  const userSelect = document.getElementById('stats-user');
  userSelect.innerHTML = '<option value="">Me</option>';

  try {
    const res = await fetch(`/api/guilds/${guildId}/users`);
    const users = await res.json();
    users.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.name;
      userSelect.appendChild(opt);
    });
  } catch (e) {}
}

async function loadStats() {
  const guildId = document.getElementById('stats-guild').value;
  const period = document.getElementById('stats-period').value;
  const userId = document.getElementById('stats-user').value || '';

  if (!guildId) return;

  document.getElementById('stats-content').classList.add('hidden');
  document.getElementById('stats-empty').classList.add('hidden');
  document.getElementById('stats-loading').classList.remove('hidden');

  try {
    const params = new URLSearchParams({ period });
    if (userId) params.set('userId', userId);

    const res = await fetch(`/api/guilds/${guildId}/stats?${params}`);
    const data = await res.json();

    document.getElementById('stats-loading').classList.add('hidden');

    if (data.empty) {
      document.getElementById('stats-empty').classList.remove('hidden');
      return;
    }

    document.getElementById('stats-content').classList.remove('hidden');
    renderStats(data);
  } catch (err) {
    document.getElementById('stats-loading').classList.add('hidden');
    showToast('Failed to load stats');
  }
}

function fmtU(v) {
  const n = Number(v);
  return Number.isFinite(n) ? parseFloat(n.toFixed(2)) : v;
}

function fmtNet(v) {
  return `${v >= 0 ? '+' : ''}${fmtU(v)}u`;
}

function renderStats(data) {
  const o = data.overview;

  // KPIs
  document.getElementById('kpi-record').textContent = `${o.wins}W-${o.losses}L-${o.pushes}P`;
  setKPI('kpi-winpct', `${o.winPct}%`);
  setKPI('kpi-net', fmtNet(o.netUnits), o.netUnits);
  setKPI('kpi-roi', `${o.roi}%`, o.roi);
  document.getElementById('kpi-total').textContent = o.total;
  document.getElementById('kpi-open').textContent = o.open;

  // Highlights
  const s = data.streak;
  const streakEl = document.getElementById('hl-streak');
  if (s.count > 0) {
    streakEl.textContent = `${s.count} ${s.type === 'win' ? '🔥 W' : '❄️ L'}`;
    streakEl.className = `highlight-value ${s.type === 'win' ? 'positive' : 'negative'}`;
  } else {
    streakEl.textContent = '—';
    streakEl.className = 'highlight-value';
  }

  document.getElementById('hl-avg-odds').textContent = data.avgOdds >= 0 ? `+${data.avgOdds}` : data.avgOdds;
  document.getElementById('hl-avg-units').textContent = `${data.avgUnits}u`;
  document.getElementById('hl-wagered').textContent = `${fmtU(o.unitsWagered)}u`;

  // Best / Worst
  if (data.bestBet) {
    document.getElementById('hl-best').textContent = `${fmtNet(data.bestBet.payout)}`;
    document.getElementById('hl-best').className = 'highlight-value positive';
    document.getElementById('hl-best-detail').textContent = `${data.bestBet.pick} (${data.bestBet.odds >= 0 ? '+' : ''}${data.bestBet.odds})`;
  }
  if (data.worstBet) {
    document.getElementById('hl-worst').textContent = `${fmtNet(data.worstBet.payout)}`;
    document.getElementById('hl-worst').className = 'highlight-value negative';
    document.getElementById('hl-worst-detail').textContent = `${data.worstBet.pick} (${data.worstBet.odds >= 0 ? '+' : ''}${data.worstBet.odds})`;
  }

  // Bet type breakdown
  renderBreakdown('bet-type-breakdown', [
    { name: '🎰 Singles', ...data.singles },
    { name: '🎲 Parlays', ...data.parlays },
  ].filter(r => r.total > 0), data.overview.total);

  // By sport
  renderBreakdown('sport-breakdown', data.bySport.map(s => ({ name: s.name, ...s })), data.overview.total);

  // By wager
  renderBreakdown('wager-breakdown', data.byWager.map(w => ({ name: w.name, ...w })), data.overview.total);

  // Whale stats
  const whaleSec = document.getElementById('whale-section');
  if (data.whaleStats) {
    whaleSec.classList.remove('hidden');
    const whaleRows = [{ name: '🐋 Whale Bets', ...data.whaleStats }];
    if (data.normalStats.total > 0) whaleRows.push({ name: '📋 Normal Bets', ...data.normalStats });
    renderBreakdown('whale-breakdown', whaleRows, data.overview.total);
  } else {
    whaleSec.classList.add('hidden');
  }

  // Tail stats
  const tailSec = document.getElementById('tail-section');
  if (data.tailStats) {
    tailSec.classList.remove('hidden');
    const t = data.tailStats;
    document.getElementById('tail-breakdown').innerHTML = `
      <div class="breakdown-row">
        <span class="breakdown-name">🔗 Tails</span>
        <div class="breakdown-bar-wrap">
          <div class="breakdown-bar ${t.tail_win_pct >= 50 ? 'green' : 'red'}" style="width:${t.tail_win_pct}%"></div>
        </div>
        <span class="breakdown-stats">
          ${t.tail_wins}W-${t.tail_losses}L-${t.tail_pushes}P | ${t.tail_win_pct}% |
          <span class="breakdown-net ${t.tail_net_units >= 0 ? 'positive' : 'negative'}">${fmtNet(t.tail_net_units)}</span>
        </span>
      </div>
    `;
  } else {
    tailSec.classList.add('hidden');
  }

  // Daily P&L
  const tbody = document.getElementById('pnl-tbody');
  tbody.innerHTML = '';
  const pnl = data.dailyPnL.slice(-30);
  for (const day of pnl.reverse()) {
    const tr = document.createElement('tr');
    const netClass = day.net >= 0 ? 'pnl-positive' : 'pnl-negative';
    tr.innerHTML = `
      <td>${day.date}</td>
      <td>${day.bets}</td>
      <td>${day.wins}</td>
      <td>${day.losses}</td>
      <td class="${netClass}">${fmtNet(day.net)}</td>
    `;
    tbody.appendChild(tr);
  }

  // Recent bets
  const recentEl = document.getElementById('recent-bets');
  recentEl.innerHTML = '';
  const statusEmoji = { open: '🟡', win: '✅', loss: '❌', push: '🔄' };
  for (const bet of data.recentBets) {
    const div = document.createElement('div');
    div.className = 'recent-bet-row';
    div.innerHTML = `
      <div class="recent-bet-info">
        <span class="recent-bet-status">${statusEmoji[bet.status] || '⚪'}</span>
        <div>
          <div class="recent-bet-pick">${bet.pick || '—'}${bet.betType === 'parlay' ? ` (${bet.legs}L parlay)` : ''}</div>
          <div class="recent-bet-sport">${bet.sport} • ${bet.slipNumber}</div>
        </div>
      </div>
      ${bet.isWhale ? '<span class="recent-bet-whale">🐋</span>' : ''}
      <div class="recent-bet-details">
        <div class="recent-bet-odds">${bet.odds >= 0 ? '+' : ''}${bet.odds}</div>
        <div class="recent-bet-units">${bet.units}u</div>
      </div>
    `;
    recentEl.appendChild(div);
  }
}

function setKPI(id, text, value) {
  const el = document.getElementById(id);
  el.textContent = text;
  if (value !== undefined) {
    el.classList.remove('positive', 'negative');
    if (value > 0) el.classList.add('positive');
    else if (value < 0) el.classList.add('negative');
  }
}

function renderBreakdown(containerId, rows, totalBets) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  for (const row of rows) {
    const pct = totalBets > 0 ? Math.round((row.total / totalBets) * 100) : 0;
    const div = document.createElement('div');
    div.className = 'breakdown-row';
    div.innerHTML = `
      <span class="breakdown-name">${row.name} (${row.total})</span>
      <div class="breakdown-bar-wrap">
        <div class="breakdown-bar ${row.winPct >= 50 ? 'green' : 'red'}" style="width:${row.winPct}%"></div>
      </div>
      <span class="breakdown-stats">
        ${row.wins}W-${row.losses}L-${row.pushes}P | ${row.winPct}% |
        <span class="breakdown-net ${row.netUnits >= 0 ? 'positive' : 'negative'}">${fmtNet(row.netUnits)}</span>
        | ROI ${row.roi}%
      </span>
    `;
    container.appendChild(div);
  }
}

async function loadLeaderboard() {
  const guildId = document.getElementById('stats-guild').value;
  if (!guildId) return;

  const container = document.getElementById('leaderboard-list');
  container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)">Loading...</div>';

  try {
    const res = await fetch(`/api/guilds/${guildId}/leaderboard`);
    const data = await res.json();

    container.innerHTML = '';
    if (!data || data.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)">No data yet</div>';
      return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    data.forEach((entry, i) => {
      const div = document.createElement('div');
      div.className = 'lb-row';
      const net = entry.net_units || 0;
      div.innerHTML = `
        <span class="lb-rank">${medals[i] || (i + 1)}</span>
        <span class="lb-name">${entry.discord_username || 'Unknown'}</span>
        <span class="lb-record">${entry.wins || 0}W-${entry.losses || 0}L-${entry.pushes || 0}P | ${entry.win_pct || 0}%</span>
        <span class="lb-net ${net >= 0 ? 'positive' : 'negative'}">${fmtNet(net)}</span>
      `;
      container.appendChild(div);
    });
  } catch (e) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-danger)">Failed to load</div>';
  }
}

// ═══════════════════════════════════════════════
//  MY BETS PAGE
// ═══════════════════════════════════════════════

const SPORT_NAMES = {
  nfl: 'NFL', nba: 'NBA', mlb: 'MLB', nhl: 'NHL',
  ncaa_football: 'NCAA FB', ncaa_mbb: 'NCAA MBB', ncaa_wbb: 'NCAA WBB',
  mls: 'MLS', epl: 'EPL', la_liga: 'La Liga', ucl: 'UCL',
  ufc: 'UFC', boxing: 'Boxing', tennis: 'Tennis', golf: 'Golf',
  nascar: 'NASCAR', wnba: 'WNBA', esports: 'Esports', other: 'Other'
};

const STATUS_EMOJI = { open: '🟡', win: '✅', loss: '❌', push: '🔄', void: '⛔' };

let betsInitialized = false;

function initBetsPage() {
  if (betsInitialized) return;
  betsInitialized = true;

  const sel = document.getElementById('bets-guild');
  sel.innerHTML = '<option value="">Server</option>';
  currentUser.guilds.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.name;
    sel.appendChild(opt);
  });

  if (currentUser.guilds.length > 0) {
    sel.value = currentUser.guilds[0].id;
    loadBets();
  }
}

async function loadBets() {
  const guildId = document.getElementById('bets-guild').value;
  if (!guildId) return;

  const status = document.getElementById('bets-status').value;
  const sport = document.getElementById('bets-sport').value;
  const search = document.getElementById('bets-search').value.trim();

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (sport) params.set('sport', sport);
  if (search) params.set('search', search);

  const container = document.getElementById('bets-list');
  container.innerHTML = '<p class="empty-state">Loading...</p>';

  try {
    const res = await fetch(`/api/guilds/${guildId}/bets?${params}`);
    const bets = await res.json();

    if (!bets || bets.length === 0) {
      container.innerHTML = '<p class="empty-state">No bets found matching your filters.</p>';
      return;
    }

    container.innerHTML = '';
    bets.forEach(bet => {
      container.appendChild(renderBetCard(bet));
    });
  } catch (e) {
    container.innerHTML = '<p class="empty-state" style="color:var(--text-danger)">Failed to load bets.</p>';
  }
}

function renderBetCard(bet) {
  const div = document.createElement('div');
  div.className = `bet-card status-${bet.status || 'open'}`;
  div.dataset.betId = bet.id;

  const statusEmoji = STATUS_EMOJI[bet.status] || '🟡';
  const sportName = bet.sportName || SPORT_NAMES[bet.sport] || bet.sport || '';
  const wagerLabel = bet.wagerType ? (bet.wagerType.charAt(0).toUpperCase() + bet.wagerType.slice(1)) : '';
  const date = bet.createdAt ? new Date(bet.createdAt).toLocaleDateString() : '';
  const isParlay = bet.betType === 'parlay';

  let pickText = bet.pick || (isParlay ? 'Parlay' : '—');
  let whaleHtml = bet.isWhale ? '<span class="bet-whale-badge">🐋</span>' : '';
  let retroHtml = bet.isRetro ? '<span class="bet-retro-badge">RETRO</span>' : '';

  // Actions (only for open bets)
  let actionsHtml = '';
  if (bet.status === 'open') {
    actionsHtml = `
      <div class="bet-actions">
        <div class="close-dropdown">
          <button class="btn-action btn-win" onclick="closeBet('${bet.id}','win')" title="Win">✅</button>
          <button class="btn-action btn-loss" onclick="closeBet('${bet.id}','loss')" title="Loss">❌</button>
          <button class="btn-action btn-push" onclick="closeBet('${bet.id}','push')" title="Push">🔄</button>
        </div>
        <button class="btn-action btn-edit" onclick="openEditModal('${bet.id}')" title="Edit">✏️</button>
        <button class="btn-action btn-del" onclick="confirmDeleteBet('${bet.id}')" title="Delete">🗑️</button>
      </div>`;
  }

  // Parlay legs
  let legsHtml = '';
  if (isParlay && bet.legs && bet.legs.length > 0) {
    legsHtml = '<div class="bet-legs">' +
      bet.legs.map(leg => {
        const legStatus = STATUS_EMOJI[leg.status] || '⬜';
        return `<div class="bet-leg">
          <span class="bet-leg-status">${legStatus}</span>
          <span class="bet-leg-pick">${leg.pick || '—'}</span>
          <span style="color:var(--text-muted);font-size:11px">${leg.odds || ''}</span>
        </div>`;
      }).join('') +
    '</div>';
  }

  const oddsDisplay = bet.oddsAmerican || '—';
  const unitsDisplay = bet.units || '—';
  const slipDisplay = bet.slipNumber ? `<span>#${bet.slipNumber}</span>` : '';

  div.innerHTML = `
    <span class="bet-status-icon">${statusEmoji}</span>
    <div class="bet-info">
      <div class="bet-pick-row">
        <span class="bet-pick-text">${pickText}</span>
        ${whaleHtml}${retroHtml}
      </div>
      <div class="bet-meta">
        <span>🏟️ ${sportName}</span>
        <span>🎯 ${wagerLabel}</span>
        <span>📅 ${date}</span>
        ${slipDisplay}
      </div>
      ${legsHtml}
    </div>
    <div class="bet-odds-col">
      <div class="bet-odds-val">${oddsDisplay}</div>
      <div class="bet-units-val">${unitsDisplay}u</div>
    </div>
    ${actionsHtml}
  `;

  return div;
}

// ─── Close Bet ─────────
async function closeBet(betId, result) {
  if (!confirm(`Mark this bet as ${result.toUpperCase()}?`)) return;

  try {
    const res = await fetch(`/api/bets/${betId}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result })
    });
    const data = await res.json();
    if (data.error) {
      alert('Error: ' + data.error);
      return;
    }
    loadBets(); // Refresh
  } catch (e) {
    alert('Failed to close bet');
  }
}

// ─── Edit Bet Modal ─────────
let editingBetData = null;

function openEditModal(betId) {
  // Find bet in current list
  const cards = document.querySelectorAll('.bet-card');
  editingBetData = null;

  // Prefill from the DOM or just open blank
  document.getElementById('edit-bet-id').value = betId;
  document.getElementById('edit-odds').value = '';
  document.getElementById('edit-units').value = '';
  document.getElementById('edit-pick').value = '';
  document.getElementById('edit-note').value = '';
  document.getElementById('edit-modal').classList.remove('hidden');
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.add('hidden');
}

async function submitEditBet(e) {
  e.preventDefault();
  const betId = document.getElementById('edit-bet-id').value;
  const fields = {};

  const odds = document.getElementById('edit-odds').value.trim();
  const units = document.getElementById('edit-units').value.trim();
  const pick = document.getElementById('edit-pick').value.trim();
  const note = document.getElementById('edit-note').value.trim();

  if (odds) fields.odds = odds;
  if (units) fields.units = units;
  if (pick) fields.pick = pick;
  if (note) fields.note = note;

  if (Object.keys(fields).length === 0) {
    alert('Enter at least one field to update');
    return;
  }

  try {
    const res = await fetch(`/api/bets/${betId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields)
    });
    const data = await res.json();
    if (data.error) {
      alert('Error: ' + data.error);
      return;
    }
    closeEditModal();
    loadBets();
  } catch (e) {
    alert('Failed to edit bet');
  }
}

// ─── Delete Bet ─────────
let pendingDeleteBetId = null;

function confirmDeleteBet(betId) {
  pendingDeleteBetId = betId;
  document.getElementById('confirm-title').textContent = '🗑️ Delete Bet';
  document.getElementById('confirm-message').textContent = 'Are you sure you want to permanently delete this bet? This cannot be undone.';
  const btn = document.getElementById('confirm-action-btn');
  btn.textContent = 'Delete';
  btn.className = 'btn btn-danger';
  btn.onclick = executeDeleteBet;
  document.getElementById('confirm-modal').classList.remove('hidden');
}

function closeConfirmModal() {
  document.getElementById('confirm-modal').classList.add('hidden');
  pendingDeleteBetId = null;
}

async function executeDeleteBet() {
  if (!pendingDeleteBetId) return;

  try {
    const res = await fetch(`/api/bets/${pendingDeleteBetId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.error) {
      alert('Error: ' + data.error);
      return;
    }
    closeConfirmModal();
    loadBets();
  } catch (e) {
    alert('Failed to delete bet');
  }
}

// ═══════════════════════════════════════════════
//  REMINDERS PAGE
// ═══════════════════════════════════════════════

const REMINDER_TYPES = {
  game: { emoji: '🏟️', label: 'Game Reminder' },
  whale: { emoji: '🐋', label: 'Whale Dick Alert' },
  lock: { emoji: '🔒', label: 'Lock of the Day' },
  window: { emoji: '⏰', label: 'Betting Window' },
  recap: { emoji: '📊', label: 'Daily Recap' },
  promo: { emoji: '🎉', label: 'Promo / Announcement' },
  custom: { emoji: '📝', label: 'Custom' },
};

let remindersInitialized = false;

function initRemindersPage() {
  if (remindersInitialized) return;
  remindersInitialized = true;

  const sel = document.getElementById('reminder-guild');
  sel.innerHTML = '<option value="">Select server...</option>';
  currentUser.guilds.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.name;
    sel.appendChild(opt);
  });

  if (currentUser.guilds.length > 0) {
    sel.value = currentUser.guilds[0].id;
    loadReminderChannels();
    loadReminders();
  }

  // Calendar picker for reminder time
  const dtInput = document.getElementById('reminder-datetime');
  dtInput.addEventListener('change', () => {
    if (dtInput.value) {
      document.getElementById('reminder-time').value = formatDateTimePretty(dtInput.value);
      document.getElementById('reminder-time').dataset.isoValue = dtInput.value;
    }
  });
}

function openReminderCalendar() {
  document.getElementById('reminder-datetime').showPicker();
}

async function loadReminderChannels() {
  const guildId = document.getElementById('reminder-guild').value;
  if (!guildId) return;

  const sel = document.getElementById('reminder-channel');
  sel.innerHTML = '<option value="">Loading...</option>';

  try {
    const res = await fetch(`/api/guilds/${guildId}/channels`);
    const channels = await res.json();
    sel.innerHTML = '<option value="">Select channel...</option>';
    channels.forEach(ch => {
      const opt = document.createElement('option');
      opt.value = ch.id;
      opt.textContent = '#' + ch.name;
      sel.appendChild(opt);
    });
  } catch (e) {
    sel.innerHTML = '<option value="">Failed to load</option>';
  }

  // Also refresh reminders list
  loadReminders();
}

async function loadReminders() {
  const guildId = document.getElementById('reminder-guild').value;
  if (!guildId) return;

  const container = document.getElementById('reminders-list');
  container.innerHTML = '<p class="empty-state">Loading...</p>';

  try {
    const res = await fetch(`/api/guilds/${guildId}/reminders`);
    const reminders = await res.json();

    if (!reminders || reminders.length === 0) {
      container.innerHTML = '<p class="empty-state">No active reminders.</p>';
      return;
    }

    container.innerHTML = '';
    reminders.forEach(rem => {
      const typeInfo = REMINDER_TYPES[rem.type] || REMINDER_TYPES.custom;
      const scheduledDate = rem.scheduled_at ? new Date(rem.scheduled_at) : null;
      const timeStr = scheduledDate ? scheduledDate.toLocaleString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit'
      }) : '—';

      const card = document.createElement('div');
      card.className = 'reminder-card';
      card.innerHTML = `
        <span class="reminder-icon">${typeInfo.emoji}</span>
        <div class="reminder-info">
          <div class="reminder-type-label">${typeInfo.label}</div>
          <div class="reminder-msg">${rem.message || ''}</div>
          <div class="reminder-meta">
            <span>📅 ${timeStr}</span>
            <span>#${rem.channel_name || rem.channel_id || '—'}</span>
            ${rem.repeat_interval && rem.repeat_interval !== 'none' ? `<span class="repeat-badge">${rem.repeat_interval}</span>` : ''}
          </div>
        </div>
        <button class="btn-cancel-reminder" onclick="cancelReminder('${rem.id}')">Cancel</button>
      `;
      container.appendChild(card);
    });
  } catch (e) {
    container.innerHTML = '<p class="empty-state" style="color:var(--text-danger)">Failed to load reminders.</p>';
  }
}

async function submitReminder(e) {
  e.preventDefault();

  const guildId = document.getElementById('reminder-guild').value;
  const channelId = document.getElementById('reminder-channel').value;
  const type = document.getElementById('reminder-type').value;
  const message = document.getElementById('reminder-message').value.trim();
  const repeat = document.getElementById('reminder-repeat').value;

  // Get time — either from ISO (calendar) or raw text
  const timeInput = document.getElementById('reminder-time');
  let scheduledAt = null;

  if (timeInput.dataset.isoValue) {
    scheduledAt = new Date(timeInput.dataset.isoValue).toISOString();
  } else {
    // Pass raw text — server will need to handle it or we convert here
    const raw = timeInput.value.trim();
    if (!raw) { alert('Please set a time'); return; }
    // Try to parse client-side
    scheduledAt = parseTimeClient(raw);
    if (!scheduledAt) {
      alert('Could not parse time. Use the calendar picker or formats like "in 2h", "tomorrow 9pm"');
      return;
    }
  }

  if (!guildId || !channelId || !type || !message) {
    alert('Please fill all required fields');
    return;
  }

  const successEl = document.getElementById('reminder-success');
  successEl.classList.add('hidden');

  try {
    const res = await fetch(`/api/guilds/${guildId}/reminders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, message, scheduledAt, channelId, repeat })
    });
    const data = await res.json();
    if (data.error) {
      alert('Error: ' + data.error);
      return;
    }

    // Success
    successEl.classList.remove('hidden');
    setTimeout(() => successEl.classList.add('hidden'), 3000);

    // Reset form
    document.getElementById('reminder-message').value = '';
    document.getElementById('reminder-time').value = '';
    delete document.getElementById('reminder-time').dataset.isoValue;
    document.getElementById('reminder-datetime').value = '';

    loadReminders();
  } catch (e) {
    alert('Failed to create reminder');
  }
}

// Client-side time parser (mirrors server parseTime)
function parseTimeClient(raw) {
  raw = raw.trim().toLowerCase();

  // Relative: "in 30m", "in 2h", "in 1h30m"
  const relMatch = raw.match(/^in\s+(?:(\d+)\s*d(?:ays?)?)?\s*(?:(\d+)\s*h(?:ours?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?$/i);
  if (relMatch) {
    const d = parseInt(relMatch[1]) || 0;
    const h = parseInt(relMatch[2]) || 0;
    const m = parseInt(relMatch[3]) || 0;
    if (d === 0 && h === 0 && m === 0) return null;
    const now = new Date();
    now.setDate(now.getDate() + d);
    now.setHours(now.getHours() + h);
    now.setMinutes(now.getMinutes() + m);
    return now.toISOString();
  }

  // "tomorrow 9pm", "today 8pm"
  const dayTimeMatch = raw.match(/^(today|tomorrow)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (dayTimeMatch) {
    const dt = new Date();
    if (dayTimeMatch[1] === 'tomorrow') dt.setDate(dt.getDate() + 1);
    let hours = parseInt(dayTimeMatch[2]);
    const mins = parseInt(dayTimeMatch[3]) || 0;
    const ampm = dayTimeMatch[4]?.toLowerCase();
    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;
    dt.setHours(hours, mins, 0, 0);
    return dt.toISOString();
  }

  // ISO-ish: "2026-02-14 15:00"
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})$/);
  if (isoMatch) {
    const dt = new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]),
      parseInt(isoMatch[4]), parseInt(isoMatch[5]));
    return dt.toISOString();
  }

  return null;
}

async function cancelReminder(reminderId) {
  if (!confirm('Cancel this reminder?')) return;

  const guildId = document.getElementById('reminder-guild').value;
  try {
    const res = await fetch(`/api/guilds/${guildId}/reminders/${reminderId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.error) {
      alert('Error: ' + data.error);
      return;
    }
    loadReminders();
  } catch (e) {
    alert('Failed to cancel reminder');
  }
}

// ═══════════════════════════════════════════════
//  ODDS CONVERTER (Tools Page)
// ═══════════════════════════════════════════════

async function convertOdds(e) {
  e.preventDefault();

  const format = document.getElementById('odds-format').value;
  const input = document.getElementById('odds-input').value.trim();
  if (!input) return;

  const resultDiv = document.getElementById('odds-result');
  resultDiv.classList.add('hidden');

  try {
    const res = await fetch('/api/convert-odds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format, odds: input })
    });
    const data = await res.json();

    if (data.error) {
      alert('Error: ' + data.error);
      return;
    }

    document.getElementById('result-american').textContent = data.american || '—';
    document.getElementById('result-decimal').textContent = data.decimal || '—';
    document.getElementById('result-probability').textContent = data.impliedProbability || '—';
    resultDiv.classList.remove('hidden');
  } catch (e) {
    alert('Failed to convert odds');
  }
}
