// How many saved links are waiting for a look, kept fresh as things change. Shown on the tab.
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { countToCheck } from '@/db/repo';
import { useDb } from '@/lib/database';
import { useDataChanged } from '@/lib/events';

export function useToCheckCount(): number {
  const db = useDb();
  const [count, setCount] = useState(0);
  const load = useCallback(() => {
    void countToCheck(db).then(setCount);
  }, [db]);
  useEffect(() => {
    load();
    const sub = AppState.addEventListener('change', (state) => state === 'active' && load());
    return () => sub.remove();
  }, [load]);
  useDataChanged(load);
  return count;
}
