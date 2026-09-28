// Memoir's small on-phone model, so it can match things by meaning and not only by the exact words.
//
// It is a table of 40,000 everyday English words. Each word has 64 numbers that place it near
// words with a similar meaning, so "hike", "trail" and "waterfall" sit close together and "invoice"
// sits far away. The meaning of a note or a question is the average of its words, with very common
// words counting less. Two things mean something alike when their averages point the same way
// (cosine similarity, like comparing the direction of two arrows).
//
// The numbers come from GloVe (Stanford, public domain), squeezed into a file under 4 MB so the
// model fits on any phone, works offline and needs no special build. It runs in plain JavaScript.

import { CATEGORIES, type CategoryId } from './categories';
import raw from './model/memoir-words.json';

type Model = { dims: number; index: Map<string, number>; vectors: Int8Array; weights: Float32Array };

let loaded: Model | null = null;

// Rarer words carry more meaning. This is the "smooth inverse frequency" weight: the words are
// stored most common first, so a word's position stands in for how often people use it.
const SMOOTHING = 1e-3;
const HARMONIC = Math.log(400000) + 0.5772;

function model(): Model {
  if (loaded) return loaded;
  const words = raw.words.split(' ');
  const index = new Map<string, number>();
  words.forEach((word, i) => index.set(word, i));
  const bytes = atob(raw.vectors);
  const vectors = new Int8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) vectors[i] = (bytes.charCodeAt(i) << 24) >> 24;
  const weights = new Float32Array(words.length);
  for (let i = 0; i < words.length; i++) {
    const p = i < raw.common ? 1 / ((i + 1) * HARMONIC) : 0;
    weights[i] = SMOOTHING / (SMOOTHING + p);
  }
  loaded = { dims: raw.dims, index, vectors, weights };
  return loaded;
}

const STOP = new Set(
  (
    'i im ive id me my mine we our you your he she it its they them their his her him the a an that this those these to of ' +
    'in on at for with and or but is are was were be been am do did does have has had will would can could should from by ' +
    'about as into up down out over under again then than so very just also not no yes what which who whom where when why ' +
    'how all any some each few more most other such only own same too now there here get got let lets'
  ).split(' '),
);

const URL = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;

function lookup(index: Map<string, number>, word: string): number | undefined {
  const found = index.get(word);
  if (found !== undefined) return found;
  // A plain word form, so "trails", "hiking" and "priya's" still count.
  for (const ending of ["'s", 's', 'es', 'ing', 'ed']) {
    if (word.length > ending.length + 2 && word.endsWith(ending)) {
      const stem = index.get(word.slice(0, -ending.length));
      if (stem !== undefined) return stem;
    }
  }
  return undefined;
}

/** The words of a text that the model knows, which is handy for tests and for explaining a match. */
export function knownWords(text: string): string[] {
  const { index } = model();
  return words(text).filter((w) => lookup(index, w) !== undefined);
}

function words(text: string): string[] {
  return (text.replace(URL, ' ').toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? []).filter((w) => !STOP.has(w));
}

/** The meaning of a text as 64 numbers of length 1, or null when it has no words the model knows. */
export function embed(text: string): Float32Array | null {
  const { dims, index, vectors, weights } = model();
  const sum = new Float32Array(dims);
  let used = 0;
  for (const word of words(text)) {
    const i = lookup(index, word);
    if (i === undefined) continue;
    const weight = weights[i];
    const at = i * dims;
    for (let d = 0; d < dims; d++) sum[d] += weight * vectors[at + d];
    used++;
  }
  if (!used) return null;
  return normalize(sum);
}

function normalize(v: Float32Array): Float32Array | null {
  let length = 0;
  for (let d = 0; d < v.length; d++) length += v[d] * v[d];
  length = Math.sqrt(length);
  if (!length) return null;
  for (let d = 0; d < v.length; d++) v[d] /= length;
  return v;
}

/** How alike two meanings are, from -1 (opposite) through 0 (unrelated) to 1 (the same). */
export function similarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let d = 0; d < a.length; d++) {
    dot += a[d] * b[d];
    aa += a[d] * a[d];
    bb += b[d] * b[d];
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

// Saved in the database as 64 small whole numbers in text form, 88 characters per item.
export const MODEL_VERSION = raw.version;

export function packVector(v: Float32Array): string {
  let bytes = '';
  for (let d = 0; d < v.length; d++) bytes += String.fromCharCode(Math.round(Math.max(-1, Math.min(1, v[d])) * 127) & 0xff);
  return btoa(bytes);
}

export function unpackVector(text: string): Int8Array {
  const bytes = atob(text);
  const v = new Int8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) v[i] = (bytes.charCodeAt(i) << 24) >> 24;
  return v;
}

// ------------------------------------------------------------ shelves by meaning

let seedVectors: { id: CategoryId; vectors: Float32Array[] }[] | null = null;

function shelfSeeds() {
  seedVectors ??= CATEGORIES.filter((c) => c.seeds).map((c) => ({
    id: c.id,
    vectors: c.seeds
      .split(' ')
      .map((word) => embed(word))
      .filter((v): v is Float32Array => v !== null),
  }));
  return seedVectors;
}

// Tried on 28 notes with none of the shelf keywords in them. At these settings the model picked
// the right shelf 17 times, the wrong one twice, and left 9 on Notes when it was unsure.
const SHELF_MATCH = 0.5;
const SHELF_LEAD = 0.06;

/**
 * The shelf a meaning is closest to, scored by the three seed words it sits nearest. Returns null
 * unless one shelf is clearly ahead, because a note left on Notes is better than one on the wrong shelf.
 */
export function shelfByMeaning(v: Float32Array): { id: CategoryId; score: number } | null {
  const scores = shelfSeeds()
    .map(({ id, vectors }) => {
      const top = vectors
        .map((seed) => similarity(v, seed))
        .sort((a, b) => b - a)
        .slice(0, 3);
      return { id, score: top.reduce((sum, s) => sum + s, 0) / top.length };
    })
    .sort((a, b) => b.score - a.score);
  const [best, next] = scores;
  return best && best.score >= SHELF_MATCH && best.score - (next?.score ?? 0) >= SHELF_LEAD ? best : null;
}
