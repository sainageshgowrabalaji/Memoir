// The shelves Memoir sorts things onto. You can always move an item to another one.
// Version 1 sorts by keywords, which works on any phone with no model at all.
// The small on-phone model in step 2 adds sorting by meaning on top.

import type { Source } from './links';

export type CategoryId =
  | 'people'
  | 'work'
  | 'money'
  | 'health'
  | 'learning'
  | 'travel'
  | 'food'
  | 'shopping'
  | 'fun'
  | 'ideas'
  | 'home'
  | 'notes';

export type Category = { id: CategoryId; label: string; hint: string; words: string[] };

export const CATEGORIES: Category[] = [
  {
    id: 'people',
    label: 'People',
    hint: 'family, friends, birthdays',
    words: [
      'mom', 'mother', 'mum', 'dad', 'father', 'amma', 'nanna', 'appa', 'sister', 'brother', 'akka', 'anna', 'thammudu',
      'chelli', 'wife', 'husband', 'son', 'daughter', 'friend', 'friends', 'cousin', 'uncle', 'aunt', 'grandma', 'grandpa',
      'birthday', 'anniversary', 'wedding', 'family', 'met', 'called', 'talked', 'party', 'kids', 'baby', 'neighbor',
    ],
  },
  {
    id: 'work',
    label: 'Work',
    hint: 'job, meetings, career',
    words: [
      'work', 'office', 'meeting', 'manager', 'team', 'project', 'deadline', 'interview', 'job', 'jobs', 'career', 'resume',
      'client', 'standup', 'promotion', 'colleague', 'recruiter', 'offer letter', 'linkedin', 'jira', 'sprint', 'review',
      'presentation', 'slides', 'hiring', 'h1b', 'visa',
    ],
  },
  {
    id: 'money',
    label: 'Money',
    hint: 'bills, cards, savings',
    words: [
      'money', 'bank', 'card', 'credit', 'debit', 'loan', 'emi', 'rent', 'bill', 'bills', 'pay', 'paid', 'payment', 'invest',
      'investing', 'stock', 'stocks', 'tax', 'taxes', 'budget', 'savings', 'insurance', 'refund', 'salary', '401k', 'ira',
      'mutual fund', 'crypto', 'cashback', 'rewards', 'points', 'dollars', 'rupees', 'upi', 'venmo', 'zelle',
    ],
  },
  {
    id: 'health',
    label: 'Health',
    hint: 'doctors, fitness, sleep',
    words: [
      'doctor', 'hospital', 'clinic', 'medicine', 'medicines', 'pill', 'pills', 'gym', 'workout', 'exercise', 'run', 'running',
      'walk', 'steps', 'sleep', 'diet', 'headache', 'pain', 'dentist', 'health', 'yoga', 'fitness', 'meditation', 'therapy',
      'blood test', 'checkup', 'vitamin', 'protein', 'calories', 'weight',
    ],
  },
  {
    id: 'learning',
    label: 'Learning',
    hint: 'courses, articles, how-tos',
    words: [
      'learn', 'learning', 'course', 'tutorial', 'book', 'books', 'read', 'reading', 'article', 'study', 'lecture', 'class',
      'exam', 'paper', 'research', 'how to', 'guide', 'tips', 'python', 'java', 'ai', 'llm', 'agent', 'agents', 'code',
      'coding', 'github', 'leetcode', 'system design', 'podcast', 'lesson', 'english', 'spring boot', 'kafka',
    ],
  },
  {
    id: 'travel',
    label: 'Travel',
    hint: 'trips, places to visit',
    words: [
      'trip', 'travel', 'flight', 'flights', 'hotel', 'visit', 'beach', 'hike', 'hiking', 'trail', 'trek', 'mountain',
      'mountains', 'park', 'place', 'places', 'city', 'vacation', 'airbnb', 'airport', 'passport', 'map', 'location',
      'museum', 'road trip', 'camping', 'lake', 'waterfall', 'temple', 'tour', 'itinerary', 'weekend getaway',
    ],
  },
  {
    id: 'food',
    label: 'Food',
    hint: 'recipes, restaurants',
    words: [
      'food', 'recipe', 'recipes', 'cook', 'cooking', 'restaurant', 'restaurants', 'cafe', 'coffee', 'dinner', 'lunch',
      'breakfast', 'eat', 'eating', 'dish', 'biryani', 'pizza', 'dosa', 'idli', 'curry', 'dessert', 'cake', 'tea', 'snack',
      'vegetarian', 'vegan', 'bakery', 'menu',
    ],
  },
  {
    id: 'shopping',
    label: 'Shopping',
    hint: 'things to buy, deals',
    words: [
      'buy', 'bought', 'order', 'ordered', 'amazon', 'flipkart', 'shop', 'shopping', 'price', 'deal', 'deals', 'sale',
      'discount', 'gift', 'gifts', 'product', 'shoes', 'shirt', 'dress', 'laptop', 'phone', 'headphones', 'groceries',
      'costco', 'wishlist',
    ],
  },
  {
    id: 'fun',
    label: 'Fun',
    hint: 'movies, music, games',
    words: [
      'movie', 'movies', 'film', 'series', 'show', 'song', 'songs', 'music', 'watch', 'netflix', 'prime video', 'hotstar',
      'game', 'games', 'concert', 'cricket', 'match', 'funny', 'meme', 'memes', 'dance', 'comedy', 'anime', 'playlist',
    ],
  },
  {
    id: 'ideas',
    label: 'Ideas',
    hint: 'thoughts, plans, what-ifs',
    words: [
      'idea', 'ideas', 'maybe', 'what if', 'could build', 'app idea', 'thought', 'thinking', 'plan', 'startup', 'someday',
      'dream', 'goal', 'goals', 'inspiration', 'side project', 'business',
    ],
  },
  {
    id: 'home',
    label: 'Home',
    hint: 'house, chores, repairs',
    words: [
      'home', 'house', 'apartment', 'repair', 'clean', 'cleaning', 'laundry', 'furniture', 'plumber', 'electrician', 'lease',
      'landlord', 'move', 'moving', 'wifi', 'kitchen', 'plants', 'garden',
    ],
  },
  { id: 'notes', label: 'Notes', hint: 'everything else', words: [] },
];

