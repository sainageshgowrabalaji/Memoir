// Finding links in what you save, and naming where they came from.
// Everything here runs on the phone with no network. It only reads the text of the link.

export type Source =
  | 'me'
  | 'photo'
  | 'instagram'
  | 'youtube'
  | 'tiktok'
  | 'x'
  | 'facebook'
  | 'reddit'
  | 'linkedin'
  | 'whatsapp'
  | 'maps'
  | 'shopping'
  | 'code'
  | 'web';

export const SOURCE_LABELS: Record<Source, string> = {
  me: 'You',
  photo: 'Photo',
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  x: 'X',
  facebook: 'Facebook',
  reddit: 'Reddit',
  linkedin: 'LinkedIn',
  whatsapp: 'WhatsApp',
  maps: 'Maps',
  shopping: 'Shop',
  code: 'Code',
  web: 'Web',
};

/** Sources that are social media, which makes an item public rather than personal. */
export const SOCIAL: ReadonlySet<Source> = new Set(['instagram', 'youtube', 'tiktok', 'x', 'facebook', 'reddit', 'linkedin']);

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;

export function findUrls(text: string): string[] {
  const found = text.match(URL_PATTERN) ?? [];
  return found.map((raw) => {
    const trimmed = raw.replace(/[).,;:!?'"\]]+$/, '');
    return trimmed.toLowerCase().startsWith('www.') ? `https://${trimmed}` : trimmed;
  });
}

export function domainOf(url: string): string {
  const match = url.match(/^[a-z]+:\/\/([^/?#:]+)/i);
  return (match ? match[1] : url).toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
}

// Share links carry tracking bits ("?igsh=...", "?si=...", "utm_source=...") that change every
// time you share, so the same reel would look like a new link. These are dropped before comparing.
const TRACKING = /^(igsh|igshid|si|feature|fbclid|gclid|ref|ref_src|s|t|utm_[a-z]+|share_id|mibextid)$/i;

/** The same link written the same way, so a reel you already saved is recognized. */
export function sameLinkKey(url: string): string {
  const m = url.match(/^([a-z]+):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?/i);
  if (!m) return url.trim().toLowerCase();
  const host = m[2].toLowerCase().replace(/^(www|m)\./, '');
  let path = m[3].replace(/\/+$/, '');
  // Instagram reels and posts have many addresses for one post.
  const insta = path.match(/\/(?:p|reel|reels|tv)\/([\w-]+)/i);
  if (host.endsWith('instagram.com') && insta) return `instagram.com/p/${insta[1]}`;
  const params = (m[4] ?? '')
    .slice(1)
    .split('&')
    .filter((kv) => kv && !TRACKING.test(kv.split('=')[0]))
    .sort();
  if (host === 'youtu.be') {
    return `youtube.com/watch?v=${path.slice(1)}`;
  }
  if (host.endsWith('youtube.com') && path.startsWith('/shorts/')) {
    return `youtube.com/watch?v=${path.slice('/shorts/'.length)}`;
  }
  path = path || '/';
  return `${host}${path}${params.length ? `?${params.join('&')}` : ''}`;
}

const DOMAIN_SOURCES: [RegExp, Source][] = [
  [/(^|\.)instagram\.com$|(^|\.)instagr\.am$/, 'instagram'],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, 'youtube'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)(x|twitter)\.com$/, 'x'],
  [/(^|\.)(facebook|fb)\.com$|(^|\.)fb\.watch$/, 'facebook'],
  [/(^|\.)reddit\.com$|(^|\.)redd\.it$/, 'reddit'],
  [/(^|\.)linkedin\.com$|(^|\.)lnkd\.in$/, 'linkedin'],
  [/(^|\.)wa\.me$|(^|\.)whatsapp\.com$/, 'whatsapp'],
  [/(^|\.)maps\.app\.goo\.gl$|(^|\.)goo\.gl$|(^|\.)maps\.apple\.com$|^google\.[a-z.]+$/, 'maps'],
  [/(^|\.)(amazon|flipkart|etsy|ebay|walmart|target|bestbuy|myntra|ajio|meesho|costco)\.[a-z.]+$|(^|\.)amzn\.(to|in)$/, 'shopping'],
  [/(^|\.)(github|gitlab|stackoverflow|npmjs)\.com$/, 'code'],
];

export function sourceOf(url: string): Source {
  const domain = domainOf(url);
  if (/google\.[a-z.]+$/.test(domain) && !/\/maps/.test(url)) return 'web';
  for (const [pattern, source] of DOMAIN_SOURCES) {
    if (pattern.test(domain)) return source;
  }
  return 'web';
}

/** A short title for a bare link, so a list of links is still readable. */
export function linkTitle(url: string): string {
  const source = sourceOf(url);
  const path = url.replace(/^[a-z]+:\/\/[^/]+/i, '').toLowerCase();
  if (source === 'instagram') return path.includes('/reel') ? 'Instagram reel' : path.includes('/p/') ? 'Instagram post' : 'Instagram link';
  if (source === 'youtube') return path.includes('/shorts') ? 'YouTube short' : 'YouTube video';
  if (source === 'maps') return 'A place on the map';
  if (source !== 'web') return `${SOURCE_LABELS[source]} link`;
  // Readable words from the web address, like "best-hiking-trails-colorado".
  const words = path
    .split(/[/?#&=]/)
    .filter((part) => /[a-z]{3,}/.test(part) && !/^(www|html?|php|amp|index)$/.test(part))
    .pop();
  const slug = words ? words.replace(/\.[a-z]+$/, '').replace(/[-_+]+/g, ' ').trim() : '';
  return slug && slug.length > 3 ? `${capitalize(slug)} (${domainOf(url)})` : domainOf(url);
}

export function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
