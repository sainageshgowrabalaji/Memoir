// One SQLite file on the phone, opened once for the whole app.
// SQLiteProvider runs the migration before any screen reads, like Flyway at startup.
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import type { ReactNode } from 'react';

import { migrate, type Db } from '@/db/schema';

export function DatabaseProvider({ children }: { children: ReactNode }) {
  return (
    <SQLiteProvider databaseName="memoir.db" onInit={async (db) => void (await migrate(db as unknown as Db))}>
      {children}
    </SQLiteProvider>
  );
}

export function useDb(): Db {
  return useSQLiteContext() as unknown as Db;
}
