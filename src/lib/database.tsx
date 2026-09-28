// One SQLite file on the phone, opened once for the whole app.
// SQLiteProvider runs the migration before any screen reads, like Flyway at startup,
// then fills in the meaning of anything saved before the on-phone model was added.
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import type { ReactNode } from 'react';

import { fillMeanings } from '@/db/repo';
import { migrate, type Db } from '@/db/schema';

async function prepare(db: Db) {
  await migrate(db);
  await fillMeanings(db);
}

export function DatabaseProvider({ children }: { children: ReactNode }) {
  return (
    <SQLiteProvider databaseName="memoir.db" onInit={(db) => prepare(db as unknown as Db)}>
      {children}
    </SQLiteProvider>
  );
}

export function useDb(): Db {
  return useSQLiteContext() as unknown as Db;
}
