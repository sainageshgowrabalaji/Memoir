// Memoir's assistant: what you meant, from one sentence you typed or said.
//
// It works in two layers. First, precise rules for the everyday things people tell an assistant
// ("remind me to call Amma at 7", "add milk and eggs to the shopping list", "I went to the gym",
// "what did I do on Sunday?"). These never guess, so simple tasks do not fail. Second, a small
// model that learns from you: every time you correct it ("that was a diary line, not a note"),
// it counts the words you used, and next time it leans your way. It all runs on the phone.

import * as chrono from 'chrono-node';

import { capitalize } from './links';
import { detectTodo } from './todo';

// ------------------------------------------------------------ what it can do

export type HabitPlan = { name: string; days: number[]; hour: number | null; minute: number };

export type QuestionKind = 'list' | 'lists' | 'todos' | 'diary' | 'count' | 'habit' | 'fact';
export type QuestionPlan = { kind: QuestionKind; text: string; list?: string; keywords: string[]; from: number | null; to: number | null };

/** A to-do that comes back after you tick it: rent every month, a birthday every year. */
export type Repeat = 'weekly' | 'monthly' | 'yearly';

export type Plan =
  | { kind: 'todo'; title: string; dueAt: number | null; repeat?: Repeat }
  | { kind: 'event'; title: string; dueAt: number; repeat?: Repeat }
  | { kind: 'list'; list: string; items: string[] }
  | { kind: 'habit'; habit: HabitPlan }
  | { kind: 'diary'; text: string; day: number }
  /** `target` is set for "mark X done": only the to-do is ticked, your words are not a diary line. */
  | { kind: 'done'; text: string; target?: string; fallback?: Plan }
  | { kind: 'note'; text: string }
  | { kind: 'question'; question: QuestionPlan }
  | { kind: 'undo' }
  /** "Delete the dentist reminder", "stop reminding me to drink water". Falls back when nothing matches. */
  | { kind: 'cancel'; target: string; habit: boolean; fallback: Plan }
  /** "Move the dentist to Friday at 4". */
  | { kind: 'move'; target: string; when: string; fallback: Plan }
  /** "Remove milk from the shopping list", or every item with `all`. */
  | { kind: 'unlist'; list: string | null; items: string[]; all?: boolean; drop?: boolean }
  /** Hello, thanks, and "what can you do". Nothing is saved. */
  | { kind: 'chat'; reply: string };

export type Kind = Plan['kind'];

/** The kinds you can switch a saved sentence to, when Memoir got it wrong. */
export const CORRECTABLE = ['todo', 'diary', 'note', 'list'] as const;
export type Correctable = (typeof CORRECTABLE)[number];

export type Understood = { plan: Plan; confidence: number; by: 'rules' | 'learned' };

// ------------------------------------------------------------ what it has learned about you

/** Everything Memoir learns, kept as small counts so it is easy to show and to reset. */
export type Learned = {
  /** For each kind, how often each word showed up in sentences you confirmed were that kind. */
  words: Partial<Record<Correctable, Record<string, number>>>;
  examples: Partial<Record<Correctable, number>>;
  /** What "morning", "evening" and similar mean for you, as [hour, minute]. */
  times: Record<string, [number, number]>;
  /** Which list a thing usually goes on, like "milk" on "shopping". */
  lists: Record<string, string>;
};

export const DEFAULT_TIMES: Record<string, [number, number]> = {
  morning: [9, 0],
  noon: [12, 0],
  lunch: [12, 30],
  afternoon: [15, 0],
  evening: [19, 0],
  tonight: [20, 0],
  night: [21, 0],
  'after work': [18, 0],
  'before bed': [22, 0],
};

export function emptyLearned(): Learned {
  return { words: {}, examples: {}, times: { ...DEFAULT_TIMES }, lists: {} };
}

// ------------------------------------------------------------ words

const IRREGULAR: Record<string, string> = {
  went: 'go', gone: 'go', bought: 'buy', paid: 'pay', sent: 'send', met: 'meet', ate: 'eat', eaten: 'eat', drank: 'drink',
  took: 'take', taken: 'take', gave: 'give', made: 'make', did: 'do', done: 'do', got: 'get', saw: 'see', seen: 'see',
  wrote: 'write', written: 'write', spoke: 'speak', slept: 'sleep', woke: 'wake', felt: 'feel', left: 'leave', ran: 'run',
  brought: 'bring', thought: 'think', taught: 'teach', caught: 'catch', found: 'find', told: 'tell', said: 'say', had: 'have',
  was: 'be', were: 'be', kept: 'keep', spent: 'spend', built: 'build', came: 'come', began: 'begin', swam: 'swim', won: 'win',
  children: 'child', groceries: 'grocery', movies: 'movie', books: 'book',
};

const STOP = new Set(
  'i me my mine we our you your the a an to of in on at for with and or but is are was were be been am do did does have has had it its this that these those some any please just also really very so then there here my up out off about into from by as all can could would should will shall'.split(
    ' ',
  ),
);

/** A word in its plain form, so "called", "calling" and "calls" all read as "call". */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/['’]s$/, '');
  if (IRREGULAR[w]) w = IRREGULAR[w];
  else if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ied')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  else if (w.length > 4 && /(sh|ch|x|ss|zz)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) w = w.slice(0, -1);
  // "stopped" and "running" leave a doubled letter behind. "call" and "pass" keep theirs.
  if (/([bdfgmnprt])\1$/.test(w)) w = w.slice(0, -1);
  // "complete" and "completed" should meet in the middle.
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

export function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).filter((w) => !STOP.has(w) && w.length > 1).map(stem);
}

/** How much of `target` is said in `text`, from 0 to 1, by plain word forms. */
export function overlap(text: string, target: string): number {
  const said = new Set(contentWords(text));
  const want = [...new Set(contentWords(target))];
  if (!want.length) return 0;
  return want.filter((w) => said.has(w)).length / want.length;
}

// ------------------------------------------------------------ times

const VAGUE = /\b(this morning|in the morning|tomorrow morning|morning|at noon|noon|at lunch|lunch ?time|lunch|this afternoon|afternoon|this evening|evening|tonight|at night|night|after work|before bed)\b/i;
const CLOCK = /\b(\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)|\d{1,2}:\d{2}|at \d{1,2}\b|noon|midnight)/i;

