/* ═══════════════════════════════════════════════
   TheGamblingKing Bet Slip — Frontend JavaScript
   ═══════════════════════════════════════════════ */

// ── HTML Sanitizer — prevents XSS from user-controlled data ──
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── PWA: Unregister old Service Workers ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(r => r.update());
  });
}

// ── PWA: Capture install prompt ──
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  // Show the install button if user is on the install page
  const section = document.getElementById('install-prompt-section');
  if (section) section.classList.remove('hidden');
});

function triggerInstall() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.then(result => {
    if (result.outcome === 'accepted') {
      console.log('PWA installed');
      const section = document.getElementById('install-prompt-section');
      if (section) section.classList.add('hidden');
      // Log PWA install event
      fetch('/api/analytics/pwa-install', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
        .catch(() => {});
    }
    deferredInstallPrompt = null;
  });
}

// Also track installs via the appinstalled event (covers iOS/manual installs)
window.addEventListener('appinstalled', () => {
  fetch('/api/analytics/pwa-install', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
    .catch(() => {});
});

// ── Activity Tracking ──
function trackActivity(event) {
  fetch('/api/analytics/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  }).catch(() => {});
}

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
let guildPerms = {}; // { isAdmin, canWhale, roles } per guild
let guildEmojis = []; // server emojis for current guild

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
    const res = await fetch('/api/me', { cache: 'no-store' });
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
  document.getElementById('app-footer').classList.add('hidden');
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  document.getElementById('app-footer').classList.remove('hidden');

  // Set user info
  const avatarEl = document.getElementById('user-avatar');
  // Use proxied avatar URL to avoid Discord CDN caching issues
  avatarEl.src = (currentUser.avatarProxy || currentUser.avatar) + '?_t=' + Date.now();
  avatarEl.onerror = () => {
    avatarEl.onerror = null;
    avatarEl.src = `https://cdn.discordapp.com/embed/avatars/0.png`;
  };
  document.getElementById('user-name').textContent = currentUser.displayName;

  // Populate guilds
  const guildSelect = document.getElementById('guild-select');
  currentUser.guilds.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.name;
    guildSelect.appendChild(opt);
  });

  // Auto-select if only one guild
  autoSelectGuild(guildSelect);

  // Check if user is admin in any guild to show analytics nav
  checkOwnerFeatures();

  // Start heartbeat (pings server every 30s so owner can see who's online)
  fetch('/api/heartbeat', { method: 'POST' }).catch(() => {});
  setInterval(() => fetch('/api/heartbeat', { method: 'POST' }).catch(() => {}), 30000);

  // Detect standalone/PWA mode — proves the user installed the app (works on ALL platforms incl iOS)
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (isStandalone) {
    fetch('/api/analytics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'pwa_launch' }),
    }).catch(() => {});
  }

  // Navigate to page from URL hash (e.g. #stats, #leaderboard) or default to slip
  const validPages = ['slip', 'stats', 'bets', 'closebets', 'leaderboard', 'following', 'reminders', 'tools', 'install', 'analytics', 'announce'];
  const hashPage = window.location.hash.replace('#', '');
  if (hashPage && validPages.includes(hashPage)) {
    switchPage(hashPage);
  }

  // Listen for hash changes (back/forward nav)
  window.addEventListener('hashchange', () => {
    const hp = window.location.hash.replace('#', '');
    if (hp && validPages.includes(hp)) switchPage(hp);
  });

  // Fetch online members count for chat dot
  setTimeout(() => fetchOnlineMembers(), 1000);

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

