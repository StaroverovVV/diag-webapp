import { Buffer } from "node:buffer";

export interface Env {
  AI: Ai;
  DB: D1Database;

  TELEGRAM_BOT_TOKEN: string;
  SETUP_CODE: string;

  NOTION_TOKEN?: string;
  NOTION_DATA_SOURCE_ID?: string;
  NOTION_VERSION?: string;

  MIRO_ACCESS_TOKEN?: string;
  MIRO_BOARD_ID?: string;

  TIME_ZONE?: string;
  DEFAULT_MORNING_TIME?: string;
  DEFAULT_EVENING_TIME?: string;
  DEFAULT_WEEKLY_MIRO_TIME?: string;
  DEFAULT_WEEKLY_MIRO_DAY?: string;
  AI_TEXT_MODEL?: string;
  AI_AUDIO_MODEL?: string;
}

type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramMessage = {
  message_id: number;
  date: number;
  chat: { id: number; type: string; title?: string };
  from?: TelegramUser;
  text?: string;
  voice?: { file_id: string; duration?: number; file_size?: number };
  reply_to_message?: TelegramMessage;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

type ObservationAI = {
  situation: string;
  impulse: string;
  action: string;
  alternative: string;
  other_action: string;
  result: string;
  zone: "Я" | "Вместе" | "Сам" | "Неясно";
  follow_up_question: string;
};

type WeeklyAI = {
  patterns: string[];
  wins: string[];
  tensions: string[];
  next_question: string;
  cards: string[];
};

const TEXT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
const AUDIO_MODEL = "@cf/openai/whisper-large-v3-turbo";
const DEFAULT_FOCUS =
  "Не забирать решение, которое человек уже способен принять сам.";
const DEFAULT_PRACTICE =
  "Прежде чем давать ответ, спросить: «Что ты намерен сделать?»";

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}

