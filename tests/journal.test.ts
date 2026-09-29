// What stays with you: notes, the diary, backups that bring everything back, and the reminder plan.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseQuery } from '../src/brain/query';
import { diaryNudges, habitReminders, morningBriefs, moveChoices } from '../src/brain/reminders';
import { habitsToday, listItemsOf, loadLearned, tell, tellAs } from '../src/db/assistant';
import {
  deleteTodo,
  diaryFor,
  exportData,
  getItem,
  importData,
  listDiary,
  listNotes,
  listTodos,
  saveCapture,
  search,
  setNote,
  updateText,
  writeDiary,
} from '../src/db/repo';
import { migrate, SCHEMA_VERSION } from '../src/db/schema';
import { memoryDb } from './sqlite';

const HOUR = 60 * 60 * 1000;
// Monday 28 September 2026, 5:30 PM
const NOW = new Date(2026, 8, 28, 17, 30);

async function fresh() {
  const db = memoryDb();
  await migrate(db);
  return db;
}

test('a note you add later is searchable, and so is an edit', async () => {
  const db = await fresh();
  const { item } = await saveCapture(db, { text: 'Kafka consumer groups rebalance on join' }, NOW);
  await setNote(db, item.id, 'try this with the team on Friday', NOW);
  let { found } = await search(db, parseQuery('team friday', NOW));
  assert.equal(found[0]?.item.id, item.id);
  await updateText(db, item.id, 'Kafka partitions decide the parallelism', NOW);
  ({ found } = await search(db, parseQuery('parallelism', NOW)));
  assert.equal(found[0]?.item.id, item.id);
  assert.equal((await getItem(db, item.id))?.title, 'Kafka partitions decide the parallelism');
});

test('notes list only real notes, not the words behind a reminder', async () => {
  const db = await fresh();
  await tell(db, 'Remind me to call Amma at 7pm', NOW);
  await tell(db, 'The wifi password at the cabin is sunrise42', NOW);
  await tell(db, 'Went for a long walk by the lake', NOW);
  const notes = await listNotes(db);
  assert.deepEqual(notes.map((n) => n.text), ['The wifi password at the cabin is sunrise42']);
  // Deleting the reminder takes its words with it, and keeps real notes.
  const [todo] = await listTodos(db, true);
  await deleteTodo(db, todo.id);
  assert.equal((await listTodos(db, true)).length, 0);
  assert.equal((await listNotes(db)).length, 1);
  const hidden = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM items WHERE hidden = 1');
  assert.equal(Number(hidden?.n), 0);
});

test('an app that already has saves from the first version upgrades without losing any', async () => {
  const db = memoryDb();
  // The version 2 database, as the first builds left it.
  await db.execAsync(`
    CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '', url TEXT, source TEXT NOT NULL, photo_uri TEXT, category TEXT NOT NULL,
      scope TEXT NOT NULL, people TEXT NOT NULL DEFAULT '[]', tags TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE todos (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER, title TEXT NOT NULL, due_at INTEGER,
      done_at INTEGER, created_at INTEGER NOT NULL);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE item_meanings (item_id INTEGER PRIMARY KEY, model INTEGER NOT NULL, vector TEXT NOT NULL);
    CREATE VIRTUAL TABLE items_fts USING fts5(title, text, tags, people, category, source,
      content = 'items', content_rowid = 'id', tokenize = 'porter unicode61');
    CREATE TRIGGER items_ai AFTER INSERT ON items BEGIN
      INSERT INTO items_fts (rowid, title, text, tags, people, category, source)
      VALUES (new.id, new.title, new.text, new.tags, new.people, new.category, new.source);
    END;
    INSERT INTO items (kind, title, text, url, source, category, scope, created_at, updated_at)
      VALUES ('link', 'Instagram reel', 'https://www.instagram.com/reel/C4abc/ gorgeous hiking trail', 'https://www.instagram.com/reel/C4abc/', 'instagram', 'travel', 'public', 1, 1);
    INSERT INTO items (kind, title, text, source, category, scope, created_at, updated_at)
      VALUES ('note', 'Call the dentist', 'Call the dentist', 'me', 'health', 'personal', 2, 2);
    PRAGMA user_version = 2;
  `);
  await migrate(db);
  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  assert.equal(version?.user_version, SCHEMA_VERSION);
  assert.equal((await getItem(db, 1))?.kind, 'link');
  assert.equal((await listNotes(db)).length, 2, 'old saves are still in your notes');
  // The search index was rebuilt, so old saves are still found by their words.
  const { found } = await search(db, parseQuery('dentist', NOW));
  assert.equal(found[0]?.item.id, 2);
  // And the assistant works on the upgraded file.
  const r = await tell(db, 'add milk to the shopping list', NOW);
  assert.equal(r.text, 'Added milk to your shopping list.');
});

