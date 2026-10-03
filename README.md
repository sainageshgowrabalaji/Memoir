# Memoir

A calm personal assistant that lives on your phone and works without the internet.

Tell it anything, typed or spoken with the keyboard mic, the way you would tell a friend. "Remind me to call Amma at 7." "Add milk and eggs to the shopping list." "Went to the gym and had lunch with Ravi." "What's on today?" Memoir works out what you meant, does it, and says what it did in one line. If it got it wrong, one tap undoes it or moves it where you meant, and it learns from that.

Everything stays on the phone. There is no account, no server and no cloud model. It runs on iPhone and Android from one codebase, built with Expo and React Native.

## What it does

- **Reminders and to-dos.** "Remind me at 5 30 pm to pick up dry cleaning", "pay rent on the 1st of every month", "call the bank tomorrow evening", "set a reminder for 2 weeks from now to follow up with the recruiter". To-dos remind you when they are due, then a day, three days and a week later until you tick them.
- **Plans and dates.** "Dentist appointment next Friday at 3 pm", "Priya's wedding is on Nov 21", "Amma's birthday is on December 12" (every year after that too).
- **Lists.** Shopping, packing, or any list you start ("create a list called movies to watch"). A bare "onions" or "green chillies" goes on the shopping list. Spoken lists without commas are split for you.
- **Habits.** "Meditate every night at 9", "take my vitamins every morning". A reminder at their time, a tick each day, a streak and the last seven days. Saying "meditated" or "hit the gym this morning" ticks them.
- **Diary.** Anything you say about your day goes into that day's page, and "yesterday I..." goes on yesterday. Saying "called the bank" or "picked up the dry cleaning" also ticks the matching to-do.
- **Notes.** Wifi passwords, a book someone recommended, an idea. Ask later: "what's my wifi password?", "what did Ravi recommend?".
- **Questions.** "What's on today?", "what's coming up next week?", "how many todos do I have?", "what did I do on Tuesday?", "how many times did I go to the gym this week?", "what lists do I have?".
- **Looking after things by saying so.** "Move the dentist to Friday", "push the insurance call to 3pm", "delete the eye doctor reminder", "mark call dad as done", "remove tomatoes from the shopping list", "stop reminding me to drink water", "undo".
- **A morning brief and an evening nudge.** At 8 AM, what today holds. At 9:30 PM, "how was your day?" unless you already wrote. Both can be turned off.
- **Backup.** One file with everything, saved to iCloud Drive or Files and restored on a new phone.

## How the assistant thinks

It works in two layers, both on the phone.

1. **Rules for everyday sentences.** Precise patterns for the things people actually say to an assistant, with dates read by [chrono](https://github.com/wanasit/chrono) and fixes for how dictation writes things ("5 30 pm", "tmrw", "end of the month"). The rules never guess, so simple things do not fail.
2. **What it learns from you.** Every time you tap "Not right?" and pick To-do, Diary, Note or List, it counts the words you used (a small Naive Bayes model), and the next sentence like that goes where you meant. Moving a reminder you set for "evening" teaches it what evening means for you. Putting sunscreen on the packing list once teaches it where sunscreen goes. It learns only from your corrections and choices, never from its own guesses, and Settings shows what it has learned with a button to forget it.

Search in Journal reads your words and their meaning with a small word model (see below).

## Put it on your phone (no Xcode, no Mac needed after this)

Memoir runs inside the free **Expo Go** app, and Expo hosts it for free, so your Mac only publishes it.

1. Make a free account at [expo.dev](https://expo.dev), and install **Expo Go** on the iPhone. Sign in to Expo Go with the same account.
2. On the Mac, in this folder:

   ```bash
   npm install
   npx eas-cli@latest login
   npx eas-cli@latest init
   npx eas-cli@latest update:configure
   npx eas-cli@latest update --channel main --environment production --message "Memoir"
   ```

3. Open [expo.dev](https://expo.dev), go to the Memoir project, then Updates, open the update you just published and tap **Preview**. Scan the QR code with the iPhone camera and it opens in Expo Go.

From then on Memoir is in Expo Go's list. Open Expo Go and tap Memoir. To send a new version, run the last command again.

To talk instead of typing, tap the box on Today and then the mic on the keyboard. On iPhone, dictation works offline once your language is downloaded (Settings, General, Keyboard).

## Try it on your Mac while changing code

```bash
npm install
npx expo start
```

Scan the QR code with the iPhone camera. The phone and the Mac need to be on the same Wi-Fi, or use `npx expo start --tunnel`.

## A browser demo anyone can open

`render.yaml` puts Memoir's browser version online as a free static site on [Render](https://render.com). There is no server and there are no keys. Everything a visitor types stays in their own browser.

1. Sign in to Render with GitHub
2. Choose **New**, then **Blueprint**, and pick this repository
3. Press **Apply**, then open the address Render gives you

Reminders by notification and backup by share sheet only work on a phone, so the browser version is for trying the assistant, not for daily use.

## Check the code

```bash
npm test            # the assistant, lists, habits, diary, reminders, backup and search, against a real SQLite database
npx tsc --noEmit    # types
npx expo lint       # lint
```

## How it is built

| Folder | What lives there |
| --- | --- |
| `src/brain` | Understanding a sentence (`agent.ts`), dates and to-dos, people, the word model (`meaning.ts`), reminder timing and the morning brief, and turning a search into filters. Plain TypeScript with no phone code, so it is tested on its own. |
| `src/db` | The on-phone SQLite database. `assistant.ts` carries out what you said and keeps a log so it can undo or be corrected. `repo.ts` holds notes, the diary, to-dos, search and backup. |
| `src/lib` | Reminders, backup files, photos and small helpers. |
| `src/app` | The screens. Today (talk to Memoir), Tasks (to-dos, lists, habits), Journal (diary, notes, search), a note's page, and Settings. |
| `tests` | Tests for all of the above, including a simulated week of dictated sentences. |

## The word model

Memoir carries a table of 40,000 everyday English words, each placed by 64 numbers so that words with a similar meaning sit close together. The meaning of a note or question is the weighted average of its words. It is a file under 4 MB that runs in plain JavaScript, so it works in Expo Go. The numbers come from [GloVe](https://nlp.stanford.edu/projects/glove/) (Stanford, public domain), see `src/brain/model/NOTICE.md`.
