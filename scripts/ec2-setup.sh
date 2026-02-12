#!/bin/bash
# ─────────────────────────────────────────────────
# EC2 First-Time Setup Script for GK Bot
# Run this ONCE on a fresh Amazon Linux 2023 or Ubuntu EC2 instance
# ─────────────────────────────────────────────────

set -e

echo "🔧 Setting up GK Bot on EC2..."

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
fi

# ─── Install Node.js 20.x ───
echo "📦 Installing Node.js..."
if [ "$OS" = "amzn" ]; then
    # Amazon Linux
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
    sudo yum install -y nodejs git
elif [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
    # Ubuntu/Debian
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs git
else
    echo "⚠️  Unknown OS. Install Node.js 20+ and git manually."
    exit 1
fi

echo "   Node: $(node --version)"
echo "   NPM:  $(npm --version)"

# ─── Install PM2 globally ───
echo "📦 Installing PM2..."
sudo npm install -g pm2

# ─── Clone or navigate to project ───
if [ ! -d "$HOME/DiscordBot" ]; then
    echo ""
    echo "📂 Project directory not found at ~/DiscordBot"
    echo "   Option 1: Clone from git:"
    echo "     git clone <your-repo-url> ~/DiscordBot"
    echo ""
    echo "   Option 2: Upload with SCP from your local machine:"
    echo "     scp -i your-key.pem -r ./DiscordBot ec2-user@<ec2-ip>:~/DiscordBot"
    echo ""
    echo "   Then run this script again, or continue manually:"
    echo "     cd ~/DiscordBot && npm install"
    echo ""
    exit 0
fi

cd "$HOME/DiscordBot"

# ─── Install dependencies ───
echo "📦 Installing project dependencies..."
npm install --production

# ─── Check for .env ───
if [ ! -f .env ]; then
    echo ""
    echo "⚠️  No .env file found!"
    echo "   Copy your .env file to ~/DiscordBot/.env"
    echo "   You can use SCP:"
    echo "     scp -i your-key.pem .env ec2-user@<ec2-ip>:~/DiscordBot/.env"
    echo ""
    echo "   Or create it manually:"
    echo "     nano ~/DiscordBot/.env"
    echo ""
    exit 0
fi

# ─── Create logs directory ───
mkdir -p logs

# ─── Deploy slash commands ───
echo "🔄 Deploying slash commands..."
node src/deploy-commands.js

# ─── Start with PM2 ───
echo "🚀 Starting bot with PM2..."
pm2 start ecosystem.config.js

# ─── Set PM2 to start on boot ───
echo "⚙️  Setting up auto-start on reboot..."
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME

echo ""
echo "✅ GK Bot is now running!"
echo ""
echo "─── Useful PM2 Commands ───"
echo "  pm2 status          - Check if bot is running"
echo "  pm2 logs gk-bot     - View live logs"
echo "  pm2 restart gk-bot  - Restart the bot"
echo "  pm2 stop gk-bot     - Stop the bot"
echo "  pm2 monit           - Real-time monitoring dashboard"
echo ""
