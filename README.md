# Memoir

Save anything, find it later by asking.

Memoir is a personal diary and to-do list for your phone. You drop things into it as they come up (an Instagram reel, a web link, something a friend told you, a photo) and later ask for them in your own words, like "I remember saving a reel about a hike". Everything stays on the phone. There is no account and no server.

It runs on iPhone and Android from one codebase, built with Expo and React Native.

## What it does today

- **Save anything.** Paste a link, type a note, pick a photo or take one. The keyboard mic works for speaking a note.
- **Sorts it for you.** Each save goes on a shelf (People, Work, Money, Health, Learning, Travel, Food, Shopping, Fun, Ideas, Home, Notes) and is marked personal or public. Links from Instagram, YouTube, X, Reddit, LinkedIn, Maps and others are recognized by where they came from.
- **Notices people.** "Amma said..." or "Priya recommended..." files the note under that person, so "what did Amma say" finds it.
- **Ask in plain words.** "the reel about a hike", "links from last week", "what Ravi sent in May". Search understands time, people, sources and kinds of things, and says what it understood.
- **To-dos that keep reminding you.** "I need to renew my passport by Oct 28" becomes a to-do with a due date. Reminders come on the day, then again after 1, 3 and 7 days until you mark it done.
- **Learns what you care about.** The home screen shows what you save most about and brings back something from your past.

All of this works offline. The understanding is done by small rules on the phone, so nothing you save leaves it.

## Run it on your phone

You need Node 20 or newer on your computer and the free **Expo Go** app on your phone (App Store or Google Play).

```bash
npm install
npx expo start
```

A QR code appears in the terminal.

- **iPhone.** Open the Camera app and point it at the QR code.
- **Android.** Open Expo Go and tap "Scan QR code".

The phone and the computer need to be on the same Wi-Fi. If they are not, or your network blocks it, start with a tunnel instead.

```bash
npx expo start --tunnel
```

Reminders work in Expo Go on both platforms. The first time you add a to-do, the phone asks for permission to show notifications.

## Check the code

```bash
npm test            # the sorting, date and search logic, run against a real SQLite database
npx tsc --noEmit    # types
npx expo lint       # lint
```

## How it is built

| Folder | What lives there |
| --- | --- |
| `src/brain` | Reading a save. Links and where they came from, shelves, people, dates and to-dos, and turning a question into a search. Plain TypeScript with no phone code, so it is tested on its own. |
| `src/db` | The on-phone SQLite database, with full text search over everything you save. |
| `src/lib` | Reminders, photos, and the small helpers screens share. |
| `src/app` | The screens. Memoir (save and browse), Ask, To-dos, and the detail view. |
| `tests` | Tests for the brain and the database. |

## What comes next

1. **A small model on the phone.** A compact embedding model (around 25 MB) so Ask finds things by meaning as well as by words. This needs a development build instead of Expo Go.
2. **Share into Memoir.** Save straight from the share sheet in Instagram, Chrome, Safari or Photos.
3. **Look it up online.** When the phone is online and you ask for something Memoir does not have, it offers to search the web.
