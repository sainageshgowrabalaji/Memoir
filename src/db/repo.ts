// Saving, listing, searching and to-dos. Every function takes the database as its first
// argument, like a DAO in Java, so the same code runs on the phone and in tests.

import { analyze, meaningText, type Capture, type Kind, type Scope } from '../brain/analyze';
import type { CategoryId } from '../brain/categories';
import type { Source } from '../brain/links';
import { embed, MODEL_VERSION, packVector, similarity, unpackVector } from '../brain/meaning';
import type { Query } from '../brain/query';
import type { OpenTodo } from '../brain/reminders';
import type { Db } from './schema';

export type Item = {
  id: number;
  kind: Kind;
  title: string;
  text: string;
  url: string | null;
  source: Source;
  photoUri: string | null;
  category: CategoryId;
  scope: Scope;
  people: string[];
  tags: string[];
  createdAt: number;
  updatedAt: number;
};

export type Todo = {
  id: number;
  itemId: number | null;
  title: string;
  dueAt: number | null;
  doneAt: number | null;
  createdAt: number;
};

type ItemRow = {
  id: number;
  kind: Kind;
  title: string;
  text: string;
  url: string | null;
  source: Source;
  photo_uri: string | null;
  category: CategoryId;
  scope: Scope;
  people: string;
  tags: string;
  created_at: number;
  updated_at: number;
};

type TodoRow = { id: number; item_id: number | null; title: string; due_at: number | null; done_at: number | null; created_at: number };

