// Reading old saves from a WhatsApp chat export and Instagram's saved posts export.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { linksFromExport, looksLikeWhatsApp, parseInstagramSaved, parseWhatsApp } from '../src/brain/imports';

const IPHONE_CHAT = `[9/12/26, 9:41:03 PM] Sai Nagesh: Messages and calls are end-to-end encrypted.
[9/12/26, 9:41:10 PM] Sai Nagesh: https://www.instagram.com/reel/C4abcDEF/?igsh=MWx0 try this dosa place
[9/13/26, 7:02:55 AM] Sai Nagesh: ‎image omitted
[9/14/26, 11:20:00 AM] Sai Nagesh: Kafka talk for the interview
https://youtu.be/abc123
watch before Friday
[9/15/26, 6:05:12 PM] Sai Nagesh: just a note without a link`;

const ANDROID_CHAT = `14/09/2026, 18:05 - Sai: https://www.instagram.com/p/Cx12/ stretches for back pain
14/09/2026, 18:06 - Sai: <Media omitted>
15/09/2026, 08:30 - Sai: https://example.com/article?id=2`;

test('an iPhone WhatsApp export gives each link with its time and the words sent with it', () => {
  assert.ok(looksLikeWhatsApp(IPHONE_CHAT));
  const links = parseWhatsApp(IPHONE_CHAT);
  assert.equal(links.length, 2);
  assert.equal(links[0].url, 'https://www.instagram.com/reel/C4abcDEF/?igsh=MWx0');
  assert.equal(links[0].note, 'try this dosa place');
  const sent = new Date(links[0].at!);
  assert.deepEqual([sent.getMonth() + 1, sent.getDate(), sent.getFullYear(), sent.getHours(), sent.getMinutes()], [9, 12, 2026, 21, 41]);
  assert.equal(links[1].url, 'https://youtu.be/abc123');
  assert.equal(links[1].note, 'Kafka talk for the interview watch before Friday');
  assert.equal(new Date(links[1].at!).getHours(), 11);
});

test('an Android export with the day first reads the dates the right way round', () => {
  const links = parseWhatsApp(ANDROID_CHAT);
  assert.equal(links.length, 2);
  const first = new Date(links[0].at!);
  assert.deepEqual([first.getMonth() + 1, first.getDate(), first.getHours()], [9, 14, 18]);
  assert.equal(links[0].note, 'stretches for back pain');
});

test("Instagram's saved posts export, in its JSON and HTML forms", () => {
  const json = JSON.stringify({
    saved_saved_media: [
      { title: 'nomadic.eats', string_map_data: { 'Saved on': { href: 'https://www.instagram.com/reel/C4abcDEF/', timestamp: 1757721600 } } },
      { title: 'fit.with.ravi', string_map_data: { 'Saved on': { href: 'https://www.instagram.com/p/Cx12/', timestamp: 1757808000 } } },
    ],
  });
  const links = parseInstagramSaved(json);
  assert.equal(links.length, 2);
  assert.equal(links[0].author, '@nomadic.eats');
  assert.equal(links[0].at, 1757721600 * 1000);

  const newer = JSON.stringify([
    { label_values: [{ label: 'Saved on', value: 'https://www.instagram.com/reel/Z9/', href: 'https://www.instagram.com/reel/Z9/' }], timestamp: 1757900000, title: 'cookwithmeera' },
  ]);
  const newerLinks = parseInstagramSaved(newer);
  assert.equal(newerLinks.length, 1);
  assert.equal(newerLinks[0].url, 'https://www.instagram.com/reel/Z9/');
  assert.equal(newerLinks[0].author, '@cookwithmeera');

  const html = '<div><a target="_blank" href="https://www.instagram.com/reel/C4abcDEF/">link</a><a href="https://www.instagram.com/nomadic.eats/">profile</a></div>';
  assert.deepEqual(parseInstagramSaved(html).map((l) => l.url), ['https://www.instagram.com/reel/C4abcDEF/']);
});

test('any export gives each link once, newest first', () => {
  const links = linksFromExport(`${IPHONE_CHAT}\n[9/16/26, 8:00:00 AM] Sai Nagesh: again https://www.instagram.com/reel/C4abcDEF/`, '_chat.txt');
  assert.equal(links.length, 2);
  assert.equal(links[0].url, 'https://www.instagram.com/reel/C4abcDEF/', 'the newer copy of the same reel is kept');
  const plain = linksFromExport('Notes: https://example.com/a and https://example.com/b', 'notes.txt');
  assert.equal(plain.length, 2);
});

test('imported links wait in a backlog and come back three a day, newest first', async () => {
  const { memoryDb } = await import('./sqlite');
  const { migrate } = await import('../src/db/schema');
  const { countBacklog, countToCheck, importLinks, listToCheck, promoteBacklog, saveCapture } = await import('../src/db/repo');
  const db = memoryDb();
  await migrate(db);
  const now = new Date(2026, 8, 28, 17, 30);
  await saveCapture(db, { text: 'https://www.instagram.com/reel/C4abcDEF/' }, now);

  const links = parseWhatsApp(IPHONE_CHAT).concat(parseWhatsApp(ANDROID_CHAT));
  assert.deepEqual(await importLinks(db, links, now), { added: 3, skipped: 1 });
  assert.equal(await countBacklog(db), 3);
  assert.equal(await countToCheck(db), 1, 'the backlog does not flood the list');

  assert.equal(await promoteBacklog(db, now), 3);
  assert.equal(await promoteBacklog(db, now), 0, 'only three a day');
  assert.equal(await countBacklog(db), 0);
  const later = (await listToCheck(db, now)).later;
  assert.equal(later.length, 3, 'they come back this evening');
  assert.match(later[0].text, /try|Kafka|stretches|example/);
});
