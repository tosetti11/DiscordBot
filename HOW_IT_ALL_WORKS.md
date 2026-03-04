# How Your App Works — The Full Picture

Think of your app like a **restaurant**.

- **The Kitchen** = Your EC2 server (where everything runs)
- **The Menu** = Discord slash commands + the website
- **The Fridge** = Supabase (where all data is stored)
- **The Waiters** = The different pieces of code that carry orders between the kitchen, menu, and fridge

---

## The Big Picture (30-second version)

```
YOU (edit code on your PC)
  ↓ git push
GITHUB (stores your code)
  ↓ git pull (on deploy)
EC2 SERVER (Amazon cloud computer that runs 24/7)
  ├── Discord Bot (listens for /commands in your Discord server)
  ├── Website (thegamblingkingapp.com — bet slips, bracket, stats)
  ├── Bracket Updater (polls ESPN every 2 min for game results)
  └── Reminder Scheduler (checks for due reminders every 30 sec)
  ↕
SUPABASE (cloud database — stores all bets, users, brackets, etc.)
  ↕
ESPN API (free sports data — scores, teams, stats)
```

That's it. Those are all the pieces. Now let's explain each one.

---

## 1. YOUR PC (Where You Write Code)

**What it is:** Your Windows computer with VS Code.

**What it does:** This is where you edit code. Your code lives in `D:\DiscordBot`. You don't run the bot here — you just write code and push it to the server.

**The workflow:**
1. You edit files in VS Code
2. You run `git push` to send your code to GitHub
3. You run the deploy SSH command to tell the EC2 server to pull the new code and restart

**Key files:**
- `.env` — Your secrets (tokens, passwords). Never shared. Never committed to GitHub.
- `package.json` — Lists all the Node.js libraries your app depends on

---

## 2. GITHUB (Code Storage)

**What it is:** A website that stores your code in the cloud.

**What it does:** Acts as a middleman between your PC and the server. When you `git push`, your code goes to GitHub. When you deploy, the server does `git pull` to download the latest code from GitHub.

**Think of it like:** Google Drive, but for code. Both your PC and the server can access it.

---

## 3. EC2 SERVER (The Brain)

**What it is:** A small computer in Amazon's cloud (in Virginia) that runs 24/7. It costs about $8-10/month.

**IP Address:** `100.48.25.36` (your Elastic IP — this never changes)

**What it does:** Runs your entire app — the Discord bot, the website, and all background tasks.

**Key pieces on the server:**
- **PM2** — A process manager that keeps your bot running. If the bot crashes, PM2 restarts it automatically. If the server reboots, PM2 starts the bot again.
- **Nginx** — A "traffic cop" that sits in front of your app. When someone visits `thegamblingkingapp.com`, Nginx receives the request, handles the HTTPS encryption, and forwards it to your app running on port 3000.
- **Let's Encrypt** — Gives you a free SSL certificate so your site works with `https://` (the lock icon in the browser).
- **Node.js** — The programming language runtime that actually executes your JavaScript code.

**Config files:**
- `ecosystem.config.js` — Tells PM2 how to run your bot (name, memory limits, log files)
- `nginx-thegamblingkingapp.conf` — Tells Nginx to forward web traffic to your app

**How traffic flows:**
```
User visits thegamblingkingapp.com
  → DNS resolves to 100.48.25.36 (your Elastic IP)
  → Nginx on port 443 (HTTPS) receives it
  → Nginx forwards to your Express app on port 3000
  → Express sends back the web page
```

---

## 4. THE CODEBASE (What Each Folder Does)

### `src/index.js` — The Entry Point

This is the **first file that runs**. Think of it as the "power button." It:
1. Connects to Discord as a bot
2. Loads all 16 slash commands
3. Starts the reminder scheduler (every 30 seconds)
4. Starts the bracket auto-updater (every 2 minutes)
5. Starts the web server on port 3000
6. Listens for Discord interactions (when someone types /enterbet, clicks a button, submits a form)

### `src/commands/` — Discord Slash Commands

These are the `/commands` people type in Discord. Each file handles one command.

