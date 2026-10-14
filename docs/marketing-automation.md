# Marketing Automation Systems

This document describes the isolated marketing automation systems for BookmarkForge. These systems are designed to run without third-party SaaS services, without modifying production environment variables, and without touching production secrets.

## 1. GitHub Actions: Star Welcome System

### Overview
Automatically creates a welcome discussion when a user stars the repository. Uses only GitHub native APIs (GITHUB_TOKEN) - no external services required.

### Location
`.github/workflows/marketing-stars.yml`

### How It Works
- Triggers automatically when a star is added to the repository
- Creates a welcome discussion in the repository's Discussions section
- Highlights privacy-first approach and links to documentation
- Only runs for external users (not the repo owner)

### Configuration
No configuration required. The workflow uses:
- Built-in `GITHUB_TOKEN` for GitHub API access
- Built-in `actions/github-script@v7` for API calls
- Built-in `actions/checkout@v4` for repository access

### Deployment
1. The workflow file is already in the repository
2. Ensure GitHub Actions are enabled in repository settings
3. Ensure Discussions are enabled in repository settings (Settings → Features → Discussions)

### Testing
To test manually, you can:
1. Use a different GitHub account to star the repository
2. Check the Discussions section for the welcome message

## 2. Social Listening: Reddit RSS Monitor

### Overview
Local Node.js script that monitors public Reddit RSS feeds for relevant keywords without requiring Reddit API keys.

### Location
`scripts/social-listening-reddit.ts`

### How It Works
- Fetches RSS feeds directly from Reddit (no API keys required)
- Searches for keywords in post titles and URLs
- Sends notifications to Discord/Telegram webhook when matches are found
- Runs locally on your machine or via scheduled task

### Execution

#### Basic Run (Console Output Only)
```bash
npm run marketing:social-listen
```

#### With Webhook Notifications
```bash
WEBHOOK_URL=https://discord.com/api/webhooks/... npm run marketing:social-listen
```

#### Direct Execution
```bash
npx tsx scripts/social-listening-reddit.ts
```

### Configuration

#### Subreddits Monitored
Edit the `SUBREDDITS` array in the script:
```typescript
const SUBREDDITS = [
  "selfhosted",
  "privacy",
  "DataHoarder",
  "privatelife",
  "linux",
  "webdev",
];
```

#### Keywords Monitored
Edit the `KEYWORDS` array in the script:
```typescript
const KEYWORDS = [
  "Raindrop alternative",
  "bookmark manager privacy",
  "local-first bookmarks",
  "BookmarkForge",
  "self-hosted bookmarks",
  "encrypted bookmarks",
  "offline bookmark manager",
  "open source bookmarks",
];
```

#### Webhook Setup
1. Create a Discord webhook: Server Settings → Integrations → Webhooks → New Webhook
2. Create a Telegram bot: @BotFather → /newbot → Get webhook URL
3. Set the `WEBHOOK_URL` environment variable

### Scheduled Execution

#### Windows Task Scheduler
1. Open Task Scheduler
2. Create Basic Task
3. Trigger: Daily (or your preferred interval)
4. Action: Start a program
   - Program: `node`
   - Arguments: `node_modules/.bin/tsx scripts/social-listening-reddit.ts`
   - Start in: `D:\BOOKMARK\bookmarkforge-2026`
5. Add environment variable: `WEBHOOK_URL=your-webhook-url`

#### Linux Cron
```bash
# Edit crontab
crontab -e

# Add daily run at 9 AM
0 9 * * * cd /path/to/bookmarkforge-2026 && WEBHOOK_URL=your-webhook-url npm run marketing:social-listen >> marketing.log 2>&1
```

#### macOS Launchd
Create `~/Library/LaunchAgents/com.bookmarkforge.social-listening.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bookmarkforge.social-listening</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/npm</string>
        <string>run</string>
        <string>marketing:social-listen</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/bookmarkforge-2026</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>WEBHOOK_URL</key>
        <string>your-webhook-url</string>
    </dict>
    <key>StartInterval</key>
    <integer>3600</integer> <!-- Run every hour -->
</dict>
</plist>
```

Load with:
```bash
launchctl load ~/Library/LaunchAgents/com.bookmarkforge.social-listening.plist
```

### Dependencies
Already installed in the project:
- `node-fetch` - For HTTP requests
- `xml2js` - For parsing RSS feeds

### Example Output
```
=== BookmarkForge Social Listening - Reddit ===
Monitoring 7 subreddits for 8 keywords

Fetching https://www.reddit.com/r/selfhosted/new/.rss...
Found 25 posts in r/selfhosted

🎯 MATCH FOUND in r/selfhosted:
   Keyword: "Raindrop alternative"
   Title: Looking for a self-hosted bookmark manager
   Link: https://reddit.com/r/selfhosted/comments/abc123
   Author: u/example_user
✅ Notification sent for: Looking for a self-hosted bookmark manager

=== Summary ===
Total matches found: 1
```

## Security & Privacy

### GitHub Actions
- Uses only built-in GitHub tokens (no external secrets)
- Runs in isolated GitHub Actions environment
- No access to production secrets or environment variables
- Repository-scoped permissions only

### Social Listening Script
- Uses public RSS feeds (no authentication required)
- Runs locally on your machine (no cloud services)
- Webhook URL is optional (can run without notifications)
- No modifications to production infrastructure

## Compliance with BookmarkForge Principles

✅ **Zero External Registration Required**
- No SaaS marketing suites
- No third-party API keys
- No subscription dependencies

✅ **Production Infrastructure Untouched**
- No Vercel environment variable changes
- No production secret modifications
- Isolated execution environments

✅ **Privacy-First**
- Social listening uses public data only
- No user tracking or data collection
- No external service dependencies

## Troubleshooting

### GitHub Actions Not Triggering
- Check if GitHub Actions are enabled in repository settings
- Check if Discussions are enabled
- Verify the workflow file is in `.github/workflows/`

### Social Listening Script Errors
- Ensure dependencies are installed: `npm install`
- Check internet connectivity for RSS feed access
- Verify webhook URL format if using notifications

### Rate Limiting
- Reddit RSS feeds have rate limits (generally 1 request per 30 seconds)
- Script fetches each subreddit sequentially to respect limits
- Consider increasing interval between scheduled runs if issues occur