// Auto-select and hide guild selector when user only has one guild
function autoSelectGuild(selectEl) {
  if (currentUser.guilds.length === 1) {
    selectEl.value = currentUser.guilds[0].id;
    // Hide just this select element (and its label if in a form-group)
    const formGroup = selectEl.closest('.form-group');
    if (formGroup) {
      formGroup.style.display = 'none';
    } else {
      selectEl.style.display = 'none';
    }
    // Fire change event so dependent data loads
    setTimeout(() => selectEl.dispatchEvent(new Event('change')), 0);
  }
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

    const guildId = guildSelect.value;

    // Fetch roles and channels in parallel for speed
    const [rolesData, channelsData] = await Promise.all([
      fetch(`/api/guilds/${guildId}/roles`).then(r => r.json()).catch(() => ({ isAdmin: false, canWhale: false, roles: [] })),
      fetch(`/api/guilds/${guildId}/channels`).then(r => r.json()).catch(() => []),
    ]);

    guildPerms = rolesData;

    // Show/hide whale toggle based on role
    const whaleToggle = document.querySelector('.whale-toggle-label')?.closest('.form-row');
    if (whaleToggle) {
      whaleToggle.style.display = guildPerms.canWhale ? '' : 'none';
      if (!guildPerms.canWhale) document.getElementById('is-whale').checked = false;
    }

    // Show/hide admin "Place bet for" user picker
    const behalfRow = document.getElementById('admin-behalf-row');
    if (behalfRow) {
      if (guildPerms.isAdmin) {
        behalfRow.classList.remove('hidden');
        // Fetch guild members in background (non-blocking)
        fetch(`/api/guilds/${guildId}/members`).then(r => r.json()).then(members => {
          const behalfSelect = document.getElementById('behalf-select');
          behalfSelect.innerHTML = '<option value="">Myself</option>';
          members.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.displayName;
            behalfSelect.appendChild(opt);
          });
        }).catch(() => {});
      } else {
        behalfRow.classList.add('hidden');
      }
    }

    // Populate channels
    if (channelsData.length > 0) {
      channelSelect.innerHTML = '<option value="" disabled selected>Select channel</option>';
      
      const grouped = {};
      channelsData.forEach(c => {
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
    } else {
      channelSelect.innerHTML = '<option value="" disabled selected>Error loading channels</option>';
    }
  });

  // Bet type change
  betType.addEventListener('change', () => {
    const isParlay = betType.value === 'parlay';
    document.getElementById('parlay-count-row').classList.toggle('hidden', !isParlay);
    document.getElementById('single-fields').classList.toggle('hidden', isParlay);
    document.getElementById('parlay-legs-container').classList.toggle('hidden', !isParlay);
    document.getElementById('parlay-totals').classList.toggle('hidden', !isParlay);

    // Toggle required on single-bet fields so hidden fields don't block form submission
    const singleRequired = ['sport-select', 'bet-category', 'wager-type', 'odds', 'units'];
    singleRequired.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.required = !isParlay;
    });

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
    singlePicker.blur();
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

    legCalBtn.addEventListener('click', () => { try { legPicker.showPicker(); } catch(e) { legPicker.click(); } });
    legPicker.addEventListener('change', () => {
      legTimeInput.value = formatDateTimePretty(legPicker.value);
      legPicker.value = '';
      legPicker.blur();
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
    const isEditMode = !!submitBtn.dataset.editMode;

    if (!isEditMode && (!guildId || !channelId)) {
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
            // Enforce .5 intervals for total lines (over/under)
            if (wager === 'total') {
              const totalVal = parseFloat(leg.spreadValue);
              if (!isNaN(totalVal) && totalVal % 1 === 0) {
                leg.spreadValue = String(totalVal + 0.5);
              }
            }
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
          // Include teams if available (populated by OCR scanner)
          const propTeamA = document.querySelector(`.leg-team-a[data-leg="${i}"]`)?.value;
          const propTeamB = document.querySelector(`.leg-team-b[data-leg="${i}"]`)?.value;
          if (propTeamA) leg.teamA = propTeamA;
          if (propTeamB) leg.teamB = propTeamB;
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
          // Enforce .5 intervals for total lines (over/under)
          if (wager === 'total') {
            const totalVal = parseFloat(body.spreadValue);
            if (!isNaN(totalVal) && totalVal % 1 === 0) {
              body.spreadValue = String(totalVal + 0.5);
            }
          }
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
        // Include teams if available (populated by OCR scanner)
        const propTeamA = document.getElementById('team-a')?.value;
        const propTeamB = document.getElementById('team-b')?.value;
        if (propTeamA) body.teamA = propTeamA;
        if (propTeamB) body.teamB = propTeamB;
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

    // Admin placing on behalf of another user
    const behalfVal = document.getElementById('behalf-select')?.value;
    if (behalfVal) {
      body.onBehalfOf = behalfVal;
    }

    // ── Edit mode: PATCH existing bet instead of creating new one ──
    const editBetId = submitBtn.dataset.editMode;
    if (editBetId) {
      const patchBody = {};
      if (body.betType === 'parlay' || betTypeVal === 'parlay') {
        patchBody.oddsAmerican = body.oddsAmerican;
        patchBody.units = body.units;
        patchBody.betNote = body.betNote;
        patchBody.sport = body.sport;
        // Map leg data with IDs from editingBetData
        patchBody.legs = (body.legs || []).map((leg, i) => {
          const origLeg = editingBetData?.legs?.[i];
          const legPatch = {
            id: origLeg?.id,
            sport: leg.sport,
            betCategory: leg.betCategory,
            wagerType: leg.wagerType,
            teamA: leg.teamA || null,
            teamB: leg.teamB || null,
            playerName: leg.playerName || null,
            propDescription: leg.propDescription || null,
            spreadValue: leg.spreadValue || null,
            eventStartTime: leg.eventStartTime || null,
          };
          // Only include overUnder if it was set (total bets)
          if (leg.overUnder) legPatch.overUnder = leg.overUnder;
          // Reconstruct pick for futures legs
          if (leg.betCategory === 'futures' && leg.futuresMarket && leg.futuresSelection) {
            legPatch.pick = `${leg.futuresMarket}: ${leg.futuresSelection}`;
          }
          return legPatch;
        });
      } else {
        // Single bet fields
        patchBody.sport = body.sport;
        patchBody.betCategory = body.betCategory;
        patchBody.wagerType = body.wagerType;
        patchBody.teamA = body.teamA || null;
        patchBody.teamB = body.teamB || null;
        patchBody.playerName = body.playerName || null;
        patchBody.propDescription = body.propDescription || null;
        patchBody.oddsAmerican = body.oddsAmerican;
        patchBody.units = body.units;
        patchBody.spreadValue = body.spreadValue || null;
        patchBody.eventStartTime = body.eventStartTime || null;
        patchBody.betNote = body.betNote || null;
        // Reconstruct pick on the client for futures
        if (body.betCategory === 'futures' && body.futuresMarket && body.futuresSelection) {
          patchBody.pick = `${body.futuresMarket}: ${body.futuresSelection}`;
        }
        if (body.overUnder) patchBody.overUnder = body.overUnder;
      }

      const patchRes = await fetch(`/api/bets/${editBetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      });
      const patchData = await patchRes.json();
      if (!patchData.success) throw new Error(patchData.error || 'Failed to save changes');

      // Clear edit mode and navigate back to bets
      delete submitBtn.dataset.editMode;
      editingBetData = null;
      submitBtn.querySelector('.btn-text').textContent = 'Place Bet 🎰';
      // Re-enable locked selects
      document.getElementById('guild-select').disabled = false;
      document.getElementById('channel-select').disabled = false;
      document.getElementById('bet-type').disabled = false;
      // Restore slip header
      document.getElementById('slip-title').textContent = '🎟️ New Bet Slip';
      document.getElementById('slip-subtitle').textContent = 'Fill out your bet details below';
      // Restore hidden rows
      document.getElementById('server-channel-row').classList.remove('hidden');
      document.getElementById('whale-row').classList.remove('hidden');
      showToast('Bet updated successfully!');
      switchPage('bets');
      loadBets();
      return;
    }

    const res = await fetch('/api/bets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Failed to place bet');

    // Show success
    // Track bet placement
    trackActivity('bet_placed');

    const behalfName = document.getElementById('behalf-select')?.selectedOptions[0]?.textContent;
    const forWho = body.onBehalfOf ? ` for ${behalfName}` : '';
    document.getElementById('bet-form').classList.add('hidden');
    document.getElementById('success-msg').classList.remove('hidden');
    document.getElementById('success-detail').textContent = `Slip ${data.slipNumber} has been posted to Discord${forWho}!`;

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

  // Clear edit mode state
  const submitBtn = document.getElementById('submit-btn');
  if (submitBtn.dataset.editMode) {
    delete submitBtn.dataset.editMode;
    submitBtn.querySelector('.btn-text').textContent = 'Place Bet 🎰';
    editingBetData = null;
  }
  // Re-enable selects that may have been disabled during edit
  document.getElementById('guild-select').disabled = false;
  document.getElementById('channel-select').disabled = false;
  document.getElementById('bet-type').disabled = false;

  // Restore slip header
  document.getElementById('slip-title').textContent = '🎟️ New Bet Slip';
  document.getElementById('slip-subtitle').textContent = 'Fill out your bet details below';

  // Restore hidden rows
  document.getElementById('server-channel-row').classList.remove('hidden');
  document.getElementById('whale-row').classList.remove('hidden');
  document.getElementById('guild-select').required = true;
  document.getElementById('channel-select').required = true;

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

  // Restore required on single-bet fields
  ['sport-select', 'bet-category', 'wager-type', 'odds', 'units'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.required = true;
  });
}

// ═══════════════════════════════════════════════
//  OCR Bet Slip Scanner
// ═══════════════════════════════════════════════

function triggerSlipScan() {
  if (!getUnitSize()) {
    showToast('Set a unit size to ensure bets populate correctly.', 5000);
    document.getElementById('unit-size-input').focus();
    return;
  }
  document.getElementById('slip-file-input').click();
}

// Unit size persistence
function saveUnitSize() {
  const val = document.getElementById('unit-size-input').value;
  if (val && parseFloat(val) > 0) {
    localStorage.setItem('gk_unit_size', val);
  } else {
    localStorage.removeItem('gk_unit_size');
  }
}

function getUnitSize() {
  return parseFloat(localStorage.getItem('gk_unit_size')) || 0;
}

function convertWagerToUnits(wagerAmount) {
  const unitSize = getUnitSize();
  if (!unitSize || !wagerAmount) return wagerAmount || '';
  const units = parseFloat(wagerAmount) / unitSize;
  // Round to 1 decimal, remove trailing .0
  return parseFloat(units.toFixed(1)).toString();
}

// Load saved unit size on page load
(function loadUnitSize() {
  const saved = localStorage.getItem('gk_unit_size');
  if (saved) {
    const el = document.getElementById('unit-size-input');
    if (el) el.value = saved;
  }
})();

// Compress image for OCR — resize to max 2048px and convert to JPEG
function compressImageForOCR(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 2048;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        const ratio = Math.min(MAX / w, MAX / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      // Fallback: read raw file (handles HEIC and other formats the browser can't render)
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read image file'));
      reader.readAsDataURL(file);
    };
    img.src = url;
  });
}

async function handleSlipFile(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;

  // Show scanning status
  const scanStatus = document.getElementById('scan-status');
  scanStatus.classList.remove('hidden');
  document.getElementById('scan-slip-btn').disabled = true;

  try {
    // Compress all images before sending
    const imageDatas = await Promise.all(files.map(f => compressImageForOCR(f)));

    // Send to OCR endpoint (supports single or multiple images)
    const res = await fetch('/api/ocr-slip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(imageDatas.length === 1 ? { imageData: imageDatas[0] } : { imageDatas }),
    });

    const result = await res.json();

    if (!res.ok || !result.success) {
      throw new Error(result.error || 'Failed to analyze bet slip');
    }

    // If multiple results returned, merge them into one parlay
    let finalData = result.data;
    if (Array.isArray(result.data)) {
      finalData = mergeOcrResults(result.data);
    }

    // Log raw scan data for troubleshooting
    const rawJson = JSON.stringify(finalData, null, 2);
    console.log('📸 OCR Scan Result:', rawJson);

    // Show debug panel with raw data (site owner only)
    if (currentUser && currentUser.discordId === '1338301556973633577') {
      const debugPanel = document.getElementById('scan-debug');
      document.getElementById('scan-debug-data').textContent = rawJson;
      debugPanel.classList.remove('hidden');
    }

    // Apply parsed data to form
    applyOcrData(finalData);

    // Build summary of what was detected
    const summary = buildScanSummary(finalData);
    showToast(`Scan complete! ${summary}`, 7000);
    trackActivity('ocr_scan');

  } catch (err) {
    showToast(err.message || 'Failed to scan bet slip');
  } finally {
    scanStatus.classList.add('hidden');
    document.getElementById('scan-slip-btn').disabled = false;
    // Reset file input so same file can be re-selected
    e.target.value = '';
  }
}

// Merge multiple OCR results into a single parlay
function mergeOcrResults(results) {
  if (results.length === 1) return results[0];

  // Collect all legs from all results
  let allLegs = [];
  let oddsAmerican = null;
  let wagerAmount = null;

  results.forEach(r => {
    if (r.betType === 'parlay' && r.legs) {
      allLegs = allLegs.concat(r.legs);
    } else if (r.betType === 'single') {
      // Convert single bet to a parlay leg
      allLegs.push({
        sport: r.sport,
        betCategory: r.betCategory,
        wagerType: r.wagerType,
        teamA: r.teamA,
        teamB: r.teamB,
        spreadValue: r.spreadValue,
        overUnder: r.overUnder,
        playerName: r.playerName,
        propDescription: r.propDescription,
        futuresMarket: r.futuresMarket,
        futuresSelection: r.futuresSelection,
        eventStartTime: r.eventStartTime,
      });
    }
    // Use odds/wager from the last result that has them
    if (r.oddsAmerican) oddsAmerican = r.oddsAmerican;
    if (r.wagerAmount) wagerAmount = r.wagerAmount;
  });

  return {
    betType: 'parlay',
    oddsAmerican,
    wagerAmount,
    legs: allLegs,
  };
}

function applyOcrData(data) {
  if (!data) return;

  const betTypeSelect = document.getElementById('bet-type');
  const isParlay = data.betType === 'parlay';

  // Set bet type and trigger visibility
  betTypeSelect.value = isParlay ? 'parlay' : 'single';
  betTypeSelect.dispatchEvent(new Event('change'));

  if (isParlay && data.legs && data.legs.length > 0) {
    applyParlayData(data);
  } else {
    applySingleData(data);
  }
}

function buildScanSummary(data) {
  const found = [];
  const missed = [];

  if (data.betType === 'parlay') {
    const legCount = data.legs?.length || 0;
    found.push(`${legCount} legs`);
    if (data.oddsAmerican) found.push('odds');
    else missed.push('odds');
    if (data.wagerAmount) found.push(`$${data.wagerAmount} wager`);
    else missed.push('wager amount');

    (data.legs || []).forEach((leg, i) => {
      const n = i + 1;
      if (!leg.sport) missed.push(`leg ${n} sport`);
      if (!leg.betCategory) missed.push(`leg ${n} category`);
      if (leg.betCategory === 'team_game' && (!leg.teamA || !leg.teamB)) missed.push(`leg ${n} teams`);
      if (leg.betCategory === 'player_prop' && !leg.playerName) missed.push(`leg ${n} player`);
      if (leg.betCategory === 'futures' && !leg.futuresSelection) missed.push(`leg ${n} selection`);
    });
  } else {
    if (data.sport) found.push(data.sport.toUpperCase());
    else missed.push('sport');
    if (data.betCategory) found.push(data.betCategory.replace('_', ' '));
    else missed.push('category');
    if (data.oddsAmerican) found.push(data.oddsAmerican);
    else missed.push('odds');
    if (data.wagerAmount) found.push(`$${data.wagerAmount}`);
    else missed.push('wager amount');

    if (data.betCategory === 'team_game') {
      if (data.teamA) found.push(data.teamA);
      else missed.push('team A');
      if (data.teamB) found.push(data.teamB);
      else missed.push('team B');
    } else if (data.betCategory === 'player_prop') {
      if (data.playerName) found.push(data.playerName);
      else missed.push('player');
    } else if (data.betCategory === 'futures') {
      if (data.futuresSelection) found.push(data.futuresSelection);
      else missed.push('selection');
    }
  }

  let msg = `Found: ${found.join(', ')}.`;
  if (missed.length) msg += ` Missing: ${missed.join(', ')}.`;
  return msg;
}

function applySingleData(data) {
  // Sport
  if (data.sport) {
    const sportEl = document.getElementById('sport-select');
    sportEl.value = data.sport;
  }

  // Category
  if (data.betCategory) {
    const catEl = document.getElementById('bet-category');
    catEl.value = data.betCategory;
    updateCategoryFields(data.betCategory);
  }

  // Wager type (for team_game)
  if (data.betCategory === 'team_game' && data.wagerType) {
    const wagerEl = document.getElementById('wager-type');
    wagerEl.value = data.wagerType;
    updateWagerFields(data.wagerType);
  }

  // Over/Under toggle
  if (data.overUnder) {
    const dir = data.overUnder === 'Under' ? 'Under' : 'Over';
    document.querySelectorAll('#over-under-row .toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.value === dir);
    });
  }

  // Team fields
  if (data.teamA) document.getElementById('team-a').value = data.teamA;
  if (data.teamB) document.getElementById('team-b').value = data.teamB;
  if (data.spreadValue) document.getElementById('spread-value').value = data.spreadValue;

  // Player prop fields
  if (data.playerName) document.getElementById('player-name').value = data.playerName;
  if (data.propDescription) document.getElementById('prop-desc').value = data.propDescription;

  // Futures fields
  if (data.futuresMarket) document.getElementById('futures-market').value = data.futuresMarket;
  if (data.futuresSelection) document.getElementById('futures-selection').value = data.futuresSelection;

  // Odds & Units
  if (data.oddsAmerican) document.getElementById('odds').value = data.oddsAmerican;
  if (data.wagerAmount) {
    document.getElementById('units').value = convertWagerToUnits(data.wagerAmount);
  } else if (data.units) {
    document.getElementById('units').value = data.units;
  }

  // Event time
  if (data.eventStartTime) document.getElementById('event-time').value = data.eventStartTime;
}

function applyParlayData(data) {
  const legs = data.legs || [];
  const legCount = Math.min(Math.max(legs.length, 2), 10);

  // Set leg count and build legs
  const legCountEl = document.getElementById('parlay-legs-count');
  legCountEl.value = legCount;
  buildParlayLegs();

  // Fill each leg
  legs.forEach((leg, idx) => {
    const i = idx + 1;
    if (i > legCount) return;

    // Sport
    if (leg.sport) {
      const sportEl = document.querySelector(`.leg-sport[data-leg="${i}"]`);
      if (sportEl) sportEl.value = leg.sport;
    }

    // Category
    if (leg.betCategory) {
      const catEl = document.querySelector(`.leg-category[data-leg="${i}"]`);
      if (catEl) {
        catEl.value = leg.betCategory;
        // Trigger visibility
        document.querySelector(`.leg-team-fields-${i}`).classList.toggle('hidden', leg.betCategory !== 'team_game');
        document.querySelector(`.leg-prop-fields-${i}`).classList.toggle('hidden', leg.betCategory !== 'player_prop');
        document.querySelector(`.leg-futures-fields-${i}`).classList.toggle('hidden', leg.betCategory !== 'futures');
        document.querySelector(`.leg-wager-row-${i}`).classList.toggle('hidden', leg.betCategory !== 'team_game');
      }
    }

    // Wager type
    if (leg.betCategory === 'team_game' && leg.wagerType) {
      const wagerEl = document.querySelector(`.leg-wager-type[data-leg="${i}"]`);
      if (wagerEl) {
        wagerEl.value = leg.wagerType;
        const spreadRow = document.querySelector(`.leg-spread-row-${i}`);
        const ouRow = document.querySelector(`.leg-ou-row-${i}`);
        const spreadLabel = document.querySelector(`.leg-spread-label-${i}`);

        if (leg.wagerType === 'spread') {
          spreadRow.classList.remove('hidden');
          ouRow.classList.add('hidden');
          if (spreadLabel) spreadLabel.textContent = 'Spread';
        } else if (leg.wagerType === 'total') {
          spreadRow.classList.remove('hidden');
          ouRow.classList.remove('hidden');
          if (spreadLabel) spreadLabel.textContent = 'Total Line';
        } else {
          spreadRow.classList.add('hidden');
          ouRow.classList.add('hidden');
        }
      }
    }

    // Over/Under direction
    if (leg.overUnder) {
      const dir = leg.overUnder === 'Under' ? 'Under' : 'Over';
      document.querySelectorAll(`.leg-ou-btn[data-leg="${i}"]`).forEach(btn => {
        btn.classList.toggle('active', btn.dataset.value === dir);
      });
    }

    // Team fields
    if (leg.teamA) {
      const el = document.querySelector(`.leg-team-a[data-leg="${i}"]`);
      if (el) el.value = leg.teamA;
    }
    if (leg.teamB) {
      const el = document.querySelector(`.leg-team-b[data-leg="${i}"]`);
      if (el) el.value = leg.teamB;
    }
    if (leg.spreadValue) {
      const el = document.querySelector(`.leg-spread-value[data-leg="${i}"]`);
      if (el) el.value = leg.spreadValue;
    }

    // Player prop fields
    if (leg.playerName) {
      const el = document.querySelector(`.leg-player-name[data-leg="${i}"]`);
      if (el) el.value = leg.playerName;
    }
    if (leg.propDescription) {
      const el = document.querySelector(`.leg-prop-desc[data-leg="${i}"]`);
      if (el) el.value = leg.propDescription;
    }

    // Futures fields
    if (leg.futuresMarket) {
      const el = document.querySelector(`.leg-futures-market[data-leg="${i}"]`);
      if (el) el.value = leg.futuresMarket;
    }
    if (leg.futuresSelection) {
      const el = document.querySelector(`.leg-futures-selection[data-leg="${i}"]`);
      if (el) el.value = leg.futuresSelection;
    }

    // Event time
    if (leg.eventStartTime) {
      const el = document.querySelector(`.leg-event-time[data-leg="${i}"]`);
      if (el) el.value = leg.eventStartTime;
    }
  });

  // Parlay totals
  if (data.oddsAmerican) document.getElementById('parlay-odds').value = data.oddsAmerican;
  if (data.wagerAmount) {
    document.getElementById('parlay-units').value = convertWagerToUnits(data.wagerAmount);
  } else if (data.units) {
    document.getElementById('parlay-units').value = data.units;
  }
}

// ── Toast ──
function showToast(msg, duration = 4000) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), duration);
}

// ═══════════════════════════════════════════════
//  Sidebar & Navigation
// ═══════════════════════════════════════════════

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

function toggleAdminMenu() {
  document.getElementById('admin-items').classList.toggle('hidden');
  document.getElementById('admin-chevron').classList.toggle('expanded');
}

// ═══════════════════════════════════════════════
//  Floating Chat Panel (Discord Widgetbot)
// ═══════════════════════════════════════════════

let chatPanelOpen = false;
let chatWidgetLoaded = false;
let chatOnlineInterval = null;

function toggleChatPanel() {
  chatPanelOpen = !chatPanelOpen;
  document.getElementById('chat-panel').classList.toggle('open', chatPanelOpen);
  document.getElementById('chat-fab').classList.toggle('hidden', chatPanelOpen);

  if (chatPanelOpen && !chatWidgetLoaded) {
    loadChatWidget();
  }
  if (chatPanelOpen) {
    fetchOnlineMembers();
    if (!chatOnlineInterval) {
      chatOnlineInterval = setInterval(fetchOnlineMembers, 60000);
    }
  }
}

function loadChatWidget() {
  const wrap = document.getElementById('chat-widget-wrap');
  const guildSel = document.getElementById('guild-select');
  const guildId = guildSel?.value || '1465176016828895456';

  fetch(`/api/guilds/${guildId}/chat-channel`)
    .then(r => r.json())
    .then(data => {
      const channelId = data.channelId || '';
      const src = channelId
        ? `https://e.widgetbot.io/channels/${guildId}/${channelId}`
        : `https://e.widgetbot.io/channels/${guildId}`;
      wrap.innerHTML = `<iframe src="${src}" allow="clipboard-write; fullscreen"></iframe>`;
      chatWidgetLoaded = true;
    })
    .catch(() => {
      wrap.innerHTML = `<iframe src="https://e.widgetbot.io/channels/${guildId}" allow="clipboard-write; fullscreen"></iframe>`;
      chatWidgetLoaded = true;
    });
}

async function fetchOnlineMembers() {
  try {
    const guildSel = document.getElementById('guild-select');
    const guildId = guildSel?.value || '1465176016828895456';
    const res = await fetch(`/api/guilds/${guildId}/online-members`);
    const data = await res.json();
    if (!data.members) return;

    const countEl = document.getElementById('chat-online-count');
    const badgeEl = document.getElementById('chat-fab-badge');
    countEl.textContent = data.members.length;
    if (badgeEl) badgeEl.textContent = data.members.length > 0 ? data.members.length : '';

    const listEl = document.getElementById('chat-online-list');
    listEl.innerHTML = data.members.map(m => `
      <div class="chat-online-member">
        <img src="/api/avatar/${m.discordId}" alt="">
        <span class="member-status-dot ${m.status}"></span>
        <span>${esc(m.displayName)}</span>
      </div>
    `).join('');
  } catch (e) {
    // silently fail
  }
}

function toggleOnlineList() {
  const list = document.getElementById('chat-online-list');
  list.classList.toggle('hidden');
}

function switchPage(page) {
  // Update URL hash so links and refresh work
  if (window.location.hash !== '#' + page) {
    history.replaceState(null, '', '#' + page);
  }

  // Track page view
  const trackablePages = { stats: 'view_stats', bets: 'view_bets', closebets: 'view_closebets', tools: 'view_tools', reminders: 'view_reminders', slip: 'page_view', leaderboard: 'view_leaderboard' };
  if (trackablePages[page]) {
    trackActivity(trackablePages[page]);
  }

  // Toggle sidebar links
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  const activeLink = document.querySelector(`.sidebar-link[data-page="${page}"]`);
  if (activeLink) activeLink.classList.add('active');

  // Close sidebar
  closeSidebar();

  // All pages
  const pages = {
    slip: document.getElementById('slip-page'),
    stats: document.getElementById('stats-page'),
    bets: document.getElementById('bets-page'),
    closebets: document.getElementById('closebets-page'),
    leaderboard: document.getElementById('leaderboard-page'),
    following: document.getElementById('following-page'),
    reminders: document.getElementById('reminders-page'),
    tools: document.getElementById('tools-page'),
    install: document.getElementById('install-page'),
    analytics: document.getElementById('analytics-page'),
    announce: document.getElementById('announce-page'),
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
  if (page === 'analytics') initAnalyticsPage();
  if (page === 'announce') initAnnouncePage();
  if (page === 'leaderboard') initLeaderboardPage();
  if (page === 'following') initFollowingPage();
  if (page === 'closebets') initCloseBetsPage();
}

// ═══════════════════════════════════════════════
//  Close Bets (Quick Close Page)
// ═══════════════════════════════════════════════

let closeBetsInitialized = false;
let closeBetsPerms = { isAdmin: false };

function initCloseBetsPage() {
  if (closeBetsInitialized) return;
  closeBetsInitialized = true;

  const sel = document.getElementById('closebets-guild');
  sel.innerHTML = '<option value="" disabled selected>Select Server</option>';
  currentUser.guilds.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.name;
    sel.appendChild(opt);
  });

  sel.addEventListener('change', async () => {
    const guildId = sel.value;
    if (!guildId) return;

    // Check admin perms
    try {
      const rolesRes = await fetch(`/api/guilds/${guildId}/roles`);
      closeBetsPerms = await rolesRes.json();
    } catch (e) {
      closeBetsPerms = { isAdmin: false };
    }

    // Show/populate user picker for admins
    const userSel = document.getElementById('closebets-user');
    if (closeBetsPerms.isAdmin) {
      userSel.classList.remove('hidden');
      try {
        const membersRes = await fetch(`/api/guilds/${guildId}/members`);
        const members = await membersRes.json();
        userSel.innerHTML = '<option value="">My Bets</option><option value="all">👑 All Members</option>';
        members.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = m.displayName;
          userSel.appendChild(opt);
        });
      } catch (e) {}
      userSel.value = ''; // Default to logged-in user
    } else {
      userSel.classList.add('hidden');
      userSel.value = '';
    }

    // Temporarily set betsGuildPerms so renderBetCard picks up admin
    const savedPerms = betsGuildPerms;
    betsGuildPerms = closeBetsPerms;
    await loadCloseBets();
    betsGuildPerms = savedPerms;
  });

  // User filter change
  document.getElementById('closebets-user').addEventListener('change', async () => {
    const savedPerms = betsGuildPerms;
    betsGuildPerms = closeBetsPerms;
    await loadCloseBets();
    betsGuildPerms = savedPerms;
  });

  // Auto-select if only one guild
  if (currentUser.guilds.length === 1) {
    sel.value = currentUser.guilds[0].id;
    sel.dispatchEvent(new Event('change'));
  }
}

