// The brain, tested with the kinds of things people really save.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { analyze } from '../src/brain/analyze';
import { findUrls, linkTitle, sourceOf } from '../src/brain/links';
import { findPeople } from '../src/brain/people';
import { parseQuery } from '../src/brain/query';
import { planReminders, reminderTimes } from '../src/brain/reminders';
import { detectTodo } from '../src/brain/todo';

// Monday 28 September 2026, 5:30 PM
const NOW = new Date(2026, 8, 28, 17, 30);
const DAY = 24 * 60 * 60 * 1000;

test('an Instagram reel is public, from Instagram, and on the travel shelf', () => {
  const a = analyze({ text: 'https://www.instagram.com/reel/Cx12abc/ amazing hiking trail near Denver' }, NOW);
  assert.equal(a.kind, 'link');
  assert.equal(a.source, 'instagram');
  assert.equal(a.scope, 'public');
  assert.equal(a.category, 'travel');
  assert.equal(a.title, 'Amazing hiking trail near Denver');
});

test('a bare link still gets a readable title', () => {
  assert.equal(linkTitle('https://www.instagram.com/reel/Cx12abc/'), 'Instagram reel');
  assert.equal(linkTitle('https://youtu.be/abc123'), 'YouTube video');
  assert.equal(linkTitle('https://www.nytimes.com/2026/09/best-hiking-trails-colorado.html'), 'Best hiking trails colorado (nytimes.com)');
  assert.equal(analyze({ text: 'https://youtu.be/abc123' }, NOW).title, 'YouTube video');
});

test('links are found even without https and lose trailing punctuation', () => {
  assert.deepEqual(findUrls('see www.example.com/page, and (https://a.b/c).'), ['https://www.example.com/page', 'https://a.b/c']);
  assert.equal(sourceOf('https://maps.app.goo.gl/xyz'), 'maps');
  assert.equal(sourceOf('https://www.amazon.com/dp/B0'), 'shopping');
});

test('a note about family is personal and names the people', () => {
  const a = analyze({ text: "Amma said Priya's wedding is on Nov 21 in Tirupati" }, NOW);
  assert.equal(a.scope, 'personal');
  assert.equal(a.category, 'people');
  assert.ok(a.people.includes('Amma'));
  assert.ok(a.people.includes('Priya'));
});

test('people are not confused with apps, days or places', () => {
  assert.deepEqual(findPeople('Watched a YouTube video on Monday in Hyderabad'), []);
  assert.deepEqual(findPeople('Dinner with Ravi Kumar and Meena'), ['Ravi Kumar', 'Meena']);
});

test('a photo is personal and keeps its caption as the title', () => {
  const a = analyze({ text: 'Parking spot at the airport, level 3 row F', photoUri: 'file:///p/1.jpg' }, NOW);
  assert.equal(a.kind, 'photo');
  assert.equal(a.scope, 'personal');
  assert.equal(a.category, 'travel');
});

test('"I want to" becomes a to-do with a due date', () => {
  const t = detectTodo('I want to renew my passport next month', NOW);
  assert.ok(t);
  assert.equal(t.title, 'Renew my passport');
  const due = new Date(t.dueAt!);
  assert.equal(due.getMonth(), 9); // October
  assert.equal(due.getHours(), 9);
});

test('remind me with a time keeps that time', () => {
  const t = detectTodo('Remind me to call the dentist tomorrow at 4pm', NOW);
  assert.equal(t?.title, 'Call the dentist');
  const due = new Date(t!.dueAt!);
  assert.equal(due.getDate(), 29);
  assert.equal(due.getHours(), 16);
});

test('"today" said in the evening is not due in the past', () => {
  const t = detectTodo('need to pay the electricity bill today', NOW);
  assert.equal(t?.title, 'Pay the electricity bill');
  assert.ok(t!.dueAt! > NOW.getTime());
});

test('a short action note is a to-do, a story is not', () => {
  assert.equal(detectTodo('Buy milk and bread', NOW)?.title, 'Buy milk and bread');
  assert.equal(detectTodo('Today was a long day at work and the meeting ran late', NOW), null);
  assert.equal(detectTodo('https://www.instagram.com/reel/x cool dance', NOW), null);
});

test('a to-do with no date has no due time', () => {
  const t = detectTodo('I should learn to swim', NOW);
  assert.equal(t?.title, 'Learn to swim');
  assert.equal(t?.dueAt, null);
});

test('a question becomes filters and search words', () => {
  const q = parseQuery('I remember saving a reel about hiking last week', NOW);
  assert.deepEqual(q.sources, ['instagram']);
  assert.ok(q.terms.includes('hiking') && q.terms.includes('trail'));
  assert.ok(!q.terms.includes('remember') && !q.terms.includes('saving'));
  assert.deepEqual(q.understood.slice(0, 2), ['Last week', 'Instagram']);
  const lastMonday = new Date(2026, 8, 21).getTime();
  assert.equal(q.from, lastMonday - 1 * DAY); // last week starts on the Sunday before
  assert.equal(q.to, new Date(2026, 8, 27).getTime());
});

test('photos, to-dos, people and months are understood', () => {
  assert.deepEqual(parseQuery('photos from yesterday', NOW).kinds, ['photo']);
  assert.equal(parseQuery('what are my tasks', NOW).todosOnly, true);
  const amma = parseQuery('what did Amma say about the wedding', NOW, ['Amma', 'Priya']);
  assert.deepEqual(amma.people, ['Amma']);
  // Each thing understood shows once, so no "Amma" and "amma" side by side.
  assert.deepEqual(amma.understood, ['Amma', 'wedding']);
  const march = parseQuery('the recipe I saved in March', NOW);
  assert.equal(new Date(march.from!).getMonth(), 2);
  assert.equal(new Date(march.from!).getFullYear(), 2026);
  // "may" as a word is not the month of May.
  assert.equal(parseQuery('I may have saved a coffee place', NOW).from, null);
});

test('reminders nudge on the due day, then 1, 3 and 7 days later, and never in the past', () => {
  const due = NOW.getTime() + 2 * 60 * 60 * 1000;
  const times = reminderTimes({ id: 1, title: 'x', dueAt: due, createdAt: NOW.getTime() }, NOW.getTime());
  assert.deepEqual(times.map((t) => Math.round((t - due) / DAY)), [0, 1, 3, 7]);
  const noDate = reminderTimes({ id: 2, title: 'y', dueAt: null, createdAt: NOW.getTime() }, NOW.getTime());
  assert.equal(new Date(noDate[0]).getHours(), 9);
  assert.equal(new Date(noDate[0]).getDate(), 29);
  const longOverdue = reminderTimes({ id: 3, title: 'z', dueAt: NOW.getTime() - 30 * DAY, createdAt: 0 }, NOW.getTime());
  assert.ok(longOverdue.length === 2 && longOverdue.every((t) => t > NOW.getTime()));
});

test('never more reminders than an iPhone allows', () => {
  const todos = Array.from({ length: 40 }, (_, i) => ({ id: i, title: `t${i}`, dueAt: null, createdAt: NOW.getTime() }));
  const plan = planReminders(todos, NOW.getTime());
  assert.equal(plan.length, 60);
  assert.ok(plan.every((p, i) => i === 0 || plan[i - 1].at <= p.at));
});

test('"I will" and "I\'m going to" are to-dos too', () => {
  assert.equal(detectTodo("I'll call Ravi on Friday", NOW)?.title, 'Call Ravi');
  assert.equal(detectTodo("I'm going to start running every morning", NOW)?.title, 'Start running every morning');
});
