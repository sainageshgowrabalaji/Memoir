# Memoir

Save anything, don't forget it, find it later by asking.

Memoir is a personal memory and productivity app for your phone. Reels and links you would otherwise save on Instagram or send to your own WhatsApp chat (and then forget) come here instead. Memoir reads what each one is about, keeps it on a "To check" list, and reminds you every evening until you have looked at it. It also keeps your to-dos, a short diary of your days, and everything you want to remember, and you can ask for any of it in your own words.

Everything stays on the phone. There is no account and no server. It runs on iPhone and Android from one codebase, built with Expo and React Native.

## What it does

- **Reels read for you.** Save an Instagram reel, a YouTube video, a TikTok or any link, and Memoir pulls the caption, who posted it and the thumbnail, exactly as written. The link is always kept, one tap away.
- **To check, until you check it.** Every saved link waits on the Follow up tab. At 8 PM you get one reminder with what is waiting, then again after 1, 3 and 7 days, then weekly. Opening it counts as checked. You can also pick "Later" (tonight, tomorrow, this weekend, next week) or "Done".
- **Two-tap saving.** In Instagram tap Share, then Copy link, then open Memoir and tap Save it. Saving the same reel twice brings the first one back instead of a copy.
- **Your old saves.** Bring in a WhatsApp chat export (the chat with yourself) or Instagram's saved posts export. Links already here are skipped, and three come back each evening so the backlog gets looked at without flooding you.
- **Diary.** "How was your day?" on the home screen, one entry per day that you can add to. A gentle 9:30 PM nudge if you haven't written. "I need to..." in the diary still becomes a to-do.
- **To-dos.** "I need to renew my passport by Oct 28" becomes a to-do with a due date and reminders until it is done.
- **Ask in plain words.** "that south indian breakfast place", "back pain exercises", "what Ravi sent in May", "my diary last week". Search reads your notes, captions and diary, by words and by meaning.
- **Sorted for you.** Shelves (People, Work, Money, Health, Learning, Travel, Food, Shopping, Fun, Ideas, Home), personal or public, the people you mention, and what you have been into lately.
- **Backup.** One file with everything, photos included, saved to iCloud Drive or Files, and restored on a new phone.

Everything except reading a link's page works offline. Reading a page happens when the phone is online, and a link saved offline is read later.

## Put it on your phone (no Xcode, no Mac needed after this)

Memoir runs inside the free **Expo Go** app, and Expo hosts it for free, so your Mac only publishes it.

1. Make a free account at [expo.dev](https://expo.dev), and install **Expo Go** on the iPhone. Sign in to Expo Go with the same account.
2. On the Mac, in this folder:

   ```bash
   npm install
   npx eas-cli@latest login
   npx eas-cli@latest init
   npx eas-cli@latest update:configure
   npx eas-cli@latest update --channel main --message "Memoir"
   ```

3. Open [expo.dev](https://expo.dev), go to the Memoir project, then Updates, open the update you just published and tap **Preview**. Scan the QR code with the iPhone camera and it opens in Expo Go.

From then on Memoir is in Expo Go's list. Open Expo Go and tap Memoir. To send a new version, run the last command again.

Expo Go moves to a new Expo version a few times a year. When it does, Memoir needs updating to match, so keep a backup (Backup on the home screen).

## Try it on your Mac while changing code

```bash
npm install
npx expo start
```

Scan the QR code with the iPhone camera. The phone and the Mac need to be on the same Wi-Fi, or use `npx expo start --tunnel`.

## Check the code

```bash
npm test            # sorting, dates, reading reels, follow-ups, diary, imports and search, against a real SQLite database
npx tsc --noEmit    # types
npx expo lint       # lint
```

## How it is built

| Folder | What lives there |
| --- | --- |
| `src/brain` | Reading a save. Links, shelves, people, dates and to-dos, reading reel and page previews (`pages.ts`), WhatsApp and Instagram exports (`imports.ts`), the word model (`meaning.ts`), reminder timing, and turning a question into a search. Plain TypeScript with no phone code, so it is tested on its own. |
| `src/db` | The on-phone SQLite database, with full-text search, the follow-up list, the diary, backup and import. |
| `src/lib` | Fetching link previews, reminders, backup files, photos, and small helpers. |
| `src/app` | The screens. Memoir (save, diary, browse), Ask, Follow up, an item's page, and Backup. |
| `tests` | Tests for all of the above. |

## The word model

Memoir carries a table of 40,000 everyday English words, each placed by 64 numbers so that words with a similar meaning sit close together. The meaning of a note or question is the weighted average of its words. It is a file under 4 MB that runs in plain JavaScript, so it works in Expo Go. The numbers come from [GloVe](https://nlp.stanford.edu/projects/glove/) (Stanford, public domain), see `src/brain/model/NOTICE.md`.

## Later, with a real app build

A real build (Xcode, or an Apple developer account) would add a "Memoir" button in Instagram's share menu and neural AI models on the phone for summaries and answers in sentences. The code is ready for a second meaning model (`Meaner` in `meaning.ts`), and the data already stores one vector per model.
