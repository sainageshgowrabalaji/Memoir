// Reading what a saved link is about, from the page's own HTML. No network code here, so it is
// tested on its own. src/lib/link-reader.ts does the fetching and hands the HTML to these.
//
// Instagram hides most pages behind a login, but it still tells link-preview bots (the ones that
// draw the card when you paste a link in a chat) the reel's author, caption and thumbnail. When
// even that is missing, its public embed page (the one websites use to show a post) carries them.
// YouTube and TikTok answer a small JSON request ("oEmbed") with the title and author. Every other
// site gets the standard preview tags (Open Graph) or, failing that, the page title.

export type PageInfo = {
  /** A headline for the page. For a reel, empty, because a reel has a caption instead. */
  title: string;
  /** The caption of a reel or post, or the page's description. Exactly as written. */
  text: string;
  /** Who posted it, like "@nomadic.eats" or a channel name. */
  author: string;
  /** A picture for the card, when the page offers one. */
  image: string | null;
  /** When the post went up, if the page says, like "March 3, 2024". */
  postedOn: string;
};

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '-',
  ndash: '-',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? decodeEntities(m[2] ?? m[3] ?? '') : null;
}

/** Every <meta> tag's value by its property or name, lowercased, plus the page's <title>. */
export function readMeta(html: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const head = html.slice(0, 400_000);
  for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(tag, 'property') ?? attr(tag, 'name') ?? attr(tag, 'itemprop'))?.toLowerCase();
    const content = attr(tag, 'content');
    if (key && content !== null && !(key in meta)) meta[key] = content.trim();
  }
  const title = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) meta['html:title'] = decodeEntities(title[1]).replace(/\s+/g, ' ').trim();
  return meta;
}

// ------------------------------------------------------------ Instagram

const INSTAGRAM_PATH = /instagram\.com\/(?:[\w.]+\/)?(p|reel|reels|tv)\/([\w-]+)/i;

/** The public embed page for a post or reel, or null when the link is not a post. */
export function instagramEmbedUrl(url: string): string | null {
  const m = url.match(INSTAGRAM_PATH);
  if (!m) return null;
  const kind = m[1].toLowerCase() === 'reels' ? 'reel' : m[1].toLowerCase();
  return `https://www.instagram.com/${kind}/${m[2]}/embed/captioned/`;
}

export function isInstagramPost(url: string): boolean {
  return INSTAGRAM_PATH.test(url);
}

const GENERIC_TITLES = /^(instagram|login\s*•\s*instagram|instagram photos and videos|log in|page not found)$/i;

/**
 * The caption and author from Instagram's preview tags. They look like
 *   og:title        nomadic.eats on Instagram: "Best dosa in Jersey City..."
 *   og:description  1,204 likes, 38 comments - nomadic.eats on March 3, 2024: "Best dosa in...".
 * Returns null for the login page, which carries no post at all.
 */