function trimText(value: unknown, max = 1800): string {
  return String(value ?? "").trim().slice(0, max);
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function displayName(user?: TelegramUser): string {
  if (!user) return "";
  return (
    [user.first_name, user.last_name].filter(Boolean).join(" ") ||
    user.username ||
    String(user.id)
  );
}

function bearer(request: Request): string {
  const h = request.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function telegramWebhookSecret(env: Env): Promise<string> {
  return (await sha256Hex(env.TELEGRAM_BOT_TOKEN + "|coach-webhook")).slice(0, 64);
}

function randomToken(bytes = 24): string {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return [...data].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isValidHHMM(value: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59 && min % 15 === 0;
}

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value || "";

  const y = get("year");
  const m = get("month");
  const d = get("day");
  const hh = get("hour");
  const mm = get("minute");
  const weekday = get("weekday");
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    date: `${y}-${m}-${d}`,
    time: `${hh}:${mm}`,
    weekday: weekdayMap[weekday] ?? -1,
  };
}

function isoWeek(dateString: string): string {
  const [y, m, d] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function addDays(dateString: string, days: number): string {
  const [y, m, d] = dateString.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function weekStart(dateString: string): string {
  const [y, m, d] = dateString.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() - day + 1);
  return dt.toISOString().slice(0, 10);
}

async function getSetting(
  env: Env,
  key: string,
  fallback = "",
): Promise<string> {
  const row = await env.DB.prepare(
    "SELECT value FROM settings WHERE key = ?",
  )
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? fallback;
}

async function setSetting(env: Env, key: string, value: string) {
  await env.DB.prepare(
    `INSERT INTO settings(key, value, updated_at)
     VALUES(?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(key, value)
    .run();
}

async function telegram<T = any>(
  env: Env,
  method: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: payload ? "POST" : "GET",
      headers: payload ? { "content-type": "application/json" } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
    },
  );

  const data: any = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(
      `Telegram ${method} failed: ${response.status} ${JSON.stringify(data)}`,
    );
  }
  return data.result as T;
}

async function sendMessage(
  env: Env,
  chatId: string | number,
  text: string,
  replyTo?: number,
): Promise<TelegramMessage> {
  return telegram<TelegramMessage>(env, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...(replyTo
      ? { reply_parameters: { message_id: replyTo } }
      : {}),
  });
}

async function isCoach(env: Env, userId?: number): Promise<boolean> {
  const coachId = await getSetting(env, "coach_user_id", "");
  return Boolean(coachId) && String(userId ?? "") === coachId;
}

async function boundChat(env: Env): Promise<string> {
  return getSetting(env, "chat_id", "");
}

async function insertRaw(
  env: Env,
  message: TelegramMessage,
  source: string,
  rawText: string,
  telegramFileId = "",
): Promise<number> {
  const chatId = String(message.chat.id);
  const userId = String(message.from?.id ?? "");
  const userName = displayName(message.from);
  const createdAt = new Date(message.date * 1000).toISOString();

  await env.DB.prepare(
    `INSERT OR IGNORE INTO raw_messages
      (chat_id, message_id, user_id, user_name, source, raw_text,
       telegram_file_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      chatId,
      message.message_id,
      userId,
      userName,
      source,
      rawText,
      telegramFileId,
      createdAt,
    )
    .run();

  const row = await env.DB.prepare(
    "SELECT id FROM raw_messages WHERE chat_id = ? AND message_id = ?",
  )
    .bind(chatId, message.message_id)
    .first<{ id: number }>();

  if (!row?.id) throw new Error("Could not persist raw Telegram message");
  return row.id;
}

async function markRawProcessed(
  env: Env,
  rawId: number,
  error = "",
): Promise<void> {
  await env.DB.prepare(
    "UPDATE raw_messages SET processed_at = CURRENT_TIMESTAMP, process_error = ? WHERE id = ?",
  )
    .bind(error, rawId)
    .run();
}

async function transcribeVoice(
  env: Env,
  fileId: string,
): Promise<string> {
  const file = await telegram<{ file_path?: string }>(env, "getFile", {
    file_id: fileId,
  });
  if (!file.file_path) throw new Error("Telegram getFile returned no file_path");

  const audioResponse = await fetch(
    `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`,
    { redirect: "follow" },
  );
  if (!audioResponse.ok) {
    throw new Error(`Telegram voice download failed: ${audioResponse.status}`);
  }

  const buffer = await audioResponse.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");

  const result: any = await env.AI.run(
    env.AI_AUDIO_MODEL || AUDIO_MODEL,
    {
      audio: base64,
      task: "transcribe",
      language: "ru",
      vad_filter: true,
      condition_on_previous_text: true,
      initial_prompt:
        "Русская речь. Контекст: executive coaching, руководитель, команда, стратегия, автономия, амбиция, наблюдение за управленческим поведением. Имена: Юлия, Вячеслав.",
    },
  );

  const text =
    result?.text ??
    result?.transcription_info?.text ??
    result?.response ??
    "";
  if (!String(text).trim()) throw new Error("Whisper returned empty transcript");
  return String(text).trim();
}

const observationSchema = {
  type: "object",
  properties: {
    situation: { type: "string" },
    impulse: { type: "string" },
    action: { type: "string" },
    alternative: { type: "string" },
    other_action: { type: "string" },
    result: { type: "string" },
    zone: {
      type: "string",
      enum: ["Я", "Вместе", "Сам", "Неясно"],
    },
    follow_up_question: { type: "string" },
  },
  required: [
    "situation",
    "impulse",
    "action",
    "alternative",
    "other_action",
    "result",
    "zone",
    "follow_up_question",
  ],
};

async function structureObservation(
  env: Env,
  rawText: string,
  focus: string,
): Promise<ObservationAI> {
  const result: any = await env.AI.run(
    env.AI_TEXT_MODEL || TEXT_MODEL,
    {
      messages: [
        {
          role: "system",
          content: [
            "Ты тихий цифровой наблюдатель между executive-coaching сессиями.",
            "Не будь коучем, психологом или советчиком.",
            "Не ставь диагнозы, не приписывай мотивы и не додумывай отсутствующие факты.",
            "Структурируй только наблюдаемый эпизод.",
            "Если данных для поля нет — верни пустую строку.",
            "Зона «Я»: решение объективно должен принять руководитель из-за полномочий/критического риска.",
            "Зона «Вместе»: сотрудник делает сам, руководитель помогает вопросами, рамкой или проверкой.",
            "Зона «Сам»: сотрудник способен принять решение и выдержать последствия самостоятельно.",
            "Зона «Неясно»: данных недостаточно.",
            "follow_up_question: максимум один короткий вопрос, только если без него теряется ключевой результат эпизода. Иначе пустая строка.",
            `Фокус недели: ${focus}`,
          ].join("\n"),
        },
        {
          role: "user",
          content: rawText,
        },
      ],
      response_format: {
        type: "json_schema",
        schema: observationSchema,
      },
    },
  );

  const value = result?.response ?? result;
  if (typeof value === "string") {
    return JSON.parse(value) as ObservationAI;
  }
  return value as ObservationAI;
}

function observationReply(o: ObservationAI): string {
  const rows = ["Зафиксировал."];
  if (o.impulse) rows.push(`Импульс: ${o.impulse}`);
  if (o.action) rows.push(`Выбор: ${o.action}`);
  if (o.result) rows.push(`Результат: ${o.result}`);
  rows.push(`Зона: ${o.zone}`);
  return rows.join("\n");
}

async function notionCreate(
  env: Env,
  observationId: number,
): Promise<string | null> {
  if (!env.NOTION_TOKEN || !env.NOTION_DATA_SOURCE_ID) return null;

  const row = await env.DB.prepare(
    "SELECT * FROM observations WHERE id = ?",
  )
    .bind(observationId)
    .first<any>();
  if (!row) return null;

  const rich = (v: string) => [
    {
      type: "text",
      text: { content: trimText(v, 1800) || "—" },
    },
  ];

  const titleText = trimText(
    `${row.local_date.slice(5)} · ${row.zone} · ${row.situation || "наблюдение"}`,
    120,
  );

  const body = {
    parent: {
      type: "data_source_id",
      data_source_id: env.NOTION_DATA_SOURCE_ID,
    },
    properties: {
      "Запись": { title: rich(titleText) },
      "Ситуация": { rich_text: rich(row.situation) },
      "Импульс": { rich_text: rich(row.impulse) },
      "Действие": { rich_text: rich(row.action) },
      "Альтернатива": { rich_text: rich(row.alternative) },
      "Результат": {
        rich_text: rich(
          [row.other_action, row.result].filter(Boolean).join(" → "),
        ),
      },
    },
    children: [
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: rich(
            `Фокус: ${row.focus}\nЗона: ${row.zone}\nИсточник: Telegram / ${row.source}`,
          ),
        },
      },
      {
        object: "block",
        type: "toggle",
        toggle: {
          rich_text: rich("Исходное наблюдение"),
          children: [
            {
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: rich(
                  (
                    await env.DB.prepare(
                      "SELECT raw_text FROM raw_messages WHERE id = ?",
                    )
                      .bind(row.raw_message_id)
                      .first<{ raw_text: string }>()
                  )?.raw_text || "",
                ),
              },
            },
          ],
        },
      },
    ],
  };

  const response = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.NOTION_TOKEN}`,
      "content-type": "application/json",
      "Notion-Version": env.NOTION_VERSION || "2026-03-11",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    await env.DB.prepare(
      "UPDATE observations SET notion_error = ? WHERE id = ?",
    )
      .bind(trimText(error, 1800), observationId)
      .run();
    throw new Error(`Notion create failed: ${response.status} ${error}`);
  }

  const data: any = await response.json();
  await env.DB.prepare(
    "UPDATE observations SET notion_page_id = ?, notion_synced_at = CURRENT_TIMESTAMP, notion_error = NULL WHERE id = ?",
  )
    .bind(data.id, observationId)
    .run();
  return data.id || null;
}

async function notionUpdateResult(
  env: Env,
  observationId: number,
): Promise<void> {
  if (!env.NOTION_TOKEN) return;
  const row = await env.DB.prepare(
    "SELECT notion_page_id, other_action, result FROM observations WHERE id = ?",
  )
    .bind(observationId)
    .first<any>();
  if (!row?.notion_page_id) return;

  const content = trimText(
    [row.other_action, row.result].filter(Boolean).join(" → "),
    1800,
  );

  const response = await fetch(
    `https://api.notion.com/v1/pages/${row.notion_page_id}`,
    {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${env.NOTION_TOKEN}`,
        "content-type": "application/json",
        "Notion-Version": env.NOTION_VERSION || "2026-03-11",
      },
      body: JSON.stringify({
        properties: {
          "Результат": {
            rich_text: [
              { type: "text", text: { content: content || "—" } },
            ],
          },
        },
      }),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Notion update failed: ${response.status} ${error}`);
  }
}

