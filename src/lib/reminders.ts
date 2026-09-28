// Phone reminders for to-dos and for saved links still to check. They are local notifications,
// scheduled on the phone itself, so they fire with no internet and no server. They work in Expo Go.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { diaryNudges, digestMessage, planCheckDigests, planReminders } from '@/brain/reminders';
import { diaryFor, getSetting, openTodosForReminders, toCheckForReminders } from '@/db/repo';
import type { Db } from '@/db/schema';

const CHANNEL = 'reminders';
// iPhone keeps at most 64 waiting notifications per app. Links to check get up to 14 evenings.
const MAX_WAITING = 60;
const MAX_CHECK_DIGESTS = 14;
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

/**
 * Rebuilds every reminder from the to-do list and the links still to check. Simpler and safer than
 * keeping track of each one: whatever is open gets reminders, whatever is done gets none.
 */
export async function syncReminders(db: Db, now = Date.now()): Promise<number> {
  if (!(await remindersAllowed())) return 0;
  await Notifications.cancelAllScheduledNotificationsAsync();
  const digests = planCheckDigests(await toCheckForReminders(db), now, MAX_CHECK_DIGESTS);
  const diary = (await getSetting(db, 'diary_nudge', 'on')) === 'on' ? diaryNudges(now, Boolean(await diaryFor(db, new Date(now)))) : [];
  const todos = planReminders(await openTodosForReminders(db), now).slice(0, MAX_WAITING - digests.length - diary.length);
  const trigger = (at: number) => ({
    type: Notifications.SchedulableTriggerInputTypes.DATE,
    date: new Date(at),
    channelId: CHANNEL,
  }) as const;

  for (const digest of digests) {
    const { title, body } = digestMessage(digest);
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data: { url: '/todos', kind: 'check' } },
      trigger: trigger(digest.at),
    });
  }
  for (const at of diary) {
    await Notifications.scheduleNotificationAsync({
      content: { title: 'How was your day?', body: 'Write a line in Memoir. Even one sentence is enough.', data: { url: '/', kind: 'diary' } },
      trigger: trigger(at),
    });
  }
  for (const reminder of todos) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: reminder.overdue ? `Still on your list: ${reminder.title}` : reminder.title,
        body: reminder.overdue ? 'Mark it done in Memoir once it is, and the reminders stop.' : 'A reminder from Memoir.',
        data: { todoId: reminder.todoId, url: '/todos' },
      },
      trigger: trigger(reminder.at),
    });
  }
  return digests.length + diary.length + todos.length;
}
