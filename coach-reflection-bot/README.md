# Coach Reflection Bot — Cloudflare MVP

Minimal 24/7 Telegram reflection bot for a three-person coaching chat:

- coach
- client
- bot

The bot does only two visible things:

1. Morning: sends one focus + one practice.
2. Evening: asks what the client noticed.

The client can reply with text or a Telegram voice message.

Behind the scenes:

- Telegram = interaction
- Cloudflare D1 = durable queue + source event log
- Workers AI Whisper = Russian voice transcription
- Workers AI Llama = factual structuring, no "AI coaching"
- Notion = structured source of truth
- Obsidian = generated Markdown mirror when Obsidian is open
- Miro = weekly synthesis only, not every raw message

No client names, board IDs, database IDs, or tokens are committed to this public source folder.

## Models

- Audio: `@cf/openai/whisper-large-v3-turbo`
- Text: `@cf/meta/llama-3.1-8b-instruct-fast`

Both run through a Workers AI binding.

## Visible Telegram behavior

Morning:

```
Фокус сегодня:
<weekly focus>

Практика:
<one small practice>
```

Evening:

```
Что сегодня заметила про этот фокус?

Можно написать или наговорить.
```

The bot stays silent in normal conversation.

An observation is captured only when:

- the user replies to a morning/evening bot prompt;
- the user runs `/log`, then sends text/voice within 15 minutes;
- a text message begins with `наблюдение:` or `#наблюдение`.

## Telegram commands

Public/bootstrap:

- `/chatid`
- `/whoami`
- `/bind <BIND_CODE>`

In the bound coaching chat:

- `/focus`
- `/log`
- `/summary`
- `/help`

Coach-only when `COACH_USER_ID` is configured:

- `/setfocus ...`
- `/setpractice ...`
- `/settime 09:00 20:30`
- `/setclient Имя клиента`

## 1. Create the Cloudflare D1 database

From this folder:

```bash
npm install
npx wrangler login
npx wrangler d1 create coach-reflection-bot
```

Copy the returned `database_id` into `wrangler.jsonc` in place of:

```
REPLACE_AFTER_D1_CREATE
```

Apply migrations:

```bash
npx wrangler d1 migrations apply coach-reflection-bot --remote
```

## 2. Set Cloudflare secrets

Never put these values into Git.

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put BIND_CODE
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put OBSIDIAN_SYNC_TOKEN
npx wrangler secret put COACH_USER_ID
```

Optional Notion sink:

```bash
npx wrangler secret put NOTION_TOKEN
npx wrangler secret put NOTION_DATA_SOURCE_ID
```

Optional Miro weekly sink:

```bash
npx wrangler secret put MIRO_ACCESS_TOKEN
npx wrangler secret put MIRO_BOARD_ID
```

### Secret meanings

- `TELEGRAM_BOT_TOKEN` — BotFather token.
- `TELEGRAM_WEBHOOK_SECRET` — random secret used by Telegram to sign webhook calls.
- `BIND_CODE` — one-time-ish code used to bind the bot to the intended Telegram group.
- `ADMIN_TOKEN` — protects admin HTTP endpoints.
- `OBSIDIAN_SYNC_TOKEN` — protects Markdown export read access.
- `COACH_USER_ID` — Telegram numeric user ID of the coach.
- `NOTION_TOKEN` — Notion integration token with access to the observations data source.
- `NOTION_DATA_SOURCE_ID` — Notion data source used as source of truth.
- `MIRO_ACCESS_TOKEN` — Miro OAuth/access token with `boards:write`.
- `MIRO_BOARD_ID` — target board ID.

## 3. Deploy

```bash
npx wrangler deploy
```

You will get a URL similar to:

```
https://coach-reflection-bot.<subdomain>.workers.dev
```

Health check:

```bash
curl https://coach-reflection-bot.<subdomain>.workers.dev/health
```

Expected:

```json
{"ok":true,"service":"coach-reflection-bot"}
```

## 4. Set Telegram webhook

```bash
curl -X POST \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  https://coach-reflection-bot.<subdomain>.workers.dev/admin/set-webhook
```

The Worker registers its own `/telegram` endpoint and configures Telegram's secret-token header.

## 5. Create the three-person Telegram chat

Create the group:

- coach
- client
- bot

In the group:

```
/bind <BIND_CODE>
```

Then:

```
/setclient <client name>
/setfocus <weekly focus>
/setpractice <weekly practice>
/settime 09:00 20:30
```

The Worker runs one cron every 15 minutes and checks local time in `Europe/Moscow`.
That keeps morning/evening times editable without redeploying the Worker.

## 6. Notion

The current implementation expects these existing property names:

- `Запись` — title
- `Ситуация` — rich text
- `Импульс` — rich text
- `Действие` — rich text
- `Альтернатива` — rich text
- `Результат` — rich text

It also places the current focus, zone, source, and raw observation into page content.

If Notion is temporarily unavailable, the observation is already safe in D1 and the Telegram raw-message log.

## 7. Obsidian

The bot itself stays online even when the Mac is asleep.

Obsidian cannot be written to while the local vault is offline, so the included plugin solves this without exposing the vault:

```
obsidian-plugin/
  main.js
  manifest.json
```

Install it into:

```
<Vault>/.obsidian/plugins/coach-reflection-sync/
```

Then enable it and set:

- Worker endpoint
- `OBSIDIAN_SYNC_TOKEN`

While Obsidian is open, it refreshes generated weekly Markdown notes every 10 minutes.

The Worker remains the durable 24/7 source, so nothing is lost while the Mac is off.

## 8. Miro

Miro is deliberately **not** updated for every message.

Once a week the Worker:

1. reads the previous 7 days from D1;
2. asks the text model for up to five factual cards;
3. creates one weekly frame in Miro;
4. creates up to five sticky notes.

This prevents the client board from turning into a raw-message dump.

Manual test:

```bash
curl -X POST \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  https://coach-reflection-bot.<subdomain>.workers.dev/admin/sync-miro
```

## 9. Status

```bash
curl \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  https://coach-reflection-bot.<subdomain>.workers.dev/admin/status
```

This reports configuration state without returning secrets.

## Reliability rules implemented

1. Raw Telegram input is persisted before interpretation.
2. Duplicate Telegram updates are deduplicated by `chat_id + message_id`.
3. AI interpretation is separate from raw storage.
4. Notion failure does not lose the observation.
5. Miro is a weekly secondary projection only.
6. Obsidian is a mirror that catches up after the local app returns online.
7. The bot never comments on ordinary conversation unless explicitly triggered.
8. The AI prompt forbids diagnosis and personality interpretation.

## Privacy

Do not commit tokens.

The repository code contains no client-specific secrets.

For production use, keep Cloudflare Secrets scoped to this Worker and give Notion/Miro integrations access only to the specific client resources they need.
