/**
 * Automations console ops — SQLite persist (C4).
 */

import fs from "node:fs";
import path from "node:path";
import {
  createAutomationEngine,
  createSqliteAutomationPersist,
  defaultDemobrandAutomationRules,
  type AutomationEngine,
  type AutomationPersistStore,
} from "@creezio/automations";
import { getConsoleObservabilityStore } from "./observability-console";

function kitRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const marker = path.join(dir, "packages", "automations", "package.json");
    if (fs.existsSync(marker)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd(), "../..");
}

export function automationsConsoleDbPath(): string {
  return (
    process.env.CREEZIO_AUTOMATIONS_CONSOLE_DB ||
    process.env.CREEZIO_OBS_CONSOLE_DB ||
    path.join(kitRoot(), "var", "console-core.db")
  );
}

let persistSingleton: AutomationPersistStore | null = null;
let engineSingleton: AutomationEngine | null = null;

function getPersist(): AutomationPersistStore {
  if (!persistSingleton) {
    const coreDbPath = automationsConsoleDbPath();
    fs.mkdirSync(path.dirname(coreDbPath), { recursive: true });
    persistSingleton = createSqliteAutomationPersist({ coreDbPath });
  }
  return persistSingleton;
}

export function getConsoleAutomationEngine(): AutomationEngine {
  if (!engineSingleton) {
    const persist = getPersist();
    const obs = getConsoleObservabilityStore();
    engineSingleton = createAutomationEngine({
      persist,
      n8nTagPrefix: "console-plugin:",
      emitObservability: (input) => {
        obs.record({
          kind: "activity",
          action: input.action,
          orgId: input.orgId,
          userId: input.userId,
          brandId: input.brandId || "console",
          pluginId: input.pluginId,
          meta: input.meta,
        });
      },
    });
    if (engineSingleton.listRules().length === 0) {
      for (const rule of defaultDemobrandAutomationRules()) {
        engineSingleton.addRule(rule);
      }
    }
  }
  return engineSingleton;
}

export function loadAutomationsConsoleSnapshot() {
  const engine = getConsoleAutomationEngine();
  return {
    updatedAt: new Date().toISOString(),
    dbPath: automationsConsoleDbPath(),
    persisted: "sqlite" as const,
    rules: engine.listRules(),
    runs: engine.listRuns(50),
  };
}