async function loadCloseBets() {
  const guildId = document.getElementById('closebets-guild').value;
  if (!guildId) return;

  const container = document.getElementById('closebets-list');
  container.innerHTML = '<p class="empty-state">Loading...</p>';

  const isAdmin = closeBetsPerms.isAdmin;
  const userFilter = document.getElementById('closebets-user').value;
  const params = new URLSearchParams({ status: 'open' });

  if (isAdmin) {
    if (userFilter === 'all') {
      params.set('viewAll', 'true');
    } else if (userFilter) {
      params.set('userId', userFilter);
    }
    // else empty = logged-in user's bets (default, no extra param)
  }

  const showOwner = isAdmin && (userFilter === 'all' || (userFilter && userFilter !== ''));

  try {
    const res = await fetch(`/api/guilds/${guildId}/bets?${params}`);
    const bets = await res.json();

    if (!bets || bets.length === 0) {
      container.innerHTML = '<p class="empty-state">🎉 No open bets! You\'re all caught up.</p>';
      return;
    }

    container.innerHTML = '';
    bets.forEach(bet => {
      container.appendChild(renderBetCard(bet, showOwner));
    });
  } catch (e) {
    container.innerHTML = '<p class="empty-state" style="color:var(--text-danger)">Failed to load bets.</p>';
  }
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

  // Events (register before autoSelectGuild so change event fires correctly)
  statsGuild.addEventListener('change', () => {
    loadStatsUsers(statsGuild.value);
    loadStats();
  });

  document.getElementById('stats-period').addEventListener('change', loadStats);
  document.getElementById('stats-user').addEventListener('change', loadStats);

  // Auto-select and hide if single guild, otherwise select first
  if (currentUser.guilds.length === 1) {
    autoSelectGuild(statsGuild);
  } else if (currentUser.guilds.length > 1) {
    statsGuild.value = currentUser.guilds[0].id;
    statsGuild.dispatchEvent(new Event('change'));
  }
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

    if (data.tailOnly) {
      // User only has tail stats, no placed bets
      document.getElementById('stats-content').classList.remove('hidden');
      renderTailOnlyStats(data);
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

function populateTailSection(t) {
  document.getElementById('tail-kpi-record').textContent = `${t.tail_wins}W-${t.tail_losses}L-${t.tail_pushes}P`;
  setKPI('tail-kpi-winpct', `${t.tail_win_pct}%`);
  setKPI('tail-kpi-net', fmtNet(t.tail_net_units), t.tail_net_units);
  setKPI('tail-kpi-roi', `${t.tail_roi}%`, t.tail_roi);
  document.getElementById('tail-kpi-total').textContent = t.total_tails;
  document.getElementById('tail-kpi-open').textContent = t.open_tails;

  // Streak
  const streakEl = document.getElementById('tail-hl-streak');
  if (t.tail_streak && t.tail_streak.count > 0) {
    streakEl.textContent = `${t.tail_streak.count} ${t.tail_streak.type === 'win' ? '🔥 W' : '❄️ L'}`;
    streakEl.className = `sp-metric-value ${t.tail_streak.type === 'win' ? 'positive' : 'negative'}`;
  } else {
    streakEl.textContent = '—';
    streakEl.className = 'sp-metric-value';
  }

  document.getElementById('tail-hl-avg-odds').textContent = t.tail_avg_odds >= 0 ? `+${t.tail_avg_odds}` : t.tail_avg_odds;
  document.getElementById('tail-hl-avg-units').textContent = `${t.tail_avg_units}u`;
  document.getElementById('tail-hl-wagered').textContent = `${fmtU(t.tail_units_wagered)}u`;

  // Best / Worst tail
  if (t.tail_best_bet) {
    document.getElementById('tail-hl-best').textContent = fmtNet(t.tail_best_bet.payout);
    document.getElementById('tail-hl-best').className = 'sp-bw-value positive';
    document.getElementById('tail-hl-best-detail').textContent = `${t.tail_best_bet.pick} (${t.tail_best_bet.odds >= 0 ? '+' : ''}${t.tail_best_bet.odds})`;
  }
  if (t.tail_worst_bet) {
    document.getElementById('tail-hl-worst').textContent = fmtNet(t.tail_worst_bet.payout);
    document.getElementById('tail-hl-worst').className = 'sp-bw-value negative';
    document.getElementById('tail-hl-worst-detail').textContent = `${t.tail_worst_bet.pick} (${t.tail_worst_bet.odds >= 0 ? '+' : ''}${t.tail_worst_bet.odds})`;
  }
}

function renderTailOnlyStats(data) {
  const t = data.tailStats;

  // Clear main KPIs (no personal bets)
  document.getElementById('kpi-record').textContent = '0W-0L-0P';
  setKPI('kpi-winpct', '0%');
  setKPI('kpi-net', '0u', 0);
  setKPI('kpi-roi', '0%', 0);
  document.getElementById('kpi-total').textContent = '0';
  document.getElementById('kpi-open').textContent = '0';

  const streakEl = document.getElementById('hl-streak');
  streakEl.textContent = '—';
  streakEl.className = 'sp-metric-value';
  document.getElementById('hl-avg-odds').textContent = '—';
  document.getElementById('hl-avg-units').textContent = '—';
  document.getElementById('hl-wagered').textContent = '—';
  document.getElementById('hl-best').textContent = '—';
  document.getElementById('hl-best').className = 'sp-bw-value';
  document.getElementById('hl-best-detail').textContent = '';
  document.getElementById('hl-worst').textContent = '—';
  document.getElementById('hl-worst').className = 'sp-bw-value';
  document.getElementById('hl-worst-detail').textContent = '';

  // Show tail section with full stats
  const tailSec = document.getElementById('tail-section');
  tailSec.classList.remove('hidden');
  populateTailSection(t);

  // Hide sections that don't apply
  renderBreakdown('bet-type-breakdown', [], 0);
  renderBreakdown('sport-breakdown', [], 0);
  renderBreakdown('wager-breakdown', [], 0);
  document.getElementById('whale-section').classList.add('hidden');

  // Clear P&L and recent
  document.getElementById('pnl-tbody').innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);">No bets placed</td></tr>';
  document.getElementById('recent-bets').innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted);">No bets placed — tail record only</div>';
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
    streakEl.className = `sp-metric-value ${s.type === 'win' ? 'positive' : 'negative'}`;
  } else {
    streakEl.textContent = '—';
    streakEl.className = 'sp-metric-value';
  }

  document.getElementById('hl-avg-odds').textContent = data.avgOdds >= 0 ? `+${data.avgOdds}` : data.avgOdds;
  document.getElementById('hl-avg-units').textContent = `${data.avgUnits}u`;
  document.getElementById('hl-wagered').textContent = `${fmtU(o.unitsWagered)}u`;

  // Best / Worst
  if (data.bestBet) {
    document.getElementById('hl-best').textContent = `${fmtNet(data.bestBet.payout)}`;
    document.getElementById('hl-best').className = 'sp-bw-value positive';
    document.getElementById('hl-best-detail').textContent = `${data.bestBet.pick} (${data.bestBet.odds >= 0 ? '+' : ''}${data.bestBet.odds})`;
  }
  if (data.worstBet) {
    document.getElementById('hl-worst').textContent = `${fmtNet(data.worstBet.payout)}`;
    document.getElementById('hl-worst').className = 'sp-bw-value negative';
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
    populateTailSection(data.tailStats);
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
      <td>${esc(day.date)}</td>
      <td>${day.bets}</td>
      <td>${day.wins}</td>
      <td>${day.losses}</td>
      <td class="${netClass}">${fmtNet(day.net)}</td>
    `;
    tbody.appendChild(tr);
  }

  // Recent bets — render as ticket cards
  const recentEl = document.getElementById('recent-bets');
  recentEl.innerHTML = '';
  for (const bet of data.recentBets) {
    recentEl.appendChild(renderBetCard(bet, false));
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

// ═══════════════════════════════════════════════
//  LEADERBOARD / RANKINGS PAGE
// ═══════════════════════════════════════════════

let lbInitialized = false;
let lbData = null;

function initLeaderboardPage() {
  if (lbInitialized) return;
  lbInitialized = true;

  const lbGuild = document.getElementById('lb-guild');
  currentUser.guilds.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.name;
    lbGuild.appendChild(opt);
  });

  lbGuild.addEventListener('change', loadFullLeaderboard);
  document.getElementById('lb-type').addEventListener('change', renderLeaderboard);
  document.getElementById('lb-category').addEventListener('change', renderLeaderboard);

  if (currentUser.guilds.length === 1) {
    autoSelectGuild(lbGuild);
  } else if (currentUser.guilds.length > 1) {
    lbGuild.value = currentUser.guilds[0].id;
    lbGuild.dispatchEvent(new Event('change'));
  }
}

async function loadFullLeaderboard() {
  const guildId = document.getElementById('lb-guild').value;
  if (!guildId) return;

  document.getElementById('lb-loading').classList.remove('hidden');
  document.getElementById('lb-content').classList.add('hidden');
  document.getElementById('lb-empty').classList.add('hidden');

  try {
    const res = await fetch(`/api/guilds/${guildId}/leaderboard/full`);
    lbData = await res.json();
    document.getElementById('lb-loading').classList.add('hidden');

    if ((!lbData.users || lbData.users.length === 0) && (!lbData.tailUsers || lbData.tailUsers.length === 0) && (!lbData.whaleUsers || lbData.whaleUsers.length === 0)) {
      document.getElementById('lb-empty').classList.remove('hidden');
      return;
    }

    document.getElementById('lb-content').classList.remove('hidden');
    renderLeaderboard();
  } catch (e) {
    document.getElementById('lb-loading').classList.add('hidden');
    document.getElementById('lb-empty').classList.remove('hidden');
  }
}

function renderLeaderboard() {
  if (!lbData) return;

  const type = document.getElementById('lb-type').value;
  const category = document.getElementById('lb-category').value;
  const list = type === 'tailing' ? (lbData.tailUsers || []) : type === 'whale' ? (lbData.whaleUsers || []) : (lbData.users || []);

  // Sort by selected category descending
  const sorted = [...list].sort((a, b) => {
    const va = a[category] ?? 0;
    const vb = b[category] ?? 0;
    return vb - va;
  });

  // Load following set for this guild
  const lbGuildId = document.getElementById('lb-guild').value;
  if (lbGuildId && lbGuildId !== followGuildId) loadFollowing(lbGuildId);

  const wrap = document.getElementById('lb-table-wrap');

  if (sorted.length === 0) {
    wrap.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)">No data for this board</div>';
    return;
  }

  const categoryLabels = {
    netUnits: 'Net Units', winPct: 'Win %', wins: 'Wins',
    totalBets: 'Total Bets', roi: 'ROI', unitsWagered: 'Wagered',
  };
  const catLabel = categoryLabels[category] || category;
  const medals = ['🥇', '🥈', '🥉'];

  let html = '<div class="lb-board">';
  sorted.forEach((entry, i) => {
    const rankDisplay = medals[i] || `${i + 1}`;
    const decided = entry.wins + entry.losses;
    const record = `${entry.wins}W-${entry.losses}L-${entry.pushes}P`;

    let primaryVal = '';
    let primaryClass = '';
    switch (category) {
      case 'netUnits':
        primaryVal = fmtNet(entry.netUnits);
        primaryClass = entry.netUnits >= 0 ? 'lb-val-pos' : 'lb-val-neg';
        break;
      case 'winPct':
        primaryVal = `${entry.winPct}%`;
        primaryClass = entry.winPct >= 50 ? 'lb-val-pos' : 'lb-val-neg';
        break;
      case 'wins':
        primaryVal = `${entry.wins}`;
        primaryClass = 'lb-val-pos';
        break;
      case 'totalBets':
        primaryVal = `${entry.totalBets}`;
        primaryClass = '';
        break;
      case 'roi':
        primaryVal = `${entry.roi}%`;
        primaryClass = entry.roi >= 0 ? 'lb-val-pos' : 'lb-val-neg';
        break;
      case 'unitsWagered':
        primaryVal = `${fmtU(entry.unitsWagered)}u`;
        primaryClass = '';
        break;
    }

    html += `
      <div class="lb-entry ${i < 3 ? 'lb-entry-top' : ''}">
        <div class="lb-entry-rank">${rankDisplay}</div>
        <div class="lb-entry-info">
          <div class="lb-entry-name">${esc(entry.displayName)}</div>
          <div class="lb-entry-record">${record} · ${entry.winPct}% · ROI ${entry.roi}%</div>
        </div>
        <div class="lb-entry-primary ${primaryClass}">${primaryVal}</div>
        ${buildFollowBtn(entry.discordId)}
      </div>`;
  });
  html += '</div>';
  wrap.innerHTML = html;
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

// ─── Follow System ───
let followedBettors = new Set();
let followGuildId = null;

async function loadFollowing(guildId) {
  followGuildId = guildId;
  try {
    const res = await fetch(`/api/guilds/${guildId}/following`);
    const data = await res.json();
    followedBettors = new Set(data.following || []);
  } catch (e) {
    console.error('[Follow] Failed to load following:', e);
  }
}

async function toggleFollow(bettorDiscordId, guildId) {
  if (!guildId) guildId = followGuildId;
  if (!guildId) { showToast('Select a server first'); return; }
  try {
    const res = await fetch(`/api/guilds/${guildId}/follow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bettorDiscordId }),
    });
    const data = await res.json();
    if (data.followed) {
      followedBettors.add(bettorDiscordId);
      showToast('✅ Following!');
    } else {
      followedBettors.delete(bettorDiscordId);
      showToast('🔕 Unfollowed');
    }
    // Re-render any visible follow buttons
    document.querySelectorAll(`.follow-btn[data-discord-id="${bettorDiscordId}"]`).forEach(btn => {
      btn.textContent = data.followed ? '🔔' : '🔕';
      btn.title = data.followed ? 'Following — click to unfollow' : 'Follow this bettor';
      btn.classList.toggle('following', data.followed);
    });
  } catch (e) {
    console.error('[Follow] Toggle error:', e);
    showToast('Failed to update follow');
  }
}

function buildFollowBtn(discordId) {
  if (!discordId || discordId === currentUser?.discordId) return '';
  const isFollowing = followedBettors.has(discordId);
  return `<button class="follow-btn ${isFollowing ? 'following' : ''}" data-discord-id="${discordId}" onclick="event.stopPropagation();toggleFollow('${discordId}')" title="${isFollowing ? 'Following — click to unfollow' : 'Follow this bettor'}">${isFollowing ? '🔔' : '🔕'}</button>`;
}

// ═══════════════════════════════════════════════
//  THE INNER CIRCLE (Following Page)
// ═══════════════════════════════════════════════

let followingInitialized = false;
let allMembersCache = []; // full list for search filtering

function initFollowingPage() {
  if (followingInitialized) return;
  followingInitialized = true;

  const sel = document.getElementById('following-guild');
  currentUser.guilds.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.name;
    sel.appendChild(opt);
  });

  sel.addEventListener('change', loadFollowingPage);

  // Live search filter
  document.getElementById('following-search').addEventListener('input', () => {
    renderMembersList(allMembersCache);
  });

  if (currentUser.guilds.length === 1) {
    autoSelectGuild(sel);
  } else if (currentUser.guilds.length > 1) {
    sel.value = currentUser.guilds[0].id;
    sel.dispatchEvent(new Event('change'));
  }
}

async function loadFollowingPage() {
  const guildId = document.getElementById('following-guild').value;
  if (!guildId) return;

  document.getElementById('following-loading').classList.remove('hidden');
  document.getElementById('following-list').classList.add('hidden');
  document.getElementById('following-empty').classList.add('hidden');
  document.getElementById('following-search').value = '';

  try {
    const res = await fetch(`/api/guilds/${guildId}/circle-members`);
    const data = await res.json();
    const members = data.members || [];
    const followingIds = new Set(data.followingIds || []);

    // Update global follow set
    followGuildId = guildId;
    followedBettors = followingIds;

    // Tag each member with follow status
    members.forEach(m => { m.isFollowed = followingIds.has(m.discordId); });

    // Sort: TheKing first, then alphabetical
    members.sort((a, b) => {
      if (a.isKing && !b.isKing) return -1;
      if (!a.isKing && b.isKing) return 1;
      return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
    });

    allMembersCache = members;
    document.getElementById('following-loading').classList.add('hidden');
    renderMembersList(members);
  } catch (e) {
    console.error('[Following] Load error:', e);
    document.getElementById('following-loading').classList.add('hidden');
    document.getElementById('following-empty').classList.remove('hidden');
  }
}

