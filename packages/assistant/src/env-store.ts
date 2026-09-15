/**
 * Assistant SoT via env `CREEZIO_CORE_DB_PATH` / `DB_PATH` — M8.
 */

import {
  ensureCoreDbParent,
  resolveCoreDbPathFromEnv,
} from "@creezio/platform-core";
import {
  createSqliteAssistantStore,
  type SqliteAssistantStore,
} from "./sqlite-store.js";

let cached: SqliteAssistantStore | null = null;
let cachedPath: string | null = null;

export function getKitAssistantStore(): SqliteAssistantStore | null {
  const corePath = resolveCoreDbPathFromEnv();
  if (!corePath) return null;
  if (cached && cachedPath === corePath) return cached;
  try {
    ensureCoreDbParent(corePath);
    if (cached) {
      try {
        cached.close();
      } catch {
        /* ok */
      }
    }
    cached = createSqliteAssistantStore({ coreDbPath: corePath });
    cachedPath = corePath;
    return cached;
  } catch {
    return null;
  }
}

export function requireKitAssistantStore(): SqliteAssistantStore {
  const store = getKitAssistantStore();
  if (!store) {
    throw new Error("creezio_core_db_unavailable");
  }
  return store;
}
