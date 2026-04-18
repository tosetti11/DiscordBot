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
  // Major US
  { name: 'NFL', value: 'nfl' },
  { name: 'NBA', value: 'nba' },
  { name: 'MLB', value: 'mlb' },
  { name: 'NHL', value: 'nhl' },
  { name: 'WNBA', value: 'wnba' },
  // College
  { name: 'NCAA Football', value: 'ncaa_football' },
  { name: "NCAA Men's Basketball", value: 'ncaa_mbb' },
  { name: "NCAA Women's Basketball", value: 'ncaa_wbb' },
  // Soccer
  { name: 'Soccer - MLS', value: 'mls' },
  { name: 'Soccer - Premier League', value: 'epl' },
  { name: 'Soccer - La Liga', value: 'la_liga' },
  { name: 'Soccer - Serie A', value: 'serie_a' },
  { name: 'Soccer - Bundesliga', value: 'bundesliga' },
  { name: 'Soccer - Ligue 1', value: 'ligue_1' },
  { name: 'Soccer - Champions League', value: 'ucl' },
  { name: 'Soccer - Liga MX', value: 'liga_mx' },
  { name: 'Soccer - Eredivisie', value: 'eredivisie' },
  { name: 'Soccer - Primeira Liga', value: 'primeira_liga' },
  { name: 'Soccer - World Cup', value: 'world_cup' },
  { name: 'Soccer - Europa League', value: 'europa_league' },
  // Combat
  { name: 'UFC / MMA', value: 'ufc' },
  { name: 'Boxing', value: 'boxing' },
  // Tennis
  { name: 'Tennis - ATP', value: 'tennis_atp' },
  { name: 'Tennis - WTA', value: 'tennis_wta' },
  { name: 'Tennis - Grand Slam', value: 'tennis_gs' },
  // Golf
  { name: 'Golf - PGA Tour', value: 'golf_pga' },
  { name: 'Golf - LIV', value: 'golf_liv' },
  { name: 'Golf - DP World Tour', value: 'golf_dp' },
  { name: 'Golf - LPGA', value: 'golf_lpga' },
  { name: 'Golf - PGA Champions', value: 'golf_champions' },
  // International Baseball
  { name: 'Baseball - KBO (Korea)', value: 'kbo' },
  { name: 'Baseball - NPB (Japan)', value: 'npb' },
  { name: 'Baseball - CPBL (Taiwan)', value: 'cpbl' },
  // Motorsport
  { name: 'NASCAR', value: 'nascar' },
  { name: 'F1 Racing', value: 'f1' },
  // Other
  { name: 'Rugby', value: 'rugby' },
  { name: 'Cricket', value: 'cricket' },
  { name: 'Olympics', value: 'olympics' },
  { name: 'CFL', value: 'cfl' },
  { name: 'XFL / UFL', value: 'xfl' },
  { name: 'Aussie Rules (AFL)', value: 'afl' },
  { name: 'Darts', value: 'darts' },
  { name: 'Table Tennis', value: 'table_tennis' },
  { name: 'Esports', value: 'esports' },
  { name: 'Custom / Other', value: 'other' },
];

let currentUser = null;
let guildPerms = {}; // { isAdmin, canWhale, roles } per guild
let guildEmojis = []; // server emojis for current guild