function renderMembersList(members) {
  const query = (document.getElementById('following-search').value || '').toLowerCase().trim();
  const filtered = query
    ? members.filter(m => m.displayName.toLowerCase().includes(query) || (m.username && m.username.toLowerCase().includes(query)))
    : members;

  const listEl = document.getElementById('following-list');

  if (filtered.length === 0) {
    listEl.classList.add('hidden');
    document.getElementById('following-empty').classList.remove('hidden');
    return;
  }

  document.getElementById('following-empty').classList.add('hidden');
  listEl.classList.remove('hidden');

  const guildId = document.getElementById('following-guild').value;
  let html = '';
  filtered.forEach(user => {
    const avatarUrl = user.avatar || '/TheGamblingKing.jpg';
    const isFollowed = followedBettors.has(user.discordId);
    const kingBadge = user.isKing ? '<span class="king-badge">👑</span>' : '';
    const followBtnClass = isFollowed ? 'btn-following-toggle following' : 'btn-following-toggle';
    const followBtnText = isFollowed ? '🔔 Following' : '🔕 Follow';

    html += `
      <div class="following-card" data-discord-id="${user.discordId}">
        <img src="${esc(avatarUrl)}" alt="" class="following-avatar">
        <div class="following-info">
          <div class="following-name">${kingBadge}${esc(user.displayName)}</div>
          <div class="following-sub">@${esc(user.username || user.displayName)}</div>
        </div>
        <div class="following-actions">
          <a href="https://discord.com/users/${user.discordId}" target="_blank" class="btn-dm" title="Message on Discord">💬</a>
          <button class="${followBtnClass}" data-discord-id="${user.discordId}" onclick="toggleFollowFromPage('${user.discordId}', '${guildId}')">${followBtnText}</button>
        </div>
      </div>`;
  });
  listEl.innerHTML = html;
}

async function toggleFollowFromPage(discordId, guildId) {
  try {
    const res = await fetch(`/api/guilds/${guildId}/follow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bettorDiscordId: discordId }),
    });
    const data = await res.json();

    if (data.followed) {
      followedBettors.add(discordId);
      showToast('✅ Following!');
    } else {
      followedBettors.delete(discordId);
      showToast('🔕 Unfollowed');
    }

    // Update the member cache
    const member = allMembersCache.find(m => m.discordId === discordId);
    if (member) member.isFollowed = data.followed;

    // Update the button in-place
    const card = document.querySelector(`.following-card[data-discord-id="${discordId}"]`);
    if (card) {
      const btn = card.querySelector('.btn-following-toggle');
      btn.classList.toggle('following', data.followed);
      btn.textContent = data.followed ? '🔔 Following' : '🔕 Follow';
    }

    // Update any follow buttons on other pages
    document.querySelectorAll(`.follow-btn[data-discord-id="${discordId}"]`).forEach(btn => {
      btn.textContent = data.followed ? '🔔' : '🔕';
      btn.title = data.followed ? 'Following — click to unfollow' : 'Follow this bettor';
      btn.classList.toggle('following', data.followed);
    });
  } catch (e) {
    showToast('Failed to update follow');
  }
}

let betsInitialized = false;
let betsGuildPerms = {};
let currentBetsTab = 'my';

function switchBetsTab(tab) {
  currentBetsTab = tab;
  document.querySelectorAll('.bets-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // Show/hide filters that only apply to "My Bets"
  const filtersOnly = document.querySelectorAll('#bets-user, #bets-sport, #bets-search');
  filtersOnly.forEach(el => {
    if (tab === 'tailed') el.classList.add('hidden');
    else if (el.id === 'bets-user' && betsGuildPerms.isAdmin) el.classList.remove('hidden');
    else if (el.id !== 'bets-user') el.classList.remove('hidden');
  });

  if (tab === 'tailed') {
    loadTailedBets();
  } else {
    loadBets();
  }
}

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

  // When guild changes on bets page, check admin + load members for user picker
  sel.addEventListener('change', async () => {
    const guildId = sel.value;
    if (!guildId) return;

    try {
      const rolesRes = await fetch(`/api/guilds/${guildId}/roles`);
      betsGuildPerms = await rolesRes.json();
    } catch (e) {
      betsGuildPerms = { isAdmin: false };
    }

    const userSel = document.getElementById('bets-user');
    if (betsGuildPerms.isAdmin) {
      userSel.classList.remove('hidden');
      // Fetch members for the picker
      try {
        const membersRes = await fetch(`/api/guilds/${guildId}/members`);
        const members = await membersRes.json();
        // Keep the first two options (My Bets, All Members), then add members
        userSel.innerHTML = '<option value="">My Bets</option><option value="all">👑 All Members</option>';
        members.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = m.displayName;
          userSel.appendChild(opt);
        });
      } catch (e) {}
    } else {
      userSel.classList.add('hidden');
      userSel.value = '';
    }

    if (currentBetsTab === 'tailed') {
      loadTailedBets();
    } else {
      loadBets();
    }
  });

  // Auto-select: single guild hides picker, multi-guild selects first
  if (currentUser.guilds.length === 1) {
    autoSelectGuild(sel);
  } else if (currentUser.guilds.length > 1) {
    sel.value = currentUser.guilds[0].id;
    sel.dispatchEvent(new Event('change'));
  }
}

async function loadTailedBets() {
  const guildId = document.getElementById('bets-guild').value;
  if (!guildId) return;

  const status = document.getElementById('bets-status').value;
  const container = document.getElementById('bets-list');
  container.innerHTML = '<p class="empty-state">Loading...</p>';

  const params = new URLSearchParams();
  if (status) params.set('status', status);

  try {
    const res = await fetch(`/api/guilds/${guildId}/tailed-bets?${params}`);
    const bets = await res.json();

    if (!bets || bets.length === 0) {
      container.innerHTML = '<p class="empty-state">You haven\'t tailed any bets in this server yet.</p>';
      return;
    }

    container.innerHTML = '';
    bets.forEach(bet => {
      container.appendChild(renderTailedBetCard(bet));
    });
  } catch (e) {
    container.innerHTML = '<p class="empty-state" style="color:var(--text-danger)">Failed to load tailed bets.</p>';
  }
}

function renderTailedBetCard(bet) {
  const div = document.createElement('div');
  div.className = `ticket tailed-card status-${bet.status || 'open'}`;

  const statusMap = { open: 'PENDING', win: 'WON', loss: 'LOST', push: 'PUSH', void: 'VOID' };
  const statusText = statusMap[bet.status] || 'PENDING';
  const sportName = bet.sportName || SPORT_NAMES[bet.sport] || bet.sport || '';
  const wagerLabel = bet.wagerType ? (bet.wagerType.charAt(0).toUpperCase() + bet.wagerType.slice(1)) : '';
  const date = bet.createdAt ? new Date(bet.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const isParlay = bet.betType === 'parlay';
  let pickText = esc(bet.pick) || (isParlay ? `${bet.legs?.length || 0}-Leg Parlay` : '—');
  const whaleTag = bet.isWhale ? '<span class="ticket-tag tag-whale">🐋 WHALE</span>' : '';

  const oddsDisplay = bet.oddsAmerican ? (bet.oddsAmerican > 0 ? `+${bet.oddsAmerican}` : `${bet.oddsAmerican}`) : '—';
  const unitsDisplay = bet.units || '—';

  let toWin = '—';
  if (bet.units && bet.oddsAmerican) {
    const u = Number(bet.units); const o = Number(bet.oddsAmerican);
    const w = o >= 0 ? u * (o / 100) : u * (100 / Math.abs(o));
    toWin = `+${fmtU(w)}u`;
  }

  let legsHtml = '';
  if (isParlay && bet.legs && bet.legs.length > 0) {
    const legsContent = bet.legs.map(leg => {
      const legStatusEmoji = STATUS_EMOJI[leg.status] || '⬜';
      const legSport = esc(leg.sportName || leg.sport || '');
      return `<div class="ticket-leg">
        <div class="ticket-leg-header"><span class="ticket-leg-status">${legStatusEmoji}</span><span class="ticket-leg-sport">${legSport}</span></div>
        <div class="ticket-leg-pick">${esc(leg.pick) || '—'}</div>
        ${leg.playerName ? `<div class="ticket-leg-player">${esc(leg.playerName)}${leg.propDescription ? ' — ' + esc(leg.propDescription) : ''}</div>` : ''}
      </div>`;
    }).join('');
    legsHtml = `<div class="ticket-legs-section">
      <div class="ticket-legs-toggle" onclick="event.stopPropagation();toggleTicketLegs(this)">
        <span>Show ${bet.legs.length} Legs</span><span class="legs-chevron">▸</span>
      </div>
      <div class="ticket-legs-body">${legsContent}</div>
    </div>`;
  }

  div.innerHTML = `
    <div class="ticket-header">
      <div class="ticket-brand"><img src="/TheGamblingKing.jpg" alt="GK" class="ticket-brand-logo"><span class="ticket-brand-sep">│</span><span class="ticket-brand-user">${esc(bet.displayName) || 'Unknown'}</span></div>
      <div class="ticket-status ticket-status-${bet.status}">${statusText}</div>
    </div>
    <div class="ticket-divider"></div>
    <div class="ticket-body">
      <div class="ticket-sport-row">
        <span class="ticket-sport-badge">${esc(sportName)}</span>
        ${wagerLabel ? `<span class="ticket-wager-type">${esc(wagerLabel)}</span>` : ''}
        ${whaleTag}
        <span class="ticket-tag" style="background:rgba(100,181,246,0.12);color:#64b5f6;">🔗 Tailing ${esc(bet.displayName) || 'Unknown'}</span>
      </div>
      <div class="ticket-pick">${pickText}</div>
      ${bet.teamA && bet.teamB ? `<div class="ticket-matchup">${esc(bet.teamA)} vs ${esc(bet.teamB)}</div>` : ''}
      ${bet.playerName ? `<div class="ticket-player">${esc(bet.playerName)}${bet.propDescription ? ' — ' + esc(bet.propDescription) : ''}</div>` : ''}
      ${legsHtml}
    </div>
    <div class="ticket-divider"></div>
    <div class="ticket-stats">
      <div class="ticket-stat"><div class="ticket-stat-label">ODDS</div><div class="ticket-stat-value">${esc(oddsDisplay)}</div></div>
      <div class="ticket-stat"><div class="ticket-stat-label">WAGER</div><div class="ticket-stat-value">${esc(unitsDisplay)}u</div></div>
      <div class="ticket-stat"><div class="ticket-stat-label">TO WIN</div><div class="ticket-stat-value ticket-stat-payout">${toWin}</div></div>
    </div>
    <div class="ticket-divider"></div>
    <div class="ticket-footer">
      <div class="ticket-footer-left"></div>
      <div class="ticket-footer-right"><span class="ticket-date">${esc(date)}</span></div>
    </div>
  `;

  return div;
}

async function loadBets() {
  const guildId = document.getElementById('bets-guild').value;
  if (!guildId) return;

  // Ensure follow set is loaded for this guild
  if (guildId !== followGuildId) loadFollowing(guildId);

  const status = document.getElementById('bets-status').value;
  const sport = document.getElementById('bets-sport').value;
  const search = document.getElementById('bets-search').value.trim();
  const userFilter = document.getElementById('bets-user').value;

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (sport) params.set('sport', sport);
  if (search) params.set('search', search);

  // Admin user filter
  if (userFilter === 'all') {
    params.set('viewAll', 'true');
  } else if (userFilter) {
    params.set('userId', userFilter);
  }

  const container = document.getElementById('bets-list');
  container.innerHTML = '<p class="empty-state">Loading...</p>';

  const showingOthers = userFilter === 'all' || (userFilter && userFilter !== '');

  try {
    const res = await fetch(`/api/guilds/${guildId}/bets?${params}`);
    const bets = await res.json();

    if (!bets || bets.length === 0) {
      container.innerHTML = '<p class="empty-state">No bets found matching your filters.</p>';
      return;
    }

    container.innerHTML = '';
    bets.forEach(bet => {
      container.appendChild(renderBetCard(bet, showingOthers));
    });
  } catch (e) {
    container.innerHTML = '<p class="empty-state" style="color:var(--text-danger)">Failed to load bets.</p>';
  }
}

function renderBetCard(bet, showOwner = false) {
  const div = document.createElement('div');
  div.className = `ticket status-${bet.status || 'open'}`;
  div.dataset.betId = bet.id;

  const statusMap = { open: 'PENDING', win: 'WON', loss: 'LOST', push: 'PUSH', void: 'VOID' };
  const statusText = statusMap[bet.status] || 'PENDING';
  const sportName = bet.sportName || SPORT_NAMES[bet.sport] || bet.sport || '';
  const wagerLabel = bet.wagerType ? (bet.wagerType.charAt(0).toUpperCase() + bet.wagerType.slice(1)) : '';
  const date = bet.createdAt ? new Date(bet.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const time = bet.createdAt ? new Date(bet.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
  const isParlay = bet.betType === 'parlay';

  let pickText = esc(bet.pick) || (isParlay ? `${bet.legs?.length || 0}-Leg Parlay` : '—');
  const whaleTag = bet.isWhale ? '<span class="ticket-tag tag-whale">🐋 WHALE</span>' : '';
  const retroTag = bet.isRetro ? '<span class="ticket-tag tag-retro">RETRO</span>' : '';

  const displayName = showOwner && bet.displayName ? esc(bet.displayName) : (currentUser?.displayName || currentUser?.username || '');

  const isOwnBet = bet.discordId === currentUser?.discordId;
  const canManage = isOwnBet || betsGuildPerms.isAdmin;

  // Odds formatting
  const oddsDisplay = bet.oddsAmerican ? (bet.oddsAmerican > 0 ? `+${bet.oddsAmerican}` : `${bet.oddsAmerican}`) : '—';
  const unitsDisplay = bet.units || '—';
  const slipDisplay = bet.slipNumber || '';

  // Calculate potential payout
  let toWin = '—';
  if (bet.units && bet.oddsAmerican) {
    const u = Number(bet.units);
    const o = Number(bet.oddsAmerican);
    const w = o >= 0 ? u * (o / 100) : u * (100 / Math.abs(o));
    toWin = `+${fmtU(w)}u`;
  }

  // Actions
  let actionsHtml = '';
  if (canManage && bet.status === 'open') {
    actionsHtml = `
      <div class="ticket-actions">
        <button class="ticket-btn ticket-btn-win" onclick="event.stopPropagation();closeBet('${bet.id}')">💰 Close</button>
        <button class="ticket-btn ticket-btn-edit" onclick="event.stopPropagation();openEditModal('${bet.id}')">✏️</button>
        <button class="ticket-btn ticket-btn-del" onclick="event.stopPropagation();confirmDeleteBet('${bet.id}')">🗑️</button>
      </div>`;
  } else if (betsGuildPerms.isAdmin && ['win', 'loss', 'push', 'void'].includes(bet.status)) {
    actionsHtml = `
      <div class="ticket-actions">
        <button class="ticket-btn ticket-btn-reopen" onclick="event.stopPropagation();reopenBet('${bet.id}')">🔓 Reopen</button>
      </div>`;
  } else if (canManage && isParlay && bet.legs?.some(l => l.status === 'open')) {
    actionsHtml = `
      <div class="ticket-actions">
        <button class="ticket-btn ticket-btn-edit" onclick="event.stopPropagation();openEditModal('${bet.id}')">✏️</button>
        <button class="ticket-btn ticket-btn-del" onclick="event.stopPropagation();confirmDeleteBet('${bet.id}')">🗑️</button>
      </div>`;
  }

  // Parlay legs (collapsible)
  let legsHtml = '';
  if (isParlay && bet.legs && bet.legs.length > 0) {
    const legsContent = bet.legs.map((leg, i) => {
      const legStatusEmoji = STATUS_EMOJI[leg.status] || '⬜';
      const legSport = esc(leg.sportName || leg.sport || '');
      const legActions = (leg.status === 'open' && canManage)
        ? `<span class="leg-actions">
             <button class="leg-btn leg-win" onclick="event.stopPropagation();closeLeg('${bet.id}','${leg.id}','win')">✅</button>
             <button class="leg-btn leg-loss" onclick="event.stopPropagation();closeLeg('${bet.id}','${leg.id}','loss')">❌</button>
             <button class="leg-btn leg-push" onclick="event.stopPropagation();closeLeg('${bet.id}','${leg.id}','push')">🔄</button>
             <button class="leg-btn leg-void" onclick="event.stopPropagation();closeLeg('${bet.id}','${leg.id}','void')">⛔</button>
           </span>`
        : '';
      return `<div class="ticket-leg">
        <div class="ticket-leg-header">
          <span class="ticket-leg-status">${legStatusEmoji}</span>
          <span class="ticket-leg-sport">${legSport}</span>
        </div>
        <div class="ticket-leg-pick">${esc(leg.pick) || '—'}</div>
        ${leg.teamA && leg.teamB ? `<div class="ticket-leg-matchup">${esc(leg.teamA)} vs ${esc(leg.teamB)}</div>` : ''}
        ${leg.playerName ? `<div class="ticket-leg-player">${esc(leg.playerName)}${leg.propDescription ? ' — ' + esc(leg.propDescription) : ''}</div>` : ''}
        ${leg.eventStartTime ? `<div class="ticket-leg-time">⏰ ${esc(leg.eventStartTime)}</div>` : ''}
        ${legActions}
      </div>`;
    }).join('');
    legsHtml = `
      <div class="ticket-legs-section">
        <div class="ticket-legs-toggle" onclick="event.stopPropagation();toggleTicketLegs(this)">
          <span>Show ${bet.legs.length} Legs</span>
          <span class="legs-chevron">▸</span>
        </div>
        <div class="ticket-legs-body">
          ${legsContent}
        </div>
      </div>`;
  }

  // Matchup / prop info for singles
  let matchupHtml = '';
  if (!isParlay) {
    if (bet.teamA && bet.teamB) {
      matchupHtml = `<div class="ticket-matchup">${esc(bet.teamA)} vs ${esc(bet.teamB)}</div>`;
    }
    if (bet.playerName) {
      matchupHtml += `<div class="ticket-player">${esc(bet.playerName)}${bet.propDescription ? ' — ' + esc(bet.propDescription) : ''}</div>`;
    }
    if (bet.eventStartTime) {
      matchupHtml += `<div class="ticket-game-time">⏰ ${esc(bet.eventStartTime)}</div>`;
    }
  } else if (isParlay && bet.legs && bet.legs.length > 0) {
    // DraftKings-style: show deduplicated matchups at the top of the parlay card
    const matchups = [];
    const seen = new Set();
    bet.legs.forEach(leg => {
      if (leg.teamA && leg.teamB) {
        const key = [leg.teamA, leg.teamB].sort().join('|');
        if (!seen.has(key)) {
          seen.add(key);
          matchups.push(`${esc(leg.teamA)} vs ${esc(leg.teamB)}`);
        }
      }
    });
    if (matchups.length > 0) {
      matchupHtml = `<div class="ticket-matchup">${matchups.join(' • ')}</div>`;
    }
  }

  // Note
  // Note hidden from card display but still editable
  const noteHtml = '';

  div.innerHTML = `
    <div class="ticket-header">
      <div class="ticket-brand">
        <img src="/TheGamblingKing.jpg" alt="GK" class="ticket-brand-logo">
        <span class="ticket-brand-sep">│</span>
        <span class="ticket-brand-user">${esc(displayName)}</span>
        ${!isOwnBet ? buildFollowBtn(bet.discordId) : ''}
      </div>
      <div class="ticket-status ticket-status-${bet.status}">${statusText}</div>
    </div>

    <div class="ticket-divider"></div>

    <div class="ticket-body">
      <div class="ticket-sport-row">
        <span class="ticket-sport-badge">${esc(sportName)}</span>
        ${wagerLabel ? `<span class="ticket-wager-type">${esc(wagerLabel)}</span>` : ''}
        ${whaleTag}${retroTag}
      </div>

      <div class="ticket-pick">${pickText}</div>
      ${matchupHtml}
      ${legsHtml}
      ${noteHtml}
    </div>

    <div class="ticket-divider"></div>

    <div class="ticket-stats">
      <div class="ticket-stat">
        <div class="ticket-stat-label">ODDS</div>
        <div class="ticket-stat-value">${esc(oddsDisplay)}</div>
      </div>
      <div class="ticket-stat">
        <div class="ticket-stat-label">WAGER</div>
        <div class="ticket-stat-value">${esc(unitsDisplay)}u</div>
      </div>
      <div class="ticket-stat">
        <div class="ticket-stat-label">TO WIN</div>
        <div class="ticket-stat-value ticket-stat-payout">${toWin}</div>
      </div>
    </div>

    <div class="ticket-divider"></div>

    <div class="ticket-footer">
      <div class="ticket-footer-left">
        ${slipDisplay ? `<span class="ticket-slip">#${esc(slipDisplay)}</span>` : ''}
      </div>
      <div class="ticket-footer-right">
        <span class="ticket-date">${esc(date)} ${esc(time)}</span>
      </div>
    </div>

    ${actionsHtml}
  `;

  return div;
}

function toggleTicketLegs(toggleEl) {
  const section = toggleEl.closest('.ticket-legs-section');
  const body = section.querySelector('.ticket-legs-body');
  const chevron = section.querySelector('.legs-chevron');
  const isOpen = body.classList.contains('legs-open');

  if (isOpen) {
    body.style.maxHeight = body.scrollHeight + 'px';
    requestAnimationFrame(() => { body.style.maxHeight = '0'; });
    body.classList.remove('legs-open');
    chevron.textContent = '▸';
    toggleEl.querySelector('span:first-child').textContent = `Show ${section.querySelectorAll('.ticket-leg').length} Legs`;
  } else {
    body.classList.add('legs-open');
    body.style.maxHeight = body.scrollHeight + 'px';
    chevron.textContent = '▾';
    toggleEl.querySelector('span:first-child').textContent = `Hide Legs`;
    body.addEventListener('transitionend', () => {
      if (body.classList.contains('legs-open')) body.style.maxHeight = 'none';
    }, { once: true });
  }
}

// ─── Toggle Stats Panel ─────────
function togglePanel(headerEl) {
  const panel = headerEl.closest('.sp-panel');
  const body = panel.querySelector('.sp-panel-body');
  const chevron = headerEl.querySelector('.sp-panel-chevron');
  const isOpen = body.classList.contains('sp-panel-open');

  if (isOpen) {
    body.style.maxHeight = body.scrollHeight + 'px';
    requestAnimationFrame(() => { body.style.maxHeight = '0'; });
    body.classList.remove('sp-panel-open');
    chevron.textContent = '▸';
  } else {
    body.classList.add('sp-panel-open');
    body.style.maxHeight = body.scrollHeight + 'px';
    chevron.textContent = '▾';
    body.addEventListener('transitionend', () => {
      if (body.classList.contains('sp-panel-open')) body.style.maxHeight = 'none';
    }, { once: true });
  }
}

// ─── Close Bet ─────────
async function reopenBet(betId) {
  if (!confirm('Reopen this bet? It will be set back to open status.')) return;
  try {
    const res = await fetch(`/api/bets/${betId}/reopen`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Failed to reopen'); return; }
    showToast('Bet reopened');
    if (currentBetsTab === 'tailed') loadTailedBets(); else loadBets();
  } catch (e) {
    showToast('Failed to reopen bet');
  }
}

// ── Close Bet Modal ──
let closeBetPendingId = null;
let closeBetPendingOutcome = null;
let closeBetGifUrl = null;

function closeBet(betId) {
  closeBetPendingId = betId;
  closeBetPendingOutcome = null;
  closeBetGifUrl = null;
  // Reset UI
  document.querySelectorAll('.close-outcome-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('close-bet-message').value = '';
  document.getElementById('close-bet-confirm-btn').disabled = true;
  clearGifPreview();
  document.getElementById('close-bet-modal').classList.remove('hidden');
}

function selectCloseOutcome(outcome) {
  closeBetPendingOutcome = outcome;
  document.querySelectorAll('.close-outcome-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.outcome === outcome);
  });
  document.getElementById('close-bet-confirm-btn').disabled = false;
}

function closeCloseBetModal() {
  document.getElementById('close-bet-modal').classList.add('hidden');
  // Close any open pickers
  document.getElementById('emoji-picker').classList.add('hidden');
  document.getElementById('gif-picker').classList.add('hidden');
  document.getElementById('emoji-picker-btn').classList.remove('active');
  document.getElementById('gif-picker-btn').classList.remove('active');
  clearGifPreview();
  closeBetPendingId = null;
  closeBetPendingOutcome = null;
  closeBetGifUrl = null;
}

function setGifPreview(url) {
  closeBetGifUrl = url;
  const wrap = document.getElementById('gif-preview-wrap');
  wrap.innerHTML = `<img src="${url}" alt="GIF preview"><button type="button" class="gif-preview-remove" onclick="clearGifPreview()">&times;</button>`;
  wrap.classList.remove('hidden');
}

function clearGifPreview() {
  closeBetGifUrl = null;
  const wrap = document.getElementById('gif-preview-wrap');
  wrap.innerHTML = '';
  wrap.classList.add('hidden');
}

async function confirmCloseBet() {
  if (!closeBetPendingId || !closeBetPendingOutcome) return;
  const message = document.getElementById('close-bet-message').value.trim();
  const btn = document.getElementById('close-bet-confirm-btn');
  btn.disabled = true;
  btn.textContent = 'Closing...';

  try {
    const res = await fetch(`/api/bets/${closeBetPendingId}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: closeBetPendingOutcome, communityMessage: message || undefined, gifUrl: closeBetGifUrl || undefined })
    });
    const data = await res.json();
    if (data.error) {
      showToast('Error: ' + data.error);
      return;
    }
    showToast('Bet closed');
    closeCloseBetModal();
    loadBets(); // Refresh bets page
    if (closeBetsInitialized) {
      // Temporarily swap perms for renderBetCard
      const savedPerms = betsGuildPerms;
      betsGuildPerms = closeBetsPerms;
      loadCloseBets();
      betsGuildPerms = savedPerms;
    }
  } catch (e) {
    showToast('Failed to close bet');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Close & Post';
  }
}

