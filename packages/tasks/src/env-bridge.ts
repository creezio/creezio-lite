/**
 * Bridge tasks marque → SoT kit (même UUID) — M8.
 */

import {
  ensureCoreDbParent,
  resolveCoreDbPathFromEnv,
} from "@creezio/platform-core";
import type { PlatformTaskStatus } from "./types.js";
import { createSqliteTasksStore } from "./sqlite-store.js";

export function upsertKitPlatformTask(opts: {
  id: string;
  userId: string;
  title: string;
  body?: string;
  status?: PlatformTaskStatus | string;
}): void {
  const corePath = resolveCoreDbPathFromEnv();
  if (!corePath) return;
  try {
    ensureCoreDbParent(corePath);
    const store = createSqliteTasksStore({ coreDbPath: corePath });
    try {
      const status =
        opts.status === "done" || opts.status === "cancelled"
          ? opts.status
          : "open";
      store.upsertWithId?.({
        id: opts.id,
        userId: opts.userId || "system",
        title: opts.title,
        body: opts.body || "",
        status,
      });
    } finally {
      store.close();
    }
  } catch {
    /* never block product kanban */
  }
}