async function saveObservation(
  env: Env,
  rawId: number,
  message: TelegramMessage,
  source: string,
  focus: string,
  o: ObservationAI,
): Promise<number> {
  const timeZone = env.TIME_ZONE || "Europe/Moscow";
  const local = localParts(
    new Date(message.date * 1000),
    timeZone,
  ).date;

  const r = await env.DB.prepare(
    `INSERT INTO observations
      (raw_message_id, chat_id, message_id, user_id, user_name, source,
       created_at, local_date, focus, situation, impulse, action,
       alternative, other_action, result, zone, follow_up_question)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      rawId,
      String(message.chat.id),
      message.message_id,
      String(message.from?.id ?? ""),
      displayName(message.from),
      source,
      new Date(message.date * 1000).toISOString(),
      local,
      focus,
      trimText(o.situation),
      trimText(o.impulse),
      trimText(o.action),
      trimText(o.alternative),
      trimText(o.other_action),
      trimText(o.result),
      o.zone,
      trimText(o.follow_up_question, 500),
    )
    .run();

  return Number(r.meta.last_row_id);
}

async function promptReply(
  env: Env,
  message: TelegramMessage,
): Promise<boolean> {
  const replyId = message.reply_to_message?.message_id;
  if (!replyId) return false;

  const row = await env.DB.prepare(
    "SELECT 1 FROM prompt_deliveries WHERE chat_id = ? AND telegram_message_id = ? LIMIT 1",
  )
    .bind(String(message.chat.id), replyId)
    .first();
  return Boolean(row);
}

async function pendingCapture(
  env: Env,
  message: TelegramMessage,
): Promise<boolean> {
  if (!message.from) return false;
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    "SELECT expires_at FROM capture_sessions WHERE chat_id = ? AND user_id = ?",
  )
    .bind(String(message.chat.id), String(message.from.id))
    .first<{ expires_at: number }>();

  if (!row) return false;
  if (row.expires_at < now) {
    await env.DB.prepare(
      "DELETE FROM capture_sessions WHERE chat_id = ? AND user_id = ?",
    )
      .bind(String(message.chat.id), String(message.from.id))
      .run();
    return false;
  }
  return true;
}

async function clearCapture(env: Env, message: TelegramMessage) {
  if (!message.from) return;
  await env.DB.prepare(
    "DELETE FROM capture_sessions WHERE chat_id = ? AND user_id = ?",
  )
    .bind(String(message.chat.id), String(message.from.id))
    .run();
}

async function completeFollowup(
  env: Env,
  message: TelegramMessage,
): Promise<boolean> {
  if (!message.from || !message.reply_to_message) return false;

  const follow = await env.DB.prepare(
    `SELECT observation_id, expires_at
       FROM followups
       WHERE chat_id = ? AND user_id = ? AND bot_message_id = ?`,
  )
    .bind(
      String(message.chat.id),
      String(message.from.id),
      message.reply_to_message.message_id,
    )
    .first<{ observation_id: number; expires_at: number }>();

  if (!follow) return false;

  if (follow.expires_at < Math.floor(Date.now() / 1000)) {
    await env.DB.prepare(
      "DELETE FROM followups WHERE observation_id = ?",
    )
      .bind(follow.observation_id)
      .run();
    return false;
  }

  let answer = message.text?.trim() || "";
  if (!answer && message.voice?.file_id) {
    answer = await transcribeVoice(env, message.voice.file_id);
  }
  if (!answer) return false;

  const old = await env.DB.prepare(
    "SELECT result FROM observations WHERE id = ?",
  )
    .bind(follow.observation_id)
    .first<{ result: string }>();

  const result = [old?.result, answer].filter(Boolean).join(" | ");
  await env.DB.prepare(
    "UPDATE observations SET result = ? WHERE id = ?",
  )
    .bind(trimText(result), follow.observation_id)
    .run();

  await env.DB.prepare(
    "DELETE FROM followups WHERE observation_id = ?",
  )
    .bind(follow.observation_id)
    .run();

  try {
    await notionUpdateResult(env, follow.observation_id);
  } catch (e) {
    console.error(e);
  }

  await sendMessage(env, message.chat.id, "Добавил результат к наблюдению.");
  return true;
}

async function processObservationMessage(
  env: Env,
  message: TelegramMessage,
): Promise<void> {
  let rawText = message.text?.trim() || "";
  let source = "text";
  let fileId = "";

  if (message.voice?.file_id) {
    source = "voice";
    fileId = message.voice.file_id;
    rawText = await transcribeVoice(env, fileId);
  }

  rawText = rawText.replace(
    /^(?:#?наблюдение|наблюдение)\s*[:—-]?\s*/i,
    "",
  );

  if (!rawText) return;

  const rawId = await insertRaw(env, message, source, rawText, fileId);
  const focus = await getSetting(env, "weekly_focus", DEFAULT_FOCUS);

  try {
    const structured = await structureObservation(env, rawText, focus);
    const observationId = await saveObservation(
      env,
      rawId,
      message,
      source,
      focus,
      structured,
    );
    await markRawProcessed(env, rawId);

    try {
      await notionCreate(env, observationId);
    } catch (e) {
      console.error(e);
    }

    const response = await sendMessage(
      env,
      message.chat.id,
      observationReply(structured),
      message.message_id,
    );

    if (structured.follow_up_question) {
      const q = await sendMessage(
        env,
        message.chat.id,
        structured.follow_up_question,
      );
      await env.DB.prepare(
        `INSERT OR REPLACE INTO followups
          (observation_id, chat_id, user_id, bot_message_id, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(
          observationId,
          String(message.chat.id),
          String(message.from?.id ?? ""),
          q.message_id,
          Math.floor(Date.now() / 1000) + 12 * 3600,
        )
        .run();
    }

    void response;
  } catch (e: any) {
    await markRawProcessed(env, rawId, trimText(e?.message || e, 1800));
    console.error(e);
    await sendMessage(
      env,
      message.chat.id,
      "Не смог обработать наблюдение. Оно сохранено сырым и не потеряно. Попробую после исправления.",
      message.message_id,
    );
  }
}

