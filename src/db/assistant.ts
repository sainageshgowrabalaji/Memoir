// The assistant acting on what you said: saving the to-do, ticking the list, writing the diary,
// answering from your own words. Every action is logged, so "undo" and "that was my diary" can put
// it right, and every correction teaches it.

import {
  asHabit,
  asKind,
  contentWords,
  DEFAULT_TIMES,
  emptyLearned,
  learn,
  learnList,
  learnTime,
  overlap,
  understand,
  vagueTimeWord,
  type Correctable,
  type HabitPlan,
  type Learned,
  type Plan,
  type QuestionPlan,
} from '../brain/agent';
import * as chrono from 'chrono-node';

import { applyVagueTime, clockSense, normalize } from '../brain/agent';
import { embed, similarity } from '../brain/meaning';
import { diaryFor, getItem, saveCapture, setTodoDone, writeDiary, type Item, type Todo } from './repo';
import type { Db } from './schema';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ------------------------------------------------------------ what it has learned

export async function loadLearned(db: Db): Promise<Learned> {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM meta WHERE key = 'learned'");
  if (!row) return emptyLearned();
  try {
    const saved = JSON.parse(row.value) as Partial<Learned>;
    const base = emptyLearned();
    return { ...base, ...saved, times: { ...base.times, ...(saved.times ?? {}) } };
  } catch {
    return emptyLearned();
  }
}

export async function saveLearned(db: Db, learned: Learned) {
  await db.runAsync("INSERT OR REPLACE INTO meta (key, value) VALUES ('learned', ?)", [JSON.stringify(learned)]);
}

export async function forgetLearned(db: Db) {
  await db.runAsync("DELETE FROM meta WHERE key = 'learned'");
}

// ------------------------------------------------------------ lists

export type ListItem = { id: number; list: string; text: string; doneAt: number | null; createdAt: number };
type ListRow = { id: number; list: string; text: string; done_at: number | null; created_at: number };
const toListItem = (r: ListRow): ListItem => ({ id: r.id, list: r.list, text: r.text, doneAt: r.done_at, createdAt: r.created_at });

/** Lists you started but have not put anything on yet, like "movies to watch". */
async function emptyLists(db: Db): Promise<string[]> {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM meta WHERE key = 'empty_lists'");
  try {
    return row ? (JSON.parse(row.value) as string[]) : [];
  } catch {
    return [];
  }
}

async function setEmptyLists(db: Db, names: string[]) {
  await db.runAsync("INSERT OR REPLACE INTO meta (key, value) VALUES ('empty_lists', ?)", [JSON.stringify([...new Set(names)])]);
}

/** Deletes a whole list and everything on it. */
export async function deleteList(db: Db, name: string) {
  await db.runAsync('DELETE FROM list_items WHERE list = ?', [name]);
  await setEmptyLists(db, (await emptyLists(db)).filter((n) => n !== name));
}

/** Starts a list with nothing on it yet. */
export async function startList(db: Db, name: string) {
  const clean = name.trim().toLowerCase().replace(/\s*list$/, '');
  if (!clean) return;
  const has = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM list_items WHERE list = ?', [clean]);
  if (!Number(has?.n)) await setEmptyLists(db, [...(await emptyLists(db)), clean]);
}

export async function listNames(db: Db): Promise<{ list: string; open: number }[]> {
  const rows = await db.getAllAsync<{ list: string; open: number }>(
    'SELECT list, SUM(CASE WHEN done_at IS NULL THEN 1 ELSE 0 END) AS open FROM list_items GROUP BY list ORDER BY MAX(created_at) DESC',
  );
  const names = rows.map((r) => ({ list: r.list, open: Number(r.open) }));
  for (const name of await emptyLists(db)) if (!names.some((n) => n.list === name)) names.push({ list: name, open: 0 });
  return names;
}

export async function listItemsOf(db: Db, list: string, includeDone = true): Promise<ListItem[]> {
  const rows = await db.getAllAsync<ListRow>(
    `SELECT * FROM list_items WHERE list = ? ${includeDone ? '' : 'AND done_at IS NULL'} ORDER BY done_at IS NOT NULL, created_at`,
    [list],
  );
  return rows.map(toListItem);
}

export async function addToList(db: Db, list: string, items: string[], now = new Date()): Promise<number[]> {
  const ids: number[] = [];
  const empty = await emptyLists(db);
  if (items.length && empty.includes(list)) await setEmptyLists(db, empty.filter((n) => n !== list));
  const open = await listItemsOf(db, list, false);
  for (const text of items) {
    if (open.some((o) => o.text.toLowerCase() === text.toLowerCase())) continue;
    const { lastInsertRowId } = await db.runAsync('INSERT INTO list_items (list, text, created_at) VALUES (?, ?, ?)', [list, text, now.getTime()]);
    ids.push(lastInsertRowId);
  }
  return ids;
}

export async function setListItemDone(db: Db, id: number, done: boolean, now = new Date()) {
  await db.runAsync('UPDATE list_items SET done_at = ? WHERE id = ?', [done ? now.getTime() : null, id]);
}

export async function clearDone(db: Db, list: string) {
  await db.runAsync('DELETE FROM list_items WHERE list = ? AND done_at IS NOT NULL', [list]);
}

// ------------------------------------------------------------ habits

export type Habit = { id: number; name: string; days: number[]; hour: number | null; minute: number; createdAt: number };
type HabitRow = { id: number; name: string; days: string; hour: number | null; minute: number; created_at: number };
const toHabit = (r: HabitRow): Habit => ({ id: r.id, name: r.name, days: JSON.parse(r.days) as number[], hour: r.hour, minute: r.minute, createdAt: r.created_at });

export async function listHabits(db: Db): Promise<Habit[]> {
  const rows = await db.getAllAsync<HabitRow>('SELECT * FROM habits WHERE archived = 0 ORDER BY hour IS NULL, hour, minute, id');
  return rows.map(toHabit);
}

export async function addHabit(db: Db, habit: HabitPlan, now = new Date()): Promise<number> {
  const { lastInsertRowId } = await db.runAsync('INSERT INTO habits (name, days, hour, minute, created_at) VALUES (?, ?, ?, ?, ?)', [
    habit.name, JSON.stringify(habit.days), habit.hour, habit.minute, now.getTime(),
  ]);
  return lastInsertRowId;
}

export async function archiveHabit(db: Db, id: number) {
  await db.runAsync('UPDATE habits SET archived = 1 WHERE id = ?', [id]);
}

export async function setHabitDone(db: Db, id: number, done: boolean, day = new Date()) {
  const key = startOfDay(day.getTime());
  if (done) await db.runAsync('INSERT OR IGNORE INTO habit_logs (habit_id, day) VALUES (?, ?)', [id, key]);
  else await db.runAsync('DELETE FROM habit_logs WHERE habit_id = ? AND day = ?', [id, key]);
}

/** `week` is the last seven days, oldest first, ending today: whether you ticked it each day. */
export type HabitToday = Habit & { doneToday: boolean; streak: number; dueToday: boolean; week: boolean[] };

