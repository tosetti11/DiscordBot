# 👑 GK | Sports Betting Tracker

A Discord bot for tracking sports bets, displaying them in your server, and competing on leaderboards.

## Features

- **`/enterbet`** — Place single bets or parlays with a guided GUI (select menus + modals)
- **`/closebet`** — Close open bets as Win, Loss, Push, or Void
- **`/mybets`** — View your recent bets with status filters
- **`/mystats`** — View your (or another user's) W/L record, win %, net units
- **`/leaderboard`** — Server-wide leaderboard ranked by net units
- **`/convertodds`** — Convert between American and Decimal odds
- **`/help`** — Show all commands

## Tech Stack

- **Runtime**: Node.js
- **Discord Library**: discord.js v14
- **Database**: Supabase (PostgreSQL)
- **Hosting**: AWS EC2 (t2.micro free tier)

---

## Setup Guide

### 1. Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** → Name it "GK | Sports Betting Tracker"
3. Go to **Bot** tab → Click **Add Bot**
4. Copy the **Bot Token** (you'll need this)
5. Under **Privileged Gateway Intents**, enable:
   - Server Members Intent (optional, for future features)
   - Message Content Intent (optional)
6. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Embed Links`, `Use Slash Commands`
7. Copy the generated URL and open it to invite the bot to your server

### 2. Set Up Supabase

1. Go to [supabase.com](https://supabase.com) and create a free project
2. Go to **SQL Editor** and run the contents of `supabase/schema.sql`
3. Go to **Settings → API** and copy:
   - **Project URL** → `SUPABASE_URL`
   - **anon public key** → `SUPABASE_ANON_KEY`
   - **service_role secret key** → `SUPABASE_SERVICE_KEY`

### 3. Configure Environment

```bash
# Copy the example env file
cp .env.example .env
```

Fill in your `.env`:
```
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_application_id
DISCORD_GUILD_ID=your_test_server_id
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...
```

> **DISCORD_CLIENT_ID**: Found in Discord Developer Portal → Your App → General Information → Application ID
>
> **DISCORD_GUILD_ID**: Right-click your server in Discord (with Developer Mode on) → Copy Server ID

### 4. Install & Run

```bash
# Install dependencies
npm install

# Deploy slash commands to your server
npm run deploy-commands

# Start the bot
npm start

# Or use nodemon for development (auto-restarts on file changes)
npm run dev
```

---

## AWS EC2 Deployment

### Launch an EC2 Instance

1. Go to AWS Console → EC2 → **Launch Instance**
2. Choose **Amazon Linux 2023** AMI
3. Instance type: **t2.micro** (free tier eligible)
4. Create or select a key pair (for SSH)
5. Security group: Allow **SSH (port 22)** from your IP
6. Launch the instance

### Set Up the Server

```bash
# SSH into your instance
ssh -i your-key.pem ec2-user@your-ec2-ip

# Install Node.js
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs git

# Clone your repo (or upload files)
git clone https://github.com/your-username/gk-sports-betting-tracker.git
cd gk-sports-betting-tracker

# Install dependencies
npm install --production

# Create .env file
nano .env
# (paste your environment variables)

# Deploy commands
node src/deploy-commands.js

# Install PM2 to keep the bot running
sudo npm install -g pm2

# Start with PM2
pm2 start src/index.js --name "gk-bot"

# Auto-start on reboot
pm2 startup
pm2 save
```

### Useful PM2 Commands

```bash
pm2 status          # Check if bot is running
pm2 logs gk-bot     # View logs
pm2 restart gk-bot  # Restart the bot
pm2 stop gk-bot     # Stop the bot
```

---

## Project Structure

```
DiscordBot/
├── .env.example          # Environment template
├── .gitignore
├── package.json
├── README.md
├── supabase/
│   └── schema.sql        # Database schema (run in Supabase SQL Editor)
└── src/
    ├── index.js           # Bot entry point & event router
    ├── deploy-commands.js # Registers slash commands with Discord
    ├── config/
    │   ├── constants.js   # Sports, emojis, colors
    │   └── supabase.js    # Supabase client
    ├── database/
    │   └── queries.js     # All database operations
    ├── commands/
    │   ├── betting/
    │   │   ├── enterbet.js   # /enterbet (guided bet entry)
    │   │   ├── closebet.js   # /closebet (close open bets)
    │   │   ├── mybets.js     # /mybets (view your bets)
    │   │   ├── mystats.js    # /mystats (your W/L stats)
    │   │   └── leaderboard.js # /leaderboard
    │   └── general/
    │       ├── help.js       # /help
    │       └── convertodds.js # /convertodds
    └── utils/
        ├── odds.js        # Odds conversion utilities
        └── embeds.js      # Discord embed builders
```

---

## Cost Breakdown

| Service | Free Tier | After Free Tier |
|---------|-----------|-----------------|
| Supabase | 500MB DB, 50k rows, unlimited API | Free tier is very generous |
| AWS EC2 t2.micro | 12 months free | ~$8/month |
| Discord API | Free | Free |
| **Total** | **$0/month** | **~$8/month** |

---

## Phase 2 Roadmap

- [ ] Web portal with Discord OAuth for advanced stats
- [ ] Auto-close bets via The Odds API (free tier: 500 requests/month)
- [ ] Bet streaks and achievements
- [ ] Weekly/monthly leaderboard resets
- [ ] Bet of the Day highlights
- [ ] Tail bets (follow another user's bet)
- [ ] Sport-specific stats breakdowns

---

## License

ISC