async function weeklyData(env: Env, days = 7) {
  const rows = await env.DB.prepare(
    `SELECT local_date, focus, situation, impulse, action,
            other_action, result, zone
       FROM observations
       WHERE created_at >= datetime('now', ?)
       ORDER BY created_at ASC`,
  )
    .bind(`-${days} days`)
    .all<any>();
  return rows.results || [];
}

const weeklySchema = {
  type: "object",
  properties: {
    patterns: { type: "array", items: { type: "string" } },
    wins: { type: "array", items: { type: "string" } },
    tensions: { type: "array", items: { type: "string" } },
    next_question: { type: "string" },
    cards: { type: "array", items: { type: "string" } },
  },
  required: ["patterns", "wins", "tensions", "next_question", "cards"],
};

async function summarizeWeek(env: Env): Promise<WeeklyAI> {
  const observations = await weeklyData(env, 7);
  if (!observations.length) {
    return {
      patterns: [],
      wins: [],
      tensions: [],
      next_question: "",
      cards: [],
    };
  }

  const result: any = await env.AI.run(
    env.AI_TEXT_MODEL || TEXT_MODEL,
    {
      messages: [
        {
          role: "system",
          content: [
            "Ты готовишь короткую фактическую сводку наблюдений между executive-coaching сессиями.",
            "Не ставь диагнозы. Не приписывай мотивы. Не делай выводов, которых нет в эпизодах.",
            "patterns: 1-3 повторяющихся наблюдаемых паттерна.",
            "wins: 1-3 места, где появилось новое поведение или субъектность.",
            "tensions: 1-3 повторяющихся напряжения.",
            "next_question: один вопрос на следующую сессию.",
            "cards: ровно до 5 коротких карточек для Miro. Каждая карточка — отдельная завершённая мысль.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify(observations),
        },
      ],
      response_format: {
        type: "json_schema",
        schema: weeklySchema,
      },
    },
  );

  const value = result?.response ?? result;
  return typeof value === "string"
    ? (JSON.parse(value) as WeeklyAI)
    : (value as WeeklyAI);
}

function summaryText(s: WeeklyAI): string {
  const sections: string[] = [];
  if (s.patterns?.length) {
    sections.push(
      "Повторяется:\n" + s.patterns.map((x) => `• ${x}`).join("\n"),
    );
  }
  if (s.wins?.length) {
    sections.push(
      "Получается:\n" + s.wins.map((x) => `• ${x}`).join("\n"),
    );
  }
  if (s.tensions?.length) {
    sections.push(
      "Напряжение:\n" + s.tensions.map((x) => `• ${x}`).join("\n"),
    );
  }
  if (s.next_question) {
    sections.push(`Вопрос на сессию:\n${s.next_question}`);
  }
  return sections.join("\n\n") || "За последние 7 дней наблюдений пока нет.";
}

async function miroCreateWeekly(
  env: Env,
  localDate: string,
): Promise<void> {
  if (!env.MIRO_ACCESS_TOKEN || !env.MIRO_BOARD_ID) return;

  const weekKey = isoWeek(localDate);
  const exists = await env.DB.prepare(
    "SELECT week_key FROM miro_weeks WHERE week_key = ? AND synced_at IS NOT NULL",
  )
    .bind(weekKey)
    .first();
  if (exists) return;

  const summary = await summarizeWeek(env);
  if (!summary.cards?.length) return;

  const start = weekStart(localDate);
  const end = addDays(start, 6);
  const focus = await getSetting(env, "weekly_focus", DEFAULT_FOCUS);

  const baseline = new Date(Date.UTC(2026, 9, 5));
  const current = new Date(`${start}T00:00:00Z`);
  const weekIndex = Math.max(
    0,
    Math.floor((current.getTime() - baseline.getTime()) / (7 * 86400000)),
  );
  const x = 23500;
  const y = 3000 + weekIndex * 1900;

  const frameResponse = await fetch(
    `https://api.miro.com/v2/boards/${encodeURIComponent(env.MIRO_BOARD_ID)}/frames`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.MIRO_ACCESS_TOKEN}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        data: {
          title: `НЕДЕЛЯ ${start}—${end} · СДВИГ`,
        },
        style: { fillColor: "#ffffff" },
        position: { x, y, origin: "center" },
        geometry: { width: 3200, height: 1450 },
      }),
    },
  );

  if (!frameResponse.ok) {
    const error = await frameResponse.text();
    await env.DB.prepare(
      `INSERT INTO miro_weeks(week_key, error)
       VALUES(?, ?)
       ON CONFLICT(week_key) DO UPDATE SET error = excluded.error`,
    )
      .bind(weekKey, trimText(error, 1800))
      .run();
    throw new Error(`Miro frame failed: ${frameResponse.status} ${error}`);
  }

  const frame: any = await frameResponse.json();
  const frameId = frame.id;

  const cards = summary.cards.slice(0, 5);
  const colors = [
    "light_yellow",
    "light_green",
    "light_blue",
    "gray",
    "light_yellow",
  ];

  for (let i = 0; i < cards.length; i++) {
    const px = x - 1120 + i * 560;
    const py = y + 60;
    const response = await fetch(
      `https://api.miro.com/v2/boards/${encodeURIComponent(env.MIRO_BOARD_ID)}/sticky_notes`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.MIRO_ACCESS_TOKEN}`,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          data: {
            content: htmlEscape(cards[i]),
            shape: "square",
          },
          style: {
            fillColor: colors[i],
            textAlign: "left",
            textAlignVertical: "top",
          },
          position: { x: px, y: py, origin: "center" },
          geometry: { width: 430 },
          parent: { id: frameId },
        }),
      },
    );

    if (!response.ok) {
      console.error(
        "Miro sticky failed",
        response.status,
        await response.text(),
      );
    }
  }

  const header = `Фокус: ${focus}`;
  await fetch(
    `https://api.miro.com/v2/boards/${encodeURIComponent(env.MIRO_BOARD_ID)}/texts`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.MIRO_ACCESS_TOKEN}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        data: { content: htmlEscape(header) },
        position: { x, y: y - 510, origin: "center" },
        parent: { id: frameId },
      }),
    },
  );

  await env.DB.prepare(
    `INSERT INTO miro_weeks(week_key, frame_id, synced_at, error)
     VALUES(?, ?, CURRENT_TIMESTAMP, NULL)
     ON CONFLICT(week_key) DO UPDATE SET
       frame_id = excluded.frame_id,
       synced_at = CURRENT_TIMESTAMP,
       error = NULL`,
  )
    .bind(weekKey, frameId)
    .run();
}

