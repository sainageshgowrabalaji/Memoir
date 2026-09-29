// The assistant must not fail on everyday sentences. Each line here is something a person would
// actually type or say, and what Memoir should do with it.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { emptyLearned, learn, learnList, learnTime, overlap, splitItems, stem, understand, type Plan } from '../src/brain/agent';

// Monday 28 September 2026, 5:30 PM
const NOW = new Date(2026, 8, 28, 17, 30);
const plan = (text: string, learned = emptyLearned()): Plan => understand(text, NOW, learned).plan;
const at = (ms: number) => {
  const d = new Date(ms);
  return [d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];
};

test('reminders and to-dos, with the time you said', () => {
  const call = plan('Remind me to call Amma at 7pm');
  assert.equal(call.kind, 'todo');
  if (call.kind !== 'todo') return;
  assert.equal(call.title, 'Call Amma');
  assert.deepEqual(at(call.dueAt!), [9, 28, 19, 0]);

  const dentist = plan('remind me to book the dentist tomorrow at 10');
  assert.equal(dentist.kind, 'todo');
  if (dentist.kind === 'todo') assert.deepEqual(at(dentist.dueAt!), [9, 29, 10, 0]);

  const passport = plan('I need to renew my passport by Oct 28');
  assert.equal(passport.kind, 'todo');
  if (passport.kind === 'todo') {
    assert.equal(passport.title, 'Renew my passport');
    assert.deepEqual(at(passport.dueAt!).slice(0, 2), [10, 28]);
  }

  const noTime = plan("Don't forget to pay the electricity bill");
  assert.equal(noTime.kind, 'todo');
  if (noTime.kind === 'todo') assert.equal(noTime.title, 'Pay the electricity bill');

  assert.equal(plan('Call the bank on Friday').kind, 'todo');
  assert.equal(plan('Submit the expense report').kind, 'todo');
});

test('"evening" and "tonight" mean your times, and it learns when you change them', () => {
  const tonight = plan('remind me to water the plants tonight');
  assert.equal(tonight.kind, 'todo');
  if (tonight.kind === 'todo') assert.deepEqual(at(tonight.dueAt!), [9, 28, 20, 0]);

  const morning = plan('remind me to take out the trash tomorrow morning');
  if (morning.kind === 'todo') assert.deepEqual(at(morning.dueAt!), [9, 29, 9, 0]);

  const early = learnTime(emptyLearned(), 'morning', 7, 30);
  const mine = plan('remind me to take out the trash tomorrow morning', early);
  if (mine.kind === 'todo') assert.deepEqual(at(mine.dueAt!), [9, 29, 7, 30]);
});

test('lists, with items split up and the right list chosen', () => {
  const add = plan('Add milk, eggs and bread to the shopping list');
  assert.deepEqual(add, { kind: 'list', list: 'shopping', items: ['milk', 'eggs', 'bread'] });
  const grocery = plan('add tomatoes to my grocery list');
  assert.deepEqual(grocery, { kind: 'list', list: 'shopping', items: ['tomatoes'] });
  const packing = plan('Add passport and charger to the packing list');
  assert.deepEqual(packing, { kind: 'list', list: 'packing', items: ['passport', 'charger'] });
  const buy = plan('buy coffee and bananas');
  assert.deepEqual(buy, { kind: 'list', list: 'shopping', items: ['coffee', 'bananas'] });
  const colon = plan('Groceries: rice, dal, curd');
  assert.deepEqual(colon, { kind: 'list', list: 'shopping', items: ['rice', 'dal', 'curd'] });
  // Something you once put on the packing list goes there again.
  const learned = learnList(emptyLearned(), ['sunscreen'], 'packing');
  assert.deepEqual(plan('buy sunscreen', learned), { kind: 'list', list: 'packing', items: ['sunscreen'] });
  // With a date it is a to-do, not a list item.
  assert.equal(plan('buy a gift for Priya by Friday').kind, 'todo');
});

test('habits and repeating reminders', () => {
  const water = plan('Remind me to drink water every day at 10am');
  assert.equal(water.kind, 'habit');
  if (water.kind === 'habit') assert.deepEqual(water.habit, { name: 'Drink water', days: [0, 1, 2, 3, 4, 5, 6], hour: 10, minute: 0 });
  const gym = plan('I want to go to the gym every morning');
  if (gym.kind === 'habit') {
    assert.equal(gym.habit.name, 'Go to the gym');
    assert.equal(gym.habit.hour, 9);
  } else assert.fail('gym should be a habit');
  const weekdays = plan('stand-up notes on weekdays at 9:30am');
  if (weekdays.kind === 'habit') assert.deepEqual(weekdays.habit.days, [1, 2, 3, 4, 5]);
  else assert.fail('weekdays should be a habit');
  const monday = plan('call Amma every Sunday evening');
  if (monday.kind === 'habit') {
    assert.deepEqual(monday.habit.days, [0]);
    assert.equal(monday.habit.hour, 19);
  } else assert.fail('Sunday call should be a habit');
});

