// The small on-phone model, on its own and inside save, search and "Like this".
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { analyze } from '../src/brain/analyze';
import { embed, packVector, shelfByMeaning, similarity, unpackVector } from '../src/brain/meaning';
import { parseQuery } from '../src/brain/query';
import { deleteItem, fillMeanings, related, saveCapture, search } from '../src/db/repo';
import { migrate } from '../src/db/schema';
import { memoryDb } from './sqlite';

const NOW = new Date(2026, 8, 28, 17, 30);
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

test('words with a similar meaning sit close together', () => {
  const doctor = embed('doctor')!;
  assert.equal(doctor.length, 64);
  assert.ok(Math.abs(similarity(doctor, doctor) - 1) < 1e-6);
  assert.ok(similarity(doctor, embed('hospital')!) > similarity(doctor, embed('guitar')!) + 0.3);
  // Whole sentences are steadier than single words.
  const trip = embed('a weekend of hiking to a waterfall')!;
  assert.ok(similarity(trip, embed('mountain trail with a lake')!) > similarity(trip, embed('pay the electricity bill')!) + 0.3);
  // Common words and links carry no meaning of their own.
  assert.equal(embed('the and of https://example.com'), null);
});

test('a meaning survives being stored in the database', () => {
  const v = embed('mountain walk with a waterfall')!;
  assert.ok(similarity(v, unpackVector(packVector(v))) > 0.999);
});

test('with no shelf keyword, the model picks a shelf only when it is sure', () => {
  assert.equal(shelfByMeaning(embed('Mortgage rates dropped')!)?.id, 'money');
  assert.equal(shelfByMeaning(embed('Vacuum the living room rug')!)?.id, 'home');
  assert.equal(shelfByMeaning(embed('Spanish vocabulary flashcards')!)?.id, 'learning');
  assert.equal(shelfByMeaning(embed('The meaning of life is 42')!), null);
  assert.equal(analyze({ text: 'Flu shot at CVS' }, NOW).category, 'notes'); // not sure enough, stays on Notes
  assert.equal(analyze({ text: 'Mortgage rates dropped again' }, NOW).category, 'money');
  // Keywords still come first.
  assert.equal(analyze({ text: 'Pay the electricity bill' }, NOW).category, 'money');
});

async function seeded() {
  const db = memoryDb();
  await migrate(db);
  await saveCapture(db, { text: 'Amazing hiking trail near Denver with a waterfall at the top' }, daysAgo(9));
  await saveCapture(db, { text: 'Pay the electricity bill before the 5th' }, daysAgo(3));
  await saveCapture(db, { text: 'Recipe for chicken biryani in a pressure cooker' }, daysAgo(2));
  await saveCapture(db, { text: 'Beach resort in Goa with cheap flights in December' }, daysAgo(1));
  await saveCapture(db, { text: 'Another trail hike in the mountains, with a lake' }, daysAgo(0));
  return db;
}

test('a question with none of the saved words finds it by meaning', async () => {
  const db = await seeded();
  const { found } = await search(db, parseQuery('that walk to the falls', NOW));
  // Both hikes, and nothing else, even though neither says "walk" or "falls".
  assert.deepEqual(found.map((f) => f.item.id).sort(), [1, 5]);
  assert.ok(found.every((f) => f.close));
});

test('word matches come first, and weak meaning matches do not tag along', async () => {
  const db = await seeded();
  const { found } = await search(db, parseQuery('electricity bill', NOW));
  assert.equal(found[0].close, false);
  assert.match(found[0].item.title, /electricity/);
  assert.ok(!found.some((f) => /biryani|Goa/.test(f.item.title)));
});

test('"Like this" shows things close in meaning, not everything', async () => {
  const db = await seeded();
  const like = await related(db, 1);
  assert.deepEqual(
    like.map((i) => i.id),
    [5],
  );
});

test('things saved before the model existed get a meaning when the app opens', async () => {
  const db = await seeded();
  await db.runAsync(
    `INSERT INTO items (kind, title, text, url, source, photo_uri, category, scope, people, tags, created_at, updated_at)
     VALUES ('note', 'Sneakers on sale at the mall', 'Sneakers on sale at the mall', NULL, 'me', NULL, 'shopping', 'personal', '[]', '[]', ?, ?)`,
    [NOW.getTime(), NOW.getTime()],
  );
  assert.equal(await fillMeanings(db), 1);
  assert.equal(await fillMeanings(db), 0);
  const { found } = await search(db, parseQuery('running shoes deal', NOW));
  assert.match(found[0].item.title, /Sneakers/);
});

test('deleting an item deletes its meaning too', async () => {
  const db = await seeded();
  await deleteItem(db, 5);
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM item_vectors WHERE item_id = 5');
  assert.equal(Number(row?.n), 0);
  assert.deepEqual(await related(db, 1), []);
});