async function deliverPrompt(
  env: Env,
  kind: "morning" | "evening",
  localDate: string,
): Promise<void> {
  const chatId = await boundChat(env);
  if (!chatId) return;

  const deliveryKey = `${kind}:${localDate}`;
  const already = await env.DB.prepare(
    "SELECT 1 FROM prompt_deliveries WHERE delivery_key = ?",
  )
    .bind(deliveryKey)
    .first();
  if (already) return;

  const focus = await getSetting(env, "weekly_focus", DEFAULT_FOCUS);
  const practice = await getSetting(env, "weekly_practice", DEFAULT_PRACTICE);

  const text =
    kind === "morning"
      ? `Фокус сегодня:\n${focus}\n\nПрактика:\n${practice}`
      : `Что сегодня заметила про этот фокус?\n\nМожно написать или наговорить.\n\nФокус: ${focus}`;

  const sent = await sendMessage(env, chatId, text);

  await env.DB.prepare(
    `INSERT INTO prompt_deliveries
      (delivery_key, chat_id, kind, local_date, telegram_message_id, sent_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      deliveryKey,
      chatId,
      kind,
      localDate,
      sent.message_id,
      new Date().toISOString(),
    )
    .run();
}

async function runSchedule(env: Env): Promise<void> {
  const tz = env.TIME_ZONE || "Europe/Moscow";
  const now = new Date();
  const local = localParts(now, tz);
  const morning = await getSetting(
    env,
    "morning_time",
    env.DEFAULT_MORNING_TIME || "09:00",
  );
  const evening = await getSetting(
    env,
    "evening_time",
    env.DEFAULT_EVENING_TIME || "20:30",
  );
  const miroTime = await getSetting(
    env,
    "weekly_miro_time",
    env.DEFAULT_WEEKLY_MIRO_TIME || "21:00",
  );
  const miroDay = Number(
    await getSetting(
      env,
      "weekly_miro_day",
      env.DEFAULT_WEEKLY_MIRO_DAY || "0",
    ),
  );

  if (local.time === morning) {
    await deliverPrompt(env, "morning", local.date);
  }
  if (local.time === evening) {
    await deliverPrompt(env, "evening", local.date);
  }
  if (local.weekday === miroDay && local.time === miroTime) {
    await miroCreateWeekly(env, local.date);
  }
}

async function handleCommand(
  env: Env,
  message: TelegramMessage,
): Promise<boolean> {
  const text = message.text?.trim();
  if (!text?.startsWith("/")) return false;

  const [commandRaw, ...rest] = text.split(/\s+/);
  const command = commandRaw.split("@")[0].toLowerCase();
  const arg = rest.join(" ").trim();
  const chatId = String(message.chat.id);
  const currentBound = await boundChat(env);

  if (command === "/chatid") {
    await sendMessage(env, message.chat.id, `chat_id: ${message.chat.id}`);
    return true;
  }

  if (command === "/whoami") {
    await sendMessage(
      env,
      message.chat.id,
      `user_id: ${message.from?.id ?? "unknown"}`,
    );
    return true;
  }

  if (command === "/bind") {
    if (!arg || arg !== env.SETUP_CODE) {
      await sendMessage(env, message.chat.id, "Неверный код привязки.");
      return true;
    }
    if (currentBound && currentBound !== chatId) {
      await sendMessage(env, message.chat.id, "Бот уже привязан к другому чату.");
      return true;
    }
    await setSetting(env, "chat_id", chatId);
    await setSetting(env, "coach_user_id", String(message.from?.id ?? ""));
    await sendMessage(
      env,
      message.chat.id,
      "Готово. Этот чат теперь рабочий чат сопровождения.\n\n/focus — текущий фокус\n/log — записать наблюдение\n/summary — сводка за 7 дней",
    );
    return true;
  }

  if (!currentBound || currentBound !== chatId) {
    return true;
  }

  if (command === "/focus") {
    const focus = await getSetting(env, "weekly_focus", DEFAULT_FOCUS);
    const practice = await getSetting(
      env,
      "weekly_practice",
      DEFAULT_PRACTICE,
    );
    await sendMessage(
      env,
      message.chat.id,
      `Фокус недели:\n${focus}\n\nПрактика:\n${practice}`,
    );
    return true;
  }

  if (command === "/log") {
    if (!message.from) return true;
    await env.DB.prepare(
      `INSERT OR REPLACE INTO capture_sessions(chat_id, user_id, expires_at)
       VALUES (?, ?, ?)`,
    )
      .bind(
        chatId,
        String(message.from.id),
        Math.floor(Date.now() / 1000) + 15 * 60,
      )
      .run();
    await sendMessage(
      env,
      message.chat.id,
      "Готов. Следующее сообщение или голосовое сохраню как наблюдение.",
    );
    return true;
  }

  if (command === "/summary") {
    const summary = await summarizeWeek(env);
    await sendMessage(env, message.chat.id, summaryText(summary));
    return true;
  }

  if (command === "/setfocus") {
    if (!(await isCoach(env, message.from?.id))) {
      await sendMessage(env, message.chat.id, "Эту команду меняет только коуч.");
      return true;
    }
    if (!arg) {
      await sendMessage(
        env,
        message.chat.id,
        "Использование: /setfocus текст фокуса недели",
      );
      return true;
    }
    await setSetting(env, "weekly_focus", arg);
    await sendMessage(env, message.chat.id, "Фокус недели обновлён.");
    return true;
  }

  if (command === "/setpractice") {
    if (!(await isCoach(env, message.from?.id))) {
      await sendMessage(env, message.chat.id, "Эту команду меняет только коуч.");
      return true;
    }
    if (!arg) {
      await sendMessage(
        env,
        message.chat.id,
        "Использование: /setpractice короткая практика недели",
      );
      return true;
    }
    await setSetting(env, "weekly_practice", arg);
    await sendMessage(env, message.chat.id, "Практика недели обновлена.");
    return true;
  }

  if (command === "/settime") {
    if (!(await isCoach(env, message.from?.id))) {
      await sendMessage(env, message.chat.id, "Эту команду меняет только коуч.");
      return true;
    }
    const [morning, evening] = rest;
    if (!isValidHHMM(morning || "") || !isValidHHMM(evening || "")) {
      await sendMessage(
        env,
        message.chat.id,
        "Использование: /settime 09:00 20:30\nМинуты должны быть 00, 15, 30 или 45.",
      );
      return true;
    }
    await setSetting(env, "morning_time", morning);
    await setSetting(env, "evening_time", evening);
    await sendMessage(
      env,
      message.chat.id,
      `Готово. Утро: ${morning}, вечер: ${evening} (${env.TIME_ZONE || "Europe/Moscow"}).`,
    );
    return true;
  }

  if (command === "/setclient") {
    if (!(await isCoach(env, message.from?.id))) return true;
    if (!arg) {
      await sendMessage(
        env,
        message.chat.id,
        "Использование: /setclient Имя клиента",
      );
      return true;
    }
    await setSetting(env, "client_label", arg);
    await setSetting(
      env,
      "obsidian_base_path",
      `Clients/${arg}/Наблюдения`,
    );
    await sendMessage(env, message.chat.id, "Имя клиента обновлено.");
    return true;
  }

  if (command === "/status") {
    if (!(await isCoach(env, message.from?.id))) return true;
    await sendMessage(env, message.chat.id, await statusText(env));
    return true;
  }

  if (command === "/syncmiro") {
    if (!(await isCoach(env, message.from?.id))) return true;
    const local = localParts(
      new Date(),
      env.TIME_ZONE || "Europe/Moscow",
    );
    await miroCreateWeekly(env, local.date);
    await sendMessage(env, message.chat.id, "Недельный синтез Miro проверен.");
    return true;
  }

  if (command === "/obsidiantoken") {
    if (!(await isCoach(env, message.from?.id))) return true;
    if (message.chat.type !== "private") {
      await sendMessage(
        env,
        message.chat.id,
        "Эту команду отправь боту в личном чате — токен не должен видеть групповой чат.",
      );
      return true;
    }
    let token = await getSetting(env, "obsidian_sync_token", "");
    if (!token) {
      token = randomToken(24);
      await setSetting(env, "obsidian_sync_token", token);
    }
    await sendMessage(
      env,
      message.chat.id,
      [
        "Токен Obsidian Sync:",
        token,
        "",
        "Вставь его в настройках плагина Coach Reflection Sync.",
      ].join("\n"),
    );
    return true;
  }

  if (command === "/help") {
    await sendMessage(
      env,
      message.chat.id,
      [
        "/focus — фокус и практика недели",
        "/log — следующее сообщение/голосовое = наблюдение",
        "/summary — сводка последних 7 дней",
        "/setfocus — изменить фокус (коуч)",
        "/setpractice — изменить практику (коуч)",
        "/settime — время утро/вечер (коуч)",
        "/status — статус интеграций (коуч)",
        "/syncmiro — собрать недельный Miro сейчас (коуч)",
        "/obsidiantoken — токен синхронизации Obsidian, только в личке (коуч)",
        "/whoami — Telegram user ID",
        "",
        "Обычный разговор бот не комментирует.",
      ].join("\n"),
    );
    return true;
  }

  return true;
}

async function handleTelegramUpdate(
  env: Env,
  update: TelegramUpdate,
): Promise<void> {
  const message = update.message;
  if (!message || !message.from) return;

  if (await handleCommand(env, message)) return;

  const currentBound = await boundChat(env);
  if (!currentBound || currentBound !== String(message.chat.id)) return;

  if (await completeFollowup(env, message)) return;

  const text = message.text?.trim() || "";
  const prefixed = /^(?:#?наблюдение)\s*[:—-]?/i.test(text);
  const replyToPrompt = await promptReply(env, message);
  const pending = await pendingCapture(env, message);

  if (!prefixed && !replyToPrompt && !pending) {
    return;
  }

  await clearCapture(env, message);

  if (!message.text && !message.voice) {
    await sendMessage(
      env,
      message.chat.id,
      "Сейчас сохраняю текст и голосовые. Ответьте текстом или голосом.",
      message.message_id,
    );
    return;
  }

  await processObservationMessage(env, message);
}

async function bootstrap(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";

  if (!code || code !== env.SETUP_CODE) {
    return new Response("Forbidden", { status: 403 });
  }

  const webhookUrl = `${url.origin}/telegram`;
  const secret = await telegramWebhookSecret(env);

  await telegram(env, "setWebhook", {
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });

  return new Response(
    [
      "Telegram webhook is ready.",
      "",
      "Next:",
      "1. Add the bot to the private coaching group.",
      "2. In that group send: /bind <your SETUP_CODE>",
      "3. Then send /focus.",
    ].join("\n"),
    { headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}

async function statusText(env: Env): Promise<string> {
  const chatId = await boundChat(env);
  const focus = await getSetting(env, "weekly_focus", DEFAULT_FOCUS);
  const practice = await getSetting(
    env,
    "weekly_practice",
    DEFAULT_PRACTICE,
  );
  const morning = await getSetting(env, "morning_time", "09:00");
  const evening = await getSetting(env, "evening_time", "20:30");

  return [
    "Статус:",
    `Чат привязан: ${chatId ? "да" : "нет"}`,
    `Notion: ${env.NOTION_TOKEN && env.NOTION_DATA_SOURCE_ID ? "подключен" : "нет"}`,
    `Miro: ${env.MIRO_ACCESS_TOKEN && env.MIRO_BOARD_ID ? "подключен" : "нет"}`,
    `Утро: ${morning}`,
    `Вечер: ${evening}`,
    `Часовой пояс: ${env.TIME_ZONE || "Europe/Moscow"}`,
    "",
    `Фокус: ${focus}`,
    `Практика: ${practice}`,
  ].join("\n");
}

function markdownEntry(row: any): string {
  const chunks = [
    `### ${row.local_date} — ${row.zone}`,
    `**Фокус:** ${row.focus}`,
  ];
  if (row.situation) chunks.push(`**Ситуация:** ${row.situation}`);
  if (row.impulse) chunks.push(`**Импульс:** ${row.impulse}`);
  if (row.action) chunks.push(`**Действие:** ${row.action}`);
  if (row.alternative) chunks.push(`**Альтернатива:** ${row.alternative}`);
  if (row.other_action) {
    chunks.push(`**Что сделал другой:** ${row.other_action}`);
  }
  if (row.result) chunks.push(`**Результат:** ${row.result}`);
  return chunks.join("\n") + "\n";
}

