// Phone reminders for to-dos. They are local notifications, scheduled on the phone
// itself, so they fire with no internet and no server. Both work in Expo Go.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { planReminders } from '@/brain/reminders';
import { openTodosForReminders } from '@/db/repo';
import type { Db } from '@/db/schema';

const CHANNEL = 'reminders';
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
      name: 'To-do reminders',
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
 * Rebuilds every reminder from the to-do list. Simpler and safer than keeping track of
 * each one: whatever is open gets reminders, whatever is done gets none.
 */
export async function syncReminders(db: Db, now = Date.now()): Promise<number> {
  if (!(await remindersAllowed())) return 0;
  await Notifications.cancelAllScheduledNotificationsAsync();
  const plan = planReminders(await openTodosForReminders(db), now);
  for (const reminder of plan) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: reminder.overdue ? `Still on your list: ${reminder.title}` : reminder.title,
        body: reminder.overdue ? 'Mark it done in Memoir once it is, and the reminders stop.' : 'A reminder from Memoir.',
        data: { todoId: reminder.todoId, url: '/todos' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(reminder.at),
        channelId: CHANNEL,
      },
    });
  }
  return plan.length;
}
