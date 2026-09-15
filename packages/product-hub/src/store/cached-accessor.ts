/**
 * Accessor Next/CRM — singleton store core.db + migrate legacy one-shot.
 */

import {
  migrateLegacyBrandProductHubOnce,
} from "./migrate-legacy.js";
import type { OpenSqliteDatabase, SqliteDatabase } from "./sqlite-driver.js";
import {
  createSqliteProductHubStore,
  type SqliteProductHubStore,
} from "./sqlite-store.js";

export type CachedSqliteProductHubAccessor = {
  get: () => SqliteProductHubStore | null;
  require: (errorMessage?: string) => SqliteProductHubStore;
  getDb: () => SqliteDatabase | null;
  close: () => void;
};

export type CreateCachedSqliteProductHubAccessorOptions = {
  resolveCorePath: () => string | null;
  conversationPrefix: string;
  /** Brand DB pour migrate one-shot (optionnel). */
  resolveBrandPath?: () => string | null;
  openDatabase: OpenSqliteDatabase;
  openReadonlyDatabase?: OpenSqliteDatabase;
  ensureParent?: (coreDbPath: string) => void;
};

export function createCachedSqliteProductHubAccessor(
  opts: CreateCachedSqliteProductHubAccessorOptions,
): CachedSqliteProductHubAccessor {
  let cached: SqliteProductHubStore | null = null;
  let cachedPath: string | null = null;
  let sharedDb: SqliteDatabase | null = null;

  function close(): void {
    if (cached) {
      try {
        cached.close();
      } catch {
        /* ok */
      }
      cached = null;
    }
    if (sharedDb) {
      try {
        sharedDb.close?.();
      } catch {
        /* ok */
      }
      sharedDb = null;
    }
    cachedPath = null;
  }

  function get(): SqliteProductHubStore | null {
    const corePath = opts.resolveCorePath();
    if (!corePath) return null;
    if (cached && cachedPath === corePath) return cached;
    try {
      opts.ensureParent?.(corePath);
      close();
      sharedDb = opts.openDatabase(corePath);
      cached = createSqliteProductHubStore({
        coreDbPath: corePath,
        conversationPrefix: opts.conversationPrefix,
        openDatabase: () => sharedDb!,
      });
      cachedPath = corePath;
      const brandPath = opts.resolveBrandPath?.()?.trim();
      if (brandPath) {
        migrateLegacyBrandProductHubOnce({
          store: cached,
          brandDbPath: brandPath,
          openDatabase: opts.openReadonlyDatabase || opts.openDatabase,
        });
      }
      return cached;
    } catch {
      close();
      return null;
    }
  }

  function require(
    errorMessage = "creezio_core_db_unavailable — Product Hub SoT requiert core.db",
  ): SqliteProductHubStore {
    const store = get();
    if (!store) throw new Error(errorMessage);
    return store;
  }

  return {
    get,
    require,
    getDb: () => {
      get();
      return sharedDb;
    },
    close,
  };
}