function list(json: string): string[] {
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

export function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    text: row.text,
    url: row.url,
    source: row.source,
    photoUri: row.photo_uri,
    category: row.category,
    scope: row.scope,
    people: list(row.people),
    tags: list(row.tags),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTodo(row: TodoRow): Todo {
  return { id: row.id, itemId: row.item_id, title: row.title, dueAt: row.due_at, doneAt: row.done_at, createdAt: row.created_at };
}

// ------------------------------------------------------------ saving

export type Saved = { item: Item; todo: Todo | null };

/** Save anything. `asTodo` forces a to-do even without words like "I want to". */
export async function saveCapture(db: Db, capture: Capture, now = new Date(), asTodo = false): Promise<Saved> {
  const a = analyze(capture, now);
  const at = now.getTime();
  const { lastInsertRowId: id } = await db.runAsync(
    `INSERT INTO items (kind, title, text, url, source, photo_uri, category, scope, people, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [a.kind, a.title, a.text, a.url, a.source, capture.photoUri ?? null, a.category, a.scope,
      JSON.stringify(a.people), JSON.stringify(a.tags), at, at],
  );
  if (a.meaning) await saveMeaning(db, id, a.meaning);
  let todo: Todo | null = null;
  const todoGuess = a.todo ?? (asTodo ? { title: a.title, dueAt: null, dateText: null } : null);
  if (todoGuess) {
    const result = await db.runAsync('INSERT INTO todos (item_id, title, due_at, done_at, created_at) VALUES (?, ?, ?, NULL, ?)', [
      id, todoGuess.title, todoGuess.dueAt, at,
    ]);
    todo = { id: result.lastInsertRowId, itemId: id, title: todoGuess.title, dueAt: todoGuess.dueAt, doneAt: null, createdAt: at };
  }
  const item = await getItem(db, id);
  if (!item) throw new Error('The item was not saved.');
  return { item, todo };
}

async function saveMeaning(db: Db, itemId: number, meaning: Float32Array) {
  await db.runAsync('INSERT OR REPLACE INTO item_meanings (item_id, model, vector) VALUES (?, ?, ?)', [
    itemId, MODEL_VERSION, packVector(meaning),
  ]);
}

/**
 * Works out the meaning of anything saved before the model existed, or with an older model.
 * Runs when the app opens. Returns how many items it filled in.
 */
export async function fillMeanings(db: Db): Promise<number> {
  const rows = await db.getAllAsync<ItemRow>(
    `SELECT items.* FROM items LEFT JOIN item_meanings ON item_meanings.item_id = items.id
     WHERE item_meanings.item_id IS NULL OR item_meanings.model != ?`,
    [MODEL_VERSION],
  );
  let filled = 0;
  for (const row of rows) {
    const item = toItem(row);
    const meaning = embed(meaningText(item.text, item.url, item.people));
    if (!meaning) continue;
    await saveMeaning(db, item.id, meaning);
    filled++;
  }
  return filled;
}

// ------------------------------------------------------------ reading

export async function getItem(db: Db, id: number): Promise<Item | null> {
  const row = await db.getFirstAsync<ItemRow>('SELECT * FROM items WHERE id = ?', [id]);
  return row ? toItem(row) : null;
}

export type ListFilter = { category?: CategoryId | null; scope?: Scope | null; kind?: Kind | null; limit?: number; before?: number | null };

export async function listItems(db: Db, filter: ListFilter = {}): Promise<Item[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.category) {
    where.push('category = ?');
    params.push(filter.category);
  }
  if (filter.scope) {
    where.push('scope = ?');
    params.push(filter.scope);
  }
  if (filter.kind) {
    where.push('kind = ?');
    params.push(filter.kind);
  }
  if (filter.before) {
    where.push('created_at < ?');
    params.push(filter.before);
  }
  params.push(filter.limit ?? 100);
  const rows = await db.getAllAsync<ItemRow>(
    `SELECT * FROM items ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`,
    params,
  );
  return rows.map(toItem);
}

export async function knownPeople(db: Db): Promise<string[]> {
  const rows = await db.getAllAsync<{ people: string }>("SELECT people FROM items WHERE people != '[]'");
  return [...new Set(rows.flatMap((r) => list(r.people)))];
}

export type Shelf = { category: CategoryId; count: number };

/** How many things sit on each shelf, most first. Shown as "What you save most". */
export async function shelves(db: Db, since: number | null = null): Promise<Shelf[]> {
  const rows = await db.getAllAsync<{ category: CategoryId; count: number }>(
    `SELECT category, COUNT(*) AS count FROM items ${since ? 'WHERE created_at >= ?' : ''} GROUP BY category ORDER BY count DESC`,
    since ? [since] : [],
  );
  return rows.map((r) => ({ category: r.category, count: Number(r.count) }));
}

/** One older thing to bring back, the same one all day, so opening the app twice feels calm. */
export async function fromYourPast(db: Db, now = new Date()): Promise<Item | null> {
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const count = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM items WHERE created_at < ?', [weekAgo]);
  const n = Number(count?.n ?? 0);
  if (!n) return null;
  const day = Math.floor(now.getTime() / (24 * 60 * 60 * 1000));
  const row = await db.getFirstAsync<ItemRow>('SELECT * FROM items WHERE created_at < ? ORDER BY id LIMIT 1 OFFSET ?', [weekAgo, day % n]);
  return row ? toItem(row) : null;
}

// ------------------------------------------------------------ changing

export async function updateItem(db: Db, id: number, patch: { category?: CategoryId; scope?: Scope }, now = new Date()) {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.category) {
    sets.push('category = ?');
    params.push(patch.category);
  }
  if (patch.scope) {
    sets.push('scope = ?');
    params.push(patch.scope);
  }
  if (!sets.length) return;
  sets.push('updated_at = ?');
  params.push(now.getTime(), id);
  await db.runAsync(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`, params);
}

/** Deletes an item and its to-do. Returns the photo file so the caller can delete it too. */
export async function deleteItem(db: Db, id: number): Promise<string | null> {
  const row = await db.getFirstAsync<{ photo_uri: string | null }>('SELECT photo_uri FROM items WHERE id = ?', [id]);
  await db.runAsync('DELETE FROM todos WHERE item_id = ?', [id]);
  await db.runAsync('DELETE FROM item_meanings WHERE item_id = ?', [id]);
  await db.runAsync('DELETE FROM items WHERE id = ?', [id]);
  return row?.photo_uri ?? null;
}

// ------------------------------------------------------------ searching

/** `close` means it was found by meaning, not by your words, and the screen says so. */
export type Found = { item: Item; matched: string[]; close: boolean };
export type SearchResult = { found: Found[]; loose: boolean };

type Scored = Found & { score: number };

async function fullTextOn(db: Db): Promise<boolean> {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM meta WHERE key = 'full_text'");
  return row?.value === '1';
}

function ftsExpression(terms: string[]): string {
  return terms.map((t) => `"${t.replace(/"/g, '')}"*`).join(' OR ');
}

function filtersSql(query: Query, strict: boolean): { where: string[]; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (!strict) return { where, params };
  if (query.from !== null) {
    where.push('items.created_at >= ?');
    params.push(query.from);
  }
  if (query.to !== null) {
    where.push('items.created_at < ?');
    params.push(query.to);
  }
  if (query.kinds.length) {
    where.push(`items.kind IN (${query.kinds.map(() => '?').join(', ')})`);
    params.push(...query.kinds);
  }
  if (query.sources.length) {
    where.push(`items.source IN (${query.sources.map(() => '?').join(', ')})`);
    params.push(...query.sources);
  }
  for (const person of query.people) {
    where.push('items.people LIKE ?');
    params.push(`%"${person}"%`);
  }
  if (query.todosOnly) where.push('items.id IN (SELECT item_id FROM todos WHERE item_id IS NOT NULL)');
  return { where, params };
}

function coverage(item: Item, terms: string[]): string[] {
  const haystack = `${item.title} ${item.text} ${item.tags.join(' ')} ${item.people.join(' ')} ${item.category} ${item.source}`.toLowerCase();
  // A short stem, so "hiking" counts for "hike" the way full-text search already does.
  return terms.filter((t) => haystack.includes(t.length > 4 ? t.slice(0, t.length - 2) : t));
}

/** Things that contain your words (or, with no words, match your filters), best first. */
async function byWords(db: Db, query: Query, strict: boolean, limit: number): Promise<Scored[]> {
  const { where, params } = filtersSql(query, strict);
  let rows: ItemRow[];
  if (query.terms.length && (await fullTextOn(db))) {
    rows = await db.getAllAsync<ItemRow>(
      `SELECT items.* FROM items_fts JOIN items ON items.id = items_fts.rowid
       WHERE items_fts MATCH ? ${where.length ? `AND ${where.join(' AND ')}` : ''}
       ORDER BY bm25(items_fts, 6.0, 3.0, 4.0, 4.0, 2.0, 2.0) LIMIT ?`,
      [ftsExpression(query.terms), ...params, limit * 2],
    );
  } else if (query.terms.length) {
    const likes = query.terms.map(() => '(items.title LIKE ? OR items.text LIKE ? OR items.tags LIKE ? OR items.people LIKE ?)');
    const likeParams = query.terms.flatMap((t) => Array(4).fill(`%${t}%`));
    rows = await db.getAllAsync<ItemRow>(
      `SELECT * FROM items WHERE (${likes.join(' OR ')}) ${where.length ? `AND ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC LIMIT ?`,
      [...likeParams, ...params, limit * 2],
    );
  } else {
    if (!strict) return [];
    rows = await db.getAllAsync<ItemRow>(
      `SELECT * FROM items ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`,
      [...params, limit],
    );
  }

  const now = Date.now();
  return rows.map((row, rank) => {
    const item = toItem(row);
    const matched = coverage(item, query.terms);
    const categoryHit = query.categories.includes(item.category) ? 1 : 0;
    const ageDays = (now - item.createdAt) / (24 * 60 * 60 * 1000);
    // More of your words matched first, then the search engine's own order, then newer things.
    const score = matched.length * 10 + categoryHit * 3 - rank * 0.1 - Math.min(ageDays, 365) * 0.002;
    return { item, matched, close: false, score };
  });
}

// How alike a question and an item must be to show an item that has none of the question's words.
// Unrelated pairs score below 0.4 nineteen times out of twenty, so this keeps guesses out.
const CLOSE_ALONE = 0.45;
// When your words already found things, only strong matches by meaning join them.
const CLOSE_BESIDE = 0.55;
const MAX_CLOSE = 5;

/** How close every candidate item is to the question's meaning, by item id. */
async function byMeaning(db: Db, query: Query, strict: boolean): Promise<Map<number, { row: ItemRow; similarity: number }>> {
  const scores = new Map<number, { row: ItemRow; similarity: number }>();
  const question = query.meaning ? embed(query.meaning) : null;
  if (!question) return scores;
  const { where, params } = filtersSql(query, strict);
  const rows = await db.getAllAsync<ItemRow & { vector: string }>(
    `SELECT items.*, item_meanings.vector FROM items JOIN item_meanings ON item_meanings.item_id = items.id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY items.created_at DESC LIMIT 5000`,
    params,
  );
  for (const row of rows) scores.set(row.id, { row, similarity: similarity(question, unpackVector(row.vector)) });
  return scores;
}

async function runSearch(db: Db, query: Query, strict: boolean, limit: number): Promise<Found[]> {
  const [words, meanings] = await Promise.all([byWords(db, query, strict, limit), byMeaning(db, query, strict)]);
  // Among things that share your words, the ones closer in meaning rise.
  for (const found of words) found.score += (meanings.get(found.item.id)?.similarity ?? 0) * 6;

  const seen = new Set(words.map((f) => f.item.id));
  const floor = words.length ? CLOSE_BESIDE : CLOSE_ALONE;
  const candidates = [...meanings.values()].filter((m) => !seen.has(m.row.id) && m.similarity >= floor);
  const best = Math.max(0, ...candidates.map((m) => m.similarity));
  const close: Scored[] = candidates
    .filter((m) => m.similarity >= best - 0.12)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, MAX_CLOSE)
    .map((m) => ({ item: toItem(m.row), matched: [], close: true, score: m.similarity * 6 }));

  return [...words.sort((a, b) => b.score - a.score), ...close]
    .slice(0, limit)
    .map(({ item, matched, close: isClose }) => ({ item, matched, close: isClose }));
}

/**
 * Answers a question from your saved things, by your words and by meaning. If the filters you
 * said (like "last week") find nothing, it tries again without them and says so.
 */
export async function search(db: Db, query: Query, limit = 20): Promise<SearchResult> {
  const found = await runSearch(db, query, true, limit);
  if (found.length || !(query.terms.length || query.meaning)) return { found, loose: false };
  const nearby = await runSearch(db, query, false, limit);
  return { found: nearby, loose: nearby.length > 0 };
}

// Close enough to show as "Like this" on an item's page.
const RELATED = 0.6;

/** Other things you saved that mean something similar, closest first. */
export async function related(db: Db, itemId: number, limit = 3): Promise<Item[]> {
  const own = await db.getFirstAsync<{ vector: string }>('SELECT vector FROM item_meanings WHERE item_id = ?', [itemId]);
  if (!own) return [];
  const target = unpackVector(own.vector);
  const rows = await db.getAllAsync<ItemRow & { vector: string }>(
    `SELECT items.*, item_meanings.vector FROM items JOIN item_meanings ON item_meanings.item_id = items.id
     WHERE items.id != ? ORDER BY items.created_at DESC LIMIT 5000`,
    [itemId],
  );
  return rows
    .map((row) => ({ row, similarity: similarity(target, unpackVector(row.vector)) }))
    .filter((r) => r.similarity >= RELATED)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
    .map((r) => toItem(r.row));
}

// ------------------------------------------------------------ to-dos

export async function listTodos(db: Db, open: boolean): Promise<Todo[]> {
  const rows = await db.getAllAsync<TodoRow>(
    open
      ? 'SELECT * FROM todos WHERE done_at IS NULL ORDER BY due_at IS NULL, due_at, created_at DESC'
      : 'SELECT * FROM todos WHERE done_at IS NOT NULL ORDER BY done_at DESC LIMIT 50',
  );
  return rows.map(toTodo);
}

export async function openTodosForReminders(db: Db): Promise<OpenTodo[]> {
  return (await listTodos(db, true)).map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt, createdAt: t.createdAt }));
}

export async function setTodoDone(db: Db, id: number, done: boolean, now = new Date()) {
  await db.runAsync('UPDATE todos SET done_at = ? WHERE id = ?', [done ? now.getTime() : null, id]);
}

export async function setTodoDue(db: Db, id: number, dueAt: number | null) {
  await db.runAsync('UPDATE todos SET due_at = ? WHERE id = ?', [dueAt, id]);
}

export async function makeTodo(db: Db, item: Item, now = new Date()): Promise<Todo> {
  const at = now.getTime();
  const { lastInsertRowId } = await db.runAsync('INSERT INTO todos (item_id, title, due_at, done_at, created_at) VALUES (?, ?, NULL, NULL, ?)', [
    item.id, item.title, at,
  ]);
  return { id: lastInsertRowId, itemId: item.id, title: item.title, dueAt: null, doneAt: null, createdAt: at };
}

export async function todoForItem(db: Db, itemId: number): Promise<Todo | null> {
  const row = await db.getFirstAsync<TodoRow>('SELECT * FROM todos WHERE item_id = ? ORDER BY id DESC LIMIT 1', [itemId]);
  return row ? toTodo(row) : null;
}
