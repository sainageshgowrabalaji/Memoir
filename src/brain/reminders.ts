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
