# TheGamblingKing — TODO

---

## Priority List

| # | Feature | Status |
|---|---------|--------|
| 1 | Public landing page (no login required) | Not started |
| 2 | Public leaderboard page (shareable, read-only) | Not started |
| 3 | Sharp/Capper tool (odds API integration) | Not started — options below |
| 4 | Discord analytics / lurker detection | Not started — spec below |
| 5 | Live scoreboard & player prop tracker | **BUILT but DISABLED** — see note below |

---

## #3 — Sharp/Capper Tool

### Development Approach (pick one)
- **Option A (recommended): Git feature branch** — Work on `feature/sharp-tools` branch. Nothing touches `main` or production until merge. Zero risk.
- **Option B: Hidden page on live site** — Build on `main` behind a hidden route (`/tools/sharp`), not linked in nav. Faster to test live but slightly riskier.

### API Options (pick one)
- **The Odds API** — 500 free requests/month, covers odds from 40+ bookmakers (DraftKings, FanDuel, BetMGM, etc). Best for odds comparison/line shopping. https://the-odds-api.com
- **API-Sports** — 100 free requests/day (~3,000/month), broader data (stats, scores, standings + odds). Better if you want stats alongside odds. https://api-sports.io

### Feature Options (pick what to build first)
1. **Line shopping / odds comparison** — Show best odds across books for each game. "DraftKings has +150, FanDuel has +140" etc.
2. **Line movement tracker** — Snapshot odds throughout the day, show how lines move over time (opening → current). Sharp money indicator.
3. **Value finder** — Compare implied probability vs model/consensus. Flag +EV bets.
4. **All of the above** — Build incrementally: odds comparison first → add movement tracking → add value analysis.

### Sports Coverage (pick scope)
- Start with 1-2 sports (NBA + NFL/MLB depending on season)
- Or cover all sports the site currently supports

### Architecture (planned)
- Background cron fetches odds → stores in Supabase (no API calls during user requests)
- Frontend reads from cached Supabase data → zero performance impact
- New page in the web app with its own nav tab

---

## #4 — Discord Analytics Dashboard

## Overview
Build a comprehensive Discord engagement analytics dashboard (owner-only, locked to Discord ID `1338301556973633577`). Two views: **Macro** (server-wide overview) and **Micro** (per-user deep dive). Key feature: **lurker pattern detection** — correlating when users come online vs when picks are posted.

---

## Data Collection (Discord.js Events)

| Event | What We Log | Why |
|-------|------------|-----|
| `messageCreate` | user, channel, timestamp | Core activity metric |
| `presenceUpdate` | user, old status → new status, timestamp | See when lurkers come online |
| `messageReactionAdd` | user, channel, emoji, message author, timestamp | Catch lurkers who react but don't talk |
| `interactionCreate` | user, command name, timestamp | Bot command usage |
| `guildMemberAdd` / `Remove` | user, timestamp | Track server growth/churn |

**NOT tracking:** message content (privacy), voice, DMs

---

## Database Schema (2 new Supabase tables)

### Table: `discord_events` (raw micro data)

```sql
CREATE TABLE IF NOT EXISTS discord_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  guild_id TEXT NOT NULL,
  discord_id TEXT NOT NULL,
  discord_username TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('message', 'presence_online', 'presence_offline', 'reaction', 'command', 'member_join', 'member_leave')),
  channel_id TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discord_events_guild_user
  ON discord_events (guild_id, discord_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_discord_events_type
  ON discord_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_discord_events_created
  ON discord_events (created_at);
```

### Table: `discord_daily_stats` (pre-aggregated macro data)

```sql
CREATE TABLE IF NOT EXISTS discord_daily_stats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  guild_id TEXT NOT NULL,
  discord_id TEXT NOT NULL,
  discord_username TEXT,
  stat_date DATE NOT NULL,
  messages_sent INT DEFAULT 0,
  reactions_given INT DEFAULT 0,
  commands_used INT DEFAULT 0,
  online_sessions INT DEFAULT 0,
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  channels_active JSONB DEFAULT '[]',
  UNIQUE(guild_id, discord_id, stat_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_stats_lookup
  ON discord_daily_stats (guild_id, stat_date DESC);
```

---

## Dashboard UI

### Macro View (default landing)

- Server overview stats: Active / Lurkers / Ghosts / Total members
- Date range filter: Today, This Week, This Month, Custom
- Sortable table with columns:
  - User (avatar + name)
  - Messages sent
  - Reactions given
  - Commands used
  - Last active
  - Tag (Active / Lurker / Ghost — auto-calculated)
