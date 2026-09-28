// Saving and finding, against a real SQLite, with full-text search on.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseQuery } from '../src/brain/query';
import { deleteItem, fromYourPast, knownPeople, listItems, listTodos, saveCapture, search, setTodoDone, shelves } from '../src/db/repo';
import { migrate } from '../src/db/schema';
import { memoryDb } from './sqlite';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 8, 28, 17, 30);
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

async function seeded() {
  const db = memoryDb();
  const { fullText } = await migrate(db);
  assert.equal(fullText, true);
  await saveCapture(db, { text: 'https://www.instagram.com/reel/abc/ gorgeous hiking trail in Colorado' }, daysAgo(5));
  await saveCapture(db, { text: 'Mom says the Diwali lunch is at Ravi uncle house' }, daysAgo(2));
  await saveCapture(db, { text: 'https://www.youtube.com/watch?v=xyz spring boot kafka tutorial' }, daysAgo(20));
  await saveCapture(db, { text: 'I want to renew my passport next month' }, daysAgo(1));
  await saveCapture(db, { text: 'Parking at the airport level 3', photoUri: 'file:///p/1.jpg' }, daysAgo(0));
  return db;
}

test('a saved to-do shows up in the to-do list, and done moves it', async () => {
  const db = await seeded();
  const open = await listTodos(db, true);
  assert.equal(open.length, 1);
  assert.equal(open[0].title, 'Renew my passport');
  await setTodoDone(db, open[0].id, true, NOW);
  assert.equal((await listTodos(db, true)).length, 0);
  assert.equal((await listTodos(db, false)).length, 1);
});

test('"that reel about a hike" finds the hiking reel', async () => {
  const db = await seeded();
  const { found, loose } = await search(db, parseQuery('I remember saving a reel about a hike', NOW));
  assert.equal(loose, false);
  assert.equal(found[0].item.source, 'instagram');
  assert.ok(found[0].item.title.toLowerCase().includes('hiking'));
});

test('filters that find nothing fall back to the closest things, and say so', async () => {
  const db = await seeded();
  const { found, loose } = await search(db, parseQuery('kafka video from yesterday', NOW));
  assert.equal(loose, true);
  assert.equal(found[0].item.source, 'youtube');
});

test('a question with only filters lists by time', async () => {
  const db = await seeded();
  const { found } = await search(db, parseQuery('photos from today', NOW));
  assert.equal(found.length, 1);
  assert.equal(found[0].item.kind, 'photo');
});

test('people are searchable by name', async () => {
  const db = await seeded();
  const people = await knownPeople(db);
  assert.ok(people.includes('Mom'));
  const { found } = await search(db, parseQuery('what did mom say about diwali', NOW, people));
  assert.equal(found[0].item.category, 'people');
});

test('lists, shelves and a memory from the past', async () => {
  const db = await seeded();
  assert.equal((await listItems(db)).length, 5);
  assert.equal((await listItems(db, { scope: 'public' })).length, 2);
  const counts = await shelves(db);
  assert.ok(counts.find((s) => s.category === 'travel'));
  const past = await fromYourPast(db, NOW);
  assert.ok(past && past.createdAt < NOW.getTime() - 7 * DAY);
});

test('deleting an item removes its to-do and returns the photo to delete', async () => {
  const db = await seeded();
  const photo = (await listItems(db, { kind: 'photo' }))[0];
  assert.equal(await deleteItem(db, photo.id), 'file:///p/1.jpg');
  const todoItem = (await listItems(db)).find((i) => i.title === 'Renew my passport')!;
  await deleteItem(db, todoItem.id);
  assert.equal((await listTodos(db, true)).length, 0);
  // Full-text search forgets deleted things too.
  const { found } = await search(db, parseQuery('passport', NOW));
  assert.equal(found.length, 0);
});
