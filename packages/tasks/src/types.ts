export type PlatformTaskStatus = "open" | "done" | "cancelled";

export type PlatformTask = {
  id: string;
  userId: string;
  title: string;
  body: string;
  status: PlatformTaskStatus;
  createdAt: string;
  updatedAt: string;
};

export type PlatformTasksStore = {
  create(input: {
    userId: string;
    title: string;
    body?: string;
  }): PlatformTask;
  /**
   * C1 — upsert avec id fixe (bridge marque : même UUID brand/kit).
   * Pas de contrôle actor (écritures host / migrate).
   */
  upsertWithId?(input: {
    id: string;
    userId: string;
    title: string;
    body?: string;
    status?: PlatformTaskStatus;
  }): PlatformTask;
  list(userId: string): PlatformTask[];
  get(id: string): PlatformTask | undefined;
  update(
    id: string,
    patch: Partial<Pick<PlatformTask, "title" | "body" | "status">>,
    actorUserId: string,
  ): PlatformTask;
  remove(id: string, actorUserId: string): boolean;
};

/** DDL optionnel sqlite core. */
export const PLATFORM_TASKS_CORE_SQL = `
CREATE TABLE IF NOT EXISTS creezio_platform_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_creezio_platform_tasks_user
  ON creezio_platform_tasks(user_id, status);
`;
