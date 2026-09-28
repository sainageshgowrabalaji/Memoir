// What Memoir says after you save something, so you can see what it understood.
import { CATEGORY_BY_ID } from '@/brain/categories';
import { SOURCE_LABELS } from '@/brain/links';
import { describeDue, firstEvening } from '@/brain/reminders';
import type { Saved } from '@/db/repo';
import { ago } from '@/lib/format';

function lowerDay(text: string) {
  return text.replace(/^(Today|Tomorrow)/, (word) => word.toLowerCase());
}

export function savedMessage(saved: Saved, remindersOn: boolean, now = Date.now()): string {
  const { item, todo, duplicate } = saved;
  const nudge = new Date(firstEvening(now)).getDate() === new Date(now).getDate() ? 'tonight' : 'tomorrow evening';
  if (duplicate) {
    return `You saved this ${ago(item.createdAt, now)}. It is back on your To check list for ${nudge}.`;
  }
  const shelf = CATEGORY_BY_ID[item.category]?.label ?? 'Notes';
  const from = item.source !== 'me' && item.source !== 'photo' ? ` from ${SOURCE_LABELS[item.source]}` : '';
  const people = item.people.length ? ` About ${item.people.slice(0, 3).join(', ')}.` : '';
  let line = `Saved to ${shelf}${from}.${people}`;
  if (item.kind === 'link') {
    line += ` Memoir is reading what it is, and will remind you ${nudge} to check it.`;
  }
  if (todo) {
    const due = describeDue(todo.dueAt, now);
    line += todo.dueAt ? ` Added to your to-dos, due ${lowerDay(due.text)}.` : ' Added to your to-dos. It will remind you tomorrow morning.';
  }
  if ((todo || item.kind === 'link') && !remindersOn) line += ' Turn on reminders in Follow up to be nudged.';
  return line;
}
