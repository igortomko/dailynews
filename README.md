# Morning Edition

A daily auto-generated editorial magazine curated from Hacker News, personalized for AI tools, dev tools, privacy, health/longevity, and indie startups.

## How it works

1. **`generate.py`** fetches the HN front page, scores stories against your interest profile, picks the top 10, and renders a full-bleed editorial HTML magazine
2. **GitHub Actions** runs daily at 7:00 AM BRT (10:00 UTC), commits the issue, and deploys to GitHub Pages
3. **Telegram bot** sends you the link every morning

## Setup

### 1. Enable GitHub Pages

Go to **Settings → Pages → Source** and select **GitHub Actions**.

### 2. Add repository secrets

In **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
|--------|-------|
| `LLM_API_KEY` | Z.ai API key (or any OpenAI-compatible provider) |
| `LLM_BASE_URL` | Optional. Default: `https://api.z.ai/v1`. Set to `https://api.openai.com/v1` for OpenAI, etc. |
| `LLM_MODEL` | Optional. Default: `claude-sonnet-4-20250514`. Any model your provider supports. |
| `TELEGRAM_BOT_TOKEN` | Your Telegram bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Your Telegram chat ID (send `/start` to your bot, then check `https://api.telegram.org/bot<TOKEN>/getUpdates`) |

### 3. First run

Trigger manually: **Actions → Morning Edition → Run workflow**

## Live URL

```
https://igortomko.github.io/dailynews/latest.html
```

## Local dev

```bash
export LLM_API_KEY=your-z-ai-key
python generate.py
open magazines/$(date +%Y-%m-%d).html
```