- Search by username
- Click any row → opens Micro View

**Labels:**
- **Active** = has posted messages
- **Lurker** = comes online / reacts but doesn't post
- **Ghost** = hasn't been seen in 3+ days

### Micro View (click a user)

- Back button to return to macro
- User header: avatar, name, join date, roles
- Activity summary: total messages, reactions, avg online sessions/day, most active time of day, favorite channels
- Activity timeline (last 7 days): chronological feed showing online/offline, messages, reactions, with timestamps
- **Lurker Pattern Detection:**
  - Cross-reference `presenceUpdate` (user came online) with `bets` table (pick was posted)
  - Flag: "Came online within 10 min of pick post: X/Y times"
  - Show avg time between pick post → user online
  - Highlight users who ONLY come online when picks drop

---

## Implementation Steps

| Step | What | Details |
|------|------|---------|
| 1 | **Create Supabase tables** | Run the SQL above in Supabase SQL editor |
| 2 | **Check/enable Presence Intent** | Discord Developer Portal → Bot → Privileged Intents → Presence Intent ON |
| 3 | **Add event listeners in index.js** | Listen for messageCreate, presenceUpdate, messageReactionAdd, interactionCreate, guildMemberAdd, guildMemberRemove. Log to `discord_events` table. Use batch inserts (buffer events, flush every 30 sec) to minimize API calls |
| 4 | **Add daily aggregation cron** | Runs at midnight, summarizes raw events into `discord_daily_stats`. Use node-cron or setInterval |
| 5 | **Add auto-cleanup** | Delete `discord_events` older than 90 days (daily cron) |
| 6 | **Add API endpoints** | `GET /api/analytics/discord` (macro), `GET /api/analytics/discord/:userId` (micro), `GET /api/analytics/discord/:userId/lurker-patterns` — all owner-only |
| 7 | **Build macro dashboard UI** | New tab within existing Analytics page. Table, filters, search, sort |
| 8 | **Build micro user detail UI** | Expandable/modal view. Timeline, stats, channel breakdown |
| 9 | **Build lurker pattern detection** | Query bets table for pick timestamps, cross-reference with presence events, calculate correlation scores |
| 10 | **Deploy** | git push → SSH pull → pm2 restart |

---

## Security

- Same owner-only lock as web analytics (Discord ID `1338301556973633577`)
- No message content stored
- Raw event data never exposed to other users
- All endpoints behind authMiddleware + owner ID check

## Cost / Supabase Free Tier

- Estimated 5,000-15,000 rows/month in discord_events
- ~3 MB/month of data, ~10 MB max with 90-day retention
- API requests well under 500K/month free limit
- Batch inserts reduce API call count further
- **No cost — stays within free tier**

---

## Prerequisites Before Building

1. Check if Presence Intent is enabled in Discord Developer Portal
2. Have Supabase SQL editor open to run table creation
3. That's it — everything else is code changes

---

## SSH / Deploy Info

```
SSH: ssh -i "C:\Users\toset\gk-bot-key.pem" ec2-user@100.48.25.36
Deploy: git add -A && git commit -m "msg" && git push
        then SSH: cd DiscordBot && git pull && pm2 restart gk-bot
Supabase SQL: https://supabase.com/dashboard/project/fjtqeazctzewzdfvfhxg/sql/new
```

---

## #5 — Live Scoreboard & Player Prop Tracker

> **STATUS: BUILT but DISABLED**
> Feature is fully coded but disabled pending further testing/refinement for parlays and player props.
>
> **Dormant code locations (search for `[SCOREBOARD DISABLED]`):**
> - `src/index.js` — Background poller (lines ~100-197) commented out
> - `src/web/server.js` — Placeholder posting on bet creation (~lines 2596, 2687) commented out
> - `src/web/server.js` — Activate/deactivate/status endpoints (~lines 2739-2900) still exist but unused
> - `src/web/public/app.js` — 📡 button on bet cards (~line 2547) disabled
> - `src/web/public/index.html` — Sidebar link (~line 84) commented out
>
> **Files that exist but are dormant (fully intact, no changes needed to re-enable):**
> - `src/services/espn.js` — ESPN API integration (scores, summaries, team matching)
> - `src/utils/scoreboardImage.js` — Canvas image generator (score bug style)
> - `src/database/scoreboards.js` — Supabase queries for live_scoreboards table
>
> **DB objects (exist but unused):**
> - `live_scoreboards` table in Supabase
> - `mirror_scoreboard_msg_id` column on `bets` table
>
> **To re-enable:** Search codebase for `[SCOREBOARD DISABLED]` — each comment has instructions.

