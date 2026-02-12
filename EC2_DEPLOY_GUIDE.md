# 🚀 Deploy GK Bot to Amazon EC2 — Step by Step

> Follow these steps in order. Don't skip ahead.

---

## PHASE 1: Install Git & Push to GitHub (on your PC)

### Step 1: Install Git
1. Go to https://git-scm.com/download/win
2. Download and run the installer
3. Click **Next** through everything — all defaults are fine
4. When done, **close and reopen VS Code**

### Step 2: Create a GitHub Account (skip if you have one)
1. Go to https://github.com
2. Sign up for a free account

### Step 3: Create a GitHub Repository
1. Go to https://github.com/new
2. Repository name: `DiscordBot` (or whatever you want)
3. Set it to **Private** (important — your code has no secrets but keep it private anyway)
4. Do NOT check any boxes (no README, no .gitignore, no license)
5. Click **Create repository**
6. Leave that page open — you'll need the URL it shows

### Step 4: Initialize Git & Push Your Code
Open a terminal in VS Code (Ctrl+`) and run these commands ONE AT A TIME:

```
cd D:\DiscordBot
git init
git add .
git commit -m "Initial commit"
```

Now connect to GitHub (replace YOUR_USERNAME with your actual GitHub username):
```
git remote add origin https://github.com/YOUR_USERNAME/DiscordBot.git
git branch -M main
git push -u origin main
```

It will ask you to sign in to GitHub — a browser window will pop up. Sign in and authorize.

✅ Your code is now on GitHub!

---

## PHASE 2: Launch an EC2 Instance (in AWS Console)

### Step 5: Go to EC2
1. Log in to https://aws.amazon.com
2. In the search bar at the top, type **EC2** and click on it
3. Make sure your **region** (top-right corner) is set to one near you (e.g., US East - N. Virginia)

### Step 6: Launch an Instance
1. Click the orange **Launch instance** button
2. Fill in:
   - **Name**: `GK-Bot`
   - **OS**: Select **Amazon Linux** (it's the default, already selected)
   - **Instance type**: `t2.micro` (free tier eligible — already selected)
   - **Key pair**: Click **Create new key pair**
     - Name: `gk-bot-key`
     - Type: RSA
     - Format: `.pem`
     - Click **Create key pair** — it downloads a `.pem` file. **SAVE THIS FILE.** You need it to connect. Move it somewhere safe like `C:\Users\YourName\.ssh\gk-bot-key.pem`
   - **Network settings**: Click **Edit**
     - Check **Allow SSH traffic from** → select **My IP**
     - That's all you need (the bot connects outbound, no inbound ports needed)
   - **Storage**: 8 GB is fine (default)
3. Click **Launch instance**
4. Click **View all instances**
5. Wait for **Instance state** to say **Running** (may take 1-2 minutes)
6. Click on your instance, then copy the **Public IPv4 address** (you'll need this)

---

## PHASE 3: Connect to EC2 & Set Up the Bot

### Step 7: Connect via SSH
Open **PowerShell** on your PC (not VS Code terminal — a regular PowerShell window):

```powershell
ssh -i C:\Users\YourName\.ssh\gk-bot-key.pem ec2-user@YOUR_EC2_IP
```

Replace:
- `C:\Users\YourName\.ssh\gk-bot-key.pem` with the actual path to your downloaded key file
- `YOUR_EC2_IP` with the public IP you copied

It will ask "Are you sure you want to continue connecting?" — type `yes` and press Enter.

You're now inside the EC2 server! 🎉

### Step 8: Install Node.js
Run these commands one at a time:

```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs git
```

Verify it worked:
```bash
node --version
npm --version
```

You should see version numbers (e.g., v20.x.x).

### Step 9: Install PM2
PM2 keeps your bot running 24/7 and auto-restarts it if it crashes:

```bash
sudo npm install -g pm2
```

### Step 10: Clone Your Code from GitHub
```bash
cd ~
git clone https://github.com/YOUR_USERNAME/DiscordBot.git
cd DiscordBot
npm install --production
```

Replace `YOUR_USERNAME` with your GitHub username.

### Step 11: Create Your .env File
You need to put your secrets on the server. Run:

```bash
nano .env
```

This opens a text editor. Paste in your .env contents (same values as your local .env):

```
DISCORD_TOKEN=your_token_here
DISCORD_CLIENT_ID=your_client_id_here
DISCORD_GUILD_ID=your_guild_id_here
SUPABASE_URL=your_supabase_url_here
SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_KEY=your_service_key_here
```

To save and exit nano:
- Press `Ctrl + X`
- Press `Y` (yes, save)
- Press `Enter`

### Step 12: Deploy Slash Commands & Start the Bot
```bash
mkdir -p logs
node src/deploy-commands.js
pm2 start ecosystem.config.js
```

You should see a table showing `gk-bot` with status `online`. 🎉

### Step 13: Make It Survive Reboots
```bash
pm2 save
pm2 startup
```

The `pm2 startup` command will print a line starting with `sudo env PATH=...` — **copy and paste that entire line and run it**.

Then run `pm2 save` one more time:
```bash
pm2 save
```

✅ **Your bot is now running 24/7 on EC2!**

---

## PHASE 4: How to Update the Bot After Making Changes

When you make changes on your PC in VS Code:

### On your PC:
```
cd D:\DiscordBot
git add .
git commit -m "describe what you changed"
git push
```

### On EC2 (SSH in first):
```bash
cd ~/DiscordBot
git pull
npm install --production
pm2 restart gk-bot
```

Or just run the deploy script:
```bash
cd ~/DiscordBot
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

---

## 🔧 Useful Commands on EC2

| Command | What it does |
|---------|-------------|
| `pm2 status` | Check if bot is running |
| `pm2 logs gk-bot` | View live logs (Ctrl+C to exit) |
| `pm2 logs gk-bot --lines 50` | View last 50 log lines |
| `pm2 restart gk-bot` | Restart the bot |
| `pm2 stop gk-bot` | Stop the bot |
| `pm2 monit` | Real-time monitoring dashboard |

---

## ⚠️ Important Notes

- **NEVER commit your .env file to GitHub** — it has your secrets. The .gitignore already prevents this.
- **Don't lose your .pem key file** — you can't download it again. If you lose it, you'll need to create a new key pair.
- **Stop your local bot** before starting on EC2 — only one instance should run at a time or you'll get duplicate messages.
- **EC2 costs**: `t2.micro` is free for 12 months with a new AWS account. After that it's ~$8-10/month. You could also use `t3.micro` or `t4g.micro` for similar pricing.
- **Your Supabase database stays the same** — the EC2 bot connects to the same Supabase, so all existing bets and data carry over.