function vagueKey(match: string): string {
  const m = match.toLowerCase();
  if (m.includes('morning')) return 'morning';
  if (m.includes('noon')) return 'noon';
  if (m.includes('lunch')) return 'lunch';
  if (m.includes('afternoon')) return 'afternoon';
  if (m.includes('tonight')) return 'tonight';
  if (m.includes('evening')) return 'evening';
  if (m.includes('after work')) return 'after work';
  if (m.includes('before bed')) return 'before bed';
  return 'night';
}

/** The word you used for a time of day, if any, like "evening". */
export function vagueTimeWord(text: string): string | null {
  const m = text.match(VAGUE);
  return m ? vagueKey(m[0]) : null;
}

/** Puts "evening" or "tonight" at the hour you mean by it, when no clock time was said. */
export function applyVagueTime(dueAt: number | null, text: string, now: Date, learned: Learned): number | null {
  const word = vagueTimeWord(text);
  if (!word || CLOCK.test(text.replace(VAGUE, ''))) return dueAt;
  const [hour, minute] = learned.times[word] ?? DEFAULT_TIMES[word];
  const date = new Date(dueAt ?? now.getTime());
  date.setHours(hour, minute, 0, 0);
  if (date.getTime() <= now.getTime()) date.setDate(date.getDate() + 1);
  return date.getTime();
}

// ------------------------------------------------------------ the rules

