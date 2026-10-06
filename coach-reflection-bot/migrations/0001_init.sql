-- Cloudflare D1 schema for the Telegram coaching reflection bot.

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS raw_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT,
  source TEXT NOT NULL,
  raw_text TEXT,
  telegram_file_id TEXT,
  created_at TEXT NOT NULL,
  processed_at TEXT,
  process_error TEXT,
  UNIQUE(chat_id, message_id)
);

CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_message_id INTEGER,
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  local_date TEXT NOT NULL,
  focus TEXT NOT NULL,
  situation TEXT NOT NULL DEFAULT '',
  impulse TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  alternative TEXT NOT NULL DEFAULT '',
  other_action TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT '',
  zone TEXT NOT NULL DEFAULT 'Неясно',
  follow_up_question TEXT NOT NULL DEFAULT '',
  notion_page_id TEXT,
  notion_synced_at TEXT,
  notion_error TEXT,
  FOREIGN KEY(raw_message_id) REFERENCES raw_messages(id)
);

CREATE INDEX IF NOT EXISTS idx_observations_chat_date
  ON observations(chat_id, local_date);

CREATE TABLE IF NOT EXISTS prompt_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_key TEXT NOT NULL UNIQUE,
  chat_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  local_date TEXT NOT NULL,
  telegram_message_id INTEGER,
  sent_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prompt_message
  ON prompt_deliveries(chat_id, telegram_message_id);

CREATE TABLE IF NOT EXISTS capture_sessions (
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS followups (
  observation_id INTEGER PRIMARY KEY,
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  bot_message_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY(observation_id) REFERENCES observations(id)
);

CREATE TABLE IF NOT EXISTS miro_weeks (
  week_key TEXT PRIMARY KEY,
  frame_id TEXT,
  synced_at TEXT,
  error TEXT
);

INSERT OR IGNORE INTO settings(key, value) VALUES
  ('weekly_focus', 'Не забирать решение, которое человек уже способен принять сам.'),
  ('weekly_practice', 'Прежде чем давать ответ, спросить: «Что ты намерен сделать?»'),
  ('morning_time', '09:00'),
  ('evening_time', '20:30'),
  ('weekly_miro_day', '0'),
  ('weekly_miro_time', '21:00'),
  ('client_label', 'Клиент'),
  ('obsidian_base_path', 'Clients/Client/Наблюдения');