**Betting commands (`commands/betting/`):**
| File | Command | What it does |
|------|---------|-------------|
| `enterbet.js` | `/enterbet` | The big one — walks user through placing a bet step by step (sport → type → details → confirm) |
| `closebet.js` | `/closebet` | Mark a bet as won, lost, or push |
| `deletebet.js` | `/deletebet` | Delete a bet |
| `editbet.js` | `/editbet` | Edit a bet's details |
| `mybets.js` | `/mybets` | Show a user's recent bets |
| `mystats.js` | `/mystats` | Show a user's record, ROI, streaks |
| `viewbets.js` | `/viewbets` | View another user's bets |
| `leaderboard.js` | `/leaderboard` | Show the server leaderboard |
| `advancedstats.js` | `/advancedstats` | Detailed stats breakdown by sport/type |
| `whaledick.js` | `/whaledick` | Special whale bet (elevated styling) — admin/sharp only |
| `retrobet.js` | `/retrobet` | Enter a bet that already happened (with result) |

**General commands (`commands/general/`):**
| File | Command | What it does |
|------|---------|-------------|
| `help.js` | `/help` | How-to guide |
| `convertodds.js` | `/convertodds` | Convert between American/decimal/fractional odds |
| `reminder.js` | `/reminder` | Set a reminder to check back on a game |
| `announce.js` | `/announce` | Send an announcement to the server |
| `follow.js` | `/follow` | Follow a bettor to get notified when they bet |

### `src/web/server.js` — The Website Backend (~3000 lines)

This is your **Express web server**. It handles everything on `thegamblingkingapp.com`:

- **Discord OAuth2 login** — "Log in with Discord" button. User clicks it, gets sent to Discord, approves, gets sent back with a token.
- **Bet slip form** — The beautiful web form where users pick a sport, type, enter details, and submit a bet (same as `/enterbet` but in a browser).
- **Stats pages** — User stats, leaderboard, bet history — all served as API endpoints that the frontend JavaScript calls.
- **Bet card images** — When a bet is posted to Discord, the server generates a styled PNG image using Canvas (like Photoshop in code).
- **Mirror channels** — When a bet is submitted, it gets posted to the user's chosen channel AND a mirror channel.
- **Analytics** — Admin-only page tracking usage.

### `src/web/bracketRoutes.js` — Bracket API

All the API routes for the March Madness bracket challenge:
- Email/password registration + login (separate from Discord auth)
- Create/manage tournaments
- Submit/edit bracket picks
- Leaderboard
- Admin panel (manage entries, payments, game results)

### `src/web/public/` — The Frontend (What Users See in the Browser)

| File | What it is |
|------|-----------|
| `index.html` | The main website HTML (bet slip, stats, leaderboard) |
| `app.js` | All the JavaScript that makes the main site interactive |
| `style.css` | How the main site looks (colors, layout, animations) |
| `bracket.html` | The bracket challenge page HTML |
| `bracket-app.js` | JavaScript for the bracket (pick teams, view results, admin panel) |
| `bracket.css` | How the bracket page looks |
| `manifest.json` | Makes the site installable as a phone app (PWA) |
| `service-worker.js` | Enables the "Add to Home Screen" feature |

### `src/config/` — Configuration

| File | What it does |
|------|-------------|
| `supabase.js` | Creates the connection to your Supabase database |
| `constants.js` | Lists of sports, wager types, status emojis — shared across the app |

### `src/database/` — Database Queries

These files talk to Supabase. Each one handles a specific area:

| File | What it queries |
|------|----------------|
| `queries.js` | The main one — bets, users, stats, leaderboard |
| `bracket.js` | Bracket tournaments, teams, games, entries |
| `reminders.js` | User reminders |
| `scoreboards.js` | Live scoreboards (currently disabled) |
| `tailedBets.js` | Tail/fade poll tracking |
| `bettorFollows.js` | Who follows who |

### `src/services/` — External Services

| File | What it does |
|------|-------------|
| `espn.js` | Fetches live scores, game data, and player stats from ESPN's free API |
| `bracketStructure.js` | Defines the 63-game NCAA bracket structure (which games feed into which). Used by both the server AND the browser. |
| `bracketUpdater.js` | Polls ESPN every 2 minutes during the tournament. When a game finishes, it automatically updates the bracket, advances the winner, eliminates the loser, and recalculates everyone's scores. |
| `emailService.js` | Sends verification and password reset emails via Gmail SMTP |

### `src/utils/` — Utility Helpers