export const CATEGORY_BY_ID: Record<CategoryId, Category> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<CategoryId, Category>;

// A link's source nudges the choice. A maps link is almost always a place to go.
const SOURCE_NUDGE: Partial<Record<Source, CategoryId>> = {
  maps: 'travel',
  shopping: 'shopping',
  code: 'learning',
  linkedin: 'work',
};

function escape(word: string) {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PATTERNS: { id: CategoryId; pattern: RegExp; word: string }[] = CATEGORIES.flatMap((category) =>
  category.words.map((word) => ({ id: category.id, word, pattern: new RegExp(`\\b${escape(word)}\\b`, 'i') })),
);

export type CategoryGuess = { id: CategoryId; hits: string[]; scores: Partial<Record<CategoryId, number>> };

/** Scores every shelf by the words it matches, and picks the best one. */
export function guessCategory(text: string, source: Source = 'me'): CategoryGuess {
  const scores: Partial<Record<CategoryId, number>> = {};
  const hitsBy: Partial<Record<CategoryId, string[]>> = {};
  for (const { id, pattern, word } of PATTERNS) {
    if (pattern.test(text)) {
      // Phrases like "road trip" say more than one word does.
      scores[id] = (scores[id] ?? 0) + (word.includes(' ') ? 2 : 1);
      (hitsBy[id] ??= []).push(word);
    }
  }
  const nudge = SOURCE_NUDGE[source];
  if (nudge) scores[nudge] = (scores[nudge] ?? 0) + 1.5;

  let best: CategoryId = 'notes';
  let bestScore = 0;
  for (const category of CATEGORIES) {
    const score = scores[category.id] ?? 0;
    if (score > bestScore) {
      best = category.id;
      bestScore = score;
    }
  }
  return { id: best, hits: hitsBy[best] ?? [], scores };
}
