// Reading a question like "I remember saving a reel about hiking last week".
// It becomes filters (Instagram, last week) and search words (hiking), so the answer
// comes from your own saved things, on the phone, with no model needed.

import { CATEGORIES, type CategoryId } from './categories';
import { SOURCE_LABELS, type Source } from './links';
import type { Kind } from './analyze';

export type Query = {
  terms: string[];
  from: number | null;
  to: number | null;
  kinds: Kind[];
  sources: Source[];
  categories: CategoryId[];
  people: string[];
  todosOnly: boolean;
  /** Plain-words labels for what was understood, shown as chips above the results. */
  understood: string[];
  /** The words left to search by meaning, without names, dates and filler. */
  meaning: string;
};

const DAY = 24 * 60 * 60 * 1000;

const FILLER = new Set(
  (
    'i im ive id me my mine we our you your remember remembered recall think saving saved save saves stored store kept keep ' +
    'where wheres whats what which when who whom how did do does was were is are am be been the a an that this those these ' +
    'it its about some something thing things stuff one ones from in on of for to with and or there here find show get give ' +
    'look looking search me please can could would should any all ago back earlier sometime somewhere someone someones sent ' +
    'shared send share posted said say says told tell tells mentioned had have has just only really very also like kind sort bit little'
  ).split(' '),
);

const KIND_WORDS: [RegExp, Kind][] = [
  [/\b(photos?|pics?|pictures?|images?|screenshots?|selfies?)\b/, 'photo'],
  [/\b(links?|urls?|websites?|sites?|articles?|webpages?|pages?)\b/, 'link'],
  [/\b(diary|journal|entries|entry)\b/, 'diary'],
];

const KIND_LABELS: Record<Kind, string> = { photo: 'Photos', link: 'Links', diary: 'Diary', note: 'Notes' };

const SOURCE_WORDS: [RegExp, Source][] = [
  [/\b(instagram|insta|ig|reels?)\b/, 'instagram'],
  [/\b(youtube|yt|videos?|shorts)\b/, 'youtube'],
  [/\b(tiktok)\b/, 'tiktok'],
  [/\b(twitter|tweets?)\b/, 'x'],
  [/\b(facebook|fb)\b/, 'facebook'],
  [/\b(reddit)\b/, 'reddit'],
  [/\b(linkedin)\b/, 'linkedin'],
  [/\b(whatsapp)\b/, 'whatsapp'],
  [/\b(maps?|locations?|address)\b/, 'maps'],
];

// A few everyday words mean the same thing. The on-phone model (meaning.ts) widens this further.
const SYNONYMS: Record<string, string[]> = {
  hike: ['hiking', 'trail', 'trek'],
  hiking: ['hike', 'trail', 'trek'],
  trek: ['hike', 'hiking', 'trail'],
  trip: ['travel', 'vacation'],
  vacation: ['trip', 'travel'],
  restaurant: ['food', 'cafe', 'dinner'],
  recipe: ['cook', 'cooking', 'food'],
  movie: ['film', 'watch'],
  film: ['movie'],
  job: ['work', 'career', 'interview'],
  doctor: ['health', 'clinic', 'hospital'],
  money: ['bank', 'card', 'payment'],
  birthday: ['bday'],
  bday: ['birthday'],
  song: ['music'],
  book: ['read', 'reading'],
  gym: ['workout', 'exercise'],
};

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

type Range = { from: number; to: number; label: string; words: RegExp };

