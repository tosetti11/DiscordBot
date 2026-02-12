#!/bin/bash
# ─────────────────────────────────────────────────
# Quick Deploy Script
# Run this on EC2 after pushing changes to git
# Usage: ./scripts/deploy.sh
# ─────────────────────────────────────────────────

set -e

cd "$HOME/DiscordBot"

echo "📥 Pulling latest changes..."
git pull origin main

echo "📦 Installing any new dependencies..."
npm install --production

# Check if slash command definitions changed
if git diff HEAD~1 --name-only | grep -q "deploy-commands\|commands/.*\.js"; then
    echo "🔄 Command files changed — redeploying slash commands..."
    node src/deploy-commands.js
fi

echo "🔄 Restarting bot..."
pm2 restart gk-bot

echo ""
echo "✅ Deploy complete!"
pm2 status
