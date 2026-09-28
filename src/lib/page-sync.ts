// Reads the pages of saved links in the background: right after a save, when the app opens,
// and whenever it comes back to the front. Offline, it stops quietly and tries next time.
import { applyPage, pendingPages } from '@/db/repo';
import type { Db } from '@/db/schema';
import { dataChanged } from '@/lib/events';
import { OfflineError, readPage } from '@/lib/link-reader';
import { syncReminders } from '@/lib/reminders';

let running: Promise<number> | null = null;

async function readAll(db: Db): Promise<number> {
  let read = 0;
  for (let round = 0; round < 3; round++) {
    const batch = await pendingPages(db, 6);
    if (!batch.length) break;
    for (const item of batch) {
      try {
        const page = await readPage(item.url!, item.source);
        await applyPage(db, item.id, page);
        read++;
        dataChanged();
      } catch (error) {
        if (error instanceof OfflineError) return read;
        await applyPage(db, item.id, null);
      }
    }
  }
  // Titles may have changed, so the reminders get the new ones.
  if (read) await syncReminders(db).catch(() => 0);
  return read;
}

/** Reads every link still waiting. Calls while one is running share it. */
export function readPendingPages(db: Db): Promise<number> {
  running ??= readAll(db).finally(() => {
    running = null;
  });
  return running;
}
