// Spotting a to-do in what you save, and when it is due.
// "I want to renew my passport next month" becomes the to-do "Renew my passport",
// due on the first of next month at 9 AM. chrono-node reads the date words offline.

import * as chrono from 'chrono-node';

import { capitalize } from './links';

export type TodoGuess = { title: string; dueAt: number | null; dateText: string | null };

// How people start a to-do out loud or in a note.
const LEAD =
  /^\s*(?:(?:to-?do|task|reminder)\s*[:\-]\s*|remind me(?: to)?\s+|don'?t forget(?: to)?\s+|remember to\s+|i\s*(?:(?:want|need|have|plan|would like|'d like|wanna|ought|got)\s+to|should|must|gotta|will|'ll|am going to|'m going to|gonna)\s+|(?:need|have|want|plan|got)\s+to\s+|must\s+|should\s+|gotta\s+|let'?s\s+)/i;

// A short note that starts with one of these verbs is a to-do too, like "Call the dentist".
const ACTION =
  /^\s*(?:buy|call|book|pay|renew|finish|submit|email|text|message|schedule|cancel|return|pick up|drop off|order|fix|clean|visit|apply|register|sign up|send|reply|check|prepare|study|learn|practice|watch|read|write|update|file|renew|meet|try|get)\b/i;

const MAX_ACTION_WORDS = 14;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The time of day a to-do is due when only the day was given. */
export const DEFAULT_HOUR = 9;

function dueFrom(result: chrono.ParsedResult, now: Date): number {
  const date = result.start.date();
  // "By Monday", said on a Monday, means next Monday.
  if (result.start.isCertain('weekday') && !result.start.isCertain('day') && !result.start.isCertain('hour') && date.toDateString() === now.toDateString()) {
    date.setDate(date.getDate() + 7);
  }
  if (!result.start.isCertain('hour')) {
    date.setHours(DEFAULT_HOUR, 0, 0, 0);
    // "Today" said at 3 PM should not be due six hours ago.
    if (date.getTime() <= now.getTime()) {
      const evening = new Date(date);
      evening.setHours(18, 0, 0, 0);
      if (evening.getTime() > now.getTime()) return evening.getTime();
      date.setDate(date.getDate() + 1);
    }
  }
  return date.getTime();
}

export function detectTodo(text: string, now: Date = new Date()): TodoGuess | null {
  for (const sentence of sentences(text)) {
    const lead = sentence.match(LEAD);
    const isAction = !lead && ACTION.test(sentence) && sentence.split(/\s+/).length <= MAX_ACTION_WORDS;
    const saysRemind = /\bremind me\b/i.test(sentence);
    if (!lead && !isAction && !saysRemind) continue;

    const parsed = chrono.parse(sentence, now, { forwardDate: true });
    const when = parsed.find((r) => r.start.isCertain('day') || r.start.isCertain('weekday') || r.start.isCertain('hour') || r.start.isCertain('month'));

    let title = sentence;
    if (when) title = title.replace(when.text, ' ');
    title = title
      .replace(LEAD, '')
      .replace(/\bremind me(?: to)?\b/i, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s,:;-]+|[\s,.;:!?-]+$/g, '')
      // "book the tickets by Friday" loses "Friday" to the due date, so drop the "by" left behind.
      .replace(/(?:\s+(?:by|on|at|before|after|until|till|in|this|next|coming|for))+$/i, '')
      .replace(/[\s,.;:!?-]+$/g, '');
    // "I'm going to the gym" is going somewhere, not "the gym" as a thing to do.
    if (lead && /going to|gonna/i.test(lead[0]) && /^(?:the|a|an|my|our|his|her|their|office|work|school|college|gym|bed|church|temple|mosque|market|town|home)\b/i.test(title)) {
      title = `go to ${title}`;
    }
    if (!title) continue;

    return {
      title: capitalize(title),
      dueAt: when ? dueFrom(when, now) : null,
      dateText: when ? when.text : null,
    };
  }
  return null;
}