async function obsidianExport(
  request: Request,
  env: Env,
): Promise<Response> {
  const expectedToken = await getSetting(env, "obsidian_sync_token", "");
  if (!expectedToken || bearer(request) !== expectedToken) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const weeks = Math.min(
    4,
    Math.max(1, Number(url.searchParams.get("weeks") || "2")),
  );
  const local = localParts(
    new Date(),
    env.TIME_ZONE || "Europe/Moscow",
  );
  const basePath = await getSetting(
    env,
    "obsidian_base_path",
    "Clients/Client/Наблюдения",
  );
  const client = await getSetting(env, "client_label", "Client");
  const files: Array<{ path: string; content: string }> = [];

  let cursor = weekStart(local.date);
  for (let i = 0; i < weeks; i++) {
    const start = addDays(cursor, -7 * i);
    const end = addDays(start, 6);
    const key = isoWeek(start);

    const rows = await env.DB.prepare(
      `SELECT local_date, focus, situation, impulse, action,
              alternative, other_action, result, zone
         FROM observations
         WHERE local_date >= ? AND local_date <= ?
         ORDER BY created_at ASC`,
    )
      .bind(start, end)
      .all<any>();

    const items = rows.results || [];
    const content = [
      "---",
      `client: "${client.replaceAll('"', "'")}"`,
      `week: "${key}"`,
      'source: "Telegram Coach Bot"',
      "type: coaching-observations",
      "---",
      "",
      `# ${client} — наблюдения — ${key}`,
      "",
      `Период: ${start} — ${end}`,
      "",
      items.length
        ? items.map(markdownEntry).join("\n")
        : "_Наблюдений за эту неделю пока нет._\n",
    ].join("\n");

    files.push({
      path: `${basePath}/${key}.md`,
      content,
    });
  }

  return json({ ok: true, files });
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "coach-reflection-bot" });
    }

    if (
      request.method === "GET" &&
      url.pathname === "/bootstrap"
    ) {
      return bootstrap(request, env);
    }

    if (
      request.method === "GET" &&
      url.pathname === "/obsidian/export"
    ) {
      return obsidianExport(request, env);
    }

    if (
      request.method === "POST" &&
      url.pathname === "/telegram"
    ) {
      const secret = request.headers.get(
        "x-telegram-bot-api-secret-token",
      );
      if (secret !== (await telegramWebhookSecret(env))) {
        return new Response("Forbidden", { status: 403 });
      }

      const update = (await request.json()) as TelegramUpdate;
      ctx.waitUntil(handleTelegramUpdate(env, update));
      return new Response("ok");
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(runSchedule(env));
  },
} satisfies ExportedHandler<Env>;