/** The same day at midnight, a number of days back. Safe across daylight saving changes. */
function daysBack(today: number, n: number) {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return d.getTime();
}

/** Your habits with today's tick and the run of days in a row you have kept it. */
export async function habitsToday(db: Db, now = new Date()): Promise<HabitToday[]> {
  const habits = await listHabits(db);
  const today = startOfDay(now.getTime());
  const out: HabitToday[] = [];
  for (const h of habits) {
    const logs = new Set((await db.getAllAsync<{ day: number }>('SELECT day FROM habit_logs WHERE habit_id = ?', [h.id])).map((r) => r.day));
    // Days the habit is not planned for (a weekday habit on Sunday) do not break the streak.
    let streak = 0;
    for (let n = logs.has(today) ? 0 : 1; n < 400; n++) {
      const day = daysBack(today, n);
      if (logs.has(day)) streak++;
      else if (h.days.includes(new Date(day).getDay())) break;
    }
    const week = [6, 5, 4, 3, 2, 1, 0].map((n) => logs.has(daysBack(today, n)));
    out.push({ ...h, doneToday: logs.has(today), streak, dueToday: h.days.includes(now.getDay()), week });
  }
  return out;
}

// ------------------------------------------------------------ to-dos, in the assistant's words

type TodoRow = { id: number; item_id: number | null; title: string; due_at: number | null; done_at: number | null; created_at: number };
const toTodo = (r: TodoRow): Todo => ({ id: r.id, itemId: r.item_id, title: r.title, dueAt: r.due_at, doneAt: r.done_at, createdAt: r.created_at });

async function openTodos(db: Db): Promise<Todo[]> {
  return (await db.getAllAsync<TodoRow>('SELECT * FROM todos WHERE done_at IS NULL ORDER BY due_at IS NULL, due_at')).map(toTodo);
}

export async function setTodoDueAt(db: Db, id: number, dueAt: number | null) {
  await db.runAsync('UPDATE todos SET due_at = ? WHERE id = ?', [dueAt, id]);
}

/**
 * Moves a to-do's time. When it was set with a word like "evening" and you move it, Memoir
 * learns that this is what you mean by "evening".
 */
export async function moveTodo(db: Db, id: number, dueAt: number) {
  const row = await db.getFirstAsync<{ text: string }>('SELECT items.text FROM todos JOIN items ON items.id = todos.item_id WHERE todos.id = ?', [id]);
  await setTodoDueAt(db, id, dueAt);
  const word = row ? vagueTimeWord(row.text) : null;
  if (word) {
    const d = new Date(dueAt);
    await saveLearned(db, learnTime(await loadLearned(db), word, d.getHours(), d.getMinutes()));
  }
}

// ------------------------------------------------------------ acting

type Undo =
  | { t: 'item'; id: number }
  | { t: 'todo'; id: number }
  | { t: 'list'; ids: number[] }
  | { t: 'habit'; id: number }
  | { t: 'diary'; id: number; text: string | null }
  | { t: 'reopen'; id: number }
  | { t: 'untick'; id: number }
  | { t: 'due'; id: number; dueAt: number | null }
  | { t: 'restoreTodo'; row: TodoRow & { repeat: string | null } }
  | { t: 'restoreList'; rows: ListRow[] }
  | { t: 'unarchive'; id: number }
  | { t: 'unhabit'; id: number; day: number }
  | { t: 'dropList'; name: string };

export type Reply = {
  logId: number;
  /** What Memoir says back, in one or two plain sentences. */
  text: string;
  kind: Plan['kind'];
  /** Things the answer came from, to open. */
  sources: Item[];
  /** Whether "that was a to-do / diary / note / list" makes sense for this one. */
  correctable: boolean;
};

