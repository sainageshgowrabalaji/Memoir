// A Node SQLite with the same four methods as the phone's expo-sqlite, so the real
// repo code runs in tests. Like an in-memory H2 database standing in for Postgres.
import Database from 'better-sqlite3';

import type { Db } from '../src/db/schema';

export function memoryDb(): Db {
  const sqlite = new Database(':memory:');
  const bind = (params?: unknown[]) => (params ?? []).map((p) => (typeof p === 'boolean' ? Number(p) : p));
  return {
    async execAsync(sql) {
      sqlite.exec(sql);
    },
    async runAsync(sql, params) {
      const result = sqlite.prepare(sql).run(...bind(params));
      return { lastInsertRowId: Number(result.lastInsertRowid), changes: result.changes };
    },
    async getAllAsync<T>(sql: string, params?: unknown[]) {
      return sqlite.prepare(sql).all(...bind(params)) as T[];
    },
    async getFirstAsync<T>(sql: string, params?: unknown[]) {
      return (sqlite.prepare(sql).get(...bind(params)) as T) ?? null;
    },
  };
}
