# Coach Reflection Bot — Cloudflare MVP

Minimal 24/7 Telegram bot for a three-person coaching chat:

- coach
- client
- bot

Visible behavior is intentionally small:

1. Morning: one focus + one practice.
2. Evening: one question — what did you notice?
3. Client can answer with text or Telegram voice.

The bot stays silent in normal conversation.

## Architecture

```
Telegram
  ↓
Cloudflare Worker 24/7
  ↓
D1 raw event log + queue
  ↓
Workers AI
  ├─ Whisper Large v3 Turbo → Russian voice → text
  └─ Llama 3.1 8B Instruct Fast → factual structured observation
  ↓
Notion — structured source of truth
  ↓
├─ Obsidian — generated weekly Markdown mirror
└─ Miro — weekly synthesis only
```

No client names, board IDs, Notion IDs, or tokens are committed to this public source folder.

## One-click deploy

Cloudflare supports deploying a public Git repository subdirectory and automatically provisioning declared resources such as D1 and Workers AI.

[Deploy this bot to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/StaroverovVV/diag-webapp/tree/main/coach-reflection-bot)

During setup Cloudflare will ask for these secret values:

- `TELEGRAM_BOT_TOKEN` — token from @BotFather
- `SETUP_CODE` — your random 12+ character code
- `NOTION_TOKEN` — Notion internal integration secret
- `NOTION_DATA_SOURCE_ID` — observations data source
- `MIRO_ACCESS_TOKEN` — Miro access token with board write access
- `MIRO_BOARD_ID` — target client board

The D1 binding is declared without an account-specific resource ID, so Cloudflare provisions it during deployment.

The deploy script applies D1 migrations and then deploys the Worker.

## After deploy

Cloudflare gives you a Worker URL similar to:

```
https://coach-reflection-bot.<your-subdomain>.workers.dev
```

### 1. Health check

Open:

```
<WORKER_URL>/health
```

Expected:

```json
{"ok":true,"service":"coach-reflection-bot"}
```

### 2. Register Telegram webhook

Open in your browser:

```
<WORKER_URL>/bootstrap?code=<SETUP_CODE>
```

The Worker derives a Telegram webhook secret from the BotFather token. No second webhook secret needs to be configured.

### 3. Create the coaching Telegram group

Add:

- coach
- client
- bot

Then the coach sends:

```
/bind <SETUP_CODE>
```

The person who successfully performs `/bind` becomes the coach/admin for this bot instance.

Then:

```
/setclient Юлия Быченкова
/setfocus Не забирать решение, которое человек уже способен принять сам.
/setpractice Прежде чем давать ответ, спросить: «Что ты намерен сделать?»
/settime 09:00 20:30
```

## Telegram commands

For the group:

- `/focus` — current focus + practice
- `/log` — next text/voice becomes an observation
- `/summary` — factual 7-day summary
- `/help`

Coach-only:

- `/setfocus ...`
- `/setpractice ...`
- `/settime 09:00 20:30`
- `/setclient ...`
- `/status`
- `/syncmiro`
- `/obsidiantoken` — only use in private chat with the bot

Utility:

- `/chatid`
- `/whoami`

## What becomes an observation

An ordinary group discussion is ignored.

The bot captures only when:

- client replies to the morning/evening bot prompt;
- client runs `/log`, then sends text/voice within 15 minutes;
- text starts with `наблюдение:` or `#наблюдение`.

This keeps the bot from becoming a third coach in the room.

## AI behavior

The AI prompt explicitly forbids:

- diagnosis;
- personality interpretation;
- inventing motives;
- long advice;
- coaching in place of the human coach.

It extracts only:

```
situation
impulse
action
alternative
other_action
result
zone = Я / Вместе / Сам / Неясно
follow_up_question = max one question
```

## Reliability

The order is deliberate:

1. raw Telegram message is written to D1;
2. voice is transcribed if needed;
3. AI structures the episode;
4. structured observation is saved;
5. Notion is updated;
6. Miro/Obsidian are secondary projections.

If Notion or Miro is temporarily unavailable, the raw event is already durable in D1.

Duplicate Telegram deliveries are deduplicated by `chat_id + message_id`.

## Notion

The current sink expects these existing properties:

- `Запись` — title
- `Ситуация`
- `Импульс`
- `Действие`
- `Альтернатива`
- `Результат`

The page body also stores:

- focus;
- zone;
- source;
- raw observation.

## Miro

Miro is intentionally not updated on every message.

Once per week the Worker:

1. reads the previous 7 days;
2. produces up to five factual cards;
3. creates one weekly frame;
4. creates up to five sticky notes.

Manual coach command:

```
/syncmiro
```

## Obsidian

The Worker stays online while the Mac is asleep.

The local Obsidian vault cannot be edited while the Mac is offline, so this repo includes a tiny Obsidian plugin:

```
obsidian-plugin/
  main.js
  manifest.json
```

Install it into:

```
<Vault>/.obsidian/plugins/coach-reflection-sync/
```

Then:

1. send `/obsidiantoken` to the bot in a **private Telegram chat**;
2. copy the returned token into plugin settings;
3. enter the Worker URL in plugin settings.

When Obsidian is open, the plugin refreshes the latest weekly Markdown notes every 10 minutes.

The Worker remains the 24/7 durable source while the computer is off.

## Manual CLI deployment

If you prefer Wrangler instead of the button:

```bash
npm install
npx wrangler login
npm run deploy
```

Wrangler can automatically provision the D1 binding declared in `wrangler.jsonc`.

Set secrets with `wrangler secret put` before using the external integrations, or use the Deploy to Cloudflare flow above.

## CI

GitHub Actions runs:

```
npm install
npm run typecheck
```

on changes to this folder.

## Privacy

- Never commit tokens.
- The public source code contains no client-specific data.
- Keep Notion and Miro integrations scoped to only the resources needed by the client workflow.
- Raw audio is downloaded only for transcription; the Worker does not intentionally archive the Telegram audio file itself.