function when(ms: number, now: Date): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((startOfDay(ms) - startOfDay(now.getTime())) / DAY);
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  if (days > 1 && days < 7) return `${d.toLocaleDateString('en-US', { weekday: 'long' })} at ${time}`;
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${time}`;
}

const REPEAT_WORDS = { weekly: 'every week', monthly: 'every month', yearly: 'every year' } as const;

function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

// Everyday verbs a to-do starts with. Only these get a small first letter mid-sentence, so names
// like "Priya's wedding" or "Kafka notes" keep their capital.
const VERBS = new Set(
  ('call book pay renew finish submit email text message schedule cancel return pick drop order fix clean visit apply register ' +
    'sign send reply check prepare study learn practice practise watch read write update file meet try get buy go take make do drink eat ' +
    'walk run water feed wash cook plan bring ask tell remember start stop change move sell print sort pack unpack charge post collect ' +
    'review draft fill open close backup back put leave see meditate exercise stretch pray floss sleep wake jog swim cycle revise ' +
    'grab iron fold vacuum mop sweep dust confirm follow complete attend join transfer withdraw deposit refill recharge top ' +
    'journal wish thank congratulate invite greet celebrate')
    .split(' '),
);

function lower(title: string) {
  const first = title.split(/\s+/)[0].toLowerCase();
  return VERBS.has(first) || /^(?:my|the|a|an|our|your)$/.test(first) ? title.charAt(0).toLowerCase() + title.slice(1) : title;
}

/** Your words said back to you: "renew my passport" becomes "renew your passport". */
function yours(text: string): string {
  return text
    .replace(/\bmy\b/g, 'your')
    .replace(/\bMy\b/g, 'Your')
    .replace(/\bmine\b/g, 'yours')
    .replace(/\bmyself\b/g, 'yourself')
    .replace(/\bI am\b|\bI'm\b/g, 'you are')
    .replace(/\bI\b/g, 'you');
}

/** "to call Amma" for something to do, "about the meeting" for anything else. */
function aboutOrTo(title: string): string {
  const first = title.split(/\s+/)[0].toLowerCase();
  if (VERBS.has(first)) return `to ${yours(lower(title))}`;
  const plain = /^(?:the|a|an|my|our|your)$/.test(first) ? title.charAt(0).toLowerCase() + title.slice(1) : title;
  return `about ${yours(plain)}`;
}

function daysLabel(days: number[]): string {
  if (days.length === 7) return 'every day';
  if (days.join() === '1,2,3,4,5') return 'on weekdays';
  if (days.join() === '0,6') return 'on weekends';
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return `every ${joinWords(days.map((d) => names[d]))}`;
}

/** Ticks the open to-do that what you said finishes, if there is a clear one. */
// Verbs that say little on their own: "went to the gym" and "hit the gym" are the same gym.
const GENERIC = new Set(['go', 'do', 'get', 'have', 'make', 'hit', 'finish', 'complete', 'done', 'today', 'morning', 'evening', 'night', 'tonight'].map((w) => contentWords(w)[0] ?? w));

/**
 * How well what you said matches a to-do or habit title, from 0 to 1. Either most of the title was
 * said, or at least two of your words are in it and most of what you said is.
 */
function matchScore(said: string, title: string, loose = false): number {
  const mine = [...new Set(contentWords(said))].filter((w) => !GENERIC.has(w));
  const theirs = [...new Set(contentWords(title))].filter((w) => !GENERIC.has(w));
  if (!mine.length || !theirs.length) return 0;
  const hits = theirs.filter((w) => mine.includes(w)).length;
  const coverTitle = hits / theirs.length;
  const coverSaid = mine.filter((w) => theirs.includes(w)).length / mine.length;
  if (coverTitle >= 0.75) return coverTitle;
  if (hits >= 2 && coverSaid >= 0.6) return 0.75;
  if (loose && hits >= 1 && (coverTitle >= 0.5 || coverSaid >= 0.6)) return 0.6;
  return 0;
}

/** Ticks today's habit that what you said is about ("meditated", "gym done"). */
async function tickHabit(db: Db, text: string, now: Date, loose = false): Promise<{ habit: HabitToday | null; undo: Undo[] }> {
  const open = (await habitsToday(db, now)).filter((h) => !h.doneToday);
  const best = open.map((h) => ({ h, s: matchScore(text, h.name, loose) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)[0];
  if (!best) return { habit: null, undo: [] };
  await setHabitDone(db, best.h.id, true, now);
  return { habit: best.h, undo: [{ t: 'unhabit', id: best.h.id, day: startOfDay(now.getTime()) }] };
}

async function tickMatching(db: Db, text: string, now: Date, threshold = 0.75): Promise<{ todo: Todo | null; undo: Undo[] }> {
  const candidates = (await openTodos(db))
    .map((t) => ({ t, score: matchScore(text, t.title, threshold < 0.75) }))
    .filter((c) => c.score >= threshold)
    .sort((a, b) => b.score - a.score);
  if (!candidates.length) return { todo: null, undo: [] };
  const todo = candidates[0].t;
  const next = await setTodoDone(db, todo.id, true, now);
  const undo: Undo[] = [{ t: 'reopen', id: todo.id }];
  if (next) undo.push({ t: 'todo', id: next });
  return { todo, undo };
}

async function tickListItem(db: Db, text: string, now: Date): Promise<{ item: ListItem | null; undo: Undo[] }> {
  const open = await db.getAllAsync<ListRow>('SELECT * FROM list_items WHERE done_at IS NULL');
  const said = new Set(contentWords(text));
  const hit = open.find((row) => contentWords(row.text).every((w) => said.has(w)));
  if (!hit) return { item: null, undo: [] };
  await setListItemDone(db, hit.id, true, now);
  return { item: toListItem(hit), undo: [{ t: 'untick', id: hit.id }] };
}

async function writeToDiary(db: Db, text: string, day: number, now: Date): Promise<{ undo: Undo[]; todo: Todo | null }> {
  const at = new Date(day + (now.getTime() - startOfDay(now.getTime())));
  const before = await diaryFor(db, at);
  const { item, todo } = await writeDiary(db, text, at);
  const undo: Undo[] = [{ t: 'diary', id: item.id, text: before ? before.text : null }];
  if (todo) undo.push({ t: 'todo', id: todo.id });
  return { undo, todo };
}

type Outcome = { text: string; undo: Undo[]; sources: Item[]; learned: Learned; kind?: Plan['kind'] };

/** Does what the plan says. `kind` in the result is what was actually done, after any fallback. */
async function carryOut(db: Db, plan: Plan, input: string, now: Date, learned: Learned): Promise<Outcome & { kind: Plan['kind'] }> {
  const outcome = await act(db, plan, input, now, learned);
  return { ...outcome, kind: outcome.kind ?? plan.kind };
}

async function act(db: Db, plan: Plan, input: string, now: Date, learned: Learned): Promise<Outcome> {
  switch (plan.kind) {
    case 'todo': {
      const saved = await saveCapture(db, { text: input }, now, true);
      const todoId = saved.todo!.id;
      await db.runAsync('UPDATE todos SET title = ?, due_at = ?, repeat = ? WHERE id = ?', [plan.title, plan.dueAt, plan.repeat ?? null, todoId]);
      await db.runAsync('UPDATE items SET hidden = 1 WHERE id = ?', [saved.item.id]);
      const again = plan.repeat ? ` It repeats ${REPEAT_WORDS[plan.repeat]}.` : '';
      const text = plan.dueAt ? `Got it. I'll remind you ${when(plan.dueAt, now)} ${aboutOrTo(plan.title)}.${again}` : `Added "${plan.title}" to your to-dos. I'll remind you tomorrow morning.`;
      return { text, undo: [{ t: 'todo', id: todoId }, { t: 'item', id: saved.item.id }], sources: [], learned };
    }
    case 'event': {
      const saved = await saveCapture(db, { text: input }, now, true);
      await db.runAsync('UPDATE todos SET title = ?, due_at = ?, repeat = ? WHERE id = ?', [plan.title, plan.dueAt, plan.repeat ?? null, saved.todo!.id]);
      await db.runAsync('UPDATE items SET hidden = 1 WHERE id = ?', [saved.item.id]);
      const again = plan.repeat ? ` Every ${plan.repeat === 'yearly' ? 'year' : plan.repeat === 'monthly' ? 'month' : 'week'} after that too.` : '';
      return {
        text: VERBS.has(plan.title.split(/\s+/)[0].toLowerCase())
          ? `Got it. I'll remind you ${when(plan.dueAt, now)} to ${yours(lower(plan.title))}.${again}`
          : `Got it. ${capitalizeFirst(yours(plan.title))}, ${when(plan.dueAt, now)}. I'll remind you then.${again}`,
        undo: [{ t: 'todo', id: saved.todo!.id }, { t: 'item', id: saved.item.id }],
        sources: [],
        learned,
      };
    }
    case 'list': {
      if (!plan.items.length) {
        const existed = (await listNames(db)).some((l) => l.list === plan.list);
        if (!existed) await startList(db, plan.list);
        return {
          text: existed ? `You already have a ${plan.list} list.` : `Started your ${plan.list} list. Say “add … to ${plan.list}” to fill it.`,
          undo: existed ? [] : [{ t: 'dropList', name: plan.list }],
          sources: [],
          learned,
        };
      }
      const ids = await addToList(db, plan.list, plan.items, now);
      const already = plan.items.length - ids.length;
      const text = ids.length
        ? `Added ${joinWords(plan.items.slice(0, 5))} to your ${plan.list} list.${already ? ' Some were already on it.' : ''}`
        : `${capitalizeFirst(joinWords(plan.items))} ${plan.items.length === 1 ? 'is' : 'are'} already on your ${plan.list} list.`;
      return { text, undo: [{ t: 'list', ids }], sources: [], learned: learnList(learned, plan.items, plan.list) };
    }
    case 'habit': {
      const id = await addHabit(db, plan.habit, now);
      const time = plan.habit.hour !== null ? ` at ${new Date(2000, 0, 1, plan.habit.hour, plan.habit.minute).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : '';
      const text = `New habit. ${yours(plan.habit.name)}, ${daysLabel(plan.habit.days)}${time}.${time ? " I'll remind you, and you can tick it on Today." : ' Tick it on Today when you do it.'}`;
      return { text, undo: [{ t: 'habit', id }], sources: [], learned };
    }
    case 'diary': {
      const yesterday = plan.day < startOfDay(now.getTime());
      // Only today's diary ticks today's to-dos and habits.
      const ticked = yesterday ? { todo: null, undo: [] as Undo[] } : await tickMatching(db, input, now);
      const listTick = ticked.todo || yesterday ? { item: null, undo: [] as Undo[] } : await tickListItem(db, input, now);
      const habitTick = yesterday ? { habit: null, undo: [] as Undo[] } : await tickHabit(db, input, now);
      const diary = await writeToDiary(db, input, plan.day, now);
      let text = yesterday ? "Added to yesterday's diary." : "Added to today's diary.";
      if (ticked.todo) text += ` And ticked off "${ticked.todo.title}".`;
      if (listTick.item) text += ` And ticked ${listTick.item.text} off your ${listTick.item.list} list.`;
      if (habitTick.habit) text += ` And ticked your habit, ${yours(lower(habitTick.habit.name))}.`;
      if (diary.todo) text += ` Also added a to-do, ${yours(lower(diary.todo.title))}.`;
      return { text, undo: [...ticked.undo, ...listTick.undo, ...habitTick.undo, ...diary.undo], sources: [], learned };
    }
    case 'done': {
      if (plan.target) {
        // "Mark call dad as done": tick exactly that, and note it in the diary in plain words.
        const ticked = await tickMatching(db, plan.target, now, 0.6);
        const listTick = ticked.todo ? { item: null, undo: [] as Undo[] } : await tickListItem(db, plan.target, now);
        const habitTick = ticked.todo || listTick.item ? { habit: null, undo: [] as Undo[] } : await tickHabit(db, plan.target, now, true);
        if (habitTick.habit) return { text: `Ticked your habit, ${yours(lower(habitTick.habit.name))}, for today.`, undo: habitTick.undo, sources: [], learned };
        if (!ticked.todo && !listTick.item) {
          if (plan.fallback) return carryOut(db, plan.fallback, input, now, learned);
          return { text: `I couldn't find an open to-do like "${plan.target}".`, undo: [], sources: [], learned };
        }
        if (listTick.item) return { text: `Ticked ${listTick.item.text} off your ${listTick.item.list} list.`, undo: listTick.undo, sources: [], learned };
        const diary = await writeToDiary(db, `Done, ${lower(ticked.todo!.title)}.`, startOfDay(now.getTime()), now);
        return { text: `Ticked off "${ticked.todo!.title}".`, undo: [...ticked.undo, ...diary.undo], sources: [], learned };
      }
      const ticked = await tickMatching(db, input, now);
      const listTick = ticked.todo ? { item: null, undo: [] as Undo[] } : await tickListItem(db, input, now);
      const habitTick = ticked.todo || listTick.item ? { habit: null, undo: [] as Undo[] } : await tickHabit(db, input, now, true);
      const diary = await writeToDiary(db, input, startOfDay(now.getTime()), now);
      const text = ticked.todo
        ? `Nice. Ticked off "${ticked.todo.title}" and noted it in today's diary.`
        : listTick.item
          ? `Ticked ${listTick.item.text} off your ${listTick.item.list} list.`
          : habitTick.habit
            ? `Nice. Ticked your habit, ${yours(lower(habitTick.habit.name))}, and noted it in today's diary.`
            : "Added to today's diary.";
      return { text, undo: [...ticked.undo, ...listTick.undo, ...habitTick.undo, ...diary.undo], sources: [], learned };
    }
    case 'note': {
      const saved = await saveCapture(db, { text: plan.text }, now);
      const todo = saved.todo ? ` There was a to-do in it too, ${lower(saved.todo.title)}.` : '';
      const undo: Undo[] = [{ t: 'item', id: saved.item.id }];
      if (saved.todo) undo.unshift({ t: 'todo', id: saved.todo.id });
      return { text: `Saved to your notes. Ask me about it anytime.${todo}`, undo, sources: [], learned };
    }
    case 'question': {
      const answer = await answerQuestion(db, plan.question, now);
      return { text: answer.text, undo: [], sources: answer.sources, learned };
    }
    case 'undo':
      return { text: await undoLast(db), undo: [], sources: [], learned };
    case 'chat':
      return { text: plan.reply, undo: [], sources: [], learned };
    case 'unlist':
      return unlist(db, plan.list, plan.items, Boolean(plan.all), learned, Boolean(plan.drop));
    case 'cancel': {
      const found = await findTarget(db, plan.target, plan.habit);
      if (!found) {
        if (plan.fallback.kind !== 'note') return carryOut(db, plan.fallback, input, now, learned);
        return { text: `I couldn't find a reminder, habit or list item like "${plan.target}".`, undo: [], sources: [], learned };
      }
      if (found.t === 'habit') {
        await archiveHabit(db, found.id);
        return { text: `Stopped the habit "${found.name}". Its reminders are off.`, undo: [{ t: 'unarchive', id: found.id }], sources: [], learned };
      }
      if (found.t === 'list') {
        await db.runAsync('DELETE FROM list_items WHERE id = ?', [found.row.id]);
        return { text: `Took ${found.row.text} off your ${found.row.list} list.`, undo: [{ t: 'restoreList', rows: [found.row] }], sources: [], learned };
      }
      await db.runAsync('DELETE FROM todos WHERE id = ?', [found.row.id]);
      return { text: `Deleted "${found.row.title}". No more reminders for it.`, undo: [{ t: 'restoreTodo', row: found.row }], sources: [], learned };
    }
    case 'move': {
      const found = await findTarget(db, plan.target, false, true);
      if (!found || found.t !== 'todo') return carryOut(db, plan.fallback, input, now, learned);
      const dueAt = resolveWhen(plan.when, found.row.due_at, now, learned);
      if (dueAt === null) return carryOut(db, plan.fallback, input, now, learned);
      await moveTodo(db, found.row.id, dueAt);
      return {
        text: `Moved "${found.row.title}" to ${when(dueAt, now)}.`,
        undo: [{ t: 'due', id: found.row.id, dueAt: found.row.due_at }],
        sources: [],
        learned: await loadLearned(db),
      };
    }
  }
}