// ── Default datetime-local value: today at 7:00 PM ──
function getDefaultEventTime() {
  const now = new Date();
  now.setHours(19, 0, 0, 0);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}T19:00`;
}

// ── Normalize a raw time string (from OCR) into full "Day Mon DD H:MM AM/PM TZ" format ──
function normalizeEventTime(raw) {
  if (!raw) return raw;
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Already in full format like "Thu Mar 5 7:00 PM EST" — validate the month
  if (days.some(d => raw.startsWith(d + ' '))) {
    // Quick sanity check: is the month reasonable (within ~2 months of now)?
    const parts = raw.match(/^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(.+)$/);
    if (parts) {
      const monthIdx = months.indexOf(parts[1]);
      const now = new Date();
      const curMonth = now.getMonth();
      const diff = Math.abs(monthIdx - curMonth);
      if (diff > 2 && diff < 10) {
        // Month is way off — fix it to current month
        const dayNum = parseInt(parts[2]);
        const corrected = new Date(now.getFullYear(), curMonth, dayNum);
        const correctedDay = days[corrected.getDay()];
        const fixed = `${correctedDay} ${months[curMonth]} ${dayNum} ${parts[3]}`;
        return fixed;
      }
    }
    return raw;
  }

  // Try to parse a time-only string like "7pm", "7:00 PM", "19:00", etc.
  const timeRx = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM)?$/i;
  const m = raw.trim().match(timeRx);
  if (m) {
    let hours = parseInt(m[1], 10);
    const mins = m[2] ? parseInt(m[2], 10) : 0;
    const meridiem = m[3];
    if (meridiem) {
      const isPM = meridiem.toUpperCase() === 'PM';
      if (isPM && hours < 12) hours += 12;
      if (!isPM && hours === 12) hours = 0;
    }
    const dt = new Date();
    dt.setHours(hours, mins, 0, 0);
    return formatDateTimePretty(dt.toISOString().slice(0, 16));
  }

  // Try parsing as a full date string
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    return formatDateTimePretty(parsed.toISOString().slice(0, 16));
  }

  // Can't parse — return as-is
  return raw;
}

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
  const validPages = ['slip', 'stats', 'bets', 'closebets', 'leaderboard', 'following', 'reminders', 'tools', 'install', 'analytics', 'announce', 'scoreboard', 'props', 'game-picks', 'profile', 'ai-picks'];
  const hashPage = window.location.hash.replace('#', '');
  if (hashPage && validPages.includes(hashPage)) {
    switchPage(hashPage);
  }

  // Listen for hash changes (back/forward nav)
  window.addEventListener('hashchange', () => {
    const hp = window.location.hash.replace('#', '');
    if (hp) switchPage(hp);
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
    updateSportSpecificFields();
  });

  // Wager type change (single)
  wagerType.addEventListener('change', () => {
    updateWagerFields(wagerType.value);
  });

  // Sport change (single) — show/hide fight/golf fields
  document.getElementById('sport-select').addEventListener('change', () => {
    updateSportSpecificFields();
  });

  // Over/Under toggles
  document.querySelectorAll('#over-under-row .toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#over-under-row .toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // For homerun bets, hide/show line field based on Yes/No vs Over/Under
      const wager = document.getElementById('wager-type')?.value;
      if (wager === 'homerun') {
        const spreadRow = document.getElementById('spread-line-row');
        if (btn.dataset.value === 'Yes' || btn.dataset.value === 'No') {
          spreadRow.classList.add('hidden');
          document.getElementById('spread-value').value = '';
        } else {
          spreadRow.classList.remove('hidden');
        }
      }
    });
  });

  // Prop type quick-select: fills prop description from template
  document.getElementById('prop-type').addEventListener('change', function() {
    const opt = this.options[this.selectedIndex];
    const template = opt.dataset.template || '';
    const isGameProp = opt.dataset.gameprop === 'true';
    const noLine = opt.dataset.noline === 'true';
    const propDesc = document.getElementById('prop-desc');
    const playerRow = document.getElementById('prop-player-row');
    if (template) {
      propDesc.value = template;
      if (!noLine) {
        propDesc.focus();
        // Select the __ placeholder so user can type the line
        const idx = template.indexOf('__');
        if (idx !== -1) propDesc.setSelectionRange(idx, idx + 2);
      }
    }
    // Hide player name for game props (First to Score, Race to X, etc.)
    if (isGameProp) {
      playerRow.classList.add('hidden');
      document.getElementById('player-name').value = '';
    } else {
      playerRow.classList.remove('hidden');
    }
  });

  // ── MLB Live sub-type toggles ──
  const mlbTypeSelect = document.getElementById('mlb-live-type');
  if (mlbTypeSelect) {
    mlbTypeSelect.addEventListener('change', function() {
      document.getElementById('mlb-next-pitch-fields').classList.add('hidden');
      document.getElementById('mlb-ab-fields').classList.add('hidden');
      document.getElementById('mlb-inning-fields').classList.add('hidden');
      document.getElementById('mlb-pitch-fields').classList.add('hidden');
      const v = this.value;
      if (v === 'next_pitch') document.getElementById('mlb-next-pitch-fields').classList.remove('hidden');
      else if (v === 'at_bat') document.getElementById('mlb-ab-fields').classList.remove('hidden');
      else if (v === 'inning') document.getElementById('mlb-inning-fields').classList.remove('hidden');
      else if (v === 'pitch') document.getElementById('mlb-pitch-fields').classList.remove('hidden');
    });
  }

  // MLB AB market toggles
  const mlbAbMarket = document.getElementById('mlb-ab-market');
  if (mlbAbMarket) {
    mlbAbMarket.addEventListener('change', function() {
      document.getElementById('mlb-ab-pitchcount-row').classList.add('hidden');
      document.getElementById('mlb-ab-outcome-row').classList.add('hidden');
      document.getElementById('mlb-ab-onbase-row').classList.add('hidden');
      const v = this.value;
      if (v === 'pitch_count') document.getElementById('mlb-ab-pitchcount-row').classList.remove('hidden');
      else if (v === 'exact_outcome') document.getElementById('mlb-ab-outcome-row').classList.remove('hidden');
      else if (v === 'on_base') document.getElementById('mlb-ab-onbase-row').classList.remove('hidden');
    });
  }

  // MLB Inning market toggles
  const mlbInnMarket = document.getElementById('mlb-inning-market');
  if (mlbInnMarket) {
    mlbInnMarket.addEventListener('change', function() {
      document.getElementById('mlb-inn-line-row').classList.add('hidden');
      document.getElementById('mlb-inn-hr-row').classList.add('hidden');
      const v = this.value;
      if (v === 'runs' || v === 'hits') document.getElementById('mlb-inn-line-row').classList.remove('hidden');
      else if (v === 'home_run') document.getElementById('mlb-inn-hr-row').classList.remove('hidden');
    });
  }

  // Toggle button wiring for MLB Live direction/yes-no buttons
  document.querySelectorAll('.mlb-ab-dir-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mlb-ab-dir-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  document.querySelectorAll('.mlb-ab-onbase-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mlb-ab-onbase-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  document.querySelectorAll('.mlb-inn-dir-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mlb-inn-dir-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  document.querySelectorAll('.mlb-inn-hr-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mlb-inn-hr-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  document.querySelectorAll('.mlb-pitch-dir-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mlb-pitch-dir-btn').forEach(b => b.classList.remove('active'));
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
  document.getElementById('mlb-live-fields').classList.add('hidden');

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
    // Reset prop type dropdown and show player name row
    document.getElementById('prop-type').value = '';
    document.getElementById('prop-player-row').classList.remove('hidden');
  } else if (category === 'futures') {
    document.getElementById('futures-fields').classList.remove('hidden');
    wagerGroup.classList.add('hidden');
    document.getElementById('wager-type').required = false;
    document.getElementById('over-under-row').classList.add('hidden');
    document.getElementById('spread-line-row').classList.add('hidden');
  } else if (category === 'mlb_live') {
    document.getElementById('mlb-live-fields').classList.remove('hidden');
    wagerGroup.classList.add('hidden');
    document.getElementById('wager-type').required = false;
    document.getElementById('over-under-row').classList.add('hidden');
    document.getElementById('spread-line-row').classList.add('hidden');
    // Auto-set sport to MLB
    document.getElementById('sport-select').value = 'mlb';
  }
}

function updateWagerFields(wager) {
  const spreadRow = document.getElementById('spread-line-row');
  const ouRow = document.getElementById('over-under-row');
  const spreadLabel = document.getElementById('spread-label');
  const periodRow = document.getElementById('period-row');

  if (wager === 'spread') {
    spreadRow.classList.remove('hidden');
    ouRow.classList.add('hidden');
    periodRow.classList.remove('hidden');
    spreadLabel.textContent = 'Spread';
    document.getElementById('spread-value').placeholder = 'e.g. -1.5, +3, -7';
  } else if (wager === 'total') {
    spreadRow.classList.remove('hidden');
    ouRow.classList.remove('hidden');
    periodRow.classList.remove('hidden');
    spreadLabel.textContent = 'Total Line';
    document.getElementById('spread-value').placeholder = 'e.g. 220.5, 48.5';
    // Show only Over/Under buttons
    document.querySelectorAll('#over-under-row .toggle-btn').forEach(btn => {
      btn.classList.toggle('hidden', btn.dataset.value === 'Yes' || btn.dataset.value === 'No');
    });
    document.querySelectorAll('#over-under-row .toggle-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('#over-under-row .toggle-btn[data-value="Over"]').classList.add('active');
  } else if (wager === 'team_total') {
    spreadRow.classList.remove('hidden');
    ouRow.classList.remove('hidden');
    periodRow.classList.remove('hidden');
    spreadLabel.textContent = 'Team Total Line';
    document.getElementById('spread-value').placeholder = 'e.g. 112.5, 3.5, 24.5';
    // Show only Over/Under buttons
    document.querySelectorAll('#over-under-row .toggle-btn').forEach(btn => {
      btn.classList.toggle('hidden', btn.dataset.value === 'Yes' || btn.dataset.value === 'No');
    });
    document.querySelectorAll('#over-under-row .toggle-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('#over-under-row .toggle-btn[data-value="Over"]').classList.add('active');
  } else if (wager === 'moneyline') {
    spreadRow.classList.add('hidden');
    ouRow.classList.add('hidden');
    periodRow.classList.remove('hidden');
  } else if (wager === 'homerun') {
    spreadRow.classList.add('hidden');
    ouRow.classList.remove('hidden');
    periodRow.classList.add('hidden');
    spreadLabel.textContent = 'HR Line';
    document.getElementById('spread-value').placeholder = 'e.g. 0.5, 1.5';
    document.getElementById('spread-value').value = '';
    // Show all 4 buttons for homerun
    document.querySelectorAll('#over-under-row .toggle-btn').forEach(btn => btn.classList.remove('hidden'));
    // Default to Yes (no line needed)
    document.querySelectorAll('#over-under-row .toggle-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('#over-under-row .toggle-btn[data-value="Yes"]').classList.add('active');
  } else if (wager === 'nrfi' || wager === 'yrfi' || wager === 'double_chance' || wager === 'draw_no_bet') {
    spreadRow.classList.add('hidden');
    ouRow.classList.add('hidden');
    periodRow.classList.add('hidden');
  } else {
    spreadRow.classList.add('hidden');
    ouRow.classList.add('hidden');
    periodRow.classList.add('hidden');
  }
}

// ── Sport-specific field visibility (single bet) ──
function updateSportSpecificFields() {
  const sport = document.getElementById('sport-select')?.value || '';
  const category = document.getElementById('bet-category')?.value || '';
  const fightFields = document.getElementById('fight-fields');
  const golfFields = document.getElementById('golf-fields');

  // Fight fields: shown for UFC/Boxing regardless of category
  if (fightFields) {
    fightFields.classList.toggle('hidden', !['ufc', 'boxing'].includes(sport));
  }
  // Golf fields: shown for golf sports + player_prop
  if (golfFields) {
    golfFields.classList.toggle('hidden', !(sport.startsWith('golf') && category === 'player_prop'));
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
            <option value="team_total">🎯 Team Total</option>
            <option value="nrfi">⚾ NRFI (No Run 1st)</option>
            <option value="yrfi">⚾ YRFI (Yes Run 1st)</option>
            <option value="homerun">💣 Home Run</option>
            <option value="double_chance">⚽ Double Chance</option>
            <option value="draw_no_bet">⚽ Draw No Bet</option>
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
            <button type="button" class="toggle-btn leg-ou-btn" data-leg="${i}" data-value="Yes">✅ Yes</button>
            <button type="button" class="toggle-btn leg-ou-btn" data-leg="${i}" data-value="No">❌ No</button>
          </div>
        </div>
      </div>

      <!-- Period selector (for spread/total) -->
      <div class="form-row leg-period-row-${i} hidden">
        <div class="form-group">
          <label>Period</label>
          <select class="leg-period" data-leg="${i}">
            <option value="full_game">Full Game</option>
            <option value="1st_half">1st Half</option>
            <option value="2nd_half">2nd Half</option>
            <option value="1st_quarter">1st Quarter</option>
            <option value="2nd_quarter">2nd Quarter</option>
            <option value="3rd_quarter">3rd Quarter</option>
            <option value="4th_quarter">4th Quarter</option>
            <option value="1st_period">1st Period</option>
            <option value="2nd_period">2nd Period</option>
            <option value="3rd_period">3rd Period</option>
            <option value="1st_set">1st Set</option>
            <option value="first_3">First 3 Innings (F3)</option>
            <option value="first_5">First 5 Innings (F5)</option>
            <option value="1st_inning">1st Inning</option>
            <option value="2nd_inning">2nd Inning</option>
            <option value="3rd_inning">3rd Inning</option>
            <option value="4th_inning">4th Inning</option>
            <option value="5th_inning">5th Inning</option>
          </select>
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
          <div class="form-group full-width">
            <label>Common Props <span class="optional">(or type custom)</span></label>
            <select class="leg-prop-type" data-leg="${i}">
              <option value="" selected>Custom / Type Your Own</option>
              <optgroup label="⚾ Baseball">
                <option value="Strikeouts" data-template="Over __ Strikeouts">Strikeouts (K)</option>
                <option value="Home Runs" data-template="Over __ Home Runs">Home Runs</option>
                <option value="To Hit a Home Run" data-template="To Hit a Home Run" data-noline="true">To Hit a Home Run</option>
                <option value="Total Bases" data-template="Over __ Total Bases">Total Bases</option>
                <option value="Hits+Runs+RBIs" data-template="Over __ Hits+Runs+RBIs">Hits+Runs+RBIs</option>
                <option value="Hits" data-template="Over __ Hits">Hits</option>
                <option value="RBIs" data-template="Over __ RBIs">RBIs</option>
                <option value="Stolen Bases" data-template="Over __ Stolen Bases">Stolen Bases</option>
                <option value="Outs Recorded" data-template="Over __ Outs Recorded">Outs Recorded (Pitcher)</option>
                <option value="Earned Runs" data-template="Under __ Earned Runs">Earned Runs Allowed</option>
                <option value="First Team to Score" data-template="First Team to Score" data-gameprop="true" data-noline="true">First Team to Score</option>
                <option value="Race to Runs" data-template="Race to __ Runs" data-gameprop="true">Race to X Runs</option>
              </optgroup>
              <optgroup label="🏀 Basketball (NBA)">
                <option value="Points" data-template="Over __ Points">Points</option>
                <option value="Rebounds" data-template="Over __ Rebounds">Rebounds</option>
                <option value="Assists" data-template="Over __ Assists">Assists</option>
                <option value="PTS+REB+AST" data-template="Over __ PTS+REB+AST">PTS+REB+AST</option>
                <option value="PTS+REB" data-template="Over __ PTS+REB">PTS+REB</option>
                <option value="PTS+AST" data-template="Over __ PTS+AST">PTS+AST</option>
                <option value="REB+AST" data-template="Over __ REB+AST">REB+AST</option>
                <option value="3-Pointers Made" data-template="Over __ 3-Pointers Made">3-Pointers Made</option>
                <option value="Steals" data-template="Over __ Steals">Steals</option>
                <option value="Blocks" data-template="Over __ Blocks">Blocks</option>
                <option value="Turnovers" data-template="Over __ Turnovers">Turnovers</option>
                <option value="Race to Points" data-template="Race to __ Points" data-gameprop="true">Race to X Points</option>
                <option value="First Team to Score" data-template="First Team to Score" data-gameprop="true" data-noline="true">First Team to Score</option>
              </optgroup>
              <optgroup label="🏒 Hockey">
                <option value="Goals" data-template="Over __ Goals">Goals</option>
                <option value="Anytime Goal Scorer" data-template="Anytime Goal Scorer" data-noline="true">Anytime Goal Scorer</option>
                <option value="First Goal Scorer" data-template="First Goal Scorer" data-noline="true">First Goal Scorer</option>
                <option value="2+ Goals" data-template="2+ Goals" data-noline="true">Multiple Goals (2+)</option>
                <option value="Assists" data-template="Over __ Assists">Assists</option>
                <option value="Points" data-template="Over __ Points">Points (G+A)</option>
                <option value="Shots on Goal" data-template="Over __ Shots on Goal">Shots on Goal</option>
                <option value="Saves" data-template="Over __ Saves">Saves (Goalie)</option>
              </optgroup>
              <optgroup label="⚽ Soccer">
                <option value="Anytime Goal Scorer" data-template="Anytime Goal Scorer" data-noline="true">Anytime Goal Scorer</option>
                <option value="Shots on Target" data-template="Over __ Shots on Target">Shots on Target</option>
                <option value="Goals" data-template="Over __ Goals">Goals</option>
                <option value="Assists" data-template="Over __ Assists">Assists</option>
              </optgroup>
              <optgroup label="🏈 Football">
                <option value="Passing Yards" data-template="Over __ Passing Yards">Passing Yards</option>
                <option value="Rushing Yards" data-template="Over __ Rushing Yards">Rushing Yards</option>
                <option value="Receiving Yards" data-template="Over __ Receiving Yards">Receiving Yards</option>
                <option value="Touchdowns" data-template="Over __ Touchdowns">Touchdowns</option>
                <option value="Anytime TD Scorer" data-template="Anytime TD Scorer" data-noline="true">Anytime TD Scorer</option>
                <option value="Completions" data-template="Over __ Completions">Completions</option>
                <option value="Interceptions" data-template="Over __ Interceptions">Interceptions</option>
                <option value="Receptions" data-template="Over __ Receptions">Receptions</option>
              </optgroup>
            </select>
          </div>
        </div>
        <div class="form-row leg-player-row-${i}">
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
        <div class="form-row">
          <div class="form-group">
            <label>Team A</label>
            <input type="text" class="leg-prop-team-a" data-leg="${i}" placeholder="e.g. Lakers" maxlength="100">
          </div>
          <div class="form-group">
            <label>Team B</label>
            <input type="text" class="leg-prop-team-b" data-leg="${i}" placeholder="e.g. Celtics" maxlength="100">
          </div>
        </div>
      </div>

      <!-- Fight fields (MMA/Boxing) -->
      <div class="leg-fight-fields-${i} hidden">
        <div class="form-row">
          <div class="form-group">
            <label>Round <span class="optional">(opt)</span></label>
            <select class="leg-fight-round" data-leg="${i}">
              <option value="">Any / Full Fight</option>
              ${[1,2,3,4,5,6,7,8,9,10,11,12].map(r => `<option value="${r}">Round ${r}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Method <span class="optional">(opt)</span></label>
            <select class="leg-fight-method" data-leg="${i}">
              <option value="">Any</option>
              <option value="ko_tko">KO/TKO</option>
              <option value="submission">Submission</option>
              <option value="decision">Decision</option>
              <option value="unanimous_decision">Unanimous Decision</option>
              <option value="split_decision">Split Decision</option>
              <option value="dq">Disqualification</option>
              <option value="points">Points</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Golf fields -->
      <div class="leg-golf-fields-${i} hidden">
        <div class="form-row">
          <div class="form-group">
            <label>Round <span class="optional">(opt)</span></label>
            <select class="leg-golf-round" data-leg="${i}">
              <option value="">N/A</option>
              <option value="1">Round 1</option>
              <option value="2">Round 2</option>
              <option value="3">Round 3</option>
              <option value="4">Round 4</option>
            </select>
          </div>
          <div class="form-group">
            <label>Hole # <span class="optional">(opt)</span></label>
            <select class="leg-golf-hole" data-leg="${i}">
              <option value="">N/A</option>
              ${Array.from({length:18},(_,j)=>`<option value="${j+1}">Hole ${j+1}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <!-- Futures fields -->
      <div class="leg-futures-fields-${i} hidden">
        <div class="form-row">
          <div class="form-group">
            <label>Market</label>
            <input type="text" class="leg-futures-market" data-leg="${i}" placeholder="e.g. Masters Outright Winner" maxlength="200">
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
      const sport = card.querySelector('.leg-sport')?.value || '';

      document.querySelector(`.leg-team-fields-${leg}`).classList.toggle('hidden', cat !== 'team_game');
      document.querySelector(`.leg-prop-fields-${leg}`).classList.toggle('hidden', cat !== 'player_prop');
      document.querySelector(`.leg-futures-fields-${leg}`).classList.toggle('hidden', cat !== 'futures');
      document.querySelector(`.leg-wager-row-${leg}`).classList.toggle('hidden', cat !== 'team_game');
      document.querySelector(`.leg-ou-row-${leg}`).classList.add('hidden');
      document.querySelector(`.leg-spread-row-${leg}`).classList.add('hidden');
      document.querySelector(`.leg-period-row-${leg}`).classList.add('hidden');

      // Sport-specific
      document.querySelector(`.leg-fight-fields-${leg}`).classList.toggle('hidden', !['ufc', 'boxing'].includes(sport));
      document.querySelector(`.leg-golf-fields-${leg}`).classList.toggle('hidden', !(sport.startsWith('golf') && cat === 'player_prop'));
    });

    // Wire up sport change for this leg
    card.querySelector('.leg-sport').addEventListener('change', (e) => {
      const leg = e.target.dataset.leg;
      const sport = e.target.value;
      const cat = card.querySelector('.leg-category')?.value || '';

      document.querySelector(`.leg-fight-fields-${leg}`).classList.toggle('hidden', !['ufc', 'boxing'].includes(sport));
      document.querySelector(`.leg-golf-fields-${leg}`).classList.toggle('hidden', !(sport.startsWith('golf') && cat === 'player_prop'));
    });

    // Wire up wager type for this leg
    card.querySelector('.leg-wager-type').addEventListener('change', (e) => {
      const leg = e.target.dataset.leg;
      const wager = e.target.value;

      const spreadRow = document.querySelector(`.leg-spread-row-${leg}`);
      const ouRow = document.querySelector(`.leg-ou-row-${leg}`);
      const spreadLabel = document.querySelector(`.leg-spread-label-${leg}`);
      const periodRow = document.querySelector(`.leg-period-row-${leg}`);

      if (wager === 'spread') {
        spreadRow.classList.remove('hidden');
        ouRow.classList.add('hidden');
        periodRow.classList.remove('hidden');
        spreadLabel.textContent = 'Spread';
      } else if (wager === 'total') {
        spreadRow.classList.remove('hidden');
        ouRow.classList.remove('hidden');
        periodRow.classList.remove('hidden');
        spreadLabel.textContent = 'Total Line';
      } else if (wager === 'team_total') {
        spreadRow.classList.remove('hidden');
        ouRow.classList.remove('hidden');
        periodRow.classList.remove('hidden');
        spreadLabel.textContent = 'Team Total Line';
      } else if (wager === 'moneyline') {
        spreadRow.classList.add('hidden');
        ouRow.classList.add('hidden');
        periodRow.classList.remove('hidden');
      } else if (wager === 'homerun') {
        spreadRow.classList.add('hidden');
        ouRow.classList.remove('hidden');
        periodRow.classList.add('hidden');
        spreadLabel.textContent = 'HR Line';
      } else if (wager === 'nrfi' || wager === 'yrfi' || wager === 'double_chance' || wager === 'draw_no_bet') {
        spreadRow.classList.add('hidden');
        ouRow.classList.add('hidden');
        periodRow.classList.add('hidden');
      } else {
        spreadRow.classList.add('hidden');
        ouRow.classList.add('hidden');
        periodRow.classList.add('hidden');
      }
    });

    // Wire up over/under toggles
    card.querySelectorAll('.leg-ou-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const leg = btn.dataset.leg;
        card.querySelectorAll(`.leg-ou-btn[data-leg="${leg}"]`).forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // For homerun legs, hide/show line field based on Yes/No vs Over/Under
        const wager = card.querySelector(`.leg-wager-type[data-leg="${leg}"]`)?.value;
        if (wager === 'homerun') {
          const spreadRow = document.querySelector(`.leg-spread-row-${leg}`);
          if (btn.dataset.value === 'Yes' || btn.dataset.value === 'No') {
            spreadRow.classList.add('hidden');
          } else {
            spreadRow.classList.remove('hidden');
          }
        }
      });
    });

    // Wire up calendar picker for this leg
    const legCalBtn = card.querySelector(`.btn-calendar[data-leg="${i}"]`);
    const legPicker = card.querySelector(`.leg-event-picker[data-leg="${i}"]`);
    const legTimeInput = card.querySelector(`.leg-event-time[data-leg="${i}"]`);

    legCalBtn.addEventListener('click', () => { if (!legPicker.value) legPicker.value = getDefaultEventTime(); try { legPicker.showPicker(); } catch(e) { legPicker.click(); } });
    legPicker.addEventListener('change', () => {
      legTimeInput.value = formatDateTimePretty(legPicker.value);
      legPicker.value = '';
      legPicker.blur();
    });

    // Wire up prop type quick-select for this leg
    const legPropType = card.querySelector(`.leg-prop-type[data-leg="${i}"]`);
    if (legPropType) {
      legPropType.addEventListener('change', function() {
        const opt = this.options[this.selectedIndex];
        const template = opt.dataset.template || '';
        const isGameProp = opt.dataset.gameprop === 'true';
        const noLine = opt.dataset.noline === 'true';
        const legDesc = card.querySelector(`.leg-prop-desc[data-leg="${i}"]`);
        const playerRow = card.querySelector(`.leg-player-row-${i}`);
        if (template) {
          legDesc.value = template;
          if (!noLine) {
            legDesc.focus();
            const idx = template.indexOf('__');
            if (idx !== -1) legDesc.setSelectionRange(idx, idx + 2);
          }
        }
        if (isGameProp) {
          playerRow.classList.add('hidden');
          card.querySelector(`.leg-player-name[data-leg="${i}"]`).value = '';
        } else {
          playerRow.classList.remove('hidden');
        }
      });
    }
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

          if (wager === 'spread' || wager === 'total' || wager === 'team_total') {
            leg.spreadValue = document.querySelector(`.leg-spread-value[data-leg="${i}"]`)?.value;
            if (!leg.spreadValue) throw new Error(`Leg ${i}: Enter ${wager === 'spread' ? 'spread' : 'total line'}`);
            // Enforce .5 intervals for total lines (over/under)
            if (wager === 'total' || wager === 'team_total') {
              const totalVal = parseFloat(leg.spreadValue);
              if (!isNaN(totalVal) && totalVal % 1 === 0) {
                leg.spreadValue = String(totalVal + 0.5);
              }
            }
            // Period
            leg.period = document.querySelector(`.leg-period[data-leg="${i}"]`)?.value || 'full_game';
          }
          if (wager === 'total' || wager === 'team_total') {
            const activeOU = document.querySelector(`.leg-ou-btn[data-leg="${i}"].active`);
            leg.overUnder = activeOU ? activeOU.dataset.value : 'Over';
          }
          if (wager === 'homerun') {
            const activeOU = document.querySelector(`.leg-ou-btn[data-leg="${i}"].active`);
            leg.overUnder = activeOU ? activeOU.dataset.value : 'Yes';
            leg.spreadValue = document.querySelector(`.leg-spread-value[data-leg="${i}"]`)?.value || null;
          }
          if (wager === 'moneyline' || wager === 'spread') {
            leg.period = document.querySelector(`.leg-period[data-leg="${i}"]`)?.value || 'full_game';
          }
        } else if (category === 'player_prop') {
          leg.wagerType = 'prop';
          leg.playerName = document.querySelector(`.leg-player-name[data-leg="${i}"]`)?.value;
          leg.propDescription = document.querySelector(`.leg-prop-desc[data-leg="${i}"]`)?.value;
          const legPropSel = document.querySelector(`.leg-prop-type[data-leg="${i}"]`);
          const isLegGameProp = legPropSel?.options[legPropSel.selectedIndex]?.dataset?.gameprop === 'true';
          if (!isLegGameProp && !leg.playerName) throw new Error(`Leg ${i}: Enter player name`);
          if (!leg.propDescription) throw new Error(`Leg ${i}: Enter prop description`);
          // Include teams from prop team fields or fallback to team-game fields (populated by OCR)
          const propTeamA = document.querySelector(`.leg-prop-team-a[data-leg="${i}"]`)?.value || document.querySelector(`.leg-team-a[data-leg="${i}"]`)?.value;
          const propTeamB = document.querySelector(`.leg-prop-team-b[data-leg="${i}"]`)?.value || document.querySelector(`.leg-team-b[data-leg="${i}"]`)?.value;
          if (propTeamA) leg.teamA = propTeamA;
          if (propTeamB) leg.teamB = propTeamB;
        } else if (category === 'futures') {
          leg.wagerType = 'futures';
          leg.futuresMarket = document.querySelector(`.leg-futures-market[data-leg="${i}"]`)?.value;
          leg.futuresSelection = document.querySelector(`.leg-futures-selection[data-leg="${i}"]`)?.value;
          if (!leg.futuresMarket || !leg.futuresSelection) throw new Error(`Leg ${i}: Enter market and selection`);
        } else if (category === 'mlb_live') {
          leg.wagerType = 'mlb_live';
          const mlbType = document.querySelector(`.leg-mlb-live-type[data-leg="${i}"]`)?.value;
          if (!mlbType) throw new Error(`Leg ${i}: Select MLB Live bet type`);
          leg.mlbLiveType = mlbType;
          leg.teamA = document.querySelector(`.leg-mlb-team-a[data-leg="${i}"]`)?.value;
          leg.teamB = document.querySelector(`.leg-mlb-team-b[data-leg="${i}"]`)?.value;
          // Build a pick string for the leg based on sub-type
          if (mlbType === 'at_bat') {
            const abNum = document.querySelector(`.leg-mlb-ab-number[data-leg="${i}"]`)?.value;
            const abMkt = document.querySelector(`.leg-mlb-ab-market[data-leg="${i}"]`)?.value;
            leg.mlbLiveType = mlbType;
            leg.abNumber = abNum;
            leg.abMarket = abMkt;
          } else if (mlbType === 'inning') {
            leg.inningNumber = document.querySelector(`.leg-mlb-inning-number[data-leg="${i}"]`)?.value;
            leg.inningMarket = document.querySelector(`.leg-mlb-inning-market[data-leg="${i}"]`)?.value;
          } else if (mlbType === 'pitch') {
            leg.pitcherName = document.querySelector(`.leg-mlb-pitcher[data-leg="${i}"]`)?.value;
            leg.pitchNumber = document.querySelector(`.leg-mlb-pitch-number[data-leg="${i}"]`)?.value;
            leg.pitchMph = document.querySelector(`.leg-mlb-pitch-mph[data-leg="${i}"]`)?.value;
          }
        }

        // Sport-specific extras
        if (['ufc', 'boxing'].includes(sport)) {
          const fr = document.querySelector(`.leg-fight-round[data-leg="${i}"]`)?.value;
          const fm = document.querySelector(`.leg-fight-method[data-leg="${i}"]`)?.value;
          if (fr) leg.fightRound = parseInt(fr);
          if (fm) leg.fightMethod = fm;
        }
        if (sport.startsWith('golf')) {
          const gr = document.querySelector(`.leg-golf-round[data-leg="${i}"]`)?.value;
          const gh = document.querySelector(`.leg-golf-hole[data-leg="${i}"]`)?.value;
          if (gr) leg.golfRound = parseInt(gr);
          if (gh) leg.golfHole = parseInt(gh);
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
        shareLink: document.getElementById('parlay-share-link').value || null,
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
        shareLink: document.getElementById('share-link').value || null,
      };

      if (category === 'team_game') {
        const wager = document.getElementById('wager-type').value;
        body.wagerType = wager;
        body.teamA = document.getElementById('team-a').value;
        body.teamB = document.getElementById('team-b').value;
        if (!body.teamA || !body.teamB) throw new Error('Enter both teams');

        if (wager === 'spread' || wager === 'total' || wager === 'team_total') {
          body.spreadValue = document.getElementById('spread-value').value;
          if (!body.spreadValue) throw new Error(`Enter ${wager === 'spread' ? 'spread' : 'total line'}`);
          // Enforce .5 intervals for total lines (over/under)
          if (wager === 'total' || wager === 'team_total') {
            const totalVal = parseFloat(body.spreadValue);
            if (!isNaN(totalVal) && totalVal % 1 === 0) {
              body.spreadValue = String(totalVal + 0.5);
            }
          }
          // Period
          body.period = document.getElementById('period-select')?.value || 'full_game';
        }
        if (wager === 'total' || wager === 'team_total') {
          const activeOU = document.querySelector('#over-under-row .toggle-btn.active');
          body.overUnder = activeOU ? activeOU.dataset.value : 'Over';
        }
        if (wager === 'homerun') {
          const activeOU = document.querySelector('#over-under-row .toggle-btn.active');
          body.overUnder = activeOU ? activeOU.dataset.value : 'Yes';
          body.spreadValue = document.getElementById('spread-value').value || null;
        }
        if (wager === 'moneyline' || wager === 'spread') {
          body.period = document.getElementById('period-select')?.value || 'full_game';
        }
      } else if (category === 'player_prop') {
        body.wagerType = 'prop';
        body.playerName = document.getElementById('player-name').value;
        body.propDescription = document.getElementById('prop-desc').value;
        const isGameProp = document.getElementById('prop-type')?.options[document.getElementById('prop-type').selectedIndex]?.dataset?.gameprop === 'true';
        if (!isGameProp && !body.playerName) throw new Error('Enter player name');
        if (!body.propDescription) throw new Error('Enter prop description');
        // Include teams from prop team fields or fallback to team-game fields (populated by OCR)
        const propTeamA = document.getElementById('prop-team-a')?.value || document.getElementById('team-a')?.value;
        const propTeamB = document.getElementById('prop-team-b')?.value || document.getElementById('team-b')?.value;
        if (propTeamA) body.teamA = propTeamA;
        if (propTeamB) body.teamB = propTeamB;
      } else if (category === 'futures') {
        body.wagerType = 'futures';
        body.futuresMarket = document.getElementById('futures-market').value;
        body.futuresSelection = document.getElementById('futures-selection').value;
        if (!body.futuresMarket || !body.futuresSelection) throw new Error('Enter market and selection');
      } else if (category === 'mlb_live') {
        body.wagerType = 'mlb_live';
        const mlbType = document.getElementById('mlb-live-type').value;
        if (!mlbType) throw new Error('Select MLB Live bet type');
        body.mlbLiveType = mlbType;
        body.teamA = document.getElementById('mlb-live-team-a').value;
        body.teamB = document.getElementById('mlb-live-team-b').value;

        if (mlbType === 'next_pitch') {
          body.pitcherName = document.getElementById('mlb-pitcher-name').value;
          body.batterName = document.getElementById('mlb-batter-name').value;
          body.nextPitchOutcome = document.getElementById('mlb-next-pitch-outcome').value;
          if (!body.nextPitchOutcome) throw new Error('Select next pitch outcome');
        } else if (mlbType === 'at_bat') {
          body.abNumber = document.getElementById('mlb-ab-number').value;
          body.abMarket = document.getElementById('mlb-ab-market').value;
          body.mlbPlayerName = document.getElementById('mlb-ab-player').value;
          if (!body.abNumber || !body.abMarket) throw new Error('Select AB number and market');
          if (body.abMarket === 'pitch_count') {
            body.abLine = document.getElementById('mlb-ab-line').value;
            const activeDir = document.querySelector('.mlb-ab-dir-btn.active');
            body.abDirection = activeDir ? activeDir.dataset.value : null;
            if (!body.abLine || !body.abDirection) throw new Error('Enter pitch count line and Over/Under');
          } else if (body.abMarket === 'exact_outcome') {
            body.exactOutcome = document.getElementById('mlb-ab-outcome').value;
            if (!body.exactOutcome) throw new Error('Select exact outcome');
          } else if (body.abMarket === 'on_base') {
            const activeOB = document.querySelector('.mlb-ab-onbase-btn.active');
            body.onBase = activeOB ? activeOB.dataset.value : null;
            if (!body.onBase) throw new Error('Select Yes or No for on base');
          }
        } else if (mlbType === 'inning') {
          body.inningNumber = document.getElementById('mlb-inning-number').value;
          body.inningMarket = document.getElementById('mlb-inning-market').value;
          if (!body.inningNumber || !body.inningMarket) throw new Error('Select inning and market');
          if (body.inningMarket === 'runs' || body.inningMarket === 'hits') {
            body.inningLine = document.getElementById('mlb-inn-line').value;
            const activeDir = document.querySelector('.mlb-inn-dir-btn.active');
            body.inningDirection = activeDir ? activeDir.dataset.value : null;
            if (!body.inningLine || !body.inningDirection) throw new Error('Enter line and Over/Under');
          } else if (body.inningMarket === 'home_run') {
            const activeHR = document.querySelector('.mlb-inn-hr-btn.active');
            body.inningHomeRun = activeHR ? activeHR.dataset.value : null;
            if (!body.inningHomeRun) throw new Error('Select Yes or No for HR');
          }
        } else if (mlbType === 'pitch') {
          body.pitcherName = document.getElementById('mlb-pitch-player').value;
          body.pitchNumber = document.getElementById('mlb-pitch-number').value;
          body.pitchMph = document.getElementById('mlb-pitch-mph').value;
          const activeDir = document.querySelector('.mlb-pitch-dir-btn.active');
          body.pitchDirection = activeDir ? activeDir.dataset.value : null;
          if (!body.pitcherName || !body.pitchNumber || !body.pitchMph || !body.pitchDirection) throw new Error('Fill in all pitch fields');
        }
      }

      // Sport-specific extras
      if (['ufc', 'boxing'].includes(sport)) {
        const fr = document.getElementById('fight-round')?.value;
        const fm = document.getElementById('fight-method')?.value;
        if (fr) body.fightRound = parseInt(fr);
        if (fm) body.fightMethod = fm;
      }
      if (sport.startsWith('golf')) {
        const gr = document.getElementById('golf-round')?.value;
        const gh = document.getElementById('golf-hole')?.value;
        if (gr) body.golfRound = parseInt(gr);
        if (gh) body.golfHole = parseInt(gh);
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
            period: leg.period || 'full_game',
            fightRound: leg.fightRound || null,
            fightMethod: leg.fightMethod || null,
            golfRound: leg.golfRound || null,
            golfHole: leg.golfHole || null,
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
        patchBody.period = body.period || 'full_game';
        patchBody.fightRound = body.fightRound || null;
        patchBody.fightMethod = body.fightMethod || null;
        patchBody.golfRound = body.golfRound || null;
        patchBody.golfHole = body.golfHole || null;
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

  // Re-select guild for single-guild users (autoSelectGuild hides it,
  // but form.reset() clears the value — leaving a hidden required empty field)
  autoSelectGuild(document.getElementById('guild-select'));
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

// Map OCR sport values to the closest valid option in the sport-select dropdown
function mapOcrSport(ocrSport) {
  if (!ocrSport) return ocrSport;
  // Check if exact match exists
  const sportEl = document.getElementById('sport-select');
  const options = Array.from(sportEl.options).map(o => o.value);
  if (options.includes(ocrSport)) return ocrSport;
  // Fallback mappings for legacy/generic OCR values
  const fallbacks = {
    tennis: 'tennis_atp',
    golf: 'golf_pga',
    soccer: 'mls',
    football: 'nfl',
    basketball: 'nba',
    baseball: 'mlb',
    hockey: 'nhl',
    mma: 'ufc',
  };
  if (fallbacks[ocrSport]) return fallbacks[ocrSport];
  // Partial match: find first option that starts with the OCR value
  const partial = options.find(o => o.startsWith(ocrSport + '_') || o.startsWith(ocrSport));
  if (partial) return partial;
  return ocrSport;
}

function applySingleData(data) {
  // Sport
  if (data.sport) {
    const sportEl = document.getElementById('sport-select');
    sportEl.value = mapOcrSport(data.sport);
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
  // Also populate prop team fields for player props (game matchup from OCR)
  if (data.betCategory === 'player_prop' && data.teamA) {
    const pTA = document.getElementById('prop-team-a');
    if (pTA) pTA.value = data.teamA;
  }
  if (data.betCategory === 'player_prop' && data.teamB) {
    const pTB = document.getElementById('prop-team-b');
    if (pTB) pTB.value = data.teamB;
  }

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
  if (data.eventStartTime) document.getElementById('event-time').value = normalizeEventTime(data.eventStartTime);

  // Period
  if (data.period && data.period !== 'full_game') {
    const periodEl = document.getElementById('period-select');
    if (periodEl) periodEl.value = data.period;
  }

  // Fight fields
  if (data.fightRound) {
    const frEl = document.getElementById('fight-round');
    if (frEl) frEl.value = data.fightRound;
  }
  if (data.fightMethod) {
    const fmEl = document.getElementById('fight-method');
    if (fmEl) fmEl.value = data.fightMethod;
  }

  // Golf fields
  if (data.golfRound) {
    const grEl = document.getElementById('golf-round');
    if (grEl) grEl.value = data.golfRound;
  }
  if (data.golfHole) {
    const ghEl = document.getElementById('golf-hole');
    if (ghEl) ghEl.value = data.golfHole;
  }

  // MLB Live fields
  if (data.betCategory === 'mlb_live') {
    if (data.mlbLiveType) {
      const typeEl = document.getElementById('mlb-live-type');
      if (typeEl) {
        typeEl.value = data.mlbLiveType;
        typeEl.dispatchEvent(new Event('change'));
      }
    }
    // Teams
    if (data.teamA) { const el = document.getElementById('mlb-live-team-a'); if (el) el.value = data.teamA; }
    if (data.teamB) { const el = document.getElementById('mlb-live-team-b'); if (el) el.value = data.teamB; }

    if (data.mlbLiveType === 'at_bat') {
      if (data.abNumber) { const el = document.getElementById('mlb-ab-number'); if (el) el.value = data.abNumber; }
      if (data.abMarket) {
        const el = document.getElementById('mlb-ab-market');
        if (el) { el.value = data.abMarket; el.dispatchEvent(new Event('change')); }
      }
      if (data.mlbPlayerName) { const el = document.getElementById('mlb-ab-player'); if (el) el.value = data.mlbPlayerName; }
      if (data.abLine) { const el = document.getElementById('mlb-ab-line'); if (el) el.value = data.abLine; }
      if (data.abDirection) {
        document.querySelectorAll('.mlb-ab-dir-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.value === data.abDirection);
        });
      }
      if (data.exactOutcome) { const el = document.getElementById('mlb-ab-outcome'); if (el) el.value = data.exactOutcome; }
      if (data.onBase) {
        document.querySelectorAll('.mlb-ab-onbase-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.value === data.onBase);
        });
      }
    } else if (data.mlbLiveType === 'inning') {
      if (data.inningNumber) { const el = document.getElementById('mlb-inning-number'); if (el) el.value = data.inningNumber; }
      if (data.inningMarket) {
        const el = document.getElementById('mlb-inning-market');
        if (el) { el.value = data.inningMarket; el.dispatchEvent(new Event('change')); }
      }
      if (data.inningLine) { const el = document.getElementById('mlb-inn-line'); if (el) el.value = data.inningLine; }
      if (data.inningDirection) {
        document.querySelectorAll('.mlb-inn-dir-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.value === data.inningDirection);
        });
      }
      if (data.inningHomeRun) {
        document.querySelectorAll('.mlb-inn-hr-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.value === data.inningHomeRun);
        });
      }
    } else if (data.mlbLiveType === 'next_pitch') {
      if (data.pitcherName) { const el = document.getElementById('mlb-pitcher-name'); if (el) el.value = data.pitcherName; }
      if (data.batterName) { const el = document.getElementById('mlb-batter-name'); if (el) el.value = data.batterName; }
      if (data.nextPitchOutcome) { const el = document.getElementById('mlb-next-pitch-outcome'); if (el) el.value = data.nextPitchOutcome; }
    } else if (data.mlbLiveType === 'pitch') {
      if (data.pitcherName) { const el = document.getElementById('mlb-pitch-player'); if (el) el.value = data.pitcherName; }
      if (data.pitchNumber) { const el = document.getElementById('mlb-pitch-number'); if (el) el.value = data.pitchNumber; }
      if (data.pitchMph) { const el = document.getElementById('mlb-pitch-mph'); if (el) el.value = data.pitchMph; }
      if (data.pitchDirection) {
        document.querySelectorAll('.mlb-pitch-dir-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.value === data.pitchDirection);
        });
      }
    }
  }

  // Trigger sport-specific field visibility
  if (data.sport) {
    const sportEl = document.getElementById('sport-select');
    sportEl.dispatchEvent(new Event('change'));
  }
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
      if (sportEl) sportEl.value = mapOcrSport(leg.sport);
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
        } else if (leg.wagerType === 'team_total') {
          spreadRow.classList.remove('hidden');
          ouRow.classList.remove('hidden');
          if (spreadLabel) spreadLabel.textContent = 'Team Total Line';
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
    // Also populate prop team fields for player props (game matchup from OCR)
    if (leg.betCategory === 'player_prop' && leg.teamA) {
      const el = document.querySelector(`.leg-prop-team-a[data-leg="${i}"]`);
      if (el) el.value = leg.teamA;
    }
    if (leg.betCategory === 'player_prop' && leg.teamB) {
      const el = document.querySelector(`.leg-prop-team-b[data-leg="${i}"]`);
      if (el) el.value = leg.teamB;
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
      if (el) el.value = normalizeEventTime(leg.eventStartTime);
    }

    // Period
    if (leg.period && leg.period !== 'full_game') {
      const el = document.querySelector(`.leg-period[data-leg="${i}"]`);
      if (el) el.value = leg.period;
    }

    // Fight fields
    if (leg.fightRound) {
      const el = document.querySelector(`.leg-fight-round[data-leg="${i}"]`);
      if (el) el.value = leg.fightRound;
    }
    if (leg.fightMethod) {
      const el = document.querySelector(`.leg-fight-method[data-leg="${i}"]`);
      if (el) el.value = leg.fightMethod;
    }

    // Golf fields
    if (leg.golfRound) {
      const el = document.querySelector(`.leg-golf-round[data-leg="${i}"]`);
      if (el) el.value = leg.golfRound;
    }
    if (leg.golfHole) {
      const el = document.querySelector(`.leg-golf-hole[data-leg="${i}"]`);
      if (el) el.value = leg.golfHole;
    }

    // Trigger sport-specific field visibility for each leg
    if (leg.sport) {
      const sportEl = document.querySelector(`.leg-sport[data-leg="${i}"]`);
      if (sportEl) sportEl.dispatchEvent(new Event('change'));
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

function toggleModelsMenu() {
  document.getElementById('models-items').classList.toggle('hidden');
  document.getElementById('models-chevron').classList.toggle('expanded');
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
    props: document.getElementById('props-page'),
    'game-picks': document.getElementById('game-picks-page'),
    'golf-admin': document.getElementById('golf-admin-page'),
    scoreboard: document.getElementById('scoreboard-page'),
    profile: document.getElementById('profile-page'),
    'ai-picks': document.getElementById('ai-picks-page'),
    'content-studio': document.getElementById('content-studio-page'),
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
  if (page === 'scoreboard') initScoreboardPage();
  if (page === 'props') initPropsIfNeeded();
  if (page === 'game-picks') initGamePicksPage();
  if (page === 'golf-admin') initGolfAdminPage();
  if (page === 'profile') loadProfilePage();
  if (page === 'ai-picks') initAiPicksPage();
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

    // Start live tracker polling for open bets
    stopLiveTrackers();
    startLiveTrackers();
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

  document.getElementById('stats-period').addEventListener('change', () => {
    const customRow = document.getElementById('custom-date-row');
    if (document.getElementById('stats-period').value === 'custom') {
      customRow.classList.remove('hidden');
      // Don't auto-load; wait for Apply click
    } else {
      customRow.classList.add('hidden');
      loadStats();
    }
  });
  document.getElementById('stats-user').addEventListener('change', loadStats);
  document.getElementById('apply-custom-dates').addEventListener('click', loadStats);

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

    // Custom date range
    if (period === 'custom') {
      const startDate = document.getElementById('stats-start-date').value;
      const endDate = document.getElementById('stats-end-date').value;
      if (!startDate) {
        document.getElementById('stats-loading').classList.add('hidden');
        showToast('Please select a start date');
        return;
      }
      params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
    }

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
    document.getElementById('tail-hl-best-detail').textContent = t.tail_best_bet.odds != null ? `${t.tail_best_bet.pick} (${t.tail_best_bet.odds >= 0 ? '+' : ''}${t.tail_best_bet.odds})` : t.tail_best_bet.pick;
  }
  if (t.tail_worst_bet) {
    document.getElementById('tail-hl-worst').textContent = fmtNet(t.tail_worst_bet.payout);
    document.getElementById('tail-hl-worst').className = 'sp-bw-value negative';
    document.getElementById('tail-hl-worst-detail').textContent = t.tail_worst_bet.odds != null ? `${t.tail_worst_bet.pick} (${t.tail_worst_bet.odds >= 0 ? '+' : ''}${t.tail_worst_bet.odds})` : t.tail_worst_bet.pick;
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
  document.getElementById('cashout-section').classList.add('hidden');

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
    document.getElementById('hl-best-detail').textContent = data.bestBet.odds != null ? `${data.bestBet.pick} (${data.bestBet.odds >= 0 ? '+' : ''}${data.bestBet.odds})` : data.bestBet.pick;
  }
  if (data.worstBet) {
    document.getElementById('hl-worst').textContent = `${fmtNet(data.worstBet.payout)}`;
    document.getElementById('hl-worst').className = 'sp-bw-value negative';
    document.getElementById('hl-worst-detail').textContent = data.worstBet.odds != null ? `${data.worstBet.pick} (${data.worstBet.odds >= 0 ? '+' : ''}${data.worstBet.odds})` : data.worstBet.pick;
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

  // Cashout stats
  const coSec = document.getElementById('cashout-section');
  if (data.cashoutStats) {
    coSec.classList.remove('hidden');
    const cs = data.cashoutStats;
    document.getElementById('co-kpi-count').textContent = cs.count;
    document.getElementById('co-kpi-staked').textContent = `${fmtU(cs.totalStaked)}u`;
    document.getElementById('co-kpi-returned').textContent = `${fmtU(cs.totalCashedOut)}u`;
    const coNetEl = document.getElementById('co-kpi-net');
    coNetEl.textContent = fmtNet(cs.netUnits);
    coNetEl.classList.remove('positive', 'negative');
    if (cs.netUnits > 0) coNetEl.classList.add('positive');
    else if (cs.netUnits < 0) coNetEl.classList.add('negative');

    const coList = document.getElementById('co-bets-list');
    coList.innerHTML = '';
    for (const b of cs.bets) {
      const div = document.createElement('div');
      div.className = 'co-bet-row';
      const netClass = b.net >= 0 ? 'positive' : 'negative';
      div.innerHTML = `
        <div>
          <div class="co-bet-pick">${esc(b.pick)}</div>
          <div class="co-bet-detail">${esc(b.sport || '')} · ${b.units}u staked · ${fmtU(b.cashOutAmount)}u returned · ${esc(b.date)}</div>
        </div>
        <div class="co-bet-net ${netClass}">${fmtNet(b.net)}</div>
      `;
      coList.appendChild(div);
    }
  } else {
    coSec.classList.add('hidden');
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

const STATUS_EMOJI = { open: '🟡', win: '✅', loss: '❌', push: '🔄', void: '⛔', cashout: '💸' };

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

  const statusMap = { open: 'PENDING', win: 'WON', loss: 'LOST', push: 'PUSH', void: 'VOID', cashout: 'CASHED OUT' };
  const statusText = statusMap[bet.status] || 'PENDING';
  const sportName = bet.sportName || SPORT_NAMES[bet.sport] || bet.sport || '';
  const wagerLabel = bet.wagerType ? (bet.wagerType.charAt(0).toUpperCase() + bet.wagerType.slice(1)) : '';
  const date = bet.createdAt ? new Date(bet.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const isParlay = bet.betType === 'parlay';
  let pickText = esc(bet.pick) || (isParlay ? `${bet.legs?.length || 0}-Leg Parlay` : '—');
  const whaleTag = bet.isWhale ? '<span class="ticket-tag tag-whale">🐋 WHALE</span>' : '';

  const oddsDisplay = bet.oddsAmerican ? (bet.oddsAmerican > 0 ? `+${bet.oddsAmerican}` : `${bet.oddsAmerican}`) : '—';
  const tailedUnits = bet.tailed_units != null ? bet.tailed_units : null;
  const unitsDisplay = tailedUnits != null ? tailedUnits : (bet.units || '—');

  let toWin = '—';
  if (unitsDisplay !== '—' && bet.oddsAmerican) {
    const u = Number(unitsDisplay); const o = Number(bet.oddsAmerican);
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
        <span class="ticket-tag" style="background:rgba(100,181,246,0.12);color:#64b5f6;">🔗 Tailing ${esc(bet.displayName) || 'Unknown'}${tailedUnits != null ? ` (${tailedUnits}u)` : ''}</span>
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

    // Start live tracker polling for open bets
    stopLiveTrackers();
    startLiveTrackers();
  } catch (e) {
    container.innerHTML = '<p class="empty-state" style="color:var(--text-danger)">Failed to load bets.</p>';
  }
}

function renderBetCard(bet, showOwner = false) {
  const div = document.createElement('div');
  div.className = `ticket status-${bet.status || 'open'}`;
  div.dataset.betId = bet.id;

  const statusMap = { open: 'PENDING', win: 'WON', loss: 'LOST', push: 'PUSH', void: 'VOID', cashout: 'CASHED OUT' };
  const statusText = statusMap[bet.status] || 'PENDING';
  const sportName = bet.sportName || SPORT_NAMES[bet.sport] || bet.sport || '';
  const wagerLabel = bet.wagerType ? (bet.wagerType.charAt(0).toUpperCase() + bet.wagerType.slice(1)) : '';
  const date = bet.createdAt ? new Date(bet.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const time = bet.createdAt ? new Date(bet.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
  const isParlay = bet.betType === 'parlay';

  // Track matchup keys shown in header to avoid repeating in legs
  const headerMatchupKeys = new Set();
  if (isParlay && bet.legs) {
    bet.legs.forEach(leg => {
      if (leg.teamA && leg.teamB) {
        headerMatchupKeys.add([leg.teamA, leg.teamB].sort().join('|'));
      }
    });
  }

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
  // [SCOREBOARD DISABLED] Button hidden — feature dormant. To re-enable, restore the condition below.
  const scoreboardBtnHtml = '';
  // const scoreboardBtnHtml = (bet.status === 'open' && bet.mirrorChannelId && canManage)
  //   ? `<button class="ticket-btn ticket-btn-scoreboard" id="sb-btn-${bet.id}" onclick="event.stopPropagation();toggleScoreboard('${bet.id}')" title="Live Scoreboard">📡</button>`
  //   : '';

  let actionsHtml = '';
  if (canManage && bet.status === 'open') {
    actionsHtml = `
      <div class="ticket-actions">
        <button class="ticket-btn ticket-btn-win" onclick="event.stopPropagation();closeBet('${bet.id}')">💰 Close</button>
        ${scoreboardBtnHtml}
        <button class="ticket-btn ticket-btn-edit" onclick="event.stopPropagation();openEditModal('${bet.id}')">✏️</button>
        <button class="ticket-btn ticket-btn-del" onclick="event.stopPropagation();confirmDeleteBet('${bet.id}')">🗑️</button>
      </div>`;
  } else if (betsGuildPerms.isAdmin && ['win', 'loss', 'push', 'void', 'cashout'].includes(bet.status)) {
    actionsHtml = `
      <div class="ticket-actions">
        <button class="ticket-btn ticket-btn-reopen" onclick="event.stopPropagation();reopenBet('${bet.id}')">🔓 Reopen</button>
      </div>`;
  } else if (canManage && isParlay && bet.legs?.some(l => l.status === 'open')) {
    actionsHtml = `
      <div class="ticket-actions">
        ${scoreboardBtnHtml}
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
      // Only show per-leg matchup if NOT already in the header
      let legMatchupHtml = '';
      if (leg.teamA && leg.teamB) {
        const legKey = [leg.teamA, leg.teamB].sort().join('|');
        if (!headerMatchupKeys.has(legKey)) {
          legMatchupHtml = `<div class="ticket-leg-matchup">${esc(leg.teamA)} vs ${esc(leg.teamB)}</div>`;
        }
      }
      return `<div class="ticket-leg">
        <div class="ticket-leg-header">
          <span class="ticket-leg-status">${legStatusEmoji}</span>
          <span class="ticket-leg-sport">${legSport}</span>
        </div>
        <div class="ticket-leg-pick">${esc(leg.pick) || '—'}</div>
        ${legMatchupHtml}
        ${leg.playerName ? `<div class="ticket-leg-player">${esc(leg.playerName)}${leg.propDescription ? ' — ' + esc(leg.propDescription) : ''}</div>` : ''}
        ${leg.eventStartTime ? `<div class="ticket-leg-time">⏰ ${esc(leg.eventStartTime)}</div>` : ''}
        <div class="ticket-leg-tracker" id="leg-tracker-${leg.id}"></div>
        ${leg.espnGameId ? `<div class="ticket-espn-id">ESPN: ${esc(leg.espnGameId)}</div>` : ''}
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
    bet.legs.forEach(leg => {
      if (leg.teamA && leg.teamB) {
        const key = [leg.teamA, leg.teamB].sort().join('|');
        if (!headerMatchupKeys.has(key)) {
          headerMatchupKeys.add(key);
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

    ${(bet.espnGameId || bet.legs?.some(l => l.espnGameId)) ? `
    <div class="ticket-divider"></div>
    <div class="ticket-live-tracker" id="tracker-${bet.id}" data-bet-id="${bet.id}" data-has-espn="true">
      <div class="tracker-loading">Loading live data...</div>
    </div>` : ''}

    <div class="ticket-divider"></div>

    <div class="ticket-footer">
      <div class="ticket-footer-left">
        ${slipDisplay ? `<span class="ticket-slip">#${esc(slipDisplay)}</span>` : ''}
        ${bet.espnGameId && !isParlay ? `<span class="ticket-espn-id">ESPN: ${esc(bet.espnGameId)}</span>` : ''}
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

// ─── Live Tracker System ─────────
const liveTrackerIntervals = new Map();

function startLiveTrackers() {
  // Clear any existing trackers
  for (const id of liveTrackerIntervals.values()) clearInterval(id);
  liveTrackerIntervals.clear();

  // Find all tracker elements on the page
  const trackers = document.querySelectorAll('.ticket-live-tracker[data-has-espn="true"]');
  trackers.forEach(el => {
    const betId = el.dataset.betId;
    if (!betId) return;

    // Fetch immediately
    fetchLiveTracker(betId);

    // Then poll every 30s
    const intervalId = setInterval(() => fetchLiveTracker(betId), 30000);
    liveTrackerIntervals.set(betId, intervalId);
  });
}

function stopLiveTrackers() {
  for (const id of liveTrackerIntervals.values()) clearInterval(id);
  liveTrackerIntervals.clear();
}

async function fetchLiveTracker(betId) {
  const el = document.getElementById(`tracker-${betId}`);
  if (!el) return;

  try {
    const res = await fetch(`/api/live-tracker/${betId}`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();

    // Render tracker for single bet
    if (data.bet) {
      renderBetTracker(el, data.bet, false);
    } else if (data.legs && Object.keys(data.legs).length > 0) {
      // Parlay — render per-leg trackers
      for (const [legId, legData] of Object.entries(data.legs)) {
        const legEl = document.getElementById(`leg-tracker-${legId}`);
        if (legEl) renderBetTracker(legEl, legData, true);
      }
      // Clear the main tracker area for parlays (legs have their own)
      el.innerHTML = '';
      el.style.display = 'none';
    } else {
      el.innerHTML = '<div class="tracker-pregame">Waiting for game to start...</div>';
    }

    // Stop polling if all games are final
    const allFinal = checkAllFinal(data);
    if (allFinal) {
      const intervalId = liveTrackerIntervals.get(betId);
      if (intervalId) {
        clearInterval(intervalId);
        liveTrackerIntervals.delete(betId);
      }
    }
  } catch (e) {
    // Silently fail — don't break the ticket
    el.innerHTML = '';
  }
}

function checkAllFinal(data) {
  if (data.bet && data.bet.state !== 'post') return false;
  if (data.legs) {
    for (const leg of Object.values(data.legs)) {
      if (leg.state !== 'post') return false;
    }
  }
  return true;
}

function renderBetTracker(el, gameData, isLeg) {
  if (!gameData) { el.innerHTML = ''; return; }

  const { state, home, away, detail, clock, period, linescores, propTracker } = gameData;

  if (state === 'pre') {
    el.innerHTML = '<div class="tracker-pregame">Waiting for game to start...</div>';
    return;
  }

  const isLive = state === 'in';
  const isFinal = state === 'post';

  // Status indicator
  const statusHtml = isLive
    ? `<span class="tracker-status tracker-live">🔴 LIVE${detail ? ' — ' + esc(detail) : ''}</span>`
    : `<span class="tracker-status tracker-final">🏁 FINAL</span>`;

  // Score line
  const scoreHtml = `<div class="tracker-score">${esc(away.abbreviation)} ${away.score} — ${esc(home.abbreviation)} ${home.score}</div>`;

  // Period scores (linescore)
  let linescoreHtml = '';
  const homeLS = linescores?.home || [];
  const awayLS = linescores?.away || [];
  if (homeLS.length > 0) {
    const headers = homeLS.map((_, i) => `<th>${i + 1}</th>`).join('');
    const awayScores = awayLS.map(s => `<td>${s.displayValue || s.value || 0}</td>`).join('');
    const homeScores = homeLS.map(s => `<td>${s.displayValue || s.value || 0}</td>`).join('');
    linescoreHtml = `
      <table class="tracker-linescore">
        <thead><tr><th></th>${headers}<th>T</th></tr></thead>
        <tbody>
          <tr><td class="tracker-team-cell">${esc(away.abbreviation)}</td>${awayScores}<td class="tracker-total-cell">${away.score}</td></tr>
          <tr><td class="tracker-team-cell">${esc(home.abbreviation)}</td>${homeScores}<td class="tracker-total-cell">${home.score}</td></tr>
        </tbody>
      </table>`;
  }

  // Prop tracker
  let propHtml = '';
  if (propTracker) {
    const pct = propTracker.line > 0 ? Math.round((propTracker.current / propTracker.line) * 100) : 0;
    const onPace = propTracker.direction === 'over'
      ? propTracker.current > propTracker.line
      : propTracker.current < propTracker.line;
    const paceClass = onPace ? 'tracker-pace-hit' : 'tracker-pace-miss';
    propHtml = `
      <div class="tracker-prop">
        <span class="tracker-prop-name">${esc(propTracker.playerName)}</span>
        <span class="tracker-prop-stat">${propTracker.current} ${esc(propTracker.stat)}</span>
        <span class="tracker-prop-line ${paceClass}">${propTracker.direction === 'over' ? 'O' : 'U'} ${propTracker.line}</span>
        <div class="tracker-prop-bar"><div class="tracker-prop-fill ${paceClass}" style="width:${Math.min(pct, 100)}%"></div></div>
      </div>`;
  }

  const compact = isLeg ? ' tracker-compact' : '';
  el.innerHTML = `
    <div class="tracker-content${compact}">
      ${statusHtml}
      ${scoreHtml}
      ${linescoreHtml}
      ${propHtml}
    </div>`;
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
  document.getElementById('cashout-input-wrap').classList.add('hidden');
  document.getElementById('cashout-amount').value = '';
  clearGifPreview();
  document.getElementById('close-bet-modal').classList.remove('hidden');
}

function selectCloseOutcome(outcome) {
  closeBetPendingOutcome = outcome;
  document.querySelectorAll('.close-outcome-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.outcome === outcome);
  });
  // Show/hide cashout payout input
  const cashWrap = document.getElementById('cashout-input-wrap');
  if (outcome === 'cashout') {
    cashWrap.classList.remove('hidden');
    document.getElementById('cashout-amount').value = '';
    document.getElementById('cashout-unit-preview').style.display = 'none';
    document.getElementById('cashout-amount').focus();
  } else {
    cashWrap.classList.add('hidden');
  }
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

function updateCashoutPreview() {
  const preview = document.getElementById('cashout-unit-preview');
  const dollars = parseFloat(document.getElementById('cashout-amount').value);
  const unitSize = getUnitSize();
  if (!dollars || dollars <= 0 || !unitSize || unitSize <= 0) {
    preview.style.display = 'none';
    return;
  }
  const units = (dollars / unitSize).toFixed(2);
  preview.style.display = 'block';
  preview.textContent = `= ${parseFloat(units)}u (at $${unitSize}/unit)`;
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

  // Validate cashout amount (user enters dollars, convert to units)
  let cashOutAmount;
  if (closeBetPendingOutcome === 'cashout') {
    const dollarAmount = parseFloat(document.getElementById('cashout-amount').value);
    if (!dollarAmount || dollarAmount < 0) {
      showToast('Enter a valid dollar amount');
      return;
    }
    const unitSize = getUnitSize();
    if (!unitSize || unitSize <= 0) {
      showToast('Set your unit size first (top of bet slip page)');
      return;
    }
    cashOutAmount = parseFloat((dollarAmount / unitSize).toFixed(2));
  }

  const message = document.getElementById('close-bet-message').value.trim();
  const btn = document.getElementById('close-bet-confirm-btn');
  btn.disabled = true;
  btn.textContent = 'Closing...';

  try {
    const body = { status: closeBetPendingOutcome, communityMessage: message || undefined, gifUrl: closeBetGifUrl || undefined };
    if (cashOutAmount !== undefined) body.cashOutAmount = cashOutAmount;
    const res = await fetch(`/api/bets/${closeBetPendingId}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.error) {
      showToast('Error: ' + data.error);
      return;
    }
    showToast('Bet closed');
    closeCloseBetModal();
    // Refresh bets page if on bets tab
    loadBets();
    if (closeBetsInitialized) {
      // Use closeBetsPerms for rendering close bets page
      betsGuildPerms = closeBetsPerms;
      await loadCloseBets();
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

              // Set Over/Under toggle for parlay leg
              if (leg.overUnder && (leg.wagerType === 'total' || leg.wagerType === 'team_total')) {
                document.querySelectorAll(`.leg-ou-btn[data-leg="${idx}"]`).forEach(btn => {
                  btn.classList.toggle('active', btn.dataset.value === leg.overUnder);
                });
              }
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

          // Period per leg
          if (leg.period && leg.period !== 'full_game') {
            const el = document.querySelector(`.leg-period[data-leg="${idx}"]`);
            if (el) el.value = leg.period;
          }

          // Fight fields per leg
          if (leg.fightRound) {
            const el = document.querySelector(`.leg-fight-round[data-leg="${idx}"]`);
            if (el) el.value = leg.fightRound;
          }
          if (leg.fightMethod) {
            const el = document.querySelector(`.leg-fight-method[data-leg="${idx}"]`);
            if (el) el.value = leg.fightMethod;
          }

          // Golf fields per leg
          if (leg.golfRound) {
            const el = document.querySelector(`.leg-golf-round[data-leg="${idx}"]`);
            if (el) el.value = leg.golfRound;
          }
          if (leg.golfHole) {
            const el = document.querySelector(`.leg-golf-hole[data-leg="${idx}"]`);
            if (el) el.value = leg.golfHole;
          }

          // Trigger sport-specific field visibility
          if (sportEl) sportEl.dispatchEvent(new Event('change'));
        });
      }, 100);

      // Set sport from first leg
      const sportSel = document.getElementById('sport-select');
      if (bet.legs?.[0]?.sport) sportSel.value = bet.legs[0].sport;

      // Parlay totals
      document.getElementById('parlay-odds').value = bet.oddsAmerican || '';
      document.getElementById('parlay-units').value = bet.units || '';
      document.getElementById('parlay-note').value = bet.betNote || '';
      document.getElementById('parlay-share-link').value = bet.shareLink || '';

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
        } else if (bet.wagerType === 'total' || bet.wagerType === 'team_total') {
          document.getElementById('spread-line-row').classList.remove('hidden');
          document.getElementById('over-under-row').classList.remove('hidden');
          document.getElementById('spread-value').value = bet.spreadValue || '';
          document.getElementById('spread-label').textContent = bet.wagerType === 'team_total' ? 'Team Total Line' : 'Total Line';
          // Set Over/Under toggle
          if (bet.overUnder) {
            document.querySelectorAll('#over-under-row .toggle-btn').forEach(btn => {
              btn.classList.toggle('active', btn.dataset.value === bet.overUnder);
            });
          }
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
      document.getElementById('share-link').value = bet.shareLink || '';

      // Period
      if (bet.period && bet.period !== 'full_game') {
        const periodEl = document.getElementById('period-select');
        if (periodEl) periodEl.value = bet.period;
      }

      // Fight fields
      if (bet.fightRound) {
        const frEl = document.getElementById('fight-round');
        if (frEl) frEl.value = bet.fightRound;
      }
      if (bet.fightMethod) {
        const fmEl = document.getElementById('fight-method');
        if (fmEl) fmEl.value = bet.fightMethod;
      }

      // Golf fields
      if (bet.golfRound) {
        const grEl = document.getElementById('golf-round');
        if (grEl) grEl.value = bet.golfRound;
      }
      if (bet.golfHole) {
        const ghEl = document.getElementById('golf-hole');
        if (ghEl) ghEl.value = bet.golfHole;
      }

      // Trigger sport-specific field visibility
      const sportEl = document.getElementById('sport-select');
      if (sportEl) sportEl.dispatchEvent(new Event('change'));
      // Also trigger wager type to show period row
      const wagerSel2 = document.getElementById('wager-type');
      if (wagerSel2) wagerSel2.dispatchEvent(new Event('change'));
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
  const typeSelect = document.getElementById('reminder-type');
  const repeatSelect = document.getElementById('reminder-repeat');
  const charCount = document.getElementById('reminder-char-count');

  msgInput.addEventListener('input', () => {
    charCount.textContent = msgInput.value.length;
    updateReminderPreview();
  });
  // Link inputs use event delegation
  document.getElementById('reminder-links-container').addEventListener('input', () => updateReminderPreview());
  typeSelect.addEventListener('change', () => updateReminderPreview());
  repeatSelect.addEventListener('change', () => updateReminderPreview());

  document.getElementById('reminder-preview-timestamp').textContent = new Date().toLocaleString();
}

function updateReminderPreview() {
  const msg = document.getElementById('reminder-message').value || 'Your reminder will appear here...';
  const links = getReminderLinks();
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

  // Update links
  const linkField = document.getElementById('reminder-preview-link-field');
  const linkList = document.getElementById('reminder-preview-link-list');
  if (links.length) {
    linkField.classList.remove('hidden');
    linkList.innerHTML = links.map(l => `<a href="${esc(l)}" target="_blank" rel="noopener">${esc(l)}</a>`).join('<br>');
  } else {
    linkField.classList.add('hidden');
    linkList.innerHTML = '';
  }

  // Update meta (time + repeat)
  const metaEl = document.getElementById('reminder-preview-meta');
  let metaHtml = '';
  if (timeInput.value) {
    metaHtml += `<span>📅 ${esc(timeInput.value)}</span>`;
  }
  const selectedChIds = getSelectedChannelIds('reminder-channel-picker');
  if (selectedChIds.length) {
    const names = selectedChIds.map(id => {
      const ch = reminderChannelsList.find(c => c.id === id);
      return ch ? '#' + ch.name : '#' + id;
    });
    metaHtml += `<span>${names.map(n => esc(n)).join(', ')}</span>`;
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

// ─── Channel Picker Helpers ─────────
let reminderChannelsList = [];

function populateChannelPicker(dropdownId, channels, selectedIds) {
  const dropdown = document.getElementById(dropdownId);
  dropdown.innerHTML = '';
  channels.forEach(ch => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = ch.id;
    cb.checked = selectedIds.includes(ch.id);
    cb.addEventListener('change', () => {
      const pickerId = dropdown.closest('.channel-picker').id;
      updateChannelPickerLabel(pickerId);
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' #' + ch.name));
    dropdown.appendChild(label);
  });
}

function getSelectedChannelIds(pickerId) {
  const picker = document.getElementById(pickerId);
  const boxes = picker.querySelectorAll('input[type="checkbox"]:checked');
  return Array.from(boxes).map(cb => cb.value);
}

function updateChannelPickerLabel(pickerId) {
  const picker = document.getElementById(pickerId);
  const label = picker.querySelector('.channel-picker-label');
  const ids = getSelectedChannelIds(pickerId);
  if (ids.length === 0) {
    label.textContent = 'Select channels...';
  } else {
    const names = ids.map(id => {
      const ch = reminderChannelsList.find(c => c.id === id);
      return ch ? '#' + ch.name : '#' + id;
    });
    label.textContent = names.join(', ');
  }
}

function toggleChannelPicker(pickerId) {
  const picker = document.getElementById(pickerId);
  const dropdown = picker.querySelector('.channel-picker-dropdown');
  dropdown.classList.toggle('hidden');
}

// Close picker when clicking outside
document.addEventListener('click', (e) => {
  document.querySelectorAll('.channel-picker').forEach(picker => {
    if (!picker.contains(e.target)) {
      const dd = picker.querySelector('.channel-picker-dropdown');
      if (dd) dd.classList.add('hidden');
    }
  });
});

async function loadReminderChannels() {
  const guildId = document.getElementById('reminder-guild').value;
  if (!guildId) return;

  try {
    const res = await fetch(`/api/guilds/${guildId}/channels`);
    const channels = await res.json();
    reminderChannelsList = channels;
    populateChannelPicker('reminder-channel-dropdown', channels, []);
    updateChannelPickerLabel('reminder-channel-picker');
  } catch (e) {
    reminderChannelsList = [];
  }

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

      const channelDisplay = (rem.channelNames || [rem.channelName || rem.channelId || '—']).map(n => '#' + esc(n)).join(', ');
      const linksHtml = (rem.links || []).length
        ? `<div class="reminder-links">${rem.links.map(l => `<a href="${esc(l)}" target="_blank" rel="noopener">🔗 ${esc(l)}</a>`).join(' ')}</div>`
        : '';

      card.innerHTML = `
        <span class="reminder-icon">${typeInfo.emoji}</span>
        <div class="reminder-info">
          <div class="reminder-type-label">${esc(typeInfo.label)}</div>
          <div class="reminder-msg">${esc(rem.message) || ''}</div>
          ${linksHtml}
          <div class="reminder-meta">
            <span>📅 ${esc(timeStr)}</span>
            <span>${channelDisplay}</span>
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

// ─── Multi-link helpers ─────────
function getReminderLinks() {
  const inputs = document.querySelectorAll('#reminder-links-container .reminder-link-input');
  return Array.from(inputs).map(i => i.value.trim()).filter(Boolean);
}
function getEditReminderLinks() {
  const inputs = document.querySelectorAll('#edit-reminder-links-container .edit-reminder-link-input');
  return Array.from(inputs).map(i => i.value.trim()).filter(Boolean);
}
function addReminderLinkRow() {
  const container = document.getElementById('reminder-links-container');
  const row = document.createElement('div');
  row.className = 'link-row';
  row.innerHTML = `<input type="text" class="form-input reminder-link-input" placeholder="https://...">
    <button type="button" class="btn btn-sm btn-secondary" onclick="addReminderLinkRow()">+</button>
    <button type="button" class="btn btn-sm btn-danger" onclick="this.parentElement.remove(); updateReminderPreview();">&times;</button>`;
  container.appendChild(row);
}
function addEditReminderLinkRow() {
  const container = document.getElementById('edit-reminder-links-container');
  const row = document.createElement('div');
  row.className = 'link-row';
  row.innerHTML = `<input type="text" class="form-input edit-reminder-link-input" placeholder="https://...">
    <button type="button" class="btn btn-sm btn-secondary" onclick="addEditReminderLinkRow()">+</button>
    <button type="button" class="btn btn-sm btn-danger" onclick="this.parentElement.remove()">&times;</button>`;
  container.appendChild(row);
}
function resetReminderLinks() {
  const container = document.getElementById('reminder-links-container');
  container.innerHTML = `<div class="link-row">
    <input type="text" class="form-input reminder-link-input" placeholder="https://thegamblingkingapp.com">
    <button type="button" class="btn btn-sm btn-secondary" onclick="addReminderLinkRow()">+</button>
  </div>`;
}

async function submitReminder(e) {
  if (e && e.preventDefault) e.preventDefault();

  const guildId = document.getElementById('reminder-guild').value;
  const channelIds = getSelectedChannelIds('reminder-channel-picker');
  const type = document.getElementById('reminder-type').value;
  const message = document.getElementById('reminder-message').value.trim();
  const repeat = document.getElementById('reminder-repeat').value;
  const links = getReminderLinks();
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

  if (!guildId || !channelIds.length || !type || !message) {
    statusDiv.className = 'announce-status announce-error';
    statusDiv.textContent = 'Please fill all required fields (including at least one channel).';
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
      body: JSON.stringify({ type, message, scheduledAt, channelIds, repeat, links })
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
    resetReminderLinks();
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

  // Populate channel picker checkboxes
  const savedChIds = rem.channelIds || (rem.channelId ? [rem.channelId] : []);
  populateChannelPicker('edit-reminder-channel-dropdown', reminderChannelsList, savedChIds);
  updateChannelPickerLabel('edit-reminder-channel-picker');

  // Populate links
  const linksContainer = document.getElementById('edit-reminder-links-container');
  const savedLinks = rem.links || [];
  linksContainer.innerHTML = '';
  if (savedLinks.length === 0) savedLinks.push('');
  savedLinks.forEach(l => {
    const row = document.createElement('div');
    row.className = 'link-row';
    row.innerHTML = `<input type="text" class="form-input edit-reminder-link-input" placeholder="https://..." value="${esc(l)}">
      <button type="button" class="btn btn-sm btn-secondary" onclick="addEditReminderLinkRow()">+</button>
      <button type="button" class="btn btn-sm btn-danger" onclick="this.parentElement.remove()">&times;</button>`;
    linksContainer.appendChild(row);
  });

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
  const channelIds = getSelectedChannelIds('edit-reminder-channel-picker');
  const repeat = document.getElementById('edit-reminder-repeat').value;
  const links = getEditReminderLinks();

  const timeInput = document.getElementById('edit-reminder-time');
  let scheduledAt = null;
  if (timeInput.dataset.isoValue) {
    scheduledAt = new Date(timeInput.dataset.isoValue).toISOString();
  }

  const body = {};
  if (type) body.type = type;
  if (message) body.message = message;
  if (channelIds.length) body.channelIds = channelIds;
  if (scheduledAt) body.scheduledAt = scheduledAt;
  if (repeat) body.repeat = repeat;
  body.links = links;

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
//  NBA PLAYER PROPS ANALYZER (Tools Page)
// ═══════════════════════════════════════════════

let propsGames = [];
let propsSelectedGame = null;
let propsSelectedPlayer = null;
let propsInitialized = false;

// Called when Tools page becomes visible
function initPropsIfNeeded() {
  if (propsInitialized) return;
  propsInitialized = true;
  propsLoadGames();
  propsLoadAccuracy();
}

let gamePicksPageInitialized = false;
function initGamePicksPage() {
  if (gamePicksPageInitialized) return;
  gamePicksPageInitialized = true;
  gpLoadDailyHistory();
}

async function propsLoadGames() {
  const list = document.getElementById('props-games-list');
  const noGames = document.getElementById('props-no-games');
  if (!list) return;

  list.innerHTML = '<div class="props-loading">Loading today\'s games...</div>';
  noGames.classList.add('hidden');

  try {
    const res = await fetch('/api/props/games', {
      headers: { 'Content-Type': 'application/json' }
    });
    const games = await res.json();
    propsGames = games;

    if (!games.length) {
      list.innerHTML = '';
      noGames.classList.remove('hidden');
      return;
    }

    list.innerHTML = games.map((g, i) => {
      const time = new Date(g.startTime);
      const isLive = g.state === 'in';
      const isPre = g.state === 'pre';
      const timeStr = isLive ? '🔴 LIVE' : isPre
        ? time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : 'Final';
      const oddsStr = g.odds ? `O/U ${g.odds.overUnder || '—'} | ${g.odds.spread || ''}` : '';
      return `
        <div class="props-game-card" onclick="propsSelectGame(${i})" data-idx="${i}">
          <div class="matchup">${g.away.abbreviation} @ ${g.home.abbreviation}</div>
          <div class="game-time ${isLive ? 'live' : ''}">${timeStr}</div>
          ${oddsStr ? `<div class="game-odds">${oddsStr}</div>` : ''}
        </div>
      `;
    }).join('');
  } catch (err) {
    list.innerHTML = '<div class="props-empty">Failed to load games. Try again.</div>';
  }
}

async function propsSelectGame(idx) {
  const game = propsGames[idx];
  if (!game) return;
  propsSelectedGame = game;

  // Highlight selected
  document.querySelectorAll('.props-game-card').forEach(c => c.classList.remove('active'));
  document.querySelector(`.props-game-card[data-idx="${idx}"]`)?.classList.add('active');

  // Show step 2
  document.getElementById('props-step-player').classList.remove('hidden');
  document.getElementById('props-step-results').classList.add('hidden');

  // Game banner
  document.getElementById('props-game-banner').textContent = `${game.away.name} @ ${game.home.name}`;

  // Load rosters
  document.getElementById('props-away-team-name').textContent = game.away.name;
  document.getElementById('props-home-team-name').textContent = game.home.name;
  document.getElementById('props-away-roster').innerHTML = '<div class="props-loading">Loading...</div>';
  document.getElementById('props-home-roster').innerHTML = '<div class="props-loading">Loading...</div>';

  const [awayRoster, homeRoster] = await Promise.all([
    fetch(`/api/props/roster/${game.away.id}`).then(r => r.json()).catch(() => []),
    fetch(`/api/props/roster/${game.home.id}`).then(r => r.json()).catch(() => []),
  ]);

  document.getElementById('props-away-roster').innerHTML = propsRenderRoster(awayRoster, game.home.id);
  document.getElementById('props-home-roster').innerHTML = propsRenderRoster(homeRoster, game.away.id);

  // Scroll to step 2
  document.getElementById('props-step-player').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function propsRenderRoster(players, opponentId) {
  if (!players.length) return '<div class="props-empty">No roster data</div>';
  return players.map(p => {
    const img = p.headshot || '';
    return `
      <button class="props-player-btn" onclick="propsSelectPlayer('${p.id}', '${opponentId}', '${p.name.replace(/'/g, "\\'")}', '${img}', '${p.position}')">
        ${img ? `<img src="${img}" alt="" loading="lazy">` : '<span style="width:28px;height:28px;border-radius:50%;background:var(--bg-card);display:inline-block"></span>'}
        <span>${p.name}</span>
        <span class="props-player-pos">${p.position}</span>
      </button>
    `;
  }).join('');
}

async function propsSelectPlayer(playerId, opponentId, name, headshot, position) {
  propsSelectedPlayer = { id: playerId, opponentId, name, headshot, position };

  // Determine player's team ID (opposite of opponent)
  const playerTeamId = propsSelectedGame.home.id === opponentId ? propsSelectedGame.away.id : propsSelectedGame.home.id;
  const homeAway = propsSelectedGame.home.id === opponentId ? 'away' : 'home';

  // Show step 3
  document.getElementById('props-step-results').classList.remove('hidden');

  // Player banner
  document.getElementById('props-player-banner').innerHTML = `
    ${headshot ? `<img src="${headshot}" alt="">` : ''}
    <div class="player-info">
      <div class="player-name">${name}</div>
      <div class="player-meta">${position} · vs ${propsSelectedGame.away.id === opponentId ? propsSelectedGame.away.name : propsSelectedGame.home.name}</div>
    </div>
  `;

  // Analyze — pass game context for matchup analysis
  const grid = document.getElementById('props-analysis-cards');
  grid.innerHTML = '<div class="props-loading">Analyzing player stats...</div>';
  document.getElementById('props-game-log').classList.add('hidden');

  try {
    const qs = new URLSearchParams({
      opponentId,
      playerName: name,
      playerTeamId,
      homeAway,
    });
    if (propsSelectedGame.odds?.overUnder) qs.set('overUnder', propsSelectedGame.odds.overUnder);
    if (propsSelectedGame.odds?.spread) qs.set('spread', propsSelectedGame.odds.spread);

    const res = await fetch(`/api/props/analyze/${playerId}?${qs.toString()}`);
    const data = await res.json();

    if (data.error) {
      grid.innerHTML = `<div class="props-empty">${data.error}</div>`;
      return;
    }

    // Render analysis cards
    const analyses = data.analyses || {};
    const keys = Object.keys(analyses);
    if (!keys.length) {
      grid.innerHTML = '<div class="props-empty">Not enough data to analyze this player.</div>';
      return;
    }

    // Render matchup context banner (if available)
    let matchupBanner = '';
    if (data.matchupContext) {
      const mc = data.matchupContext;
      const tags = [];
      // Pace
      const paceIcon = mc.paceLabel === 'fast' ? '🏃' : mc.paceLabel === 'slow' ? '🐢' : '⚖️';
      tags.push(`<span class="props-matchup-tag ${mc.paceLabel}">${paceIcon} Pace: ${mc.gamePace}</span>`);
      // Defense
      const defIcon = mc.defLabel === 'weak defense' ? '🎯' : mc.defLabel === 'strong defense' ? '🛡️' : '⚖️';
      tags.push(`<span class="props-matchup-tag ${mc.defLabel === 'weak defense' ? 'fast' : mc.defLabel === 'strong defense' ? 'slow' : ''}">${defIcon} ${mc.oppPtsAllowed} PPG Allowed</span>`);
      // Implied total
      if (mc.impliedTotal) {
        tags.push(`<span class="props-matchup-tag">📊 Implied: ${mc.impliedTotal}</span>`);
      }
      // B2B
      if (mc.isB2B) {
        tags.push(`<span class="props-matchup-tag slow">⚠️ Back-to-Back</span>`);
      }
      matchupBanner = `<div class="props-matchup-banner">${tags.join('')}</div>`;
    }

    grid.innerHTML = matchupBanner + keys.map(key => propsRenderAnalysisCard(analyses[key])).join('');

    // Render game log
    propsRenderGameLog(data.gameLog || []);

    // Scroll to results
    document.getElementById('props-step-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    grid.innerHTML = '<div class="props-empty">Failed to analyze player. Try again.</div>';
  }
}

function propsRenderAnalysisCard(a) {
  const recClass = a.recommendation.toLowerCase().replace(' ', '-');
  const hitColor = a.hitRateSeason >= 60 ? '#22c55e' : a.hitRateSeason >= 45 ? '#f59e0b' : '#ef4444';
  const trendIcon = a.trending === 'up' ? '📈' : a.trending === 'down' ? '📉' : '➡️';
  const vsOppRow = a.vsOpponent
    ? `<div class="props-stat-row"><span class="label">vs Opponent (${a.vsOpponent.games}g)</span><span class="value">${a.vsOpponent.avg} avg · ${a.vsOpponent.hitRate}% over</span></div>`
    : '';

  // Line source badge (same style as top picks)
  const lineSource = a.lineSource && a.lineSource !== 'generated' ? a.lineSource : '';
  const bookBadge = lineSource ? `<span class="props-book-badge">${lineSource}</span>` : '<span class="props-book-badge est">estimated</span>';
  const oddsRow = a.bookOdds ? `<div class="props-stat-row"><span class="label">Book Odds</span><span class="value">O ${a.bookOdds.over > 0 ? '+' : ''}${a.bookOdds.over} / U ${a.bookOdds.under > 0 ? '+' : ''}${a.bookOdds.under}</span></div>` : '';

  // Matchup context rows
  let matchupRows = '';
  if (a.matchup) {
    const m = a.matchup;
    // Projected value
    matchupRows += `<div class="props-stat-row"><span class="label">Projected Value</span><span class="value ${a.projectedValue > a.propLine ? 'green' : a.projectedValue < a.propLine ? 'red' : ''}">${a.projectedValue}</span></div>`;
    // Pace
    const paceColor = m.paceLabel === 'fast' ? 'green' : m.paceLabel === 'slow' ? 'red' : '';
    matchupRows += `<div class="props-stat-row"><span class="label">Game Pace</span><span class="value ${paceColor}">${m.gamePace} (${m.paceLabel})</span></div>`;
    // Defense
    const defColor = m.defLabel === 'weak defense' ? 'green' : m.defLabel === 'strong defense' ? 'red' : '';
    matchupRows += `<div class="props-stat-row"><span class="label">Opp Defense</span><span class="value ${defColor}">${m.oppPtsAllowed} PPG allowed (${m.defLabel})</span></div>`;
    // Implied total
    if (m.impliedTotal) {
      matchupRows += `<div class="props-stat-row"><span class="label">Implied Team Total</span><span class="value">${m.impliedTotal}</span></div>`;
    }
    // B2B
    if (m.isB2B) {
      matchupRows += `<div class="props-stat-row"><span class="label">Back-to-Back</span><span class="value red">⚠️ Yes (-6%)</span></div>`;
    }
  }

  return `
    <div class="props-result-card ${a.confidence}">
      <div class="props-stat-header">
        <span class="props-stat-label">${a.shortLabel} — ${a.label}</span>
        <span class="props-recommendation ${recClass}">${a.recommendation}</span>
      </div>
      <div class="props-line-display">
        <div class="props-line-number">${a.propLine}</div>
        <div class="props-line-caption">Prop Line ${bookBadge}</div>
      </div>
      <div class="props-stats-rows">
        ${oddsRow}
        ${matchupRows}
        <div class="props-stat-row" style="border-top:1px solid rgba(255,255,255,0.06);padding-top:6px;margin-top:4px"><span class="label">Season Avg</span><span class="value">${a.seasonAvg}</span></div>
        <div class="props-stat-row"><span class="label">Last 5 Avg</span><span class="value ${a.avg5 > a.propLine ? 'green' : a.avg5 < a.propLine ? 'red' : ''}">${a.avg5} ${trendIcon}</span></div>
        <div class="props-stat-row"><span class="label">Last 10 Avg</span><span class="value">${a.avg10}</span></div>
        <div class="props-stat-row"><span class="label">Home / Away Avg</span><span class="value">${a.homeAvg} / ${a.awayAvg}</span></div>
        ${vsOppRow}
        <div class="props-stat-row"><span class="label">Hit Rate (Season)</span><span class="value ${a.hitRateSeason >= 55 ? 'green' : a.hitRateSeason <= 40 ? 'red' : 'yellow'}">${a.hitRateSeason}% over (${a.gamesPlayed}g)</span></div>
        <div class="props-stat-row"><span class="label">Hit Rate (L10)</span><span class="value">${a.hitRate10}%</span></div>
        <div class="props-stat-row"><span class="label">Consistency (StdDev)</span><span class="value">${a.stdDev}</span></div>
      </div>
      <div class="props-hit-bar">
        <div class="props-hit-bar-fill" style="width: ${a.overProbability}%; background: ${hitColor};"></div>
      </div>
      <div class="props-confidence-bar">
        <span class="props-confidence-label">Over ${a.overProbability}%</span>
        <span class="props-confidence-label" style="margin-left:auto">Under ${a.underProbability}%</span>
      </div>
    </div>
  `;
}

function propsRenderGameLog(games) {
  if (!games.length) return;

  const section = document.getElementById('props-game-log');
  section.classList.remove('hidden');

  // Determine which stat columns to show
  const statKeys = ['pts', 'reb', 'ast', 'stl', 'blk', 'to', 'min', 'fg3'];
  const statLabels = { pts: 'PTS', reb: 'REB', ast: 'AST', stl: 'STL', blk: 'BLK', to: 'TO', min: 'MIN', fg3: '3PM' };

  // Filter to stat keys that have data
  const availableKeys = statKeys.filter(k => games.some(g => {
    const keys = Object.keys(g.stats || {});
    return keys.some(sk => sk.toLowerCase() === k || (k === 'fg3' && (sk === '3pm' || sk === 'fg3')));
  }));

  const head = document.getElementById('props-gamelog-head');
  head.innerHTML = `<th>Date</th><th>Opp</th><th>Result</th>${availableKeys.map(k => `<th>${statLabels[k] || k.toUpperCase()}</th>`).join('')}`;

  const body = document.getElementById('props-gamelog-body');
  body.innerHTML = games.map(g => {
    const date = g.date ? new Date(g.date).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—';
    const result = g.result || '—';
    const resultClass = result.startsWith('W') ? 'green' : result.startsWith('L') ? 'red' : '';
    const stats = g.stats || {};

    const getVal = (key) => {
      const aliases = { fg3: ['3pm', 'fg3'], pts: ['pts'], reb: ['reb'], ast: ['ast'], stl: ['stl'], blk: ['blk'], to: ['to'], min: ['min'] };
      for (const alias of (aliases[key] || [key])) {
        if (stats[alias] !== undefined) return stats[alias];
        if (stats[alias.toLowerCase()] !== undefined) return stats[alias.toLowerCase()];
      }
      return '—';
    };

    return `
      <tr>
        <td>${date}</td>
        <td>${g.opponent || '—'}</td>
        <td class="${resultClass}">${result}</td>
        ${availableKeys.map(k => `<td>${getVal(k)}</td>`).join('')}
      </tr>
    `;
  }).join('');
}

function propsBackToGames() {
  document.getElementById('props-step-player').classList.add('hidden');
  document.getElementById('props-step-results').classList.add('hidden');
  propsSelectedGame = null;
  document.querySelectorAll('.props-game-card').forEach(c => c.classList.remove('active'));
}

function propsBackToPlayer() {
  document.getElementById('props-step-results').classList.add('hidden');
  propsSelectedPlayer = null;
}

// ── Top Picks ──

async function propsGenerateTopPicks() {
  const btn = document.getElementById('props-top-picks-btn');
  const content = document.getElementById('props-top-picks-content');
  const loading = document.getElementById('props-top-picks-loading');

  btn.disabled = true;
  btn.textContent = 'Scanning...';
  content.classList.add('hidden');
  loading.classList.remove('hidden');

  try {
    const res = await fetch('/api/props/top-picks');
    const data = await res.json();

    if (data.error) {
      loading.innerHTML = `<div class="props-empty">${data.error}</div>`;
      return;
    }

    loading.classList.add('hidden');
    content.classList.remove('hidden');

    // Render overs
    const oversList = document.getElementById('props-overs-list');
    oversList.innerHTML = data.overs.length
      ? data.overs.map((p, i) => propsRenderPickCard(p, i + 1, 'over')).join('')
      : '<div class="props-empty">No strong OVER picks found today</div>';

    // Render unders
    const undersList = document.getElementById('props-unders-list');
    undersList.innerHTML = data.unders.length
      ? data.unders.map((p, i) => propsRenderPickCard(p, i + 1, 'under')).join('')
      : '<div class="props-empty">No strong UNDER picks found today</div>';

    // Meta info
    const meta = document.getElementById('props-top-picks-meta');
    const time = data.generatedAt ? new Date(data.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    const lineLabel = data.usingRealLines ? '✅ Using real sportsbook lines' : '⚠️ Using estimated lines (no API key)';
    meta.innerHTML = `${lineLabel} · Scanned ${data.gamesScanned} games · ${data.playersScanned} players · ${data.totalAnalyzed} props · ${time}`;

    btn.textContent = 'Refresh Picks';
    // Show share button
    const shareBtn = document.getElementById('props-share-btn');
    if (shareBtn) shareBtn.classList.remove('hidden');
    // Refresh pick tracker to reflect the new/updated picks
    propsLoadDailyHistory();
  } catch (err) {
    loading.innerHTML = '<div class="props-empty">Failed to generate picks. Try again.</div>';
  } finally {
    btn.disabled = false;
  }
}

function propsRenderPickCard(pick, rank, type) {
  const a = pick.analysis;
  const prob = type === 'over' ? a.overProbability : a.underProbability;
  const direction = type === 'over' ? 'OVER' : 'UNDER';
  const headshot = pick.player.headshot || '';
  const trendIcon = a.trending === 'up' ? '📈' : a.trending === 'down' ? '📉' : '➡️';
  const vsOppStr = a.vsOpponent ? ` · vs opp: ${a.vsOpponent.avg} (${a.vsOpponent.games}g)` : '';
  const hitRate = type === 'over' ? a.hitRateSeason : (100 - a.hitRateSeason);
  const lineSource = pick.lineSource && pick.lineSource !== 'generated' ? pick.lineSource : '';
  const bookBadge = lineSource ? `<span class="props-book-badge">${lineSource}</span>` : '<span class="props-book-badge est">estimated</span>';
  const oddsStr = pick.bookOdds ? ` (${type === 'over' ? formatOdds(pick.bookOdds.over) : formatOdds(pick.bookOdds.under)})` : '';

  // Format pick label: whole numbers use "1+ 3PM" style, .5 lines use "OVER 1.5 3PM"
  const line = a.propLine;
  const isWholeNumber = line % 1 === 0;
  let pickLabel;
  if (type === 'over' && isWholeNumber) {
    pickLabel = `${pick.stat.shortLabel} ${Math.round(line)}+`;
  } else if (type === 'under' && isWholeNumber) {
    pickLabel = `${pick.stat.shortLabel} ${direction} ${line}`;
  } else {
    pickLabel = `${pick.stat.shortLabel} ${direction} ${line}`;
  }

  // Volatility badge
  const vol = a.volatility;
  let volClass = 'vol-stable';
  let volIcon = '🔒';
  if (vol > 0.50) { volClass = 'vol-high'; volIcon = '⚠️'; }
  else if (vol > 0.30) { volClass = 'vol-med'; volIcon = '🟡'; }
  else if (vol > 0.15) { volClass = 'vol-low'; volIcon = '🟢'; }
  const volBadge = vol != null ? `<span class="props-vol-badge ${volClass}" title="Role Volatility: ${vol} (${a.volatilityLabel})">${volIcon} ${a.volatilityLabel}</span>` : '';

  // Matchup context tags
  let matchupLine = '';
  if (a.matchup) {
    const m = a.matchup;
    const tags = [];
    // Projected value
    const projColor = a.projectedValue > a.propLine ? 'green' : a.projectedValue < a.propLine ? 'red' : '';
    tags.push(`<span class="props-matchup-chip ${projColor}">Proj: ${a.projectedValue}</span>`);
    // Pace
    const paceColor = m.paceLabel === 'fast' ? 'green' : m.paceLabel === 'slow' ? 'red' : '';
    tags.push(`<span class="props-matchup-chip ${paceColor}">${m.paceLabel === 'fast' ? '🏃' : m.paceLabel === 'slow' ? '🐢' : '⚖️'} ${m.gamePace} pace</span>`);
    // Defense
    const defColor = m.defLabel === 'weak defense' ? 'green' : m.defLabel === 'strong defense' ? 'red' : '';
    tags.push(`<span class="props-matchup-chip ${defColor}">${m.defLabel === 'weak defense' ? '🎯' : m.defLabel === 'strong defense' ? '🛡️' : '⚖️'} ${m.oppPtsAllowed} PPG</span>`);
    // Implied total
    if (m.impliedTotal) {
      tags.push(`<span class="props-matchup-chip">📊 IT ${m.impliedTotal}</span>`);
    }
    // B2B
    if (m.isB2B) {
      tags.push(`<span class="props-matchup-chip red">⚠️ B2B</span>`);
    }
    matchupLine = `<div class="props-pick-matchup">${tags.join('')}</div>`;
  }

  return `
    <div class="props-pick-card ${type}">
      <span class="props-pick-rank">${rank}</span>
      ${headshot ? `<img class="props-pick-avatar" src="${headshot}" alt="" loading="lazy">` : ''}
      <div class="props-pick-info">
        <div class="props-pick-name">${pick.player.name}</div>
        <div class="props-pick-detail">${pick.teamAbbr} · ${pick.matchup} · ${pickLabel}${oddsStr} ${bookBadge}</div>
        <div class="props-pick-detail">Avg: ${a.seasonAvg} · L5: ${a.avg5} ${trendIcon} · Hit: ${hitRate}%${vsOppStr} ${volBadge}</div>
        ${matchupLine}
      </div>
      <div class="props-pick-right">
        <div class="props-pick-prob ${type}">${prob}%</div>
        <div class="props-pick-line">${a.confidence}</div>
      </div>
    </div>
  `;
}

function formatOdds(odds) {
  if (odds === null || odds === undefined) return '';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

// ═══════════════════════════════════════════════
//  Prop Picks — Share as Image
// ═══════════════════════════════════════════════

async function propsShareTopPicks() {
  const shareBtn = document.getElementById('props-share-btn');
  const content = document.getElementById('props-top-picks-content');
  if (!content || content.classList.contains('hidden')) return;

  shareBtn.disabled = true;
  shareBtn.textContent = '⏳ Capturing...';

  try {
    // Build a standalone clone for cleaner image capture
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:800px;padding:28px;background:#1a1a2e;border-radius:12px;font-family:Inter,system-ui,sans-serif;color:#e0e0e0;z-index:-1;';
    
    // Branded header
    const header = document.createElement('div');
    header.style.cssText = 'text-align:center;margin-bottom:20px;padding-bottom:14px;border-bottom:1px solid rgba(255,255,255,0.1);';
    header.innerHTML = `
      <div style="font-size:24px;font-weight:800;color:#fff;margin-bottom:4px;">🔥 Today's Top Picks</div>
      <div style="font-size:12px;color:#888;">TheGamblingKingApp.com · ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}</div>
    `;
    wrapper.appendChild(header);

    // Clone the picks grid — but force single column for cleaner image
    const gridClone = content.querySelector('.props-top-picks-grid').cloneNode(true);
    gridClone.style.cssText = 'display:flex;flex-direction:column;gap:20px;';
    wrapper.appendChild(gridClone);

    // Clone meta info
    const meta = document.getElementById('props-top-picks-meta');
    if (meta && meta.textContent) {
      const metaClone = meta.cloneNode(true);
      metaClone.style.cssText = 'font-size:10px;color:#666;text-align:center;margin-top:12px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06);';
      wrapper.appendChild(metaClone);
    }

    document.body.appendChild(wrapper);

    // Apply styles to cloned elements
    const styleSheet = document.createElement('style');
    styleSheet.textContent = `
      .props-top-picks-grid { display:flex; flex-direction:column; gap:20px; }
      .props-picks-col-title { font-size:15px; font-weight:700; margin-bottom:10px; text-align:center; }
      .props-picks-col-title.over { color:#22c55e; }
      .props-picks-col-title.under { color:#ef4444; }
      .props-picks-list { display:flex; flex-direction:column; gap:8px; }
      .props-pick-card { display:flex; align-items:center; padding:10px 12px; border-radius:8px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.06); gap:10px; }
      .props-pick-card.over { border-left:3px solid #22c55e; }
      .props-pick-card.under { border-left:3px solid #ef4444; }
      .props-pick-rank { font-size:15px; font-weight:800; min-width:22px; color:#888; text-align:center; flex-shrink:0; }
      .props-pick-avatar { width:38px; height:38px; border-radius:50%; object-fit:cover; flex-shrink:0; }
      .props-pick-info { flex:1; min-width:0; }
      .props-pick-name { font-size:14px; font-weight:700; color:#fff; }
      .props-pick-detail { font-size:11px; color:#aaa; margin-top:3px; line-height:1.4; word-break:break-word; }
      .props-pick-right { text-align:right; margin-left:10px; flex-shrink:0; }
      .props-pick-prob { font-size:18px; font-weight:800; }
      .props-pick-prob.over { color:#22c55e; }
      .props-pick-prob.under { color:#ef4444; }
      .props-pick-line { font-size:9px; color:#888; margin-top:2px; }
      .props-book-badge { font-size:8px; font-weight:600; text-transform:uppercase; padding:1px 4px; border-radius:3px; background:rgba(34,197,94,0.15); color:#22c55e; }
      .props-book-badge.est { background:rgba(245,158,11,0.15); color:#f59e0b; }
      .props-matchup-banner { display:flex; flex-wrap:wrap; gap:6px; padding:10px 12px; margin-bottom:12px; background:rgba(255,255,255,0.03); border-radius:10px; border:1px solid rgba(255,255,255,0.06); grid-column:1/-1; }
      .props-matchup-tag { font-size:11px; font-weight:600; padding:4px 8px; border-radius:6px; background:rgba(255,255,255,0.06); color:#ccc; white-space:nowrap; }
      .props-matchup-tag.fast { background:rgba(34,197,94,0.12); color:#22c55e; }
      .props-matchup-tag.slow { background:rgba(239,68,68,0.12); color:#ef4444; }
      .props-pick-matchup { display:flex; flex-wrap:wrap; gap:4px; margin-top:4px; }
      .props-matchup-chip { font-size:9px; font-weight:600; padding:2px 6px; border-radius:4px; background:rgba(255,255,255,0.06); color:#aaa; white-space:nowrap; }
      .props-matchup-chip.green { background:rgba(34,197,94,0.12); color:#22c55e; }
      .props-matchup-chip.red { background:rgba(239,68,68,0.12); color:#ef4444; }
      .props-vol-badge { font-size:8px; font-weight:600; padding:1px 4px; border-radius:3px; margin-left:4px; }
      .props-vol-badge.vol-stable { background:rgba(34,197,94,0.12); color:#22c55e; }
      .props-vol-badge.vol-low { background:rgba(34,197,94,0.12); color:#22c55e; }
      .props-vol-badge.vol-med { background:rgba(245,158,11,0.12); color:#f59e0b; }
      .props-vol-badge.vol-high { background:rgba(239,68,68,0.12); color:#ef4444; }
    `;
    wrapper.appendChild(styleSheet);

    const canvas = await html2canvas(wrapper, {
      backgroundColor: '#1a1a2e',
      scale: 2,
      useCORS: true,
      logging: false,
    });

    document.body.removeChild(wrapper);

    // Convert to blob and trigger download
    canvas.toBlob(async (blob) => {
      if (!blob) return;

      // Try clipboard first (modern browsers)
      try {
        if (navigator.clipboard && navigator.clipboard.write) {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
          ]);
          shareBtn.textContent = '✅ Copied!';
          setTimeout(() => { shareBtn.textContent = '📤 Share'; }, 2000);
          return;
        }
      } catch (clipErr) {
        // Clipboard not available, fall through to download
      }

      // Fallback: download the image
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `top-picks-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
      URL.revokeObjectURL(url);
      shareBtn.textContent = '✅ Saved!';
      setTimeout(() => { shareBtn.textContent = '📤 Share'; }, 2000);
    }, 'image/png');

  } catch (err) {
    console.error('[Props] Share error:', err);
    shareBtn.textContent = '❌ Error';
    setTimeout(() => { shareBtn.textContent = '📤 Share'; }, 2000);
  } finally {
    shareBtn.disabled = false;
  }
}

// ═══════════════════════════════════════════════
//  Prop Picks — Tab Switching & Model Analytics
// ═══════════════════════════════════════════════

let propsAnalyticsLoaded = false;

function propsTrackerTab(tab) {
  document.querySelectorAll('.props-tracker-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('props-tab-history').classList.toggle('hidden', tab !== 'history');
  document.getElementById('props-tab-analytics').classList.toggle('hidden', tab !== 'analytics');
  if (tab === 'analytics' && !propsAnalyticsLoaded) {
    propsLoadAnalytics();
  }
}

async function propsLoadAnalytics() {
  const container = document.getElementById('props-analytics-content');
  if (!container) return;
  container.innerHTML = '<div class="props-loading">Loading model analytics...</div>';

  try {
    const res = await fetch('/api/props/accuracy', { headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) throw new Error('Failed to load');
    const s = await res.json();
    propsAnalyticsLoaded = true;

    if (!s.totalPicks) {
      container.innerHTML = '<div class="ma-empty"><p>No resolved picks yet. Come back after games finish and you\'ve checked results!</p></div>';
      return;
    }

    const rateColor = (rate) => rate >= 57 ? 'ma-green' : rate >= 52.4 ? 'ma-yellow' : 'ma-red';
    const roiColor = s.roi.pct > 0 ? 'ma-green' : s.roi.pct < 0 ? 'ma-red' : '';
    const roiSign = s.roi.units > 0 ? '+' : '';

    // Build breakdown tables helper
    const breakdownTable = (title, data) => {
      const rows = Object.values(data);
      if (!rows.length) return '';
      return `
        <div class="ma-breakdown">
          <h5 class="ma-breakdown-title">${title}</h5>
          <div class="ma-table">
            ${rows.map(r => {
              const pct = r.rate;
              const barW = Math.max(pct, 2);
              const color = rateColor(pct);
              return `
                <div class="ma-row">
                  <span class="ma-row-label">${r.label || ''}</span>
                  <div class="ma-row-bar-wrap">
                    <div class="ma-row-bar ${color}" style="width:${barW}%"></div>
                  </div>
                  <span class="ma-row-val ${color}">${pct}%</span>
                  <span class="ma-row-record">${r.hits}-${r.misses} (${r.total})</span>
                </div>`;
            }).join('')}
          </div>
        </div>`;
    };

    // Calibration table
    let calibrationHtml = '';
    if (s.calibration && s.calibration.length) {
      calibrationHtml = `
        <div class="ma-breakdown">
          <h5 class="ma-breakdown-title">Calibration — Is the model well-calibrated?</h5>
          <p class="ma-hint">If predicted % matches actual %, the model is calibrated. Big gaps mean over/under-confidence.</p>
          <div class="ma-table">
            ${s.calibration.map(c => {
              const diff = c.actual - c.predicted;
              const diffStr = diff > 0 ? `+${diff}%` : `${diff}%`;
              const diffColor = Math.abs(diff) <= 5 ? 'ma-green' : Math.abs(diff) <= 10 ? 'ma-yellow' : 'ma-red';
              return `
                <div class="ma-row">
                  <span class="ma-row-label">${c.bucket}</span>
                  <span class="ma-row-val">Predicted: ${c.predicted}%</span>
                  <span class="ma-row-val ${rateColor(c.actual)}">Actual: ${c.actual}%</span>
                  <span class="ma-row-val ${diffColor}">${diffStr}</span>
                  <span class="ma-row-record">(${c.count} picks)</span>
                </div>`;
            }).join('')}
          </div>
        </div>`;
    }

    // Daily log chart (simple text sparkline)
    let dailyLogHtml = '';
    if (s.dailyLog && s.dailyLog.length) {
      dailyLogHtml = `
        <div class="ma-breakdown">
          <h5 class="ma-breakdown-title">Daily Performance Log</h5>
          <div class="ma-daily-log">
            ${s.dailyLog.map(d => {
              const dateObj = new Date(d.date + 'T12:00:00');
              const label = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              const color = rateColor(d.rate);
              return `
                <div class="ma-daily-entry">
                  <span class="ma-daily-date">${label}</span>
                  <div class="ma-daily-bar-wrap">
                    <div class="ma-daily-bar ${color}" style="width:${Math.max(d.rate, 2)}%"></div>
                  </div>
                  <span class="ma-daily-val ${color}">${d.rate}%</span>
                  <span class="ma-daily-record">${d.hits}/${d.total}</span>
                </div>`;
            }).join('')}
          </div>
        </div>`;
    }

    // Add labels to confidence data
    const confLabels = { high: '🟢 High Conf', medium: '🟡 Medium Conf', low: '🟠 Low Conf' };
    for (const [k, v] of Object.entries(s.byConfidence)) {
      if (v) v.label = confLabels[k] || k;
    }

    container.innerHTML = `
      <!-- Hero summary -->
      <div class="ma-hero">
        <div class="ma-hero-main">
          <div class="ma-hero-pct ${rateColor(s.hitRate)}">${s.hitRate}%</div>
          <div class="ma-hero-label">Overall Hit Rate</div>
          <div class="ma-hero-record">${s.totalHits}-${s.totalPicks - s.totalHits} across ${s.totalPicks} picks</div>
        </div>
        <div class="ma-hero-cards">
          <div class="ma-card">
            <span class="ma-card-val ${rateColor(s.overStats.rate)}">${s.overStats.rate}%</span>
            <span class="ma-card-lbl">OVERs (${s.overStats.total})</span>
          </div>
          <div class="ma-card">
            <span class="ma-card-val ${rateColor(s.underStats.rate)}">${s.underStats.rate}%</span>
            <span class="ma-card-lbl">UNDERs (${s.underStats.total})</span>
          </div>
          <div class="ma-card">
            <span class="ma-card-val ${roiColor}">${roiSign}${s.roi.units}u</span>
            <span class="ma-card-lbl">ROI: ${s.roi.pct > 0 ? '+' : ''}${s.roi.pct}%</span>
          </div>
          <div class="ma-card">
            <span class="ma-card-val ${rateColor(s.last7Days.rate)}">${s.last7Days.total ? s.last7Days.rate + '%' : '—'}</span>
            <span class="ma-card-lbl">Last 7d (${s.last7Days.total})</span>
          </div>
          <div class="ma-card">
            <span class="ma-card-val ${rateColor(s.last30Days.rate)}">${s.last30Days.total ? s.last30Days.rate + '%' : '—'}</span>
            <span class="ma-card-lbl">Last 30d (${s.last30Days.total})</span>
          </div>
          <div class="ma-card">
            <span class="ma-card-val">${s.streak.type === 'hit' ? '🔥' : '❄️'} ${s.streak.current}</span>
            <span class="ma-card-lbl">Streak</span>
          </div>
        </div>
      </div>

      <!-- Break-even reference -->
      <div class="ma-reference">
        <span class="ma-ref-label">📏 Break-even at -110:</span>
        <span class="ma-ref-val">52.4%</span>
        <span class="ma-ref-label">· Profit zone:</span>
        <span class="ma-ref-val ma-green">53%+</span>
        <span class="ma-ref-label">· Strong edge:</span>
        <span class="ma-ref-val ma-green">55%+</span>
        <span class="ma-ref-label">· Elite:</span>
        <span class="ma-ref-val ma-green">58%+</span>
      </div>

      <!-- Breakdowns -->
      ${breakdownTable('By Confidence Level', s.byConfidence)}
      ${breakdownTable('By Stat Category', s.byStat)}
      ${breakdownTable('By Probability Bucket', s.byProbBucket)}
      ${breakdownTable('By Volatility Tier', s.byVolatility)}
      ${breakdownTable('By Matchup Factor', s.byMatchup)}
      ${calibrationHtml}
      ${dailyLogHtml}

      <button class="btn btn-sm btn-outline" style="margin-top:12px;" onclick="propsAnalyticsLoaded=false;propsLoadAnalytics();">↻ Refresh Analytics</button>
    `;
  } catch (err) {
    console.error('[Props] Analytics load error:', err);
    container.innerHTML = '<div class="ma-empty"><p>Error loading analytics. Try again later.</p></div>';
  }
}

// ═══════════════════════════════════════════════
//  Prop Picks — Daily History & Pick Tracker
// ═══════════════════════════════════════════════

async function propsLoadAccuracy() {
  // Now delegated to daily history view
  await propsLoadDailyHistory();
}

async function propsLoadDailyHistory() {
  try {
    const res = await fetch('/api/props/daily-history', {
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) return;
    const days = await res.json();
    propsRenderDailyHistory(days);
  } catch (err) {
    console.error('[Props] Daily history load error:', err);
  }
}

function propsRenderDailyHistory(days) {
  const emptyEl = document.getElementById('props-accuracy-empty');
  const heroStats = document.getElementById('props-hero-stats');
  const historyEl = document.getElementById('props-daily-history');

  if (!days || !days.length) {
    if (emptyEl) emptyEl.classList.remove('hidden');
    if (heroStats) heroStats.classList.add('hidden');
    if (historyEl) historyEl.classList.add('hidden');
    return;
  }

  if (emptyEl) emptyEl.classList.add('hidden');
  if (heroStats) heroStats.classList.remove('hidden');
  if (historyEl) historyEl.classList.remove('hidden');

  // Calculate overall stats
  let totalResolved = 0, totalHits = 0;
  let overResolved = 0, overHits = 0;
  let underResolved = 0, underHits = 0;
  for (const day of days) {
    for (const p of day.picks) {
      if (p.hit !== null) {
        totalResolved++;
        if (p.hit) totalHits++;
        if (p.direction === 'over') { overResolved++; if (p.hit) overHits++; }
        else { underResolved++; if (p.hit) underHits++; }
      }
    }
  }

  // Hero stats
  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('hero-hit-pct', totalResolved ? Math.round((totalHits / totalResolved) * 100) + '%' : '—');
  setEl('hero-record', totalResolved ? `${totalHits}-${totalResolved - totalHits} (${totalResolved} picks)` : '');
  setEl('hero-over-pct', overResolved ? Math.round((overHits / overResolved) * 100) + '%' : '—');
  setEl('hero-under-pct', underResolved ? Math.round((underHits / underResolved) * 100) + '%' : '—');

  // Streak
  const allPicks = days.flatMap(d => d.picks).filter(p => p.hit !== null);
  let streak = { count: 0, type: null };
  for (const p of allPicks) {
    const t = p.hit ? 'hit' : 'miss';
    if (!streak.type) { streak.type = t; streak.count = 1; }
    else if (t === streak.type) streak.count++;
    else break;
  }
  if (streak.count > 0) {
    setEl('hero-streak', (streak.type === 'hit' ? '🔥 ' : '❄️ ') + streak.count);
  } else {
    setEl('hero-streak', '—');
  }

  // Render daily sections
  historyEl.innerHTML = days.map(day => {
    const dateObj = new Date(day.date + 'T12:00:00');
    const dateLabel = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const pctText = day.hitRate !== null ? `${day.hitRate}%` : 'Pending';
    const pctClass = day.hitRate !== null ? (day.hitRate >= 60 ? 'good' : day.hitRate >= 40 ? 'ok' : 'bad') : 'pending';
    const recordText = day.resolved ? `${day.hits}-${day.misses}` : '';
    const pendingBadge = day.pending > 0 ? `<span class="dh-pending-badge">${day.pending} pending</span>` : '';
    const dnpBadge = day.dnps > 0 ? `<span class="dh-pending-badge" style="background:rgba(255,135,50,0.15);color:#ff8732">${day.dnps} DNP</span>` : '';

    const overs = day.picks.filter(p => p.direction === 'over');
    const unders = day.picks.filter(p => p.direction === 'under');

    return `
      <div class="dh-day" data-date="${day.date}">
        <div class="dh-day-header" onclick="this.parentElement.classList.toggle('open')">
          <span class="dh-day-date">${dateLabel}</span>
          <span class="dh-day-record">${recordText}</span>
          ${pendingBadge}
          ${dnpBadge}
          <span class="dh-day-pct ${pctClass}">${pctText}</span>
          <span class="dh-chevron">▸</span>
        </div>
        <div class="dh-day-body">
          ${overs.length ? `<h5 class="dh-section-title over">📈 OVERs</h5>` : ''}
          ${overs.map(p => propsRenderHistoryPick(p)).join('')}
          ${unders.length ? `<h5 class="dh-section-title under">📉 UNDERs</h5>` : ''}
          ${unders.map(p => propsRenderHistoryPick(p)).join('')}
        </div>
      </div>`;
  }).join('');
}

function propsRenderHistoryPick(p) {
  if (p.dnp) {
    const dir = p.direction.toUpperCase();
    return `
      <div class="dh-pick dnp">
        <div class="dh-pick-main">
          <span class="dh-pick-icon">🚫</span>
          ${p.headshot ? `<img class="dh-pick-avatar" src="${p.headshot}" alt="" loading="lazy" style="opacity:0.4">` : ''}
          <div class="dh-pick-info">
            <span class="dh-pick-name" style="opacity:0.5">${p.playerName}</span>
            <span class="dh-pick-detail">${p.teamAbbr} · ${p.matchup}</span>
          </div>
          <div class="dh-pick-prop">
            <span class="dh-pick-dir ${p.direction}" style="opacity:0.4">${dir} ${p.statLabel} ${p.propLine}</span>
          </div>
          <div class="dh-pick-result">
            <span class="dh-pick-verdict dnp">DNP</span>
          </div>
        </div>
      </div>`;
  }

  const icon = p.hit === true ? '✅' : p.hit === false ? '❌' : '⏳';
  const resultClass = p.hit === true ? 'hit' : p.hit === false ? 'miss' : 'pending';
  const dir = p.direction.toUpperCase();
  const actualText = p.actualValue !== null ? `Actual: ${p.actualValue}` : '';
  const hitMissLabel = p.hit === true ? 'HIT' : p.hit === false ? 'MISS' : '';

  return `
    <div class="dh-pick ${resultClass}">
      <div class="dh-pick-main" onclick="propsToggleBreakdown(this.parentElement)">
        <span class="dh-pick-icon">${icon}</span>
        ${p.headshot ? `<img class="dh-pick-avatar" src="${p.headshot}" alt="" loading="lazy">` : ''}
        <div class="dh-pick-info">
          <span class="dh-pick-name">${p.playerName}</span>
          <span class="dh-pick-detail">${p.teamAbbr} · ${p.matchup}</span>
        </div>
        <div class="dh-pick-prop">
          <span class="dh-pick-dir ${p.direction}">${dir} ${p.statLabel} ${p.propLine}</span>
          <span class="dh-pick-conf">${p.confidence}</span>
        </div>
        <div class="dh-pick-result">
          ${actualText ? `<span class="dh-pick-actual">${actualText}</span>` : ''}
          ${hitMissLabel ? `<span class="dh-pick-verdict ${resultClass}">${hitMissLabel}</span>` : ''}
        </div>
        <span class="dh-pick-expand">▸</span>
      </div>
      <div class="dh-pick-breakdown">
        ${propsGenerateSummary(p)}
      </div>
    </div>`;
}

function propsToggleBreakdown(el) {
  el.classList.toggle('expanded');
}

function propsGenerateSummary(p) {
  const lines = [];
  const dir = p.direction === 'over' ? 'OVER' : 'UNDER';
  const stat = p.statLabel;
  const line = p.propLine;

  // Main thesis
  if (p.direction === 'over') {
    if (p.seasonAvg !== null && p.seasonAvg > line) {
      lines.push(`${p.playerName} averages ${p.seasonAvg} ${stat} this season, already above the ${line} line.`);
    } else if (p.seasonAvg !== null) {
      lines.push(`${p.playerName} averages ${p.seasonAvg} ${stat} this season with a line set at ${line}.`);
    }
  } else {
    if (p.seasonAvg !== null && p.seasonAvg < line) {
      lines.push(`${p.playerName} averages ${p.seasonAvg} ${stat} this season, already under the ${line} line.`);
    } else if (p.seasonAvg !== null) {
      lines.push(`${p.playerName} averages ${p.seasonAvg} ${stat} this season with a line set at ${line}.`);
    }
  }

  // Recent trend
  if (p.l5Avg !== null && p.seasonAvg !== null) {
    const diff = p.l5Avg - p.seasonAvg;
    if (p.direction === 'over' && diff > 0) {
      lines.push(`He's trending up — averaging ${p.l5Avg} over his last 5 games, ${Math.abs(diff).toFixed(1)} above his season average.`);
    } else if (p.direction === 'over' && diff < 0) {
      lines.push(`His last 5 average of ${p.l5Avg} is slightly below his season mark, but the probability model still favors the over.`);
    } else if (p.direction === 'under' && diff < 0) {
      lines.push(`He's trending down — averaging just ${p.l5Avg} over his last 5 games, ${Math.abs(diff).toFixed(1)} below his season average.`);
    } else if (p.direction === 'under' && diff > 0) {
      lines.push(`His recent 5-game average of ${p.l5Avg} is slightly higher, but the matchup and consistency favor the under.`);
    }
  }

  // Hit rate
  if (p.hitRateSeason !== null) {
    const hitsOver = Math.round(p.hitRateSeason);
    if (p.direction === 'over') {
      lines.push(`He's gone over this line in ${hitsOver}% of games this season.`);
    } else {
      lines.push(`He's stayed under this line in ${100 - hitsOver}% of games this season.`);
    }
  }

  // Matchup history
  if (p.vsOpponentAvg !== null && p.vsOpponentGames > 0) {
    lines.push(`Against this opponent he's averaged ${p.vsOpponentAvg} ${stat} across ${p.vsOpponentGames} game${p.vsOpponentGames > 1 ? 's' : ''} this season.`);
  }

  // Confidence
  if (p.confidence === 'high') {
    lines.push(`This was flagged as a high-confidence pick at ${p.probability}% probability.`);
  } else if (p.confidence === 'medium') {
    lines.push(`Rated as medium confidence at ${p.probability}% probability.`);
  }

  // Volatility
  if (p.volatility != null) {
    if (p.volatility <= 0.15) {
      lines.push(`🔒 Very stable role (volatility ${p.volatility}) — this player's minutes and usage are extremely consistent.`);
    } else if (p.volatility <= 0.30) {
      lines.push(`🟢 Stable role (volatility ${p.volatility}) — minutes and usage are consistent enough to trust the numbers.`);
    } else if (p.volatility <= 0.50) {
      lines.push(`🟡 Moderate volatility (${p.volatility}) — this player's role can swing, which adds risk to the pick.`);
    } else {
      lines.push(`⚠️ High volatility (${p.volatility}) — minutes and usage are inconsistent. This player's role is unpredictable.`);
    }
  }

  // Matchup context
  if (p.projectedValue != null) {
    const projDir = p.projectedValue > p.propLine ? 'above' : p.projectedValue < p.propLine ? 'below' : 'right at';
    lines.push(`📊 Matchup-adjusted projection: ${p.projectedValue} ${stat} — ${projDir} the ${line} line.`);
  }
  if (p.gamePace != null && p.paceLabel) {
    const paceEmoji = p.paceLabel === 'fast' ? '🏃' : p.paceLabel === 'slow' ? '🐢' : '⚖️';
    lines.push(`${paceEmoji} Game pace: ${p.gamePace} (${p.paceLabel}) — ${p.paceLabel === 'fast' ? 'uptempo game should boost counting stats.' : p.paceLabel === 'slow' ? 'slower pace could limit opportunities.' : 'average pace expected.'}`);
  }
  if (p.oppPtsAllowed != null && p.defLabel) {
    const defEmoji = p.defLabel === 'weak defense' ? '🎯' : p.defLabel === 'strong defense' ? '🛡️' : '⚖️';
    lines.push(`${defEmoji} Opponent allows ${p.oppPtsAllowed} PPG (${p.defLabel}) — ${p.defLabel === 'weak defense' ? 'favorable matchup for stat production.' : p.defLabel === 'strong defense' ? 'tough defensive matchup could suppress numbers.' : 'average defensive matchup.'}`);
  }
  if (p.impliedTotal != null) {
    lines.push(`📈 Implied team total: ${p.impliedTotal} — ${p.impliedTotal > 112 ? 'Vegas expects a higher-scoring game.' : p.impliedTotal < 108 ? 'Vegas expects a lower-scoring game.' : 'average scoring environment expected.'}`);
  }
  if (p.isB2B) {
    lines.push(`⚠️ Back-to-back game — fatigue factor applied. Players on B2Bs see roughly a 6% reduction in production.`);
  }

  // Result
  if (p.actualValue !== null) {
    if (p.hit) {
      lines.push(`✅ Result: He finished with ${p.actualValue} ${stat} — pick hit.`);
    } else {
      lines.push(`❌ Result: He finished with ${p.actualValue} ${stat} — pick missed.`);
    }
  }

  return `<div class="dh-summary">${lines.map(l => `<p>${l}</p>`).join('')}</div>`;
}

async function propsCheckResults() {
  const btn = document.getElementById('props-resolve-btn');
  const loading = document.getElementById('props-resolve-loading');
  if (btn) btn.disabled = true;
  if (loading) loading.classList.remove('hidden');

  try {
    const res = await fetch('/api/props/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();

    if (data.resolved > 0) {
      const dnpNote = data.dnpCount ? ` (${data.dnpCount} DNP)` : '';
      showToast(`Resolved ${data.resolved} picks!${dnpNote}`);
    } else if (data.unresolved === 0) {
      showToast('No pending picks to resolve');
    } else {
      showToast(`Games not finished yet (${data.unresolved} pending)`);
    }

    await propsLoadDailyHistory();
  } catch (err) {
    console.error('[Props] Resolve error:', err);
    showToast('Error checking results');
  } finally {
    if (btn) btn.disabled = false;
    if (loading) loading.classList.add('hidden');
  }
}

// ═══════════════════════════════════════════════
//  NBA Game Picks (ML, Spread, O/U)
// ═══════════════════════════════════════════════

async function gamePicksGenerate() {
  const btn = document.getElementById('game-picks-generate-btn');
  const content = document.getElementById('game-picks-content');
  const loading = document.getElementById('game-picks-loading');
  const allGamesSection = document.getElementById('game-picks-all-games');

  btn.disabled = true;
  btn.textContent = 'Analyzing...';
  content.classList.add('hidden');
  allGamesSection.classList.add('hidden');
  loading.classList.remove('hidden');

  try {
    const res = await fetch('/api/game-picks/top');
    const data = await res.json();

    if (data.error) {
      loading.innerHTML = `<div class="props-empty">${data.error}</div>`;
      return;
    }

    loading.classList.add('hidden');
    content.classList.remove('hidden');

    // Render ML picks
    const mlList = document.getElementById('game-picks-ml-list');
    mlList.innerHTML = data.moneyline.length
      ? data.moneyline.map((p, i) => renderGamePickCard(p, i + 1, 'ml')).join('')
      : '<div class="props-empty">No strong ML picks today</div>';

    // Render Spread picks
    const spreadList = document.getElementById('game-picks-spread-list');
    spreadList.innerHTML = data.spread.length
      ? data.spread.map((p, i) => renderGamePickCard(p, i + 1, 'spread')).join('')
      : '<div class="props-empty">No strong spread picks today</div>';

    // Render O/U picks
    const ouList = document.getElementById('game-picks-ou-list');
    ouList.innerHTML = data.overUnder.length
      ? data.overUnder.map((p, i) => renderGamePickCard(p, i + 1, 'ou')).join('')
      : '<div class="props-empty">No strong O/U picks today</div>';

    // Meta info
    const meta = document.getElementById('game-picks-meta');
    const time = data.generatedAt ? new Date(data.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    meta.innerHTML = `Analyzed ${data.gamesScanned} games · Generated ${time} · All data from ESPN (free)`;

    // Render all-games breakdown
    if (data.allGames && data.allGames.length) {
      allGamesSection.classList.remove('hidden');
      const gamesGrid = document.getElementById('game-picks-games-grid');
      gamesGrid.innerHTML = data.allGames.map(g => renderGameBreakdown(g)).join('');
    }

    btn.textContent = 'Refresh Picks';
    const shareBtn = document.getElementById('game-picks-share-btn');
    if (shareBtn) shareBtn.classList.remove('hidden');
  } catch (err) {
    console.error('[GamePicks] Generate error:', err);
    loading.innerHTML = '<div class="props-empty">Failed to generate picks. Try again.</div>';
  } finally {
    btn.disabled = false;
  }
}

function renderGamePickCard(pick, rank, type) {
  const prob = pick.probability;
  const conf = pick.confidence;

  // Determine display info based on type
  let pickLabel, typeClass, typeIcon;
  if (type === 'ml') {
    pickLabel = pick.pick;
    typeClass = 'ml';
    typeIcon = '💰';
  } else if (type === 'spread') {
    pickLabel = pick.pick;
    typeClass = 'spread';
    typeIcon = '📏';
  } else {
    pickLabel = pick.pick;
    typeClass = pick.pickDirection === 'over' ? 'over' : 'under';
    typeIcon = pick.pickDirection === 'over' ? '📈' : '📉';
  }

  // Game info
  const game = pick.game;
  const matchup = `${game.away.abbreviation} @ ${game.home.abbreviation}`;

  // Value badge for ML
  const valueBadge = pick.value
    ? `<span class="gp-value-badge">+${pick.value.edge}% edge (${pick.value.ml > 0 ? '+' : ''}${pick.value.ml})</span>`
    : '';

  // Key factors
  const topFactors = (pick.factors || []).slice(0, 3).map(f => {
    const impactClass = f.impact === 'home' || f.impact === 'over' ? 'green' : f.impact === 'away' || f.impact === 'under' ? 'red' : '';
    return `<span class="props-matchup-chip ${impactClass}" title="${f.detail}">${f.label}</span>`;
  }).join('');

  // Spread-specific: projected margin
  const projLine = type === 'spread' && pick.projectedMargin != null
    ? `<span class="gp-proj">Proj: ${pick.projectedMargin > 0 ? '+' : ''}${pick.projectedMargin}</span>`
    : '';

  // O/U-specific: projected total
  const projTotal = type === 'ou' && pick.projectedTotal != null
    ? `<span class="gp-proj">Proj: ${pick.projectedTotal}</span>`
    : '';

  // Home/Away logos
  const homeLogo = game.home.logo ? `<img class="gp-team-logo" src="${game.home.logo}" alt="" loading="lazy">` : '';
  const awayLogo = game.away.logo ? `<img class="gp-team-logo" src="${game.away.logo}" alt="" loading="lazy">` : '';

  return `
    <div class="gp-pick-card ${typeClass}">
      <span class="props-pick-rank">${rank}</span>
      <div class="gp-pick-logos">
        ${awayLogo}
        <span class="gp-at">@</span>
        ${homeLogo}
      </div>
      <div class="gp-pick-info">
        <div class="gp-pick-matchup">${matchup}</div>
        <div class="gp-pick-label">${typeIcon} ${pickLabel} ${valueBadge}</div>
        <div class="gp-pick-factors">${topFactors} ${projLine} ${projTotal}</div>
      </div>
      <div class="gp-pick-right">
        <div class="gp-pick-prob ${typeClass}">${prob}%</div>
        <div class="gp-pick-conf">${conf}</div>
      </div>
    </div>
  `;
}

function renderGameBreakdown(gameData) {
  const g = gameData.game;
  const ml = gameData.moneyline;
  const sp = gameData.spread;
  const ou = gameData.overUnder;
  const ha = gameData.homeAnalysis;
  const aa = gameData.awayAnalysis;

  const homeLogo = g.home.logo ? `<img class="gp-breakdown-logo" src="${g.home.logo}" alt="" loading="lazy">` : '';
  const awayLogo = g.away.logo ? `<img class="gp-breakdown-logo" src="${g.away.logo}" alt="" loading="lazy">` : '';

  // Injury lists
  const homeInj = ha.injuries.length
    ? `<div class="gp-injuries">🚑 OUT: ${ha.injuries.map(i => i.playerName).join(', ')}</div>`
    : '';
  const awayInj = aa.injuries.length
    ? `<div class="gp-injuries">🚑 OUT: ${aa.injuries.map(i => i.playerName).join(', ')}</div>`
    : '';

  // ML probabilities
  const mlBar = `
    <div class="gp-prob-bar">
      <div class="gp-prob-fill home" style="width:${ml.homeProb}%">${g.home.abbreviation} ${ml.homeProb}%</div>
      <div class="gp-prob-fill away" style="width:${ml.awayProb}%">${g.away.abbreviation} ${ml.awayProb}%</div>
    </div>
  `;

  // Spread
  const spreadLine = sp.pick
    ? `<div class="gp-breakdown-pick"><strong>Spread:</strong> ${sp.pick} <span class="gp-prob-inline ${sp.confidence}">${sp.probability}% (${sp.confidence})</span></div>`
    : '<div class="gp-breakdown-pick"><strong>Spread:</strong> N/A</div>';

  // O/U
  const ouLine = ou.pick
    ? `<div class="gp-breakdown-pick"><strong>O/U:</strong> ${ou.pick} (projected ${ou.projectedTotal}) <span class="gp-prob-inline ${ou.confidence}">${ou.probability}% (${ou.confidence})</span></div>`
    : '<div class="gp-breakdown-pick"><strong>O/U:</strong> N/A</div>';

  // H2H
  const h2h = gameData.h2h
    ? `<div class="gp-breakdown-h2h">H2H: ${gameData.h2h.wins}-${gameData.h2h.losses} · Avg margin: ${gameData.h2h.avgMargin > 0 ? '+' : ''}${gameData.h2h.avgMargin}</div>`
    : '';

  // Rest
  const restInfo = [];
  if (ha.isB2B) restInfo.push(`${g.home.abbreviation}: B2B ⚠️`);
  else if (ha.rest != null) restInfo.push(`${g.home.abbreviation}: ${ha.rest}d rest`);
  if (aa.isB2B) restInfo.push(`${g.away.abbreviation}: B2B ⚠️`);
  else if (aa.rest != null) restInfo.push(`${g.away.abbreviation}: ${aa.rest}d rest`);
  const restStr = restInfo.length ? `<div class="gp-breakdown-rest">${restInfo.join(' · ')}</div>` : '';

  // Key factors for all 3 analyses
  const allFactors = [...(ml.factors || []), ...(sp.factors || []), ...(ou.factors || [])];
  const uniqueFactors = [];
  const seen = new Set();
  for (const f of allFactors) {
    if (!seen.has(f.label)) {
      seen.add(f.label);
      uniqueFactors.push(f);
    }
  }

  return `
    <div class="gp-breakdown-card">
      <div class="gp-breakdown-header">
        <div class="gp-breakdown-teams">
          ${awayLogo}
          <span class="gp-breakdown-team">${g.away.abbreviation}</span>
          <span class="gp-breakdown-record">(${aa.record || ''}${aa.isB2B ? ' · B2B' : ''})</span>
          <span class="gp-breakdown-at">@</span>
          ${homeLogo}
          <span class="gp-breakdown-team">${g.home.abbreviation}</span>
          <span class="gp-breakdown-record">(${ha.record || ''}${ha.isB2B ? ' · B2B' : ''})</span>
        </div>
        <div class="gp-breakdown-odds">${g.odds ? `${g.odds.spread} · O/U ${g.odds.overUnder}` : 'No odds'}</div>
      </div>

      <div class="gp-breakdown-body">
        <div class="gp-breakdown-section">
          <div class="gp-breakdown-pick"><strong>Moneyline:</strong> ${ml.pick} <span class="gp-prob-inline ${ml.confidence}">${ml.probability}% (${ml.confidence})</span></div>
          ${mlBar}
        </div>
        ${spreadLine}
        ${ouLine}
        ${h2h}
        ${restStr}
        ${homeInj}
        ${awayInj}

        <div class="gp-breakdown-factors">
          ${uniqueFactors.slice(0, 5).map(f => {
            const cls = f.impact === 'home' || f.impact === 'over' ? 'green' : f.impact === 'away' || f.impact === 'under' ? 'red' : '';
            return `<span class="props-matchup-chip ${cls}" title="${f.detail}">${f.label}</span>`;
          }).join('')}
        </div>

        <div class="gp-form-row">
          <div class="gp-form-col">
            <div class="gp-form-label">${g.home.abbreviation} L10</div>
            <div class="gp-form-value">${ha.recentForm ? `${ha.recentForm.wins}-${ha.recentForm.losses} (${ha.recentForm.streak})` : '—'}</div>
            <div class="gp-form-sub">${ha.recentForm ? `${ha.recentForm.avgPtsFor} PPG · ${ha.recentForm.avgMargin > 0 ? '+' : ''}${ha.recentForm.avgMargin} margin` : ''}</div>
          </div>
          <div class="gp-form-col">
            <div class="gp-form-label">${g.away.abbreviation} L10</div>
            <div class="gp-form-value">${aa.recentForm ? `${aa.recentForm.wins}-${aa.recentForm.losses} (${aa.recentForm.streak})` : '—'}</div>
            <div class="gp-form-sub">${aa.recentForm ? `${aa.recentForm.avgPtsFor} PPG · ${aa.recentForm.avgMargin > 0 ? '+' : ''}${aa.recentForm.avgMargin} margin` : ''}</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function gamePicksShare() {
  const shareBtn = document.getElementById('game-picks-share-btn');
  const content = document.getElementById('game-picks-content');
  if (!content || content.classList.contains('hidden')) return;

  shareBtn.disabled = true;
  shareBtn.textContent = '⏳ Capturing...';

  try {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:900px;padding:28px;background:#1a1a2e;border-radius:12px;font-family:Inter,system-ui,sans-serif;color:#e0e0e0;z-index:-1;';

    const header = document.createElement('div');
    header.style.cssText = 'text-align:center;margin-bottom:20px;padding-bottom:14px;border-bottom:1px solid rgba(255,255,255,0.1);';
    header.innerHTML = `
      <div style="font-size:24px;font-weight:800;color:#fff;margin-bottom:4px;">🏀 Today's NBA Game Picks</div>
      <div style="font-size:12px;color:#888;">TheGamblingKingApp.com · ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}</div>
    `;
    wrapper.appendChild(header);

    const gridClone = content.querySelector('.game-picks-top-grid').cloneNode(true);
    gridClone.style.cssText = 'display:grid;grid-template-columns:1fr;gap:20px;';
    wrapper.appendChild(gridClone);

    const meta = document.getElementById('game-picks-meta');
    if (meta && meta.textContent) {
      const metaClone = meta.cloneNode(true);
      metaClone.style.cssText = 'font-size:10px;color:#666;text-align:center;margin-top:12px;';
      wrapper.appendChild(metaClone);
    }

    document.body.appendChild(wrapper);

    const canvas = await html2canvas(wrapper, {
      backgroundColor: '#1a1a2e',
      scale: 2,
      useCORS: true,
      logging: false,
    });

    document.body.removeChild(wrapper);

    canvas.toBlob(async (blob) => {
      if (!blob) return;
      try {
        if (navigator.clipboard && navigator.clipboard.write) {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          shareBtn.textContent = '✅ Copied!';
          setTimeout(() => { shareBtn.textContent = '📤 Share'; }, 2000);
          return;
        }
      } catch (e) { /* fallthrough */ }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `game-picks-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
      URL.revokeObjectURL(url);
      shareBtn.textContent = '✅ Saved!';
      setTimeout(() => { shareBtn.textContent = '📤 Share'; }, 2000);
    }, 'image/png');
  } catch (err) {
    console.error('[GamePicks] Share error:', err);
    shareBtn.textContent = '❌ Error';
    setTimeout(() => { shareBtn.textContent = '📤 Share'; }, 2000);
  } finally {
    shareBtn.disabled = false;
  }
}

// ═══════════════════════════════════════════════
//  Game Picks — Pick Tracker (Daily History)
// ═══════════════════════════════════════════════

async function gpLoadDailyHistory() {
  try {
    const res = await fetch('/api/game-picks/daily-history', {
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) return;
    const days = await res.json();
    gpRenderDailyHistory(days);
  } catch (err) {
    console.error('[GamePicks] Daily history load error:', err);
  }
}

function gpRenderDailyHistory(days) {
  const emptyEl = document.getElementById('gp-tracker-empty');
  const heroStats = document.getElementById('gp-hero-stats');
  const historyEl = document.getElementById('gp-daily-history');

  if (!days || !days.length) {
    if (emptyEl) emptyEl.classList.remove('hidden');
    if (heroStats) heroStats.classList.add('hidden');
    if (historyEl) historyEl.innerHTML = '';
    return;
  }

  if (emptyEl) emptyEl.classList.add('hidden');
  if (heroStats) heroStats.classList.remove('hidden');

  // Calculate overall stats per type
  let totalResolved = 0, totalHits = 0;
  let mlResolved = 0, mlHits = 0;
  let spreadResolved = 0, spreadHits = 0;
  let ouResolved = 0, ouHits = 0;
  for (const day of days) {
    for (const p of day.picks) {
      if (p.hit !== null) {
        totalResolved++;
        if (p.hit) totalHits++;
        if (p.pickType === 'ml') { mlResolved++; if (p.hit) mlHits++; }
        else if (p.pickType === 'spread') { spreadResolved++; if (p.hit) spreadHits++; }
        else if (p.pickType === 'ou') { ouResolved++; if (p.hit) ouHits++; }
      }
    }
  }

  // Hero stats
  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('gp-hero-hit-pct', totalResolved ? Math.round((totalHits / totalResolved) * 100) + '%' : '—');
  setEl('gp-hero-record', totalResolved ? `${totalHits}-${totalResolved - totalHits} (${totalResolved} picks)` : '');
  setEl('gp-hero-ml-pct', mlResolved ? Math.round((mlHits / mlResolved) * 100) + '%' : '—');
  setEl('gp-hero-spread-pct', spreadResolved ? Math.round((spreadHits / spreadResolved) * 100) + '%' : '—');
  setEl('gp-hero-ou-pct', ouResolved ? Math.round((ouHits / ouResolved) * 100) + '%' : '—');

  // Render daily sections
  historyEl.innerHTML = days.map(day => {
    const dateObj = new Date(day.date + 'T12:00:00');
    const dateLabel = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const pctText = day.hitRate !== null ? `${day.hitRate}%` : 'Pending';
    const pctClass = day.hitRate !== null ? (day.hitRate >= 60 ? 'good' : day.hitRate >= 40 ? 'ok' : 'bad') : 'pending';
    const recordText = day.resolved ? `${day.hits}-${day.misses}` : '';
    const pendingBadge = day.pending > 0 ? `<span class="dh-pending-badge">${day.pending} pending</span>` : '';

    const mlPicks = day.picks.filter(p => p.pickType === 'ml');
    const spreadPicks = day.picks.filter(p => p.pickType === 'spread');
    const ouPicks = day.picks.filter(p => p.pickType === 'ou');

    return `
      <div class="dh-day" data-date="${day.date}">
        <div class="dh-day-header" onclick="this.parentElement.classList.toggle('open')">
          <span class="dh-day-date">${dateLabel}</span>
          <span class="dh-day-record">${recordText}</span>
          ${pendingBadge}
          <span class="dh-day-pct ${pctClass}">${pctText}</span>
          <span class="dh-chevron">▸</span>
        </div>
        <div class="dh-day-body">
          ${mlPicks.length ? `<h5 class="dh-section-title" style="color:#ffd700">💰 Moneyline</h5>` : ''}
          ${mlPicks.map(p => gpRenderHistoryPick(p)).join('')}
          ${spreadPicks.length ? `<h5 class="dh-section-title" style="color:#4fc3f7">📏 Spread</h5>` : ''}
          ${spreadPicks.map(p => gpRenderHistoryPick(p)).join('')}
          ${ouPicks.length ? `<h5 class="dh-section-title" style="color:#ab47bc">📊 Over/Under</h5>` : ''}
          ${ouPicks.map(p => gpRenderHistoryPick(p)).join('')}
        </div>
      </div>`;
  }).join('');
}

function gpRenderHistoryPick(p) {
  const icon = p.hit === true ? '✅' : p.hit === false ? '❌' : '⏳';
  const resultClass = p.hit === true ? 'hit' : p.hit === false ? 'miss' : 'pending';
  const hitMissLabel = p.hit === true ? 'HIT' : p.hit === false ? 'MISS' : '';

  // Score display
  let scoreText = '';
  if (p.homeFinal != null && p.awayFinal != null) {
    scoreText = `${p.awayTeam} ${p.awayFinal} - ${p.homeTeam} ${p.homeFinal}`;
  }

  // Type labels
  const typeLabels = { ml: 'ML', spread: 'Spread', ou: 'O/U' };
  const typeLabel = typeLabels[p.pickType] || p.pickType;

  return `
    <div class="dh-pick ${resultClass}">
      <div class="dh-pick-main" onclick="gpToggleBreakdown(this.parentElement)">
        <span class="dh-pick-icon">${icon}</span>
        <div class="gp-pick-logos-sm">
          ${p.awayLogo ? `<img class="gp-team-logo-sm" src="${p.awayLogo}" alt="" loading="lazy">` : ''}
          <span class="gp-at-sm">@</span>
          ${p.homeLogo ? `<img class="gp-team-logo-sm" src="${p.homeLogo}" alt="" loading="lazy">` : ''}
        </div>
        <div class="dh-pick-info">
          <span class="dh-pick-name">${p.gameName}</span>
          <span class="dh-pick-detail">${typeLabel}</span>
        </div>
        <div class="dh-pick-prop">
          <span class="dh-pick-dir ${p.pickType}">${p.pick}</span>
          <span class="dh-pick-conf">${p.confidence}</span>
        </div>
        <div class="dh-pick-result">
          ${scoreText ? `<span class="dh-pick-actual">${scoreText}</span>` : ''}
          ${hitMissLabel ? `<span class="dh-pick-verdict ${resultClass}">${hitMissLabel}</span>` : ''}
        </div>
        <span class="dh-pick-expand">▸</span>
      </div>
      <div class="dh-pick-breakdown">
        ${gpGenerateSummary(p)}
      </div>
    </div>`;
}

function gpToggleBreakdown(el) {
  el.classList.toggle('expanded');
}

function gpGenerateSummary(p) {
  const lines = [];

  // Context
  if (p.homeRecord && p.awayRecord) {
    lines.push(`${p.homeTeam} (${p.homeRecord}) vs ${p.awayTeam} (${p.awayRecord})`);
  }
  if (p.homeForm && p.awayForm) {
    lines.push(`L10 Form — ${p.homeTeam}: ${p.homeForm} · ${p.awayTeam}: ${p.awayForm}`);
  }
  if (p.homePower && p.awayPower) {
    lines.push(`Power Ratings — ${p.homeTeam}: ${p.homePower} · ${p.awayTeam}: ${p.awayPower}`);
  }
  if (p.projectedMargin != null && (p.pickType === 'ml' || p.pickType === 'spread')) {
    const favTeam = p.projectedMargin > 0 ? p.homeTeam : p.awayTeam;
    lines.push(`📊 Projected margin: ${favTeam} ${p.projectedMargin > 0 ? '+' : ''}${p.projectedMargin}`);
  }
  if (p.projectedTotal != null && p.pickType === 'ou') {
    lines.push(`📊 Projected total: ${p.projectedTotal} points`);
  }
  if (p.restAdvantage) {
    lines.push(`Rest: ${p.restAdvantage}`);
  }
  if (p.homeInjuries > 0 || p.awayInjuries > 0) {
    lines.push(`🚑 Injuries — ${p.homeTeam}: ${p.homeInjuries} OUT · ${p.awayTeam}: ${p.awayInjuries} OUT`);
  }

  // Confidence
  if (p.confidence === 'high') {
    lines.push(`🔥 High-confidence pick at ${p.probability}% probability.`);
  } else if (p.confidence === 'medium') {
    lines.push(`Medium confidence at ${p.probability}% probability.`);
  }

  // Key analysis factors
  if (p.factors && p.factors.length) {
    const factorLines = p.factors.slice(0, 4).map(f => `• ${f.label}: ${f.detail}`);
    lines.push(...factorLines);
  }

  // Result
  if (p.homeFinal != null && p.awayFinal != null) {
    const total = p.homeFinal + p.awayFinal;
    const margin = p.homeFinal - p.awayFinal;
    const winner = margin > 0 ? p.homeTeam : p.awayTeam;
    lines.push(`Final Score: ${p.awayTeam} ${p.awayFinal} - ${p.homeTeam} ${p.homeFinal} (${winner} by ${Math.abs(margin)}, Total: ${total})`);

    if (p.hit === true) {
      lines.push('✅ Pick hit!');
    } else if (p.hit === false) {
      lines.push('❌ Pick missed.');
    }
  }

  return `<div class="dh-summary">${lines.map(l => `<p>${l}</p>`).join('')}</div>`;
}

async function gpCheckResults() {
  const btn = document.getElementById('gp-resolve-btn');
  const loading = document.getElementById('gp-resolve-loading');
  if (btn) btn.disabled = true;
  if (loading) loading.classList.remove('hidden');

  try {
    const res = await fetch('/api/game-picks/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();

    if (data.resolved > 0) {
      showToast(`Resolved ${data.resolved} game picks!`);
    } else if (data.unresolved === 0) {
      showToast('No pending game picks to resolve');
    } else {
      showToast(`Games not finished yet (${data.unresolved} pending)`);
    }

    await gpLoadDailyHistory();
  } catch (err) {
    console.error('[GamePicks] Resolve error:', err);
    showToast('Error checking results');
  } finally {
    if (btn) btn.disabled = false;
    if (loading) loading.classList.add('hidden');
  }
}

// Auto-load game picks tracker on page load
(function() {
  const origSwitchPage = window.switchPage;
  if (origSwitchPage) {
    window.switchPage = function(page) {
      origSwitchPage(page);
      if (page === 'props') {
        gpLoadDailyHistory();
      }
    };
  }
})();

// ═══════════════════════════════════════════════
//  Admin Analytics
// ═══════════════════════════════════════════════

async function checkOwnerFeatures() {
  // Analytics + Models: owner-only (try the endpoint)
  try {
    const res = await fetch('/api/analytics');
    if (res.ok) {
      const navLink = document.getElementById('nav-analytics');
      if (navLink) navLink.classList.remove('hidden');
      const csLink = document.getElementById('nav-content-studio');
      if (csLink) csLink.classList.remove('hidden');
      // Show Models section (Props + Games)
      const modelsSection = document.getElementById('sidebar-models');
      const modelsDivider = document.getElementById('models-divider');
      if (modelsSection) modelsSection.classList.remove('hidden');
      if (modelsDivider) modelsDivider.classList.remove('hidden');
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
  const adminDivider = document.getElementById('admin-divider');
  const adminLinks = document.querySelectorAll('#admin-items .sidebar-link');
  const anyVisible = [...adminLinks].some(l => !l.classList.contains('hidden'));
  if (anyVisible && adminSection) {
    adminSection.classList.remove('hidden');
    if (adminDivider) adminDivider.classList.remove('hidden');
  }
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
      if (!el.value) el.value = getDefaultEventTime();
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

  // Hide the in-modal guild selector (only used by content)
  document.getElementById('share-guild-group').classList.add('hidden');

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
  document.getElementById('share-guild-group').classList.add('hidden');
  sharePageType = null;
  shareCapturedImage = null;
}

function getShareGuildId(pageType) {
  if (pageType === 'stats') return document.getElementById('stats-guild').value;
  if (pageType === 'leaderboard') return document.getElementById('lb-guild').value;
  if (pageType === 'content') return document.getElementById('share-guild').value;
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
    } else if (sharePageType === 'content') {
      shareUserName = currentUser ? currentUser.displayName : 'Admin';
      sharePeriod = '';
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

// ═══════════════════════════════════════════════
//  LIVE SCOREBOARD PAGE
// ═══════════════════════════════════════════════

let scoreboardInitialized = false;
let scoreboardAllGames = {};     // { nba: [games], nfl: [...], ... }
let scoreboardActiveSport = 'all';
let scoreboardRefreshTimer = null;

function initScoreboardPage() {
  if (scoreboardInitialized) return;
  scoreboardInitialized = true;

  // Load all games on init
  loadScoreboardGames();

  // Auto-refresh games every 30s
  scoreboardRefreshTimer = setInterval(() => {
    if (document.getElementById('scoreboard-page')?.classList.contains('hidden')) return;
    loadScoreboardGames(true);
  }, 30000);
}

async function loadScoreboardGames(silent = false) {
  const container = document.getElementById('scoreboard-games');
  if (!silent) container.innerHTML = '<p class="empty-state">Loading today\'s games...</p>';

  try {
    const res = await fetch('/api/scoreboard/games', {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    const data = await res.json();
    scoreboardAllGames = data.sports || {};
    renderScoreboardGames();
  } catch (err) {
    console.error('Failed to load scoreboard games:', err);
    if (!silent) container.innerHTML = '<p class="empty-state">Failed to load games. Try refreshing.</p>';
  }
}

function renderScoreboardGames() {
  const container = document.getElementById('scoreboard-games');
  const sport = scoreboardActiveSport;

  // Collect all games, optionally filtered
  let allGames = [];
  for (const [s, games] of Object.entries(scoreboardAllGames)) {
    if (sport !== 'all' && s !== sport) continue;
    for (const g of games) {
      allGames.push({ ...g, sport: s });
    }
  }

  // Sort: live first, then scheduled, then final
  const stateOrder = { in: 0, pre: 1, post: 2 };
  allGames.sort((a, b) => (stateOrder[a.state] ?? 1) - (stateOrder[b.state] ?? 1) || new Date(a.startTime) - new Date(b.startTime));

  if (allGames.length === 0) {
    container.innerHTML = '<p class="no-games-msg">No games scheduled today for this filter.</p>';
    return;
  }

  container.innerHTML = allGames.map(game => {
    const sportEmoji = { nba: '🏀', nfl: '🏈', mlb: '⚾', nhl: '🏒', cfb: '🏈', cbb: '🏀', mma: '🥊', wnba: '🏀' }[game.sport] || '🏅';
    const sportLabel = game.sport?.toUpperCase() || '';

    let statusClass = 'game-status-scheduled';
    let statusText = '';
    if (game.state === 'in') {
      statusClass = 'game-status-live';
      statusText = game.detail || 'LIVE';
    } else if (game.state === 'post') {
      statusClass = 'game-status-final';
      statusText = 'FINAL';
    } else {
      const d = new Date(game.startTime);
      statusText = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';
    }

    const homeWinClass = game.state === 'post' && game.home.score > game.away.score ? ' game-team-winner' : '';
    const awayWinClass = game.state === 'post' && game.away.score > game.home.score ? ' game-team-winner' : '';

    return `
      <div class="game-card" data-sport="${game.sport}">
        <div class="game-card-header">
          <span>${sportEmoji} ${sportLabel}</span>
          <span class="${statusClass}">${statusText}</span>
        </div>
        <div class="game-card-body">
          <div class="game-team-row">
            ${game.away.logo ? `<img class="game-team-logo" src="${game.away.logo}" alt="" onerror="this.style.display='none'">` : ''}
            <span class="game-team-name">${game.away.shortName || game.away.abbreviation}</span>
            <span class="game-team-record">${game.away.record || ''}</span>
            <span class="game-team-score${awayWinClass}">${game.state === 'pre' ? '' : game.away.score}</span>
          </div>
          <div class="game-team-row">
            ${game.home.logo ? `<img class="game-team-logo" src="${game.home.logo}" alt="" onerror="this.style.display='none'">` : ''}
            <span class="game-team-name">${game.home.shortName || game.home.abbreviation}</span>
            <span class="game-team-record">${game.home.record || ''}</span>
            <span class="game-team-score${homeWinClass}">${game.state === 'pre' ? '' : game.home.score}</span>
          </div>
        </div>
        ${game.odds ? `
        <div class="game-card-footer">
          <span style="font-size:11px;color:var(--text-secondary);flex:1">${game.odds.spread || ''} ${game.odds.overUnder ? 'O/U ' + game.odds.overUnder : ''}</span>
        </div>` : ''}
      </div>
    `;
  }).join('');
}

function filterScoreboardSport(sport) {
  scoreboardActiveSport = sport;
  document.querySelectorAll('.score-tab').forEach(t => t.classList.toggle('active', t.dataset.sport === sport));
  renderScoreboardGames();
}

// ── Toggle scoreboard on a bet (called from bet card 📡 button) ──
async function toggleScoreboard(betId) {
  const btn = document.getElementById(`sb-btn-${betId}`);
  if (!btn) return;

  // Check current state
  btn.disabled = true;
  btn.textContent = '⏳';

  try {
    const statusRes = await fetch(`/api/scoreboard/status/${betId}`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    const statusData = await statusRes.json();

    if (statusData.active) {
      // Deactivate
      const res = await fetch(`/api/scoreboard/deactivate/${betId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await res.json();
      if (data.success) {
        showToast('Scoreboard stopped');
        btn.textContent = '📡';
        btn.classList.remove('sb-active');
        btn.title = 'Activate Live Scoreboard';
      } else {
        showToast(data.error || 'Failed to stop scoreboard');
        btn.textContent = '📡';
      }
    } else {
      // Activate
      const res = await fetch(`/api/scoreboard/activate/${betId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await res.json();
      if (data.success) {
        let msg = `Scoreboard live! ${data.game}`;
        if (data.props > 0) msg += ` — Tracking ${data.props} prop(s)`;
        showToast(msg);
        btn.textContent = '🔴';
        btn.classList.add('sb-active');
        btn.title = 'Stop Live Scoreboard';
      } else {
        showToast(data.error || 'Failed to activate scoreboard');
        btn.textContent = '📡';
      }
    }
  } catch (e) {
    console.error('Toggle scoreboard error:', e);
    showToast('Failed to toggle scoreboard');
    btn.textContent = '📡';
  } finally {
    btn.disabled = false;
  }
}

// ══════════════════════════════════════════════
// ────────── PROFILE PAGE ──────────
// ══════════════════════════════════════════════

let profileLoaded = false;

async function loadProfilePage(targetDiscordId) {
  const loading = document.getElementById('profile-loading');
  const content = document.getElementById('profile-content');
  loading.classList.remove('hidden');
  content.classList.add('hidden');
  content.innerHTML = '';

  const guildId = currentUser?.guilds?.[0]?.id;
  if (!guildId) {
    content.innerHTML = '<p class="profile-empty">No server found.</p>';
    loading.classList.add('hidden');
    content.classList.remove('hidden');
    return;
  }

  const discordId = targetDiscordId || currentUser.discordId;

  try {
    const res = await fetch(`/api/guilds/${guildId}/profile/${discordId}`);
    if (!res.ok) throw new Error('Failed to fetch profile');
    const p = await res.json();

    if (p.empty) {
      content.innerHTML = '<p class="profile-empty">No betting history found for this user.</p>';
      loading.classList.add('hidden');
      content.classList.remove('hidden');
      return;
    }

    const avatarUrl = p.avatarProxy || p.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png';
    const unitColor = p.netUnits > 0 ? 'var(--color-win)' : p.netUnits < 0 ? 'var(--color-loss)' : 'var(--text-secondary)';
    const roiColor = p.roi > 0 ? 'var(--color-win)' : p.roi < 0 ? 'var(--color-loss)' : 'var(--text-secondary)';
    const wpColor = p.winPct >= 55 ? 'var(--color-win)' : p.winPct < 45 ? 'var(--color-loss)' : 'var(--text-primary)';

    // Badge pills
    const badgeHtml = (p.badges || []).map(b =>
      `<span class="pf-badge" style="background:${b.color || '#5865f2'}22; color:${b.color || '#5865f2'}; border:1px solid ${b.color || '#5865f2'}44">${b.emoji} ${b.name.replace(/^[^\w\s]+\s*/, '')}</span>`
    ).join('');

    // Streak display
    const streak = p.streak || {};
    const streakIcon = streak.type === 'win' ? '🔥' : streak.type === 'loss' ? '❄️' : '—';
    const streakText = streak.count > 0 ? `${streak.count}${streak.type === 'win' ? 'W' : 'L'}` : 'None';
    const streakColor = streak.type === 'win' ? 'var(--color-win)' : streak.type === 'loss' ? 'var(--color-loss)' : 'var(--text-muted)';

    // Avg odds
    const avgOddsStr = p.avgOdds ? (p.avgOdds > 0 ? `+${p.avgOdds}` : `${p.avgOdds}`) : '—';

    // Best/worst sport
    const best = p.bestSport || { name: '—', winPct: 0, record: '' };
    const worst = p.worstSport || { name: '—', winPct: 0, record: '' };
    const fav = p.favBetType || { name: '—', count: 0 };

    // Top teams
    const topTeams = p.topTeams || [];
    const teamsHtml = topTeams.length > 0
      ? topTeams.map((t, i) => {
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
          const tColor = t.netUnits >= 0 ? 'var(--color-win)' : 'var(--color-loss)';
          return `<div class="pf-row">
            <span class="pf-row-label">${medal} ${t.team}</span>
            <span class="pf-row-value" style="color:${tColor}">${t.record} | ${t.netUnits > 0 ? '+' : ''}${t.netUnits.toFixed(2)}u</span>
          </div>`;
        }).join('')
      : '<div class="pf-row"><span class="pf-row-label pf-muted">Not enough data yet</span></div>';

    // Biggest win
    const bigWin = p.biggestWin;
    const bigWinText = bigWin ? `+${bigWin.payout.toFixed(2)}u` : '—';
    const bigWinPick = bigWin ? (bigWin.pick.length > 28 ? bigWin.pick.substring(0, 26) + '…' : bigWin.pick) : '';

    // Best/worst streaks
    const bestStr = p.bestStreak?.count > 0 ? `${p.bestStreak.count}W` : '—';
    const worstStr = p.worstStreak?.count > 0 ? `${p.worstStreak.count}L` : '—';

    content.innerHTML = `
      <div class="pf-card">
        <!-- Banner -->
        <div class="pf-banner">
          <div class="pf-banner-overlay"></div>
        </div>

        <!-- Avatar + Name -->
        <div class="pf-header">
          <div class="pf-avatar-wrap">
            <img class="pf-avatar" src="${avatarUrl}?_t=${Date.now()}" alt=""
              onerror="this.onerror=null;this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
            <div class="pf-online-dot"></div>
          </div>
          <div class="pf-name-area">
            <h2 class="pf-name">${p.displayName || 'Unknown'}</h2>
            ${p.memberSince ? `<span class="pf-member-since">Member since ${p.memberSince}</span>` : ''}
          </div>
        </div>

        ${badgeHtml ? `<div class="pf-badges">${badgeHtml}</div>` : ''}

        <div class="pf-divider"></div>

        <!-- Stats Grid -->
        <div class="pf-section-title">OVERVIEW</div>
        <div class="pf-stats-grid">
          <div class="pf-stat-box">
            <div class="pf-stat-value">${p.wins}-${p.losses}</div>
            <div class="pf-stat-label">RECORD</div>
          </div>
          <div class="pf-stat-box">
            <div class="pf-stat-value" style="color:${wpColor}">${p.winPct}%</div>
            <div class="pf-stat-label">WIN %</div>
          </div>
          <div class="pf-stat-box">
            <div class="pf-stat-value" style="color:${roiColor}">${p.roi > 0 ? '+' : ''}${p.roi}%</div>
            <div class="pf-stat-label">ROI</div>
          </div>
          <div class="pf-stat-box">
            <div class="pf-stat-value" style="color:${unitColor}">${p.netUnits > 0 ? '+' : ''}${p.netUnits.toFixed(2)}u</div>
            <div class="pf-stat-label">UNITS</div>
          </div>
          <div class="pf-stat-box">
            <div class="pf-stat-value">${p.total}</div>
            <div class="pf-stat-label">TOTAL BETS</div>
          </div>
          <div class="pf-stat-box">
            <div class="pf-stat-value">${avgOddsStr}</div>
            <div class="pf-stat-label">AVG ODDS</div>
          </div>
          <div class="pf-stat-box">
            <div class="pf-stat-value">${p.pushes}</div>
            <div class="pf-stat-label">PUSHES</div>
          </div>
          <div class="pf-stat-box">
            <div class="pf-stat-value" style="color:var(--color-accent)">${p.open}</div>
            <div class="pf-stat-label">OPEN</div>
          </div>
        </div>

        <div class="pf-divider"></div>

        <!-- Performance -->
        <div class="pf-section-title">PERFORMANCE</div>
        <div class="pf-rows">
          <div class="pf-row">
            <span class="pf-row-label">🏆 Best Sport</span>
            <span class="pf-row-value" style="color:var(--color-win)">${best.name} ${best.record} (${best.winPct}%)</span>
          </div>
          <div class="pf-row">
            <span class="pf-row-label">💀 Worst Sport</span>
            <span class="pf-row-value" style="color:var(--color-loss)">${worst.name} ${worst.record} (${worst.winPct}%)</span>
          </div>
          <div class="pf-row">
            <span class="pf-row-label">🎯 Favorite Bet</span>
            <span class="pf-row-value" style="color:var(--color-accent)">${fav.name} (${fav.count} bets)</span>
          </div>
        </div>

        <div class="pf-divider"></div>

        <!-- Top Teams -->
        <div class="pf-section-title">TOP TEAMS</div>
        <div class="pf-rows">${teamsHtml}</div>

        <div class="pf-divider"></div>

        <!-- Highlights -->
        <div class="pf-section-title">HIGHLIGHTS</div>
        <div class="pf-rows">
          <div class="pf-row">
            <span class="pf-row-label">📊 Current Streak</span>
            <span class="pf-row-value" style="color:${streakColor}">${streakIcon} ${streakText}</span>
          </div>
          <div class="pf-row">
            <span class="pf-row-label">🔥 Best Win Streak</span>
            <span class="pf-row-value" style="color:var(--color-win)">${bestStr}</span>
          </div>
          <div class="pf-row">
            <span class="pf-row-label">❄️ Worst Loss Streak</span>
            <span class="pf-row-value" style="color:var(--color-loss)">${worstStr}</span>
          </div>
          <div class="pf-row">
            <span class="pf-row-label">💰 Biggest Win</span>
            <span class="pf-row-value" style="color:var(--color-gold)">${bigWinText}${bigWinPick ? ` <span class="pf-muted">${bigWinPick}</span>` : ''}</span>
          </div>
        </div>

        <!-- Footer -->
        <div class="pf-footer">thegamblingkingapp.com</div>
      </div>
    `;

    loading.classList.add('hidden');
    content.classList.remove('hidden');
    profileLoaded = true;
  } catch (err) {
    console.error('Profile load error:', err);
    content.innerHTML = '<p class="profile-empty">Failed to load profile.</p>';
    loading.classList.add('hidden');
    content.classList.remove('hidden');
  }
}

// View another user's profile (called from leaderboard etc.)
function viewProfile(discordId) {
  switchPage('profile');
  loadProfilePage(discordId);
}

// ═══════════════════════════════════════════════
//  AI Picks Page
// ═══════════════════════════════════════════════

let aiPicksInitialized = false;
let aiPicksData = [];
let aiPicksGuildId = null;
let aiCurrentMonth = null; // null = show all

const SPORT_LABELS = { nba: 'NBA', nfl: 'NFL', mlb: 'MLB', nhl: 'NHL', cfb: 'NCAAF', cbb: 'NCAAB', wnba: 'WNBA', mma: 'MMA' };
const WAGER_LABELS = { moneyline: 'ML', spread: 'Spread', total: 'O/U', player_prop: 'Prop', team_prop: 'Team Prop' };

function initAiPicksPage() {
  if (!currentUser || !currentUser.guilds || currentUser.guilds.length === 0) return;
  aiPicksGuildId = currentUser.guilds[0].id;
  if (aiPicksInitialized) {
    // Refresh data on re-visit
    fetchAiPicks();
    return;
  }
  aiPicksInitialized = true;
  fetchAiPicks();
}

async function fetchAiPicks() {
  if (!aiPicksGuildId) return;
  try {
    const [picksRes, recordRes] = await Promise.all([
      fetch(`/api/guilds/${aiPicksGuildId}/ai-picks`),
      fetch(`/api/guilds/${aiPicksGuildId}/ai-picks/record`),
    ]);
    const picks = await picksRes.json();
    const recordData = await recordRes.json();
    aiPicksData = picks;

    // Render summary
    const r = recordData.record || { wins: 0, losses: 0, pushes: 0 };
    const streak = recordData.streak || 0;
    const totalBets = r.wins + r.losses;
    const units = recordData.fullRecord?.reduce((sum, p) => {
      if (p.status === 'win') {
        const odds = p.odds_american;
        return sum + (odds > 0 ? odds / 100 : 100 / Math.abs(odds));
      }
      if (p.status === 'loss') return sum - 1;
      return sum;
    }, 0) || 0;
    const roi = totalBets > 0 ? ((units / totalBets) * 100).toFixed(1) : '0.0';

    document.getElementById('ai-record').textContent = `${r.wins}-${r.losses}-${r.pushes}`;

    const unitsEl = document.getElementById('ai-units');
    unitsEl.textContent = `${units >= 0 ? '+' : ''}${units.toFixed(1)}u`;
    unitsEl.className = 'ai-summary-value ' + (units >= 0 ? 'positive' : 'negative');

    const streakEl = document.getElementById('ai-streak');
    streakEl.textContent = streak > 0 ? `🔥 ${streak}W` : streak < 0 ? `${Math.abs(streak)}L` : '—';

    document.getElementById('ai-roi').textContent = roi + '%';

    // Build month selector
    buildAiMonthSelector(picks);
    renderAiPicks(picks);
  } catch (err) {
    console.error('AI Picks error:', err);
    document.getElementById('ai-picks-list').innerHTML = '<p class="muted-text">Failed to load picks.</p>';
  }
}

function buildAiMonthSelector(picks) {
  const container = document.getElementById('ai-month-selector');
  const months = new Set();
  picks.forEach(p => {
    const d = new Date(p.pick_date || p.created_at);
    months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  });
  const sorted = [...months].sort().reverse();

  container.innerHTML = '';
  // "All" button
  const allBtn = document.createElement('button');
  allBtn.className = 'ai-month-btn' + (aiCurrentMonth === null ? ' active' : '');
  allBtn.textContent = 'All';
  allBtn.onclick = () => { aiCurrentMonth = null; renderAiPicks(aiPicksData); highlightMonthBtn(container, null); };
  container.appendChild(allBtn);

  sorted.forEach(m => {
    const [y, mo] = m.split('-');
    const label = new Date(y, mo - 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
    const btn = document.createElement('button');
    btn.className = 'ai-month-btn' + (aiCurrentMonth === m ? ' active' : '');
    btn.textContent = label;
    btn.dataset.month = m;
    btn.onclick = () => { aiCurrentMonth = m; renderAiPicks(aiPicksData); highlightMonthBtn(container, m); };
    container.appendChild(btn);
  });
}

function highlightMonthBtn(container, month) {
  container.querySelectorAll('.ai-month-btn').forEach(b => b.classList.remove('active'));
  if (month === null) {
    container.querySelector('.ai-month-btn').classList.add('active');
  } else {
    const btn = container.querySelector(`.ai-month-btn[data-month="${month}"]`);
    if (btn) btn.classList.add('active');
  }
}

function renderAiPicks(picks) {
  const list = document.getElementById('ai-picks-list');
  let filtered = picks;
  if (aiCurrentMonth) {
    const [y, m] = aiCurrentMonth.split('-').map(Number);
    filtered = picks.filter(p => {
      const d = new Date(p.pick_date || p.created_at);
      return d.getFullYear() === y && d.getMonth() + 1 === m;
    });
  }

  if (filtered.length === 0) {
    list.innerHTML = '<p class="muted-text">No picks for this period.</p>';
    return;
  }

  list.innerHTML = filtered.map(p => {
    const d = new Date(p.pick_date || p.created_at);
    const day = d.getDate();
    const month = d.toLocaleString('en-US', { month: 'short' });
    const status = p.status || 'pending';
    const sportLabel = SPORT_LABELS[p.sport] || p.sport?.toUpperCase() || '';
    const wagerLabel = WAGER_LABELS[p.wager_type] || '';
    const oddsStr = p.odds_american > 0 ? `+${p.odds_american}` : `${p.odds_american}`;
    const matchup = (p.team_a && p.team_b) ? `${p.team_a} vs ${p.team_b}` : '';
    const conf = p.confidence ? `${p.confidence}%` : '';

    return `
      <div class="ai-pick-card ${status}">
        <div class="ai-pick-date">
          <div class="ai-pick-date-day">${day}</div>
          <div class="ai-pick-date-month">${month}</div>
        </div>
        <div class="ai-pick-info">
          <div class="ai-pick-title">${esc(p.pick || '—')}</div>
          <div class="ai-pick-meta">
            ${sportLabel ? `<span>🏟️ ${sportLabel}</span>` : ''}
            ${wagerLabel ? `<span>📊 ${wagerLabel}</span>` : ''}
            ${matchup ? `<span>⚔️ ${esc(matchup)}</span>` : ''}
            ${conf ? `<span>🎯 ${conf}</span>` : ''}
            ${p.tail_count ? `<span>🤝 ${p.tail_count} tails</span>` : ''}
          </div>
        </div>
        <div class="ai-pick-odds">${oddsStr}</div>
        <div class="ai-pick-result">
          <span class="ai-pick-result-badge ${status}">${status === 'pending' ? '⏳ PENDING' : status.toUpperCase()}</span>
        </div>
      </div>
    `;
  }).join('');
}

function switchAiTab(tab) {
  document.querySelectorAll('.ai-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.ai-tab[data-aitab="${tab}"]`).classList.add('active');
  document.getElementById('ai-tab-picks').classList.toggle('hidden', tab !== 'picks');
  document.getElementById('ai-tab-leaderboard').classList.toggle('hidden', tab !== 'leaderboard');
  if (tab === 'leaderboard') fetchAiLeaderboard();
}

async function fetchAiLeaderboard() {
  if (!aiPicksGuildId) return;
  const list = document.getElementById('ai-leaderboard-list');
  try {
    const res = await fetch(`/api/guilds/${aiPicksGuildId}/ai-picks/leaderboard`);
    const lb = await res.json();
    if (!lb || lb.length === 0) {
      list.innerHTML = '<p class="muted-text">No tail/fade data yet. Minimum 3 picks required.</p>';
      return;
    }
    list.innerHTML = lb.map((row, i) => {
      const rank = i + 1;
      const rankDisplay = rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : rank;
      const pct = row.total > 0 ? ((row.correct / row.total) * 100).toFixed(0) : 0;
      return `
        <div class="ai-lb-row">
          <div class="ai-lb-rank">${rankDisplay}</div>
          <div class="ai-lb-name">${esc(row.username)}</div>
          <div class="ai-lb-stat">${row.total} picks</div>
          <div class="ai-lb-stat correct">${pct}% correct</div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('AI leaderboard error:', err);
    list.innerHTML = '<p class="muted-text">Failed to load leaderboard.</p>';
  }
}

// ═══════════════════════════════════════════════
//  AI Top-Tab Switching (Daily Lock / MLB tabs)
// ═══════════════════════════════════════════════

const MLB_MARKET_LABELS = { nrfi: 'NRFI', homerun: 'Home Runs', strikeout: 'Strikeouts' };
const MLB_MARKET_COLORS = { nrfi: '#3fb950', homerun: '#a855f7', strikeout: '#f85149' };
let currentAiTopTab = 'daily-lock';

function switchAiTopTab(tab) {
  currentAiTopTab = tab;
  document.querySelectorAll('.ai-top-tabs .ai-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.ai-top-tabs .ai-tab[data-aitoptab="${tab}"]`).classList.add('active');

  // Hide all sections
  document.querySelectorAll('.ai-top-section').forEach(s => s.classList.add('hidden'));

  if (tab === 'daily-lock') {
    document.getElementById('ai-section-daily-lock').classList.remove('hidden');
  } else {
    document.getElementById(`ai-section-${tab}`).classList.remove('hidden');
    // Set date to today if not set
    const dateInput = document.getElementById(`mlb-date-${tab}`);
    if (!dateInput.value) {
      dateInput.value = getTodayEST();
    }
    loadMlbAnalysis(tab);
  }
}

function getTodayEST() {
  const now = new Date();
  const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return est.getFullYear() + '-' + String(est.getMonth() + 1).padStart(2, '0') + '-' + String(est.getDate()).padStart(2, '0');
}

function mlbDateNav(market, delta) {
  const dateInput = document.getElementById(`mlb-date-${market}`);
  const d = new Date(dateInput.value + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  dateInput.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  loadMlbAnalysis(market);
}

function mlbDateToday(market) {
  document.getElementById(`mlb-date-${market}`).value = getTodayEST();
  loadMlbAnalysis(market);
}

async function loadMlbAnalysis(market) {
  if (!aiPicksGuildId) return;
  const date = document.getElementById(`mlb-date-${market}`).value;
  if (!date) return;

  const entriesEl = document.getElementById(`mlb-entries-${market}`);
  const recordEl = document.getElementById(`mlb-record-${market}`);
  entriesEl.innerHTML = '<p class="muted-text">Loading...</p>';

  try {
    const res = await fetch(`/api/guilds/${aiPicksGuildId}/mlb-analysis?date=${date}&market_type=${market}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');

    const { entries, record, todayRecord, streak } = data;
    const color = MLB_MARKET_COLORS[market];

    // Render record bar
    const streakStr = streak > 0 ? `🔥 ${streak}W` : streak < 0 ? `${Math.abs(streak)}L` : '—';
    recordEl.innerHTML = `
      <div class="mlb-record-pills">
        <span class="mlb-pill" style="border-color: ${color}">
          Season: <strong>${record.hits}-${record.misses}-${record.pushes}</strong>
        </span>
        <span class="mlb-pill" style="border-color: ${color}">
          Today: <strong>${todayRecord.hits}-${todayRecord.misses}-${todayRecord.pushes}</strong>
        </span>
        <span class="mlb-pill" style="border-color: ${color}">
          Streak: <strong>${streakStr}</strong>
        </span>
      </div>
    `;

    if (!entries || entries.length === 0) {
      entriesEl.innerHTML = '<p class="muted-text">No analysis for this date.</p>';
      return;
    }

    entriesEl.innerHTML = entries.map(e => renderMlbEntry(e, market)).join('');
  } catch (err) {
    console.error(`MLB analysis (${market}) error:`, err);
    entriesEl.innerHTML = '<p class="muted-text">Failed to load analysis.</p>';
  }
}

function renderMlbEntry(e, market) {
  const color = MLB_MARKET_COLORS[market];
  const statusIcon = e.status === 'hit' ? '✅' : e.status === 'miss' ? '❌' : e.status === 'push' ? '🟡' : e.status === 'postponed' ? '🚫' : '⏳';
  const statusClass = e.status === 'hit' ? 'hit' : e.status === 'miss' ? 'miss' : e.status === 'push' ? 'push' : 'pending';

  // Format game time
  let gameTime = '';
  if (e.event_start_time) {
    try {
      const dt = new Date(e.event_start_time);
      gameTime = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
    } catch { gameTime = e.event_start_time; }
  }

  // Build suggestion pill based on market
  let suggestionPill = '';
  if (market === 'nrfi') {
    const pillColor = e.suggestion === 'NRFI' ? '#3fb950' : '#f85149';
    suggestionPill = `<span class="mlb-suggestion-pill" style="background: ${pillColor}20; color: ${pillColor}; border: 1px solid ${pillColor}40">${esc(e.suggestion)}</span>`;
  } else if (market === 'strikeout') {
    const pillColor = '#f85149';
    suggestionPill = `<span class="mlb-suggestion-pill" style="background: ${pillColor}20; color: ${pillColor}; border: 1px solid ${pillColor}40">${esc(e.suggestion)}${e.line ? ' ' + e.line : ''}</span>`;
  } else if (market === 'homerun') {
    const pillColor = '#a855f7';
    suggestionPill = `<span class="mlb-suggestion-pill" style="background: ${pillColor}20; color: ${pillColor}; border: 1px solid ${pillColor}40">${esc(e.suggestion)}</span>`;
  }

  // Confidence bar
  const confColor = e.confidence >= 75 ? '#3fb950' : e.confidence >= 55 ? '#FFD700' : '#f85149';

  return `
    <div class="mlb-entry-card ${statusClass}" style="border-left-color: ${color}">
      <div class="mlb-entry-top">
        <div class="mlb-matchup">
          <span class="mlb-team away">${esc(e.away_abbr || e.away_team)}</span>
          <span class="mlb-vs">@</span>
          <span class="mlb-team home">${esc(e.home_abbr || e.home_team)}</span>
          ${gameTime ? `<span class="mlb-game-time">${gameTime}</span>` : ''}
        </div>
        <div class="mlb-entry-status">
          <span class="mlb-status-icon">${statusIcon}</span>
          ${e.actual_result ? `<span class="mlb-actual-result">${esc(e.actual_result)}</span>` : ''}
        </div>
      </div>
      <div class="mlb-entry-body">
        <div class="mlb-suggestion-row">
          ${suggestionPill}
          ${e.odds ? `<span class="mlb-odds">${esc(e.odds)}</span>` : ''}
          <span class="mlb-confidence" style="color: ${confColor}">${e.confidence}%</span>
        </div>
        ${e.reasoning ? `<div class="mlb-reasoning">${esc(e.reasoning)}</div>` : ''}
        <div class="mlb-pitchers">
          ${e.away_pitcher ? `<span>⚾ ${esc(e.away_pitcher)}</span>` : ''}
          ${e.home_pitcher ? `<span>vs ${esc(e.home_pitcher)}</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════
//  Golf Admin (Screenshot → GPT-4o → Discord)
// ═══════════════════════════════════════════════

let golfAdminInitialized = false;
let golfScreenshots = []; // { file, dataUrl }
let golfAnalyzedPicks = null;
let golfSelectedPicks = new Set(); // indices of selected picks
let golfHistoryLoaded = false;

function initGolfAdminPage() {
  if (golfAdminInitialized) return;
  golfAdminInitialized = true;

  const fileInput = document.getElementById('golf-file-input');
  fileInput.addEventListener('change', golfHandleFiles);

  // Drag and drop
  const zone = document.getElementById('golf-upload-zone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length) golfAddFiles(files);
  });
}

function golfSwitchTab(tab) {
  document.querySelectorAll('.golf-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('golf-tab-analyze').classList.toggle('hidden', tab !== 'analyze');
  document.getElementById('golf-tab-history').classList.toggle('hidden', tab !== 'history');
  if (tab === 'history' && !golfHistoryLoaded) {
    golfHistoryLoaded = true;
    golfLoadTournaments();
  }
}

function golfCompressImage(file) {
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
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read image'));
      reader.readAsDataURL(file);
    };
    img.src = url;
  });
}

async function golfHandleFiles(e) {
  const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
  if (files.length) await golfAddFiles(files);
  e.target.value = '';
}

async function golfAddFiles(files) {
  const remaining = 10 - golfScreenshots.length;
  const toAdd = files.slice(0, remaining);
  if (toAdd.length === 0) {
    showToast('Maximum 10 screenshots allowed.', 3000);
    return;
  }
  for (const file of toAdd) {
    const dataUrl = await golfCompressImage(file);
    golfScreenshots.push({ file, dataUrl });
  }
  golfRenderPreviews();
}

function golfRenderPreviews() {
  const container = document.getElementById('golf-previews');
  const prompt = document.getElementById('golf-upload-prompt');
  const actions = document.getElementById('golf-upload-actions');
  const analyzeBtn = document.getElementById('golf-analyze-btn');
  const countEl = document.getElementById('golf-file-count');

  container.innerHTML = golfScreenshots.map((s, i) => `
    <div class="golf-preview-thumb">
      <img src="${s.dataUrl}" alt="Screenshot ${i + 1}">
      <button class="golf-preview-remove" onclick="golfRemoveScreenshot(${i})">✕</button>
    </div>
  `).join('');

  if (golfScreenshots.length > 0) {
    prompt.style.display = 'none';
    actions.style.display = 'flex';
    analyzeBtn.disabled = false;
    countEl.textContent = `${golfScreenshots.length} file${golfScreenshots.length > 1 ? 's' : ''}`;
  } else {
    prompt.style.display = '';
    actions.style.display = 'none';
    analyzeBtn.disabled = true;
  }
}

function golfRemoveScreenshot(idx) {
  golfScreenshots.splice(idx, 1);
  golfRenderPreviews();
}

function golfClearScreenshots() {
  golfScreenshots = [];
  golfRenderPreviews();
}

async function golfAnalyzeScreenshots() {
  const tournament = document.getElementById('golf-admin-tournament').value.trim();
  const round = document.getElementById('golf-admin-round').value;

  if (!tournament) {
    showToast('Enter a tournament name first.', 3000);
    document.getElementById('golf-admin-tournament').focus();
    return;
  }
  if (golfScreenshots.length === 0) {
    showToast('Upload at least one screenshot.', 3000);
    return;
  }

  const analyzeBtn = document.getElementById('golf-analyze-btn');
  const status = document.getElementById('golf-analyze-status');
  analyzeBtn.disabled = true;
  status.classList.remove('hidden');

  try {
    const res = await fetch('/api/golf/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        images: golfScreenshots.map(s => s.dataUrl),
        tournament,
        round,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Analysis failed');
    }

    golfAnalyzedPicks = { picks: data.picks, tournament, round };
    // Select all by default
    golfSelectedPicks = new Set(data.picks.map((_, i) => i));
    golfRenderPicks(data.picks);
    golfUpdateSelectedCount();

    // Switch to review step
    document.getElementById('golf-step-upload').classList.add('hidden');
    document.getElementById('golf-step-review').classList.remove('hidden');

    showToast(`\u2705 ${data.picks.length} picks analyzed!`, 3000);
  } catch (err) {
    console.error('Golf analyze error:', err);
    showToast(`\u274c ${err.message}`, 5000);
    analyzeBtn.disabled = false;
  } finally {
    status.classList.add('hidden');
  }
}

function golfRenderPicks(picks) {
  const list = document.getElementById('golf-picks-list');
  list.innerHTML = picks.map((p, i) => {
    const isOver = (p.pick_side || '').toLowerCase().startsWith('over');
    const sideClass = isOver ? 'over' : 'under';
    const oddsStr = p.odds_american > 0 ? `+${p.odds_american}` : String(p.odds_american);
    const selected = golfSelectedPicks.has(i);
    return `
      <div class="golf-pick-card ${selected ? '' : 'deselected'}" onclick="golfTogglePick(${i})" data-pick-idx="${i}">
        <div class="golf-pick-checkbox">${selected ? '✓' : ''}</div>
        <div class="golf-pick-header">
          <span class="golf-pick-rank">${i + 1}</span>
          <span class="golf-pick-player">${esc(p.player_name)}</span>
          <span class="golf-pick-side ${sideClass}">${esc(p.pick_side)}</span>
        </div>
        <div class="golf-pick-meta">
          <span class="golf-line">Line: ${p.line}</span>
          <span class="golf-odds">Odds: ${oddsStr}</span>
        </div>
        <div class="golf-pick-confidence">
          <label>Confidence</label>
          <div class="golf-conf-bar"><div class="golf-conf-fill" style="width:${p.confidence}%"></div></div>
          <span class="golf-conf-pct">${p.confidence}%</span>
        </div>
        <div class="golf-pick-reasoning">${esc(p.reasoning)}</div>
      </div>
    `;
  }).join('');
}

function golfTogglePick(idx) {
  if (golfSelectedPicks.has(idx)) {
    golfSelectedPicks.delete(idx);
  } else {
    golfSelectedPicks.add(idx);
  }
  const card = document.querySelector(`.golf-pick-card[data-pick-idx="${idx}"]`);
  if (card) {
    card.classList.toggle('deselected', !golfSelectedPicks.has(idx));
    card.querySelector('.golf-pick-checkbox').textContent = golfSelectedPicks.has(idx) ? '✓' : '';
  }
  golfUpdateSelectedCount();
}

function golfSelectAll() {
  if (!golfAnalyzedPicks) return;
  golfSelectedPicks = new Set(golfAnalyzedPicks.picks.map((_, i) => i));
  document.querySelectorAll('.golf-pick-card').forEach(c => {
    c.classList.remove('deselected');
    c.querySelector('.golf-pick-checkbox').textContent = '✓';
  });
  golfUpdateSelectedCount();
}

function golfDeselectAll() {
  golfSelectedPicks.clear();
  document.querySelectorAll('.golf-pick-card').forEach(c => {
    c.classList.add('deselected');
    c.querySelector('.golf-pick-checkbox').textContent = '';
  });
  golfUpdateSelectedCount();
}

function golfUpdateSelectedCount() {
  const count = golfSelectedPicks.size;
  document.getElementById('golf-selected-count').textContent = count;
  document.getElementById('golf-post-btn').disabled = count === 0;
}

function golfBackToUpload() {
  document.getElementById('golf-step-review').classList.add('hidden');
  document.getElementById('golf-step-upload').classList.remove('hidden');
  document.getElementById('golf-analyze-btn').disabled = false;
}

async function golfPostToDiscord() {
  if (!golfAnalyzedPicks || golfSelectedPicks.size === 0) return;

  const selectedPicks = golfAnalyzedPicks.picks.filter((_, i) => golfSelectedPicks.has(i));

  const postBtn = document.getElementById('golf-post-btn');
  const status = document.getElementById('golf-post-status');
  postBtn.disabled = true;
  status.classList.remove('hidden');

  try {
    const res = await fetch('/api/golf/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        picks: selectedPicks,
        tournament: golfAnalyzedPicks.tournament,
        round: golfAnalyzedPicks.round,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to post');
    }

    document.getElementById('golf-step-review').classList.add('hidden');
    document.getElementById('golf-step-done').classList.remove('hidden');
    document.getElementById('golf-done-msg').innerHTML = `
      <p>\u2705 <strong>${data.posted.length} picks</strong> posted to the Golf channel!</p>
      <p style="color:var(--text-muted);font-size:13px;margin-top:8px">Tournament: ${esc(golfAnalyzedPicks.tournament)} \u2022 ${esc(golfAnalyzedPicks.round)}</p>
    `;

    // Refresh history if it was loaded
    golfHistoryLoaded = false;

    showToast(`\u26f3 ${data.posted.length} golf picks posted to Discord!`, 5000);
  } catch (err) {
    console.error('Golf post error:', err);
    showToast(`\u274c ${err.message}`, 5000);
    postBtn.disabled = false;
  } finally {
    status.classList.add('hidden');
  }
}

function golfReset() {
  golfScreenshots = [];
  golfAnalyzedPicks = null;
  golfSelectedPicks.clear();
  golfRenderPreviews();
  document.getElementById('golf-admin-tournament').value = '';
  document.getElementById('golf-admin-round').value = 'Round 1';
  document.getElementById('golf-analyze-btn').disabled = true;
  document.getElementById('golf-post-btn').disabled = true;
  document.getElementById('golf-step-done').classList.add('hidden');
  document.getElementById('golf-step-review').classList.add('hidden');
  document.getElementById('golf-step-upload').classList.remove('hidden');
}

// ── Golf History ──
async function golfLoadTournaments() {
  try {
    const res = await fetch('/api/golf/history');
    const data = await res.json();
    if (!data.success) return;
    const sel = document.getElementById('golf-hist-tournament');
    const tournaments = [...new Set(data.picks.map(p => p.tournament_name).filter(Boolean))];
    sel.innerHTML = '<option value="">All Tournaments</option>' +
      tournaments.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    // Cache the data for filtering
    window._golfHistoryData = data.picks;
    golfRenderHistory(data.picks);
  } catch (e) {
    console.error('Golf history error:', e);
  }
}

function golfLoadHistory() {
  const picks = window._golfHistoryData || [];
  const tournament = document.getElementById('golf-hist-tournament').value;
  const round = document.getElementById('golf-hist-round').value;
  const status = document.getElementById('golf-hist-status').value;

  let filtered = picks;
  if (tournament) filtered = filtered.filter(p => p.tournament_name === tournament);
  if (round) filtered = filtered.filter(p => p.round_number === parseInt(round));
  if (status) filtered = filtered.filter(p => p.status === status);
  golfRenderHistory(filtered);
}

function golfRenderHistory(picks) {
  // Summary
  const wins = picks.filter(p => p.status === 'win').length;
  const losses = picks.filter(p => p.status === 'loss').length;
  const pushes = picks.filter(p => p.status === 'push').length;
  const pending = picks.filter(p => p.status === 'pending').length;
  const total = wins + losses;
  const pct = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';

  document.getElementById('golf-history-summary').innerHTML = `
    <div class="golf-hist-stat wins"><span class="golf-hist-stat-val">${wins}</span><span class="golf-hist-stat-label">Hits</span></div>
    <div class="golf-hist-stat losses"><span class="golf-hist-stat-val">${losses}</span><span class="golf-hist-stat-label">Misses</span></div>
    <div class="golf-hist-stat"><span class="golf-hist-stat-val">${pushes}</span><span class="golf-hist-stat-label">Pushes</span></div>
    <div class="golf-hist-stat"><span class="golf-hist-stat-val">${pending}</span><span class="golf-hist-stat-label">Pending</span></div>
    <div class="golf-hist-stat"><span class="golf-hist-stat-val">${pct}%</span><span class="golf-hist-stat-label">Hit Rate</span></div>
  `;

  // List
  const list = document.getElementById('golf-history-list');
  if (picks.length === 0) {
    list.innerHTML = '<p class="golf-history-empty">No picks found for this filter.</p>';
    return;
  }

  const statusIcons = { win: '✅', loss: '❌', push: '➖', pending: '⏳' };
  list.innerHTML = picks.map(p => {
    const date = p.pick_date ? new Date(p.pick_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    return `
      <div class="golf-hist-row">
        <div class="golf-hist-status ${p.status}">${statusIcons[p.status] || '?'}</div>
        <span class="golf-hist-pick">${esc(p.pick)}</span>
        <span class="golf-hist-tournament">${esc(p.tournament_name || '')} R${p.round_number || '?'}</span>
        <span class="golf-hist-date">${date}</span>
      </div>
    `;
  }).join('');
}

// ═══════════════════════════════════════════════
//  Content Studio
// ═══════════════════════════════════════════════

let csImageData = null; // base64 upload
let csResultImage = null; // generated image base64

// File upload handling
document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('cs-file-input');
  if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      csImageData = await compressImageForOCR(file);
      document.getElementById('cs-upload-prompt').classList.add('hidden');
      const preview = document.getElementById('cs-preview');
      preview.classList.remove('hidden');
      document.getElementById('cs-preview-img').src = csImageData;
    });
  }
});

function csClearImage() {
  csImageData = null;
  document.getElementById('cs-file-input').value = '';
  document.getElementById('cs-upload-prompt').classList.remove('hidden');
  document.getElementById('cs-preview').classList.add('hidden');
}

async function csGenerate() {
  const prompt = document.getElementById('cs-prompt').value.trim();
  if (!prompt && !csImageData) {
    document.getElementById('cs-error').textContent = 'Enter a prompt or upload a screenshot.';
    document.getElementById('cs-error').classList.remove('hidden');
    return;
  }

  document.getElementById('cs-error').classList.add('hidden');
  document.getElementById('cs-result').classList.add('hidden');
  document.getElementById('cs-status').classList.remove('hidden');
  document.getElementById('cs-generate-btn').disabled = true;

  try {
    const body = {};
    if (prompt) body.prompt = prompt;
    if (csImageData) body.imageData = csImageData;

    const res = await fetch('/api/content-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Generation failed');

    csResultImage = data.imageData;
    document.getElementById('cs-result-img').src = csResultImage;
    document.getElementById('cs-result').classList.remove('hidden');
  } catch (err) {
    document.getElementById('cs-error').textContent = err.message;
    document.getElementById('cs-error').classList.remove('hidden');
  } finally {
    document.getElementById('cs-status').classList.add('hidden');
    document.getElementById('cs-generate-btn').disabled = false;
  }
}

function csRegenerate() {
  csGenerate();
}

function csDownload() {
  if (!csResultImage) return;
  const a = document.createElement('a');
  a.href = csResultImage;
  a.download = `content-${Date.now()}.png`;
  a.click();
}

function csShareToDiscord() {
  if (!csResultImage) return;
  sharePageType = 'content';
  shareCapturedImage = csResultImage;

  // Show the modal
  const modal = document.getElementById('share-modal');
  const previewImg = document.getElementById('share-preview-img');
  const previewLoading = document.getElementById('share-preview-loading');
  const desc = document.getElementById('share-modal-desc');
  desc.textContent = 'Post this Content Studio image to a Discord channel';

  // Show guild selector for content (no page-level guild select)
  const guildGroup = document.getElementById('share-guild-group');
  const guildSel = document.getElementById('share-guild');
  guildGroup.classList.remove('hidden');
  guildSel.innerHTML = '<option value="" disabled selected>Select server</option>';
  if (currentUser && currentUser.guilds) {
    currentUser.guilds.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = g.name;
      guildSel.appendChild(opt);
    });
    if (currentUser.guilds.length === 1) {
      guildSel.value = currentUser.guilds[0].id;
      onShareGuildChange();
    }
  }

  // Show image preview directly (already have it)
  previewImg.src = csResultImage;
  previewImg.classList.remove('hidden');
  previewLoading.classList.add('hidden');
  document.getElementById('share-send-btn').disabled = false;

  modal.classList.remove('hidden');
}

function onShareGuildChange() {
  const guildId = document.getElementById('share-guild').value;
  if (!guildId) return;
  const channelSelect = document.getElementById('share-channel');
  loadShareChannels(guildId, channelSelect);
}
