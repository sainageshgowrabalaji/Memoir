// Phone reminders: to-dos until they are done, habits at their time, a morning brief and an evening
// diary nudge. They are local notifications, scheduled on the phone itself, so they fire with no
// internet and no server. They work in Expo Go.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { diaryNudges, habitReminders, morningBriefs, planReminders } from '@/brain/reminders';
import { habitsToday } from '@/db/assistant';
import { diaryFor, getSetting, openTodosForReminders } from '@/db/repo';
import type { Db } from '@/db/schema';

const CHANNEL = 'reminders';
// iPhone keeps at most 64 waiting notifications per app. The soonest 60 are scheduled, and the
// rest are topped up each time the app opens.
const MAX_WAITING = 60;
let configured = false;

export function configureNotifications() {
  if (configured || Platform.OS === 'web') return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  if (Platform.OS === 'android') {
    void Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Reminders',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
}

export async function remindersAllowed(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const status = await Notifications.getPermissionsAsync();
  return status.granted;
}

export async function askForReminders(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const status = await Notifications.requestPermissionsAsync();
  return status.granted;
}

type Planned = { at: number; title: string; body: string; url: string };

/** Everything that should remind you in the coming days, soonest first. Pure, apart from reading. */
export async function planAll(db: Db, now = Date.now()): Promise<Planned[]> {
  const todos = await openTodosForReminders(db);
  const habits = await habitsToday(db, new Date(now));
  const brief = (await getSetting(db, 'morning_brief', 'on')) === 'on';
  const planned: Planned[] = [];

  // With the morning brief on, to-dos without a date are named in it instead of each nudging alone.
  for (const r of planReminders(brief ? todos.filter((t) => t.dueAt !== null) : todos, now)) {
    planned.push({
      at: r.at,
      title: r.overdue ? `Still open, ${r.title}` : r.title,
      body: r.overdue ? 'Tick it in Memoir once it is done, and the reminders stop.' : 'A reminder from Memoir.',
      url: '/tasks',
    });
  }
  for (const h of habitReminders(habits, now)) {
    planned.push({ at: h.at, title: h.title, body: 'Your habit for today. Tick it on Today when it is done.', url: '/' });
  }
  if (brief) {
    for (const b of morningBriefs(todos, habits, now)) planned.push({ ...b, url: '/' });
  }
  if ((await getSetting(db, 'diary_nudge', 'on')) === 'on') {
    for (const at of diaryNudges(now, Boolean(await diaryFor(db, new Date(now))))) {
      planned.push({ at, title: 'How was your day?', body: 'Tell Memoir in a line or two. The keyboard mic works too.', url: '/' });
    }
  }
  return planned.sort((a, b) => a.at - b.at).slice(0, MAX_WAITING);
}

/**
 * Rebuilds every reminder from what is open right now. Simpler and safer than keeping track of
 * each one: whatever is open gets reminders, whatever is done gets none.
 */
export async function syncReminders(db: Db, now = Date.now()): Promise<number> {
  if (!(await remindersAllowed())) return 0;
  const planned = await planAll(db, now);
  await Notifications.cancelAllScheduledNotificationsAsync();
  for (const p of planned) {
    await Notifications.scheduleNotificationAsync({
      content: { title: p.title, body: p.body, data: { url: p.url } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(p.at), channelId: CHANNEL },
    });
  }
  return planned.length;
}
