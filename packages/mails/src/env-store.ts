/**
 * Store mails SoT via env `CREEZIO_CORE_DB_PATH` / `DB_PATH` (process Next/CRM).
 */

import {
  ensureCoreDbParent,
  resolveCoreDbPathFromEnv,
} from "@creezio/platform-core";
import { createSqliteMailsStore, type SqliteMailsStore } from "./sqlite-store.js";

let cached: SqliteMailsStore | null = null;
let cachedPath: string | null = null;

export function getKitMailsStore(): SqliteMailsStore | null {
  const corePath = resolveCoreDbPathFromEnv();
  if (!corePath) return null;
  if (cached && cachedPath === corePath) return cached;
  if (cached) {
    try {
      cached.close();
    } catch {
      /* ok */
    }
    cached = null;
  }
  ensureCoreDbParent(corePath);
  cached = createSqliteMailsStore({ coreDbPath: corePath });
  cachedPath = corePath;
  return cached;
}

export function resetKitMailsStoreForTests(): void {
  if (cached) {
    try {
      cached.close();
    } catch {
      /* ok */
    }
  }
  cached = null;
  cachedPath = null;
}
