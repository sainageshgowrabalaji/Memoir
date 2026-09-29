// How many to-dos are due today or late, for the badge on Tasks. Refreshes when anything changes.
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { useDb } from '@/lib/database';
import { useDataChanged } from '@/lib/events';

export function useOpenTaskCount(): number {
  const db = useDb();
  const [count, setCount] = useState(0);
  const load = useCallback(() => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    void db
      .getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM todos WHERE done_at IS NULL AND due_at IS NOT NULL AND due_at <= ?', [end.getTime()])
      .then((row) => setCount(Number(row?.n ?? 0)));
  }, [db]);
  useEffect(() => {
    load();
    // A new day can start while the app sits in the background.
    const sub = AppState.addEventListener('change', (state) => state === 'active' && load());
    return () => sub.remove();
  }, [load]);
  useDataChanged(load);
  return count;
}