test('a backup brings back notes, diary, to-dos, lists, habits and what it learned, once', async () => {
  const first = await fresh();
  await saveCapture(first, { text: 'The wifi password at the cabin is sunrise42' }, NOW);
  await tell(first, 'I need to renew my passport by Oct 28', NOW);
  await tell(first, 'pay rent every month on the 1st', NOW);
  await tell(first, 'Add passport and sunscreen to the packing list', NOW);
  await tell(first, 'Remind me to drink water every day at 10am', NOW);
  await tellAs(first, 'Long day, but the demo went well', 'diary', NOW);
  const [water] = await habitsToday(first, NOW);
  const { setHabitDone } = await import('../src/db/assistant');
  await setHabitDone(first, water.id, true, NOW);
  const backup = JSON.parse(JSON.stringify(await exportData(first, NOW)));
  assert.equal(backup.version, 2);

  const second = await fresh();
  const once = await importData(second, backup);
  assert.ok(once.added >= 6);
  const twice = await importData(second, backup);
  assert.equal(twice.added, 0, 'restoring twice makes no copies');

  const open = await listTodos(second, true);
  assert.deepEqual(open.map((t) => t.title).sort(), ['Pay rent', 'Renew my passport']);
  assert.deepEqual((await listItemsOf(second, 'packing')).map((i) => i.text), ['passport', 'sunscreen']);
  const [restored] = await habitsToday(second, NOW);
  assert.equal(restored.name, 'Drink water');
  assert.equal(restored.doneToday, true);
  assert.equal((await diaryFor(second, NOW))?.text, 'Long day, but the demo went well');
  assert.equal((await loadLearned(second)).lists.sunscreen, 'packing');
  // A repeating to-do still repeats after a restore.
  const rent = open.find((t) => t.title === 'Pay rent')!;
  const { setTodoDone } = await import('../src/db/repo');
  assert.ok(await setTodoDone(second, rent.id, true, NOW));
});

test('the diary keeps one entry a day, adds to it, and still catches to-dos and people', async () => {
  const db = await fresh();
  const morning = new Date(2026, 8, 28, 9, 0);
  const first = await writeDiary(db, 'Gym in the morning, then a long day of Kafka work.', morning);
  const second = await writeDiary(db, 'Called Amma. I need to book the Diwali tickets by Friday.', NOW);
  assert.equal(first.item.id, second.item.id);
  assert.equal(second.item.kind, 'diary');
  assert.match(second.item.text, /Kafka work\.\n\nCalled Amma/);
  assert.ok(second.item.people.includes('Amma'));
  assert.equal(second.todo?.title, 'Book the Diwali tickets');
  assert.equal((await diaryFor(db, NOW))?.id, first.item.id);
  assert.equal(await diaryFor(db, new Date(2026, 8, 27)), null);
  await writeDiary(db, 'Quiet Tuesday.', new Date(2026, 8, 29, 20, 0));
  assert.equal((await listDiary(db)).length, 2);
  const { found } = await search(db, parseQuery('what did I do on the day I went to the gym', NOW));
  assert.equal(found[0]?.item.kind, 'diary');
});

test('the reminder plan: diary nudges, habits at their time, and a morning brief', () => {
  const nudges = diaryNudges(NOW.getTime(), true);
  assert.equal(new Date(nudges[0]).getDate(), 29, 'already wrote today, so tomorrow first');
  assert.equal(new Date(nudges[0]).getHours(), 21);
  assert.equal(diaryNudges(NOW.getTime(), false).length, 7);

  const water = { id: 1, name: 'Drink water', days: [0, 1, 2, 3, 4, 5, 6], hour: 19, minute: 0, doneToday: false };
  const standup = { id: 2, name: 'Stand-up notes', days: [1, 2, 3, 4, 5], hour: 9, minute: 30, doneToday: false };
  const planned = habitReminders([water, standup], NOW.getTime());
  assert.equal(new Date(planned[0].at).getHours(), 19, 'water tonight at 7');
  assert.equal(planned.filter((p) => p.habitId === 2).length, 4, 'weekdays only, and 9:30 today has passed');
  assert.equal(habitReminders([{ ...water, doneToday: true }], NOW.getTime()).filter((p) => new Date(p.at).getDate() === 28).length, 0);

  const tomorrowNoon = new Date(2026, 8, 29, 12, 0).getTime();
  const briefs = morningBriefs(
    [
      { id: 1, title: 'Call the bank', dueAt: tomorrowNoon, createdAt: 0 },
      { id: 2, title: 'Buy a gift', dueAt: null, createdAt: 0 },
    ],
    [standup],
    NOW.getTime(),
  );
  assert.equal(new Date(briefs[0].at).getDate(), 29);
  assert.equal(new Date(briefs[0].at).getHours(), 8);
  assert.equal(briefs[0].title, 'Today, one thing');
  assert.equal(briefs[0].body, 'Call the bank at 12:00 PM. Habits today, stand-up notes. Also on your list, Buy a gift.');
  // Saturday has no habit planned, but the bank call would still be open then.
  const saturday = briefs.find((b) => new Date(b.at).getDay() === 6);
  assert.equal(saturday?.body, '1 from before still open.');
  // With nothing open, the weekend gets no brief at all, so it never nags for nothing.
  const quiet = morningBriefs([], [standup], NOW.getTime());
  assert.ok(!quiet.some((b) => [0, 6].includes(new Date(b.at).getDay())));
  void HOUR;
});

test('moving a to-do offers times that fit the day, in your own morning and evening', () => {
  const choices = moveChoices(NOW.getTime(), { morning: [7, 30], evening: [18, 30] });
  assert.deepEqual(choices.map((c) => c.label), ['This evening', 'Tomorrow morning', 'This weekend', 'Next week']);
  const [evening, tomorrow, weekend, next] = choices.map((c) => new Date(c.at));
  assert.deepEqual([evening.getHours(), evening.getMinutes()], [18, 30]);
  assert.deepEqual([tomorrow.getDate(), tomorrow.getHours(), tomorrow.getMinutes()], [29, 7, 30]);
  assert.equal(weekend.getDay(), 6);
  assert.deepEqual([next.getDay(), next.getDate()], [1, 5]);
  const late = moveChoices(new Date(2026, 8, 28, 22, 0).getTime());
  assert.equal(late[0].label, 'Tomorrow morning');
});
