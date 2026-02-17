# Discord Analytics Dashboard — TODO

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
SSH: ssh -i "C:\Users\toset\gk-bot-key.pem" ec2-user@54.227.26.67
Deploy: git add -A && git commit -m "msg" && git push
        then SSH: cd DiscordBot && git pull && pm2 restart gk-bot
Supabase SQL: https://supabase.com/dashboard/project/fjtqeazctzewzdfvfhxg/sql/new
```