// ── Emoji Picker ──
const EMOJI_DATA = {
  '😀': ['😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','🤗','🤩','🥳','😎','🤓','🧐','😏','😬','🤪','🫡','🫠'],
  '💰': ['💰','🤑','💵','💸','🏆','🎰','🎯','🔥','💎','👑','⚡','💪','🙌','👏','🫶','🤝','✅','❌','🔄','📈','📉','🚀'],
  '⚽': ['⚽','🏀','🏈','⚾','🎾','🏒','🥊','🏌️','🏇','🎳','♠️','♣️','♥️','♦️','🃏','🎲','🎮','🎪','🏅','🥇','🥈','🥉'],
  '👍': ['👍','👎','🤙','✌️','🤞','🫰','💅','🖕','🤘','👆','👇','👈','👉','🫵','💀','☠️','😈','🐐','🐍','🦁','🐻','🦅'],
  '❤️': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💯','💢','💥','✨','⭐','🌟','🎉','🎊','🍺','🥃','🍻','🥂','🍾','🎶'],
};

let emojiActiveTab = null;

function buildEmojiPicker() {
  const tabsEl = document.getElementById('emoji-tabs');
  const gridEl = document.getElementById('emoji-grid');
  if (tabsEl.children.length) return; // already built
  const cats = Object.keys(EMOJI_DATA);
  cats.forEach((icon, i) => {
    const btn = document.createElement('button');
    btn.className = 'picker-tab' + (i === 0 ? ' active' : '');
    btn.textContent = icon;
    btn.onclick = () => showEmojiCategory(icon);
    tabsEl.appendChild(btn);
  });
  showEmojiCategory(cats[0]);
}

function showEmojiCategory(catIcon) {
  emojiActiveTab = catIcon;
  const gridEl = document.getElementById('emoji-grid');
  gridEl.innerHTML = '';
  document.querySelectorAll('.picker-tab').forEach(t => t.classList.toggle('active', t.textContent === catIcon));
  EMOJI_DATA[catIcon].forEach(em => {
    const span = document.createElement('span');
    span.className = 'emoji-cell';
    span.textContent = em;
    span.onclick = () => insertAtCursor(document.getElementById('close-bet-message'), em);
    gridEl.appendChild(span);
  });
}

function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const before = textarea.value.substring(0, start);
  const after = textarea.value.substring(end);
  textarea.value = before + text + after;
  textarea.selectionStart = textarea.selectionEnd = start + text.length;
  textarea.focus();
}

function toggleCloseBetEmojiPicker() {
  const el = document.getElementById('emoji-picker');
  const gifEl = document.getElementById('gif-picker');
  const btn = document.getElementById('emoji-picker-btn');
  gifEl.classList.add('hidden');
  document.getElementById('gif-picker-btn').classList.remove('active');
  if (el.classList.contains('hidden')) {
    buildEmojiPicker();
    el.classList.remove('hidden');
    btn.classList.add('active');
  } else {
    el.classList.add('hidden');
    btn.classList.remove('active');
  }
}

// ── GIF Picker (GIPHY) ──
let gifSearchTimeout = null;

function toggleGifPicker() {
  const el = document.getElementById('gif-picker');
  const emojiEl = document.getElementById('emoji-picker');
  const btn = document.getElementById('gif-picker-btn');
  emojiEl.classList.add('hidden');
  document.getElementById('emoji-picker-btn').classList.remove('active');
  if (el.classList.contains('hidden')) {
    el.classList.remove('hidden');
    btn.classList.add('active');
    document.getElementById('gif-search-input').value = '';
    document.getElementById('gif-grid').innerHTML = '<p class="gif-placeholder">Search for a GIF above</p>';
    setTimeout(() => document.getElementById('gif-search-input').focus(), 50);
  } else {
    el.classList.add('hidden');
    btn.classList.remove('active');
  }
}

// Debounced GIF search
document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('gif-search-input');
  if (inp) {
    inp.addEventListener('input', () => {
      clearTimeout(gifSearchTimeout);
      const q = inp.value.trim();
      if (!q) {
        document.getElementById('gif-grid').innerHTML = '<p class="gif-placeholder">Search for a GIF above</p>';
        return;
      }
      gifSearchTimeout = setTimeout(() => searchGifs(q), 400);
    });
  }
});