test('your day goes in the diary, and "yesterday" goes on yesterday', () => {
  const gym = plan('Went to the gym in the morning and had lunch with Ravi');
  assert.equal(gym.kind, 'diary');
  const tired = plan('Feeling tired today but happy with the demo');
  assert.equal(tired.kind, 'diary');
  const yday = plan('Yesterday I watched a movie with Priya');
  assert.equal(yday.kind, 'diary');
  if (yday.kind === 'diary') assert.equal(new Date(yday.day).getDate(), 27);
});

test('finishing something is recognized, so the to-do can be ticked', () => {
  for (const text of ['I called Amma', 'Paid the electricity bill', 'done with the passport form', 'the report is done', 'just booked the tickets']) {
    assert.equal(plan(text).kind, 'done', text);
  }
  assert.ok(overlap('I called Amma', 'Call Amma') >= 1);
  assert.ok(overlap('Paid the electricity bill', 'Pay the electricity bill') >= 1);
  assert.ok(overlap('I called the bank', 'Call Amma') <= 0.5);
});

test('questions are recognized, with what they are about and when', () => {
  const sunday = plan('What did I do on Sunday?');
  assert.equal(sunday.kind, 'question');
  if (sunday.kind === 'question') {
    assert.equal(sunday.question.kind, 'diary');
    assert.equal(new Date(sunday.question.from!).getDate(), 27);
  }
  const list = plan("what's on my shopping list");
  if (list.kind === 'question') assert.equal(list.question.kind, 'list');
  else assert.fail('list question');
  const today = plan('What do I have today?');
  if (today.kind === 'question') {
    assert.equal(today.question.kind, 'todos');
    assert.equal(new Date(today.question.from!).getDate(), 28);
  } else assert.fail('todos question');
  const count = plan('How many times did I go to the gym this month?');
  if (count.kind === 'question') {
    assert.equal(count.question.kind, 'count');
    assert.ok(count.question.keywords.includes('gym'));
  } else assert.fail('count question');
  const fact = plan("When is Priya's wedding?");
  if (fact.kind === 'question') {
    assert.equal(fact.question.kind, 'fact');
    assert.ok(fact.question.keywords.includes('priya'));
    assert.ok(fact.question.keywords.includes(stem('wedding')));
  } else assert.fail('fact question');
  assert.equal(plan('wifi password?').kind, 'question');
});

test('dates for birthdays and events become reminders, other things are notes', () => {
  const birthday = plan("Ravi's birthday is May 3");
  assert.equal(birthday.kind, 'event');
  if (birthday.kind === 'event') {
    assert.equal(birthday.title, "Ravi's birthday");
    assert.deepEqual(at(birthday.dueAt).slice(0, 3), [5, 3, 9]);
  }
  const wedding = plan("Priya's wedding is on Nov 21 in Tirupati");
  assert.equal(wedding.kind, 'event');
  assert.equal(plan('The wifi password at the cabin is sunrise42').kind, 'note');
  assert.equal(plan('Idea: an app that reminds me to water plants').kind, 'note');
  assert.equal(plan('undo').kind, 'undo');
});

test('it learns from your corrections', () => {
  // Out of the box, a plain sentence is a note.
  assert.equal(plan('standup went long again').kind, 'diary');
  assert.equal(plan('Kafka partitions and consumer groups').kind, 'note');
  // You say sentences like this are your diary, a few times.
  let learned = emptyLearned();
  learned = learn(learned, 'office standup long meeting', 'diary');
  learned = learn(learned, 'office standup boring', 'diary');
  learned = learn(learned, 'standup meeting at office', 'diary');
  learned = learn(learned, 'Kafka partitions notes', 'note');
  const now = understand('office standup was chaotic', NOW, learned);
  assert.equal(now.plan.kind, 'diary');
  const guess = understand('office standup', NOW, learned);
  assert.equal(guess.plan.kind, 'diary');
  assert.equal(guess.by, 'learned');
  // The rules still win when they are sure.
  assert.equal(understand('Remind me to call Amma at 7pm', NOW, learned).plan.kind, 'todo');
});

test('word forms and item splitting', () => {
  assert.equal(stem('called'), stem('call'));
  assert.equal(stem('calling'), stem('calls'));
  assert.equal(stem('completed'), stem('complete'));
  assert.equal(stem('bought'), stem('buy'));
  assert.equal(stem('stopped'), stem('stop'));
  assert.deepEqual(splitItems('milk, eggs and a loaf of bread.'), ['milk', 'eggs', 'loaf of bread']);
});
