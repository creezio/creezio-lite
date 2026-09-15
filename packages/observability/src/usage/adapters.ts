/**
 * Injection host pour usage-analytics (évite imports `@/` marque).
 */

export type UsageAnalyticsSqliteStatement = {
  run(...params: unknown[]): { changes: number; lastInsertRowid?: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};

export type UsageAnalyticsSqliteDatabase = {
  exec(sql: string): unknown;
  prepare(sql: string): UsageAnalyticsSqliteStatement;
  transaction?: <TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult) => (...args: TArgs) => TResult;
};

export type UsageAnalyticsAdapters = {
  getWriteDb: () => UsageAnalyticsSqliteDatabase;
  /** Lecture (défaut = getWriteDb). */
  getDb?: () => UsageAnalyticsSqliteDatabase;
  tableExists?: (name: string) => boolean;
};

let adapters: UsageAnalyticsAdapters | null = null;

export function configureUsageAnalytics(next: UsageAnalyticsAdapters): void {
  adapters = next;
}

export function getUsageAnalyticsAdapters(): UsageAnalyticsAdapters {
  if (!adapters) {
    throw new Error(
      "@creezio/observability usage: configureUsageAnalytics({ getWriteDb }) requis",
    );
  }
  return adapters;
}

export function resetUsageAnalyticsAdaptersForTests(): void {
  adapters = null;
}

export function uaGetWriteDb(): UsageAnalyticsSqliteDatabase {
  return getUsageAnalyticsAdapters().getWriteDb();
}

export function uaGetDb(): UsageAnalyticsSqliteDatabase {
  const a = getUsageAnalyticsAdapters();
  return a.getDb ? a.getDb() : a.getWriteDb();
}

export function uaQueryAll<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): T[] {
  return uaGetDb().prepare(sql).all(...params) as T[];
}

export function uaQueryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): T | undefined {
  return uaGetDb().prepare(sql).get(...params) as T | undefined;
}

export function uaTableExists(name: string): boolean {
  const custom = getUsageAnalyticsAdapters().tableExists;
  if (custom) return custom(name);
  const row = uaQueryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name=?`,
    [name],
  );
  return (row?.c ?? 0) > 0;
}