/** A new time for a to-do from "Friday", "6pm" or "tomorrow evening", keeping the part you did not say. */
function resolveWhen(raw: string, base: number | null, now: Date, learned: Learned): number | null {
  const text = normalize(raw, now);
  const r = chrono.parse(text, now, { forwardDate: true })[0];
  const word = vagueTimeWord(text);
  if (!r && !word) return null;
  let date = new Date(base ?? now.getTime());
  if (r) {
    const said = r.start.date();
    const dayCertain = r.start.isCertain('day') || r.start.isCertain('weekday') || /\b(?:today|tonight|tomorrow)\b/i.test(r.text);
    if (dayCertain) date = new Date(said.getFullYear(), said.getMonth(), said.getDate(), date.getHours(), date.getMinutes());
    if (r.start.isCertain('hour')) date.setHours(said.getHours(), said.getMinutes(), 0, 0);
    else if (base === null && !word) date.setHours(...(learned.times.morning ?? [9, 0]), 0, 0);
    if (!dayCertain && date.getTime() <= now.getTime()) {
      date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), date.getHours(), date.getMinutes());
      if (date.getTime() <= now.getTime()) date.setDate(date.getDate() + 1);
    }
  }
  const at = clockSense(applyVagueTime(date.getTime(), text, now, learned), text, now);
  return at;
}