async function searchGifs(query) {
  const grid = document.getElementById('gif-grid');
  grid.innerHTML = '<p class="gif-loading">Searching...</p>';
  try {
    const res = await fetch(`/api/giphy-search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    if (!data.results || !data.results.length) {
      grid.innerHTML = '<p class="gif-placeholder">No GIFs found</p>';
      return;
    }
    grid.innerHTML = '';
    data.results.forEach(gif => {
      const img = document.createElement('img');
      img.src = gif.preview;
      img.alt = gif.title || 'GIF';
      img.loading = 'lazy';
      img.onclick = () => {
        // Set GIF preview (don't insert URL into textarea)
        setGifPreview(gif.url);
        // Close picker
        document.getElementById('gif-picker').classList.add('hidden');
        document.getElementById('gif-picker-btn').classList.remove('active');
      };
      grid.appendChild(img);
    });
  } catch (e) {
    grid.innerHTML = '<p class="gif-placeholder">Failed to search GIFs</p>';
  }
}

// ─── Close Parlay Leg ─────────
async function closeLeg(betId, legId, status) {
  if (!confirm(`Mark this leg as ${status.toUpperCase()}?`)) return;

  try {
    const res = await fetch(`/api/bets/${betId}/legs/${legId}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    const data = await res.json();
    if (data.error) {
      alert('Error: ' + data.error);
      return;
    }
    loadBets(); // Refresh
  } catch (e) {
    alert('Failed to close leg');
  }
}

// ─── Edit Bet Modal ─────────
let editingBetData = null;

function openEditModal(betId) {
  fetchBetForEdit(betId);
}

async function fetchBetForEdit(betId) {
  try {
    const res = await fetch(`/api/bets/${betId}`);
    const bet = await res.json();
    if (!bet || bet.error) { alert('Could not load bet data'); return; }

    editingBetData = bet;

    // Navigate to the slip form page
    switchPage('slip');
    resetForm();

    // Mark the form as edit mode
    const submitBtn = document.getElementById('submit-btn');
    submitBtn.querySelector('.btn-text').textContent = 'Save Changes ✏️';
    submitBtn.dataset.editMode = betId;

    // Update header to show slip number
    document.getElementById('slip-title').textContent = `✏️ Edit Slip #${bet.slipNumber || ''}`;
    document.getElementById('slip-subtitle').textContent = 'Edit your bet details below — changes update the ticket on Discord';

    // Hide non-editable fields
    document.getElementById('server-channel-row').classList.add('hidden');
    document.getElementById('whale-row').classList.add('hidden');
    document.getElementById('admin-behalf-row').classList.add('hidden');

    // Remove required from hidden selects so form can submit
    document.getElementById('guild-select').required = false;
    document.getElementById('channel-select').required = false;

    const isParlay = bet.betType === 'parlay';

    // Set guild & channel (disabled during edit)
    const guildSel = document.getElementById('guild-select');
    guildSel.value = bet.guildId || '';
    guildSel.disabled = true;
    // Load channels for this guild then set value
    const channelSel = document.getElementById('channel-select');
    channelSel.disabled = true;

    // Set bet type
    const betTypeSel = document.getElementById('bet-type');
    betTypeSel.value = bet.betType || 'single';
    betTypeSel.disabled = true;

    if (isParlay) {
      // Show parlay mode
      document.getElementById('parlay-count-row').classList.remove('hidden');
      document.getElementById('single-fields').classList.add('hidden');
      document.getElementById('parlay-legs-container').classList.remove('hidden');
      document.getElementById('parlay-totals').classList.remove('hidden');

      const legCount = bet.legs?.length || 2;
      document.getElementById('parlay-legs-count').value = legCount;

      // Remove required from single fields
      ['bet-category', 'wager-type', 'odds', 'units'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.required = false;
      });

      // Build parlay leg forms
      buildParlayLegs();

      // Populate each leg
      setTimeout(() => {
        bet.legs?.forEach((leg, i) => {
          const idx = i + 1;
          const sportEl = document.querySelector(`.leg-sport[data-leg="${idx}"]`);
          if (sportEl) sportEl.value = leg.sport || '';

          const catEl = document.querySelector(`.leg-category[data-leg="${idx}"]`);
          if (catEl) {
            // Determine category
            const cat = leg.wagerType === 'futures' ? 'futures'
              : leg.wagerType === 'prop' ? 'player_prop'
              : (leg.teamA || leg.teamB) ? 'team_game'
              : leg.betCategory || 'team_game';
            catEl.value = cat;
            catEl.dispatchEvent(new Event('change'));

            if (cat === 'team_game') {
              const wagerEl = document.querySelector(`.leg-wager-type[data-leg="${idx}"]`);
              if (wagerEl) {
                wagerEl.value = leg.wagerType || 'moneyline';
                wagerEl.dispatchEvent(new Event('change'));
              }
              const teamAEl = document.querySelector(`.leg-team-a[data-leg="${idx}"]`);
              const teamBEl = document.querySelector(`.leg-team-b[data-leg="${idx}"]`);
              if (teamAEl) teamAEl.value = leg.teamA || '';
              if (teamBEl) teamBEl.value = leg.teamB || '';
              const spreadEl = document.querySelector(`.leg-spread-value[data-leg="${idx}"]`);
              if (spreadEl && leg.spreadValue) spreadEl.value = leg.spreadValue;
            } else if (cat === 'player_prop') {
              const playerEl = document.querySelector(`.leg-player-name[data-leg="${idx}"]`);
              const propEl = document.querySelector(`.leg-prop-desc[data-leg="${idx}"]`);
              if (playerEl) playerEl.value = leg.playerName || '';
              if (propEl) propEl.value = leg.propDescription || '';
            } else if (cat === 'futures') {
              const marketEl = document.querySelector(`.leg-futures-market[data-leg="${idx}"]`);
              const selEl = document.querySelector(`.leg-futures-selection[data-leg="${idx}"]`);
              if (marketEl && leg.pick) {
                const parts = leg.pick.split(': ');
                marketEl.value = parts.length > 1 ? parts[0] : leg.pick;
                if (selEl) selEl.value = parts.length > 1 ? parts.slice(1).join(': ') : '';
              }
            }
          }

          // Odds per leg
          const legOddsEl = document.querySelector(`.leg-odds[data-leg="${idx}"]`);
          if (legOddsEl && leg.oddsAmerican) legOddsEl.value = leg.oddsAmerican;

          // Game time per leg
          const legTimeEl = document.querySelector(`.leg-event-time[data-leg="${idx}"]`);
          if (legTimeEl && leg.eventStartTime) legTimeEl.value = leg.eventStartTime;
        });
      }, 100);

      // Set sport from first leg
      const sportSel = document.getElementById('sport-select');
      if (bet.legs?.[0]?.sport) sportSel.value = bet.legs[0].sport;

      // Parlay totals
      document.getElementById('parlay-odds').value = bet.oddsAmerican || '';
      document.getElementById('parlay-units').value = bet.units || '';
      document.getElementById('parlay-note').value = bet.betNote || '';

    } else {
      // Single bet
      document.getElementById('sport-select').value = bet.sport || '';

      const cat = bet.betCategory || (bet.wagerType === 'futures' ? 'futures' : (bet.playerName ? 'player_prop' : 'team_game'));
      const catSel = document.getElementById('bet-category');
      catSel.value = cat;

      // Trigger category change to show fields
      if (cat === 'team_game') {
        document.getElementById('team-fields').classList.remove('hidden');
        document.getElementById('wager-type-group').classList.remove('hidden');
        document.getElementById('prop-fields').classList.add('hidden');
        document.getElementById('futures-fields').classList.add('hidden');

        document.getElementById('team-a').value = bet.teamA || '';
        document.getElementById('team-b').value = bet.teamB || '';

        const wagerSel = document.getElementById('wager-type');
        wagerSel.value = bet.wagerType || 'moneyline';
        if (bet.wagerType === 'spread') {
          document.getElementById('spread-line-row').classList.remove('hidden');
          document.getElementById('spread-value').value = bet.spreadValue || '';
        } else if (bet.wagerType === 'total') {
          document.getElementById('spread-line-row').classList.remove('hidden');
          document.getElementById('over-under-row').classList.remove('hidden');
          document.getElementById('spread-value').value = bet.spreadValue || '';
          document.getElementById('spread-label').textContent = 'Total Line';
        }
      } else if (cat === 'player_prop') {
        document.getElementById('prop-fields').classList.remove('hidden');
        document.getElementById('team-fields').classList.add('hidden');
        document.getElementById('futures-fields').classList.add('hidden');
        document.getElementById('wager-type-group').classList.add('hidden');

        document.getElementById('player-name').value = bet.playerName || '';
        document.getElementById('prop-desc').value = bet.propDescription || '';
      } else if (cat === 'futures') {
        document.getElementById('futures-fields').classList.remove('hidden');
        document.getElementById('team-fields').classList.add('hidden');
        document.getElementById('prop-fields').classList.add('hidden');
        document.getElementById('wager-type-group').classList.add('hidden');

        if (bet.pick) {
          const parts = bet.pick.split(': ');
          document.getElementById('futures-market').value = parts.length > 1 ? parts[0] : bet.pick;
          document.getElementById('futures-selection').value = parts.length > 1 ? parts.slice(1).join(': ') : '';
        }
      }

      document.getElementById('odds').value = bet.oddsAmerican || '';
      document.getElementById('units').value = bet.units || '';
      document.getElementById('event-time').value = bet.eventStartTime || '';
      document.getElementById('bet-note').value = bet.betNote || '';
    }

    // Whale toggle
    const whaleEl = document.getElementById('is-whale');
    if (whaleEl) whaleEl.checked = bet.isWhale || false;

  } catch (e) {
    alert('Failed to load bet for editing');
  }
}

function closeEditModal() {
  // Legacy — edit now uses the main slip form; just clear state
  resetForm();
  editingBetData = null;
}

async function submitEditBet(e) {
  e.preventDefault();
  // This function is no longer used — edits go through handleSubmit in edit mode
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
    if (closeBetsInitialized) {
      const savedPerms = betsGuildPerms;
      betsGuildPerms = closeBetsPerms;
      loadCloseBets();
      betsGuildPerms = savedPerms;
    }
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
let reminderGuildPerms = {};
let reminderEmojis = [];
let editingReminderId = null;

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

  sel.addEventListener('change', async () => {
    // Fetch roles for this guild
    try {
      const rolesRes = await fetch(`/api/guilds/${sel.value}/roles`);
      reminderGuildPerms = await rolesRes.json();
    } catch (e) {
      reminderGuildPerms = { isAdmin: false };
    }

    // Show/hide create form and action buttons based on admin role
    const createCard = document.querySelector('.reminder-create-card');
    if (createCard) {
      createCard.style.display = reminderGuildPerms.isAdmin ? '' : 'none';
    }

    // Load emojis for emoji picker
    try {
      const emojiRes = await fetch(`/api/guilds/${sel.value}/emojis`);
      reminderEmojis = await emojiRes.json();
    } catch (e) {
      reminderEmojis = [];
    }

    loadReminderChannels();
    loadReminders();
  });

  // Auto-select: single guild hides picker, multi-guild selects first
  if (currentUser.guilds.length === 1) {
    autoSelectGuild(sel);
  } else if (currentUser.guilds.length > 1) {
    sel.value = currentUser.guilds[0].id;
    sel.dispatchEvent(new Event('change'));
  }

  // Calendar picker for reminder time
  const dtInput = document.getElementById('reminder-datetime');
  dtInput.addEventListener('change', () => {
    if (dtInput.value) {
      document.getElementById('reminder-time').value = formatDateTimePretty(dtInput.value);
      document.getElementById('reminder-time').dataset.isoValue = dtInput.value;
      updateReminderPreview();
    }
  });

  // Live preview listeners
  const msgInput = document.getElementById('reminder-message');
  const linkInput = document.getElementById('reminder-link');
  const typeSelect = document.getElementById('reminder-type');
  const repeatSelect = document.getElementById('reminder-repeat');
  const charCount = document.getElementById('reminder-char-count');

  msgInput.addEventListener('input', () => {
    charCount.textContent = msgInput.value.length;
    updateReminderPreview();
  });
  linkInput.addEventListener('input', () => updateReminderPreview());
  typeSelect.addEventListener('change', () => updateReminderPreview());
  repeatSelect.addEventListener('change', () => updateReminderPreview());

  document.getElementById('reminder-preview-timestamp').textContent = new Date().toLocaleString();
}

function updateReminderPreview() {
  const msg = document.getElementById('reminder-message').value || 'Your reminder will appear here...';
  const link = document.getElementById('reminder-link').value;
  const typeVal = document.getElementById('reminder-type').value;
  const typeInfo = REMINDER_TYPES[typeVal] || null;
  const repeat = document.getElementById('reminder-repeat').value;
  const timeInput = document.getElementById('reminder-time');

  // Update type badge
  const typeEl = document.getElementById('reminder-preview-type');
  if (typeInfo) {
    typeEl.textContent = `${typeInfo.emoji} ${typeInfo.label}`;
  } else {
    typeEl.textContent = '';
  }

  // Update message
  document.getElementById('reminder-preview-description').textContent = msg;

  // Update link
  const linkField = document.getElementById('reminder-preview-link-field');
  const linkValue = document.getElementById('reminder-preview-link-value');
  if (link) {
    linkField.classList.remove('hidden');
    linkValue.textContent = link;
    linkValue.href = link;
  } else {
    linkField.classList.add('hidden');
  }

  // Update meta (time + repeat)
  const metaEl = document.getElementById('reminder-preview-meta');
  let metaHtml = '';
  if (timeInput.value) {
    metaHtml += `<span>📅 ${esc(timeInput.value)}</span>`;
  }
  const chSel = document.getElementById('reminder-channel');
  if (chSel.value && chSel.selectedOptions[0]) {
    metaHtml += `<span>${esc(chSel.selectedOptions[0].textContent)}</span>`;
  }
  if (repeat && repeat !== 'none') {
    metaHtml += `<span>🔁 ${repeat}</span>`;
  }
  metaEl.innerHTML = metaHtml;

  document.getElementById('reminder-preview-timestamp').textContent = new Date().toLocaleString();
}

function openReminderCalendar() {
  const el = document.getElementById('reminder-datetime');
  try { el.showPicker(); } catch(e) { el.click(); }
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
      const scheduledDate = rem.scheduledAt ? new Date(rem.scheduledAt) : null;
      const timeStr = scheduledDate ? scheduledDate.toLocaleString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit'
      }) : '—';

      const repeatLabel = rem.repeat && rem.repeat !== 'none' ? `<span class="repeat-badge">${rem.repeat}</span>` : '';
      const adminActions = reminderGuildPerms.isAdmin
        ? `<button class="btn-edit-reminder" onclick="openEditReminder('${rem.id}')" title="Edit">✏️</button>
           <button class="btn-cancel-reminder" onclick="cancelReminder('${rem.id}')">Cancel</button>`
        : '';

      const card = document.createElement('div');
      card.className = 'reminder-card';
      card.dataset.reminderId = rem.id;
      card.dataset.reminderData = JSON.stringify(rem);
      card.innerHTML = `
        <span class="reminder-icon">${typeInfo.emoji}</span>
        <div class="reminder-info">
          <div class="reminder-type-label">${esc(typeInfo.label)}</div>
          <div class="reminder-msg">${esc(rem.message) || ''}</div>
          <div class="reminder-meta">
            <span>📅 ${esc(timeStr)}</span>
            <span>#${esc(rem.channelName || rem.channelId || '—')}</span>
            ${repeatLabel}
          </div>
        </div>
        <div class="reminder-actions">
          ${adminActions}
        </div>
      `;
      container.appendChild(card);
    });
  } catch (e) {
    container.innerHTML = '<p class="empty-state" style="color:var(--text-danger)">Failed to load reminders.</p>';
  }
}

