// What Memoir works out about each thing you save, in one call.
// Kind, source, shelf, personal or public, people, tags, and a to-do if there is one.

import { guessCategory, type CategoryId } from './categories';
import { findPeople } from './people';
import { capitalize, findUrls, linkTitle, sourceOf, SOCIAL, type Source } from './links';
import { detectTodo, type TodoGuess } from './todo';

export type Kind = 'note' | 'link' | 'photo';
export type Scope = 'personal' | 'public';

export type Capture = { text: string; photoUri?: string | null };

export type Analysis = {
  kind: Kind;
  title: string;
  text: string;
  url: string | null;
  source: Source;
  category: CategoryId;
  scope: Scope;
  people: string[];
  tags: string[];
  todo: TodoGuess | null;
};

const PUBLIC_WORDS = /\b(reel|reels|post|video|article|tweet|thread|blog|news|podcast|channel|website|page)\b/i;
const MAX_TITLE = 80;

function firstLine(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return capitalize(line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1).trimEnd()}…` : line);
}

export function analyze(capture: Capture, now: Date = new Date()): Analysis {
  const text = capture.text.trim();
  const urls = findUrls(text);
  const url = urls[0] ?? null;
  const photo = Boolean(capture.photoUri);
  const kind: Kind = photo ? 'photo' : url ? 'link' : 'note';
  const source: Source = photo ? 'photo' : url ? sourceOf(url) : 'me';

  // Words outside the link decide the shelf. The link's own letters are mostly noise.
  const words = urls.reduce((rest, u) => rest.replace(u, ' '), text);
  const guess = guessCategory(`${words} ${url ? linkTitle(url) : ''}`, source);
  const people = findPeople(words);
  const todo = detectTodo(words, now);

  const scope: Scope =
    photo || source === 'whatsapp'
      ? 'personal'
      : url || PUBLIC_WORDS.test(words) || SOCIAL.has(source)
        ? 'public'
        : 'personal';

  const hashtags = [...words.matchAll(/#([\p{L}\p{N}_]{2,30})/gu)].map((m) => m[1].toLowerCase());
  const tags = [...new Set([...hashtags, ...guess.hits])].slice(0, 6);

  const onlyLink = url !== null && words.trim().length === 0;
  const title = todo?.title ?? (onlyLink ? linkTitle(url) : firstLine(words) || (url ? linkTitle(url) : photo ? 'Photo' : 'Note'));

  return {
    kind,
    title,
    text,
    url,
    source,
    // A note with a person in it and no stronger signal belongs with People.
    category: guess.id === 'notes' && people.length ? 'people' : guess.id,
    scope,
    people,
    tags,
    todo,
  };
}
