import crypto from "node:crypto";
import type { PlatformTask, PlatformTasksStore } from "./types.js";

function now(): string {
  return new Date().toISOString();
}

export function createMemoryTasksStore(): PlatformTasksStore {
  const tasks = new Map<string, PlatformTask>();

  const store: PlatformTasksStore = {
    create(input) {
      return store.upsertWithId!({
        id: crypto.randomUUID(),
        userId: input.userId,
        title: input.title,
        body: input.body,
        status: "open",
      });
    },
    upsertWithId(input) {
      const ts = now();
      const existing = tasks.get(input.id);
      const t: PlatformTask = {
        id: input.id,
        userId: input.userId,
        title: input.title.trim(),
        body: input.body || "",
        status: input.status || existing?.status || "open",
        createdAt: existing?.createdAt || ts,
        updatedAt: ts,
      };
      if (!t.title) throw new Error("title_required");
      tasks.set(t.id, t);
      return t;
    },
    list(userId) {
      return [...tasks.values()]
        .filter((t) => t.userId === userId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    get(id) {
      return tasks.get(id);
    },
    update(id, patch, actorUserId) {
      const t = tasks.get(id);
      if (!t) throw new Error("not_found");
      if (t.userId !== actorUserId) throw new Error("forbidden");
      const updated: PlatformTask = {
        ...t,
        ...("title" in patch && patch.title !== undefined
          ? { title: patch.title }
          : {}),
        ...("body" in patch && patch.body !== undefined
          ? { body: patch.body }
          : {}),
        ...("status" in patch && patch.status !== undefined
          ? { status: patch.status }
          : {}),
        updatedAt: now(),
      };
      tasks.set(id, updated);
      return updated;
    },
    remove(id, actorUserId) {
      const t = tasks.get(id);
      if (!t) return false;
      if (t.userId !== actorUserId) throw new Error("forbidden");
      return tasks.delete(id);
    },
  };

  return store;
}