function timeRange(q: string, now: Date): Range | null {
  const today = startOfDay(now).getTime();
  const tomorrow = today + DAY;
  const weekStart = today - now.getDay() * DAY;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const fixed: Range[] = [
    { words: /\btoday\b|\bthis morning\b|\btonight\b/, from: today, to: tomorrow, label: 'Today' },
    { words: /\byesterday\b|\blast night\b/, from: today - DAY, to: today, label: 'Yesterday' },
    { words: /\bthis week\b/, from: weekStart, to: tomorrow, label: 'This week' },
    { words: /\blast week\b|\bprevious week\b/, from: weekStart - 7 * DAY, to: weekStart, label: 'Last week' },
    { words: /\b(few|couple of|2|3|two|three) days\b/, from: today - 4 * DAY, to: tomorrow, label: 'Last few days' },
    { words: /\brecent(ly)?\b|\blately\b/, from: today - 14 * DAY, to: tomorrow, label: 'Recently' },
    { words: /\bthis month\b/, from: monthStart, to: tomorrow, label: 'This month' },
    {
      words: /\blast month\b|\bprevious month\b/,
      from: new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(),
      to: monthStart,
      label: 'Last month',
    },
    { words: /\bthis year\b/, from: new Date(now.getFullYear(), 0, 1).getTime(), to: tomorrow, label: 'This year' },
    {
      words: /\blast year\b/,
      from: new Date(now.getFullYear() - 1, 0, 1).getTime(),
      to: new Date(now.getFullYear(), 0, 1).getTime(),
      label: 'Last year',
    },
  ];
  for (const range of fixed) if (range.words.test(q)) return range;

  // "May" is also a word, as in "I may have saved it", so it only counts after "in" or before a date.
  const month = MONTHS.findIndex((m) =>
    m === 'may' ? /\b(in|during|back in|since)\s+may\b|\bmay\s+\d/.test(q) : new RegExp(`\\b${m}\\b`).test(q),
  );
  if (month >= 0) {
    // The most recent one that has started, so in September "March" means this March.
    const year = month <= now.getMonth() ? now.getFullYear() : now.getFullYear() - 1;
    const label = MONTHS[month].charAt(0).toUpperCase() + MONTHS[month].slice(1);
    return {
      words: new RegExp(`\\b${MONTHS[month]}\\b`),
      from: new Date(year, month, 1).getTime(),
      to: new Date(year, month + 1, 1).getTime(),
      label,
    };
  }

  const weekday = WEEKDAYS.findIndex((d) => new RegExp(`\\b${d}\\b`).test(q));
  if (weekday >= 0) {
    const back = (now.getDay() - weekday + 7) % 7 || 7;
    const day = today - back * DAY;
    const label = WEEKDAYS[weekday].charAt(0).toUpperCase() + WEEKDAYS[weekday].slice(1);
    return { words: new RegExp(`\\b${WEEKDAYS[weekday]}\\b`), from: day, to: day + DAY, label };
  }
  return null;
}

export function parseQuery(question: string, now: Date = new Date(), knownPeople: string[] = []): Query {
  let q = ` ${question.toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}\s#@.-]/gu, ' ')} `;
  const understood: string[] = [];

  const range = timeRange(q, now);
  if (range) {
    understood.push(range.label);
    q = q.replace(range.words, ' ').replace(/\b(few|couple of|last|previous|this|days?|week|month|year)\b/g, ' ');
  }

  const kinds: Kind[] = [];
  for (const [pattern, kind] of KIND_WORDS) {
    if (pattern.test(q)) {
      kinds.push(kind);
      understood.push(KIND_LABELS[kind]);
      q = q.replace(pattern, ' ');
    }
  }

  const sources: Source[] = [];
  for (const [pattern, source] of SOURCE_WORDS) {
    if (pattern.test(q)) {
      sources.push(source);
      understood.push(SOURCE_LABELS[source]);
      q = q.replace(pattern, ' ');
    }
  }

  const todosOnly = /\b(to-?dos?|tasks?|remind(ers?)?)\b/.test(q);
  if (todosOnly) {
    understood.push('To-dos');
    q = q.replace(/\b(to-?dos?|tasks?|remind(ers?)?)\b/g, ' ');
  }

  const people = knownPeople.filter((person) => new RegExp(`\\b${person.toLowerCase()}\\b`).test(q));
  for (const person of people) understood.push(person);

  const categories = CATEGORIES.filter((c) => c.id !== 'notes' && new RegExp(`\\b${c.label.toLowerCase()}\\b`).test(q)).map((c) => c.id);

  const words = q
    .split(/\s+/)
    .map((w) => w.replace(/^[#@.-]+|[.-]+$/g, ''))
    .filter((w) => w.length >= 2 && !FILLER.has(w));
  const terms = [...new Set(words.flatMap((w) => [w, ...(SYNONYMS[w] ?? [])]))];
  const shown = new Set(understood.map((label) => label.toLowerCase()));
  for (const w of words) {
    if (!shown.has(w)) understood.push(w);
    shown.add(w);
  }

  return {
    terms,
    from: range?.from ?? null,
    to: range?.to ?? null,
    kinds,
    sources,
    categories,
    people,
    todosOnly,
    understood,
    meaning: words.filter((w) => !people.some((p) => p.toLowerCase() === w)).join(' '),
  };
}