### Overview
Post a live-updating Discord embed for any game. Automatically matches games from open bets. Shows live score, game clock, and real-time progress on player prop bets. Embed updates in-place every 60 seconds during games.

---

### Data Source — ESPN Unofficial API (Free)

All sports use the same endpoint pattern:
```
https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard
```

**Sport-to-path mapping:**
| Our Sport Value | ESPN Path | League |
|----------------|-----------|--------|
| `nba` | `basketball/nba` | NBA |
| `nfl` | `football/nfl` | NFL |
| `mlb` | `baseball/mlb` | MLB |
| `nhl` | `hockey/nhl` | NHL |
| `ncaa_football` | `football/college-football` | NCAAF |
| `ncaa_mbb` | `basketball/mens-college-basketball` | NCAAM |
| `ncaa_wbb` | `basketball/womens-college-basketball` | NCAAW |
| `wnba` | `basketball/wnba` | WNBA |
| `mls` | `soccer/usa.1` | MLS |
| `epl` | `soccer/eng.1` | EPL |
| `la_liga` | `soccer/esp.1` | La Liga |
| `ucl` | `soccer/uefa.champions` | UCL |
| `ufc` | `mma/ufc` | UFC |

**Box score / player stats endpoint:**
```
https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/summary?event={gameId}
```
Returns full box score with individual player stats (points, rebounds, assists, etc.) for tracking player props.

**Response structure (consistent across sports):**
- `events[].id` — unique game ID
- `events[].competitions[].competitors[]` — teams, scores
- `events[].status` — game clock, period, state (pre/in/post)
- Summary endpoint: `boxscore.players[].statistics[]` — per-player stats

---

### Game Selection — Two Modes

#### Mode A: Auto-track from open bets (primary)
1. When a user clicks **"Go Live 📡"** on a bet card (web app) or runs `/scoreboard` (Discord slash command)
2. Server looks up open bets for that user → extracts team names + sport
3. Calls ESPN scoreboard API for that sport → fuzzy-matches team names to find today's game
4. Creates a scoreboard entry + posts embed to the selected channel
5. No manual game selection needed — bets already contain everything

#### Mode B: Manual game picker (fallback)
1. New section on web app: "Today's Games" (accessible from bet page)
2. Pulls today's schedule from ESPN scoreboard endpoint for all active sports
3. Shows games grouped by sport with start times
4. User clicks a game → selects channel → bot posts embed
5. Useful when tracking a game you don't have a bet on

---

### Discord Embed Format

```
┌──────────────────────────────────────┐
│ 🏀 NBA — LIVE Q3 4:32               │
│━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
│                                      │
│  🏠 NYK Knicks         87            │
│  🏃 MIL Bucks          82            │
│                                      │
│━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
│ 📊 Your Props                        │
│                                      │
│ ✅ J. Brunson    22 pts  (O 20.5)    │
│ 🔥 J. Randle     8 reb  (O 10.5)    │
│ ⏳ D. Lillard   15 pts  (O 25.5)    │
│                                      │
│━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
│ 🔄 Updates every 60s │ !stop to end  │
└──────────────────────────────────────┘
```