async function submitReminder(e) {
  if (e && e.preventDefault) e.preventDefault();

  const guildId = document.getElementById('reminder-guild').value;
  const channelId = document.getElementById('reminder-channel').value;
  const type = document.getElementById('reminder-type').value;
  const message = document.getElementById('reminder-message').value.trim();
  const repeat = document.getElementById('reminder-repeat').value;
  const statusDiv = document.getElementById('reminder-status');
  const sendBtn = document.getElementById('reminder-send-btn');

  // Get time — either from ISO (calendar) or raw text
  const timeInput = document.getElementById('reminder-time');
  let scheduledAt = null;

  if (timeInput.dataset.isoValue) {
    scheduledAt = new Date(timeInput.dataset.isoValue).toISOString();
  } else {
    // Pass raw text — server will need to handle it or we convert here
    const raw = timeInput.value.trim();
    if (!raw) {
      statusDiv.className = 'announce-status announce-error';
      statusDiv.textContent = 'Please set a time.';
      statusDiv.classList.remove('hidden');
      return;
    }
    // Try to parse client-side
    scheduledAt = parseTimeClient(raw);
    if (!scheduledAt) {
      statusDiv.className = 'announce-status announce-error';
      statusDiv.textContent = 'Could not parse time. Use the calendar picker or formats like "in 2h", "tomorrow 9pm".';
      statusDiv.classList.remove('hidden');
      return;
    }
  }

  if (!guildId || !channelId || !type || !message) {
    statusDiv.className = 'announce-status announce-error';
    statusDiv.textContent = 'Please fill all required fields.';
    statusDiv.classList.remove('hidden');
    return;
  }

  sendBtn.disabled = true;
  sendBtn.textContent = '⏳ Creating...';
  statusDiv.classList.add('hidden');

  try {
    const res = await fetch(`/api/guilds/${guildId}/reminders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, message, scheduledAt, channelId, repeat })
    });
    const data = await res.json();
    if (data.error) {
      statusDiv.className = 'announce-status announce-error';
      statusDiv.textContent = '❌ ' + data.error;
      statusDiv.classList.remove('hidden');
      sendBtn.disabled = false;
      sendBtn.textContent = '⏰ Create';
      return;
    }

    // Success
    statusDiv.className = 'announce-status announce-success';
    statusDiv.textContent = '✅ Reminder created!';
    statusDiv.classList.remove('hidden');

    // Reset form
    document.getElementById('reminder-message').value = '';
    document.getElementById('reminder-link').value = '';
    document.getElementById('reminder-time').value = '';
    document.getElementById('reminder-char-count').textContent = '0';
    delete document.getElementById('reminder-time').dataset.isoValue;
    document.getElementById('reminder-datetime').value = '';
    updateReminderPreview();

    loadReminders();
  } catch (e) {
    statusDiv.className = 'announce-status announce-error';
    statusDiv.textContent = '❌ Failed to create reminder.';
    statusDiv.classList.remove('hidden');
  }

  sendBtn.disabled = false;
  sendBtn.textContent = '⏰ Create';
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

// ─── Edit Reminder ─────────
function openEditReminder(reminderId) {
  const card = document.querySelector(`.reminder-card[data-reminder-id="${reminderId}"]`);
  if (!card) return;

  const rem = JSON.parse(card.dataset.reminderData);
  editingReminderId = reminderId;

  document.getElementById('edit-reminder-type').value = rem.type || 'custom';
  document.getElementById('edit-reminder-message').value = rem.message || '';
  document.getElementById('edit-reminder-repeat').value = rem.repeat || 'none';

  // Populate channel dropdown
  const chSel = document.getElementById('edit-reminder-channel');
  const mainChSel = document.getElementById('reminder-channel');
  chSel.innerHTML = mainChSel.innerHTML;
  chSel.value = rem.channelId || '';

  // Set time
  const editTimeInput = document.getElementById('edit-reminder-time');
  if (rem.scheduledAt) {
    editTimeInput.value = formatDateTimePretty(rem.scheduledAt);
    editTimeInput.dataset.isoValue = new Date(rem.scheduledAt).toISOString();
  } else {
    editTimeInput.value = '';
    delete editTimeInput.dataset.isoValue;
  }

  document.getElementById('edit-reminder-modal').classList.remove('hidden');
}

function closeEditReminderModal() {
  document.getElementById('edit-reminder-modal').classList.add('hidden');
  editingReminderId = null;
}

function openEditReminderCalendar() {
  const picker = document.getElementById('edit-reminder-datetime');
  picker.addEventListener('change', function handler() {
    if (picker.value) {
      document.getElementById('edit-reminder-time').value = formatDateTimePretty(picker.value);
      document.getElementById('edit-reminder-time').dataset.isoValue = picker.value;
    }
    picker.removeEventListener('change', handler);
  });
  try { picker.showPicker(); } catch(e) { picker.click(); }
}

async function submitEditReminder(e) {
  e.preventDefault();
  if (!editingReminderId) return;

  const guildId = document.getElementById('reminder-guild').value;
  const type = document.getElementById('edit-reminder-type').value;
  const message = document.getElementById('edit-reminder-message').value.trim();
  const channelId = document.getElementById('edit-reminder-channel').value;
  const repeat = document.getElementById('edit-reminder-repeat').value;

  const timeInput = document.getElementById('edit-reminder-time');
  let scheduledAt = null;
  if (timeInput.dataset.isoValue) {
    scheduledAt = new Date(timeInput.dataset.isoValue).toISOString();
  }

  const body = {};
  if (type) body.type = type;
  if (message) body.message = message;
  if (channelId) body.channelId = channelId;
  if (scheduledAt) body.scheduledAt = scheduledAt;
  if (repeat) body.repeat = repeat;

  try {
    const res = await fetch(`/api/guilds/${guildId}/reminders/${editingReminderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.error) {
      alert('Error: ' + data.error);
      return;
    }
    closeEditReminderModal();
    loadReminders();
  } catch (e) {
    alert('Failed to edit reminder');
  }
}

// ─── Emoji Picker ─────────
function toggleEmojiPicker(targetInputId) {
  const existing = document.getElementById('emoji-picker-popup');
  if (existing) { existing.remove(); return; }

  if (!reminderEmojis || reminderEmojis.length === 0) {
    alert('No custom emojis found on this server.');
    return;
  }

  const targetInput = document.getElementById(targetInputId);
  const popup = document.createElement('div');
  popup.id = 'emoji-picker-popup';
  popup.className = 'emoji-picker-popup';

  let html = '<div class="emoji-picker-header"><span>Server Emojis</span><button onclick="document.getElementById(\'emoji-picker-popup\')?.remove()">&times;</button></div>';
  html += '<div class="emoji-picker-grid">';
  reminderEmojis.forEach(em => {
    html += `<button type="button" class="emoji-pick-btn" title=":${esc(em.name)}:" onclick="insertEmoji('${targetInputId}', '${em.formatted.replace(/'/g, "\\'")}')">
      <img src="${esc(em.url)}" alt="${esc(em.name)}" width="24" height="24">
    </button>`;
  });
  html += '</div>';
  popup.innerHTML = html;

  targetInput.parentElement.style.position = 'relative';
  targetInput.parentElement.appendChild(popup);
}

function insertEmoji(targetInputId, emoji) {
  const input = document.getElementById(targetInputId);
  const pos = input.selectionStart || input.value.length;
  input.value = input.value.substring(0, pos) + emoji + input.value.substring(pos);
  input.focus();
  document.getElementById('emoji-picker-popup')?.remove();
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

// ═══════════════════════════════════════════════
//  Admin Analytics
// ═══════════════════════════════════════════════

async function checkOwnerFeatures() {
  // Analytics: owner-only (try the endpoint)
  try {
    const res = await fetch('/api/analytics');
    if (res.ok) {
      const navLink = document.getElementById('nav-analytics');
      if (navLink) navLink.classList.remove('hidden');
    }
  } catch (e) {}

  // Announce + Reminders: admin in any guild
  for (const g of currentUser.guilds) {
    try {
      const data = await fetch(`/api/guilds/${g.id}/roles`).then(r => r.json());
      if (data.isAdmin) {
        const announceLink = document.getElementById('nav-announce');
        if (announceLink) announceLink.classList.remove('hidden');
        const remindersLink = document.getElementById('nav-reminders');
        if (remindersLink) remindersLink.classList.remove('hidden');
        break;
      }
    } catch (e) {}
  }

  // Show admin section if any admin link is visible
  const adminSection = document.getElementById('sidebar-admin');
  const adminLinks = document.querySelectorAll('#admin-items .sidebar-link');
  const anyVisible = [...adminLinks].some(l => !l.classList.contains('hidden'));
  if (anyVisible && adminSection) adminSection.classList.remove('hidden');
}

let analyticsInitialized = false;
let analyticsData = null;

async function initAnalyticsPage() {
  if (analyticsInitialized) return;
  analyticsInitialized = true;

  try {
    const res = await fetch('/api/analytics');
    if (!res.ok) {
      document.getElementById('analytics-users-list').innerHTML =
        '<p class="muted-text">Access denied or failed to load analytics.</p>';
      return;
    }
    analyticsData = await res.json();
    renderAnalyticsSummary();
    renderOnlineUsers();
    renderAnalyticsUsers();
    renderAnalyticsInstalls();
    renderAnalyticsActivity();

    // Auto-refresh online users every 15s
    setInterval(async () => {
      try {
        const onRes = await fetch('/api/analytics/online');
        if (onRes.ok) {
          const onData = await onRes.json();
          document.getElementById('analytics-online-count').textContent = onData.count;
          renderOnlineUsers(onData);
        }
      } catch (e) {}
    }, 15000);
  } catch (e) {
    document.getElementById('analytics-users-list').innerHTML =
      '<p class="muted-text">Failed to load analytics.</p>';
  }
}

function renderAnalyticsSummary() {
  document.getElementById('analytics-unique-users').textContent = analyticsData.uniqueUsers;
  document.getElementById('analytics-total-logins').textContent = analyticsData.totalLogins;
  document.getElementById('analytics-bets-placed').textContent = analyticsData.betsPlaced;
  document.getElementById('analytics-leaderboard-views').textContent = analyticsData.leaderboardViews;
  document.getElementById('analytics-unique-installs').textContent = analyticsData.uniqueInstallers;
  document.getElementById('analytics-page-views').textContent = analyticsData.pageViews;

  // Fetch online count
  fetch('/api/analytics/online').then(r => r.json()).then(d => {
    document.getElementById('analytics-online-count').textContent = d.count;
  }).catch(() => {});
}

function renderOnlineUsers(data) {
  const container = document.getElementById('analytics-online-list');
  const fetchAndRender = async () => {
    let onlineData = data;
    if (!onlineData) {
      try {
        const res = await fetch('/api/analytics/online');
        if (!res.ok) return;
        onlineData = await res.json();
      } catch (e) { return; }
    }
    if (!onlineData.users || onlineData.users.length === 0) {
      container.innerHTML = '<p class="muted-text">No users online right now.</p>';
      return;
    }
    container.innerHTML = onlineData.users.map(u => {
      return `<div class="analytics-user-row">
        <img src="/api/avatar/${esc(u.discordId)}" class="analytics-avatar" alt="">
        <span class="online-dot"></span>
        <div class="analytics-user-info">
          <strong>${esc(u.displayName || u.username)}</strong>
          <span class="muted-text">${esc(u.username)}</span>
        </div>
      </div>`;
    }).join('');
  };
  fetchAndRender();
}

function renderAnalyticsUsers() {
  const container = document.getElementById('analytics-users-list');
  const logins = analyticsData.events.filter(e => e.event_type === 'login');

  // Group by user, get most recent login and count
  const userMap = new Map();
  logins.forEach(e => {
    if (!userMap.has(e.discord_id)) {
      userMap.set(e.discord_id, { ...e, loginCount: 1 });
    } else {
      userMap.get(e.discord_id).loginCount++;
    }
  });

  const users = [...userMap.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (users.length === 0) {
    container.innerHTML = '<p class="muted-text">No logins recorded yet.</p>';
    return;
  }

  container.innerHTML = `
    <table class="analytics-table">
      <thead>
        <tr>
          <th>User</th>
          <th>Logins</th>
          <th>Last Login</th>
          <th>Device</th>
        </tr>
      </thead>
      <tbody>
        ${users.map(u => `
          <tr>
            <td class="analytics-user-cell">
              <img src="/api/avatar/${esc(u.discord_id)}" class="analytics-avatar" alt="">
              <span>${esc(u.display_name || u.discord_username)}</span>
            </td>
            <td>${u.loginCount}</td>
            <td>${formatDateTimePretty(u.created_at)}</td>
            <td class="analytics-device">${parseDevice(u.user_agent)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderAnalyticsInstalls() {
  const container = document.getElementById('analytics-installs-list');
  const installs = analyticsData.events.filter(e => e.event_type === 'pwa_install' || e.event_type === 'pwa_launch');

  // Group by user
  const installMap = new Map();
  installs.forEach(e => {
    if (!installMap.has(e.discord_id)) {
      installMap.set(e.discord_id, e);
    }
  });

  const users = [...installMap.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (users.length === 0) {
    container.innerHTML = '<p class="muted-text">No app installs recorded yet.</p>';
    return;
  }

  container.innerHTML = `
    <table class="analytics-table">
      <thead>
        <tr>
          <th>User</th>
          <th>Installed</th>
          <th>Device</th>
        </tr>
      </thead>
      <tbody>
        ${users.map(u => `
          <tr>
            <td class="analytics-user-cell">
              <img src="/api/avatar/${esc(u.discord_id)}" class="analytics-avatar" alt="">
              <span>${esc(u.display_name || u.discord_username)}</span>
            </td>
            <td>${formatDateTimePretty(u.created_at)}</td>
            <td class="analytics-device">${parseDevice(u.user_agent)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderAnalyticsActivity() {
  const container = document.getElementById('analytics-activity-list');
  const events = analyticsData.events.slice(0, 100); // Latest 100

  if (events.length === 0) {
    container.innerHTML = '<p class="muted-text">No activity yet.</p>';
    return;
  }

  container.innerHTML = `
    <table class="analytics-table">
      <thead>
        <tr>
          <th>User</th>
          <th>Event</th>
          <th>Time</th>
          <th>Device</th>
        </tr>
      </thead>
      <tbody>
        ${events.map(e => `
          <tr>
            <td class="analytics-user-cell">
              <img src="/api/avatar/${esc(e.discord_id)}" class="analytics-avatar" alt="">
              <span>${esc(e.display_name || e.discord_username)}</span>
            </td>
            <td><span class="analytics-badge ${badgeClass(e.event_type)}">${eventLabel(e.event_type)}</span></td>
            <td>${formatDateTimePretty(e.created_at)}</td>
            <td class="analytics-device">${parseDevice(e.user_agent)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function switchAnalyticsTab(tab) {
  document.querySelectorAll('.analytics-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.analytics-tab[data-tab="${tab}"]`).classList.add('active');

  document.querySelectorAll('.analytics-tab-content').forEach(c => c.classList.add('hidden'));
  document.getElementById(`analytics-tab-${tab}`).classList.remove('hidden');
}

function parseDevice(ua) {
  if (!ua) return '—';
  if (/iPhone|iPad/i.test(ua)) return '🍎 iOS';
  if (/Android/i.test(ua)) return '🤖 Android';
  if (/Windows/i.test(ua)) return '🖥️ Windows';
  if (/Mac/i.test(ua)) return '💻 Mac';
  if (/Linux/i.test(ua)) return '🐧 Linux';
  return '🌐 Other';
}

function eventLabel(type) {
  const labels = {
    login: '🔑 Login',
    pwa_install: '📱 Install',
    pwa_launch: '📱 App Open',
    bet_placed: '🎰 Bet Placed',
    view_leaderboard: '🏆 Leaderboard',
    view_stats: '📊 Stats',
    view_bets: '📋 Bets',
    view_tools: '🔧 Tools',
    view_reminders: '⏰ Reminders',
    page_view: '🎟️ Slip',
  };
  return labels[type] || type;
}

function badgeClass(type) {
  const classes = {
    login: 'badge-login',
    pwa_install: 'badge-install',
    pwa_launch: 'badge-install',
    bet_placed: 'badge-bet',
    view_leaderboard: 'badge-leaderboard',
  };
  return classes[type] || 'badge-page';
}

// ═══════════════════════════════════════════════
//  Announce / DM Composer
// ═══════════════════════════════════════════════

let announceInitialized = false;

function initAnnouncePage() {
  if (announceInitialized) return;
  announceInitialized = true;

  // Populate guild dropdown
  const guildSelect = document.getElementById('announce-guild');
  currentUser.guilds.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.name;
    guildSelect.appendChild(opt);
  });

  // Auto-select if one guild
  if (currentUser.guilds.length === 1) {
    guildSelect.value = currentUser.guilds[0].id;
    guildSelect.closest('.form-group').style.display = 'none';
    loadAnnounceMembers(currentUser.guilds[0].id);
    loadWelcomeSettings(currentUser.guilds[0].id);
  }

  // Guild change → load members + welcome settings
  guildSelect.addEventListener('change', () => {
    loadAnnounceMembers(guildSelect.value);
    loadWelcomeSettings(guildSelect.value);
  });

  // Live preview as you type
  const msgInput = document.getElementById('announce-message');
  const linkInput = document.getElementById('announce-link');
  const charCount = document.getElementById('announce-char-count');

  msgInput.addEventListener('input', () => {
    charCount.textContent = msgInput.value.length;
    updateAnnouncePreview();
  });
  linkInput.addEventListener('input', () => updateAnnouncePreview());

  // Set initial timestamp
  document.getElementById('preview-timestamp').textContent = new Date().toLocaleString();
}

async function loadAnnounceMembers(guildId) {
  const targetSelect = document.getElementById('announce-target');
  targetSelect.innerHTML = '<option value="all">📢 All Members</option><option disabled>Loading members...</option>';

  try {
    const res = await fetch(`/api/guilds/${guildId}/members`);
    const data = await res.json();
    targetSelect.innerHTML = '<option value="all">📢 All Members</option>';
    if (res.ok && Array.isArray(data)) {
      data.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.displayName;
        targetSelect.appendChild(opt);
      });
      if (data.length === 0) {
        targetSelect.innerHTML += '<option disabled>No members found</option>';
      }
    } else {
      console.error('Members API error:', data);
      targetSelect.innerHTML += `<option disabled>Error: ${data.error || 'Failed to load'}</option>`;
    }
  } catch (e) {
    console.error('Members fetch error:', e);
    targetSelect.innerHTML = '<option value="all">📢 All Members</option><option disabled>Failed to load members</option>';
  }
}

function updateAnnouncePreview() {
  const msg = document.getElementById('announce-message').value || 'Your message will appear here...';
  const link = document.getElementById('announce-link').value;

  document.getElementById('preview-description').textContent = msg;

  const linkField = document.getElementById('preview-link-field');
  const linkValue = document.getElementById('preview-link-value');
  if (link) {
    linkField.classList.remove('hidden');
    linkValue.textContent = link;
    linkValue.href = link;
  } else {
    linkField.classList.add('hidden');
  }

  document.getElementById('preview-timestamp').textContent = new Date().toLocaleString();
}

function previewAnnouncement() {
  updateAnnouncePreview();
}

async function sendAnnouncement() {
  const guildId = document.getElementById('announce-guild').value;
  const targetUserId = document.getElementById('announce-target').value;
  const message = document.getElementById('announce-message').value.trim();
  const link = document.getElementById('announce-link').value.trim();
  const statusDiv = document.getElementById('announce-status');
  const sendBtn = document.getElementById('announce-send-btn');

  if (!guildId) {
    statusDiv.className = 'announce-status announce-error';
    statusDiv.textContent = 'Please select a server.';
    statusDiv.classList.remove('hidden');
    return;
  }
  if (!message) {
    statusDiv.className = 'announce-status announce-error';
    statusDiv.textContent = 'Please enter a message.';
    statusDiv.classList.remove('hidden');
    return;
  }

  const targetName = targetUserId === 'all'
    ? 'ALL members'
    : document.getElementById('announce-target').selectedOptions[0]?.textContent || 'user';

  if (!confirm(`Send this DM to ${targetName}?`)) return;

  sendBtn.disabled = true;
  sendBtn.textContent = '⏳ Sending...';
  statusDiv.className = 'announce-status announce-info';
  statusDiv.textContent = 'Sending...';
  statusDiv.classList.remove('hidden');

  try {
    const res = await fetch('/api/announce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId, message, link: link || null, targetUserId }),
    });
    const data = await res.json();

    if (data.sending) {
      statusDiv.className = 'announce-status announce-success';
      statusDiv.textContent = `📤 Sending DMs to ${data.totalMembers} members in the background. Check server logs for results.`;
    } else if (data.success) {
      statusDiv.className = 'announce-status announce-success';
      statusDiv.textContent = `✅ DM sent successfully! (${data.sent} sent, ${data.failed} failed)`;
    } else {
      statusDiv.className = 'announce-status announce-error';
      statusDiv.textContent = `❌ ${data.error || 'Failed to send'}`;
    }
  } catch (e) {
    statusDiv.className = 'announce-status announce-error';
    statusDiv.textContent = '❌ Failed to send announcement.';
  }

  sendBtn.disabled = false;
  sendBtn.textContent = '📤 Send';
}

// ── Welcome Message Editor ──
let welcomeLoaded = false;

async function loadWelcomeSettings(guildId) {
  if (!guildId) return;
  try {
    const res = await fetch(`/api/guilds/${guildId}/welcome`);
    if (!res.ok) return;
    const data = await res.json();

    document.getElementById('welcome-enabled').checked = data.enabled;
    document.getElementById('welcome-title').value = data.title || '';
    document.getElementById('welcome-description').value = data.description || '';

    const list = document.getElementById('welcome-fields-list');
    list.innerHTML = '';
    (data.fields || []).forEach(f => addWelcomeField(f.name, f.value));

    welcomeLoaded = true;
  } catch (e) {
    console.error('Failed to load welcome settings', e);
  }
}

function addWelcomeField(name, value) {
  const list = document.getElementById('welcome-fields-list');
  const row = document.createElement('div');
  row.className = 'welcome-field-row';
  row.innerHTML = `
    <div class="form-group">
      <label>Name</label>
      <input type="text" class="form-input wf-name" maxlength="256" value="${esc(name || '')}">
    </div>
    <div class="form-group">
      <label>Value</label>
      <input type="text" class="form-input wf-value" maxlength="1024" value="${esc(value || '')}">
    </div>
    <button type="button" class="welcome-field-remove" onclick="this.closest('.welcome-field-row').remove()" title="Remove">✕</button>
  `;
  list.appendChild(row);
}

function getWelcomePayload() {
  const guildId = document.getElementById('announce-guild').value;
  const enabled = document.getElementById('welcome-enabled').checked;
  const title = document.getElementById('welcome-title').value.trim();
  const description = document.getElementById('welcome-description').value.trim();
  const fieldRows = document.querySelectorAll('#welcome-fields-list .welcome-field-row');
  const fields = [];
  fieldRows.forEach(row => {
    const name = row.querySelector('.wf-name').value.trim();
    const value = row.querySelector('.wf-value').value.trim();
    if (name && value) fields.push({ name, value });
  });
  return { guildId, enabled, title, description, fields };
}

async function saveWelcomeMessage() {
  const { guildId, enabled, title, description, fields } = getWelcomePayload();
  const statusDiv = document.getElementById('welcome-status');

  if (!guildId) {
    statusDiv.className = 'announce-status announce-error';
    statusDiv.textContent = 'Please select a server first.';
    statusDiv.classList.remove('hidden');
    return;
  }

  try {
    const res = await fetch(`/api/guilds/${guildId}/welcome`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, title, description, fields }),
    });
    const data = await res.json();
    if (res.ok) {
      statusDiv.className = 'announce-status announce-success';
      statusDiv.textContent = '✅ Welcome message saved!';
    } else {
      statusDiv.className = 'announce-status announce-error';
      statusDiv.textContent = `❌ ${data.error || 'Failed to save'}`;
    }
  } catch (e) {
    statusDiv.className = 'announce-status announce-error';
    statusDiv.textContent = '❌ Failed to save welcome message.';
  }
  statusDiv.classList.remove('hidden');
}

async function testWelcomeMessage() {
  const { guildId, title, description, fields } = getWelcomePayload();
  const statusDiv = document.getElementById('welcome-status');

  if (!guildId) {
    statusDiv.className = 'announce-status announce-error';
    statusDiv.textContent = 'Please select a server first.';
    statusDiv.classList.remove('hidden');
    return;
  }

  statusDiv.className = 'announce-status announce-info';
  statusDiv.textContent = '📩 Sending test DM...';
  statusDiv.classList.remove('hidden');

  try {
    const res = await fetch(`/api/guilds/${guildId}/welcome/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, fields }),
    });
    const data = await res.json();
    if (data.success) {
      statusDiv.className = 'announce-status announce-success';
      statusDiv.textContent = '✅ Test DM sent! Check your DMs.';
    } else {
      statusDiv.className = 'announce-status announce-error';
      statusDiv.textContent = `❌ ${data.error || 'Failed to send test'}`;
    }
  } catch (e) {
    statusDiv.className = 'announce-status announce-error';
    statusDiv.textContent = '❌ Failed to send test DM.';
  }
}
document.addEventListener('DOMContentLoaded', function() {
  const eventCalBtn = document.getElementById('event-time-cal-btn');
  if (eventCalBtn) {
    eventCalBtn.addEventListener('click', function() {
      const el = document.getElementById('event-time-picker');
      try { el.showPicker(); } catch(e) { el.click(); }
    });
  }
  const reminderCalBtn = document.getElementById('reminder-cal-btn');
  if (reminderCalBtn) {
    reminderCalBtn.addEventListener('click', function() {
      openReminderCalendar();
    });
  }
  const editReminderCalBtn = document.getElementById('edit-reminder-cal-btn');
  if (editReminderCalBtn) {
    editReminderCalBtn.addEventListener('click', function() {
      openEditReminderCalendar();
    });
  }
});

// ═══════════════════════════════════════════════
//   SHARE TO DISCORD
// ═══════════════════════════════════════════════

let sharePageType = null;
let shareChannelsCache = {}; // guildId -> channels[]
let shareCapturedImage = null; // base64 data URL of the captured screenshot

function getShareCaptureTarget(pageType) {
  if (pageType === 'stats') return document.getElementById('stats-content');
  if (pageType === 'leaderboard') return document.getElementById('lb-content');
  return null;
}

/** Build a temporary banner injected into the capture target for the screenshot */
function buildShareBanner(pageType) {
  const banner = document.createElement('div');
  banner.className = 'share-capture-banner';

  let line1 = '';
  let line2 = '';

  if (pageType === 'stats') {
    // User name — resolve actual name when "Me" is selected
    const userSel = document.getElementById('stats-user');
    let userName;
    if (!userSel.value && currentUser && currentUser.displayName) {
      userName = currentUser.displayName;
    } else if (userSel.selectedIndex >= 0) {
      userName = userSel.options[userSel.selectedIndex].text;
    } else {
      userName = 'Unknown';
    }
    // Period
    const periodSel = document.getElementById('stats-period');
    const periodLabel = periodSel.selectedIndex >= 0
      ? periodSel.options[periodSel.selectedIndex].text
      : 'All Time';

    line1 = `📊 ${userName}'s Stats`;
    line2 = periodLabel;
  } else if (pageType === 'leaderboard') {
    // Board type
    const typeSel = document.getElementById('lb-type');
    const typeLabel = typeSel.selectedIndex >= 0
      ? typeSel.options[typeSel.selectedIndex].text
      : 'Leaderboard';
    // Category
    const catSel = document.getElementById('lb-category');
    const catLabel = catSel.selectedIndex >= 0
      ? catSel.options[catSel.selectedIndex].text
      : '';

    line1 = `🏆 ${typeLabel}`;
    line2 = catLabel;
  }

  banner.innerHTML =
    `<div class="share-banner-title">${line1}</div>` +
    (line2 ? `<div class="share-banner-sub">${line2}</div>` : '');

  return banner;
}

async function openShareModal(pageType) {
  sharePageType = pageType;
  shareCapturedImage = null;

  const guildId = getShareGuildId(pageType);
  if (!guildId) {
    showToast('Select a server first');
    return;
  }

  const target = getShareCaptureTarget(pageType);
  if (!target || target.classList.contains('hidden')) {
    showToast('Load data first before sharing');
    return;
  }

  const desc = document.getElementById('share-modal-desc');
  desc.textContent = pageType === 'stats'
    ? 'Post your statistics screenshot to a Discord channel'
    : 'Post the leaderboard screenshot to a Discord channel';

  // Show modal with loading state
  const modal = document.getElementById('share-modal');
  const previewImg = document.getElementById('share-preview-img');
  const previewLoading = document.getElementById('share-preview-loading');
  previewImg.classList.add('hidden');
  previewLoading.classList.remove('hidden');
  document.getElementById('share-send-btn').disabled = true;
  modal.classList.remove('hidden');

  // Load channels in parallel with screenshot capture
  const channelSelect = document.getElementById('share-channel');
  loadShareChannels(guildId, channelSelect);

  // Build a temporary header banner for the screenshot
  const banner = buildShareBanner(pageType);

  // Wrap content in a polished capture container so the screenshot
  // fills the Discord message with clean borders and background
  const wrapper = document.createElement('div');
  wrapper.className = 'share-capture-wrapper';
  wrapper.appendChild(banner);

  // Selectively clone only key sections for a compact aspect ratio.
  // Discord constrains inline images to ~300px height, so a very tall
  // image gets squished into a tiny narrow strip.
  const contentBox = document.createElement('div');
  contentBox.style.cssText = 'width:100%; padding:16px; box-sizing:border-box;';

  if (pageType === 'stats') {
    // Hero banner (record, win%, net, ROI, total, open)
    const hero = target.querySelector('.sp-hero');
    if (hero) contentBox.appendChild(hero.cloneNode(true));
    // First panel = Betting Activity
    const panels = target.querySelectorAll('.sp-panel');
    if (panels[0]) contentBox.appendChild(panels[0].cloneNode(true));
    // Second panel = Breakdowns
    if (panels[1]) contentBox.appendChild(panels[1].cloneNode(true));
  } else {
    // Leaderboard — clone the whole table
    const clone = target.cloneNode(true);
    clone.classList.remove('hidden');
    clone.style.display = 'block';
    contentBox.appendChild(clone);
  }

  // Force all child panels/sections to fill the width
  contentBox.querySelectorAll('.sp-hero, .sp-panel, .sp-metric-grid, .sp-bw-row, .breakdown-grid').forEach(el => {
    el.style.maxWidth = '100%';
    el.style.width = '100%';
    el.style.boxSizing = 'border-box';
  });
  wrapper.appendChild(contentBox);

  // Footer branding
  const footer = document.createElement('div');
  footer.className = 'share-capture-footer';
  footer.textContent = 'thegamblingkingapp.com';
  wrapper.appendChild(footer);

  // Append offscreen so html2canvas can render it
  document.body.appendChild(wrapper);

  // Capture screenshot
  try {
    const canvas = await html2canvas(wrapper, {
      backgroundColor: '#0d0d0d',
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false,
      width: 800,
      windowWidth: 800,
      imageTimeout: 5000,
      removeContainer: true,
    });
    // Use JPEG to keep size manageable (especially on mobile)
    shareCapturedImage = canvas.toDataURL('image/jpeg', 0.92);
    // Fallback to PNG if JPEG returned empty
    if (!shareCapturedImage || shareCapturedImage.length < 100) {
      shareCapturedImage = canvas.toDataURL('image/png');
    }
    previewImg.src = shareCapturedImage;
    previewImg.classList.remove('hidden');
    previewLoading.classList.add('hidden');
    document.getElementById('share-send-btn').disabled = false;
  } catch (e) {
    console.error('Screenshot capture failed:', e);
    previewLoading.innerHTML = '<p style="color:var(--text-danger)">Failed to capture screenshot. Try refreshing the page.</p>';
    showToast('Screenshot capture failed: ' + (e.message || 'Unknown error'));
  } finally {
    // Always remove the temporary wrapper
    wrapper.remove();
  }
}

function closeShareModal() {
  document.getElementById('share-modal').classList.add('hidden');
  sharePageType = null;
  shareCapturedImage = null;
}

function getShareGuildId(pageType) {
  if (pageType === 'stats') return document.getElementById('stats-guild').value;
  if (pageType === 'leaderboard') return document.getElementById('lb-guild').value;
  return null;
}

async function loadShareChannels(guildId, selectEl) {
  selectEl.innerHTML = '<option value="" disabled selected>Loading...</option>';
  selectEl.disabled = true;

  try {
    if (!shareChannelsCache[guildId]) {
      const res = await fetch(`/api/guilds/${guildId}/channels?sendable=1`);
      shareChannelsCache[guildId] = await res.json();
    }
    const channels = shareChannelsCache[guildId];

    selectEl.innerHTML = '<option value="" disabled selected>Select channel</option>';
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
      selectEl.appendChild(group);
    });
    selectEl.disabled = false;
  } catch (e) {
    selectEl.innerHTML = '<option value="" disabled selected>Error loading channels</option>';
  }
}

async function sendShareToDiscord() {
  const channelId = document.getElementById('share-channel').value;
  if (!channelId) { showToast('Select a channel'); return; }

  const guildId = getShareGuildId(sharePageType);
  if (!guildId) { showToast('No server selected'); return; }

  if (!shareCapturedImage) { showToast('Screenshot not ready'); return; }

  const btn = document.getElementById('share-send-btn');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    // Resolve display info for the Discord message
    let shareUserName = '';
    let sharePeriod = '';
    if (sharePageType === 'stats') {
      const userSel = document.getElementById('stats-user');
      shareUserName = (!userSel.value && currentUser) ? currentUser.displayName
        : (userSel.selectedIndex >= 0 ? userSel.options[userSel.selectedIndex].text : '');
      const periodSel = document.getElementById('stats-period');
      sharePeriod = periodSel.selectedIndex >= 0 ? periodSel.options[periodSel.selectedIndex].text : 'All Time';
    } else if (sharePageType === 'leaderboard') {
      const typeSel = document.getElementById('lb-type');
      shareUserName = typeSel.selectedIndex >= 0 ? typeSel.options[typeSel.selectedIndex].text : 'Leaderboard';
      const catSel = document.getElementById('lb-category');
      sharePeriod = catSel.selectedIndex >= 0 ? catSel.options[catSel.selectedIndex].text : '';
    }

    const res = await fetch('/api/share-to-discord', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guildId,
        channelId,
        pageType: sharePageType,
        imageData: shareCapturedImage,
        userName: shareUserName,
        periodLabel: sharePeriod,
      }),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch {
      console.error('Non-JSON response:', res.status, text.slice(0, 200));
      showToast(res.status === 413 ? 'Image too large – try a smaller screenshot' : 'Server error (' + res.status + ')');
      return;
    }
    if (data.success) {
      showToast('Shared to Discord!');
      closeShareModal();
    } else {
      showToast(data.error || 'Failed to share');
    }
  } catch (e) {
    console.error('Share failed:', e);
    showToast('Failed to share: ' + (e.message || 'Network error'));
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="12" viewBox="0 0 71 55" fill="currentColor"><path d="M60.1 4.9A58.5 58.5 0 0045.4.2a.2.2 0 00-.2.1 40.8 40.8 0 00-1.8 3.7 54 54 0 00-16.2 0A37.4 37.4 0 0025.4.3a.2.2 0 00-.2-.1A58.4 58.4 0 0010.5 5 59.6 59.6 0 00.4 45.1a.3.3 0 00.1.2 58.7 58.7 0 0017.7 9 .2.2 0 00.3-.1 42 42 0 003.6-5.9.2.2 0 00-.1-.3 38.7 38.7 0 01-5.5-2.6.2.2 0 01 0-.4l1.1-.9a.2.2 0 01.2 0 41.8 41.8 0 0035.6 0 .2.2 0 01.2 0l1.1.9a.2.2 0 010 .4 36.4 36.4 0 01-5.5 2.6.2.2 0 00-.1.3 47.2 47.2 0 003.6 5.9.2.2 0 00.3.1 58.5 58.5 0 0017.7-9 .3.3 0 00.1-.2c1.5-15.5-2.5-29-10.5-40.2zM23.7 37c-3.5 0-6.3-3.2-6.3-7s2.8-7 6.3-7 6.4 3.2 6.3 7-2.8 7-6.3 7zm23.2 0c-3.5 0-6.3-3.2-6.3-7s2.8-7 6.3-7 6.4 3.2 6.3 7-2.8 7-6.3 7z"/></svg> Send`;
  }
}
