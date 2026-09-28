// Saved reels and links: reading their page, following up until checked, and the nudges.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseQuery } from '../src/brain/query';
import { checkTimes, digestMessage, firstEvening, laterChoices, planCheckDigests } from '../src/brain/reminders';
import {
  applyPage,
  countToCheck,
  getItem,
  listToCheck,
  pendingPages,
  remindLater,
  saveCapture,
  search,
  setChecked,
  setNote,
  toCheckForReminders,
  updateItem,
} from '../src/db/repo';
import { migrate } from '../src/db/schema';
import { OfflineError, readPage, type Fetcher } from '../src/lib/link-reader';
import { memoryDb } from './sqlite';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// Monday 28 September 2026, 5:30 PM
const NOW = new Date(2026, 8, 28, 17, 30);

const REEL = 'https://www.instagram.com/reel/C4abcDEF/?igsh=MWx0';
const DOSA_PAGE = {
  title: '',
  text: 'Best dosa in Jersey City 🔥 Saravana Bhavan, Newark Ave.\nOpen 8am to 10pm. Try the ghee roast.\n#dosa #jerseycity',
  author: '@nomadic.eats',
  image: 'https://cdn.example/dosa.jpg',
  postedOn: 'March 3, 2024',
};

async function fresh() {
  const db = memoryDb();
  await migrate(db);
  return db;
}

test('a saved link starts as "to check" and waits for its page to be read', async () => {
  const db = await fresh();
  const { item } = await saveCapture(db, { text: REEL }, NOW);
  assert.equal(item.checkState, 'to_check');
  assert.equal(item.page.status, 'pending');
  assert.equal(item.title, 'Instagram reel');
  const note = (await saveCapture(db, { text: 'Call the bank about the card' }, NOW)).item;
  assert.equal(note.checkState, 'none');
  assert.deepEqual((await pendingPages(db)).map((i) => i.id), [item.id]);
});

test("reading a reel's page gives it the caption, a real title and the right shelf", async () => {
  const db = await fresh();
  const { item } = await saveCapture(db, { text: REEL }, NOW);
  const read = (await applyPage(db, item.id, DOSA_PAGE, NOW))!;
  assert.equal(read.page.status, 'read');
  assert.equal(read.page.author, '@nomadic.eats');
  assert.equal(read.title, 'Best dosa in Jersey City 🔥 Saravana Bhavan, Newark Ave.');
  assert.equal(read.category, 'food');
  assert.ok(read.tags.includes('dosa') && read.tags.includes('jerseycity'));
  assert.equal(read.checkState, 'to_check', 'reading the page is not the same as you checking it');
  assert.deepEqual(await pendingPages(db), []);

  // The caption is searchable, by words and by meaning.
  const byWords = await search(db, parseQuery('ghee roast', NOW));
  assert.equal(byWords.found[0]?.item.id, item.id);
  const byMeaning = await search(db, parseQuery('south indian breakfast place', NOW));
  assert.equal(byMeaning.found[0]?.item.id, item.id);
});

