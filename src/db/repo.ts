// Saving, listing, searching, following up and to-dos. Every function takes the database as its
// first argument, like a DAO in Java, so the same code runs on the phone and in tests.

import { analyze, meaningText, type Capture, type Kind, type Scope } from '../brain/analyze';
import { guessCategory, type CategoryId } from '../brain/categories';
import { domainOf, findUrls, sameLinkKey, type Source } from '../brain/links';
import { shelfByMeaning, similarity, packVector, unpackVector, wordMeaner, WORD_MODEL_ID, type Meaner } from '../brain/meaning';
import type { ImportedLink } from '../brain/imports';
import { hashtagsOf, pageHeadline, type PageInfo } from '../brain/pages';
import type { Query } from '../brain/query';
import { firstEvening, type OpenTodo, type ToCheck } from '../brain/reminders';
import { SEARCH_WEIGHTS, type Db } from './schema';

/**
 * Whether a saved link still needs a look. `none` is for notes and photos, which need nothing.
 * `backlog` is for old saves brought in from WhatsApp or Instagram, which come back a few a day.
 */
export type CheckState = 'none' | 'to_check' | 'checked' | 'backlog';
/** Reading the link's page: not a link, waiting for the internet, read, or could not be read. */
export type PageStatus = 'none' | 'pending' | 'read' | 'failed';

