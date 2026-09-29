// The tables Memoir keeps on the phone, in one SQLite file that never leaves it.
//
//   items         every note and diary day, in your own words, with what Memoir worked out
//                 about it (people, a to-do in it). Older versions also saved links and photos.
//   todos         to-dos and dated reminders, each one pointing back to what you said
//   list_items    shopping, packing and any other list you keep
//   habits        things you do on a schedule, with habit_logs holding a tick per day
//   agent_log     what you told Memoir and what it did, so it can undo or be corrected
//   item_vectors  each item's meaning, for finding notes by meaning
//   meta          settings and what Memoir has learned about the way you talk
//
// user_version is SQLite's own schema number, so later versions of the app can
// add columns without losing anything already saved. Each step below runs once.

/** The small part of expo-sqlite that Memoir uses. Tests pass in a Node SQLite with the same shape. */
export interface Db {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: unknown[]): Promise<{ lastInsertRowId: number; changes: number }>;
  getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
}

export const SCHEMA_VERSION = 4;

// Version 1. The first tables.
const V1 = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  url TEXT,
  source TEXT NOT NULL,
  photo_uri TEXT,
  category TEXT NOT NULL,
  scope TEXT NOT NULL,
  people TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS items_created ON items (created_at DESC);
CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER REFERENCES items (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_at INTEGER,
  done_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS todos_open ON todos (done_at, due_at);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`;

// Version 2. Meanings from the word model.
const V2 = `
CREATE TABLE IF NOT EXISTS item_meanings (
  item_id INTEGER PRIMARY KEY REFERENCES items (id) ON DELETE CASCADE,
  model INTEGER NOT NULL,
  vector TEXT NOT NULL
);
`;

// Version 3. What Memoir read from a link's page, your own note, whether you have checked a
// saved link yet, and meanings from more than one model. Links saved before this start as
// "to check" and get their page read the next time the phone is online.
const V3 = `
ALTER TABLE items ADD COLUMN note TEXT NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN page_title TEXT NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN page_text TEXT NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN page_author TEXT NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN page_image TEXT;
ALTER TABLE items ADD COLUMN page_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE items ADD COLUMN page_tries INTEGER NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN page_read_at INTEGER;
ALTER TABLE items ADD COLUMN check_state TEXT NOT NULL DEFAULT 'none';
ALTER TABLE items ADD COLUMN check_after INTEGER;
ALTER TABLE items ADD COLUMN checked_at INTEGER;
ALTER TABLE items ADD COLUMN category_locked INTEGER NOT NULL DEFAULT 0;
UPDATE items SET page_status = 'pending', check_state = 'to_check' WHERE kind = 'link';
CREATE INDEX IF NOT EXISTS items_check ON items (check_state, check_after);
DROP TRIGGER IF EXISTS items_ai;
DROP TRIGGER IF EXISTS items_ad;
DROP TRIGGER IF EXISTS items_au;
DROP TABLE IF EXISTS items_fts;
DROP TABLE IF EXISTS item_meanings;
CREATE TABLE IF NOT EXISTS item_vectors (
  item_id INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  vector TEXT NOT NULL,
  PRIMARY KEY (item_id, model)
);
`;

// Version 4. The assistant: lists, habits with a tick per day, and a log of what it did for you,
// so "undo" and "that was my diary, not a note" can put things right. `hidden` marks the words
// behind a reminder ("remind me to call Amma at 7"). They stay searchable for answers, but the
// Notes page shows only real notes.
const V4 = `
ALTER TABLE items ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS list_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list TEXT NOT NULL,
  text TEXT NOT NULL,
  done_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS list_items_list ON list_items (list, done_at);
CREATE TABLE IF NOT EXISTS habits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  days TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
  hour INTEGER,
  minute INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS habit_logs (
  habit_id INTEGER NOT NULL REFERENCES habits (id) ON DELETE CASCADE,
  day INTEGER NOT NULL,
  PRIMARY KEY (habit_id, day)
);
ALTER TABLE todos ADD COLUMN repeat TEXT;
CREATE TABLE IF NOT EXISTS agent_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  input TEXT NOT NULL,
  kind TEXT NOT NULL,
  reply TEXT NOT NULL,
  undo TEXT NOT NULL DEFAULT '[]',
  undone INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`;

// Full-text search, like a tiny search engine inside the file. "porter" matches word
// forms, so "hike" finds "hiking". If a phone's SQLite lacks it, Memoir falls back to LIKE.
const COLUMNS = 'title, text, note, page_title, page_text, page_author, tags, people, category, source';
const NEW = COLUMNS.split(', ').map((c) => `new.${c}`).join(', ');
const OLD = COLUMNS.split(', ').map((c) => `old.${c}`).join(', ');

/** How much a match in each column counts, in the order above. A title match says the most. */
export const SEARCH_WEIGHTS = [6, 3, 4, 5, 3, 3, 4, 4, 2, 2];

const SEARCH = `
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  ${COLUMNS},
  content = 'items', content_rowid = 'id', tokenize = 'porter unicode61'
);
CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts (rowid, ${COLUMNS}) VALUES (new.id, ${NEW});
END;
CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
  INSERT INTO items_fts (items_fts, rowid, ${COLUMNS}) VALUES ('delete', old.id, ${OLD});
END;
CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
  INSERT INTO items_fts (items_fts, rowid, ${COLUMNS}) VALUES ('delete', old.id, ${OLD});
  INSERT INTO items_fts (rowid, ${COLUMNS}) VALUES (new.id, ${NEW});
END;
`;

export async function migrate(db: Db): Promise<{ fullText: boolean }> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  if (version < 1) await db.execAsync(V1);
  if (version < 2) await db.execAsync(V2);
  if (version < 3) await db.execAsync(V3);
  if (version < 4) await db.execAsync(V4);
  if (version < SCHEMA_VERSION) await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  // Foreign keys are switched on per connection, so every time the app opens.
  await db.execAsync('PRAGMA foreign_keys = ON');
  let fullText = true;
  try {
    await db.execAsync(SEARCH);
    // The search index was rebuilt with new columns, so fill it from what is already saved.
    if (version < 3) await db.execAsync("INSERT INTO items_fts (items_fts) VALUES ('rebuild')");
  } catch {
    fullText = false;
  }
  await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['full_text', fullText ? '1' : '0']);
  return { fullText };
}
