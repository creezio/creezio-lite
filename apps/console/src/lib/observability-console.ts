/**
 * Store observabilité console ops — SQLite core (C4).
 */

import fs from "node:fs";
import path from "node:path";
import {
  createSqliteObservabilityStore,
  type ObservabilityStore,
  type OrgActivityAggregate,
  type PluginUsageAggregate,
  type SqliteObservabilityStore,
} from "@creezio/observability";

function kitRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const marker = path.join(dir, "packages", "observability", "package.json");
    if (fs.existsSync(marker)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd(), "../..");
}

export function observabilityConsoleDbPath(): string {
  return (
    process.env.CREEZIO_OBS_CONSOLE_DB ||
    path.join(kitRoot(), "var", "console-core.db")
  );
}

/** @deprecated — chemin JSON V2 ; C4 utilise SQLite. */
export function observabilityConsoleFilePath(): string {
  return observabilityConsoleDbPath();
}

let storeSingleton: SqliteObservabilityStore | null = null;

export function getConsoleObservabilityStore(): ObservabilityStore {
  if (!storeSingleton) {
    const coreDbPath = observabilityConsoleDbPath();
    fs.mkdirSync(path.dirname(coreDbPath), { recursive: true });
    storeSingleton = createSqliteObservabilityStore({ coreDbPath });
  }
  return storeSingleton;
}

export type ObservabilityConsoleSummary = {
  activity: number;
  plugin_usage: number;
  control_plane: number;
  total: number;
};

export function loadObservabilityConsoleSnapshot(): {
  updatedAt: string;
  filePath: string;
  dbPath: string;
  persisted: "sqlite";
  events: ReturnType<ObservabilityStore["list"]>;
  usageByPlugin: PluginUsageAggregate[];
  activityByOrg: OrgActivityAggregate[];
  /** Miroir du GET /api/observability?summary (contrat ObservabilityPanel). */
  summary: ObservabilityConsoleSummary;
  usage: PluginUsageAggregate[];
  orgs: OrgActivityAggregate[];
  recent: ReturnType<ObservabilityStore["list"]>;
} {
  const store = getConsoleObservabilityStore();
  const dbPath = observabilityConsoleDbPath();
  const usage = store.aggregatePluginUsage({ limit: 20 });
  const orgs = store.aggregateOrgActivity({ limit: 20 });
  const events = store.list({ limit: 200 });
  return {
    updatedAt: new Date().toISOString(),
    filePath: dbPath,
    dbPath,
    persisted: "sqlite",
    events,
    usageByPlugin: usage,
    activityByOrg: orgs,
    summary: {
      activity: store.count({ kind: "activity" }),
      plugin_usage: store.count({ kind: "plugin_usage" }),
      control_plane: store.count({ kind: "control_plane" }),
      total: store.count(),
    },
    usage,
    orgs,
    recent: store.list({ limit: 20 }),
  };
}