export type Item = {
  id: number;
  kind: Kind;
  title: string;
  /** What you typed or shared when saving, link included. */
  text: string;
  /** Anything you added later. */
  note: string;
  url: string | null;
  source: Source;
  photoUri: string | null;
  category: CategoryId;
  /** True once you moved it to a shelf yourself, so Memoir never moves it back. */
  categoryLocked: boolean;
  scope: Scope;
  people: string[];
  tags: string[];
  /** What the link's page said, exactly as written there. */
  page: { title: string; text: string; author: string; image: string | null; status: PageStatus };
  checkState: CheckState;
  /** "Remind me later" pushed the next nudge to this time. */
  checkAfter: number | null;
  checkedAt: number | null;
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
  note: string;
  url: string | null;
  source: Source;
  photo_uri: string | null;
  category: CategoryId;
  category_locked: number;
  scope: Scope;
  people: string;
  tags: string;
  page_title: string;
  page_text: string;
  page_author: string;
  page_image: string | null;
  page_status: PageStatus;
  page_tries: number;
  check_state: CheckState;
  check_after: number | null;
  checked_at: number | null;
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
    note: row.note ?? '',
    url: row.url,
    source: row.source,
    photoUri: row.photo_uri,
    category: row.category,
    categoryLocked: Boolean(row.category_locked),
    scope: row.scope,
    people: list(row.people),
    tags: list(row.tags),
    page: {
      title: row.page_title ?? '',
      text: row.page_text ?? '',
      author: row.page_author ?? '',
      image: row.page_image ?? null,
      status: row.page_status ?? 'none',
    },
    checkState: row.check_state ?? 'none',
    checkAfter: row.check_after ?? null,
    checkedAt: row.checked_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTodo(row: TodoRow): Todo {
  return { id: row.id, itemId: row.item_id, title: row.title, dueAt: row.due_at, doneAt: row.done_at, createdAt: row.created_at };
}

// ------------------------------------------------------------ meanings

/** Everything an item says, for the models to read: your words, your note, and the page's. */
function itemMeaningText(item: Item): string {
  return meaningText([item.text, item.note, item.page.title, item.page.text].filter(Boolean).join('\n'), item.url, item.people);
}

async function saveVector(db: Db, itemId: number, model: string, vector: Float32Array) {
  await db.runAsync('INSERT OR REPLACE INTO item_vectors (item_id, model, vector) VALUES (?, ?, ?)', [itemId, model, packVector(vector)]);
}

/** Works out an item's meaning with the word model, and with the phone's AI model when there is one. */
async function refreshMeaning(db: Db, item: Item, meaner: Meaner) {
  const text = itemMeaningText(item);
  for (const model of meaner.id === WORD_MODEL_ID ? [wordMeaner] : [wordMeaner, meaner]) {
    const vector = await model.document(text).catch(() => null);
    if (vector) await saveVector(db, item.id, model.id, vector);
    else await db.runAsync('DELETE FROM item_vectors WHERE item_id = ? AND model = ?', [item.id, model.id]);
  }
}

/**
 * Works out the meaning of anything that does not have one yet for this model, like things saved
 * before the model was downloaded. Runs when the app opens. Returns how many it filled in.
 */
export async function fillMeanings(db: Db, meaner: Meaner = wordMeaner, onProgress?: (done: number, total: number) => void): Promise<number> {
  // Vectors from an older version of the word model are no use to anyone.
  await db.runAsync("DELETE FROM item_vectors WHERE model LIKE 'words-%' AND model != ?", [WORD_MODEL_ID]);
  const rows = await db.getAllAsync<ItemRow>(
    `SELECT items.* FROM items WHERE NOT EXISTS
       (SELECT 1 FROM item_vectors v WHERE v.item_id = items.id AND v.model = ?)
     ORDER BY created_at DESC`,
    [meaner.id],
  );
  let filled = 0;
  for (const [i, row] of rows.entries()) {
    const vector = await meaner.document(itemMeaningText(toItem(row))).catch(() => null);
    if (vector) {
      await saveVector(db, row.id, meaner.id, vector);
      filled++;
    }
    onProgress?.(i + 1, rows.length);
  }
  return filled;
}

// ------------------------------------------------------------ saving

/** `duplicate` means you had already saved this link, so it was put back on "To check" instead. */
export type Saved = { item: Item; todo: Todo | null; duplicate?: boolean };

/** A link you already saved, however it was shared (with or without "?igsh=", youtu.be or youtube.com). */
export async function findSavedLink(db: Db, url: string): Promise<Item | null> {
  const key = sameLinkKey(url);
  const rows = await db.getAllAsync<ItemRow>('SELECT * FROM items WHERE url IS NOT NULL AND url LIKE ? ORDER BY created_at DESC LIMIT 500', [
    `%${domainOf(url).split('.').slice(-2)[0]}%`,
  ]);
  const found = rows.find((row) => row.url && sameLinkKey(row.url) === key);
  return found ? toItem(found) : null;
}

/**
 * Save anything. `asTodo` forces a to-do even without words like "I want to". A saved link
 * starts as "to check", and its page is read in the background (see readPages).
 */
export async function saveCapture(db: Db, capture: Capture, now = new Date(), asTodo = false, meaner: Meaner = wordMeaner): Promise<Saved> {
  const a = analyze(capture, now);
  const at = now.getTime();
  const isLink = a.kind === 'link';
  // Saving the same reel again (just the link) brings the first one back instead of a copy.
  if (isLink && !capture.photoUri && a.url && capture.text.trim().replace(a.url, '').trim() === '') {
    const existing = await findSavedLink(db, a.url);
    if (existing) {
      await remindLater(db, existing.id, firstEvening(at));
      return { item: (await getItem(db, existing.id))!, todo: null, duplicate: true };
    }
  }
  const { lastInsertRowId: id } = await db.runAsync(
    `INSERT INTO items (kind, title, text, url, source, photo_uri, category, scope, people, tags,
       page_status, check_state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [a.kind, a.title, a.text, a.url, a.source, capture.photoUri ?? null, a.category, a.scope,
      JSON.stringify(a.people), JSON.stringify(a.tags), isLink ? 'pending' : 'none', isLink ? 'to_check' : 'none', at, at],
  );
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
  await refreshMeaning(db, item, meaner);
  return { item, todo };
}

// ------------------------------------------------------------ reading links

/** Links whose page has not been read yet, newest first. Each gets a few tries before Memoir stops. */
export async function pendingPages(db: Db, limit = 8): Promise<Item[]> {
  const rows = await db.getAllAsync<ItemRow>(
    `SELECT * FROM items WHERE url IS NOT NULL AND page_status IN ('pending', 'failed') AND page_tries < 4
     ORDER BY check_state = 'to_check' DESC, created_at DESC LIMIT ?`,
    [limit],
  );
  return rows.map(toItem);
}

/** The words you typed besides the link. Empty when you saved just the link. */
function yourWords(item: Item): string {
  return findUrls(item.text).reduce((rest, u) => rest.replace(u, ' '), item.text).trim();
}

/**
 * Stores what a link's page said. A link saved on its own gets the page's headline as its title
 * and is moved to the shelf the caption fits, unless you already moved it yourself.
 * `page` null means the page could not be read this time.
 */
export async function applyPage(db: Db, id: number, page: PageInfo | null, now = new Date(), meaner: Meaner = wordMeaner): Promise<Item | null> {
  const item = await getItem(db, id);
  if (!item) return null;
  if (!page) {
    await db.runAsync("UPDATE items SET page_status = 'failed', page_tries = page_tries + 1 WHERE id = ?", [id]);
    return getItem(db, id);
  }

  const mine = yourWords(item);
  const headline = pageHeadline(page);
  // A few words of your own ("for the interview prep") say why, not what. The page's headline
  // becomes the title, and your words stay on the card and the item's page.
  const shortNote = mine.split(/\s+/).length <= 6 && item.title.toLowerCase() === mine.split('\n')[0].trim().toLowerCase();
  const title = headline && (!mine || shortNote) ? headline : item.title;
  const tags = [...new Set([...item.tags, ...hashtagsOf(page.text)])].slice(0, 8);

  let category = item.category;
  if (!item.categoryLocked && (!mine || category === 'notes')) {
    const guess = guessCategory(`${mine} ${page.title} ${page.text}`, item.source).id;
    if (guess !== 'notes') category = guess;
    else {
      const meaning = await wordMeaner.document(`${mine} ${page.title} ${page.text}`);
      category = (meaning && shelfByMeaning(meaning)?.id) || category;
    }
  }

  await db.runAsync(
    `UPDATE items SET page_title = ?, page_text = ?, page_author = ?, page_image = ?, page_status = 'read',
       page_tries = page_tries + 1, page_read_at = ?, title = ?, tags = ?, category = ?, updated_at = ? WHERE id = ?`,
    [page.title.slice(0, 300), page.text.slice(0, 4000), page.author.slice(0, 120), page.image, now.getTime(), title,
      JSON.stringify(tags), category, now.getTime(), id],
  );
  const updated = await getItem(db, id);
  if (updated) await refreshMeaning(db, updated, meaner);
  return updated;
}

/** Try reading a link's page again, as if it were just saved. */
export async function retryPage(db: Db, id: number) {
  await db.runAsync("UPDATE items SET page_status = 'pending', page_tries = 0 WHERE id = ? AND url IS NOT NULL", [id]);
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

/** What you have been into lately: shelves, hashtags and accounts you save most, last 30 days. */
export async function interests(db: Db, now = new Date()): Promise<{ shelves: CategoryId[]; tags: string[]; authors: string[] }> {
  const since = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const rows = await db.getAllAsync<{ category: CategoryId; tags: string; page_author: string }>(
    "SELECT category, tags, page_author FROM items WHERE created_at >= ? AND kind != 'diary'",
    [since],
  );
  const count = (values: string[]) => {
    const tally = new Map<string, number>();
    for (const v of values) if (v) tally.set(v, (tally.get(v) ?? 0) + 1);
    return [...tally.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([v]) => v);
  };
  return {
    shelves: count(rows.map((r) => r.category).filter((cat) => cat !== 'notes')).slice(0, 3) as CategoryId[],
    tags: count(rows.flatMap((r) => list(r.tags))).slice(0, 5),
    authors: count(rows.map((r) => r.page_author)).slice(0, 3),
  };
}

// ------------------------------------------------------------ following up

/** Saved links still waiting for a look. Due ones first (oldest waiting at the top), then later ones. */
export async function listToCheck(db: Db, now = new Date()): Promise<{ due: Item[]; later: Item[] }> {
  const rows = await db.getAllAsync<ItemRow>(
    "SELECT * FROM items WHERE check_state = 'to_check' ORDER BY COALESCE(check_after, created_at) ASC",
  );
  const items = rows.map(toItem);
  const t = now.getTime();
  return {
    due: items.filter((i) => !i.checkAfter || i.checkAfter <= t),
    later: items.filter((i) => i.checkAfter && i.checkAfter > t),
  };
}

export async function countToCheck(db: Db): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM items WHERE check_state = 'to_check'");
  return Number(row?.n ?? 0);
}

export async function toCheckForReminders(db: Db): Promise<ToCheck[]> {
  const rows = await db.getAllAsync<{ id: number; title: string; created_at: number; check_after: number | null; source: string }>(
    "SELECT id, title, created_at, check_after, source FROM items WHERE check_state = 'to_check'",
  );
  return rows.map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at, checkAfter: r.check_after, source: r.source }));
}

/** Checked (you opened it, or said it's done) or back on the list. */
export async function setChecked(db: Db, id: number, checked: boolean, now = new Date()) {
  await db.runAsync(
    checked
      ? "UPDATE items SET check_state = 'checked', checked_at = ?, check_after = NULL WHERE id = ?"
      : "UPDATE items SET check_state = 'to_check', checked_at = NULL, check_after = NULL WHERE id = ?",
    checked ? [now.getTime(), id] : [id],
  );
}

/** "Remind me later": back on the list, with the next nudge at `at`. Works on anything you saved. */
export async function remindLater(db: Db, id: number, at: number) {
  await db.runAsync("UPDATE items SET check_state = 'to_check', check_after = ?, checked_at = NULL WHERE id = ?", [at, id]);
}

// ------------------------------------------------------------ diary

function dayBounds(day: Date): [number, number] {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return [start.getTime(), end.getTime()];
}

/** The diary entry for a day, if you wrote one. */
export async function diaryFor(db: Db, day = new Date()): Promise<Item | null> {
  const [from, to] = dayBounds(day);
  const row = await db.getFirstAsync<ItemRow>("SELECT * FROM items WHERE kind = 'diary' AND created_at >= ? AND created_at < ? ORDER BY id LIMIT 1", [from, to]);
  return row ? toItem(row) : null;
}

export async function listDiary(db: Db, limit = 60): Promise<Item[]> {
  const rows = await db.getAllAsync<ItemRow>("SELECT * FROM items WHERE kind = 'diary' ORDER BY created_at DESC LIMIT ?", [limit]);
  return rows.map(toItem);
}

/**
 * Adds a line to today's diary. One entry per day, and each thing you write is added to it.
 * People you mention are noted, and "I need to..." still becomes a to-do.
 */
export async function writeDiary(db: Db, text: string, now = new Date(), meaner: Meaner = wordMeaner): Promise<Saved> {
  const clean = text.trim();
  const a = analyze({ text: clean }, now);
  const at = now.getTime();
  const existing = await diaryFor(db, now);
  let id: number;
  if (existing) {
    const people = [...new Set([...existing.people, ...a.people])];
    await db.runAsync('UPDATE items SET text = ?, people = ?, updated_at = ? WHERE id = ?', [
      `${existing.text}\n\n${clean}`, JSON.stringify(people), at, existing.id,
    ]);
    id = existing.id;
  } else {
    const title = `My day, ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`;
    const result = await db.runAsync(
      `INSERT INTO items (kind, title, text, source, category, scope, people, tags, created_at, updated_at)
       VALUES ('diary', ?, ?, 'me', 'notes', 'personal', ?, '[]', ?, ?)`,
      [title, clean, JSON.stringify(a.people), at, at],
    );
    id = result.lastInsertRowId;
  }
  let todo: Todo | null = null;
  if (a.todo) {
    const result = await db.runAsync('INSERT INTO todos (item_id, title, due_at, done_at, created_at) VALUES (?, ?, ?, NULL, ?)', [
      id, a.todo.title, a.todo.dueAt, at,
    ]);
    todo = { id: result.lastInsertRowId, itemId: id, title: a.todo.title, dueAt: a.todo.dueAt, doneAt: null, createdAt: at };
  }
  const item = (await getItem(db, id))!;
  await refreshMeaning(db, item, meaner);
  return { item, todo };
}

// ------------------------------------------------------------ settings

export async function getSetting(db: Db, key: string, fallback: string): Promise<string> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', [`setting:${key}`]);
  return row?.value ?? fallback;
}

export async function setSetting(db: Db, key: string, value: string) {
  await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [`setting:${key}`, value]);
}

// ------------------------------------------------------------ old saves from other apps

/**
 * Brings in links from a WhatsApp or Instagram export. Links already saved are skipped. The rest
 * wait in a backlog and come back a few each evening (see promoteBacklog), instead of all at once.
 */
export async function importLinks(
  db: Db,
  links: ImportedLink[],
  now = new Date(),
  meaner: Meaner = wordMeaner,
): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;
  for (const link of links) {
    if (await findSavedLink(db, link.url)) {
      skipped++;
      continue;
    }
    const at = new Date(Math.min(link.at ?? now.getTime(), now.getTime()));
    const { item } = await saveCapture(db, { text: link.note ? `${link.url}\n${link.note}` : link.url }, at, false, meaner);
    await db.runAsync("UPDATE items SET check_state = 'backlog', page_author = ? WHERE id = ?", [link.author, item.id]);
    added++;
  }
  return { added, skipped };
}

export async function countBacklog(db: Db): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM items WHERE check_state = 'backlog'");
  return Number(row?.n ?? 0);
}

export const BACKLOG_PER_DAY = 3;

/**
 * Moves a few old saves onto "To check" each day, newest first, so the backlog gets looked at
 * without flooding you. `force` brings the next few right now.
 */
export async function promoteBacklog(db: Db, now = new Date(), force = false): Promise<number> {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const key = String(today.getTime());
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM meta WHERE key = 'backlog_day'");
  const [day, doneToday] = (row?.value ?? '').split(':');
  const already = day === key ? Number(doneToday) || 0 : 0;
  const room = force ? BACKLOG_PER_DAY : BACKLOG_PER_DAY - already;
  if (room <= 0) return 0;
  const picks = await db.getAllAsync<{ id: number }>(
    "SELECT id FROM items WHERE check_state = 'backlog' ORDER BY created_at DESC LIMIT ?",
    [room],
  );
  const evening = firstEvening(now.getTime());
  for (const pick of picks) {
    await db.runAsync("UPDATE items SET check_state = 'to_check', check_after = ? WHERE id = ?", [force ? null : evening, pick.id]);
  }
  await db.runAsync("INSERT OR REPLACE INTO meta (key, value) VALUES ('backlog_day', ?)", [`${key}:${already + picks.length}`]);
  return picks.length;
}

// ------------------------------------------------------------ changing

export async function updateItem(db: Db, id: number, patch: { category?: CategoryId; scope?: Scope }, now = new Date()) {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.category) {
    // You chose the shelf, so reading the page later never moves it.
    sets.push('category = ?', 'category_locked = 1');
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

/** Your own note on something saved. It is searchable, and the models read it too. */
export async function setNote(db: Db, id: number, note: string, now = new Date(), meaner: Meaner = wordMeaner) {
  await db.runAsync('UPDATE items SET note = ?, updated_at = ? WHERE id = ?', [note.trim(), now.getTime(), id]);
  const item = await getItem(db, id);
  if (item) await refreshMeaning(db, item, meaner);
}

/** Deletes an item and its to-do. Returns the photo file so the caller can delete it too. */
export async function deleteItem(db: Db, id: number): Promise<string | null> {
  const row = await db.getFirstAsync<{ photo_uri: string | null }>('SELECT photo_uri FROM items WHERE id = ?', [id]);
  await db.runAsync('DELETE FROM todos WHERE item_id = ?', [id]);
  await db.runAsync('DELETE FROM item_vectors WHERE item_id = ?', [id]);
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
  const haystack = [
    item.title, item.text, item.note, item.page.title, item.page.text, item.page.author,
    item.tags.join(' '), item.people.join(' '), item.category, item.source,
  ].join(' ').toLowerCase();
  // A short stem, so "hiking" counts for "hike" the way full-text search already does.
  return terms.filter((t) => haystack.includes(t.length > 4 ? t.slice(0, t.length - 2) : t));
}

const LIKE_COLUMNS = ['title', 'text', 'note', 'page_title', 'page_text', 'page_author', 'tags', 'people'];

/** Things that contain your words (or, with no words, match your filters), best first. */
async function byWords(db: Db, query: Query, strict: boolean, limit: number): Promise<Scored[]> {
  const { where, params } = filtersSql(query, strict);
  let rows: ItemRow[];
  if (query.terms.length && (await fullTextOn(db))) {
    rows = await db.getAllAsync<ItemRow>(
      `SELECT items.* FROM items_fts JOIN items ON items.id = items_fts.rowid
       WHERE items_fts MATCH ? ${where.length ? `AND ${where.join(' AND ')}` : ''}
       ORDER BY bm25(items_fts, ${SEARCH_WEIGHTS.map((w) => w.toFixed(1)).join(', ')}) LIMIT ?`,
      [ftsExpression(query.terms), ...params, limit * 2],
    );
  } else if (query.terms.length) {
    const one = `(${LIKE_COLUMNS.map((c) => `items.${c} LIKE ?`).join(' OR ')})`;
    const likes = query.terms.map(() => one);
    const likeParams = query.terms.flatMap((t) => Array(LIKE_COLUMNS.length).fill(`%${t}%`));
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

const MAX_CLOSE = 5;

type Candidate = { row: ItemRow; similarity: number };

/** How close every candidate item is to the question's meaning, by item id. */
async function byMeaning(db: Db, query: Query, strict: boolean, meaner: Meaner): Promise<Map<number, Candidate>> {
  const scores = new Map<number, Candidate>();
  const question = query.meaning ? await meaner.query(query.meaning).catch(() => null) : null;
  if (!question) return scores;
  const { where, params } = filtersSql(query, strict);
  const rows = await db.getAllAsync<ItemRow & { vector: string }>(
    `SELECT items.*, v.vector FROM items JOIN item_vectors v ON v.item_id = items.id AND v.model = ?
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY items.created_at DESC LIMIT 5000`,
    [meaner.id, ...params],
  );
  for (const row of rows) scores.set(row.id, { row, similarity: similarity(question, unpackVector(row.vector)) });
  return scores;
}

async function runSearch(db: Db, query: Query, strict: boolean, limit: number, meaner: Meaner): Promise<Found[]> {
  const [words, meanings] = await Promise.all([byWords(db, query, strict, limit), byMeaning(db, query, strict, meaner)]);
  // Among things that share your words, the ones closer in meaning rise.
  for (const found of words) found.score += (meanings.get(found.item.id)?.similarity ?? 0) * 6;

  const seen = new Set(words.map((f) => f.item.id));
  const floor = words.length ? meaner.closeBeside : meaner.closeAlone;
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
export async function search(db: Db, query: Query, limit = 20, meaner: Meaner = wordMeaner): Promise<SearchResult> {
  const found = await runSearch(db, query, true, limit, meaner);
  if (found.length || !(query.terms.length || query.meaning)) return { found, loose: false };
  const nearby = await runSearch(db, query, false, limit, meaner);
  return { found: nearby, loose: nearby.length > 0 };
}

/** Other things you saved that mean something similar, closest first. */
export async function related(db: Db, itemId: number, limit = 3, meaner: Meaner = wordMeaner): Promise<Item[]> {
  const own = await db.getFirstAsync<{ vector: string }>('SELECT vector FROM item_vectors WHERE item_id = ? AND model = ?', [itemId, meaner.id]);
  if (!own) return meaner.id === WORD_MODEL_ID ? [] : related(db, itemId, limit, wordMeaner);
  const target = unpackVector(own.vector);
  const rows = await db.getAllAsync<ItemRow & { vector: string }>(
    `SELECT items.*, v.vector FROM items JOIN item_vectors v ON v.item_id = items.id AND v.model = ?
     WHERE items.id != ? ORDER BY items.created_at DESC LIMIT 5000`,
    [meaner.id, itemId],
  );
  return rows
    .map((row) => ({ row, similarity: similarity(target, unpackVector(row.vector)) }))
    .filter((r) => r.similarity >= meaner.related)
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

// ------------------------------------------------------------ backup

const ITEM_COLUMNS = [
  'kind', 'title', 'text', 'note', 'url', 'source', 'photo_uri', 'category', 'category_locked', 'scope', 'people', 'tags',
  'page_title', 'page_text', 'page_author', 'page_image', 'page_status', 'page_tries', 'page_read_at',
  'check_state', 'check_after', 'checked_at', 'created_at', 'updated_at',
] as const;

export type BackupData = { app: 'memoir'; version: 1; exportedAt: number; items: Record<string, unknown>[]; todos: Record<string, unknown>[] };

/** Everything you saved, as plain data. Meanings are left out because they are worked out again. */
export async function exportData(db: Db, now = new Date()): Promise<BackupData> {
  const items = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM items ORDER BY id');
  const todos = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM todos ORDER BY id');
  return { app: 'memoir', version: 1, exportedAt: now.getTime(), items, todos };
}

export function isBackup(value: unknown): value is BackupData {
  const v = value as BackupData;
  return Boolean(v && v.app === 'memoir' && Array.isArray(v.items) && Array.isArray(v.todos));
}

/**
 * Brings a backup back in. Anything already here (same time and same words) is skipped, so
 * restoring twice never makes copies. `photoFor` turns a photo in the backup into a file here.
 */
export async function importData(
  db: Db,
  backup: BackupData,
  photoFor: (oldUri: string) => string | null = () => null,
  meaner: Meaner = wordMeaner,
): Promise<{ added: number; skipped: number }> {
  const newIds = new Map<number, number>();
  let added = 0;
  let skipped = 0;
  for (const row of backup.items) {
    const same = await db.getFirstAsync<{ id: number }>('SELECT id FROM items WHERE created_at = ? AND text = ?', [row.created_at, row.text]);
    if (same) {
      newIds.set(Number(row.id), same.id);
      skipped++;
      continue;
    }
    const values = ITEM_COLUMNS.map((col) => {
      if (col === 'photo_uri') return row.photo_uri ? photoFor(String(row.photo_uri)) : null;
      return row[col] ?? null;
    });
    const present = ITEM_COLUMNS.filter((_, i) => values[i] !== null);
    const { lastInsertRowId } = await db.runAsync(
      `INSERT INTO items (${present.join(', ')}) VALUES (${present.map(() => '?').join(', ')})`,
      values.filter((v) => v !== null),
    );
    newIds.set(Number(row.id), lastInsertRowId);
    added++;
  }
  for (const row of backup.todos) {
    const itemId = row.item_id === null || row.item_id === undefined ? null : (newIds.get(Number(row.item_id)) ?? null);
    const same = await db.getFirstAsync<{ id: number }>('SELECT id FROM todos WHERE created_at = ? AND title = ?', [row.created_at, row.title]);
    if (same) continue;
    await db.runAsync('INSERT INTO todos (item_id, title, due_at, done_at, created_at) VALUES (?, ?, ?, ?, ?)', [
      itemId, row.title, row.due_at ?? null, row.done_at ?? null, row.created_at,
    ]);
  }
  await fillMeanings(db, meaner);
  return { added, skipped };
}