**Prop status icons:**
- ✅ = already hit (stat >= line)
- 🔥 = close / on pace (within 20% of line)
- ⏳ = still tracking (under line, game in progress)
- ❌ = missed (game over, didn't hit)

**Embed color:**
- 🟢 Green = all props hitting
- 🟡 Yellow = mixed
- 🔴 Red = most props behind
- ⚪ Gray = pre-game

---

### Database Schema

#### Table: `live_scoreboards`

```sql
CREATE TABLE IF NOT EXISTS live_scoreboards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,                    -- Discord message ID (for editing)
  discord_id TEXT NOT NULL,            -- User who started it
  sport TEXT NOT NULL,
  espn_game_id TEXT NOT NULL,          -- ESPN event ID
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  bet_ids UUID[] DEFAULT '{}',         -- Linked bet IDs for prop tracking
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'ended', 'error')),
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_live_scoreboards_active
  ON live_scoreboards (status, guild_id);

CREATE INDEX IF NOT EXISTS idx_live_scoreboards_espn
  ON live_scoreboards (espn_game_id);
```

---

### Architecture

```
Web App / Slash Cmd              Server                         Discord
──────────────────              ──────                         ───────
User clicks "Go Live"     →   1. Find ESPN game (fuzzy match)
  or /scoreboard               2. Create live_scoreboards row
                                3. Post initial embed      →   📊 Embed appears
                                4. Store message_id             in channel
                                                                    │
                           ┌─── 5. Background poller (60s)  ◄──────┘
                           │       - Fetch ESPN summary
                           │       - Get player stats
                           │       - Cross-ref with bet props
                           │
                           └──→ 6. Edit embed message      →   📊 Embed updates
                                   with fresh data               in-place
                                   
                                7. Game ends → final update →  📊 FINAL score
                                   Set status='ended'           Stop polling
```

**Background poller:**
- `setInterval` every 60 seconds
- Queries `live_scoreboards` WHERE `status = 'active'`
- For each active scoreboard: fetch ESPN data → build embed → `message.edit()`
- When ESPN reports game status as "Final": post final score, mark as ended
- Auto-cleanup: end any scoreboard that's been active > 6 hours (safety net)

---

### Team Name Matching

ESPN uses full names ("New York Knicks"), bets might have abbreviations ("NYK", "Knicks"). Need a fuzzy matcher:

1. Build a mapping table: `{ "knicks": "New York Knicks", "nyk": "New York Knicks", ... }` for all teams
2. Normalize: lowercase, strip "the", common abbreviations
3. Fuzzy match: if exact match fails, use Levenshtein distance or substring matching
4. Cache ESPN schedule per sport per day (avoid repeated API calls)

---

### Stat-to-Prop Matching

Player props from bets have `prop_description` like "Over 25.5 Points". Need to parse:
- Extract stat category: Points, Rebounds, Assists, 3-Pointers, Strikeouts, etc.
- Extract line value: 25.5
- Extract direction: Over/Under
- Map stat category to ESPN box score field name
- Compare live stat value to the line → determine status icon

---

### Web App UI

**On bet cards (existing):**
- New button: **"📡 Go Live"** (appears for open bets when game is today)
- Opens a small modal: "Post live scoreboard to [channel dropdown]"
- Confirm → API call → bot posts embed

**New "Live Games" section (optional/later):**
- Tab in the web app showing today's schedule
- Grid of game cards with scores (auto-refreshing)
- "Track" button on each card
- Could show all active scoreboards across the server

---

### Implementation Steps

| Step | What | Details |
|------|------|---------|
| 1 | **Create Supabase table** | Run `live_scoreboards` SQL above |
| 2 | **Build ESPN service** | New file `src/services/espn.js` — functions: `getTodaysGames(sport)`, `getGameSummary(gameId)`, `matchTeamToGame(teamName, games)` |
| 3 | **Build team name mapper** | New file `src/config/teamMappings.js` — abbreviation/alias → full name for all sports |
| 4 | **Build scoreboard embed builder** | New file `src/utils/scoreboardEmbed.js` — takes game data + bet props → returns Discord embed |
| 5 | **Add prop stat parser** | Parse `prop_description` → extract stat type + line + direction |
| 6 | **Add API endpoints** | `POST /api/scoreboard/start` (start tracking a game), `DELETE /api/scoreboard/:id` (stop), `GET /api/scoreboard/games/:sport` (today's games from ESPN) |
| 7 | **Add "Go Live" button** to web app bet cards | Only shows for open bets with today's event time |
| 8 | **Build background poller** | In `index.js` — `setInterval` every 60s, fetch active scoreboards, update embeds |
| 9 | **Add `/scoreboard` slash command** | Optional Discord slash command alternative to web button |
| 10 | **Add auto-stop logic** | End scoreboard when game goes final, post final results |
| 11 | **Test with live NBA game** | End-to-end test during an actual game |
| 12 | **Deploy** | git push → SSH pull → pm2 restart |

---

### ESPN API Rate Limits & Caching

- ESPN unofficial API has no published rate limit but be respectful
- Cache scoreboard responses for 30 seconds (avoid hammering during multi-game nights)
- Cache game summary responses for 60 seconds (matches our polling interval)
- Pre-game: poll every 5 minutes (no need for 60s before tipoff)
- In-game: poll every 60 seconds
- Post-game: one final poll, then stop

---

### Cost

- ESPN API: **Free** (unofficial, no API key needed)
- Supabase: minimal rows, well within free tier
- Discord API: editing messages has generous rate limits (5/5s per channel)
- **Total cost: $0**
