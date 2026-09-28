// Who a note is about. "Call Mom about Diwali" is about Mom. "Dinner with Priya" is about Priya.
// Names are found from the words around them, so it needs no contact list and no network.

import { capitalize } from './links';

const FAMILY: Record<string, string> = {
  mom: 'Mom', mother: 'Mom', mum: 'Mom', amma: 'Amma', dad: 'Dad', father: 'Dad', nanna: 'Nanna', appa: 'Appa',
  sister: 'Sister', brother: 'Brother', akka: 'Akka', anna: 'Anna', chelli: 'Chelli', thammudu: 'Thammudu',
  wife: 'Wife', husband: 'Husband', son: 'Son', daughter: 'Daughter', grandma: 'Grandma', grandpa: 'Grandpa',
  uncle: 'Uncle', aunt: 'Aunt', cousin: 'Cousin', manager: 'Manager',
};

// Capitalized words that are not people.
const NOT_NAMES = new Set(
  (
    'I Im Ive Id The A An This That These Those It Its We You They He She My Our Your Their Today Tomorrow Yesterday Tonight ' +
    'Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September ' +
    'October November December Jan Feb Mar Apr Jun Jul Aug Sep Sept Oct Nov Dec Mon Tue Tues Wed Thu Thur Thurs Fri Sat Sun ' +
    'Do Buy Get Check Watch Read Try Make See Look Find Book Pay Send Remember Remind Please Thanks Hi Hello Ok Okay ' +
    'Instagram YouTube Youtube Google Maps Amazon Flipkart Netflix WhatsApp Facebook Reddit LinkedIn ' +
    'TikTok Twitter Apple iPhone Android Uber Zoom Slack Teams Gmail Chrome Safari Memoir Diwali Christmas Sankranti Ugadi ' +
    'Dussehra Holi Eid Thanksgiving New Year Jersey York India USA US America California Texas Hyderabad Bangalore Chennai ' +
    'Tirupati Chittoor Mumbai Delhi Remind Call Buy Book Pay Check Send Email Text Meet Visit Watch Read Learn Note Todo Idea ' +
    'Also Maybe Please Thanks Hi Hello OK Okay'
  ).split(' '),
);

const CUE_WORDS = 'with from to by met meet call called calling told tell asked ask text texted message email emailed and visit visiting for';
// A cue word may start the sentence ("Call Ravi"), so its first letter can be either case.
const CUE = new RegExp(
  `\\b(?:${CUE_WORDS.split(' ').map((w) => `[${w[0]}${w[0].toUpperCase()}]${w.slice(1)}`).join('|')})\\s+([A-Z][a-z]{1,20}(?:\\s+[A-Z][a-z]{1,20})?)`,
  'g',
);
const POSSESSIVE = /\b([A-Z][a-z]{1,20})['’]s\b/g;
const SAID = /\b([A-Z][a-z]{1,20})\s+(?:said|says|told|asked|sent|shared|recommended|suggested)\b/g;

export function findPeople(text: string): string[] {
  const found = new Map<string, string>();
  const add = (name: string) => {
    const clean = name.trim();
    const first = clean.split(/\s+/)[0];
    if (!clean || NOT_NAMES.has(first) || NOT_NAMES.has(clean)) return;
    found.set(clean.toLowerCase(), clean);
  };

  for (const [word, label] of Object.entries(FAMILY)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(text)) found.set(label.toLowerCase(), label);
  }
  for (const pattern of [CUE, POSSESSIVE, SAID]) {
    for (const match of text.matchAll(pattern)) add(match[1]);
  }
  return [...found.values()].map(capitalize).slice(0, 6);
}
