// What Memoir says after you save something, so you can see what it understood.
import { CATEGORY_BY_ID } from '@/brain/categories';
import { SOURCE_LABELS } from '@/brain/links';
import { describeDue } from '@/brain/reminders';
import type { Saved } from '@/db/repo';

export function savedMessage(saved: Saved, remindersOn: boolean, now = Date.now()): string {
  const { item, todo } = saved;
  const shelf = CATEGORY_BY_ID[item.category]?.label ?? 'Notes';
  const from = item.source !== 'me' && item.source !== 'photo' ? ` from ${SOURCE_LABELS[item.source]}` : '';
  const people = item.people.length ? ` About ${item.people.slice(0, 3).join(', ')}.` : '';
  let line = `Saved to ${shelf}${from}.${people}`;
  if (todo) {
    const due = describeDue(todo.dueAt, now);
    line += todo.dueAt
      ? ` Added to your to-dos, due ${due.text.replace(/^(Today|Tomorrow)/, (word) => word.toLowerCase())}.`
      : ' Added to your to-dos. It will remind you tomorrow morning.';
    if (!remindersOn) line += ' Turn on reminders in To-dos to be nudged.';
  }
  return line;
}
