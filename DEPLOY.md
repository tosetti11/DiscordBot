# How to Deploy Changes to GK Bot

Your bot runs 24/7 on an EC2 server. You edit code locally in VS Code, then push it live. Here's exactly how.

> ⚠️ **CRITICAL: Deployment runs via SSH to EC2 — NEVER run `bash scripts/deploy.sh` locally.**
> The deploy script is meant for the EC2 server. Running it locally will fail because pm2 and the project path don't exist on your Windows machine.
> Always deploy using the SSH command below, or ask Copilot: **"deploy my changes to EC2"**.

---

## The Workflow (Every Time You Make Changes)

### Step 1: Make Your Changes

Edit any files in VS Code as normal. Ask Copilot to help — it can read, create, and edit any file in your project.

### Step 2: Save Everything

Make sure all files are saved (`Ctrl + S` on each file, or `Ctrl + K, S` to save all).

### Step 3: Push to GitHub

Open the VS Code terminal (`Ctrl + ~`) and run:

```
git add -A
git commit -m "describe what you changed"
git push
```

Or just ask Copilot: **"push my changes to GitHub"** and it will do it for you.

### Step 4: Deploy to EC2

Run this single command in the VS Code terminal:

```
ssh -i "C:\Users\toset\gk-bot-key.pem" ec2-user@54.227.26.67 "cd ~/DiscordBot && git pull origin main && npm install && pm2 restart all"
```

Or just ask Copilot: **"deploy my changes to EC2"** and it will run it for you.

> ⚠️ **Do NOT run `bash scripts/deploy.sh` in your local terminal.** That script is only for running directly on the EC2 server. Always use the SSH command above from your local machine.

That's it. Your bot is updated.

---

## If You Add or Change Slash Commands

If you added a new command, renamed one, or changed command options, you also need to re-register them. Run this after deploying:

```
ssh -i "C:\Users\toset\gk-bot-key.pem" ec2-user@54.227.26.67 "cd DiscordBot && node src/deploy-commands.js && pm2 restart gk-bot"
```

Or ask Copilot: **"deploy my changes and re-register commands"**

---

## Useful Commands

### Check if the bot is running:
```
ssh -i "C:\Users\toset\gk-bot-key.pem" ec2-user@54.227.26.67 "pm2 status"
```

### View recent logs (to debug issues):
```
ssh -i "C:\Users\toset\gk-bot-key.pem" ec2-user@54.227.26.67 "pm2 logs gk-bot --lines 30 --nostream"
```

### Restart the bot manually:
```
ssh -i "C:\Users\toset\gk-bot-key.pem" ec2-user@54.227.26.67 "pm2 restart gk-bot"
```

### Stop the bot:
```
ssh -i "C:\Users\toset\gk-bot-key.pem" ec2-user@54.227.26.67 "pm2 stop gk-bot"
```

### Start the bot again:
```
ssh -i "C:\Users\toset\gk-bot-key.pem" ec2-user@54.227.26.67 "pm2 start gk-bot"
```

---

## Quick Reference

| What you want to do | What to tell Copilot |
|---|---|
| Make code changes | Just ask — it edits files directly |
| Push to GitHub | "push my changes" |
| Deploy to EC2 | "deploy my changes to EC2" |
| Deploy + re-register commands | "deploy and re-register commands" |
| Check bot status | "check if the bot is running on EC2" |
| View error logs | "show me the EC2 bot logs" |
| Restart the bot | "restart the bot on EC2" |

---

## Important Notes

- **Never run the bot locally** while it's on EC2 — two instances will conflict.
- **Never run `bash scripts/deploy.sh` locally** — it only works on EC2. Always deploy via the SSH command.
- The bot **auto-restarts** if it crashes or if the server reboots.
- Your EC2 IP is **54.227.26.67** — if you stop/start the EC2 instance in AWS, this IP may change.
- Your SSH key is at `C:\Users\toset\gk-bot-key.pem`.
- The deploy SSH command is: `ssh -i "C:\Users\toset\gk-bot-key.pem" ec2-user@54.227.26.67 "cd ~/DiscordBot && git pull origin main && npm install && pm2 restart all"`