const PRONOUN = '(?:i|you|we|me|he|she|they|there|it|anything|anyone|amma|mom|dad)';
const QUESTION_START = new RegExp(
  `^(?:what|what's|whats|when|where|who|whom|which|how|why|(?:did|do|does|have|has|had|is|are|was|were|can|could|will|should|am)\\s+${PRONOUN}\\b|show me|show my|show all|tell me|list my|list all|find my|search|any(?:thing)? (?:due|left|pending|on)\\b)`,
  'i',
);
const UNDO = /^(?:undo|undo that|cancel that|delete that|remove that|never ?mind|scratch that|forget it|forget that|ignore that)\b/i;
const HABIT = /\b(every\s?(?:day|morning|evening|night|week|weekday|weekend|single day|(?:mon|tues|wednes|thurs|fri|satur|sun)day)|daily|each (?:day|morning|evening|night)|on weekdays|on weekends|weekdays|weekends)\b/i;
const EVENT = /\b(birthday|anniversary|wedding|marriage|engagement|housewarming|graduation|interview|exam|appointment|flight)\b.*\b(?:is|on|at)\b/i;
const LIST_ADD = /^(?:please\s+)?(?:add|put)\s+(.+?)\s+(?:to|on|in(?:to)?)\s+(?:my\s+|the\s+|our\s+)?(?:([\p{L} ]+?)\s+)?list\b/iu;
const LIST_ADD_NAMED = /^(?:please\s+)?(?:add|put)\s+(.+?)\s+(?:to|on|in(?:to)?)\s+(?:my\s+|the\s+|our\s+)?(shopping|groceries|grocery|packing|to-?buy)\s*$/i;
const EVERY_MONTH = /\b(?:every month|each month|monthly)\b/i;
const EVERY_YEAR = /\b(?:every year|each year|yearly|annually)\b|\b(?:birthday|anniversary)\b/i;
const LIST_COLON = /^([\p{L} ]{3,20}?)\s*(?:list)?\s*[:\-]\s*(.+)$/iu;
const BUY = /^(?:need to\s+|i need to\s+|gotta\s+)?(?:buy|get|pick up|grab)\s+(.+)$/i;
// Finishing a task, said the way people say it. Plain past tense ("went to the gym") is your diary;
// either way, a to-do that matches what you said gets ticked when Memoir acts on it.
const DONE_LEAD = /^(?:i\s+)?(?:just\s+|already\s+|finally\s+)?(?:(?:am\s+|'m\s+)?done with|finished|completed|called|paid|booked|sent|submitted|renewed|fixed|returned|emailed|texted|messaged|ordered|cancell?ed|replied to|scheduled|applied for|registered for|mailed|posted)\b/i;
const DONE_TAIL = /\b(?:is|are|was|were|got|has been|have been)?\s*(?:done|finished|complete|completed|sorted|sent|paid|booked|submitted|fixed|renewed|ordered|cancell?ed|delivered|returned|filed|posted|scheduled)\s*[.!]*$/i;
const PAST = /\b(went|had|met|did|was|were|ate|drank|watched|finished|called|visited|bought|played|worked|learned|learnt|read|saw|spent|got|felt|slept|woke|walked|ran|cooked|talked|spoke|cleaned|studied|practiced|practised|attended|enjoyed|tried|made|took|gave|came|left|stayed|travelled|traveled|drove|moved|started|completed|celebrated)\b/i;
const DIARY_CUE = /^(?:today|tonight|this morning|this afternoon|this evening|yesterday|last night|dear diary|diary\s*[:\-]|ugh|yay|phew|finally)|\b(?:today i|i feel|i'm feeling|feeling|i felt|i am so|i'm so)\b|\b(?:has been|have been|was|is|were)\s+(?:so\s+|really\s+|very\s+|pretty\s+|super\s+)?(?:busy|tired|long|hard|rough|great|good|bad|amazing|productive|hectic|crazy|fun|tiring|exhausting|stressful|boring|awesome|lovely|nice|slow|quiet)\b/i;
// Plainly about the past: "picked up the dry cleaning", "hit the gym this morning".
const PAST_START = /^(?:i\s+)?(?:just\s+|already\s+|finally\s+)?[a-z]{3,}ed\b|^(?:i\s+)?(?:hit|got|went|had|did|ate|took|gave|made|met|saw|ran|read|wrote|slept|woke|drank|bought|sold|found|left|came|brought|caught|taught|fought|spent|sent|built|kept|felt|lost|won|paid|said|told|swam|drove|rode|forgot|got)\b/i;
const PAST_TIME = /\b(?:this morning|earlier today|last night|yesterday|just now|an hour ago|this afternoon)\b/i;
const FUTURE_WORDS = /\b(?:will|going to|gonna|need to|have to|must|should|remind|tomorrow|tonight|later|next|want to|plan to)\b/i;

// Looking after what is already saved: ticking, deleting, moving, taking things off a list.
const MARK_DONE = /^(?:please\s+)?(?:mark|tick(?:\s+off)?|check off|cross off|strike off)\s+(.+?)(?:\s+(?:as\s+)?(?:done|complete|completed|finished))?\s*[.!]*$/i;
const DONE_COLON = /^(?:done|finished|completed)\s*[:\-]\s*(.+)$/i;
const REMOVE_FROM_LIST = /^(?:please\s+)?(?:remove|delete|take|cross|strike)\s+(.+?)\s+(?:off|from|out of)\s+(?:my\s+|the\s+|our\s+)?(?:([\p{L} ]+?)\s+)?list\s*[.!]*$/iu;
const REMOVE_FROM_NAMED = /^(?:please\s+)?(?:remove|delete|take|cross)\s+(.+?)\s+(?:off|from|out of)\s+(?:my\s+|the\s+|our\s+)?(shopping|groceries|grocery|packing)\s*[.!]*$/i;
const CLEAR_LIST = /^(?:please\s+)?(?:clear|empty|reset|wipe|clean)\s+(?:out\s+)?(?:my\s+|the\s+|our\s+)?(?:([\p{L} ]+?)\s+)?list\s*[.!]*$/iu;
const CANCEL = /^(?:please\s+)?(?:delete|remove|drop|scrap|forget(?:\s+about)?|don'?t remind me(?:\s+to|\s+about)?|no need to remind me(?:\s+to|\s+about)?)\s+(?:the\s+|my\s+|that\s+|this\s+)?(.+?)\s*[.!]*$/i;
const CANCEL_NAMED = /^(?:please\s+)?cancel\s+(?:the\s+|my\s+)?(.+?)\s+(?:reminder|to-?do|task|alarm|habit|event)s?\s*[.!]*$/i;
const STOP_HABIT = /^(?:please\s+)?(?:stop|pause|end)\s+(?:reminding me\s+(?:to|about)\s+(.+?)|(?:the\s+|my\s+)?(.+?)\s+(?:habit|reminders?))\s*[.!]*$/i;
const MOVE = /^(?:please\s+)?(?:move|push|reschedule|postpone|shift|change|delay|put off|bump)\s+(?:the\s+|my\s+)?(.+?)\s+(?:to|till|until|for|by)\s+(.+?)\s*[.!]*$/i;

// Small talk, answered kindly and never saved.
const GREETING = /^(?:hi|hello|hey|hii+|heya|yo|good (?:morning|afternoon|evening|night)|gm|gn)\b[\s!.,]*(?:memoir)?[\s!.]*$/i;
const THANKS = /^(?:thanks|thank you|thank u|thx|ty|cool|ok|okay|k|great|nice|awesome|perfect|got it|sure|alright|fine|good|wow)\b[\s!.,]*(?:memoir)?[\s!.]*$/i;
const HELP = /^(?:help|what can you do|what do you do|what can i (?:say|ask|tell you)|how does this work|how do i use (?:this|you|memoir)|who are you)\b/i;

export const HELP_TEXT =
  "Tell me things the way you'd tell a friend, typed or spoken with the keyboard mic. \"Remind me to call Amma at 7\", \"add milk to the shopping list\", \"went to the gym today\", \"drink water every day at 10am\". I sort each one into your to-dos, lists, habits, diary or notes. Then ask me anything, like \"what's on today?\" or \"when is Priya's wedding?\". Everything stays on this phone.";

function chatReply(text: string, now: Date): string | null {
  if (HELP.test(text)) return HELP_TEXT;
  if (/^(?:good ?night|gn|night night|going to (?:bed|sleep))\b/i.test(text)) return 'Good night. Sleep well.';
  if (/\b(?:tell me a joke|say something funny|make me laugh)\b/i.test(text)) return "I'm better at remembering things than telling jokes. Try me with a reminder.";
  if (GREETING.test(text)) {
    const h = now.getHours();
    const hello = h < 5 ? 'Hello, night owl.' : h < 12 ? 'Good morning.' : h < 17 ? 'Good afternoon.' : 'Good evening.';
    return `${hello} What's on your mind?`;
  }
  if (THANKS.test(text)) return /^(?:thanks|thank|thx|ty)/i.test(text) ? 'Anytime.' : 'Okay.';
  return null;
}

// Short everyday things to buy, so a bare "milk" or "eggs and butter" goes on the shopping list.
const GROCERIES = new Set(
  ('milk eggs egg bread butter cheese curd yogurt yoghurt paneer rice dal atta flour sugar salt oil ghee tea coffee onions onion ' +
    'potatoes potato tomatoes tomato garlic ginger chillies chilli lemons lemon bananas banana apples apple fruits fruit vegetables ' +
    'veggies spinach carrots carrot cucumber coriander mint soap shampoo toothpaste detergent tissues napkins batteries biscuits ' +
    'cereal oats honey jam juice chicken fish mutton noodles pasta sauce ketchup masala spices diapers wipes razor conditioner')
    .split(' '),
);

const GROCERY_STEMS = new Set([...GROCERIES].map((w) => stem(w)));
// Things people pack or carry. Used only to split "passport charger headphones" into three.
const THINGS = new Set(
  ('passport charger charger headphones earphones toothbrush toothpaste sunscreen clothes shoes laptop adapter medicines tickets wallet keys ' +
    'sunglasses jacket umbrella towel socks cash id visa documents camera book books snacks water bottle pillow slippers razor comb')
    .split(' ')
    .map((w) => stem(w)),
);

const WEEKDAYS: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

function listName(raw: string | undefined): string {
  const name = (raw ?? '').toLowerCase().replace(/\b(my|the|our)\b/g, '').trim();
  if (!name || /^(grocery|groceries|shopping|store|supermarket|costco)$/.test(name)) return 'shopping';
  return name.replace(/\s+/g, ' ');
}

/** The list you usually put these things on, if Memoir has seen them before. */
function knownList(items: string[], learned: Learned): string | undefined {
  return items.flatMap((i) => contentWords(i)).map((w) => learned.lists[w]).find(Boolean);
}

/** Something you buy, like "onions" or "green chillies": its last word is a known grocery. */
export function isGrocery(item: string, learned?: Learned): boolean {
  const words = item.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  if (!words.length || words.length > 3) return false;
  const last = stem(words[words.length - 1]);
  return GROCERY_STEMS.has(last) || Boolean(learned?.lists[last]);
}

/**
 * "milk, eggs and bread" as three items. Spoken lists have no commas, so "onions tomatoes and
 * coriander" is split too, when every word is something you would buy.
 */
export function splitItems(text: string, learned?: Learned): string[] {
  return text
    .replace(/[.!]+$/, '')
    .split(/\s*(?:,|;|\band\b|\bplus\b|&|\n)\s*/i)
    .map((s) => s.replace(/^(?:some more|more|some|a few|a couple of|a|an|the|also)\s+/i, '').replace(/\s+(?:please|too|also|again|as well)$/i, '').trim())
    .flatMap((s) => {
      const words = s.split(/\s+/);
      const each = words.length >= 2 && words.length <= 6 && words.every((w) => GROCERY_STEMS.has(stem(w)) || THINGS.has(stem(w)) || Boolean(learned?.lists[stem(w)]));
      return each ? words : [s];
    })
    .filter((s) => s.length > 0 && s.length < 60);
}

function habitFrom(text: string, now: Date, learned: Learned): HabitPlan {
  const lower = text.toLowerCase();
  let days = [0, 1, 2, 3, 4, 5, 6];
  if (/\bweekdays?\b/.test(lower)) days = [1, 2, 3, 4, 5];
  else if (/\bweekends?\b/.test(lower)) days = [0, 6];
  else {
    const named = Object.entries(WEEKDAYS).filter(([day]) => lower.includes(day)).map(([, n]) => n);
    if (named.length) days = named;
  }
  let hour: number | null = null;
  let minute = 0;
  const clock = chrono.parse(text, now).find((r) => r.start.isCertain('hour') && saysClock(r.text));
  if (clock) {
    hour = clock.start.get('hour') ?? null;
    minute = clock.start.get('minute') ?? 0;
  } else {
    // Asked to be reminded but no time said, so your usual morning.
    const word = vagueTimeWord(text) ?? (/\bevery\s?morning\b|\bremind me\b/i.test(text) ? 'morning' : null);
    if (word) [hour, minute] = learned.times[word] ?? DEFAULT_TIMES[word];
  }
  const name = text
    .replace(/^(?:please\s+)?(?:remind me(?: to)?|help me|i want to|i will|i'll|i need to|i should|i must|let me|make sure i)\s+/i, '')
    .replace(HABIT, ' ')
    .replace(/\b(?:at|around|by)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, ' ')
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, ' ')
    .replace(VAGUE, ' ')
    .replace(/\b(?:and|on|in the)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.-]+|[\s,.!?-]+$/g, '');
  return { name: capitalize(name || text), days, hour, minute };
}

/** A real time of day was said ("7pm", "at 6", "noon"), not a length of time like "20 minutes". */
function saysClock(text: string): boolean {
  return /\d\s*(?:am|pm|a\.m|p\.m)|\d:\d{2}|\bat\s+\d|\bnoon\b|\bmidnight\b|\bin\s+(?:an?|\d+|a few|a couple of)\s+(?:min|minute|hour)/i.test(text);
}

/**
 * A plan with a date in it ("tomorrow I have a doctor's appointment at 4"): the day from one part,
 * the hour from another, and a title without the date words or "I have a".
 */
function datedPlan(text: string, now: Date, learned: Learned): { title: string; dueAt: number } | null {
  const results = chrono.parse(text, now, { forwardDate: true });
  const day = results.find((r) => r.start.isCertain('day') || r.start.isCertain('weekday'));
  const hour = results.find((r) => r.start.isCertain('hour') && saysClock(r.text));
  const first = day ?? hour;
  if (!first) return null;
  const date = first.start.date();
  if (hour && hour !== first) date.setHours(hour.start.get('hour') ?? 9, hour.start.get('minute') ?? 0, 0, 0);
  else if (!first.start.isCertain('hour')) date.setHours(9, 0, 0, 0);
  if (date.getTime() <= now.getTime() && !day) date.setDate(date.getDate() + 1);
  const dueAt = clockSense(applyVagueTime(date.getTime(), text, now, learned), text, now)!;

  // "Priya's wedding is on Nov 21 in Tirupati": what comes before the date is the name of it.
  let title = first.index > 0 ? text.slice(0, first.index) : results.reduce((rest, r) => rest.replace(r.text, ' '), text);
  title = title
    .trim()
    .replace(/^(?:i have|i've got|i got|i've|there is|there's|we have|we've got|got|have)\s+(?:a|an|my|the|our)?\s*/i, '')
    // "Dinner tonight with Priya" loses "tonight", but "lunch with Ankit" keeps its lunch.
    .replace(new RegExp(VAGUE.source, 'gi'), (m, _g, at: number) => (at === 0 ? m : ' '))
    .replace(/\b(?:every|each)\s+(?:month|week|year)\b|\b(?:monthly|weekly|yearly|annually)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/(?:\s+(?:is|on|at|by|for|this|next|will be|falls on|happens on|coming))+\s*$/i, '')
    .replace(/^[\s,.-]+|[\s,.!-]+$/g, '');
  return title ? { title: capitalize(title), dueAt } : null;
}

function questionFrom(text: string, now: Date, lists: string[] = []): QuestionPlan {
  const lower = text.toLowerCase().replace(/\bto[\s-]?do(s?)\b/g, 'todo$1');
  const range = rangeOf(lower, now);
  const keywords = contentWords(text).filter((w) => !QUESTION_FILLER.has(w));
  if (/\b(?:what|which|my|all)\s+lists\b|\blists do i have\b/.test(lower)) return { kind: 'lists', text, keywords, ...range };
  if (/\btodos?\b|\btasks?\b|\breminders?\b/.test(lower) && !/\bdid i\b/.test(lower)) return { kind: 'todos', text, keywords, ...range };
  const named = [...lists].sort((a, b) => b.length - a.length).find((l) => new RegExp(`\\b${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower));
  if (named && named !== 'shopping') return { kind: 'list', text, list: named, keywords, ...range };
  if (/\bhow (?:was|were|did) (?:my|the|this|last)\b|\bhow did (?:it|today) go\b/.test(lower)) return { kind: 'diary', text, keywords: [], ...range };
  const listMatch = lower.match(/\b(?:on|in)\s+(?:my|the)\s+([\p{L} ]+?)\s+list\b/u) ?? lower.match(/\b([\p{L}]+)\s+list\b/u);
  if (listMatch) return { kind: 'list', text, list: listName(listMatch[1]), keywords, ...range };
  if (/\b(?:need to|have to|should i|got to|to) (?:buy|get|pick up)\b|\bshopping\b/.test(lower) && !/\bdid i\b/.test(lower)) return { kind: 'list', text, list: 'shopping', keywords, ...range };
  if (/\b(?:need to|have to|should i|to) pack\b/.test(lower)) return { kind: 'list', text, list: 'packing', keywords, ...range };
  if (/\bhow (?:many|often)\b/.test(lower)) return { kind: 'count', text, keywords, ...range };
  if (/\b(?:to-?dos?|tasks?|reminders?|due|my plan|my plans|my day|do i have|have i got|on my plate|agenda|schedule|coming up|pending|what'?s on|what is on|anything on|plans? for)\b/.test(lower) && !/\bdid i\b/.test(lower)) {
    return { kind: 'todos', text, keywords, ...range };
  }
  if (/\b(?:did i|have i|what did i|where did i|who did i|when did i|what have i)\b/.test(lower)) return { kind: 'diary', text, keywords, ...range };
  return { kind: 'fact', text, keywords, ...range };
}

const QUESTION_FILLER = new Set(
  (
    'what when where who whom which how why show tell list find search many often time thing things today yesterday tomorrow week month year last this next day remember note notes diary go going ' +
    'monday tuesday wednesday thursday friday saturday sunday weekend morning evening night tonight afternoon ' +
    'january february march april may june july august september october november december'
  )
    .split(' ')
    .map((w) => stem(w)),
);

function nextMorningOf(now: Date): number {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const DAY = 24 * 60 * 60 * 1000;

/** The stretch of time a question is about: today, yesterday, last week, on Sunday. */
/** Midnight a number of days away. Safe across daylight saving changes. */
function shift(dayStart: number, days: number): number {
  const d = new Date(dayStart);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

export function rangeOf(lower: string, now: Date): { from: number | null; to: number | null } {
  const today = startOfDay(now.getTime());
  // Weeks run Monday to Sunday, the way people plan them.
  const monday = shift(today, -((now.getDay() + 6) % 7));
  if (/\btoday\b|\btonight\b|\bmy day\b/.test(lower)) return { from: today, to: shift(today, 1) };
  if (/\byesterday\b/.test(lower)) return { from: shift(today, -1), to: today };
  if (/\btomorrow\b/.test(lower)) return { from: shift(today, 1), to: shift(today, 2) };
  if (/\bthis week\b|\bmy week\b|\bthe week\b/.test(lower)) return { from: monday, to: shift(monday, 7) };
  if (/\bnext week\b/.test(lower)) return { from: shift(monday, 7), to: shift(monday, 14) };
  if (/\bthis weekend\b|\bthe weekend\b|\bmy weekend\b/.test(lower)) {
    // Early in the week, "my weekend" is the one just gone.
    const past = /\bmy weekend\b|\bhow was\b/.test(lower) && now.getDay() >= 1 && now.getDay() <= 4;
    const saturday = past ? shift(monday, -2) : shift(monday, 5);
    return { from: saturday, to: shift(saturday, 2) };
  }
  if (/\blast week\b/.test(lower)) return { from: shift(monday, -7), to: monday };
  if (/\blast weekend\b/.test(lower)) {
    const saturday = today - ((now.getDay() + 1) % 7) * DAY - (now.getDay() === 6 ? 7 * DAY : 0);
    return { from: saturday, to: saturday + 2 * DAY };
  }
  if (/\bthis month\b/.test(lower)) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return { from: start, to: new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime() };
  }
  if (/\blast month\b/.test(lower)) {
    return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(), to: new Date(now.getFullYear(), now.getMonth(), 1).getTime() };
  }
  const weekday = Object.entries(WEEKDAYS).find(([day]) => new RegExp(`\\b${day}\\b`).test(lower));
  if (weekday) {
    // "on Sunday" in a question about the past means the most recent one.
    const back = (now.getDay() - weekday[1] + 7) % 7 || (/\bdid|was|were|went|had\b/.test(lower) ? 7 : 0);
    const future = /\b(?:do i have|will|going to|due|coming)\b/.test(lower);
    const start = future ? today + (((weekday[1] - now.getDay() + 7) % 7) * DAY) : today - back * DAY;
    return { from: start, to: start + DAY };
  }
  const days = lower.match(/\blast (\d+) days\b/);
  if (days) return { from: today - Number(days[1]) * DAY, to: today + DAY };
  const date = chrono.parse(lower, now).find((r) => r.start.isCertain('day'));
  if (date) {
    const start = startOfDay(date.start.date().getTime());
    return { from: start, to: start + DAY };
  }
  return { from: null, to: null };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Everyday shorthand, spelled out: "pls", "tmrw", "the 1st". */
export function normalize(raw: string, now: Date = new Date()): string {
  let text = raw.trim().replace(/\s+/g, ' ');
  text = text.replace(/^(?:(?:hey|hi|ok|okay)\s+)?memoir[,:]?\s+/i, '').replace(/^(?:pls|plz|please)\s+/i, '');
  // Spoken fillers at the start: "um also potatoes", "so I went to the gym".
  for (let i = 0; i < 3; i++) text = text.replace(/^(?:um+|uh+|uhm+|hmm+|er+|so|ok so|okay so|oh|also|and also|and then|and|like)[,.]?\s+(?=\S)/i, '');
  text = text
    .replace(/\b(?:tmrw|tmrow|tmr|tmw|2mrw|2moro|2morrow)\b/gi, 'tomorrow')
    .replace(/\btonite\b/gi, 'tonight')
    .replace(/\b2day\b/gi, 'today')
    .replace(/\bb4\b/gi, 'before')
    .replace(/\b(?:pls|plz)\b/gi, 'please');
  // Dictation writes "5:30" as "5 30". Put the colon back when it is clearly a time.
  text = text
    .replace(/\b(at|by|around|till|until|from|before|after)\s+(\d{1,2})\s+([0-5]\d)\b/gi, '$1 $2:$3')
    .replace(/\b(\d{1,2})\s+([0-5]\d)\s*(am|pm|a\.m\.|p\.m\.)/gi, '$1:$2 $3');
  // "The 1st of every month" repeats. Said this way round, the date below reads it.
  text = text.replace(/\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\s+of\s+(?:every|each)\s+month\b/i, 'every month on the $1th');
  // "End of the month" is its last day, "end of the week" is Friday.
  text = text.replace(/\b(?:by\s+|at\s+|before\s+|till\s+|until\s+|on\s+)?(?:the\s+)?end\s+of\s+(?:the\s+|this\s+)?(month|week|year|next month)\b/i, (_w, what: string) => {
    const w = what.toLowerCase();
    if (w === 'week') return 'by Friday';
    if (w === 'year') return `by December 31`;
    const ahead = w === 'next month' ? 2 : 1;
    const last = new Date(now.getFullYear(), now.getMonth() + ahead, 0);
    return `by ${MONTHS[last.getMonth()]} ${last.getDate()}`;
  });
  // "Set a reminder for Friday to call the bank" is "remind me to call the bank Friday".
  text = text
    .replace(/^(?:set|create|add|make|put)\s+(?:a\s+|an\s+)?(?:reminder|alarm)\s+(?:for\s+|at\s+|on\s+)?(.+?)\s+to\s+(.+)$/i, 'remind me to $2 $1')
    .replace(/^(?:set|create|add|make)\s+(?:a\s+|an\s+)?(?:reminder|alarm)\s+to\s+/i, 'remind me to ');
  // "on the 1st" is the next 1st, this month or next. "Before the 15th" keeps its "before".
  text = text.replace(/\b(before |by |after |until |till |from )?(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b(?!\s+of\b)/i, (whole, prep: string | undefined, n: string) => {
    const day = Number(n);
    if (day < 1 || day > 31) return whole;
    const month = day > now.getDate() ? now.getMonth() : now.getMonth() + 1;
    return `${prep ?? 'on '}${MONTHS[month % 12]} ${day}`;
  });
  // "Remind me at 5 to leave" and "remind me every Sunday to call grandma": the thing first, then when.
  text = text.replace(
    /^remind me\s+((?:in|at|on|by|around|after|before|every|each|this|next|tomorrow|tonight|today|later|daily|weekly)\b.*?)\s+to\s+(.+)$/i,
    (_whole, when: string, what: string) => `remind me to ${what} ${when}`,
  );
  text = text.replace(/^remind me (?:about|of)\s+/i, 'remind me to ');
  return text;
}

const DAY_WORDS = /\b(?:tomorrow|tmrw|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}(?:st|nd|rd|th)|\d{1,2}\/\d{1,2})/i;

/**
 * "at 6" for a call means 6 in the evening. Early hours with no am or pm move to the afternoon,
 * and "at 5" said at 9 AM is 5 PM today, not 5 AM tomorrow.
 */
export function clockSense(dueAt: number | null, text: string, now?: Date): number | null {
  if (dueAt === null) return null;
  const m = text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b(?!\s*(?:am|pm|a\.m|p\.m))/i);
  if (!m || /\bmorning\b/i.test(text)) return dueAt;
  const hour = Number(m[1]);
  const date = new Date(dueAt);
  if (hour >= 1 && hour <= 7 && date.getHours() === hour) {
    date.setHours(hour + 12);
    const earlier = new Date(date);
    earlier.setDate(earlier.getDate() - 1);
    if (now && earlier.getTime() > now.getTime() && !DAY_WORDS.test(text)) return earlier.getTime();
  }
  return date.getTime();
}

/** Every week, month or year. A birthday repeats only when it is the thing itself, not "a gift for her birthday". */
function repeatOf(text: string, event = false): Repeat | undefined {
  if (/\b(?:every year|each year|yearly|annually)\b/i.test(text)) return 'yearly';
  if (event && EVERY_YEAR.test(text)) return 'yearly';
  if (EVERY_MONTH.test(text)) return 'monthly';
  if (/\b(?:every week|weekly)\b/i.test(text)) return 'weekly';
  return undefined;
}

/** A note in your words, without "note:" or "remember that" in front. */
export function noteText(text: string): string {
  const clean = text.replace(/^(?:note(?: to self)?|memo|fyi|remember(?: that)?|save(?: this)?|keep in mind(?: that)?)\s*[:\-,]?\s+/i, '').trim();
  return clean ? capitalize(clean) : text;
}

/** What the rules say, before anything learned is considered. `manage` is off when working out a fallback. */
function byRules(raw: string, now: Date, learned: Learned, lists: string[], manage = true): Understood {
  const text = normalize(raw, now);
  const sure = (plan: Plan, confidence = 0.95): Understood => ({ plan, confidence, by: 'rules' });
  const otherwise = () => byRules(raw, now, learned, lists, false).plan;

  if (UNDO.test(text)) return sure({ kind: 'undo' });
  const chat = chatReply(text, now);
  if (chat) return sure({ kind: 'chat', reply: chat });

  const known = lists.length ? `(?:my\\s+|the\\s+|our\\s+)?(${[...lists].sort((a, b) => b.length - a.length).map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:\\s+list)?` : null;
  if (manage) {
    if (known) {
      const off = text.match(new RegExp(`^(?:please\\s+)?(?:remove|delete|take|cross|strike)\\s+(.+?)\\s+(?:off|from|out of)\\s+${known}\\s*[.!]*$`, 'i'));
      if (off) return sure({ kind: 'unlist', list: off[2].toLowerCase(), items: splitItems(off[1], learned) });
      const gone = text.match(new RegExp(`^(?:please\\s+)?(?:delete|remove|clear|empty|wipe)\\s+(?:out\\s+)?${known}\\s*[.!]*$`, 'i'));
      if (gone) return sure({ kind: 'unlist', list: gone[1].toLowerCase(), items: [], all: true, drop: /^(?:please\s+)?(?:delete|remove)/i.test(text) });
      const onto = text.match(new RegExp(`^(?:please\\s+)?(?:add|put)\\s+(.+?)\\s+(?:to|on|in(?:to)?)\\s+${known}\\s*[.!]*$`, 'i'));
      if (onto) return sure({ kind: 'list', list: onto[2].toLowerCase(), items: splitItems(onto[1], learned) });
    }
    const create = text.match(/^(?:please\s+)?(?:create|make|start|begin|new)\s+(?:a\s+|an\s+|my\s+)?(?:new\s+)?(?:list\s+(?:called|named|for)\s+(.+?)|(.+?)\s+list)\s*[.!]*$/i);
    if (create) return sure({ kind: 'list', list: listName(create[1] ?? create[2]), items: [] });
    const fromNamed = text.match(REMOVE_FROM_NAMED);
    if (fromNamed) return sure({ kind: 'unlist', list: listName(fromNamed[2]), items: splitItems(fromNamed[1]) });
    const fromList = text.match(REMOVE_FROM_LIST);
    if (fromList) return sure({ kind: 'unlist', list: listName(fromList[2]), items: splitItems(fromList[1]) });
    const clear = text.match(CLEAR_LIST);
    if (clear) return sure({ kind: 'unlist', list: listName(clear[1]), items: [], all: true, drop: /^(?:please\s+)?(?:delete|remove)/i.test(text) });
    const mark = text.match(MARK_DONE) ?? text.match(DONE_COLON);
    if (mark) return sure({ kind: 'done', text, target: mark[1], fallback: otherwise() });
    const stop = text.match(STOP_HABIT);
    if (stop) return sure({ kind: 'cancel', target: stop[1] ?? stop[2], habit: true, fallback: otherwise() });
    const cancel = text.match(CANCEL_NAMED) ?? text.match(CANCEL);
    if (cancel) {
      // "Delete the dentist reminder" that matches nothing says so. "Remove the stain from my shirt"
      // is simply something to do.
      const explicit = CANCEL_NAMED.test(text) || /\b(?:reminders?|to-?dos?|tasks?|habits?|alarms?|events?)\b|^(?:please\s+)?(?:don'?t|no need to) remind/i.test(text);
      const fallback: Plan = explicit ? { kind: 'note', text } : asKind(raw, 'todo', now, learned);
      return sure({ kind: 'cancel', target: cancel[1], habit: /\bhabit\b/i.test(text), fallback });
    }
    const move = text.match(MOVE);
    if (move) {
      // "Move it to 6" means 6 o'clock.
      const when = /^\d{1,2}(?::\d{2})?\s*(?:am|pm)?$/i.test(move[2].trim()) ? `at ${move[2].trim()}` : move[2];
      if (chrono.parse(when, now).length || vagueTimeWord(when)) return sure({ kind: 'move', target: move[1], when, fallback: otherwise() });
    }
  }

  if (/\?\s*$/.test(text) || QUESTION_START.test(text)) return sure({ kind: 'question', question: questionFrom(text, now, lists) });

  if (HABIT.test(text) && !/\b(?:yesterday|last)\b/i.test(text) && !/\bweekly\b/i.test(text)) return sure({ kind: 'habit', habit: habitFrom(text, now, learned) });

  const named = text.match(LIST_ADD_NAMED);
  if (named) return sure({ kind: 'list', list: listName(named[2]), items: splitItems(named[1], learned) });
  const listAdd = text.match(LIST_ADD);
  if (listAdd) return sure({ kind: 'list', list: listName(listAdd[2]), items: splitItems(listAdd[1], learned) });
  // "Packing list for the India trip, passport, charger and gifts": the list, then its things.
  const listFor = text.match(/^((?:shopping|grocery|groceries|packing|to buy)|[\p{L} ]{3,30}?)\s+list\s+(?:for\s+(?:the\s+|my\s+|our\s+)?[\p{L} ]+?\s+(?:trip|vacation|holiday|wedding|visit|party|travel)\s*[:,\-]?\s*)?[:,\-]?\s*(.+)$/iu);
  if (listFor && (/^(?:shopping|grocery|groceries|packing|to buy)$/i.test(listFor[1]) || lists.includes(listFor[1].toLowerCase()))) {
    return sure({ kind: 'list', list: listName(listFor[1]), items: splitItems(listFor[2], learned) });
  }
  const listColon = text.match(LIST_COLON);
  if (listColon && /(?:list|shopping|groceries|grocery|packing|to buy)/i.test(listColon[1])) {
    return sure({ kind: 'list', list: listName(listColon[1].replace(/\s*list\s*$/i, '')), items: splitItems(listColon[2]) });
  }

  if (EVENT.test(text) && !/\b(?:remind me|need to|have to)\b/i.test(text)) {
    const dated = datedPlan(text, now, learned);
    if (dated) return sure({ kind: 'event', title: dated.title, dueAt: dated.dueAt, repeat: repeatOf(text, true) });
  }

  // A bare "milk", "green chillies", or "add eggs and butter": things to buy.
  const bare = text.replace(/^(?:please\s+)?(?:add|need|we need|i need|need to buy|buy|get|grab|pick up|out of|we're out of|running low on)\s+/i, '');
  if (bare.replace(/[.!]+$/, '').split(/\s+/).length <= 7) {
    const items = splitItems(bare, learned);
    // "Bought milk" or "cook rice" is something you did or will do, not a thing to buy.
    const doing = /^(?:i\s+)?(?:call|cook|make|made|eat|ate|drink|drank|bought|got|order|ordered|pick|picked|return|returned|fix|clean|cleaned|wash|washed|boil|fry|bake|baked|prepare|finish|finished|had|have|use|used|try|tried|want|love|hate|like|throw|threw|take|took|bring|brought|found|lost)\b/i;
    if (items.length > 0 && !PAST_START.test(bare) && items.every((i) => isGrocery(i, learned) && !doing.test(i))) {
      return sure({ kind: 'list', list: knownList(items, learned) ?? 'shopping', items }, 0.9);
    }
  }

  const buy = text.match(BUY);
  const hasDate = chrono.parse(text, now, { forwardDate: true }).length > 0 || Boolean(vagueTimeWord(text));
  if (buy && !hasDate && buy[1].split(/\s+/).length <= 8) {
    const items = splitItems(buy[1], learned);
    const known = knownList(items, learned);
    return sure({ kind: 'list', list: known ?? 'shopping', items }, 0.9);
  }

  if (DONE_LEAD.test(text) || DONE_TAIL.test(text)) return sure({ kind: 'done', text }, 0.85);

  const todo = detectTodo(text.replace(/\b(?:every month|each month|monthly|every year|yearly|annually|every week|weekly)\b/gi, ' '), now);
  if (todo) {
    const dueAt = clockSense(applyVagueTime(todo.dueAt, text, now, learned), text, now);
    const repeat = repeatOf(text);
    return sure({ kind: 'todo', title: todo.title, dueAt: dueAt ?? (repeat ? nextMorningOf(now) : null), repeat }, /\bremind me\b|\bneed to\b|\bhave to\b/i.test(text) ? 0.97 : 0.85);
  }

  const pastish = PAST.test(text) || DIARY_CUE.test(text) || PAST_START.test(text) || (PAST_TIME.test(text) && !FUTURE_WORDS.test(text));
  // Anything else with a time still to come ("meeting with Ravi on Friday at 3pm") is a plan to be reminded of.
  if (!pastish) {
    const dated = datedPlan(text, now, learned);
    if (dated && dated.dueAt > now.getTime()) return sure({ kind: 'event', title: dated.title, dueAt: dated.dueAt, repeat: repeatOf(text, true) }, 0.9);
  }

  if (pastish) {
    const day = /^\s*(?:yesterday|last night)\b/i.test(text) ? shift(startOfDay(now.getTime()), -1) : startOfDay(now.getTime());
    return { plan: { kind: 'diary', text, day }, confidence: DIARY_CUE.test(text) || PAST_START.test(text) ? 0.9 : 0.75, by: 'rules' };
  }

  return { plan: { kind: 'note', text: noteText(text) }, confidence: 0.5, by: 'rules' };
}

// ------------------------------------------------------------ the learned layer

/** How likely each correctable kind is for these words, from what you taught it. Naive Bayes. */
export function learnedGuess(text: string, learned: Learned): { kind: Correctable; p: number } | null {
  const total = CORRECTABLE.reduce((sum, k) => sum + (learned.examples[k] ?? 0), 0);
  if (total < 3) return null;
  const words = contentWords(text);
  const scores = CORRECTABLE.map((kind) => {
    const counts = learned.words[kind] ?? {};
    const size = Object.values(counts).reduce((a, b) => a + b, 0);
    const vocab = Object.keys(counts).length + 50;
    let logp = Math.log(((learned.examples[kind] ?? 0) + 1) / (total + CORRECTABLE.length));
    for (const w of words) logp += Math.log(((counts[w] ?? 0) + 1) / (size + vocab));
    return { kind, logp };
  });
  const best = Math.max(...scores.map((s) => s.logp));
  const sum = scores.reduce((acc, s) => acc + Math.exp(s.logp - best), 0);
  const top = scores.find((s) => s.logp === best)!;
  return { kind: top.kind, p: 1 / sum };
}

/** Records that this sentence was this kind, so similar ones go there next time. */
export function learn(learned: Learned, text: string, kind: Correctable, weight = 1): Learned {
  const words = { ...(learned.words[kind] ?? {}) };
  for (const w of new Set(contentWords(text))) words[w] = (words[w] ?? 0) + weight;
  return {
    ...learned,
    words: { ...learned.words, [kind]: words },
    examples: { ...learned.examples, [kind]: (learned.examples[kind] ?? 0) + weight },
  };
}

/** Remembers which list things go on, so "buy milk" lands on the list you use for milk. */
export function learnList(learned: Learned, items: string[], list: string): Learned {
  const lists = { ...learned.lists };
  for (const item of items) for (const w of contentWords(item)) lists[w] = list;
  return { ...learned, lists };
}

/** Remembers what you mean by "evening" when you move a reminder you set with that word. */
export function learnTime(learned: Learned, word: string, hour: number, minute: number): Learned {
  return { ...learned, times: { ...learned.times, [word]: [hour, minute] } };
}

/** Turns a plan into another kind, when you tap "it was a to-do" or "it was my diary". */
export function asKind(raw: string, kind: Correctable, now: Date, learned: Learned): Plan {
  const text = normalize(raw, now);
  if (kind === 'todo') {
    const plain = text.replace(/\b(?:every month|each month|monthly|every year|yearly|annually|every week|weekly)\b/gi, ' ');
    const todo = detectTodo(plain, now) ?? detectTodo(`remind me to ${plain}`, now);
    const dueAt = clockSense(applyVagueTime(todo?.dueAt ?? null, text, now, learned), text, now);
    const repeat = repeatOf(text);
    return { kind: 'todo', title: todo?.title ?? capitalize(text.replace(/[.!]+$/, '')), dueAt: dueAt ?? (repeat ? nextMorningOf(now) : null), repeat };
  }
  if (kind === 'diary') return { kind: 'diary', text, day: startOfDay(now.getTime()) };
  if (kind === 'list') {
    const buy = text.match(BUY);
    const items = splitItems(buy ? buy[1] : text, learned);
    return { kind: 'list', list: knownList(items, learned) ?? 'shopping', items };
  }
  return { kind: 'note', text: noteText(text) };
}

/** A habit from what you typed in the Habits box, even without "every day" in it. */
export function asHabit(raw: string, now: Date, learned: Learned): HabitPlan {
  return habitFrom(normalize(raw, now), now, learned);
}

// ------------------------------------------------------------ putting it together

const KIND_OF: Partial<Record<Kind, Correctable>> = { todo: 'todo', diary: 'diary', note: 'note', list: 'list' };

/**
 * What you meant. Rules decide when they are sure. When they are not (a plain sentence that could
 * be a note, a diary line or a to-do), what Memoir learned from you gets the final say.
 */
/** `lists` are the names of lists you already have, like "movies to watch". */
export function understand(raw: string, now: Date = new Date(), learned: Learned = emptyLearned(), lists: string[] = []): Understood {
  const rules = byRules(raw, now, learned, lists);
  const current = KIND_OF[rules.plan.kind];
  if (!current || rules.confidence >= 0.9) return rules;
  const guess = learnedGuess(raw, learned);
  // Only what you taught it can move a sentence, and only to a list when it is short like a list item.
  const words = contentWords(raw);
  const evidence = guess ? words.filter((w) => (learned.words[guess.kind]?.[w] ?? 0) >= 1).length : 0;
  const fits = guess && (guess.kind !== 'list' || raw.trim().split(/\s+/).length <= 5);
  if (guess && fits && evidence > 0 && guess.kind !== current && guess.p >= 0.7) {
    return { plan: asKind(raw, guess.kind, now, learned), confidence: guess.p, by: 'learned' };
  }
  return rules;
}