| File | What it does |
|------|-------------|
| `embeds.js` | Builds the styled Discord embed messages for bets |
| `betCardImage.js` | Generates the PNG bet card images using Canvas |
| `scoreboardImage.js` | Generates live scoreboard images (currently disabled) |
| `odds.js` | Math for converting between American/decimal/implied odds |
| `notifications.js` | Sends DM notifications to followers when someone places a bet |

---

## 5. SUPABASE (The Database)

**What it is:** A cloud-hosted PostgreSQL database (free tier). Think of it as a giant spreadsheet in the cloud.

**URL:** `https://fjtqeazctzewzdfvfhxg.supabase.co`

**What it stores:**

| Table | What's in it |
|-------|-------------|
| `users` | Every Discord user who has placed a bet (discord_id, name, avatar) |
| `bets` | Every bet ever placed (sport, odds, amount, result, who placed it) |
| `parlay_legs` | Individual legs of parlay bets |
| `guild_settings` | Per-server settings (welcome messages, etc.) |
| `web_analytics` | Login/usage tracking |
| `reminders` | Scheduled reminders |
| `bettor_follows` | Who follows who for notifications |
| `tailed_bets` | Tail/fade poll votes |
| `bracket_tournaments` | Tournament config (name, entry fee, lock date) |
| `bracket_teams` | 64 teams per tournament (name, seed, region, ESPN ID) |
| `bracket_games` | 63 games per tournament (matchups, scores, winners) |
| `bracket_entries` | Each person's bracket picks + score |
| `bracket_email_users` | Non-Discord users who signed up via email |

**How the code talks to it:** Using the `@supabase/supabase-js` library. Every query goes through HTTPS to Supabase's API. Example: "give me all bets by user X" → Supabase runs the SQL → returns JSON.

**Migration files (`supabase/migrations/`):** These are the SQL files that created all the tables. You ran them once in the Supabase SQL editor. They're saved here for reference.

---

## 6. ESPN API (Sports Data)

**What it is:** ESPN's free, unofficial API. No API key needed.

**What it gives you:**
- Today's games for any sport (NBA, NFL, MLB, NHL, college, etc.)
- Live scores, game status, clock
- Player stats (points, rebounds, assists, etc.)
- Team info (logos, colors, records)

**How you use it:**
- The **bet slip** uses it to show sport options
- The **bracket auto-updater** uses it to automatically pull NCAA tournament results every 2 minutes
- The **scoreboard feature** (currently disabled) used it for live score images

**Example API call:**
```
https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=100&limit=200
```
→ Returns all NCAA tournament games for today with scores, teams, and whether the game is final.

---

## 7. DNS & DOMAIN (How People Find Your Site)

**The chain:**
1. User types `thegamblingkingapp.com` in their browser
2. Browser asks DNS: "What IP address is this domain?"
3. DNS says: `100.48.25.36` (your A records at Namecheap)
4. Browser connects to `100.48.25.36` (your EC2 server)
5. Nginx receives the request, handles HTTPS, forwards to Express on port 3000
6. Express sends back the website

**Pieces involved:**
- **Namecheap** — Where you bought the domain. Holds the DNS A records.
- **Elastic IP** — A permanent IP address from AWS that never changes.
- **Nginx** — Reverse proxy that handles HTTPS and forwards to your app.
- **Let's Encrypt** — Free SSL certificate (auto-renews via certbot).

---

## 8. HOW A BET FLOWS THROUGH THE SYSTEM

Here's what happens when someone places a bet — from start to finish:

### Via Discord (`/enterbet`):
```
1. User types /enterbet in Discord
2. Discord sends the interaction to your bot (via WebSocket)
3. index.js receives it → routes to enterbet.js
4. enterbet.js shows dropdown menus (sport → type → details)
5. User fills everything out and clicks Confirm
6. enterbet.js calls queries.js to INSERT the bet into Supabase
7. betCardImage.js generates a PNG image of the bet
8. The bot posts the image to the Discord channel
9. The bot posts a copy to the mirror channel
10. notifications.js checks if anyone follows this bettor → sends DMs
```

### Via Website (thegamblingkingapp.com):
```
1. User visits the site and logs in with Discord (OAuth2)
2. Server creates a JWT token and sets it as a cookie
3. User fills out the bet slip form in the browser
4. Browser sends POST /api/bets to your Express server
5. server.js validates the bet, calls queries.js to INSERT into Supabase
6. betCardImage.js generates the PNG
7. server.js uses the Discord bot to post the image to the channel
8. The bet appears in Discord AND on the website
```

