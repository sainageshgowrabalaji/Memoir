// Opening a saved link counts as checking it: it leaves the "To check" list and its nudges stop.
// On iPhone an Instagram link opens straight in the Instagram app.
import { Linking, Platform } from 'react-native';

import { setChecked, type Item } from '@/db/repo';
import type { Db } from '@/db/schema';
import { dataChanged } from '@/lib/events';
import { syncReminders } from '@/lib/reminders';

export async function openSaved(db: Db, item: Item) {
  if (!item.url) return;
  if (Platform.OS === 'web') window.open(item.url, '_blank', 'noopener');
  else await Linking.openURL(item.url);
  if (item.checkState === 'to_check') {
    await setChecked(db, item.id, true);
    await syncReminders(db).catch(() => 0);
    dataChanged();
  }
}
