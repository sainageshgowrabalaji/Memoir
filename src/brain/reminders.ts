// When Memoir reminds you about a to-do. It keeps nudging until you mark it done.
//
// Phones only allow a set number of waiting reminders per app (64 on iPhone), and a
// repeating daily reminder only exists on iPhone. So each to-do gets a few one-off
// reminders that work the same on both phones: when it is due, then 1, 3 and 7 days
// later. Every time the app opens, the list is rebuilt, which tops them back up.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
export const MAX_SCHEDULED = 60; // under iPhone's 64, with room to spare
const FOLLOW_UPS = [0, 1, 3, 7];

export type OpenTodo = { id: number; title: string; dueAt: number | null; createdAt: number };
export type PlannedReminder = { todoId: number; title: string; at: number; overdue: boolean };

/** The next morning at 9, which is when a to-do with no date first reminds you. */
export function nextMorning(from: number): number {
  const date = new Date(from);
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date.getTime();
}

export function reminderTimes(todo: OpenTodo, now: number): number[] {
  const first = todo.dueAt ?? nextMorning(todo.createdAt);
  let times = FOLLOW_UPS.map((days) => first + days * DAY).filter((t) => t > now + 60 * 1000);
  // Past all the planned nudges and still not done, so a gentle one every 3 days.
  if (!times.length) {
    const nextAt = new Date(nextMorning(now));
    times = [nextAt.getTime(), nextAt.getTime() + 3 * DAY];
  }
  return times;
}

/** Every reminder to schedule right now, soonest first, within the phone's limit. */
export function planReminders(todos: OpenTodo[], now: number): PlannedReminder[] {
  return todos
    .flatMap((todo) =>
      reminderTimes(todo, now).map((at) => ({
        todoId: todo.id,
        title: todo.title,
        at,
        overdue: todo.dueAt !== null && at > todo.dueAt + HOUR,
      })),
    )
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX_SCHEDULED);
}

export function describeDue(dueAt: number | null, now: number): { text: string; tone: 'overdue' | 'soon' | 'later' | 'none' } {
  if (dueAt === null) return { text: 'No date', tone: 'none' };
  const due = new Date(dueAt);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = Math.floor((new Date(due).setHours(0, 0, 0, 0) - today.getTime()) / DAY);
  const time = due.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (dueAt < now) {
    const late = Math.max(1, Math.round((now - dueAt) / DAY));
    return { text: late <= 1 && days === 0 ? `Due earlier today, ${time}` : `Overdue by ${late} day${late > 1 ? 's' : ''}`, tone: 'overdue' };
  }
  if (days === 0) return { text: `Today, ${time}`, tone: 'soon' };
  if (days === 1) return { text: `Tomorrow, ${time}`, tone: 'soon' };
  if (days < 7) return { text: `${due.toLocaleDateString([], { weekday: 'long' })}, ${time}`, tone: 'later' };
  return { text: due.toLocaleDateString([], { month: 'short', day: 'numeric' }), tone: 'later' };
}

// ------------------------------------------------------------ saved links to check

// A saved reel or link is "to check" until you open it or mark it done. Memoir nudges you in the
// evening, when there is time to watch, then again 1, 3 and 7 days later, then once a week.
// All the links due at the same time share one notification, so it never floods the phone.

export const EVENING_HOUR = 20;
const CHECK_FOLLOW_UPS = [0, 1, 3, 7];

export type ToCheck = { id: number; title: string; createdAt: number; checkAfter: number | null; source?: string };
export type CheckDigest = { at: number; items: { id: number; title: string; source?: string }[] };

/** 8 PM on the day it was saved, or the next evening when it was saved late. */
export function firstEvening(savedAt: number): number {
  const date = new Date(savedAt);
  const evening = new Date(date);
  evening.setHours(EVENING_HOUR, 0, 0, 0);
  // Saved after 6 PM, so tonight is too soon. Tomorrow evening instead.
  if (date.getHours() >= EVENING_HOUR - 2) evening.setDate(evening.getDate() + 1);
  return evening.getTime();
}

export function checkTimes(item: ToCheck, now: number, horizonDays = 21): number[] {
  const first = item.checkAfter ?? firstEvening(item.createdAt);
  const times = CHECK_FOLLOW_UPS.map((days) => first + days * DAY);
  // Still not checked a week later, so once a week after that.
  for (let t = first + 14 * DAY; t < now + horizonDays * DAY; t += 7 * DAY) times.push(t);
  return times.filter((t) => t > now + 60 * 1000 && t < now + horizonDays * DAY);
}

/** Notifications for links still to check, one per time slot, soonest first. */
export function planCheckDigests(items: ToCheck[], now: number, max = 14): CheckDigest[] {
  const byTime = new Map<number, CheckDigest>();
  for (const item of items) {
    for (const at of checkTimes(item, now)) {
      const digest = byTime.get(at) ?? { at, items: [] };
      digest.items.push({ id: item.id, title: item.title, source: item.source });
      byTime.set(at, digest);
    }
  }
  return [...byTime.values()].sort((a, b) => a.at - b.at).slice(0, max);
}

function kindWord(items: CheckDigest['items']): string {
  if (items.every((i) => i.source === 'instagram' || i.source === 'tiktok')) return 'reels';
  if (items.every((i) => i.source === 'youtube')) return 'videos';
  return 'saves';
}

/** The words on one to-check notification. */
export function digestMessage(digest: CheckDigest): { title: string; body: string } {
  const n = digest.items.length;
  const shown = digest.items.slice(0, 3).map((i) => `• ${i.title}`);
  if (n > 3) shown.push(`and ${n - 3} more`);
  return { title: n === 1 ? 'Time to check this' : `${n} ${kindWord(digest.items)} to check`, body: shown.join('\n') };
}

export type LaterChoice = { key: 'tonight' | 'tomorrow' | 'weekend' | 'nextweek'; label: string; at: number };

/** The "remind me later" choices on a saved link, with their times. */
export function laterChoices(nowMs: number): LaterChoice[] {
  const now = new Date(nowMs);
  const at = (daysAhead: number, hour: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + daysAhead);
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  };
  const choices: LaterChoice[] = [];
  if (now.getHours() < EVENING_HOUR - 1) choices.push({ key: 'tonight', label: 'Tonight', at: at(0, EVENING_HOUR) });
  choices.push({ key: 'tomorrow', label: 'Tomorrow', at: at(1, EVENING_HOUR) });
  const day = now.getDay(); // Sunday is 0, Saturday is 6
  if (day === 6) choices.push({ key: 'weekend', label: 'Sunday morning', at: at(1, 10) });
  else if (day === 0) choices.push({ key: 'weekend', label: 'Next weekend', at: at(6, 10) });
  else choices.push({ key: 'weekend', label: 'This weekend', at: at(6 - day, 10) });
  const toMonday = ((8 - day) % 7) || 7;
  choices.push({ key: 'nextweek', label: 'Next week', at: at(toMonday, EVENING_HOUR) });
  return choices;
}

// ------------------------------------------------------------ diary

export const DIARY_HOUR = 21;
export const DIARY_MINUTE = 30;

/** A gentle 9:30 PM nudge to write about your day, skipping today if you already did. */
export function diaryNudges(nowMs: number, wroteToday: boolean, days = 7): number[] {
  const times: number[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(nowMs);
    d.setDate(d.getDate() + i);
    d.setHours(DIARY_HOUR, DIARY_MINUTE, 0, 0);
    if (i === 0 && wroteToday) continue;
    if (d.getTime() > nowMs + 60 * 1000) times.push(d.getTime());
  }
  return times;
}
