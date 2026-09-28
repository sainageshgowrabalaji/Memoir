// Fetches a saved link's page and reads what it is about, using the parsers in brain/pages.ts.
// It only runs when the phone is online, and a link that can't be read yet is tried again later.
// Nothing about you is sent. It is the same request a chat app makes to draw a link preview.

import type { Source } from '../brain/links';
import {
  fromInstagramEmbed,
  fromInstagramMeta,
  fromMeta,
  fromOEmbed,
  instagramEmbedUrl,
  mergePages,
  readMeta,
  type PageInfo,
} from '../brain/pages';

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** No site answered at all, so the phone is probably offline. Try again later, nothing is lost. */
export class OfflineError extends Error {
  constructor() {
    super('No connection');
    this.name = 'OfflineError';
  }
}

type Reading = { fetcher: Fetcher; answered: boolean };

// Sites that only show their preview tags to link-preview bots get the bot's name.
const PREVIEW_BOT = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const PHONE_BROWSER =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const TIMEOUT_MS = 12_000;

async function get(reading: Reading, url: string, userAgent: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await reading.fetcher(url, {
      headers: { 'User-Agent': userAgent, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'en' },
      signal: controller.signal,
    });
    reading.answered = true;
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(reading: Reading, url: string): Promise<unknown> {
  const body = await get(reading, url, PHONE_BROWSER);
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

async function readInstagram(fetcher: Reading, url: string): Promise<PageInfo | null> {
  const html = await get(fetcher, url, PREVIEW_BOT);
  const fromTags = html ? fromInstagramMeta(readMeta(html)) : null;
  if (fromTags?.text && fromTags.image) return fromTags;
  // No caption in the tags (or a login page), so try the public embed page.
  const embedUrl = instagramEmbedUrl(url);
  const embedHtml = embedUrl ? await get(fetcher, embedUrl, PHONE_BROWSER) : null;
  return mergePages(fromTags, embedHtml ? fromInstagramEmbed(embedHtml) : null);
}

async function readYouTube(fetcher: Reading, url: string): Promise<PageInfo | null> {
  const oembed = fromOEmbed(await getJson(fetcher, `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`));
  // The watch page adds the description, which often has the useful part (a recipe, links, steps).
  const html = await get(fetcher, url, PREVIEW_BOT);
  const tags = html ? fromMeta(readMeta(html)) : null;
  const description = tags?.text && !/^enjoy the videos and music you love/i.test(tags.text) ? tags.text : '';
  if (!oembed) return tags;
  return { ...oembed, text: oembed.text || description };
}

async function readTikTok(fetcher: Reading, url: string): Promise<PageInfo | null> {
  return fromOEmbed(await getJson(fetcher, `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`), true);
}

async function readAny(fetcher: Reading, url: string, source: Source): Promise<PageInfo | null> {
  const bot = source === 'x' || source === 'facebook' || source === 'linkedin';
  const html = await get(fetcher, url, bot ? PREVIEW_BOT : PHONE_BROWSER);
  return html ? fromMeta(readMeta(html)) : null;
}

/**
 * What a link's page says it is about, or null when the site answered but said nothing useful.
 * Throws OfflineError when no site answered at all.
 */
// Wrapped, because calling the browser's fetch as a method of another object throws "Illegal invocation".
const defaultFetch: Fetcher = (url, init) => fetch(url, init);

export async function readPage(url: string, source: Source, fetcher: Fetcher = defaultFetch): Promise<PageInfo | null> {
  const reading: Reading = { fetcher, answered: false };
  let page: PageInfo | null;
  switch (source) {
    case 'instagram':
      page = await readInstagram(reading, url);
      break;
    case 'youtube':
      page = await readYouTube(reading, url);
      break;
    case 'tiktok':
      page = await readTikTok(reading, url);
      break;
    default:
      page = await readAny(reading, url, source);
  }
  if (!page && !reading.answered) throw new OfflineError();
  return page;
}