test('your own words and your own shelf are kept when the page is read', async () => {
  const db = await fresh();
  const { item } = await saveCapture(db, { text: `${REEL} for Amma's birthday dinner` }, NOW);
  await updateItem(db, item.id, { category: 'people' }, NOW);
  const read = (await applyPage(db, item.id, DOSA_PAGE, NOW))!;
  assert.match(read.text, /for Amma's birthday dinner/, 'your words stay with it');
  assert.equal(read.category, 'people', 'the shelf you chose stays');
});

test('a page that cannot be read is tried a few times, then left alone', async () => {
  const db = await fresh();
  const { item } = await saveCapture(db, { text: REEL }, NOW);
  for (let i = 0; i < 4; i++) {
    assert.equal((await pendingPages(db)).length, 1);
    await applyPage(db, item.id, null, NOW);
  }
  assert.equal((await getItem(db, item.id))!.page.status, 'failed');
  assert.deepEqual(await pendingPages(db), []);
  assert.equal((await getItem(db, item.id))!.checkState, 'to_check', 'still on the list, with its link');
});

test('opening it, "later" and "done" move it around the follow-up list', async () => {
  const db = await fresh();
  const a = (await saveCapture(db, { text: REEL }, new Date(NOW.getTime() - 2 * DAY))).item;
  const b = (await saveCapture(db, { text: 'https://youtu.be/abc123' }, NOW)).item;
  let list = await listToCheck(db, NOW);
  assert.deepEqual(list.due.map((i) => i.id), [a.id, b.id], 'longest waiting first');

  await remindLater(db, a.id, NOW.getTime() + DAY);
  list = await listToCheck(db, NOW);
  assert.deepEqual(list.due.map((i) => i.id), [b.id]);
  assert.deepEqual(list.later.map((i) => i.id), [a.id]);

  await setChecked(db, b.id, true, NOW);
  assert.equal(await countToCheck(db), 1);
  assert.equal((await getItem(db, b.id))!.checkedAt, NOW.getTime());
  await setChecked(db, b.id, false, NOW);
  assert.equal(await countToCheck(db), 2);
});

test('a note you add later is searchable', async () => {
  const db = await fresh();
  const { item } = await saveCapture(db, { text: REEL }, NOW);
  await setNote(db, item.id, 'try this with the team on Friday', NOW);
  const { found } = await search(db, parseQuery('team friday', NOW));
  assert.equal(found[0]?.item.id, item.id);
});

test('nudges come in the evening, then 1, 3 and 7 days later, then weekly', () => {
  assert.equal(new Date(firstEvening(NOW.getTime())).getHours(), 20);
  assert.equal(new Date(firstEvening(NOW.getTime())).getDate(), 28, 'saved at 5:30 PM, so tonight');
  const late = new Date(2026, 8, 28, 21, 0).getTime();
  assert.equal(new Date(firstEvening(late)).getDate(), 29, 'saved at 9 PM, so tomorrow evening');

  const times = checkTimes({ id: 1, title: 'x', createdAt: NOW.getTime(), checkAfter: null }, NOW.getTime());
  const first = firstEvening(NOW.getTime());
  assert.deepEqual(times.slice(0, 5).map((t) => Math.round((t - first) / DAY)), [0, 1, 3, 7, 14]);
  assert.ok(times.every((t) => t > NOW.getTime()));
});

test('links due at the same time share one notification', () => {
  const now = NOW.getTime();
  const items = [
    { id: 1, title: 'Best dosa in Jersey City', createdAt: now - HOUR, checkAfter: null, source: 'instagram' },
    { id: 2, title: '3 stretches for a stiff back', createdAt: now - 2 * HOUR, checkAfter: null, source: 'instagram' },
    { id: 3, title: 'Kafka in 20 minutes', createdAt: now, checkAfter: now + 2 * DAY },
  ];
  const digests = planCheckDigests(items, now);
  assert.equal(digests[0].items.length, 2);
  assert.equal(new Date(digests[0].at).getHours(), 20);
  assert.ok(digests.length <= 14);
  const message = digestMessage(digests[0]);
  assert.equal(message.title, '2 reels to check');
  assert.equal(message.body, '• Best dosa in Jersey City\n• 3 stretches for a stiff back');
  assert.equal(digestMessage({ at: now, items: [{ id: 1, title: 'One' }] }).title, 'Time to check this');
  const many = digestMessage({ at: now, items: [1, 2, 3, 4, 5].map((id) => ({ id, title: `T${id}` })) });
  assert.match(many.body, /and 2 more$/);
});

test('"remind me later" choices land at sensible times', () => {
  const monday = laterChoices(NOW.getTime());
  assert.deepEqual(monday.map((c) => c.label), ['Tonight', 'Tomorrow', 'This weekend', 'Next week']);
  const weekend = new Date(monday[2].at);
  assert.equal(weekend.getDay(), 6);
  assert.equal(weekend.getHours(), 10);
  const nextWeek = new Date(monday[3].at);
  assert.equal(nextWeek.getDay(), 1);
  assert.equal(nextWeek.getDate(), 5);
  const saturdayNight = laterChoices(new Date(2026, 9, 3, 22, 0).getTime());
  assert.deepEqual(saturdayNight.map((c) => c.label), ['Tomorrow', 'Sunday morning', 'Next week']);
});

test('to-check items feed the reminders', async () => {
  const db = await fresh();
  await saveCapture(db, { text: REEL }, NOW);
  const due = await toCheckForReminders(db);
  assert.equal(due.length, 1);
  assert.equal(due[0].checkAfter, null);
});

// ------------------------------------------------------------ fetching, with a pretend internet

function fakeInternet(pages: Record<string, { status?: number; body: string }>): { fetcher: Fetcher; asked: { url: string; ua: string }[] } {
  const asked: { url: string; ua: string }[] = [];
  const fetcher: Fetcher = async (url, init) => {
    const ua = String((init?.headers as Record<string, string>)?.['User-Agent'] ?? '');
    asked.push({ url, ua });
    const page = pages[url];
    return new Response(page?.body ?? 'not found', { status: page ? (page.status ?? 200) : 404 });
  };
  return { fetcher, asked };
}

test('a reel is read from the preview tags, asked for as a link-preview bot', async () => {
  const { fetcher, asked } = fakeInternet({
    [REEL]: {
      body: `<meta property="og:title" content="nomadic.eats on Instagram: &quot;Best dosa&quot;">
             <meta property="og:image" content="https://cdn.example/dosa.jpg">
             <meta property="og:description" content="12 likes, 1 comments - nomadic.eats on March 3, 2024: &quot;Best dosa in Jersey City&quot;. ">`,
    },
  });
  const page = await readPage(REEL, 'instagram', fetcher);
  assert.equal(page?.text, 'Best dosa in Jersey City');
  assert.equal(page?.author, '@nomadic.eats');
  assert.match(asked[0].ua, /facebookexternalhit/);
  assert.equal(asked.length, 1, 'no second request when the tags already had everything');
});

test('when Instagram shows its login page, the embed page is read instead', async () => {
  const { fetcher, asked } = fakeInternet({
    [REEL]: { body: '<title>Instagram</title><meta property="og:title" content="Instagram">' },
    'https://www.instagram.com/reel/C4abcDEF/embed/captioned/': {
      body: '<span class="UsernameText">fit.with.ravi</span><img class="EmbeddedMediaImage" src="https://cdn.example/a.jpg"><div class="Caption"><a class="CaptionUsername">fit.with.ravi</a>3 stretches<br>Cat cow<div class="CaptionComments">x</div></div>',
    },
  });
  const page = await readPage(REEL, 'instagram', fetcher);
  assert.equal(page?.text, '3 stretches\nCat cow');
  assert.equal(page?.author, '@fit.with.ravi');
  assert.equal(asked.length, 2);
});

test('offline or blocked means "try again later", not a wrong answer', async () => {
  const offline: Fetcher = async () => {
    throw new TypeError('Network request failed');
  };
  await assert.rejects(readPage(REEL, 'instagram', offline), OfflineError);
  const { fetcher } = fakeInternet({});
  assert.equal(await readPage('https://example.com/a', 'web', fetcher), null);
});

test('YouTube gives the title from oEmbed and the description from the page', async () => {
  const url = 'https://www.youtube.com/watch?v=abc123';
  const { fetcher } = fakeInternet({
    [`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`]: {
      body: JSON.stringify({ title: 'Spring Boot + Kafka in 20 minutes', author_name: 'Tech Primers', thumbnail_url: 'https://i.ytimg.com/x.jpg' }),
    },
    [url]: { body: '<meta property="og:description" content="Code: github.com/x. Chapters 0:00 intro">' },
  });
  const page = await readPage(url, 'youtube', fetcher);
  assert.equal(page?.title, 'Spring Boot + Kafka in 20 minutes');
  assert.equal(page?.author, 'Tech Primers');
  assert.equal(page?.text, 'Code: github.com/x. Chapters 0:00 intro');
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
      VALUES ('link', 'Instagram reel', '${REEL} gorgeous hiking trail', '${REEL}', 'instagram', 'travel', 'public', 1, 1);
    INSERT INTO items (kind, title, text, source, category, scope, created_at, updated_at)
      VALUES ('note', 'Call the dentist', 'Call the dentist', 'me', 'health', 'personal', 2, 2);
    PRAGMA user_version = 2;
  `);
  await migrate(db);
  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  assert.equal(version?.user_version, 3);
  const link = (await getItem(db, 1))!;
  assert.equal(link.checkState, 'to_check');
  assert.equal(link.page.status, 'pending');
  assert.equal((await getItem(db, 2))!.checkState, 'none');
  // The search index was rebuilt, so old saves are still found by their words.
  const { found } = await search(db, parseQuery('dentist', NOW));
  assert.equal(found[0]?.item.id, 2);
});

test('a backup restores everything on a new phone, and restoring twice makes no copies', async () => {
  const { exportData, importData, listTodos: todos } = await import('../src/db/repo');
  const first = await fresh();
  const { item } = await saveCapture(first, { text: REEL }, NOW);
  await applyPage(first, item.id, DOSA_PAGE, NOW);
  await setNote(first, item.id, 'for the weekend', NOW);
  await saveCapture(first, { text: 'I need to renew my passport by Oct 28' }, NOW);
  const backup = JSON.parse(JSON.stringify(await exportData(first, NOW)));

  const second = await fresh();
  assert.deepEqual(await importData(second, backup), { added: 2, skipped: 0 });
  assert.deepEqual(await importData(second, backup), { added: 0, skipped: 2 });
  const restored = (await search(second, parseQuery('ghee roast', NOW))).found[0]?.item;
  assert.equal(restored?.note, 'for the weekend');
  assert.equal(restored?.page.author, '@nomadic.eats');
  const open = await todos(second, true);
  assert.equal(open.length, 1);
  assert.equal(open[0].title, 'Renew my passport');
  assert.ok(open[0].itemId !== null);
});

test('saving the same reel again brings the first one back instead of a copy', async () => {
  const db = await fresh();
  const first = await saveCapture(db, { text: REEL }, NOW);
  await setChecked(db, first.item.id, true, NOW);
  const again = await saveCapture(db, { text: 'https://instagram.com/reels/C4abcDEF' }, new Date(NOW.getTime() + DAY));
  assert.equal(again.duplicate, true);
  assert.equal(again.item.id, first.item.id);
  assert.equal(again.item.checkState, 'to_check');
  const withWords = await saveCapture(db, { text: `${REEL} show this to Ravi` }, NOW);
  assert.notEqual(withWords.item.id, first.item.id, 'with your own words it is a new save');
});

test('the diary keeps one entry a day, adds to it, and still catches to-dos and people', async () => {
  const { diaryFor, listDiary, writeDiary } = await import('../src/db/repo');
  const { diaryNudges } = await import('../src/brain/reminders');
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

  const nudges = diaryNudges(NOW.getTime(), true);
  assert.equal(new Date(nudges[0]).getDate(), 29, 'already wrote today, so tomorrow first');
  assert.equal(new Date(nudges[0]).getHours(), 21);
  assert.equal(diaryNudges(NOW.getTime(), false).length, 7);
});

test('what you have been into lately comes from what you save', async () => {
  const { interests } = await import('../src/db/repo');
  const db = await fresh();
  for (const [i, code] of ['A1', 'B2', 'C3'].entries()) {
    const { item } = await saveCapture(db, { text: `https://www.instagram.com/reel/${code}/` }, new Date(NOW.getTime() - i * HOUR));
    await applyPage(db, item.id, { ...DOSA_PAGE, text: `${DOSA_PAGE.text} ${i}` }, NOW);
  }
  const lately = await interests(db, NOW);
  assert.deepEqual(lately.shelves, ['food']);
  assert.ok(lately.tags.includes('dosa'));
  assert.deepEqual(lately.authors, ['@nomadic.eats']);
});

test('a few words of your own keep the page headline as the title', async () => {
  const db = await fresh();
  const { item } = await saveCapture(db, { text: 'https://youtu.be/abc123 for the interview prep' }, NOW);
  assert.equal(item.title, 'For the interview prep');
  const read = (await applyPage(db, item.id, { title: 'Spring Boot + Kafka in 20 minutes', text: '', author: 'Tech Primers', image: null, postedOn: '' }, NOW))!;
  assert.equal(read.title, 'Spring Boot + Kafka in 20 minutes');
  assert.match(read.text, /for the interview prep/);
  const long = (await saveCapture(db, { text: 'https://youtu.be/xyz Ravi said this explains consumer groups better than the docs do' }, NOW)).item;
  const kept = (await applyPage(db, long.id, { title: 'Kafka consumer groups', text: '', author: '', image: null, postedOn: '' }, NOW))!;
  assert.equal(kept.title, long.title, 'a real note of your own stays the title');
});