type Found =
  | { t: 'todo'; row: TodoRow & { repeat: string | null } }
  | { t: 'habit'; id: number; name: string }
  | { t: 'list'; row: ListRow };

const FILLER = new Set(['reminder', 'remind', 'todo', 'to-do', 'task', 'alarm', 'habit', 'event', 'one', 'thing', 'item', 'entry', 'note', 'appointment'].map((w) => contentWords(w)[0] ?? w));

/** The open to-do, habit or list item you meant by a few words, like "the dentist reminder". */
async function findTarget(db: Db, target: string, habitFirst: boolean, todosOnly = false): Promise<Found | null> {
  const words = contentWords(target).filter((w) => !FILLER.has(w));
  if (!words.length) return null;
  const said = words.join(' ');
  const score = (title: string) => overlap(title, said);
  const todos = await db.getAllAsync<TodoRow & { repeat: string | null }>('SELECT * FROM todos WHERE done_at IS NULL ORDER BY due_at IS NULL, due_at');
  const todo = todos.map((row) => ({ row, s: score(row.title) })).filter((x) => x.s >= 0.6).sort((a, b) => b.s - a.s)[0];
  const habits = todosOnly ? [] : await listHabits(db);
  const habit = habits.map((h) => ({ h, s: score(h.name) })).filter((x) => x.s >= 0.6).sort((a, b) => b.s - a.s)[0];
  if (habit && (habitFirst || !todo || habit.s > todo.s)) return { t: 'habit', id: habit.h.id, name: habit.h.name };
  if (todo) return { t: 'todo', row: todo.row };
  if (todosOnly) return null;
  const items = await db.getAllAsync<ListRow>('SELECT * FROM list_items WHERE done_at IS NULL');
  const item = items.find((row) => contentWords(row.text).every((w) => words.includes(w)));
  return item ? { t: 'list', row: item } : null;
}

async function unlist(db: Db, list: string | null, items: string[], all: boolean, learned: Learned, drop = false) {
  const rows = await db.getAllAsync<ListRow>(`SELECT * FROM list_items WHERE done_at IS NULL ${list ? 'AND list = ?' : ''}`, list ? [list] : []);
  if (all) {
    const every = await db.getAllAsync<ListRow>('SELECT * FROM list_items WHERE list = ?', [list]);
    const wasEmpty = (await emptyLists(db)).includes(list!);
    if (!every.length && !(drop && wasEmpty)) return { text: `Your ${list} list is already empty.`, undo: [] as Undo[], sources: [] as Item[], learned };
    await db.runAsync('DELETE FROM list_items WHERE list = ?', [list]);
    // Deleting a list takes it away. Clearing keeps it, empty, ready for next time.
    if (drop) await setEmptyLists(db, (await emptyLists(db)).filter((n) => n !== list));
    else await startList(db, list!);
    const undo: Undo[] = [{ t: 'restoreList', rows: every }];
    if (!drop) undo.push({ t: 'dropList', name: list! });
    return { text: drop ? `Deleted your ${list} list.` : `Cleared your ${list} list.`, undo, sources: [] as Item[], learned };
  }
  const gone: ListRow[] = [];
  for (const wanted of items) {
    const w = contentWords(wanted);
    const hit = rows.find((row) => !gone.includes(row) && w.length > 0 && w.every((x) => contentWords(row.text).includes(x)));
    if (hit) gone.push(hit);
  }
  if (!gone.length) return { text: `${capitalizeFirst(joinWords(items))} ${items.length === 1 ? "isn't" : "aren't"} on your ${list ?? 'lists'}${list ? ' list' : ''}.`, undo: [] as Undo[], sources: [] as Item[], learned };
  for (const row of gone) await db.runAsync('DELETE FROM list_items WHERE id = ?', [row.id]);
  return { text: `Took ${joinWords(gone.map((r) => r.text))} off your ${gone[0].list} list.`, undo: [{ t: 'restoreList', rows: gone } as Undo], sources: [] as Item[], learned };
}

function capitalizeFirst(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const CORRECTABLE_KINDS = new Set(['todo', 'diary', 'note', 'list']);

/** Tell Memoir anything. It works out what you meant, does it, and says what it did. */
export async function tell(db: Db, input: string, now = new Date()): Promise<Reply> {
  const text = input.trim();
  const learned = await loadLearned(db);
  const lists = (await listNames(db)).map((l) => l.list);
  const { plan } = understand(text, now, learned, lists);
  const done = await carryOut(db, plan, text, now, learned);
  // It learns from what you correct and from the boxes you choose, not from its own guesses, so a
  // wrong guess never teaches it more wrong guesses.
  await saveLearned(db, done.learned);
  const { lastInsertRowId } = await db.runAsync('INSERT INTO agent_log (input, kind, reply, undo, created_at) VALUES (?, ?, ?, ?, ?)', [
    text, done.kind, done.text, JSON.stringify(done.undo), now.getTime(),
  ]);
  return { logId: lastInsertRowId, text: done.text, kind: done.kind, sources: done.sources, correctable: CORRECTABLE_KINDS.has(done.kind) };
}

async function reverse(db: Db, steps: Undo[]) {
  for (const step of [...steps].reverse()) {
    if (step.t === 'item') await db.runAsync('DELETE FROM items WHERE id = ?', [step.id]);
    if (step.t === 'item') await db.runAsync('DELETE FROM item_vectors WHERE item_id = ?', [step.id]);
    if (step.t === 'todo') await db.runAsync('DELETE FROM todos WHERE id = ?', [step.id]);
    if (step.t === 'list' && step.ids.length) await db.runAsync(`DELETE FROM list_items WHERE id IN (${step.ids.map(() => '?').join(',')})`, step.ids);
    if (step.t === 'habit') await db.runAsync('DELETE FROM habits WHERE id = ?', [step.id]);
    if (step.t === 'reopen') await db.runAsync('UPDATE todos SET done_at = NULL WHERE id = ?', [step.id]);
    if (step.t === 'untick') await db.runAsync('UPDATE list_items SET done_at = NULL WHERE id = ?', [step.id]);
    if (step.t === 'due') await db.runAsync('UPDATE todos SET due_at = ? WHERE id = ?', [step.dueAt, step.id]);
    if (step.t === 'unarchive') await db.runAsync('UPDATE habits SET archived = 0 WHERE id = ?', [step.id]);
    if (step.t === 'unhabit') await db.runAsync('DELETE FROM habit_logs WHERE habit_id = ? AND day = ?', [step.id, step.day]);
    if (step.t === 'dropList') await setEmptyLists(db, (await emptyLists(db)).filter((n) => n !== step.name));
    if (step.t === 'restoreTodo') {
      const r = step.row;
      await db.runAsync('INSERT OR REPLACE INTO todos (id, item_id, title, due_at, done_at, created_at, repeat) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        r.id, r.item_id, r.title, r.due_at, r.done_at, r.created_at, r.repeat ?? null,
      ]);
    }
    if (step.t === 'restoreList') {
      for (const r of step.rows) {
        await db.runAsync('INSERT OR REPLACE INTO list_items (id, list, text, done_at, created_at) VALUES (?, ?, ?, ?, ?)', [r.id, r.list, r.text, r.done_at, r.created_at]);
      }
    }
    if (step.t === 'diary') {
      if (step.text === null) {
        await db.runAsync('DELETE FROM items WHERE id = ?', [step.id]);
        await db.runAsync('DELETE FROM item_vectors WHERE item_id = ?', [step.id]);
      } else await db.runAsync('UPDATE items SET text = ? WHERE id = ?', [step.text, step.id]);
    }
  }
}

