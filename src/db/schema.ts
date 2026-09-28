// The tables Memoir keeps on the phone, in one SQLite file that never leaves it.
//
//   items   every note, link and photo, with what Memoir worked out about it
//   todos   the to-do list, each one pointing back to the item it came from
//   meta    small settings, like whether full-text search is available
//   item_meanings  each item's meaning from the on-phone model, for search by meaning
//
// user_version is SQLite's own schema number, so later versions of the app can
// add columns without losing anything already saved.

/** The small part of expo-sqlite that Memoir uses. Tests pass in a Node SQLite with the same shape. */
export interface Db {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: unknown[]): Promise<{ lastInsertRowId: number; changes: number }>;
  getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
}

export const SCHEMA_VERSION = 2;

const TABLES = `
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

// Version 2. The model's version is kept with each row, so a newer model can redo them.
const MEANINGS = `
CREATE TABLE IF NOT EXISTS item_meanings (
  item_id INTEGER PRIMARY KEY REFERENCES items (id) ON DELETE CASCADE,
  model INTEGER NOT NULL,
  vector TEXT NOT NULL
);
`;

// Full-text search, like a tiny search engine inside the file. "porter" matches word
// forms, so "hike" finds "hiking". If a phone's SQLite lacks it, Memoir falls back to LIKE.
const SEARCH = `
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  title, text, tags, people, category, source,
  content = 'items', content_rowid = 'id', tokenize = 'porter unicode61'
);
CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts (rowid, title, text, tags, people, category, source)
  VALUES (new.id, new.title, new.text, new.tags, new.people, new.category, new.source);
END;
CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
  INSERT INTO items_fts (items_fts, rowid, title, text, tags, people, category, source)
  VALUES ('delete', old.id, old.title, old.text, old.tags, old.people, old.category, old.source);
END;
CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
  INSERT INTO items_fts (items_fts, rowid, title, text, tags, people, category, source)
  VALUES ('delete', old.id, old.title, old.text, old.tags, old.people, old.category, old.source);
  INSERT INTO items_fts (rowid, title, text, tags, people, category, source)
  VALUES (new.id, new.title, new.text, new.tags, new.people, new.category, new.source);
END;
`;

export async function migrate(db: Db): Promise<{ fullText: boolean }> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  if (version < 1) await db.execAsync(TABLES);
  if (version < 2) await db.execAsync(MEANINGS);
  if (version < SCHEMA_VERSION) await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  // Foreign keys are switched on per connection, so every time the app opens.
  await db.execAsync('PRAGMA foreign_keys = ON');
  let fullText = true;
  try {
    await db.execAsync(SEARCH);
  } catch {
    fullText = false;
  }
  await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['full_text', fullText ? '1' : '0']);
  return { fullText };
}
