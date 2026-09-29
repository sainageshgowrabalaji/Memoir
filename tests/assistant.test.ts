// A day with Memoir, end to end: what you tell it, what it does, and what it answers later.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  correct,
  habitSuggestion,
  habitsToday,
  learnedSummary,
  listItemsOf,
  loadLearned,
  moveTodo,
  recentTalk,
  setHabitDone,
  tell,
  tellAs,
  undoLast,
} from '../src/db/assistant';
import { diaryFor, listTodos } from '../src/db/repo';
import { migrate } from '../src/db/schema';
import { memoryDb } from './sqlite';

const DAY = 24 * 60 * 60 * 1000;
// Monday 28 September 2026
const at = (hour: number, minute = 0, dayOffset = 0) => new Date(2026, 8, 28 + dayOffset, hour, minute);

async function fresh() {
  const db = memoryDb();
  await migrate(db);
  return db;
}

test('a day of telling Memoir things, and asking about them', async () => {
  const db = await fresh();

  let r = await tell(db, 'Remind me to call Amma at 7pm', at(9));
  assert.equal(r.text, "Got it. I'll remind you today at 7:00 PM to call Amma.");
  r = await tell(db, 'I need to renew my passport by Oct 28', at(9, 5));
  assert.match(r.text, /remind you .*Oct 28.* to renew your passport/);
  r = await tell(db, 'Add milk, eggs and bread to the shopping list', at(9, 10));
  assert.equal(r.text, 'Added milk, eggs and bread to your shopping list.');
  r = await tell(db, 'buy coffee', at(9, 11));
  assert.equal(r.text, 'Added coffee to your shopping list.');
  r = await tell(db, 'Remind me to drink water every day at 10am', at(9, 15));
  assert.equal(r.text, "New habit. Drink water, every day at 10:00 AM. I'll remind you, and you can tick it on Today.");
  r = await tell(db, "Priya's wedding is on Nov 21 in Tirupati", at(9, 20));
  assert.equal(r.text, "Got it. Priya's wedding, Sat, Nov 21 at 9:00 AM. I'll remind you then.");
  r = await tell(db, 'The wifi password at the cabin is sunrise42', at(9, 25));
  assert.match(r.text, /^Saved to your notes/);

  // Evening: what happened.
  r = await tell(db, 'Went to the gym in the morning and had lunch with Ravi', at(20));
  assert.equal(r.text, "Added to today's diary.");
  r = await tell(db, 'I called Amma', at(20, 5));
  assert.equal(r.text, 'Nice. Ticked off "Call Amma" and noted it in today\'s diary.');
  r = await tell(db, 'bought milk and eggs', at(20, 10));
  assert.match(r.text, /ticked milk off your shopping list/);

  // Questions, answered from your own words.
  r = await tell(db, "what's on my shopping list?", at(20, 15));
  assert.equal(r.text, 'Your shopping list has eggs, bread and coffee.');
  r = await tell(db, 'What do I have tomorrow?', at(20, 16));
  assert.match(r.text, /^Tomorrow/);
  r = await tell(db, 'wifi password?', at(20, 17));
  assert.match(r.text, /sunrise42/);
  r = await tell(db, "When is Priya's wedding?", at(20, 18));
  assert.match(r.text, /Priya's wedding, .*Nov 21/);
  r = await tell(db, 'What did I do today?', at(20, 19));
  assert.match(r.text, /^Today you wrote, "Went to the gym/);

  const open = await listTodos(db, true);
  assert.deepEqual(open.map((t) => t.title).sort(), ["Priya's wedding", 'Renew my passport']);
  const diary = await diaryFor(db, at(21));
  assert.match(diary!.text, /gym[\s\S]*called Amma/);

  // Next day: yesterday's diary and a count.
  r = await tell(db, 'What did I do yesterday?', at(8, 0, 1));
  assert.match(r.text, /^Yesterday you wrote, "Went to the gym/);
  r = await tell(db, 'Went to the gym again', at(19, 0, 1));
  r = await tell(db, 'How many times did I go to the gym this month?', at(19, 5, 1));
  assert.match(r.text, /^2 times this month/);
  r = await tell(db, 'When did I last go to the gym?', at(19, 6, 1));
  assert.match(r.text, /^Last time was today/);
});

test('undo takes back exactly what was done', async () => {
  const db = await fresh();
  await tell(db, 'Remind me to call Amma at 7pm', at(9));
  await tell(db, 'I called Amma', at(20));
  assert.equal((await listTodos(db, true)).length, 0);
  const r = await tell(db, 'undo', at(20, 1));
  assert.match(r.text, /^Undone/);
  assert.equal((await listTodos(db, true)).length, 1, 'the to-do is open again');
  assert.equal(await diaryFor(db, at(21)), null, 'and the diary line is gone');
  await undoLast(db);
  assert.equal((await listTodos(db, true)).length, 0);
  assert.equal(await undoLast(db), 'There is nothing to undo.');
});

test('correcting it moves the thing and teaches it for next time', async () => {
  const db = await fresh();
  let r = await tell(db, 'Kafka consumer group rebalancing notes', at(10));
  assert.equal(r.kind, 'note');
  r = await correct(db, r.logId, 'todo', at(10, 1));
  assert.equal(r.kind, 'todo');
  assert.match(r.text, /I'll remember that\.$/);
  assert.equal((await listTodos(db, true))[0].title, 'Kafka consumer group rebalancing notes');

  // A couple more corrections the same way, and similar sentences go there by themselves.
  r = await tell(db, 'Kafka partition strategy notes', at(11));
  await correct(db, r.logId, 'todo', at(11, 1));
  r = await tell(db, 'Kafka offsets notes', at(12));
  if (r.kind !== 'todo') await correct(db, r.logId, 'todo', at(12, 1));
  r = await tell(db, 'Kafka retention notes', at(13));
  assert.equal(r.kind, 'todo', 'learned from the corrections');
  const learned = await loadLearned(db);
  assert.ok((learned.examples.todo ?? 0) >= 4);
});

test('moving an "evening" reminder teaches what evening means for you', async () => {
  const db = await fresh();
  await tell(db, 'remind me to water the plants this evening', at(9));
  const todo = (await listTodos(db, true))[0];
  assert.equal(new Date(todo.dueAt!).getHours(), 19);
  await moveTodo(db, todo.id, at(18, 30).getTime());
  await tell(db, 'remind me to take a walk tomorrow evening', at(9, 30));
  const walk = (await listTodos(db, true)).find((t) => t.title.startsWith('Take a walk'))!;
  assert.deepEqual([new Date(walk.dueAt!).getHours(), new Date(walk.dueAt!).getMinutes()], [18, 30]);
});

test('habits keep a streak, and ones you keep writing about are suggested', async () => {
  const db = await fresh();
  await tell(db, 'Remind me to drink water every day at 10am', at(9));
  let [water] = await habitsToday(db, at(12));
  assert.equal(water.streak, 0);
  await setHabitDone(db, water.id, true, at(12, 0, -1));
  await setHabitDone(db, water.id, true, at(12));
  [water] = await habitsToday(db, at(12));
  assert.equal(water.doneToday, true);
  assert.equal(water.streak, 2);

  for (let d = -5; d <= -1; d += 2) await tell(db, 'Went to the gym after work', at(19, 0, d));
  const suggestion = await habitSuggestion(db, at(12));
  assert.equal(suggestion?.word, 'gym');
  assert.equal(suggestion?.days, 3);

  const talk = await recentTalk(db);
  assert.ok(talk.length >= 4);
});

test('lists keep items once and remember where things go', async () => {
  const db = await fresh();
  await tell(db, 'Add passport and sunscreen to the packing list', at(9));
  const r = await tell(db, 'Add passport to the packing list', at(9, 1));
  assert.equal(r.text, 'Passport is already on your packing list.');
  await tell(db, 'buy sunscreen', at(9, 2));
  assert.equal((await listItemsOf(db, 'packing')).length, 2, 'sunscreen stays on packing, no copy');
  const again = await tell(db, 'buy more sunscreen please', at(9, 3));
  assert.match(again.text, /packing list/);
  void DAY;
});

test('looking after what is saved: move, delete, tick, take off a list, all by saying so', async () => {
  const db = await fresh();
  await tell(db, 'remind me at 5 to leave for the airport', at(9));
  await tell(db, 'dentist appointment on Oct 5 at 11am', at(9, 1));
  await tell(db, 'Remind me to call dad at 7pm', at(9, 2));
  await tell(db, 'add milk, eggs and bread to the shopping list', at(9, 3));

  let r = await tell(db, 'move the airport reminder to 6pm', at(9, 4));
  assert.equal(r.text, 'Moved "Leave for the airport" to today at 6:00 PM.');
  r = await tell(db, 'push the dentist to Friday', at(9, 5));
  assert.equal(r.text, 'Moved "Dentist appointment" to Friday at 11:00 AM.');
  r = await tell(db, 'undo', at(9, 6));
  const dentist = (await listTodos(db, true)).find((t) => t.title === 'Dentist appointment')!;
  assert.equal(new Date(dentist.dueAt!).getDate(), 5, 'undo puts the old time back');

  r = await tell(db, 'mark call dad as done', at(9, 7));
  assert.equal(r.text, 'Ticked off "Call dad".');
  r = await tell(db, 'delete the dentist reminder', at(9, 8));
  assert.equal(r.text, 'Deleted "Dentist appointment". No more reminders for it.');
  r = await tell(db, 'undo', at(9, 9));
  assert.ok((await listTodos(db, true)).some((t) => t.title === 'Dentist appointment'), 'and undo brings it back');

  r = await tell(db, 'remove milk from the shopping list', at(9, 10));
  assert.equal(r.text, 'Took milk off your shopping list.');
  r = await tell(db, 'milk', at(9, 11));
  assert.equal(r.text, 'Added milk to your shopping list.');
  r = await tell(db, 'clear my shopping list', at(9, 12));
  assert.equal(r.text, 'Cleared your shopping list.');
  assert.equal((await listItemsOf(db, 'shopping')).length, 0);
  await tell(db, 'undo', at(9, 13));
  assert.equal((await listItemsOf(db, 'shopping')).length, 3);

  r = await tell(db, 'Remind me to drink water every day at 10am', at(9, 14));
  r = await tell(db, 'stop reminding me to drink water', at(9, 15));
  assert.equal(r.text, 'Stopped the habit "Drink water". Its reminders are off.');
  assert.equal((await habitsToday(db, at(9, 16))).length, 0);

  // "Cancel the netflix subscription" is a to-do, not a delete, because nothing like it is saved.
  r = await tell(db, 'remove the stain from my white shirt', at(9, 17));
  assert.equal(r.kind, 'todo');
  r = await tell(db, 'did I call dad', at(20));
  assert.match(r.text, /^Yes\. You ticked off "Call dad" today at 9:07 AM\.$/);
  r = await tell(db, 'hi', at(20, 1));
  assert.equal(r.kind, 'chat');
  assert.equal(await undoLast(db), 'Undone. "remove the stain from my white shirt" is gone.', 'small talk is never undone');
});

test('boxes that already say what they are for save exactly that', async () => {
  const db = await fresh();
  let r = await tellAs(db, 'call the bank at 5', 'todo', at(9));
  assert.equal(r.text, "Got it. I'll remind you today at 5:00 PM to call the bank.");
  r = await tellAs(db, 'read 20 minutes before bed', 'habit', at(9, 1));
  assert.equal(r.text, "New habit. Read 20 minutes, every day at 10:00 PM. I'll remind you, and you can tick it on Today.");
  r = await tellAs(db, 'Long day. Finished the Kafka demo and called the bank', 'diary', at(19));
  assert.match(r.text, /^Added to today's diary\. And ticked off "Call the bank"\./);
  const summary = await learnedSummary(db);
  assert.match(summary.lines[0], /^It has read 3 things you told it\./);
});

test('a week of talking the way people dictate, from an independent test run', async () => {
  const db = await fresh();
  const day = (d: number, h: number, m = 0) => at(h, m, d);
  let r = await tell(db, 'add onions tomatoes and coriander to my shopping list', day(0, 8));
  assert.equal(r.text, 'Added onions, tomatoes and coriander to your shopping list.');
  r = await tell(db, 'green chillies', day(0, 8, 1));
  assert.equal(r.text, 'Added green chillies to your shopping list.');
  r = await tell(db, 'um also potatoes', day(0, 8, 2));
  assert.equal(r.text, 'Added potatoes to your shopping list.');
  r = await tell(db, 'remind me to pick up dry cleaning at 5 30 pm', day(0, 8, 3));
  assert.equal(r.text, "Got it. I'll remind you today at 5:30 PM to pick up dry cleaning.");
  r = await tell(db, 'move the dry cleaning reminder to 6', day(0, 8, 4));
  assert.equal(r.text, 'Moved "Pick up dry cleaning" to today at 6:00 PM.');
  r = await tell(db, 'pay credit card bill end of the month', day(0, 8, 5));
  assert.equal(r.text, "Got it. I'll remind you Wednesday at 9:00 AM to pay credit card bill.");
  r = await tell(db, 'i need to buy a birthday gift for mom before october 10', day(0, 8, 6));
  assert.doesNotMatch(r.text, /repeats/);
  r = await tell(db, 'lunch with ankit on thursday at 1', day(0, 8, 7));
  assert.equal(r.text, "Got it. Lunch with ankit, Thursday at 1:00 PM. I'll remind you then.");
  r = await tell(db, 'meditate every night at 9', day(0, 8, 8));
  r = await tell(db, 'meditated', day(0, 21, 5));
  assert.equal(r.text, "Added to today's diary. And ticked your habit, meditate.");
  r = await tell(db, 'picked up the dry cleaning', day(0, 21, 6));
  assert.equal(r.text, 'Added to today\'s diary. And ticked off "Pick up dry cleaning".');
  r = await tell(db, 'create a list called movies to watch', day(0, 21, 7));
  assert.match(r.text, /^Started your movies to watch list/);
  r = await tell(db, 'add interstellar and 3 idiots to movies to watch', day(0, 21, 8));
  assert.equal(r.text, 'Added interstellar and 3 idiots to your movies to watch list.');
  r = await tell(db, 'remove interstellar from movies to watch', day(0, 21, 9));
  assert.equal(r.text, 'Took interstellar off your movies to watch list.');
  r = await tell(db, 'what lists do i have', day(0, 21, 10));
  assert.equal(r.text, 'You have 2 lists. Movies to watch (1 left) and shopping (5 left).');
  r = await tell(db, 'how many todos do i have', day(0, 21, 11));
  assert.match(r.text, /^You have 3 open to-dos\./);
  r = await tell(db, 'wrote a blog post about kafka consumer lag today', day(6, 20));
  assert.equal(r.kind, 'diary');
  r = await tell(db, 'what did i do on monday', day(5, 20));
  assert.match(r.text, /^On Monday you wrote, "Meditated\. Picked up the dry cleaning\./);
  r = await tell(db, 'good night', day(6, 22));
  assert.equal(r.text, 'Good night. Sleep well.');
});