/** Takes back the last thing Memoir did. */
export async function undoLast(db: Db): Promise<string> {
  const last = await db.getFirstAsync<{ id: number; input: string; undo: string }>(
    "SELECT id, input, undo FROM agent_log WHERE undone = 0 AND kind NOT IN ('question', 'undo', 'chat') ORDER BY id DESC LIMIT 1",
  );
  if (!last) return 'There is nothing to undo.';
  await reverse(db, JSON.parse(last.undo) as Undo[]);
  await db.runAsync('UPDATE agent_log SET undone = 1 WHERE id = ?', [last.id]);
  return `Undone. "${last.input.length > 60 ? `${last.input.slice(0, 57)}…` : last.input}" is gone.`;
}

/**
 * "That was a to-do, not a note." Puts it where you meant, and learns from it, so the next
 * sentence like this goes there by itself.
 */
export async function correct(db: Db, logId: number, kind: Correctable, now = new Date()): Promise<Reply> {
  const row = await db.getFirstAsync<{ input: string; undo: string; undone: number }>('SELECT input, undo, undone FROM agent_log WHERE id = ?', [logId]);
  if (!row) throw new Error('Nothing to correct.');
  if (!row.undone) await reverse(db, JSON.parse(row.undo) as Undo[]);
  await db.runAsync('UPDATE agent_log SET undone = 1 WHERE id = ?', [logId]);
  let learned = learn(await loadLearned(db), row.input, kind, 2);
  const plan = asKind(row.input, kind, now, learned);
  const done = await carryOut(db, plan, row.input, now, learned);
  learned = done.learned;
  await saveLearned(db, learned);
  const text = `${done.text} I'll remember that.`;
  const { lastInsertRowId } = await db.runAsync('INSERT INTO agent_log (input, kind, reply, undo, created_at) VALUES (?, ?, ?, ?, ?)', [
    row.input, done.kind, text, JSON.stringify(done.undo), now.getTime(),
  ]);
  return { logId: lastInsertRowId, text, kind: done.kind, sources: [], correctable: true };
}

/**
 * Saves what you typed as the kind you chose, from a box that already says what it is for (the
 * diary card, "Add a to-do", "New habit"). Choosing counts as teaching, like a correction.
 */
export async function tellAs(db: Db, input: string, kind: Correctable | 'habit', now = new Date()): Promise<Reply> {
  const text = input.trim();
  let learned = await loadLearned(db);
  if (kind !== 'habit') learned = learn(learned, text, kind, 1);
  const plan: Plan = kind === 'habit' ? { kind: 'habit', habit: asHabit(text, now, learned) } : asKind(text, kind, now, learned);
  const done = await carryOut(db, plan, text, now, learned);
  await saveLearned(db, done.learned);
  const { lastInsertRowId } = await db.runAsync('INSERT INTO agent_log (input, kind, reply, undo, created_at) VALUES (?, ?, ?, ?, ?)', [
    text, done.kind, done.text, JSON.stringify(done.undo), now.getTime(),
  ]);
  return { logId: lastInsertRowId, text: done.text, kind: done.kind, sources: done.sources, correctable: CORRECTABLE_KINDS.has(done.kind) };
}

/** What Memoir has learned about you, in words, for Settings. */
export async function learnedSummary(db: Db): Promise<{ lines: string[]; empty: boolean }> {
  const learned = await loadLearned(db);
  const lines: string[] = [];
  const counts = await db.getFirstAsync<{ told: number; fixed: number }>(
    "SELECT SUM(CASE WHEN kind NOT IN ('question', 'chat', 'undo') THEN 1 ELSE 0 END) AS told, SUM(CASE WHEN reply LIKE '%I''ll remember that.' THEN 1 ELSE 0 END) AS fixed FROM agent_log",
  );
  const told = Number(counts?.told ?? 0);
  const fixed = Number(counts?.fixed ?? 0);
  if (told) {
    lines.push(
      `It has read ${told} ${told === 1 ? 'thing' : 'things'} you told it.${fixed ? ` You corrected it ${fixed === 1 ? 'once' : `${fixed} times`}, so sentences like those now go where you meant.` : ''}`,
    );
  }
  const fmt = (h: number, m: number) => new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  for (const [word, [h, m]] of Object.entries(learned.times)) {
    const base = DEFAULT_TIMES[word];
    if (!base || base[0] !== h || base[1] !== m) lines.push(`"${capitalizeFirst(word)}" means ${fmt(h, m)} for you.`);
  }
  const lists = new Map<string, string[]>();
  for (const [word, list] of Object.entries(learned.lists)) lists.set(list, [...(lists.get(list) ?? []), word]);
  for (const [list, words] of lists) {
    if (list === 'shopping') continue;
    lines.push(`${capitalizeFirst(joinWords(words.slice(0, 4)))} go${words.length === 1 ? 'es' : ''} on your ${list} list.`);
  }
  return { lines, empty: lines.length === 0 };
}

// ------------------------------------------------------------ answering

type Sentence = { text: string; item: Item };

function sentencesOf(item: Item): Sentence[] {
  return [item.text, item.note]
    .join('\n')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2)
    .map((text) => ({ text, item }));
}

function dateLabel(ms: number, now: Date): string {
  const days = Math.round((startOfDay(now.getTime()) - startOfDay(ms)) / DAY);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  const d = new Date(ms);
  if (days > 1 && days < 7) return `on ${d.toLocaleDateString('en-US', { weekday: 'long' })}`;
  return `on ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

async function itemsIn(db: Db, kinds: string[], from: number | null, to: number | null): Promise<Item[]> {
  const where = [`kind IN (${kinds.map(() => '?').join(',')})`];
  const params: unknown[] = [...kinds];
  if (from !== null) {
    where.push('created_at >= ?');
    params.push(from);
  }
  if (to !== null) {
    where.push('created_at < ?');
    params.push(to);
  }
  const rows = await db.getAllAsync<{ id: number }>(`SELECT id FROM items WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 400`, params);
  const items: Item[] = [];
  for (const r of rows) {
    const item = await getItem(db, r.id);
    if (item) items.push(item);
  }
  return items;
}

function quote(text: string, max = 180) {
  // Diary lines are kept as paragraphs. Read aloud as one, each ends like a sentence.
  const clean = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (/[.!?…"]$/.test(p) ? p : `${p}.`))
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** The stretch of time a question asked about, in its own words: "last week", "on Friday". */
function rangeWords(q: QuestionPlan, now: Date): string {
  const m = q.text.toLowerCase().match(/\b(today|tonight|yesterday|tomorrow|this week|next week|last week|last weekend|this weekend|the weekend|my weekend|this month|last month|last \d+ days|my week|the week|my day)\b/);
  const say: Record<string, string> = { 'the weekend': 'this weekend', 'my weekend': 'the weekend', 'my week': 'this week', 'the week': 'this week', 'my day': 'today' };
  if (m) return say[m[1]] ?? m[1];
  if (q.from === null) return '';
  const today = startOfDay(now.getTime());
  if (q.from >= today) {
    const d = new Date(q.from);
    return q.from - today < 7 * DAY ? `on ${d.toLocaleDateString('en-US', { weekday: 'long' })}` : `on ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }
  return dateLabel(q.from, now);
}

