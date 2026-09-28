// Reading old saves out of other apps' exports, so everything you sent to your own WhatsApp
// chat or saved on Instagram comes into Memoir. Plain text in, a list of links out. No phone code.
//
//   WhatsApp   Chat → Export Chat gives a text file (inside a .zip on iPhone), one message per line:
//              [9/28/26, 7:08:12 PM] Sai: https://www.instagram.com/reel/C4abc/ try this
//              9/28/26, 7:08 PM - Sai: https://youtu.be/abc          (Android)
//   Instagram  Settings → Your activity → Download your information gives saved_posts.json
//              (or .html), with every saved post's link and when you saved it.

import { findUrls, sameLinkKey } from './links';

export type ImportedLink = {
  url: string;
  /** When it was saved or sent, if the export says. */
  at: number | null;
  /** The words sent along with the link, like "try this". */
  note: string;
  /** Who posted it, when the export says (Instagram does). */
  author: string;
};

// ------------------------------------------------------------ WhatsApp

const WA_LINE =
  /^[‎‏\s]*\[?(\d{1,4})[/.-](\d{1,2})[/.-](\d{2,4}),?\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([AaPp]\.?\s?[Mm]\.?)?\]?\s*(?:-\s)?([^:]{1,60}?):\s?(.*)$/;

const SKIP = /(image|video|audio|sticker|gif|document) omitted|<attached:|<media omitted>|this message was deleted|messages and calls are end-to-end encrypted/i;

type Message = { a: number; b: number; year: number; hour: number; minute: number; second: number; ampm: string; text: string };

/** Every link in a WhatsApp chat export, with the time it was sent and the words around it. */
export function parseWhatsApp(chat: string): ImportedLink[] {
  const messages: Message[] = [];
  for (const raw of chat.split(/\r?\n/)) {
    const m = raw.match(WA_LINE);
    if (m) {
      messages.push({
        a: Number(m[1]),
        b: Number(m[2]),
        year: Number(m[3]),
        hour: Number(m[4]),
        minute: Number(m[5]),
        second: Number(m[6] ?? 0),
        ampm: (m[7] ?? '').toLowerCase().replace(/[.\s]/g, ''),
        text: m[9],
      });
    } else if (messages.length && raw.trim()) {
      // A message that runs over several lines.
      messages[messages.length - 1].text += `\n${raw}`;
    }
  }
  // 3/4/26 is March 4 in the US and 3 April elsewhere. A day above 12 settles it for the whole chat.
  const dayFirst = messages.some((msg) => msg.a > 12) && !messages.some((msg) => msg.b > 12);
  const yearFirst = messages.some((msg) => msg.a > 999);

  const links: ImportedLink[] = [];
  for (const msg of messages) {
    if (SKIP.test(msg.text)) continue;
    const urls = findUrls(msg.text);
    if (!urls.length) continue;
    let hour = msg.hour % 12;
    if (msg.ampm === 'pm') hour += 12;
    if (!msg.ampm) hour = msg.hour;
    const [month, day] = yearFirst ? [msg.b, msg.year] : dayFirst ? [msg.b, msg.a] : [msg.a, msg.b];
    const year = yearFirst ? msg.a : msg.year < 100 ? 2000 + msg.year : msg.year;
    const at = new Date(year, month - 1, day, hour, msg.minute, msg.second).getTime();
    const note = urls.reduce((rest, u) => rest.replace(u, ' '), msg.text).replace(/\s+/g, ' ').trim();
    for (const url of urls) links.push({ url, at: Number.isFinite(at) ? at : null, note, author: '' });
  }
  return links;
}

export function looksLikeWhatsApp(text: string): boolean {
  const lines = text.split(/\r?\n/, 40);
  return lines.filter((l) => WA_LINE.test(l)).length >= Math.min(3, lines.filter(Boolean).length);
}

// ------------------------------------------------------------ Instagram

const INSTAGRAM_POST = /https?:\/\/(?:www\.)?instagram\.com\/(?:[\w.]+\/)?(?:p|reel|reels|tv)\/[\w-]+\/?/i;

/**
 * Saved posts from Instagram's own export, in either of its formats. The JSON has, for each
 * saved post, its link and a timestamp (seconds). The structure has changed over the years, so
 * this looks for any link to a post and the timestamp and account name kept next to it.
 */
export function parseInstagramSaved(fileText: string): ImportedLink[] {
  const trimmed = fileText.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const links: ImportedLink[] = [];
      walk(JSON.parse(trimmed), links, '');
      return links;
    } catch {
      // Not JSON after all. Read it as HTML below.
    }
  }
  const links: ImportedLink[] = [];
  for (const m of fileText.matchAll(/href="([^"]+)"/gi)) {
    const url = m[1].replace(/&amp;/g, '&');
    if (INSTAGRAM_POST.test(url)) links.push({ url, at: null, note: '', author: '' });
  }
  return links;
}

function walk(node: unknown, out: ImportedLink[], author: string) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out, author);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  const name = typeof obj.title === 'string' && obj.title ? obj.title : author;
  const href = typeof obj.href === 'string' ? obj.href : typeof obj.value === 'string' && INSTAGRAM_POST.test(obj.value) ? obj.value : null;
  if (href && INSTAGRAM_POST.test(href)) {
    const seconds = typeof obj.timestamp === 'number' ? obj.timestamp : null;
    out.push({ url: href, at: seconds ? seconds * 1000 : null, note: '', author: name ? `@${name.replace(/^@/, '')}` : '' });
  }
  for (const [key, value] of Object.entries(obj)) {
    if (key !== 'href' && typeof value === 'object') walk(value, out, name);
  }
}

// ------------------------------------------------------------ any file

/** Links from whichever export this is, newest first, each link once. */
export function linksFromExport(fileText: string, fileName = ''): ImportedLink[] {
  const found = looksLikeWhatsApp(fileText)
    ? parseWhatsApp(fileText)
    : /saved|instagram/i.test(fileName) || INSTAGRAM_POST.test(fileText)
      ? parseInstagramSaved(fileText)
      : findUrls(fileText).map((url) => ({ url, at: null, note: '', author: '' }));
  const seen = new Set<string>();
  return found
    .sort((x, y) => (y.at ?? 0) - (x.at ?? 0))
    .filter((link) => {
      const key = sameLinkKey(link.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