---

## 9. HOW THE BRACKET WORKS

```
1. Admin (you) creates a tournament in the Admin panel
2. Teams are seeded (64 teams, 4 regions)
3. Tournament status set to "open" — people can sign up and make picks
4. Each person picks a winner for all 63 games
5. When the lock date passes, picks are frozen
6. Tournament status changes to "active" or "locked"
7. Bracket auto-updater starts polling ESPN every 2 minutes
8. When a real game finishes:
   → ESPN says "Duke beat Montana 85-66"
   → Auto-updater matches Duke's ESPN ID to your bracket_teams table
   → Finds the bracket_game where Duke vs Montana are playing
   → Sets winner, score, marks game as "final"
   → Advances Duke to the next round's game
   → Marks Montana as eliminated
   → Recalculates everyone's scores and max possible
9. Leaderboard updates automatically
10. When all 63 games are done → tournament status = "completed"
```

---

## 10. ENVIRONMENT VARIABLES (.env)

These are secrets that your code needs but should never be in GitHub:

| Variable | What it's for |
|----------|--------------|
| `DISCORD_TOKEN` | Lets your bot connect to Discord |
| `DISCORD_CLIENT_ID` | Your Discord app's ID (for OAuth2 login) |
| `DISCORD_CLIENT_SECRET` | Your Discord app's secret (for OAuth2 login) |
| `DISCORD_GUILD_ID` | Your server's ID (for registering commands) |
| `SUPABASE_URL` | Where your database lives |
| `SUPABASE_ANON_KEY` | Public database key (limited access) |
| `SUPABASE_SERVICE_KEY` | Admin database key (full access — server-side only) |
| `JWT_SECRET` | Secret key for signing login tokens |
| `BASE_URL` | `https://thegamblingkingapp.com` — used for OAuth redirects |
| `GMAIL_USER` | Email account for sending verification emails |
| `GMAIL_APP_PASSWORD` | Gmail app-specific password |

---

## 11. DEPLOYMENT FLOW

```
You edit code in VS Code
  ↓
git add -A && git commit -m "message" && git push
  ↓ (code goes to GitHub)
SSH command to EC2:
  ssh ec2-user@100.48.25.36 "cd ~/DiscordBot && git pull && npm install && pm2 restart all"
  ↓
EC2 pulls new code from GitHub
  ↓
npm install (downloads any new dependencies)
  ↓
PM2 restarts the bot
  ↓
Bot reconnects to Discord, website comes back up
  ↓
Done! Changes are live.
```

---

## QUICK REFERENCE — WHAT TALKS TO WHAT

```
┌─────────────────────────────────────────────────────────┐
│                    EC2 SERVER                            │
│                                                         │
│  ┌─────────────┐     ┌──────────────────────────────┐  │
│  │   NGINX     │────→│  EXPRESS (server.js, port 3000)│  │
│  │  (port 443) │     │                              │  │
│  └─────────────┘     │  ├── Website routes           │  │
│                      │  ├── Bet slip API             │  │
│                      │  ├── Bracket API              │  │
│                      │  └── Discord OAuth2           │  │
│                      └──────────┬───────────────────┘  │
│                                 │                       │
│  ┌─────────────┐               │                       │
│  │ DISCORD BOT │←──────────────┘                       │
│  │ (index.js)  │    (shares the Discord client)        │
│  │             │                                       │
│  │ Listens for │    ┌──────────────┐                   │
│  │ /commands   │    │  SCHEDULERS  │                   │
│  │ buttons     │    │              │                   │
│  │ modals      │    │ • Reminders (30s)               │
│  └─────────────┘    │ • Bracket ESPN (120s)           │
│                      └──────────────┘                   │
│                                                         │
│         ↕ HTTPS                    ↕ HTTPS              │
│                                                         │
│  ┌──────────────┐          ┌──────────────┐            │
│  │   SUPABASE   │          │   ESPN API   │            │
│  │  (database)  │          │  (scores)    │            │
│  └──────────────┘          └──────────────┘            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

That's your entire app. Every piece. Every connection. 🏆
