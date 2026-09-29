// When Memoir reminds you. A to-do keeps nudging until you mark it done, a habit reminds you at its
// time on its days, a short brief each morning says what the day holds, and a gentle evening
// nudge asks how the day went.
//
// Phones only allow a set number of waiting reminders per app (64 on iPhone), and a
// repeating daily reminder only exists on iPhone. So everything is a one-off reminder that
// works the same on both phones, planned about a week ahead. Every time the app opens, the
// plan is rebuilt, which tops them back up.

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

// ------------------------------------------------------------ habits

export type HabitForReminders = { id: number; name: string; days: number[]; hour: number | null; minute: number; doneToday: boolean };

/** A reminder at the habit's time on each of its days this coming week, skipping today once it is ticked. */
export function habitReminders(habits: HabitForReminders[], nowMs: number, days = 7): { habitId: number; title: string; at: number }[] {
  const out: { habitId: number; title: string; at: number }[] = [];
  for (const h of habits) {
    if (h.hour === null) continue;
    for (let i = 0; i < days; i++) {
      const d = new Date(nowMs);
      d.setDate(d.getDate() + i);
      d.setHours(h.hour, h.minute, 0, 0);
      if (!h.days.includes(d.getDay())) continue;
      if (i === 0 && h.doneToday) continue;
      if (d.getTime() > nowMs + 60 * 1000) out.push({ habitId: h.id, title: h.name, at: d.getTime() });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// ------------------------------------------------------------ the morning brief

export const BRIEF_HOUR = 8;

export type Brief = { at: number; title: string; body: string };

function listWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * One notification at 8 AM on each of the coming days, with what is due that day and the habits
 * planned for it. The first one also names to-dos that have no date, so they are not forgotten.
 * A day with nothing on it gets no brief, so it never nags for nothing.
 */
export function morningBriefs(todos: OpenTodo[], habits: HabitForReminders[], nowMs: number, days = 7): Brief[] {
  const briefs: Brief[] = [];
  const anytime = todos.filter((t) => t.dueAt === null).sort((a, b) => b.createdAt - a.createdAt);
  for (let i = 0; i < days; i++) {
    const at = new Date(nowMs);
    at.setDate(at.getDate() + i);
    at.setHours(BRIEF_HOUR, 0, 0, 0);
    if (at.getTime() <= nowMs + 60 * 1000) continue;
    const start = new Date(at);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const due = todos.filter((t) => t.dueAt !== null && t.dueAt >= start.getTime() && t.dueAt < end.getTime()).sort((a, b) => a.dueAt! - b.dueAt!);
    const late = todos.filter((t) => t.dueAt !== null && t.dueAt < start.getTime()).length;
    const planned = habits.filter((h) => h.days.includes(at.getDay()));
    const first = briefs.length === 0;
    if (!due.length && !late && !planned.length && !(first && anytime.length)) continue;
    const parts = due.slice(0, 4).map((t) => {
      const d = new Date(t.dueAt!);
      const time = d.getHours() === 9 && d.getMinutes() === 0 ? '' : ` at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
      return `${t.title}${time}`;
    });
    const lines: string[] = [];
    if (parts.length) lines.push(`${listWords(parts)}${due.length > 4 ? `, and ${due.length - 4} more` : ''}.`);
    if (late) lines.push(`${late} from before still open.`);
    if (planned.length) lines.push(`Habits today, ${listWords(planned.slice(0, 4).map((h) => h.name.toLowerCase()))}.`);
    if (first && anytime.length) {
      const names = anytime.slice(0, 3).map((t) => t.title);
      lines.push(`Also on your list, ${listWords(names)}${anytime.length > 3 ? `, and ${anytime.length - 3} more` : ''}.`);
    }
    const title = due.length ? `Today, ${due.length === 1 ? 'one thing' : `${due.length} things`}` : 'Good morning';
    briefs.push({ at: at.getTime(), title, body: lines.join(' ') });
  }
  return briefs;
}

// ------------------------------------------------------------ moving a to-do

export type MoveChoice = { key: 'evening' | 'tomorrow' | 'weekend' | 'nextweek'; label: string; at: number };

/**
 * Quick times to move a to-do to, using what "morning" and "evening" mean for you.
 * `times` is from what Memoir learned, like { morning: [7, 30], evening: [18, 30] }.
 */
export function moveChoices(nowMs: number, times: Record<string, [number, number]> = {}): MoveChoice[] {
  const [mh, mm] = times.morning ?? [9, 0];
  const [eh, em] = times.evening ?? [19, 0];
  const now = new Date(nowMs);
  const at = (daysAhead: number, hour: number, minute: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + daysAhead);
    d.setHours(hour, minute, 0, 0);
    return d.getTime();
  };
  const choices: MoveChoice[] = [];
  if (at(0, eh, em) > nowMs + 30 * 60 * 1000) choices.push({ key: 'evening', label: 'This evening', at: at(0, eh, em) });
  choices.push({ key: 'tomorrow', label: 'Tomorrow morning', at: at(1, mh, mm) });
  const day = now.getDay(); // Sunday is 0, Saturday is 6
  if (day === 6 || day === 0) choices.push({ key: 'weekend', label: 'Next weekend', at: at(day === 6 ? 7 : 6, 10, 0) });
  else choices.push({ key: 'weekend', label: 'This weekend', at: at(6 - day, 10, 0) });
  const toMonday = ((8 - day) % 7) || 7;
  choices.push({ key: 'nextweek', label: 'Next week', at: at(toMonday, mh, mm) });
  return choices;
}