export function fromInstagramMeta(meta: Record<string, string>): PageInfo | null {
  const ogTitle = meta['og:title'] ?? meta['twitter:title'] ?? '';
  const ogDescription = meta['og:description'] ?? meta['description'] ?? '';
  const image = meta['og:image'] ?? meta['twitter:image'] ?? null;
  if ((!ogTitle || GENERIC_TITLES.test(ogTitle)) && !image && !/: ["“]/.test(ogDescription)) return null;

  const caption = quotedCaption(ogDescription) || quotedCaption(ogTitle);
  const author =
    ogDescription.match(/-\s+([\w.]+)\s+on\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}/)?.[1] ??
    ogTitle.match(/\(@([\w.]+)\)/)?.[1] ??
    ogTitle.match(/^@?([\w.]+)\s+on Instagram/i)?.[1] ??
    ogDescription.match(/\(@([\w.]+)\)/)?.[1] ??
    '';
  const postedOn = ogDescription.match(/\bon\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/)?.[1] ?? '';
  if (!caption && !author && !image) return null;
  return { title: '', text: caption, author: author ? `@${author}` : '', image, postedOn };
}

/** The text between the first `: "` and the last quote, which is how Instagram wraps a caption. */
function quotedCaption(text: string): string {
  const start = text.search(/: ["“]/);
  if (start < 0) return '';
  const body = text.slice(start + 3);
  const end = Math.max(body.lastIndexOf('"'), body.lastIndexOf('”'));
  return (end > 0 ? body.slice(0, end) : body).trim();
}

/** The caption, author and picture from Instagram's public embed page. */
export function fromInstagramEmbed(html: string): PageInfo | null {
  const author = html.match(/class="UsernameText"[^>]*>([^<]+)</)?.[1]?.trim() ?? '';

  let caption = '';
  const open = html.search(/<div[^>]*class="Caption"[^>]*>/);
  if (open >= 0) {
    const from = html.indexOf('>', open) + 1;
    const comments = html.indexOf('class="CaptionComments"', from);
    let body = html.slice(from, comments > 0 ? comments : html.indexOf('</div>', from));
    body = body.replace(/<a[^>]*class="CaptionUsername"[^>]*>[\s\S]*?<\/a>/, '');
    body = body.replace(/<div[^>]*$/, '');
    caption = cleanHtmlText(body);
  }

  const imgTag = html.match(/<img[^>]*class="EmbeddedMediaImage"[^>]*>/)?.[0];
  const image = imgTag ? attr(imgTag, 'src') : null;
  if (!caption && !author && !image) return null;
  return { title: '', text: caption, author: author ? `@${author.replace(/^@/, '')}` : '', image, postedOn: '' };
}

function cleanHtmlText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ------------------------------------------------------------ YouTube, TikTok and everyone else

/** The oEmbed answer from YouTube or TikTok. For TikTok, the "title" is the caption. */
export function fromOEmbed(json: unknown, captionIsTitle = false): PageInfo | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  const author = typeof o.author_name === 'string' ? o.author_name.trim() : '';
  const image = typeof o.thumbnail_url === 'string' ? o.thumbnail_url : null;
  if (!title && !author) return null;
  return captionIsTitle
    ? { title: '', text: title, author: author ? `@${author.replace(/^@/, '')}` : '', image, postedOn: '' }
    : { title, text: '', author, image, postedOn: '' };
}

/** Any page's own preview tags, or its title when it has none. */
export function fromMeta(meta: Record<string, string>): PageInfo | null {
  const title = meta['og:title'] ?? meta['twitter:title'] ?? meta['html:title'] ?? '';
  const text = meta['og:description'] ?? meta['twitter:description'] ?? meta['description'] ?? '';
  const author = meta['author'] ?? meta['article:author'] ?? meta['og:site_name'] ?? '';
  const image = meta['og:image'] ?? meta['twitter:image'] ?? meta['twitter:image:src'] ?? null;
  if (!title && !text) return null;
  return { title, text, author: /^https?:/.test(author) ? '' : author, image, postedOn: '' };
}

/** Joins what two sources said, keeping the first answer for each part. */
export function mergePages(first: PageInfo | null, second: PageInfo | null): PageInfo | null {
  if (!first) return second;
  if (!second) return first;
  return {
    title: first.title || second.title,
    text: first.text || second.text,
    author: first.author || second.author,
    image: first.image ?? second.image,
    postedOn: first.postedOn || second.postedOn,
  };
}

// ------------------------------------------------------------ using it

const MAX_TITLE = 90;

/**
 * A title for an item you saved as just a link: the video's title, or a reel's first line.
 * Hashtags and @mentions at the end of a caption are left out.
 */
export function pageHeadline(page: PageInfo): string {
  if (page.title) return shorten(page.title);
  const firstLine =
    page.text
      .split('\n')
      .map((l) => l.replace(/(^|\s)[#@][\w.]+/g, ' ').replace(/\s+/g, ' ').trim())
      .find((l) => l.length > 2) ?? '';
  if (firstLine) return shorten(firstLine);
  return page.author ? `A post by ${page.author}` : '';
}

function shorten(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= MAX_TITLE) return clean;
  const cut = clean.slice(0, MAX_TITLE - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 50 ? cut.slice(0, space) : cut).replace(/[\s,.;:!-]+$/, '')}…`;
}

/** Hashtags from a caption, lowercased, as extra tags. */
export function hashtagsOf(text: string): string[] {
  return [...new Set([...text.matchAll(/#([\p{L}\p{N}_]{2,30})/gu)].map((m) => m[1].toLowerCase()))];
}