type DoneRow = { id: number; title: string; done_at: number };

/** A to-do you ticked that matches the question, like "did I call dad?". */
async function doneMatching(db: Db, keywords: string[], from: number | null, to: number | null, now: Date): Promise<DoneRow | null> {
  if (!keywords.length) return null;
  const since = from ?? now.getTime() - 60 * DAY;
  const rows = await db.getAllAsync<DoneRow>('SELECT id, title, done_at FROM todos WHERE done_at IS NOT NULL AND done_at >= ? AND done_at < ? ORDER BY done_at DESC LIMIT 300', [
    since, to ?? Number.MAX_SAFE_INTEGER,
  ]);
  return rows.find((r) => overlap(r.title, keywords.join(' ')) >= 0.6) ?? null;
}

export async function answerQuestion(db: Db, q: QuestionPlan, now = new Date()): Promise<{ text: string; sources: Item[] }> {
  switch (q.kind) {
    case 'list': {
      const items = await listItemsOf(db, q.list ?? 'shopping', false);
      return {
        text: items.length ? `Your ${q.list} list has ${joinWords(items.map((i) => i.text))}.` : `Your ${q.list} list is empty.`,
        sources: [],
      };
    }
    case 'lists': {
      const lists = await listNames(db);
      if (!lists.length) return { text: 'You have no lists yet. Say “add milk to the shopping list” to start one.', sources: [] };
      const parts = lists.map((l) => `${l.list} (${l.open ? `${l.open} left` : 'empty'})`);
      return { text: `You have ${lists.length === 1 ? 'one list' : `${lists.length} lists`}. ${capitalizeFirst(joinWords(parts))}.`, sources: [] };
    }
    case 'todos': {
      const today = startOfDay(now.getTime());
      const from = q.from ?? null;
      const to = q.to ?? null;
      const open = await openTodos(db);
      const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const late = open.filter((t) => t.dueAt !== null && t.dueAt < today);
      const lateLine = (list: Todo[]) =>
        list.length
          ? ` ${list.length === 1 ? 'One is' : `${list.length} are`} still open from before, ${joinWords(list.slice(0, 3).map((t) => `${yours(lower(t.title))} (${dateLabel(t.dueAt!, now).replace(/^on /, '')})`))}${list.length > 3 ? ` and ${list.length - 3} more` : ''}.`
          : '';

      if (from === null) {
        if (!open.length) return { text: 'Your to-do list is clear.', sources: [] };
        const next = open.filter((t) => t.dueAt !== null && t.dueAt >= now.getTime()).slice(0, 4);
        const missed = open.filter((t) => t.dueAt !== null && t.dueAt < now.getTime());
        const anytime = open.filter((t) => t.dueAt === null);
        let text = `You have ${open.length === 1 ? 'one open to-do' : `${open.length} open to-dos`}.`;
        if (next.length) text += ` Coming up, ${joinWords(next.map((t) => `${yours(lower(t.title))} (${when(t.dueAt!, now)})`))}.`;
        text += lateLine(missed);
        if (anytime.length) text += ` For whenever, ${joinWords(anytime.slice(0, 3).map((t) => yours(lower(t.title))))}${anytime.length > 3 ? ` and ${anytime.length - 3} more` : ''}.`;
        return { text, sources: [] };
      }

      const inRange = open.filter((t) => t.dueAt !== null && t.dueAt >= from && t.dueAt < (to ?? Infinity));
      const day = new Date(from);
      const oneDay = to !== null && to - from <= DAY + HOUR;
      const habits = oneDay ? (await habitsToday(db, day)).filter((h) => h.days.includes(day.getDay()) && !(from === today && h.doneToday)) : [];
      const isToday = from === today && oneDay;
      const scope = isToday ? 'Today' : from === startOfDay(today + DAY + HOUR) && oneDay ? 'Tomorrow' : capitalizeFirst(rangeWords(q, now));
      const earlier = isToday || (from <= today && (to ?? Infinity) > today) ? late : [];
      if (!inRange.length && !habits.length && !earlier.length) return { text: `${scope} is clear. Nothing due.`, sources: [] };
      // Asked about one day, the time is enough. Otherwise say which day too.
      const at = (ms: number) => (oneDay ? clock(ms) : when(ms, now));
      const parts = inRange.slice(0, 6).map((t) => `${yours(lower(t.title))} (${at(t.dueAt!)})`);
      let text = inRange.length ? `${scope}, ${inRange.length === 1 ? 'one thing' : `${inRange.length} things`}. ${capitalizeFirst(joinWords(parts))}.` : `${scope}, nothing new is due.`;
      if (inRange.length > 6) text = text.replace(/\.$/, `, and ${inRange.length - 6} more.`);
      text += lateLine(earlier);
      if (habits.length) text += ` ${inRange.length || earlier.length ? 'And your' : 'Just your'} ${habits.length === 1 ? 'habit' : 'habits'}, ${joinWords(habits.map((h) => yours(lower(h.name))))}.`;
      return { text, sources: [] };
    }
    case 'diary': {
      const entries = await itemsIn(db, ['diary'], q.from, q.to);
      const wanted = q.keywords;
      const matching = wanted.length ? entries.filter((e) => wanted.some((w) => contentWords(e.text).includes(w))) : entries;
      const habits = wanted.length ? (await habitsToday(db, now)).filter((h) => wanted.some((w) => contentWords(h.name).includes(w))) : [];
      if (habits.length && q.from === startOfDay(now.getTime())) {
        const h = habits[0];
        return { text: h.doneToday ? `Yes, you ticked "${h.name}" today.` : `Not yet today. "${h.name}" is still open.`, sources: [] };
      }
      // "Did I call dad?" is answered best by the to-do you ticked.
      const ticked = await doneMatching(db, wanted, q.from, q.to, now);
      if (ticked) {
        const at = new Date(ticked.done_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        return { text: `Yes. You ticked off "${ticked.title}" ${dateLabel(ticked.done_at, now)} at ${at}.`, sources: [] };
      }
      if (!matching.length) {
        // Not in the diary, so maybe in a note ("where did I park?").
        if (wanted.length) {
          const fact = await answerFact(db, q, now);
          if (fact.sources.length) return fact;
        }
        const range = rangeWords(q, now);
        return { text: range ? `I have nothing in your diary for ${range.replace(/^on /, '')}.` : "I couldn't find that in your diary.", sources: [] };
      }
      const first = matching[0];
      if (wanted.length && q.from === null) {
        const line = sentencesOf(first).find((s) => wanted.some((w) => contentWords(s.text).includes(w)))?.text ?? first.text;
        return { text: `Last time was ${dateLabel(first.createdAt, now)}. You wrote, "${quote(line)}"`, sources: [first] };
      }
      const days = new Set(matching.map((m) => startOfDay(m.createdAt))).size;
      if (q.from !== null && q.to !== null && q.to - q.from > DAY + HOUR && days > 1) {
        return {
          text: `${capitalizeFirst(rangeWords(q, now))} you wrote on ${days} days. Most recently ${dateLabel(first.createdAt, now)}, "${quote(first.text, 160)}"`,
          sources: matching.slice(0, 7),
        };
      }
      return { text: `${capitalizeFirst(dateLabel(first.createdAt, now))} you wrote, "${quote(first.text, 240)}"`, sources: matching.slice(0, 3) };
    }
    case 'count': {
      const wanted = q.keywords.filter((w) => !['time', 'times', 'go', 'do'].includes(w));
      const entries = await itemsIn(db, ['diary', 'note'], q.from, q.to);
      const days = new Set<number>();
      for (const e of entries) if (wanted.some((w) => contentWords(e.text).includes(w))) days.add(startOfDay(e.createdAt));
      for (const h of (await listHabits(db)).filter((h) => wanted.some((w) => contentWords(h.name).includes(w)))) {
        const logs = await db.getAllAsync<{ day: number }>('SELECT day FROM habit_logs WHERE habit_id = ?', [h.id]);
        for (const l of logs) if ((q.from === null || l.day >= q.from) && (q.to === null || l.day < q.to)) days.add(l.day);
      }
      const n = days.size;
      const period = /this month/i.test(q.text) ? ' this month' : /this week/i.test(q.text) ? ' this week' : /last month/i.test(q.text) ? ' last month' : '';
      const dates = [...days].sort((a, b) => a - b).slice(-4).map((d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      return { text: n ? `${n} ${n === 1 ? 'time' : 'times'}${period}${dates.length ? `, on ${joinWords(dates)}` : ''}.` : `None${period}, from what you wrote.`, sources: [] };
    }
    default:
      return answerFact(db, q, now);
  }
}

/** A question about something you noted: the sentence that answers it, and where it came from. */
async function answerFact(db: Db, q: QuestionPlan, now: Date): Promise<{ text: string; sources: Item[] }> {
  const wanted = q.keywords;
  // A reminder you set is the most exact answer to "when is...".
  if (/^when\b/i.test(q.text)) {
    const todos = (await openTodos(db)).filter((t) => t.dueAt && overlap(t.title, wanted.join(' ')) >= 0.5);
    if (todos.length) return { text: `${todos[0].title}, ${when(todos[0].dueAt!, now)}.`, sources: [] };
  }
  const items = await itemsIn(db, ['note', 'diary', 'link', 'photo'], q.from, q.to);
  const question = embed(q.text);
  let best: { s: Sentence; score: number } | null = null;
  for (const item of items) {
    for (const s of sentencesOf(item)) {
      const words = contentWords(s.text);
      const hits = wanted.filter((w) => words.includes(w)).length;
      if (!hits && wanted.length) continue;
      const meaning = question ? Math.max(0, similarity(question, embed(s.text) ?? new Float32Array(question.length))) : 0;
      const score = (wanted.length ? hits / wanted.length : 0) * 2 + meaning;
      if (!best || score > best.score) best = { s, score };
    }
  }
  if (!best || best.score < 0.8) return { text: "I couldn't find that in your notes yet. Tell me and I'll remember it.", sources: [] };
  const from = best.s.item.kind === 'diary' ? 'your diary' : 'your note';
  return { text: `From ${from} ${dateLabel(best.s.item.createdAt, now)}, "${quote(best.s.text)}"`, sources: [best.s.item] };
}

// ------------------------------------------------------------ noticing habits

// Things people do again and again, as the word you would say and its plain form.
const ACTIVITIES = new Map(
  ['gym', 'workout', 'run', 'walk', 'yoga', 'meditate', 'meditation', 'read', 'study', 'swim', 'cycle', 'practice', 'journal', 'cook', 'stretch', 'guitar', 'piano', 'code', 'leetcode', 'jog', 'pray', 'badminton', 'cricket', 'tennis', 'football'].map(
    (w) => [contentWords(w)[0] ?? w, w] as const,
  ),
);

/** Something you keep doing, seen in your diary, that could become a habit with a daily tick. */
export async function habitSuggestion(db: Db, now = new Date()): Promise<{ word: string; days: number } | null> {
  const since = startOfDay(now.getTime()) - 14 * DAY;
  const entries = await itemsIn(db, ['diary'], since, null);
  const habits = await listHabits(db);
  const dismissed = await db.getFirstAsync<{ value: string }>("SELECT value FROM meta WHERE key = 'habit_suggestion_dismissed'");
  const skip = new Set((dismissed?.value ?? '').split(',').filter(Boolean));
  const tally = new Map<string, Set<number>>();
  for (const e of entries) {
    for (const w of new Set(contentWords(e.text))) {
      if (!ACTIVITIES.has(w)) continue;
      const set = tally.get(w) ?? new Set<number>();
      set.add(startOfDay(e.createdAt));
      tally.set(w, set);
    }
  }
  const best = [...tally.entries()]
    .filter(([w, days]) => days.size >= 3 && !skip.has(ACTIVITIES.get(w)!) && !habits.some((h) => contentWords(h.name).includes(w)))
    .sort((a, b) => b[1].size - a[1].size)[0];
  return best ? { word: ACTIVITIES.get(best[0])!, days: best[1].size } : null;
}

export async function dismissHabitSuggestion(db: Db, word: string) {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM meta WHERE key = 'habit_suggestion_dismissed'");
  const words = new Set((row?.value ?? '').split(',').filter(Boolean));
  words.add(word);
  await db.runAsync("INSERT OR REPLACE INTO meta (key, value) VALUES ('habit_suggestion_dismissed', ?)", [[...words].join(',')]);
}

/** The latest things you told Memoir and what it said, newest first. */
export async function recentTalk(db: Db, limit = 20): Promise<{ id: number; input: string; reply: string; kind: string; undone: boolean; at: number }[]> {
  const rows = await db.getAllAsync<{ id: number; input: string; reply: string; kind: string; undone: number; created_at: number }>(
    'SELECT * FROM agent_log ORDER BY id DESC LIMIT ?',
    [limit],
  );
  return rows.map((r) => ({ id: r.id, input: r.input, reply: r.reply, kind: r.kind, undone: Boolean(r.undone), at: r.created_at }));
}
